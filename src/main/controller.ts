// The dictation brain: hotkey intents in, text into the focused app out.

import { shell } from 'electron'
import fs from 'fs'
import path from 'path'
import { randomUUID } from 'crypto'
import { decodeWav, encodeWav, envelope, normalizeGain, speechStats, trimSilence } from '../shared/audio'
import { LANGUAGES } from '../shared/defaults'
import {
  cleanupPrompt,
  commandEditPrompt,
  commandEditUser,
  commandFreePrompt,
  commandFreeUser,
  parseCommandDecision,
  RETRANSFORMS,
  searchQueryFromInstruction,
  searchUrl,
  transformPrompt,
  transformUser,
  wrapTranscript
} from '../shared/prompts'
import {
  applyDictionary,
  applyFileTagging,
  applySpokenCommands,
  applyStyle,
  capitalizeSentences,
  countWords,
  deterministicClean,
  ensureFinalPunctuation,
  exactSnippet,
  guardAiOutput,
  learnCandidates,
  protectSnippets,
  restoreSnippets,
  tidy,
  wordDiff
} from '../shared/text'
import type { AppContext, BarView, Chord, HistoryItem, HistoryMode, Settings, Toast, TransformDiff } from '../shared/types'
import type { Gestures, Intent, Mode, CancelReason } from './gestures'
import { pasteText, readSelection } from './insert'
import { llmAvailable, type LanguageModel } from './llm'
import type { ModelManager } from './models'
import { sendUndo } from './native/keys'
import type { Store } from './store'
import type { SpeechToText } from './stt'
import { classifyApp } from '../shared/apps'

export interface Bar {
  setView(v: BarView): void
  toast(t: Toast): void
  card(c: { id: string; title: string; text: string; actions: { id: string; label: string }[] } | null): void
  diff(d: TransformDiff | null): void
  sound(name: 'start' | 'stop' | 'cancel' | 'error' | 'lock'): void
  startRecording(deviceId: string, keepWarm: boolean): Promise<void>
  stopRecording(): Promise<Float32Array>
  abortRecording(): void
  reposition(): void
}

export interface ControllerDeps {
  store: Store
  stt: SpeechToText
  llm: LanguageModel
  models: ModelManager
  gestures: Gestures
  bar: Bar
  getContext: () => Promise<AppContext>
  openScratchpad: () => void
  openHub: (route?: string) => void
  setEscSwallow: (on: boolean) => void
  readFocusedText?: () => Promise<string | null>
}

interface Session {
  id: string
  mode: Mode
  locked: boolean
  startedAt: number
  context: Promise<AppContext>
  cancelled: boolean
}

export interface ProcessResult {
  text: string
  fixes: number
  usedAi: boolean
  aiError?: string
}

const isMac = process.platform === 'darwin'

export function chordLabel(chord: Chord | undefined): string {
  if (!chord?.length) return ''
  const names: Record<string, string> = isMac
    ? { Meta: '⌘', MetaRight: 'Right ⌘', Ctrl: '⌃', CtrlRight: 'Right ⌃', Alt: '⌥', AltRight: 'Right ⌥', Shift: '⇧', ShiftRight: 'Right ⇧', Fn: 'fn', Space: 'Space', Escape: 'Esc' }
    : { Meta: 'Win', MetaRight: 'Right Win', Ctrl: 'Ctrl', CtrlRight: 'Right Ctrl', Alt: 'Alt', AltRight: 'Right Alt', Shift: 'Shift', ShiftRight: 'Right Shift', Space: 'Space', Escape: 'Esc' }
  return chord.map((k) => names[k] ?? k.replace(/^Mouse(\d)$/, 'Mouse $1')).join(isMac ? ' ' : ' + ')
}

function normalizeLang(lang?: string): string | undefined {
  if (!lang) return undefined
  const l = lang.toLowerCase()
  if (l.length <= 3) return l
  return LANGUAGES.find((x) => x.name.toLowerCase().startsWith(l))?.code
}

export class Controller {
  state: 'idle' | 'recording' | 'processing' = 'idle'
  private session: Session | null = null
  private timers: NodeJS.Timeout[] = []
  private lastTransform: TransformDiff | null = null
  private cancelled: { samples: Float32Array; context: Promise<AppContext>; at: number } | null = null
  private shortTapTips = 0
  private aiWarnedAt = 0
  private learnTimer: NodeJS.Timeout | null = null

