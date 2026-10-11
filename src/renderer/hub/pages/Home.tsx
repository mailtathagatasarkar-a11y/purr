import { useMemo, useRef, useState } from 'react'
import type { HistoryItem } from '../../../shared/types'
import { dayLabel, fmt, invoke, timeAgo, useEngineStatus, useHistory, useSettings, useStats } from '../api'
import { Button, Empty, Keycaps, Voiceprint } from '../ui'

function greeting(): string {
  const h = new Date().getHours()
  if (h < 5) return 'Still up'
  if (h < 12) return 'Good morning'
  if (h < 18) return 'Good afternoon'
  return 'Good evening'
}

async function decodeTo16k(file: File): Promise<Float32Array> {
  const buf = await file.arrayBuffer()
  const ctx = new AudioContext()
  const decoded = await ctx.decodeAudioData(buf)
  await ctx.close()
  const off = new OfflineAudioContext(1, Math.ceil(decoded.duration * 16000), 16000)
  const src = off.createBufferSource()
  src.buffer = decoded
  src.connect(off.destination)
  src.start()
  const out = await off.startRendering()
  return out.getChannelData(0)
}

function HistoryRow({ item }: { item: HistoryItem }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(item.text)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const shown = item.showRaw ? item.raw : item.text
  const aiEdited = item.mode === 'dictation' && item.raw.trim() !== item.text.trim()

  const copy = async (): Promise<void> => {
    await navigator.clipboard.writeText(shown)
    setNote('Copied')
    setTimeout(() => setNote(''), 1500)
  }
  const save = async (): Promise<void> => {
    const learned = await invoke<string[]>('history:edit', item.id, draft)
    setEditing(false)
    setNote(learned.length ? `Added to dictionary: ${learned.join(', ')}` : 'Saved')
    setTimeout(() => setNote(''), 4000)
  }
  const retry = async (): Promise<void> => {
    setBusy(true)
    try {
      await invoke('history:retry', item.id)
      setNote('Transcribed again')
    } catch (err) {
      setNote((err as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''))
    } finally {
      setBusy(false)
    }
  }

  return (
    <li className={`entry${item.error ? ' entry-error' : ''}`}>
      <div className="entry-meta">
        <time className="mono" dateTime={new Date(item.at).toISOString()}>
          {timeAgo(item.at)}
        </time>
        <span className="entry-app">{item.mode === 'command' ? `Command · ${item.app}` : item.mode === 'transform' ? `${item.instruction} · ${item.app}` : item.app}</span>
        {item.wave?.length ? <Voiceprint wave={item.wave} height={16} /> : null}
      </div>
      <div className="entry-body">
        {item.instruction && item.mode === 'command' && <p className="entry-instruction">“{item.instruction}”</p>}
        {editing ? (
          <div className="entry-edit">
            <textarea value={draft} onChange={(e) => setDraft(e.target.value)} rows={Math.min(10, Math.max(2, Math.ceil(draft.length / 80)))} autoFocus />
            <p className="muted small">Fix any misheard words. Purr will add new names and terms to your dictionary.</p>
            <div className="btn-row">
              <Button variant="primary" small onClick={() => void save()}>
                Save fix
              </Button>
              <Button variant="quiet" small onClick={() => (setEditing(false), setDraft(item.text))}>
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <p className="entry-text">{shown || <span className="muted">{item.error ?? 'Nothing was transcribed.'}</span>}</p>
        )}
        <div className="entry-actions">
          <Button small variant="quiet" onClick={() => void copy()}>
            Copy
          </Button>
          {aiEdited && (
            <Button small variant="quiet" onClick={() => void invoke('history:update', item.id, { showRaw: !item.showRaw })}>
              {item.showRaw ? 'Redo AI edit' : 'Undo AI edit'}
            </Button>
          )}
          {!editing && item.mode !== 'command' && (
            <Button small variant="quiet" onClick={() => (setDraft(item.text), setEditing(true))}>
              Fix words
            </Button>
          )}
          {item.audioFile && (
            <Button small variant="quiet" onClick={() => void retry()} disabled={busy}>
              {busy ? 'Transcribing…' : 'Transcribe again'}
            </Button>
          )}
          <Button small variant="quiet" onClick={() => void invoke('history:delete', item.id)}>
            Delete
          </Button>
          {note && <span className="entry-note">{note}</span>}
        </div>
      </div>
    </li>
  )
}

