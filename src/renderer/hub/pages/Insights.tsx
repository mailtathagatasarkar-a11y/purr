import { CATEGORY_LABELS } from '../../../shared/apps'
import type { AppCategory } from '../../../shared/types'
import { fmt, useStats } from '../api'
import { Empty, Page } from '../ui'

function band(words: number): number {
  if (words <= 0) return 0
  if (words < 150) return 1
  if (words < 350) return 2
  if (words < 750) return 3
  return 4
}

export function Insights() {
  const s = useStats()
  if (!s) return null
  if (s.totalSessions === 0)
    return (
      <Page title="Insights">
        <Empty title="Nothing to measure yet">Dictate a few times and your speed, streak and favorite apps show up here.</Empty>
      </Page>
    )

  const weeks: { date: string; words: number }[][] = []
  s.heatmap.forEach((d, i) => {
    if (i % 7 === 0) weeks.push([])
    weeks[weeks.length - 1].push(d)
  })
  const catTotal = s.categories.reduce((n, c) => n + c.words, 0) || 1

  return (
    <Page title="Insights" lead="How much you've said, and how fast.">
      <div className="insight-hero">
        <div className="big-stat">
          <span className="big-num">{s.wpm}</span>
          <span className="big-unit">words per minute</span>
          <span className="muted small">About {Math.max(1, Math.round(s.wpm / 40))}× faster than typing. Based on your last 100 dictations.</span>
        </div>
        <dl className="stat-grid">
          <div>
            <dt>Words dictated</dt>
            <dd>{fmt(s.totalWords)}</dd>
          </div>
          <div>
            <dt>This month</dt>
            <dd>
              {fmt(s.monthWords)}
              {s.monthChangePct !== null && <span className={`delta${s.monthChangePct < 0 ? ' down' : ''}`}>{s.monthChangePct >= 0 ? `+${s.monthChangePct}%` : `${s.monthChangePct}%`}</span>}
            </dd>
          </div>
          <div>
            <dt>Fixes by Purr</dt>
            <dd>{fmt(s.totalFixes)}</dd>
          </div>
          <div>
            <dt>Time saved</dt>
            <dd>{fmt(s.minutesSaved)} min</dd>
          </div>
          <div>
            <dt>Current streak</dt>
            <dd>{s.streak} d</dd>
          </div>
          <div>
            <dt>Longest streak</dt>
            <dd>{s.longestStreak} d</dd>
          </div>
        </dl>
      </div>

      <section className="section">
        <div className="section-head">
          <h2>Activity</h2>
          <span className="legend muted small">
            Less
            {[0, 1, 2, 3, 4].map((b) => (
              <i key={b} className={`cell b${b}`} />
            ))}
            More
          </span>
        </div>
        <div className="panel heatmap-wrap">
          <div className="heatmap" style={{ gridTemplateColumns: `repeat(${weeks.length}, minmax(0, 1fr))` }} role="img" aria-label="Words dictated per day over the last year">
            {weeks.map((w, i) => (
              <div key={i} className="week">
                {w.map((d) => (
                  <i key={d.date} className={`cell b${band(d.words)}`} title={`${d.date}: ${fmt(d.words)} words`} />
                ))}
              </div>
            ))}
          </div>
        </div>
      </section>

      <div className="two-col">
        <section className="section">
          <div className="section-head">
            <h2>Where you dictate</h2>
          </div>
          <div className="panel pad">
            {s.categories.map((c) => (
              <div key={c.id} className="share">
                <span>{CATEGORY_LABELS[c.id as AppCategory] ?? c.id}</span>
                <span className="share-bar">
                  <span style={{ width: `${(c.words / catTotal) * 100}%` }} />
                </span>
                <span className="mono small">{Math.round((c.words / catTotal) * 100)}%</span>
              </div>
            ))}
          </div>
        </section>
        <section className="section">
          <div className="section-head">
            <h2>Top apps</h2>
            <span className="muted small">{s.appsUsed} apps in total</span>
          </div>
          <div className="panel">
            <ol className="top-apps">
              {s.topApps.map((a) => (
                <li key={a.name}>
                  <span>{a.name}</span>
                  <span className="mono small">{fmt(a.words)} words</span>
                </li>
              ))}
            </ol>
          </div>
        </section>
      </div>
    </Page>
  )
}
