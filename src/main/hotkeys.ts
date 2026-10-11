// Chord matching for global shortcuts. Knows nothing about Electron, so it can be
// unit-tested: feed it key down/up events, it emits press/release per action.

import { EventEmitter } from 'events'
import type { Chord, HotkeyMap } from '../shared/types'

/** Side-specific physical keys map to a generic name ("CtrlRight" also satisfies "Ctrl"). */
const GENERIC: Record<string, string> = {
  CtrlLeft: 'Ctrl',
  CtrlRight: 'Ctrl',
  AltLeft: 'Alt',
  AltRight: 'Alt',
  ShiftLeft: 'Shift',
  ShiftRight: 'Shift',
  MetaLeft: 'Meta',
  MetaRight: 'Meta'
}

export const MODIFIERS = new Set(['Ctrl', 'Alt', 'Shift', 'Meta', 'Fn', 'CtrlLeft', 'CtrlRight', 'AltLeft', 'AltRight', 'ShiftLeft', 'ShiftRight', 'MetaLeft', 'MetaRight'])

function satisfies(bindingKey: string, pressedKey: string): boolean {
  return bindingKey === pressedKey || GENERIC[pressedKey] === bindingKey
}

/** Every chord key is held by a distinct pressed key (extra keys allowed). */
export function chordHeld(chord: Chord, pressed: Iterable<string>): boolean {
  const pool = [...pressed]
  for (const k of chord) {
    const i = pool.findIndex((p) => satisfies(k, p))
    if (i < 0) return false
    pool.splice(i, 1)
  }
  return true
}

/** Exactly the chord is held: nothing more, nothing less. */
export function chordExact(chord: Chord, pressed: Set<string>): boolean {
  return chord.length === pressed.size && chordHeld(chord, pressed)
}

/** Store a recorded chord: left-side modifiers become generic, right-side stay specific. */
export function normalizeChord(keys: string[]): Chord {
  const order = ['Fn', 'Ctrl', 'CtrlRight', 'Meta', 'MetaRight', 'Alt', 'AltRight', 'Shift', 'ShiftRight']
  const mapped = [...new Set(keys.map((k) => (k.endsWith('Left') && GENERIC[k] ? GENERIC[k] : k)))]
  return mapped.sort((a, b) => {
    const ia = order.indexOf(a)
    const ib = order.indexOf(b)
    if (ia >= 0 || ib >= 0) return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib)
    return a.localeCompare(b)
  })
}

export interface HotkeyEngineEvents {
  press: [action: string]
  release: [action: string, heldMs: number]
  extraKey: [key: string]
  anyKey: [key: string]
}

export class HotkeyEngine extends EventEmitter<HotkeyEngineEvents> {
  readonly pressed = new Set<string>()
  private bindings: { action: string; chord: Chord }[] = []
  private held = new Map<string, { chord: Chord; since: number }>()
  private recorder: { keys: Set<string>; resolve: (c: Chord) => void } | null = null
  enabled = true

  setBindings(map: HotkeyMap): void {
    this.bindings = []
    for (const [action, chords] of Object.entries(map)) for (const chord of chords) if (chord.length) this.bindings.push({ action, chord })
  }

  /** Next chord the user presses (all keys down, then released). */
  record(): Promise<Chord> {
    if (this.recorder) this.recorder.resolve([])
    return new Promise((resolve) => {
      this.recorder = { keys: new Set(), resolve }
    })
  }

  cancelRecord(): void {
    this.recorder?.resolve([])
    this.recorder = null
  }

  isHeld(action: string): boolean {
    return this.held.has(action)
  }

  modifiersDown(): boolean {
    for (const k of this.pressed) if (MODIFIERS.has(k)) return true
    return false
  }

  down(key: string, now = Date.now()): void {
    if (this.pressed.has(key)) return // auto-repeat
    this.pressed.add(key)
    if (this.recorder) {
      this.recorder.keys.add(key)
      return
    }
    if (!this.enabled) return
    this.emit('anyKey', key)
    const match = this.bindings.find((b) => chordExact(b.chord, this.pressed))
    if (match) {
      if (!this.held.has(match.action)) {
        this.held.set(match.action, { chord: match.chord, since: now })
        this.emit('press', match.action)
      }
      return
    }
    if (this.held.size) this.emit('extraKey', key)
  }

  up(key: string, now = Date.now()): void {
    if (!this.pressed.delete(key)) return
    if (this.recorder) {
      if (this.pressed.size === 0) {
        const chord = normalizeChord([...this.recorder.keys])
        this.recorder.resolve(chord)
        this.recorder = null
      }
      return
    }
    for (const [action, h] of [...this.held]) {
      if (!chordHeld(h.chord, this.pressed)) {
        this.held.delete(action)
        this.emit('release', action, now - h.since)
      }
    }
  }

  /** Forget everything held (e.g. after the system swallowed a key-up). */
  reset(): void {
    this.pressed.clear()
    this.held.clear()
  }
}
