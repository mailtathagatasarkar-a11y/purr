import { useState } from 'react'
import type { Snippet } from '../../../shared/types'
import { invoke, useLibrary } from '../api'
import { Button, Empty, Page } from '../ui'

function SnippetForm({ initial, onDone }: { initial?: Snippet; onDone: () => void }) {
  const [trigger, setTrigger] = useState(initial?.trigger ?? '')
  const [expansion, setExpansion] = useState(initial?.expansion ?? '')
  const [error, setError] = useState('')
  const save = async (): Promise<void> => {
    if (!/[\p{L}\p{N}]/u.test(trigger)) return setError('The trigger needs words you can say.')
    if (!expansion.trim()) return setError('Add the text the trigger should insert.')
    await invoke('snip:save', { id: initial?.id, trigger, expansion })
    onDone()
  }
  return (
    <form
      className="panel snippet-form"
      onSubmit={(e) => {
        e.preventDefault()
        void save()
      }}
    >
      <label className="field">
        <span>When I say</span>
        <input value={trigger} onChange={(e) => setTrigger(e.target.value)} maxLength={60} placeholder="my calendar link" autoFocus />
      </label>
      <label className="field">
        <span>Insert</span>
        <textarea value={expansion} onChange={(e) => setExpansion(e.target.value)} maxLength={4000} rows={4} placeholder="https://cal.com/you/30min" />
      </label>
      <p className="muted small">Pick a phrase you wouldn't say by accident. “my calendar link” works better than “calendar”.</p>
      {error && <p className="form-error">{error}</p>}
      <div className="btn-row">
        <Button type="submit" variant="primary">
          {initial ? 'Save snippet' : 'Add snippet'}
        </Button>
        <Button variant="quiet" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </form>
  )
}

export function Snippets() {
  const lib = useLibrary()
  const [editing, setEditing] = useState<string | 'new' | null>(null)
  const snippets = (lib?.snippets ?? []).filter((s) => !s.deleted)

  return (
    <Page
      title="Snippets"
      lead="Say a short phrase, get a whole block of text: your address, a signature, a link you share every day."
      actions={
        editing !== 'new' && (
          <Button variant="primary" onClick={() => setEditing('new')}>
            New snippet
          </Button>
        )
      }
    >
      {editing === 'new' && <SnippetForm onDone={() => setEditing(null)} />}
      {lib && snippets.length === 0 && editing !== 'new' ? (
        <Empty title="No snippets yet" action={<Button onClick={() => setEditing('new')}>Create your first snippet</Button>}>
          Try “my email signature” or “office address”.
        </Empty>
      ) : (
        <ul className="snippets">
          {snippets.map((s) =>
            editing === s.id ? (
              <li key={s.id}>
                <SnippetForm initial={s} onDone={() => setEditing(null)} />
              </li>
            ) : (
              <li key={s.id} className="snippet">
                <span className="snippet-trigger">“{s.trigger}”</span>
                <span className="snippet-arrow" aria-hidden="true">
                  →
                </span>
                <span className="snippet-expansion">{s.expansion}</span>
                <span className="snippet-actions">
                  <Button small variant="quiet" onClick={() => setEditing(s.id)}>
                    Edit
                  </Button>
                  <Button small variant="quiet" onClick={() => void invoke('snip:delete', s.id)}>
                    Delete
                  </Button>
                </span>
              </li>
            )
          )}
        </ul>
      )}
    </Page>
  )
}