  constructor(private d: ControllerDeps) {
    d.gestures.on('intent', (i) => void this.onIntent(i))
  }

  private get settings(): Settings {
    return this.d.store.settings
  }

  canStart(): boolean {
    return this.state === 'idle'
  }

  // ---------- Flow Bar ----------
  view(): BarView {
    const s = this.settings
    const hidden = !s.showFlowBar || s.flowBarHiddenUntil > Date.now()
    const state = this.state === 'idle' ? (hidden ? 'hidden' : 'rest') : this.state
    return {
      state,
      mode: this.session?.mode ?? (this.state === 'processing' ? 'transform' : 'dictate'),
      locked: !!this.session?.locked,
      label: this.barLabel,
      hint: `Click or hold ${chordLabel(s.hotkeys.pushToTalk?.[0])} to dictate`,
      sounds: s.sounds,
      volume: s.soundVolume
    }
  }
  private barLabel: string | undefined
  refreshBar(): void {
    this.d.bar.setView(this.view())
  }

  private toast(kind: Toast['kind'], text: string, actions?: Toast['actions'], ttlMs?: number): void {
    this.d.bar.toast({ id: randomUUID(), kind, text, actions, ttlMs })
  }

  // ---------- intents ----------
  private async onIntent(i: Intent): Promise<void> {
    switch (i.type) {
      case 'start':
        if (i.mode === 'command' && !this.settings.commandMode) {
          this.d.gestures.end()
          this.toast('info', 'Command Mode is off. Turn it on in Settings → Experimental.')
          return
        }
        return this.start(i.mode, i.locked)
      case 'stop':
        return this.finish()
      case 'cancel':
        return this.cancel(i.reason)
      case 'lock':
        if (this.session) {
          this.session.locked = true
          this.d.bar.sound('lock')
          this.refreshBar()
        }
        return
      case 'switchMode':
        if (this.session && this.settings.commandMode) {
          this.session.mode = i.mode
          this.refreshBar()
        }
        return
      case 'action':
        return this.runAction(i.action)
    }
  }

  /** Flow Bar click: start hands-free, stop, or cancel if clicked again right away. */
  barClicked(): void {
    if (this.state === 'idle') this.d.gestures.startExternal('dictate')
    else if (this.state === 'recording' && this.session) {
      if (Date.now() - this.session.startedAt < 500) this.cancel('user')
      else void this.finish()
    }
  }

  barStop(): void {
    if (this.state === 'recording') {
      this.d.gestures.end()
      void this.finish()
    }
  }

  barCancel(): void {
    this.d.gestures.end()
    this.cancel('user')
  }

  /** Mic button in Notes / Scratchpad. */
  toggleDictation(): void {
    if (this.state === 'idle') this.d.gestures.startExternal('dictate')
    else this.barStop()
  }

  private async start(mode: Mode, locked: boolean): Promise<void> {
    if (this.state !== 'idle') return
    const s: Session = { id: randomUUID(), mode, locked, startedAt: Date.now(), context: this.d.getContext(), cancelled: false }
    this.session = s
    this.state = 'recording'
    this.barLabel = undefined
    this.d.setEscSwallow(true)
    this.d.bar.reposition()
    this.refreshBar()
    try {
      await this.d.bar.startRecording(this.settings.microphoneId, this.settings.keepMicWarm)
    } catch (err) {
      // The recorder may still open the mic after we gave up waiting: tell it to stop.
      this.d.bar.abortRecording()
      if (this.session !== s) return
      this.reset()
      this.d.bar.sound('error')
      this.toast('error', `Microphone unavailable: ${(err as Error).message}`, [{ id: 'open:settings/general', label: 'Microphone settings' }])
      return
    }
    if (s.cancelled || this.session !== s) {
      // Cancelled while the mic was still opening: close it again.
      this.d.bar.abortRecording()
      return
    }
    this.d.bar.sound('start')
    const max = Math.max(1, this.settings.maxRecordingMinutes) * 60_000
    this.timers.push(
      setTimeout(() => this.session === s && this.toast('warning', 'One minute left in this dictation.'), Math.max(0, max - 60_000)),
      setTimeout(() => {
        if (this.session === s && this.state === 'recording') {
          this.d.gestures.end()
          void this.finish()
        }
      }, max)
    )
  }

  private clearTimers(): void {
    for (const t of this.timers) clearTimeout(t)
    this.timers = []
  }

