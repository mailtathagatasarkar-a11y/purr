// Turns raw hotkey presses into dictation intents, with Wispr Flow's timing rules:
// hold to talk, double-tap (or add Space) to lock hands-free, a third tap cancels,
// a short tap is discarded, adding the command key upgrades to Command Mode, and an
// unrelated key in the first second (a system shortcut like Ctrl+Win+D) cancels.

import { EventEmitter } from 'events'
import type { HotkeyEngine } from './hotkeys'

export type Mode = 'dictate' | 'command'
export type CancelReason = 'user' | 'shortTap' | 'tripleTap' | 'systemShortcut'

export type Intent =
  | { type: 'start'; mode: Mode; locked: boolean }
  | { type: 'stop' }
  | { type: 'cancel'; reason: CancelReason }
  | { type: 'lock' }
  | { type: 'switchMode'; mode: Mode }
  | { type: 'action'; action: string }

interface GestureSession {
  mode: Mode
  locked: boolean
  startedAt: number
  lockedAt?: number
  awaitingSecondTap?: boolean
  switched?: boolean
  stopOnRelease?: boolean
}

export const DOUBLE_TAP_MS = 500
export const SHORT_TAP_MS = 500
export const SYSTEM_SHORTCUT_MS = 1000

export class Gestures extends EventEmitter<{ intent: [Intent] }> {
  session: GestureSession | null = null
  private tapTimer: NodeJS.Timeout | null = null
  private canStart: () => boolean
  private now: () => number

  constructor(engine: HotkeyEngine, canStart: () => boolean, now: () => number = Date.now) {
    super()
    this.canStart = canStart
    this.now = now
    engine.on('press', (a) => this.onPress(a))
    engine.on('release', (a, ms) => this.onRelease(a, ms))
    engine.on('extraKey', (k) => this.onExtraKey(k))
  }

  private send(i: Intent): void {
    this.emit('intent', i)
  }

  /** The controller ended the session (inserted, cancelled, failed). */
  end(): void {
    if (this.tapTimer) clearTimeout(this.tapTimer)
    this.tapTimer = null
    this.session = null
  }

  /** Start from the Flow Bar or a menu (always hands-free). */
  startExternal(mode: Mode = 'dictate'): void {
    if (this.session || !this.canStart()) return
    const t = this.now()
    this.session = { mode, locked: true, startedAt: t, lockedAt: t }
    this.send({ type: 'start', mode, locked: true })
  }

  private onPress(action: string): void {
    const t = this.now()
    const s = this.session
    if (action === 'pushToTalk' || action === 'commandMode') {
      const mode: Mode = action === 'commandMode' ? 'command' : 'dictate'
      if (s) {
        if (s.awaitingSecondTap && mode === 'dictate') {
          if (this.tapTimer) clearTimeout(this.tapTimer)
          s.awaitingSecondTap = false
          s.locked = true
          s.lockedAt = t
          this.send({ type: 'lock' })
          return
        }
        if (s.locked) {
          if (s.lockedAt !== undefined && t - s.lockedAt < DOUBLE_TAP_MS) {
            this.end()
            this.send({ type: 'cancel', reason: 'tripleTap' })
          } else {
            // Stop when released: the user may be on the way to Ctrl+Win+Space,
            // which passes through Ctrl+Win first.
            s.stopOnRelease = true
          }
          return
        }
        if (mode === 'command' && s.mode === 'dictate') {
          s.mode = 'command'
          s.switched = true
          this.send({ type: 'switchMode', mode: 'command' })
        }
        return
      }
      if (!this.canStart()) return
      this.session = { mode, locked: false, startedAt: t }
      this.send({ type: 'start', mode, locked: false })
      return
    }
    if (action === 'handsFree') {
      if (s) {
        if (!s.locked) {
          s.locked = true
          s.lockedAt = t
          s.awaitingSecondTap = false
          if (this.tapTimer) clearTimeout(this.tapTimer)
          this.send({ type: 'lock' })
          return
        }
        this.end()
        const quick = !s.stopOnRelease && s.lockedAt !== undefined && t - s.lockedAt < DOUBLE_TAP_MS
        this.send(quick ? { type: 'cancel', reason: 'user' } : { type: 'stop' })
        return
      }
      if (!this.canStart()) return
      this.session = { mode: 'dictate', locked: true, startedAt: t, lockedAt: t }
      this.send({ type: 'start', mode: 'dictate', locked: true })
      return
    }
    if (action === 'cancel') {
      if (s) {
        this.end()
        this.send({ type: 'cancel', reason: 'user' })
      } else this.send({ type: 'action', action: 'cancel' }) // may stop an insert still in progress
      return
    }
    this.send({ type: 'action', action })
  }

  private onRelease(action: string, heldMs: number): void {
    if (action !== 'pushToTalk' && action !== 'commandMode') return
    const s = this.session
    if (s?.stopOnRelease) {
      this.end()
      this.send({ type: 'stop' })
      return
    }
    if (!s || s.locked || s.awaitingSecondTap) return
    if (heldMs < SHORT_TAP_MS && !s.switched) {
      // Maybe the first half of a double-tap. Keep recording and wait.
      s.awaitingSecondTap = true
      this.tapTimer = setTimeout(() => {
        if (this.session === s && s.awaitingSecondTap) {
          this.end()
          this.send({ type: 'cancel', reason: 'shortTap' })
        }
      }, DOUBLE_TAP_MS)
      return
    }
    this.end()
    this.send({ type: 'stop' })
  }

  private onExtraKey(key: string): void {
    const s = this.session
    if (!s) return
    if (key === 'Escape') {
      this.end()
      this.send({ type: 'cancel', reason: 'user' })
      return
    }
    if (s.locked) return
    if (this.now() - s.startedAt < SYSTEM_SHORTCUT_MS) {
      this.end()
      this.send({ type: 'cancel', reason: 'systemShortcut' })
    }
  }
}
