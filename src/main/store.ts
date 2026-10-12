import { app, safeStorage } from 'electron'
import { EventEmitter } from 'events'
import fs from 'fs'
import path from 'path'
import { randomUUID } from 'crypto'
import { defaultSettings, defaultTransforms } from '../shared/defaults'
import type { DayStats, DictionaryEntry, HistoryItem, Library, Note, Settings, Snippet, Stats, Transform } from '../shared/types'

/** JSON file with debounced atomic writes. */
class JsonFile<T> {
  data: T
  private timer: NodeJS.Timeout | null = null
  constructor(
    private file: string,
    fallback: () => T,
    migrate: (loaded: T) => T = (x) => x
  ) {
    this.data = fallback()
    try {
      if (fs.existsSync(file)) this.data = migrate(JSON.parse(fs.readFileSync(file, 'utf8')) as T)
    } catch (err) {
      console.error(`[store] could not read ${file}, keeping a backup`, err)
      try {
        fs.copyFileSync(file, `${file}.broken-${Date.now()}`)
      } catch {
        // ignore
      }
    }
  }
  save(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => this.flush(), 400)
  }
  flush(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    const tmp = `${this.file}.tmp`
    try {
      fs.writeFileSync(tmp, JSON.stringify(this.data, null, 1))
      fs.renameSync(tmp, this.file)
    } catch (err) {
      // Antivirus or the indexer can lock the file for a moment on Windows: try again shortly.
      console.warn(`[store] could not save ${this.file}, retrying`, err)
      this.timer = setTimeout(() => this.flush(), 2000)
    }
  }
}

function deepMerge<T>(base: T, over: unknown): T {
  if (typeof base !== 'object' || base === null || Array.isArray(base)) return (over === undefined ? base : (over as T))
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) }
  if (over && typeof over === 'object') {
    for (const [k, v] of Object.entries(over as Record<string, unknown>)) {
      const b = (base as Record<string, unknown>)[k]
      out[k] = b && typeof b === 'object' && !Array.isArray(b) && v && typeof v === 'object' && !Array.isArray(v) ? deepMerge(b, v) : v
    }
  }
  return out as T
}