  private reset(): void {
    this.clearTimers()
    this.session = null
    this.state = 'idle'
    this.barLabel = undefined
    this.d.setEscSwallow(false)
    this.d.gestures.end()
    this.refreshBar()
  }

  private cancel(reason: CancelReason): void {
    const s = this.session
    if (!s) return
    s.cancelled = true
    const wasRecording = this.state === 'recording'
    if (wasRecording) {
      const context = s.context
      const elapsed = Date.now() - s.startedAt
      // Keep the audio briefly so "Undo" can still insert it.
      this.d.bar
        .stopRecording()
        .then((samples) => {
          if (reason === 'user' && elapsed > 1500) this.cancelled = { samples, context, at: Date.now() }
        })
        .catch(() => undefined)
    }
    this.reset()
    if (reason === 'shortTap') {
      if (this.shortTapTips++ < 3) this.toast('info', `Hold ${chordLabel(this.settings.hotkeys.pushToTalk?.[0])} while you talk, or double-tap it for hands-free.`)
      return
    }
    if (reason === 'systemShortcut') return
    this.d.bar.sound('cancel')
    if (wasRecording && reason === 'user') this.toast('info', 'Dictation cancelled', [{ id: 'undoCancel', label: 'Undo' }], 6000)
  }

  private async finish(): Promise<void> {
    const s = this.session
    if (!s || this.state !== 'recording') return
    this.clearTimers()
    this.state = 'processing'
    this.refreshBar()
    this.d.bar.sound('stop')
    let samples: Float32Array
    try {
      samples = await this.d.bar.stopRecording()
    } catch (err) {
      this.reset()
      this.toast('error', `Recording failed: ${(err as Error).message}`)
      return
    }
    try {
      if (s.mode === 'command') await this.runCommand(s, samples)
      else await this.runDictation(s, samples)
    } catch (err) {
      console.error('[controller]', err)
      this.d.bar.sound('error')
      this.toast('error', (err as Error).message || 'Something went wrong.', [{ id: 'open:home', label: 'Open history' }])
    } finally {
      if (this.session === s) this.reset()
    }
  }

  // ---------- text pipeline ----------
  async process(raw: string, ctx: AppContext, lang?: string): Promise<ProcessResult> {
    const s = this.settings
    const lib = this.d.store.library
    const dictionary = lib.dictionary.filter((e) => !e.deleted)
    const snippets = lib.snippets.filter((x) => !x.deleted)
    const snip = exactSnippet(raw, snippets)
    if (snip) return { text: snip.expansion, fixes: 1, usedAi: false }

    const aiOn = s.cleanupLevel !== 'none' && llmAvailable(s, this.d.models, (p) => this.d.store.getKey(p))
    let text: string
    let fixes = 0
    if (s.cleanupLevel === 'none') {
      text = applySpokenCommands(tidy(raw), false)
    } else {
      const det = deterministicClean(raw, { lang, aiWillRun: aiOn, backtrack: s.backtrack, smartFormatting: s.smartFormatting })
      text = det.text
      fixes += det.fixes
    }
    const d1 = applyDictionary(text, dictionary)
    text = d1.text
    fixes += d1.count
    let prot = protectSnippets(text, snippets)
    text = prot.text
    fixes += prot.count

    let usedAi = false
    let aiError: string | undefined
    if (aiOn && countWords(text) >= 2 && s.cleanupLevel !== 'none') {
      const before = text
      const system = cleanupPrompt({
        level: s.cleanupLevel,
        style: s.styles[ctx.category],
        app: ctx,
        vocabulary: dictionary.map((e) => e.word),
        languages: s.languages,
        smartFormatting: s.smartFormatting,
        backtrack: s.backtrack,
        variableRecognition: s.vibe.variableRecognition,
        hasSnippetTokens: prot.count > 0
      })
      try {
        const out = await this.d.llm.complete(s, { system, user: wrapTranscript(text), maxTokens: Math.min(8000, 200 + countWords(text) * 3), timeoutMs: 20_000, wait: false })
        const guarded = guardAiOutput(before, out, s.cleanupLevel)
        if (guarded) {
          text = guarded
          usedAi = true
          fixes += wordDiff(before, guarded).filter((op) => op.type === 'del' && /[\p{L}\p{N}]/u.test(op.text)).length
        } else aiError = 'AI output looked off, so the basic clean-up was used.'
      } catch (err) {
        aiError = (err as Error).message
      }
      if (!usedAi) {
        // The first pass skipped what it expected the AI to handle (scratch that, spoken punctuation).
        const det = deterministicClean(raw, { lang, aiWillRun: false, backtrack: s.backtrack, smartFormatting: s.smartFormatting })
        prot = protectSnippets(applyDictionary(det.text, dictionary).text, snippets)
        text = prot.text
        fixes = Math.max(fixes, det.fixes)
      }
    }
    text = restoreSnippets(text, prot.tokens)
    text = applyDictionary(text, dictionary).text
    if (ctx.fileTagging && s.vibe.fileTagging && prot.count === 0 && d1.count === 0) text = applyFileTagging(text)
    if (s.cleanupLevel !== 'none') {
      const protectedWords = new Set(dictionary.map((e) => e.word.toLowerCase()))
      text = applyStyle(text, s.styles[ctx.category], ctx.category, ctx.kind, protectedWords)
    }
    return { text, fixes, usedAi, aiError }
  }

