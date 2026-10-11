import { app, BrowserWindow, ipcMain, nativeTheme, screen, shell } from 'electron'
import { EventEmitter } from 'events'
import fs from 'fs'
import path from 'path'
import { decodeWav } from '../shared/audio'
import type { BarView, Toast, TransformDiff } from '../shared/types'
import type { Bar } from './controller'

const isMac = process.platform === 'darwin'
const preload = path.join(__dirname, '../preload/index.js')

function load(win: BrowserWindow, page: 'hub' | 'flowbar', hash = ''): void {
  const dev = process.env.ELECTRON_RENDERER_URL
  if (dev) void win.loadURL(`${dev}/${page}.html${hash ? `#${hash}` : ''}`)
  else void win.loadFile(path.join(__dirname, `../renderer/${page}.html`), hash ? { hash } : undefined)
}

function surface(): string {
  return nativeTheme.shouldUseDarkColors ? '#0f1113' : '#eceef1'
}

function symbols(): string {
  return nativeTheme.shouldUseDarkColors ? '#eceef0' : '#14171b'
}

function chrome(): Partial<Electron.BrowserWindowConstructorOptions> {
  if (isMac) return { titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 18, y: 18 } }
  return { titleBarStyle: 'hidden', titleBarOverlay: { color: surface(), symbolColor: symbols(), height: 44 } }
}

function externalLinks(win: BrowserWindow): void {
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
}

export class HubWindows {
  hub: BrowserWindow | null = null
  scratch: BrowserWindow | null = null
  quitting = false

  constructor() {
    nativeTheme.on('updated', () => {
      for (const w of [this.hub, this.scratch]) {
        if (w && !w.isDestroyed()) {
          w.setBackgroundColor(surface())
          if (!isMac) w.setTitleBarOverlay({ color: surface(), symbolColor: symbols() })
        }
      }
    })
  }

  openHub(route = ''): void {
    if (this.hub && !this.hub.isDestroyed()) {
      if (route) this.hub.webContents.send('nav', route)
      if (this.hub.isMinimized()) this.hub.restore()
      this.hub.show()
      this.hub.focus()
      return
    }
    const win = new BrowserWindow({
      width: 1120,
      height: 760,
      minWidth: 880,
      minHeight: 600,
      show: false,
      title: 'Purr',
      backgroundColor: surface(),
      ...chrome(),
      webPreferences: { preload, sandbox: false }
    })
    externalLinks(win)
    win.on('close', (e) => {
      if (!this.quitting) {
        e.preventDefault()
        win.hide()
      }
    })
    win.once('ready-to-show', () => win.show())
    load(win, 'hub', route ? `/${route}` : '')
    this.hub = win
  }

  toggleScratchpad(): void {
    const w = this.scratch
    if (w && !w.isDestroyed()) {
      if (w.isVisible() && w.isFocused()) w.hide()
      else {
        w.show()
        w.focus()
      }
      return
    }
    const win = new BrowserWindow({
      width: 560,
      height: 660,
      minWidth: 420,
      minHeight: 420,
      show: false,
      title: 'Scratchpad',
      backgroundColor: surface(),
      ...chrome(),
      webPreferences: { preload, sandbox: false }
    })
    externalLinks(win)
    win.on('close', (e) => {
      if (!this.quitting) {
        e.preventDefault()
        win.hide()
      }
    })
    win.once('ready-to-show', () => {
      win.show()
      win.focus()
    })
    load(win, 'hub', '/scratchpad')
    this.scratch = win
  }

  broadcast(channel: string, ...args: unknown[]): void {
    for (const w of [this.hub, this.scratch]) if (w && !w.isDestroyed()) w.webContents.send(channel, ...args)
  }
}

/** Dev-only: PURR_FAKE_MIC=<16 kHz mono wav> replays a file instead of the microphone (for automated tests). */
function fakeMic(): Float32Array | null {
  const file = process.env.PURR_FAKE_MIC
  if (!file || app.isPackaged) return null
  return decodeWav(new Uint8Array(fs.readFileSync(file)))
}

const BAR_W = 620
const BAR_H = 360

/** The floating Flow Bar. Also hosts the microphone recorder (it's always loaded). */
export class FlowBar extends EventEmitter<{ click: []; stop: []; cancel: []; menu: []; action: [string, string | undefined]; ready: [] }> implements Bar {
  win: BrowserWindow
  private reqId = 0
  private pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>()
  private lastDisplay = -1
  private ready = false
  private queue: [string, unknown[]][] = []

