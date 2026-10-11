import { app, Menu, powerMonitor, session } from 'electron'
import { Controller } from './controller'
import { EngineClient } from './engineClient'
import { Gestures } from './gestures'
import { HotkeyEngine } from './hotkeys'
import { setModifierProbe } from './insert'
import { registerIpc } from './ipc'
import { LanguageModel } from './llm'
import { ModelManager } from './models'
import { getAppContext, useHelperForContext } from './native/context'
import { Helper, helperPath } from './native/helper'
import { KeySource } from './native/keys'
import { Store } from './store'
import { SpeechToText } from './stt'
import { FolderSync } from './sync'
import { createTray } from './tray'
import { FlowBar, HubWindows } from './windows'

if (!app.requestSingleInstanceLock()) app.quit()

app.setAppUserModelId('com.purr.app')
// Keep the recorder and timers running at full speed while hidden.
app.commandLine.appendSwitch('disable-background-timer-throttling')
app.commandLine.appendSwitch('disable-renderer-backgrounding')

async function main(): Promise<void> {
  await app.whenReady()
  Menu.setApplicationMenu(process.platform === 'darwin' ? Menu.buildFromTemplate([{ role: 'appMenu' }, { role: 'editMenu' }, { role: 'windowMenu' }]) : null)

  // Microphone access for our own pages only.
  session.defaultSession.setPermissionRequestHandler((_wc, permission, cb) => cb(permission === 'media' || permission === 'clipboard-sanitized-write'))

  // Native helper (Fn key on macOS, key swallowing + field reading on Windows) if it was built.
  const hp = helperPath()
  const helper = hp ? new Helper(hp) : null
  const helperStarted = helper?.start() ?? false
  useHelperForContext(helperStarted ? helper : null)
  const hasFnKey = process.platform === 'darwin' && helperStarted

  const store = new Store(process.platform, hasFnKey)
  const models = new ModelManager(store.modelsDir)
  const engineProc = new EngineClient()
  const getKey = (p: string): string => store.getKey(p)
  const stt = new SpeechToText(engineProc, models, getKey)
  const llm = new LanguageModel(engineProc, models, getKey)

  // ---------- keyboard ----------
  const engine = new HotkeyEngine()
  engine.setBindings(store.settings.hotkeys)
  setModifierProbe(() => engine.modifiersDown())
  const keys = new KeySource()
  let keyboardOk = false
  keys.on('error', (err) => console.error('[keys] hook failed', err))
  // Both sources feed one engine. The helper owns the keyboard when it can (it can
  // swallow shortcut keys); uiohook is the fallback and also covers mouse buttons.
  helper?.on('key', (down, name) => (down ? engine.down(name) : engine.up(name)))
  keys.on('down', (k) => {
    if (!helper?.ownsKeyboard) engine.down(k)
  })
  keys.on('up', (k) => {
    if (!helper?.ownsKeyboard) engine.up(k)
  })
  keyboardOk = keys.start() || !!helper?.ownsKeyboard
  const pushChordsToHelper = (): void => {
    const chords = Object.values(store.settings.hotkeys)
      .flat()
      .map((c) => c.join('+'))
      .join('|')
    helper?.send('chords', chords)
  }
  pushChordsToHelper()

  // ---------- windows ----------
  const windows = new HubWindows()
  const bar = new FlowBar()
  let controller: Controller
  const gestures = new Gestures(engine, () => controller.canStart())
  controller = new Controller({
    store,
    stt,
    llm,
    models,
    gestures,
    bar,
    getContext: getAppContext,
    openScratchpad: () => windows.toggleScratchpad(),
    openHub: (route) => windows.openHub(route),
    setEscSwallow: (on) => helper?.send('esc', on ? '1' : '0'),
    readFocusedText: helper
      ? async () => {
          const r = await helper.request<{ value?: string }>('focused', '', 800)
          return r?.value ?? null
        }
      : undefined
  })
  bar.on('ready', () => controller.refreshBar())
  bar.on('click', () => controller.barClicked())
  bar.on('stop', () => controller.barStop())
  bar.on('cancel', () => controller.barCancel())
  bar.on('menu', () =>
    Menu.buildFromTemplate([
      { label: 'Hide for 1 hour', click: () => store.updateSettings({ flowBarHiddenUntil: Date.now() + 3_600_000 }) },
      { label: 'Paste last transcript', click: () => void controller.pasteLast() },
      { label: 'Scratchpad', click: () => windows.toggleScratchpad() },
      { type: 'separator' },
      { label: 'Open Purr', click: () => windows.openHub() },
      { label: 'Settings…', click: () => windows.openHub('settings') }
    ]).popup({ window: bar.win })
  )
  bar.on('action', (id, text) => void controller.barAction(id, text))

  const sync = new FolderSync(store)
  sync.restart()

  registerIpc({
    store,
    controller,
    engine,
    models,
    llm,
    windows,
    sync,
    keyboardOk: () => keyboardOk || !!helper?.ownsKeyboard,
    helperOk: () => !!helper?.running,
    setBindingsPaused: (p) => {
      engine.enabled = !p
      helper?.send('pause', p ? '1' : '0')
    }
  })

  const { refresh: refreshTray } = createTray({
    openHub: (r) => windows.openHub(r),
    startDictation: () => controller.toggleDictation(),
    pasteLast: () => void controller.pasteLast(),
    scratchpad: () => windows.toggleScratchpad(),
    hideBarForHour: () => store.updateSettings({ flowBarHiddenUntil: Date.now() + 3_600_000 }),
    showBar: () => store.updateSettings({ flowBarHiddenUntil: 0, showFlowBar: true }),
    barHidden: () => !store.settings.showFlowBar || store.settings.flowBarHiddenUntil > Date.now(),
    quit: () => app.quit()
  })

  // Load local models as soon as they're downloaded or chosen.
  models.on('change', () => {
    void stt.warm(store.settings)
    void llm.warm(store.settings)
  })
  engineProc.onExit(() => stt.resetWarm())

  store.on('settings', (s) => {
    void stt.warm(s)
    void llm.warm(s)
    engine.setBindings(s.hotkeys)
    pushChordsToHelper()
    controller.refreshBar()
    refreshTray()
    if (process.platform === 'darwin') {
      if (s.showInDock) void app.dock?.show()
      else app.dock?.hide()
    }
  })

  // The 1-hour hide expires on its own.
  setInterval(() => {
    if (store.settings.flowBarHiddenUntil && store.settings.flowBarHiddenUntil < Date.now()) {
      store.updateSettings({ flowBarHiddenUntil: 0 })
      refreshTray()
    }
  }, 60_000).unref()

  if (process.platform === 'darwin' && !store.settings.showInDock) app.dock?.hide()
  if (app.isPackaged) app.setLoginItemSettings({ openAtLogin: store.settings.launchAtLogin, args: ['--hidden'] })

  const startHidden = process.argv.includes('--hidden') || app.getLoginItemSettings().wasOpenedAtLogin
  if (!startHidden || !store.settings.onboarded) windows.openHub(store.settings.onboarded ? '' : 'welcome')

  app.on('second-instance', () => windows.openHub())
  app.on('activate', () => windows.openHub())
  app.on('before-quit', () => {
    windows.quitting = true
    keys.stop()
    helper?.stop()
    engineProc.stop()
    store.flush()
  })
  app.on('window-all-closed', () => undefined) // stay in the tray
  // Hook can die across sleep on some systems; restart it.
  powerMonitor.on('resume', () => {
    engine.reset()
    keys.stop()
    keyboardOk = keys.start() || !!helper?.ownsKeyboard
  })
  // Free memory from old audio once a day.
  setInterval(() => store.pruneAudio(), 6 * 3_600_000).unref()

  // Dev-only: PURR_SNAP=<dir> saves screenshots of the windows (for UI review).
  if (!app.isPackaged && process.env.PURR_SNAP) void snapshots(process.env.PURR_SNAP, windows, bar)

  // Load local models in the background so the first dictation is fast.
  setTimeout(() => {
    void stt.warm(store.settings)
    void llm.warm(store.settings)
  }, 1500)
}

