import { test } from 'node:test'
import assert from 'node:assert/strict'
import { HotkeyEngine, normalizeChord } from '../src/main/hotkeys.ts'
import { Gestures, type Intent } from '../src/main/gestures.ts'

const WIN = {
  pushToTalk: [['Ctrl', 'Meta']],
  handsFree: [['Ctrl', 'Meta', 'Space']],
  commandMode: [['Ctrl', 'Meta', 'Alt']],
  cancel: [['Escape']],
  pasteLast: [['Alt', 'Shift', 'Z']]
}

function setup() {
  let t = 0
  const engine = new HotkeyEngine()
  engine.setBindings(WIN)
  const g = new Gestures(engine, () => true, () => t)
  const out: Intent[] = []
  g.on('intent', (i) => out.push(i))
  const clock = (ms: number) => (t += ms)
  const down = (k: string) => engine.down(k, t)
  const up = (k: string) => engine.up(k, t)
  return { engine, g, out, clock, down, up, now: () => t }
}

test('hold Ctrl+Win to talk, release to insert', () => {
  const { out, clock, down, up } = setup()
  down('CtrlLeft')
  down('MetaLeft')
  clock(1500)
  up('MetaLeft')
  up('CtrlLeft')
  assert.deepEqual(out.map((i) => i.type), ['start', 'stop'])
})

test('Ctrl+Win then Space locks hands-free; Ctrl+Win+Space again stops', () => {
  const { out, clock, down, up } = setup()
  down('CtrlLeft')
  down('MetaLeft')
  down('Space')
  up('Space')
  up('MetaLeft')
  up('CtrlLeft')
  clock(3000)
  down('CtrlLeft')
  down('MetaLeft')
  down('Space')
  assert.deepEqual(out.map((i) => i.type), ['start', 'lock', 'stop'])
})

test('adding Alt switches to Command Mode', () => {
  const { out, clock, down, up } = setup()
  down('CtrlLeft')
  down('MetaLeft')
  clock(100)
  down('AltLeft')
  clock(2000)
  up('AltLeft')
  up('MetaLeft')
  up('CtrlLeft')
  assert.deepEqual(out, [
    { type: 'start', mode: 'dictate', locked: false },
    { type: 'switchMode', mode: 'command' },
    { type: 'stop' }
  ])
})

test('system shortcut Ctrl+Win+D cancels in the first second', () => {
  const { out, clock, down } = setup()
  down('CtrlLeft')
  down('MetaLeft')
  clock(200)
  down('D')
  assert.deepEqual(out.at(-1), { type: 'cancel', reason: 'systemShortcut' })
})

test('double-tap locks, third quick tap cancels', () => {
  const { out, clock, down, up } = setup()
  const tap = () => {
    down('CtrlLeft')
    down('MetaLeft')
    clock(80)
    up('MetaLeft')
    up('CtrlLeft')
  }
  tap()
  clock(150)
  tap()
  assert.deepEqual(out.map((i) => i.type), ['start', 'lock'])
  clock(100)
  tap()
  assert.deepEqual(out.at(-1), { type: 'cancel', reason: 'tripleTap' })
})

test('short single tap is discarded after the double-tap window', async () => {
  const engine = new HotkeyEngine()
  engine.setBindings(WIN)
  const g = new Gestures(engine, () => true)
  const out: Intent[] = []
  g.on('intent', (i) => out.push(i))
  engine.down('CtrlLeft')
  engine.down('MetaLeft')
  engine.up('MetaLeft')
  engine.up('CtrlLeft')
  await new Promise((r) => setTimeout(r, 600))
  assert.deepEqual(out.at(-1), { type: 'cancel', reason: 'shortTap' })
})

test('Escape outside a recording becomes a cancel action; other shortcuts pass through', () => {
  const { out, down, up } = setup()
  down('Escape')
  up('Escape')
  assert.deepEqual(out, [{ type: 'action', action: 'cancel' }])
  down('AltLeft')
  down('ShiftLeft')
  down('Z')
  assert.deepEqual(out.at(-1), { type: 'action', action: 'pasteLast' })
})

test('right-side keys satisfy generic bindings and record normalizes', () => {
  const { out, down } = setup()
  down('CtrlRight')
  down('MetaRight')
  assert.equal(out[0]?.type, 'start')
  assert.deepEqual(normalizeChord(['MetaLeft', 'CtrlLeft']), ['Ctrl', 'Meta'])
  assert.deepEqual(normalizeChord(['AltRight']), ['AltRight'])
})

test('Escape while holding push-to-talk cancels', () => {
  const { out, clock, down } = setup()
  down('CtrlLeft')
  down('MetaLeft')
  clock(2000)
  down('Escape')
  assert.deepEqual(out.at(-1), { type: 'cancel', reason: 'user' })
})