  constructor() {
    super()
    this.win = new BrowserWindow({
      width: BAR_W,
      height: BAR_H,
      show: false,
      frame: false,
      transparent: true,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      hasShadow: false,
      focusable: false,
      alwaysOnTop: true,
      backgroundColor: '#00000000',
      ...(isMac ? { type: 'panel' as const } : {}),
      webPreferences: { preload, sandbox: false, backgroundThrottling: false }
    })
    this.win.setAlwaysOnTop(true, 'screen-saver')
    if (isMac) this.win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
    this.win.setIgnoreMouseEvents(true, { forward: true })
    this.win.webContents.on('did-finish-load', () => {
      this.ready = true
      for (const [c, a] of this.queue) this.win.webContents.send(c, ...a)
      this.queue = []
      this.emit('ready')
    })
    this.win.webContents.on('render-process-gone', () => {
      this.ready = false
      for (const p of this.pending.values()) p.reject(new Error('Recorder crashed'))
      this.pending.clear()
      load(this.win, 'flowbar')
    })
    load(this.win, 'flowbar')
    this.reposition()
    this.win.showInactive()

    ipcMain.on('bar:interactive', (e, on: boolean) => {
      if (e.sender === this.win.webContents) this.win.setIgnoreMouseEvents(!on, { forward: true })
    })
    ipcMain.on('bar:event', (e, type: string, a?: string, b?: string) => {
      if (e.sender !== this.win.webContents) return
      if (type === 'click') this.emit('click')
      else if (type === 'stop') this.emit('stop')
      else if (type === 'cancel') this.emit('cancel')
      else if (type === 'menu') this.emit('menu')
      else if (type === 'action' && a) this.emit('action', a, b)
    })
    ipcMain.on('rec:result', (e, id: number, ok: boolean, payload: unknown) => {
      if (e.sender !== this.win.webContents) return
      const p = this.pending.get(id)
      if (!p) return
      this.pending.delete(id)
      if (ok) p.resolve(payload)
      else p.reject(new Error(String(payload)))
    })
    // Follow the display the cursor is on.
    setInterval(() => this.reposition(), 1500).unref()
    screen.on('display-metrics-changed', () => this.reposition(true))
  }

  private send(channel: string, ...args: unknown[]): void {
    if (this.win.isDestroyed()) return
    if (!this.ready) this.queue.push([channel, args])
    else this.win.webContents.send(channel, ...args)
  }

  reposition(force = false): void {
    if (this.win.isDestroyed()) return
    const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
    if (!force && display.id === this.lastDisplay) return
    this.lastDisplay = display.id
    const wa = display.workArea
    this.win.setBounds({ x: Math.round(wa.x + (wa.width - BAR_W) / 2), y: Math.round(wa.y + wa.height - BAR_H - (isMac ? 6 : 4)), width: BAR_W, height: BAR_H })
    if (!this.win.isVisible()) this.win.showInactive()
  }

  private request<T>(channel: string, payload: unknown, timeoutMs = 8000): Promise<T> {
    const id = ++this.reqId
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.pending.delete(id)) reject(new Error('The recorder did not respond.'))
      }, timeoutMs)
      this.pending.set(id, {
        resolve: (v) => {
          clearTimeout(timer)
          resolve(v as T)
        },
        reject: (e) => {
          clearTimeout(timer)
          reject(e)
        }
      })
      this.send(channel, id, payload)
    })
  }

  setView(v: BarView): void {
    this.send('bar:view', v)
  }
  toast(t: Toast): void {
    this.send('bar:toast', t)
  }
  card(c: { id: string; title: string; text: string; actions: { id: string; label: string }[] } | null): void {
    this.send('bar:card', c)
  }
  diff(d: TransformDiff | null): void {
    this.send('bar:diff', d)
  }
  sound(name: string): void {
    this.send('bar:sound', name)
  }
  startRecording(deviceId: string, keepWarm: boolean): Promise<void> {
    if (fakeMic()) return Promise.resolve()
    return this.request('rec:start', { deviceId, keepWarm })
  }
  async stopRecording(): Promise<Float32Array> {
    const fake = fakeMic()
    if (fake) return fake
    const data = await this.request<ArrayBuffer | Float32Array>('rec:stop', {}, 15_000)
    return data instanceof Float32Array ? data : new Float32Array(data)
  }
  abortRecording(): void {
    this.send('rec:abort', 0, {})
  }
}