  private warnAi(err?: string): void {
    if (!err || Date.now() - this.aiWarnedAt < 10 * 60_000) return
    this.aiWarnedAt = Date.now()
    this.toast('warning', `AI clean-up unavailable, inserted the basic version. ${err}`, [{ id: 'open:settings/engine', label: 'Engine settings' }], 8000)
  }

  private async transcribe(samples: Float32Array): Promise<{ raw: string; language?: string; provider: string; speechMs: number } | null> {
    const stats = speechStats(samples)
    if (!stats.hasSpeech) {
      this.toast('warning', 'No audio detected. Check your microphone.', [{ id: 'open:settings/general', label: 'Microphone settings' }])
      return null
    }
    let audio = trimSilence(samples)
    if (this.settings.whisperBoost) audio = normalizeGain(audio)
    const vocabulary = this.d.store.library.dictionary.filter((e) => !e.deleted).map((e) => e.word)
    const r = await this.d.stt.transcribe(this.settings, { samples: audio, languages: this.settings.languages, vocabulary })
    return { raw: r.text, language: normalizeLang(r.language), provider: r.provider, speechMs: stats.speechMs }
  }

  private saveAudio(id: string, samples: Float32Array): string | undefined {
    if (!this.settings.privacy.saveAudio || !this.settings.privacy.saveHistory) return undefined
    const file = `${id}.wav`
    fs.writeFile(path.join(this.d.store.audioDir, file), encodeWav(samples), () => undefined)
    return file
  }

  private record(mode: HistoryMode, ctx: AppContext, fields: Partial<HistoryItem> & { raw: string; text: string }, samples: Float32Array | null, durationMs: number, speechMs: number): HistoryItem {
    const id = randomUUID()
    const item: HistoryItem = {
      id,
      at: Date.now(),
      mode,
      app: ctx.appName,
      category: ctx.category,
      durationMs,
      words: countWords(fields.text),
      fixes: 0,
      stt: '',
      llm: '',
      latencyMs: 0,
      ...fields,
      audioFile: samples ? this.saveAudio(id, samples) : undefined,
      wave: samples ? envelope(trimSilence(samples), 40) : fields.wave
    }
    this.d.store.addHistory(item)
    if (!item.error) this.d.store.recordStats(item, speechMs)
    return item
  }

  private async insert(text: string, ctx: AppContext, raw = false): Promise<void> {
    let out = text
    if (!raw && this.settings.addTrailingSpace && /[.!?,;:]$/.test(out) && ctx.kind !== 'terminal') out += ' '
    await pasteText(out, { pasteWith: process.platform === 'win32' ? ctx.pasteWith : 'paste', keepInClipboard: this.settings.keepTranscriptInClipboard })
  }

