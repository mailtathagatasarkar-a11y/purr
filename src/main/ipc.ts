import { app, dialog, ipcMain, shell } from 'electron'
import fs from 'fs'
import path from 'path'
import { summarize } from '../shared/stats'
import type { AppCategory, Chord, DictionaryEntry, HistoryItem, LlmProvider, Note, Settings, Snippet, SttProvider, Transform } from '../shared/types'
import type { Controller } from './controller'
import type { HotkeyEngine } from './hotkeys'
import { llmAvailable, llmModel, type LanguageModel } from './llm'
import type { ModelManager } from './models'
import { permissionStatus, requestPermission } from './permissions'
import { testLlm, testStt } from './providerTest'
import type { Store } from './store'
import { sttModel } from './stt'
import type { FolderSync } from './sync'
import type { HubWindows } from './windows'

export interface IpcDeps {
  store: Store
  controller: Controller
  engine: HotkeyEngine
  models: ModelManager
  llm: LanguageModel
  windows: HubWindows
  sync: FolderSync
  keyboardOk: () => boolean
  helperOk: () => boolean
  setBindingsPaused: (paused: boolean) => void
}

export function registerIpc(d: IpcDeps): void {
  const { store } = d
  const h = <A extends unknown[], R>(channel: string, fn: (...args: A) => R): void => {
    ipcMain.handle(channel, (_e, ...args) => fn(...(args as A)))
  }

  // Push changes to every open window.
  store.on('settings', (s) => d.windows.broadcast('settings', s))
  store.on('library', (l) => d.windows.broadcast('library', l))
  store.on('history', () => d.windows.broadcast('history'))
  store.on('stats', () => d.windows.broadcast('stats'))
  store.on('keys', () => d.windows.broadcast('keys', store.keyStatus()))
  d.models.on('change', () => d.windows.broadcast('models'))

  h('app:info', () => ({ version: app.getVersion(), platform: process.platform, userData: store.dir }))
  h('app:openExternal', (url: string) => (/^(https?|mailto|x-apple|ms-settings):/.test(url) ? shell.openExternal(url) : undefined))
  h('app:openDataFolder', () => shell.openPath(store.dir))
  h('app:mcpConfig', () => ({
    mcpServers: {
      purr: { command: process.execPath, args: [path.join(__dirname, 'mcp.js').replace(`app.asar${path.sep}`, `app.asar.unpacked${path.sep}`)], env: { ELECTRON_RUN_AS_NODE: '1' } }
    }
  }))

  h('settings:get', () => store.settings)
  h('settings:set', (patch: Partial<Settings>) => {
    const s = store.updateSettings(patch)
    if (patch.launchAtLogin !== undefined && app.isPackaged) app.setLoginItemSettings({ openAtLogin: s.launchAtLogin, args: ['--hidden'] })
    return s
  })

  h('keys:status', () => store.keyStatus())
  h('keys:set', (provider: string, key: string) => store.setKey(provider, key.trim()))
  h('keys:testStt', (provider: SttProvider) => testStt(store.settings, provider, store.getKey(provider)))
  h('keys:testLlm', (provider: LlmProvider) => testLlm(store.settings, provider, d.llm))

  h('engine:status', () => {
    const s = store.settings
    const problems: string[] = []
    const sttReady = s.stt.provider === 'local' ? d.models.sttInstalled(sttModel(s)) : !!store.getKey(s.stt.provider) || s.stt.provider === 'custom'
    if (!sttReady) problems.push(s.stt.provider === 'local' ? 'Download a speech model to start dictating.' : 'Add an API key for speech-to-text.')
    const llmReady = llmAvailable(s, d.models, (p) => store.getKey(p))
    if (!llmReady && s.llm.provider !== 'off') problems.push(s.llm.provider === 'local' ? 'Download a local AI model for smart clean-up.' : 'Add an API key for AI clean-up.')
    if (!d.keyboardOk()) problems.push('Purr cannot see the keyboard. Grant Accessibility / Input Monitoring permission.')
    return { sttReady, llmReady, sttLabel: `${s.stt.provider} · ${sttModel(s)}`, llmLabel: `${s.llm.provider} · ${llmModel(s)}`, problems }
  })

  h('library:get', () => store.library)
  h('dict:save', (e: Partial<DictionaryEntry>) => store.saveWord(e))
  h('dict:delete', (id: string) => store.deleteItem('dictionary', id))
  h('snip:save', (s: Partial<Snippet>) => store.saveSnippet(s))
  h('snip:delete', (id: string) => store.deleteItem('snippets', id))
  h('tf:save', (t: Partial<Transform>) => store.saveTransform(t))
  h('tf:delete', (id: string) => {
    store.deleteItem('transforms', id)
    store.updateSettings({ hotkeys: { [`transform:${id}`]: [] } })
  })
  h('note:save', (n: Partial<Note>) => store.saveNote(n))
  h('note:delete', (id: string) => store.deleteItem('notes', id))

  h('history:get', (limit: number = 200, query: string = '') => {
    const q = String(query).toLowerCase()
    const list = q ? store.history.filter((x) => x.text.toLowerCase().includes(q) || x.raw.toLowerCase().includes(q) || x.app.toLowerCase().includes(q)) : store.history
    return list.slice(0, limit)
  })
  h('history:update', (id: string, patch: Partial<HistoryItem>) => store.updateHistory(id, patch))
  h('history:edit', (id: string, text: string) => d.controller.learnFromEdit(id, text))
  h('history:delete', (id: string) => store.deleteHistory(id))
  h('history:clear', () => store.clearHistory())
  h('history:retry', (id: string) => d.controller.retry(id))

  h('stats:get', () => summarize(store.stats))

  h('models:list', (kind: 'stt' | 'llm') => d.models.list(kind))
  h('models:download', async (kind: 'stt' | 'llm', id: string) => {
    await d.models.download(kind, id)
    return true
  })
  h('models:cancel', (kind: 'stt' | 'llm', id: string) => d.models.cancel(kind, id))
  h('models:remove', (kind: 'stt' | 'llm', id: string) => d.models.remove(kind, id))

  h('hotkeys:record', async (): Promise<Chord> => {
    d.setBindingsPaused(true)
    try {
      return await d.engine.record()
    } finally {
      d.setBindingsPaused(false)
    }
  })
  h('hotkeys:cancelRecord', () => d.engine.cancelRecord())

  h('perm:status', () => permissionStatus(d.keyboardOk(), d.helperOk()))
  h('perm:request', (kind: 'microphone' | 'accessibility' | 'input') => requestPermission(kind))

  h('dictate:toggle', () => d.controller.toggleDictation())
  h('file:transcribe', (samples: Float32Array, name: string) => d.controller.transcribeFile(samples, name))
  h('text:process', (raw: string, category: AppCategory = 'other') => {
    const kind = category === 'email' ? 'email' : category === 'other' ? 'docs' : 'chat'
    return d.controller.process(raw, { exe: '', appName: 'Purr preview', title: '', category, kind, fileTagging: false, pasteWith: 'paste' })
  })

  h('sync:choose', async () => {
    const r = await dialog.showOpenDialog({ title: 'Choose a synced folder (iCloud Drive, OneDrive, Dropbox…)', properties: ['openDirectory', 'createDirectory'] })
    if (r.canceled || !r.filePaths[0]) return store.settings
    return store.updateSettings({ syncFolder: r.filePaths[0] })
  })
  h('sync:status', () => ({ folder: store.settings.syncFolder, lastSync: d.sync.lastSync, error: d.sync.lastError }))
  h('sync:now', () => {
    d.sync.pull()
    d.sync.push()
    return { folder: store.settings.syncFolder, lastSync: d.sync.lastSync, error: d.sync.lastError }
  })

  h('data:export', async () => {
    const r = await dialog.showSaveDialog({ title: 'Export Purr data', defaultPath: 'purr-export.json' })
    if (r.canceled || !r.filePath) return false
    fs.writeFileSync(r.filePath, JSON.stringify({ exportedAt: new Date().toISOString(), library: store.library, history: store.history, stats: store.stats }, null, 1))
    return true
  })
  h('data:import', async () => {
    const r = await dialog.showOpenDialog({ title: 'Import dictionary, snippets and notes', filters: [{ name: 'JSON', extensions: ['json'] }], properties: ['openFile'] })
    if (r.canceled || !r.filePaths[0]) return false
    const data = JSON.parse(fs.readFileSync(r.filePaths[0], 'utf8')) as { library?: Partial<typeof store.library> }
    const { mergeLibraries } = await import('./sync')
    if (data.library) store.replaceLibrary(mergeLibraries(store.library, data.library))
    return true
  })
}
