import { useCallback, useEffect, useState } from 'react'
import type { StatsSummary } from '../../shared/stats'
import type { EngineStatus, HistoryItem, Library, ModelInfo, PermissionStatus, Settings } from '../../shared/types'

export const purr = window.purr
export const isMac = purr.platform === 'darwin'

export function invoke<T = unknown>(channel: string, ...args: unknown[]): Promise<T> {
  return purr.invoke<T>(channel, ...args)
}

/** Load from main, and reload whenever main says it changed. */
function useLive<T>(load: () => Promise<T>, events: string[], deps: unknown[] = []): [T | null, () => void] {
  const [value, setValue] = useState<T | null>(null)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const reload = useCallback(() => void load().then(setValue), deps)
  useEffect(() => {
    reload()
    const offs = events.map((e) => purr.on(e, reload))
    return () => offs.forEach((off) => off())
  }, [reload])
  return [value, reload]
}

export function useSettings(): [Settings | null, (patch: Partial<Settings>) => Promise<void>] {
  const [s] = useLive(() => invoke<Settings>('settings:get'), ['settings'])
  const update = useCallback(async (patch: Partial<Settings>) => {
    await invoke('settings:set', patch)
  }, [])
  return [s, update]
}

export const useLibrary = (): Library | null => useLive(() => invoke<Library>('library:get'), ['library'])[0]
export const useHistory = (query: string, limit = 300): HistoryItem[] | null =>
  useLive(() => invoke<HistoryItem[]>('history:get', limit, query), ['history'], [query, limit])[0]
export const useStats = (): StatsSummary | null => useLive(() => invoke<StatsSummary>('stats:get'), ['stats'])[0]
export const useModels = (kind: 'stt' | 'llm'): ModelInfo[] | null => useLive(() => invoke<ModelInfo[]>('models:list', kind), ['models'], [kind])[0]
export const useKeys = (): Record<string, boolean> | null => useLive(() => invoke<Record<string, boolean>>('keys:status'), ['keys'])[0]
export const useEngineStatus = (): EngineStatus | null =>
  useLive(() => invoke<EngineStatus>('engine:status'), ['settings', 'keys', 'models'])[0]
export function usePermissions(): [PermissionStatus | null, () => void] {
  return useLive(() => invoke<PermissionStatus>('perm:status'), ['settings'])
}

export function chordText(chord: string[] | undefined): string[] {
  if (!chord?.length) return []
  const mac: Record<string, string> = { Meta: '⌘', MetaRight: 'Right ⌘', Ctrl: '⌃', CtrlRight: 'Right ⌃', Alt: '⌥', AltRight: 'Right ⌥', Shift: '⇧', ShiftRight: 'Right ⇧', Fn: 'fn', Escape: 'esc' }
  const win: Record<string, string> = { Meta: 'Win', MetaRight: 'Right Win', CtrlRight: 'Right Ctrl', AltRight: 'Right Alt', ShiftRight: 'Right Shift', Escape: 'Esc' }
  const names = isMac ? mac : win
  return chord.map((k) => names[k] ?? k.replace(/^Mouse(\d)$/, 'Mouse $1').replace(/^Arrow/, ''))
}

export function timeAgo(t: number): string {
  const s = Math.round((Date.now() - t) / 1000)
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)} min ago`
  return new Date(t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}

export function dayLabel(t: number): string {
  const d = new Date(t)
  const today = new Date()
  const y = new Date()
  y.setDate(y.getDate() - 1)
  if (d.toDateString() === today.toDateString()) return 'Today'
  if (d.toDateString() === y.toDateString()) return 'Yesterday'
  return d.toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' })
}

export function fmt(n: number): string {
  return n.toLocaleString()
}
