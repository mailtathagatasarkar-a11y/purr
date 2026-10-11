// Bridge to the optional native helper (Swift on macOS, C# on Windows).
// It adds what Node can't do alone: the Fn/Globe key, swallowing shortcut keys so
// they don't leak into the app (Opt+S typing "ß"), and reading the focused text field.
//
// Protocol: we write "cmd\tid\targ" lines; it writes JSON lines:
//   {"e":"kd","k":"Fn"} / {"e":"ku","k":"Fn"}        key events
//   {"id":"7", ...result}                              replies

import { spawn, type ChildProcessWithoutNullStreams } from 'child_process'
import { EventEmitter } from 'events'
import fs from 'fs'
import path from 'path'
import { app } from 'electron'

export function helperPath(): string | null {
  const name = process.platform === 'win32' ? 'purr-helper.exe' : 'purr-helper'
  const dir = process.platform === 'win32' ? 'win' : 'mac'
  const candidates = [
    path.join(process.resourcesPath ?? '', 'bin', name),
    path.join(app.getAppPath(), 'resources', 'bin', dir, name),
    path.join(process.cwd(), 'resources', 'bin', dir, name)
  ]
  return candidates.find((p) => p && fs.existsSync(p)) ?? null
}

export class Helper extends EventEmitter<{ key: [boolean, string]; exit: [] }> {
  running = false
  /** True once the helper reports it owns the keyboard hook (it then replaces uiohook). */
  ownsKeyboard = false
  private proc: ChildProcessWithoutNullStreams | null = null
  private nextId = 1
  private pending = new Map<string, (v: unknown) => void>()
  private buf = ''

  constructor(private file: string) {
    super()
  }

  start(): boolean {
    try {
      this.proc = spawn(this.file, [], { stdio: 'pipe', windowsHide: true })
    } catch (err) {
      console.warn('[helper] spawn failed', err)
      return false
    }
    this.running = true
    this.proc.stdout.setEncoding('utf8')
    this.proc.stdout.on('data', (chunk: string) => {
      this.buf += chunk
      let nl: number
      while ((nl = this.buf.indexOf('\n')) >= 0) {
        const line = this.buf.slice(0, nl).trim()
        this.buf = this.buf.slice(nl + 1)
        if (line) this.onLine(line)
      }
    })
    this.proc.stderr.on('data', (d) => console.warn('[helper]', String(d).trim()))
    this.proc.on('exit', (code) => {
      console.warn('[helper] exited', code)
      this.running = false
      this.ownsKeyboard = false
      for (const r of this.pending.values()) r(null)
      this.pending.clear()
      this.emit('exit')
    })
    return true
  }

  private onLine(line: string): void {
    let msg: Record<string, unknown>
    try {
      msg = JSON.parse(line)
    } catch {
      return
    }
    if (msg.e === 'kd' || msg.e === 'ku') this.emit('key', msg.e === 'kd', String(msg.k))
    else if (msg.e === 'hook') this.ownsKeyboard = msg.ok === true
    else if (msg.id !== undefined) {
      const r = this.pending.get(String(msg.id))
      if (r) {
        this.pending.delete(String(msg.id))
        r(msg)
      }
    }
  }

  send(cmd: string, arg = ''): void {
    if (!this.proc || !this.running) return
    this.proc.stdin.write(`${cmd}\t0\t${arg.replace(/[\t\n]/g, ' ')}\n`)
  }

  request<T>(cmd: string, arg: string | Record<string, never> = '', timeoutMs = 500): Promise<T | null> {
    if (!this.proc || !this.running) return Promise.resolve(null)
    const id = String(this.nextId++)
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        resolve(null)
      }, timeoutMs)
      this.pending.set(id, (v) => {
        clearTimeout(timer)
        resolve(v as T)
      })
      const a = typeof arg === 'string' ? arg : ''
      this.proc!.stdin.write(`${cmd}\t${id}\t${a.replace(/[\t\n]/g, ' ')}\n`)
    })
  }

  stop(): void {
    this.send('quit')
    setTimeout(() => this.proc?.kill(), 300)
  }
}