  private async runDictation(s: Session, samples: Float32Array): Promise<void> {
    const ctx = await s.context
    const durationMs = Date.now() - s.startedAt
    const t0 = Date.now()
    const tr = await this.transcribe(samples)
    if (!tr) return
    if (!tr.raw.trim()) {
      this.toast('warning', "Didn't catch that. Try again a little closer to the mic.")
      return
    }
    const p = await this.process(tr.raw, ctx, tr.language)
    let text = p.text
    let instruction: string | undefined
    if (this.settings.autoTransformId) {
      const t = this.d.store.library.transforms.find((x) => x.id === this.settings.autoTransformId && !x.deleted)
      if (t) {
        try {
          text = (await this.d.llm.complete(this.settings, { system: transformPrompt(t), user: transformUser(text) })).trim() || text
          instruction = t.name
        } catch (err) {
          console.warn('[auto-transform] failed, pasting dictation', err)
        }
      }
    }
    if (s.cancelled) return
    if (text.trim()) await this.insert(text, ctx)
    this.warnAi(p.aiError)
    this.record(
      'dictation',
      ctx,
      { raw: tr.raw, text, fixes: p.fixes, language: tr.language, stt: tr.provider, llm: p.usedAi ? this.d.llm.label(this.settings) : 'rules', latencyMs: Date.now() - t0, instruction },
      samples,
      durationMs,
      tr.speechMs
    )
    this.scheduleLearning(text)
  }

  // ---------- Command Mode ----------
  private async runCommand(s: Session, samples: Float32Array): Promise<void> {
    const ctx = await s.context
    const t0 = Date.now()
    const tr = await this.transcribe(samples)
    if (!tr || !tr.raw.trim()) return
    const instruction = deterministicClean(tr.raw, { aiWillRun: false, backtrack: true, smartFormatting: false }).text
    if (!llmAvailable(this.settings, this.d.models, (p) => this.d.store.getKey(p))) {
      const q = searchQueryFromInstruction(instruction)
      if (q) return void shell.openExternal(searchUrl(this.settings.searchEngine, q))
      this.toast('warning', 'Command Mode needs an AI model. Set one up in Settings → Engine.', [{ id: 'open:settings/engine', label: 'Set up' }])
      return
    }
    this.barLabel = 'Thinking'
    this.refreshBar()
    const sel = await readSelection({ terminal: ctx.kind === 'terminal' })
    const selected = sel.text.trim()
    let result = ''
    const q = searchQueryFromInstruction(instruction)
    if (q) {
      await shell.openExternal(searchUrl(this.settings.searchEngine, selected ? `${q} ${selected.slice(0, 1500)}` : q))
      result = `Searched: ${q}`
    } else if (selected) {
      result = await this.d.llm.complete(this.settings, { system: commandEditPrompt(ctx), user: commandEditUser(instruction, sel.text), maxTokens: 4000 })
      if (s.cancelled) return
      if (result) {
        await this.insert(result, ctx, true)
        this.lastTransform = { name: instruction, before: sel.text, after: result, at: Date.now() }
      }
    } else {
      const raw = await this.d.llm.complete(this.settings, { system: commandFreePrompt(ctx), user: commandFreeUser(instruction), json: true, maxTokens: 3000 })
      const decision = parseCommandDecision(raw, instruction)
      result = decision.text
      if (s.cancelled) return
      if (decision.action === 'search') await shell.openExternal(searchUrl(this.settings.searchEngine, decision.text))
      else if (decision.action === 'insert') await this.insert(decision.text, ctx, true)
      else
        this.d.bar.card({
          id: randomUUID(),
          title: instruction,
          text: decision.text,
          actions: [
            { id: 'card:copy', label: 'Copy' },
            { id: 'card:insert', label: 'Insert' }
          ]
        })
    }
    this.record('command', ctx, { raw: tr.raw, text: result, instruction, stt: tr.provider, llm: this.d.llm.label(this.settings), latencyMs: Date.now() - t0 }, null, Date.now() - s.startedAt, tr.speechMs)
  }