export function Home({ go }: { go: (r: string) => void }) {
  const [query, setQuery] = useState('')
  const history = useHistory(query)
  const stats = useStats()
  const [settings] = useSettings()
  const status = useEngineStatus()
  const [fileState, setFileState] = useState('')
  const [dragging, setDragging] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)

  const today = useMemo(() => {
    const start = new Date()
    start.setHours(0, 0, 0, 0)
    return (history ?? []).filter((h) => h.at >= start.getTime() && h.mode === 'dictation')
  }, [history])
  const ribbon = useMemo(() => today.slice().reverse().flatMap((h) => [...(h.wave ?? []), 0, 0]).slice(-160), [today])
  const todayWords = today.reduce((n, h) => n + h.words, 0)

  const groups = useMemo(() => {
    const out: { label: string; items: HistoryItem[] }[] = []
    for (const h of history ?? []) {
      const label = dayLabel(h.at)
      const last = out[out.length - 1]
      if (last?.label === label) last.items.push(h)
      else out.push({ label, items: [h] })
    }
    return out
  }, [history])

  const transcribeFile = async (file: File): Promise<void> => {
    setFileState(`Transcribing ${file.name}…`)
    try {
      const samples = await decodeTo16k(file)
      await invoke('file:transcribe', samples, file.name)
      setFileState(`${file.name} transcribed. It's at the top of your history.`)
    } catch (err) {
      setFileState(`Couldn't transcribe ${file.name}: ${(err as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')}`)
    }
  }

  return (
    <div
      className={`page home${dragging ? ' dragging' : ''}`}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes('Files')) {
          e.preventDefault()
          setDragging(true)
        }
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault()
        setDragging(false)
        const f = e.dataTransfer.files[0]
        if (f) void transcribeFile(f)
      }}
    >
      <header className="home-head">
        <p className="eyebrow-label">{new Date().toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })}</p>
        <h1>{greeting()}.</h1>
        <div className="ribbon" aria-label={`${todayWords} words dictated today`}>
          <Voiceprint wave={ribbon.length ? ribbon : undefined} height={44} accent />
        </div>
        <dl className="statline">
          <div>
            <dt>Today</dt>
            <dd>{fmt(todayWords)} words</dd>
          </div>
          <div>
            <dt>Speed</dt>
            <dd>{stats?.wpm ?? 0} wpm</dd>
          </div>
          <div>
            <dt>Streak</dt>
            <dd>
              {stats?.streak ?? 0} {stats?.streak === 1 ? 'day' : 'days'}
            </dd>
          </div>
          <div>
            <dt>Time saved</dt>
            <dd>{fmt(stats?.minutesSaved ?? 0)} min</dd>
          </div>
        </dl>
      </header>

      {status && status.problems.length > 0 && (
        <div className="callout">
          <div>
            <strong>Finish setting up</strong>
            <ul>
              {status.problems.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          </div>
          <Button variant="primary" onClick={() => go('settings/engine')}>
            Open engine settings
          </Button>
        </div>
      )}

      <div className="history-head">
        <h2>History</h2>
        <div className="history-tools">
          <input className="search" type="search" placeholder="Search your dictations" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search history" />
          <Button small onClick={() => fileInput.current?.click()}>
            Transcribe a file
          </Button>
          <input
            ref={fileInput}
            type="file"
            accept="audio/*,video/*"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) void transcribeFile(f)
              e.target.value = ''
            }}
          />
        </div>
      </div>
      {fileState && <p className="file-state">{fileState}</p>}

      {history && history.length === 0 && !query && settings && (
        <Empty title="Your dictations will show up here">
          Click into any text box, hold <Keycaps chord={settings.hotkeys.pushToTalk?.[0]} size="sm" /> and talk. Let go and Purr types it for you, with the ums and
          restarts cleaned up.
        </Empty>
      )}
      {history && history.length === 0 && query && <Empty title={`Nothing matches “${query}”`} />}

      {groups.map((g) => (
        <section key={g.label} className="day">
          <h3 className="day-label">{g.label}</h3>
          <ul className="entries">
            {g.items.map((h) => (
              <HistoryRow key={h.id} item={h} />
            ))}
          </ul>
        </section>
      ))}
      {dragging && <div className="dropzone">Drop an audio file to transcribe it</div>}
    </div>
  )
}
