import type { Stats } from './types'

export interface StatsSummary {
  wpm: number
  totalWords: number
  totalFixes: number
  totalSessions: number
  weekWords: number
  monthWords: number
  monthChangePct: number | null
  streak: number
  longestStreak: number
  minutesSaved: number
  appsUsed: number
  topApps: { name: string; words: number }[]
  categories: { id: string; words: number }[]
  heatmap: { date: string; words: number }[] // oldest first, 52 weeks
}

function key(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

const TYPING_WPM = 40

export function summarize(s: Stats, now = new Date()): StatsSummary {
  const words = (k: string): number => s.daily[k]?.words ?? 0
  const recentWords = s.recent.reduce((a, r) => a + r.words, 0)
  const recentMs = s.recent.reduce((a, r) => a + r.ms, 0)
  const wpm = recentMs > 0 ? Math.round(recentWords / (recentMs / 60_000)) : 0

  // Streaks: consecutive days with words. The current streak survives until a day is missed.
  const active = Object.keys(s.daily)
    .filter((k) => words(k) > 0)
    .sort()
  let longest = 0
  let run = 0
  let prev: Date | null = null
  for (const k of active) {
    const d = new Date(`${k}T12:00:00`)
    run = prev && Math.round((d.getTime() - prev.getTime()) / 86_400_000) === 1 ? run + 1 : 1
    longest = Math.max(longest, run)
    prev = d
  }
  let streak = 0
  const cursor = new Date(now)
  if (!words(key(cursor))) cursor.setDate(cursor.getDate() - 1)
  while (words(key(cursor)) > 0) {
    streak++
    cursor.setDate(cursor.getDate() - 1)
  }

  let weekWords = 0
  for (let i = 0; i < 7; i++) {
    const d = new Date(now)
    d.setDate(d.getDate() - i)
    weekWords += words(key(d))
  }

  let monthWords = 0
  let lastMonthWords = 0
  for (let day = 1; day <= now.getDate(); day++) {
    monthWords += words(key(new Date(now.getFullYear(), now.getMonth(), day)))
    lastMonthWords += words(key(new Date(now.getFullYear(), now.getMonth() - 1, day)))
  }

  const apps = new Map<string, number>()
  const cats = new Map<string, number>()
  let speechMs = 0
  for (const day of Object.values(s.daily)) {
    speechMs += day.speechMs
    for (const [a, w] of Object.entries(day.apps)) apps.set(a, (apps.get(a) ?? 0) + w)
    for (const [c, w] of Object.entries(day.categories)) cats.set(c, (cats.get(c) ?? 0) + w)
  }

  const heatmap: StatsSummary['heatmap'] = []
  const start = new Date(now)
  // Start on the Sunday 51 weeks back, so columns are Sunday-to-Saturday weeks ending with this one.
  start.setDate(start.getDate() - 51 * 7 - start.getDay())
  for (const d = new Date(start); d <= now; d.setDate(d.getDate() + 1)) heatmap.push({ date: key(d), words: words(key(d)) })

  return {
    wpm,
    totalWords: s.totalWords,
    totalFixes: s.totalFixes,
    totalSessions: s.totalSessions,
    weekWords,
    monthWords,
    monthChangePct: lastMonthWords > 0 ? Math.round(((monthWords - lastMonthWords) / lastMonthWords) * 100) : null,
    streak,
    longestStreak: longest,
    minutesSaved: Math.max(0, Math.round(s.totalWords / TYPING_WPM - speechMs / 60_000)),
    appsUsed: apps.size,
    topApps: [...apps].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([name, w]) => ({ name, words: w })),
    categories: [...cats].sort((a, b) => b[1] - a[1]).map(([id, w]) => ({ id, words: w })),
    heatmap
  }
}