  // ---------- Transforms ----------
  private async runTransform(id: string): Promise<void> {
    if (this.state !== 'idle') return
    const t = this.d.store.library.transforms.find((x) => x.id === id && !x.deleted)
    if (!t) return
    if (!llmAvailable(this.settings, this.d.models, (p) => this.d.store.getKey(p))) {
      this.toast('warning', `${t.name} needs an AI model. Set one up in Settings → Engine.`, [{ id: 'open:settings/engine', label: 'Set up' }])
      return
    }
    const ctxPromise = this.d.getContext()
    this.state = 'processing'
    this.barLabel = t.name
    this.refreshBar()
    try {
      const tctx = await ctxPromise
      const sel = await readSelection({ selectAllIfEmpty: this.settings.transformUseWholeField && tctx.kind !== 'terminal', terminal: tctx.kind === 'terminal' })
      const text = sel.text
      const words = countWords(text)
      if (!words) {
        this.toast('info', `Select some text, then press the ${t.name} shortcut.`)
        return
      }
      if (words > 1000) {
        this.toast('warning', `${t.name} works on up to 1,000 words. Select a shorter part.`)
        return
      }
      const t0 = Date.now()
      const out = (await this.d.llm.complete(this.settings, { system: transformPrompt(t), user: transformUser(text), maxTokens: 4000 })).trim()
      if (!out) throw new Error(`${t.name} returned nothing. Try again.`)
      const ctx = await ctxPromise
      await this.insert(out, ctx, true)
      this.lastTransform = { name: t.name, before: text, after: out, at: Date.now() }
      this.toast('success', `${t.name} applied`, [
        { id: 'diff', label: 'View diff' },
        { id: 'undoTransform', label: 'Undo' }
      ])
      this.record('transform', ctx, { raw: text, text: out, instruction: t.name, llm: this.d.llm.label(this.settings), latencyMs: Date.now() - t0 }, null, 0, 0)
    } catch (err) {
      this.d.bar.sound('error')
      this.toast('error', (err as Error).message)
    } finally {
      this.state = 'idle'
      this.barLabel = undefined
      this.refreshBar()
    }
  }

  async reTransform(id: string): Promise<void> {
    const last = this.lastTransform
    const r = RETRANSFORMS.find((x) => x.id === id)
    if (!last || !r || this.state !== 'idle') return
    this.state = 'processing'
    this.barLabel = r.label
    this.refreshBar()
    try {
      const out = (await this.d.llm.complete(this.settings, { system: r.prompt, user: transformUser(last.after) })).trim()
      // Undo the previous paste (restores the selection in most apps), then paste over it.
      sendUndo()
      await new Promise((res) => setTimeout(res, 120))
      const ctx = await this.d.getContext()
      await this.insert(out, ctx, true)
      this.lastTransform = { name: r.label, before: last.before, after: out, at: Date.now() }
      this.d.bar.diff(this.lastTransform)
    } catch (err) {
      this.toast('error', (err as Error).message)
    } finally {
      this.state = 'idle'
      this.barLabel = undefined
      this.refreshBar()
    }
  }

  // ---------- other shortcuts ----------
  private async runAction(action: string): Promise<void> {
    if (action === 'cancel') {
      // Esc while Purr is still transcribing: don't insert the result.
      if (this.state === 'processing' && this.session && !this.session.cancelled) {
        this.session.cancelled = true
        this.d.bar.sound('cancel')
        this.toast('info', 'Cancelled. Nothing was inserted.')
      }
      return
    }
    if (action.startsWith('transform:')) return this.runTransform(action.slice('transform:'.length))
    if (action === 'pasteLast') return this.pasteLast()
    if (action === 'scratchpad') return this.d.openScratchpad()
    if (action === 'viewDiff') {
      if (this.lastTransform) this.d.bar.diff(this.lastTransform)
      else this.toast('info', 'No recent transform to compare.')
    }
  }

  async pasteLast(): Promise<void> {
    const last = this.d.store.history.find((h) => h.mode === 'dictation' && !h.error && h.text)
    if (!last) return this.toast('info', 'Nothing dictated yet.')
    const ctx = await this.d.getContext()
    await this.insert(last.showRaw ? last.raw : last.text, ctx)
  }

  /** Toast / card buttons from the Flow Bar. */
  async barAction(actionId: string, cardText?: string): Promise<void> {
    if (actionId.startsWith('open:')) return this.d.openHub(actionId.slice(5))
    if (actionId === 'diff' && this.lastTransform) return this.d.bar.diff(this.lastTransform)
    if (actionId === 'undoTransform' || actionId === 'diff:undo') {
      sendUndo()
      this.d.bar.diff(null)
      return
    }
    if (actionId === 'diff:close') return this.d.bar.diff(null)
    if (actionId.startsWith('retransform:')) return this.reTransform(actionId.slice(12))
    if (actionId === 'card:copy' && cardText) {
      const { clipboard } = await import('electron')
      clipboard.writeText(cardText)
      this.toast('success', 'Copied')
      return
    }
    if (actionId === 'card:insert' && cardText) {
      this.d.bar.card(null)
      const ctx = await this.d.getContext()
      return this.insert(cardText, ctx, true)
    }
    if (actionId === 'undoCancel' && this.cancelled && Date.now() - this.cancelled.at < 15_000) {
      if (this.state !== 'idle') return this.toast('info', 'Finish the current dictation first, then press Undo.')
      const c = this.cancelled
      this.cancelled = null
      this.state = 'processing'
      this.refreshBar()
      try {
        const ctx = await c.context
        const tr = await this.transcribe(c.samples)
        if (tr?.raw.trim()) {
          const p = await this.process(tr.raw, ctx, tr.language)
          await this.insert(p.text, ctx)
          this.record('dictation', ctx, { raw: tr.raw, text: p.text, fixes: p.fixes, stt: tr.provider, llm: p.usedAi ? this.d.llm.label(this.settings) : 'rules' }, c.samples, c.samples.length / 16, tr.speechMs)
        }
      } catch (err) {
        this.toast('error', (err as Error).message)
      } finally {
        this.state = 'idle'
        this.refreshBar()
      }
    }
  }

