// Global keyboard/mouse listening and key injection.
// Default backend: uiohook-napi (prebuilt for Windows, macOS, Linux).
// On macOS the Swift helper (see helper.ts) adds the Fn/Globe key, which uiohook can't see.

import { EventEmitter } from 'events'
import { uIOhook, UiohookKey } from 'uiohook-napi'

const NAME_BY_CODE = new Map<number, string>()
for (const [name, code] of Object.entries(UiohookKey)) {
  if (typeof code !== 'number') continue
  const renamed: Record<string, string> = { Ctrl: 'CtrlLeft', Alt: 'AltLeft', Shift: 'ShiftLeft', Meta: 'MetaLeft' }
  if (!NAME_BY_CODE.has(code)) NAME_BY_CODE.set(code, renamed[name] ?? name)
}

export function keyName(code: number): string {
  return NAME_BY_CODE.get(code) ?? `Key${code}`
}

export class KeySource extends EventEmitter<{ down: [string]; up: [string]; error: [Error] }> {
  started = false

  private wired = false

  start(): boolean {
    if (this.started) return true
    if (!this.wired) this.wire()
    try {
      uIOhook.start()
      this.started = true
    } catch (err) {
      this.emit('error', err as Error)
    }
    return this.started
  }

  private wire(): void {
    this.wired = true
    uIOhook.on('keydown', (e) => this.emit('down', keyName(e.keycode)))
    uIOhook.on('keyup', (e) => this.emit('up', keyName(e.keycode)))
    uIOhook.on('mousedown', (e) => {
      const b = Number(e.button)
      if (b >= 3) this.emit('down', `Mouse${b}`)
    })
    uIOhook.on('mouseup', (e) => {
      const b = Number(e.button)
      if (b >= 3) this.emit('up', `Mouse${b}`)
    })
  }

  stop(): void {
    if (!this.started) return
    try {
      uIOhook.stop()
    } catch {
      // ignore
    }
    this.started = false
  }
}

const isMac = process.platform === 'darwin'

export function sendPaste(mode: 'paste' | 'shiftInsert' = 'paste'): void {
  if (!isMac && mode === 'shiftInsert') uIOhook.keyTap(UiohookKey.Insert, [UiohookKey.Shift])
  else uIOhook.keyTap(UiohookKey.V, [isMac ? UiohookKey.Meta : UiohookKey.Ctrl])
}

export function sendCopy(): void {
  uIOhook.keyTap(UiohookKey.C, [isMac ? UiohookKey.Meta : UiohookKey.Ctrl])
}

/** Copy in a terminal without sending Ctrl+C (SIGINT). macOS terminals copy with Cmd+C safely. */
export function sendTerminalCopy(): void {
  if (isMac) uIOhook.keyTap(UiohookKey.C, [UiohookKey.Meta])
  else uIOhook.keyTap(UiohookKey.Insert, [UiohookKey.Ctrl])
}

export function sendSelectAll(): void {
  uIOhook.keyTap(UiohookKey.A, [isMac ? UiohookKey.Meta : UiohookKey.Ctrl])
}

export function sendUndo(): void {
  uIOhook.keyTap(UiohookKey.Z, [isMac ? UiohookKey.Meta : UiohookKey.Ctrl])
}

/** Release modifiers the system may think are still down (after a held chord). */
export function releaseModifiers(names: string[]): void {
  const codes: Record<string, number> = {
    CtrlLeft: UiohookKey.Ctrl,
    CtrlRight: UiohookKey.CtrlRight,
    AltLeft: UiohookKey.Alt,
    AltRight: UiohookKey.AltRight,
    ShiftLeft: UiohookKey.Shift,
    ShiftRight: UiohookKey.ShiftRight,
    MetaLeft: UiohookKey.Meta,
    MetaRight: UiohookKey.MetaRight
  }
  for (const n of names) if (codes[n] !== undefined) uIOhook.keyToggle(codes[n], 'up')
}
