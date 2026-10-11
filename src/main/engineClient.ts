import { utilityProcess, type UtilityProcess } from 'electron'
import path from 'path'

type Pending = { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }

/** Talks to the local engine utility process (started on first use, restarted if it crashes). */
export class EngineClient {
  private proc: UtilityProcess | null = null
  private nextId = 1
  private pending = new Map<number, Pending>()
  private exitListeners: (() => void)[] = []

  onExit(fn: () => void): void {
    this.exitListeners.push(fn)
  }

  private ensure(): UtilityProcess {
    if (this.proc) return this.proc
    const proc = utilityProcess.fork(path.join(__dirname, 'engine.js'), [], { serviceName: 'Purr Engine', stdio: 'pipe' })
    proc.stdout?.on('data', (d) => console.log('[engine]', String(d).trim()))
    proc.stderr?.on('data', (d) => console.warn('[engine]', String(d).trim()))
    proc.on('message', (msg: { id: number; ok: boolean; result?: unknown; error?: string }) => {
      const p = this.pending.get(msg.id)
      if (!p) return
      clearTimeout(p.timer)
      this.pending.delete(msg.id)
      if (msg.ok) p.resolve(msg.result)
      else p.reject(new Error(msg.error ?? 'Local engine error'))
    })
    proc.on('exit', (code) => {
      console.warn('[engine] exited', code)
      for (const p of this.pending.values()) {
        clearTimeout(p.timer)
        p.reject(new Error('The local engine stopped unexpectedly. It will restart on the next try.'))
      }
      this.pending.clear()
      this.proc = null
      for (const fn of this.exitListeners) fn()
    })
    this.proc = proc
    return proc
  }

  call<T>(type: string, payload: Record<string, unknown>, timeoutMs = 180_000): Promise<T> {
    const proc = this.ensure()
    const id = this.nextId++
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error('The local engine took too long.'))
      }, timeoutMs)
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject, timer })
      proc.postMessage({ id, type, ...payload })
    })
  }

  stop(): void {
    this.proc?.kill()
    this.proc = null
  }
}