async function snapshots(dir: string, windows: HubWindows, bar: FlowBar): Promise<void> {
  const fs = await import('fs')
  const path = await import('path')
  const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))
  fs.mkdirSync(dir, { recursive: true })
  await wait(4000)
  const routes = (process.env.PURR_SNAP_ROUTES ?? '').split(',').filter(Boolean)
  for (const route of routes.length ? routes : ['']) {
    const r = route === 'home' ? '' : route
    if (windows.hub && !windows.hub.isDestroyed()) windows.hub.webContents.send('nav', r)
    else windows.openHub(r)
    await wait(1800)
    const hub = windows.hub
    if (hub && process.env.PURR_SNAP_PROBE)
      console.log('[probe]', await hub.webContents.executeJavaScript(process.env.PURR_SNAP_PROBE).catch((e: Error) => e.message))
    if (hub) fs.writeFileSync(path.join(dir, `hub-${route.replace(/\//g, '_') || 'home'}.png`), (await hub.webContents.capturePage()).toPNG())
  }
  const shots: [string, () => void][] = [
    ['bar-rest', () => bar.setView({ state: 'rest', mode: 'dictate', locked: false, hint: 'Click or hold Ctrl + Win to dictate', sounds: false, volume: 0 })],
    ['bar-recording', () => bar.setView({ state: 'recording', mode: 'dictate', locked: true, hint: '', sounds: false, volume: 0 })],
    ['bar-command', () => bar.setView({ state: 'recording', mode: 'command', locked: false, hint: '', sounds: false, volume: 0 })],
    [
      'bar-toast',
      () => {
        bar.setView({ state: 'processing', mode: 'transform', locked: false, label: 'Polish', hint: '', sounds: false, volume: 0 })
        bar.toast({ id: 'a', kind: 'success', text: 'Polish applied', actions: [{ id: 'diff', label: 'View diff' }, { id: 'undoTransform', label: 'Undo' }] })
        bar.diff({ name: 'Polish', before: 'so basically I think we should maybe move the launch to next week', after: 'I think we should move the launch to next week.', at: Date.now() })
      }
    ]
  ]
  for (const [name, show] of shots) {
    show()
    await wait(900)
    fs.writeFileSync(path.join(dir, `${name}.png`), (await bar.win.webContents.capturePage()).toPNG())
  }
  app.quit()
}

main().catch((err) => {
  console.error('[purr] failed to start', err)
  app.quit()
})
