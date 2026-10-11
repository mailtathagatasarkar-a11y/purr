import './flowbar.css'
import '@fontsource-variable/jetbrains-mono'
import { wordDiff } from '../../shared/text'
import { RETRANSFORMS } from '../../shared/prompts'
import type { BarView, Toast, TransformDiff } from '../../shared/types'
import { Recorder } from './recorder'
import { play } from './sounds'

const purr = window.purr
const pill = document.getElementById('pill') as HTMLButtonElement
const bars = pill.querySelector('.bars') as HTMLSpanElement
const label = pill.querySelector('.pill-label') as HTMLSpanElement
const hint = pill.querySelector('.pill-hint') as HTMLSpanElement
const toasts = document.getElementById('toasts') as HTMLDivElement
const cards = document.getElementById('cards') as HTMLDivElement

const recorder = new Recorder()
let view: BarView = { state: 'hidden', mode: 'dictate', locked: false, hint: '', sounds: true, volume: 0.5 }
let keepWarm = false

// ---------- live voiceprint ----------
const BAR_COUNT = 18
const levels: number[] = new Array(BAR_COUNT).fill(0)
for (let i = 0; i < BAR_COUNT; i++) bars.appendChild(document.createElement('i'))
let lastPush = 0
function frame(t: number): void {
  if (view.state === 'recording' && t - lastPush > 55) {
    lastPush = t
    levels.shift()
    levels.push(recorder.level)
  } else if (view.state === 'processing' && t - lastPush > 55) {
    lastPush = t
    // A slow travelling ripple while we think.
    levels.shift()
    levels.push(0.18 + 0.14 * Math.sin(t / 140))
  }
  const kids = bars.children
  for (let i = 0; i < BAR_COUNT; i++) {
    const v = view.state === 'recording' || view.state === 'processing' ? levels[i] : 0
    ;(kids[i] as HTMLElement).style.transform = `scaleY(${Math.max(0.12, Math.min(1, v * 1.15)).toFixed(3)})`
  }
  requestAnimationFrame(frame)
}
requestAnimationFrame(frame)

// ---------- view ----------
function render(): void {
  pill.dataset.state = view.state
  pill.dataset.mode = view.mode
  pill.dataset.locked = String(view.locked)
  hint.textContent = view.hint
  const text =
    view.state === 'processing'
      ? view.label ?? (view.mode === 'command' ? 'Thinking' : '')
      : view.state === 'recording' && view.mode === 'command'
        ? 'Command'
        : ''
  label.textContent = text
  pill.dataset.labelled = String(!!text)
  pill.setAttribute(
    'aria-label',
    view.state === 'recording' ? (view.mode === 'command' ? 'Listening for a command' : 'Listening') : view.state === 'processing' ? 'Working' : view.hint
  )
}

purr.on('bar:view', (v: BarView) => {
  if (v.state !== 'recording' && view.state === 'recording') levels.fill(0)
  view = v
  render()
})
purr.on('bar:sound', (name: string) => {
  if (view.sounds) play(name, view.volume)
})

// ---------- pointer: only our elements catch clicks, the rest passes through ----------
let interactive = false
function setInteractive(on: boolean): void {
  if (on === interactive) return
  interactive = on
  purr.send('bar:interactive', on)
}
document.addEventListener('mousemove', (e) => {
  const el = document.elementFromPoint(e.clientX, e.clientY)
  setInteractive(!!el?.closest('.pill:not([data-state="hidden"]), .toast, .card'))
})
document.addEventListener('mouseleave', () => setInteractive(false))

pill.addEventListener('contextmenu', (e) => {
  e.preventDefault()
  if (view.state === 'rest') purr.send('bar:event', 'menu')
})

pill.addEventListener('click', (e) => {
  const target = e.target as HTMLElement
  if (target.closest('.pill-cancel')) purr.send('bar:event', 'cancel')
  else if (target.closest('.pill-stop')) purr.send('bar:event', 'stop')
  else purr.send('bar:event', 'click')
})

// ---------- toasts ----------
function dismiss(el: HTMLElement): void {
  el.classList.add('leaving')
  setTimeout(() => el.remove(), 180)
}

