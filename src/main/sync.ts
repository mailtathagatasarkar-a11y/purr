// Cross-device sync without a server: point Purr at a folder that iCloud Drive,
// OneDrive, Dropbox or Google Drive already syncs. A shared folder also works as a
// team dictionary / snippet library. Merge is last-write-wins per item.

import fs from 'fs'
import path from 'path'
import type { Library } from '../shared/types'
import type { Store } from './store'

const FILE = 'purr-library.json'

type Item = { id: string; updatedAt: number }

function mergeLists<T extends Item>(a: T[], b: T[]): T[] {
  const map = new Map<string, T>()
  for (const x of a) map.set(x.id, x)
  for (const y of b) {
    const x = map.get(y.id)
    if (!x || y.updatedAt > x.updatedAt) map.set(y.id, y)
  }
  return [...map.values()].sort((p, q) => q.updatedAt - p.updatedAt)
}

export function mergeLibraries(local: Library, remote: Partial<Library>): Library {
  return {
    dictionary: mergeLists(local.dictionary, remote.dictionary ?? []),
    snippets: mergeLists(local.snippets, remote.snippets ?? []),
    transforms: mergeLists(local.transforms, remote.transforms ?? []),
    notes: mergeLists(local.notes, remote.notes ?? [])
  }
}

export class FolderSync {
  private watcher: fs.FSWatcher | null = null
  private writing = false
  private timer: NodeJS.Timeout | null = null
  lastSync = 0
  lastError = ''

  constructor(private store: Store) {
    store.on('library', () => this.schedulePush())
    store.on('settings', () => this.restart())
  }

  private get file(): string | null {
    const dir = this.store.settings.syncFolder
    return dir ? path.join(dir, FILE) : null
  }

  restart(): void {
    const file = this.file
    if (this.watcher && (this.watcher as fs.FSWatcher & { purrFile?: string }).purrFile === file) return
    this.watcher?.close()
    this.watcher = null
    if (!file) return
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true })
      this.pull()
      this.push()
      const w = fs.watch(path.dirname(file), (_e, name) => {
        if (name === FILE && !this.writing) setTimeout(() => this.pull(), 300)
      }) as fs.FSWatcher & { purrFile?: string }
      w.purrFile = file
      this.watcher = w
    } catch (err) {
      this.lastError = (err as Error).message
    }
  }

  pull(): void {
    const file = this.file
    if (!file || !fs.existsSync(file)) return
    try {
      const remote = JSON.parse(fs.readFileSync(file, 'utf8')) as Partial<Library>
      const merged = mergeLibraries(this.store.library, remote)
      if (JSON.stringify(merged) !== JSON.stringify(this.store.library)) this.store.replaceLibrary(merged)
      this.lastSync = Date.now()
      this.lastError = ''
    } catch (err) {
      this.lastError = `Could not read the sync file: ${(err as Error).message}`
    }
  }

  private schedulePush(): void {
    if (!this.file) return
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => this.push(), 1500)
  }

  push(): void {
    const file = this.file
    if (!file) return
    try {
      let remote: Partial<Library> = {}
      if (fs.existsSync(file)) remote = JSON.parse(fs.readFileSync(file, 'utf8')) as Partial<Library>
      const merged = mergeLibraries(this.store.library, remote)
      this.writing = true
      fs.writeFileSync(`${file}.tmp`, JSON.stringify(merged, null, 1))
      fs.renameSync(`${file}.tmp`, file)
      this.lastSync = Date.now()
      this.lastError = ''
    } catch (err) {
      this.lastError = (err as Error).message
    } finally {
      setTimeout(() => (this.writing = false), 500)
    }
  }
}
