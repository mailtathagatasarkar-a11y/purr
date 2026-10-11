import { useEffect, useMemo, useRef, useState } from 'react'
import type { Note } from '../../../shared/types'
import { invoke, purr, useLibrary, useSettings } from '../api'
import { Button, Empty, Keycaps } from '../ui'

function autoTitle(n: Note): string {
  if (n.title.trim()) return n.title
  const words = n.body.trim().split(/\s+/).slice(0, 6).join(' ')
  return words || 'Untitled'
}

function Editor({ note, compact }: { note: Note; compact?: boolean }) {
  const [title, setTitle] = useState(note.title)
  const [body, setBody] = useState(note.body)
  const [listening, setListening] = useState(false)
  const timer = useRef<number | null>(null)
  const area = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    setTitle(note.title)
    setBody(note.body)
  }, [note.id]) // eslint-disable-line react-hooks/exhaustive-deps

  // Reflect dictation finishing (Purr pastes into this textarea like any app).
  useEffect(() => purr.on('history', () => setListening(false)), [])

  const save = (patch: Partial<Note>): void => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = window.setTimeout(() => void invoke('note:save', { id: note.id, ...patch }), 450)
  }

  return (
    <div className="editor">
      <div className="editor-bar">
        <input
          className="editor-title"
          value={title}
          placeholder={autoTitle({ ...note, title: '', body })}
          onChange={(e) => {
            setTitle(e.target.value)
            save({ title: e.target.value.slice(0, 100), body })
          }}
          aria-label="Note title"
        />
        <div className="editor-tools">
          <button
            className={`mic-btn${listening ? ' on' : ''}`}
            // Keep focus in the note so the dictation lands here.
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              area.current?.focus()
              setListening((v) => !v)
              void invoke('dictate:toggle')
            }}
            aria-label={listening ? 'Stop dictating' : 'Dictate into this note'}
            title={listening ? 'Stop dictating' : 'Dictate into this note'}
          >
            <svg viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
              <rect x="7" y="2.5" width="6" height="10" rx="3" />
              <path d="M4.5 9.5a5.5 5.5 0 0 0 11 0M10 15v2.5" />
            </svg>
          </button>
          <Button small variant="quiet" onClick={() => void invoke('note:save', { id: note.id, pinned: !note.pinned })}>
            {note.pinned ? 'Unpin' : 'Pin'}
          </Button>
          {!compact && note.versions.length > 0 && (
            <select
              aria-label="Restore an earlier version"
              value=""
              onChange={(e) => {
                const v = note.versions[Number(e.target.value)]
                if (v) {
                  setTitle(v.title)
                  setBody(v.body)
                  void invoke('note:save', { id: note.id, title: v.title, body: v.body })
                }
              }}
            >
              <option value="">History</option>
              {note.versions.map((v, i) => (
                <option key={v.at} value={i}>
                  {new Date(v.at).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                </option>
              ))}
            </select>
          )}
          <Button small variant="quiet" onClick={() => void invoke('note:delete', note.id)}>
            Delete
          </Button>
        </div>
      </div>
      <textarea
        ref={area}
        className="editor-body"
        value={body}
        placeholder="Type, or hold your dictation shortcut and talk."
        onChange={(e) => {
          setBody(e.target.value)
          save({ title, body: e.target.value })
        }}
        aria-label="Note text"
      />
    </div>
  )
}

export function Notes({ compact }: { compact?: boolean }) {
  const lib = useLibrary()
  const [s] = useSettings()
  const [query, setQuery] = useState('')
  const [activeId, setActiveId] = useState<string | null>(null)
  const notes = useMemo(
    () =>
      (lib?.notes ?? [])
        .filter((n) => !n.deleted)
        .filter((n) => !query || `${n.title} ${n.body}`.toLowerCase().includes(query.toLowerCase()))
        .sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt - a.updatedAt),
    [lib, query]
  )
  const active = notes.find((n) => n.id === activeId) ?? notes[0]

  const create = async (): Promise<void> => {
    const n = await invoke<Note>('note:save', { title: '', body: '' })
    setActiveId(n.id)
  }

  return (
    <div className={`notes${compact ? ' notes-compact' : ''}`}>
      <aside className="notes-list">
        <div className="notes-list-head">
          {!compact && <h1>Notes</h1>}
          <Button small variant="primary" onClick={() => void create()}>
            New note
          </Button>
        </div>
        <input className="search" type="search" placeholder="Search notes" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search notes" />
        <ul>
          {notes.map((n) => (
            <li key={n.id}>
              <button className={active?.id === n.id ? 'on' : ''} onClick={() => setActiveId(n.id)}>
                <span className="note-title">
                  {n.pinned && <span className="pin" aria-label="Pinned" />}
                  {autoTitle(n)}
                </span>
                <span className="note-snippet">{n.body.slice(0, 80) || 'Empty note'}</span>
              </button>
            </li>
          ))}
        </ul>
        {!compact && s && (
          <p className="muted small notes-tip">
            Open the scratchpad from anywhere with <Keycaps chord={s.hotkeys.scratchpad?.[0]} size="sm" />
          </p>
        )}
      </aside>
      {active ? (
        <Editor key={active.id} note={active} compact={compact} />
      ) : (
        <div className="editor">
          <Empty title="A place for rough thoughts" action={<Button onClick={() => void create()}>Start a note</Button>}>
            Talk through an idea, then polish it later or paste it anywhere.
          </Empty>
        </div>
      )}
    </div>
  )
}