purr.on('bar:toast', (t: Toast) => {
  const el = document.createElement('div')
  el.className = `toast toast-${t.kind}`
  el.setAttribute('role', t.kind === 'error' ? 'alert' : 'status')
  const p = document.createElement('p')
  p.textContent = t.text
  el.appendChild(p)
  if (t.actions?.length) {
    const row = document.createElement('div')
    row.className = 'toast-actions'
    for (const a of t.actions) {
      const b = document.createElement('button')
      b.textContent = a.label
      b.onclick = () => {
        purr.send('bar:event', 'action', a.id)
        dismiss(el)
      }
      row.appendChild(b)
    }
    el.appendChild(row)
  }
  const close = document.createElement('button')
  close.className = 'toast-close'
  close.setAttribute('aria-label', 'Dismiss')
  close.textContent = '×'
  close.onclick = () => dismiss(el)
  el.appendChild(close)
  toasts.appendChild(el)
  while (toasts.children.length > 3) toasts.firstElementChild?.remove()
  let ttl = t.ttlMs ?? (t.kind === 'error' ? 8000 : t.actions?.length ? 6500 : 3800)
  let timer = setTimeout(() => dismiss(el), ttl)
  el.addEventListener('mouseenter', () => clearTimeout(timer))
  el.addEventListener('mouseleave', () => {
    ttl = 2500
    timer = setTimeout(() => dismiss(el), ttl)
  })
})

// ---------- result card (Command Mode answers) ----------
purr.on('bar:card', (c: { id: string; title: string; text: string; actions: { id: string; label: string }[] } | null) => {
  cards.innerHTML = ''
  if (!c) return
  const el = document.createElement('section')
  el.className = 'card'
  el.innerHTML = `<header><span class="eyebrow">Command</span><button class="card-close" aria-label="Close">×</button></header>`
  const h = document.createElement('h2')
  h.textContent = c.title
  const body = document.createElement('div')
  body.className = 'card-body'
  body.textContent = c.text
  const row = document.createElement('div')
  row.className = 'card-actions'
  for (const a of c.actions) {
    const b = document.createElement('button')
    b.textContent = a.label
    b.onclick = () => purr.send('bar:event', 'action', a.id, c.text)
    row.appendChild(b)
  }
  el.append(h, body, row)
  ;(el.querySelector('.card-close') as HTMLButtonElement).onclick = () => (cards.innerHTML = '')
  cards.appendChild(el)
})

// ---------- transform diff ----------
purr.on('bar:diff', (d: TransformDiff | null) => {
  cards.innerHTML = ''
  if (!d) return
  const el = document.createElement('section')
  el.className = 'card diff'
  el.innerHTML = `<header><span class="eyebrow">Changes</span><button class="card-close" aria-label="Close">×</button></header>`
  const h = document.createElement('h2')
  h.textContent = d.name
  const body = document.createElement('div')
  body.className = 'card-body'
  for (const op of wordDiff(d.before, d.after)) {
    const span = document.createElement(op.type === 'same' ? 'span' : op.type === 'add' ? 'ins' : 'del')
    span.textContent = op.text
    body.appendChild(span)
  }
  const row = document.createElement('div')
  row.className = 'card-actions'
  const mk = (id: string, text: string, primary = false): void => {
    const b = document.createElement('button')
    b.textContent = text
    if (primary) b.className = 'primary'
    b.onclick = () => purr.send('bar:event', 'action', id)
    row.appendChild(b)
  }
  mk('diff:close', 'Keep', true)
  mk('diff:undo', 'Undo')
  for (const r of RETRANSFORMS.slice(0, 3)) mk(`retransform:${r.id}`, r.label)
  el.append(h, body, row)
  ;(el.querySelector('.card-close') as HTMLButtonElement).onclick = () => purr.send('bar:event', 'action', 'diff:close')
  cards.appendChild(el)
})

// ---------- recorder requests from main ----------
purr.on('rec:start', async (id: number, p: { deviceId: string; keepWarm: boolean }) => {
  keepWarm = p.keepWarm
  try {
    await recorder.start(p.deviceId)
    purr.send('rec:result', id, true, null)
  } catch (err) {
    const e = err as DOMException
    const msg = e.name === 'NotAllowedError' ? 'permission denied' : e.name === 'NotFoundError' ? 'no microphone found' : e.message || String(err)
    purr.send('rec:result', id, false, msg)
  }
})
purr.on('rec:stop', async (id: number) => {
  const data = await recorder.stop(keepWarm)
  purr.send('rec:result', id, true, data)
})
purr.on('rec:abort', () => recorder.abort(keepWarm))

render()