export function dayKey(t: number): string {
  const d = new Date(t)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

const emptyDay = (): DayStats => ({ words: 0, sessions: 0, fixes: 0, speechMs: 0, apps: {}, categories: {} })

export class Store extends EventEmitter {
  readonly dir = app.getPath('userData')
  readonly audioDir = path.join(this.dir, 'audio')
  readonly modelsDir = path.join(this.dir, 'models')
  private settingsFile: JsonFile<Settings>
  private libraryFile: JsonFile<Library>
  private historyFile: JsonFile<HistoryItem[]>
  private statsFile: JsonFile<Stats>
  private secretsFile: JsonFile<Record<string, string>>

  constructor(platform: string, hasFnKey: boolean) {
    super()
    fs.mkdirSync(this.audioDir, { recursive: true })
    fs.mkdirSync(this.modelsDir, { recursive: true })
    const defaults = defaultSettings(platform, hasFnKey)
    this.settingsFile = new JsonFile(path.join(this.dir, 'settings.json'), () => defaults, (s) => {
      const merged = deepMerge(defaults, s)
      merged.hotkeys = { ...defaults.hotkeys, ...(s.hotkeys ?? {}) }
      return merged
    })
    this.libraryFile = new JsonFile<Library>(
      path.join(this.dir, 'library.json'),
      () => ({ dictionary: [], snippets: [], transforms: defaultTransforms(Date.now()), notes: [] }),
      (l) => ({
        dictionary: l.dictionary ?? [],
        snippets: l.snippets ?? [],
        transforms: l.transforms?.length ? l.transforms : defaultTransforms(Date.now()),
        notes: l.notes ?? []
      })
    )
    this.historyFile = new JsonFile<HistoryItem[]>(path.join(this.dir, 'history.json'), () => [])
    this.statsFile = new JsonFile<Stats>(path.join(this.dir, 'stats.json'), () => ({ daily: {}, totalWords: 0, totalFixes: 0, totalSessions: 0, recent: [] }))
    this.secretsFile = new JsonFile<Record<string, string>>(path.join(this.dir, 'keys.json'), () => ({}))
    this.pruneAudio()
  }

  flush(): void {
    for (const f of [this.settingsFile, this.libraryFile, this.historyFile, this.statsFile, this.secretsFile]) f.flush()
  }

  // ---------- settings ----------
  get settings(): Settings {
    return this.settingsFile.data
  }
  updateSettings(patch: Partial<Settings>): Settings {
    this.settingsFile.data = deepMerge(this.settingsFile.data, patch)
    if (patch.hotkeys) this.settingsFile.data.hotkeys = { ...this.settingsFile.data.hotkeys, ...patch.hotkeys }
    if (patch.languages) this.settingsFile.data.languages = patch.languages
    this.settingsFile.save()
    this.emit('settings', this.settingsFile.data)
    return this.settingsFile.data
  }

  // ---------- secrets (encrypted with the OS keychain / DPAPI) ----------
  getKey(provider: string): string {
    const v = this.secretsFile.data[provider]
    if (!v) return ''
    try {
      if (v.startsWith('enc:')) return safeStorage.decryptString(Buffer.from(v.slice(4), 'base64'))
      return v.startsWith('raw:') ? v.slice(4) : ''
    } catch {
      return ''
    }
  }
  setKey(provider: string, key: string): void {
    if (!key) delete this.secretsFile.data[provider]
    else if (safeStorage.isEncryptionAvailable()) this.secretsFile.data[provider] = 'enc:' + safeStorage.encryptString(key).toString('base64')
    else this.secretsFile.data[provider] = 'raw:' + key
    this.secretsFile.save()
    this.emit('keys')
  }
  keyStatus(): Record<string, boolean> {
    return Object.fromEntries(Object.keys(this.secretsFile.data).map((k) => [k, !!this.getKey(k)]))
  }

  // ---------- library ----------
  get library(): Library {
    return this.libraryFile.data
  }
  replaceLibrary(lib: Library): void {
    this.libraryFile.data = lib
    this.libraryFile.save()
    this.emit('library', lib)
  }
  private touchLibrary(): void {
    this.libraryFile.save()
    this.emit('library', this.libraryFile.data)
  }
  private upsert<T extends { id: string; createdAt: number; updatedAt: number }>(list: T[], item: Partial<T> & { id?: string }): T {
    const now = Date.now()
    const existing = item.id ? list.find((x) => x.id === item.id) : undefined
    if (existing) {
      Object.assign(existing, item, { updatedAt: now })
      return existing
    }
    const created = { ...item, id: item.id ?? randomUUID(), createdAt: now, updatedAt: now } as T
    list.unshift(created)
    return created
  }
  saveWord(entry: Partial<DictionaryEntry>): DictionaryEntry {
    const word = (entry.word ?? '').trim().slice(0, 60)
    const misspelling = entry.misspelling?.trim().slice(0, 60) || undefined
    const dupe = this.library.dictionary.find(
      (d) => !d.deleted && d.id !== entry.id && d.word === word && (d.misspelling ?? '') === (misspelling ?? '')
    )
    if (dupe) return dupe
    const saved = this.upsert(this.library.dictionary, { ...entry, word, misspelling, deleted: false })
    this.touchLibrary()
    return saved
  }
  saveSnippet(s: Partial<Snippet>): Snippet {
    const saved = this.upsert(this.library.snippets, {
      ...s,
      trigger: (s.trigger ?? '').trim().slice(0, 60),
      expansion: (s.expansion ?? '').slice(0, 4000),
      deleted: false
    })
    this.touchLibrary()
    return saved
  }
  saveTransform(t: Partial<Transform>): Transform {
    const saved = this.upsert(this.library.transforms, { ...t, deleted: false })
    this.touchLibrary()
    return saved
  }
  saveNote(n: Partial<Note>): Note {
    const existing = n.id ? this.library.notes.find((x) => x.id === n.id) : undefined
    if (existing && (n.body !== undefined || n.title !== undefined)) {
      const last = existing.versions[0]
      // Snapshot at most once a minute so history stays useful.
      if (!last || Date.now() - last.at > 60_000) {
        existing.versions.unshift({ at: Date.now(), title: existing.title, body: existing.body })
        existing.versions = existing.versions.slice(0, 50)
      }
    }
    const saved = this.upsert(this.library.notes, { pinned: false, versions: [], title: '', body: '', ...n, deleted: false })
    this.touchLibrary()
    return saved
  }
  deleteItem(kind: 'dictionary' | 'snippets' | 'transforms' | 'notes', id: string): void {
    const list = this.library[kind] as { id: string; deleted?: boolean; updatedAt: number }[]
    const item = list.find((x) => x.id === id)
    if (!item) return
    // Tombstone so the deletion syncs to other devices.
    item.deleted = true
    item.updatedAt = Date.now()
    if (kind === 'notes') Object.assign(item, { body: '', title: '', versions: [] })
    this.touchLibrary()
  }

  // ---------- history ----------
  get history(): HistoryItem[] {
    return this.historyFile.data
  }
  addHistory(item: HistoryItem): void {
    if (!this.settings.privacy.saveHistory) return
    this.historyFile.data.unshift(item)
    if (this.historyFile.data.length > 5000) {
      for (const old of this.historyFile.data.splice(5000)) this.deleteAudio(old.audioFile)
    }
    this.historyFile.save()
    this.emit('history', this.historyFile.data)
  }
  updateHistory(id: string, patch: Partial<HistoryItem>): HistoryItem | undefined {
    const item = this.historyFile.data.find((h) => h.id === id)
    if (!item) return undefined
    Object.assign(item, patch)
    this.historyFile.save()
    this.emit('history', this.historyFile.data)
    return item
  }
  deleteHistory(id: string): void {
    const i = this.historyFile.data.findIndex((h) => h.id === id)
    if (i < 0) return
    this.deleteAudio(this.historyFile.data[i].audioFile)
    this.historyFile.data.splice(i, 1)
    this.historyFile.save()
    this.emit('history', this.historyFile.data)
  }
  clearHistory(): void {
    for (const h of this.historyFile.data) this.deleteAudio(h.audioFile)
    this.historyFile.data = []
    this.historyFile.save()
    this.emit('history', [])
  }
  private deleteAudio(file?: string): void {
    if (!file) return
    fs.rm(path.join(this.audioDir, path.basename(file)), { force: true }, () => undefined)
  }
  pruneAudio(): void {
    const days = this.settings.privacy.audioRetentionDays
    const cutoff = Date.now() - days * 86_400_000
    let changed = false
    for (const h of this.historyFile.data) {
      if (h.audioFile && (h.at < cutoff || !this.settings.privacy.saveAudio)) {
        this.deleteAudio(h.audioFile)
        h.audioFile = undefined
        changed = true
      }
    }
    if (changed) this.historyFile.save()
  }

  // ---------- stats ----------
  get stats(): Stats {
    return this.statsFile.data
  }
  recordStats(item: HistoryItem, speechMs: number): void {
    const s = this.statsFile.data
    const key = dayKey(item.at)
    const day = (s.daily[key] ??= emptyDay())
    day.words += item.words
    day.sessions += 1
    day.fixes += item.fixes
    day.speechMs += speechMs
    day.apps[item.app] = (day.apps[item.app] ?? 0) + item.words
    day.categories[item.category] = (day.categories[item.category] ?? 0) + item.words
    s.totalWords += item.words
    s.totalFixes += item.fixes
    s.totalSessions += 1
    if (item.mode === 'dictation' && item.words > 0 && item.durationMs < 400_000) {
      s.recent.unshift({ words: countRaw(item.raw), ms: speechMs || item.durationMs })
      s.recent = s.recent.slice(0, 100)
    }
    this.statsFile.save()
    this.emit('stats', s)
  }
}

function countRaw(text: string): number {
  const m = text.trim().match(/[\p{L}\p{N}][\p{L}\p{N}'’_-]*/gu)
  return m ? m.length : 0
}