  // ---------- history tools ----------
  async retry(id: string): Promise<HistoryItem | undefined> {
    const item = this.d.store.history.find((h) => h.id === id)
    if (!item?.audioFile) throw new Error('The audio for this dictation is no longer saved.')
    const samples = decodeWav(fs.readFileSync(path.join(this.d.store.audioDir, item.audioFile)))
    const tr = await this.transcribe(samples)
    if (!tr) throw new Error('No speech found in the saved audio.')
    const ctx = classifyApp('', '', item.app)
    ctx.category = item.category
    const p = await this.process(tr.raw, ctx, tr.language)
    return this.d.store.updateHistory(id, { raw: tr.raw, text: p.text, error: undefined, stt: tr.provider, words: countWords(p.text) })
  }

  async transcribeFile(samples: Float32Array, name: string): Promise<HistoryItem> {
    const tr = await this.transcribe(samples)
    if (!tr) throw new Error('No speech found in that file.')
    const ctx = classifyApp('', '')
    ctx.appName = name
    const p = await this.process(tr.raw, ctx, tr.language)
    return this.record('file', ctx, { raw: tr.raw, text: p.text, fixes: p.fixes, stt: tr.provider, llm: p.usedAi ? this.d.llm.label(this.settings) : 'rules' }, null, samples.length / 16, tr.speechMs)
  }

  /** The user fixed a transcript in History: keep the fix and learn new words. */
  learnFromEdit(id: string, edited: string): string[] {
    const item = this.d.store.history.find((h) => h.id === id)
    if (!item) return []
    const learned = this.learnWords(item.text, edited)
    this.d.store.updateHistory(id, { text: edited, words: countWords(edited) })
    return learned
  }

  private learnWords(before: string, after: string): string[] {
    if (!this.settings.autoLearnWords) return []
    const known = new Set(this.d.store.library.dictionary.filter((e) => !e.deleted).map((e) => e.word.toLowerCase()))
    // Words the user deleted on purpose are never re-added.
    for (const e of this.d.store.library.dictionary) if (e.deleted && e.auto) known.add(e.word.toLowerCase())
    const words = learnCandidates(before, after, known)
    for (const w of words) this.d.store.saveWord({ word: w, auto: true })
    return words
  }

  /** After inserting, peek at the field (native helper) to learn words the user corrected. */
  private scheduleLearning(inserted: string): void {
    if (!this.d.readFocusedText || !this.settings.autoLearnWords || countWords(inserted) < 2) return
    if (this.learnTimer) clearTimeout(this.learnTimer)
    this.learnTimer = setTimeout(async () => {
      const value = await this.d.readFocusedText?.()
      if (!value || value.includes(inserted.trim())) return
      // Find the stretch of the field most like what we inserted.
      const words = inserted.trim().split(/\s+/)
      const fieldWords = value.split(/\s+/)
      let best = ''
      let bestScore = 0
      for (let i = 0; i < fieldWords.length; i++) {
        const cand = fieldWords.slice(i, i + words.length + 2).join(' ')
        const same = wordDiff(inserted, cand).filter((o) => o.type === 'same').reduce((n, o) => n + o.text.trim().split(/\s+/).filter(Boolean).length, 0)
        if (same > bestScore) {
          bestScore = same
          best = cand
        }
      }
      if (best && bestScore >= words.length * 0.6) {
        const learned = this.learnWords(inserted, best)
        if (learned.length) this.toast('success', `Added to dictionary: ${learned.join(', ')}`, [{ id: 'open:dictionary', label: 'View' }])
      }
    }, 20_000)
  }
}
