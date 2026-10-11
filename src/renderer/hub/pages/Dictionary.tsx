import { useMemo, useState } from 'react'
import { invoke, useLibrary } from '../api'
import { Button, Empty, Page, Segmented } from '../ui'

export function Dictionary() {
  const lib = useLibrary()
  const [word, setWord] = useState('')
  const [misspelling, setMisspelling] = useState('')
  const [correcting, setCorrecting] = useState(false)
  const [filter, setFilter] = useState<'all' | 'mine' | 'auto'>('all')
  const [query, setQuery] = useState('')
  const [error, setError] = useState('')

  const entries = useMemo(
    () =>
      (lib?.dictionary ?? [])
        .filter((e) => !e.deleted)
        .filter((e) => (filter === 'auto' ? e.auto : filter === 'mine' ? !e.auto : true))
        .filter((e) => !query || e.word.toLowerCase().includes(query.toLowerCase()) || e.misspelling?.toLowerCase().includes(query.toLowerCase())),
    [lib, filter, query]
  )

  const add = async (): Promise<void> => {
    const w = word.trim()
    if (!w) return setError('Type the word the way it should be spelled.')
    if (!/[\p{L}\p{N}]/u.test(w)) return setError('A dictionary word needs at least one letter or number.')
    if (correcting && !misspelling.trim()) return setError('Type the wrong spelling Purr keeps writing.')
    await invoke('dict:save', { word: w, misspelling: correcting ? misspelling.trim() : undefined })
    setWord('')
    setMisspelling('')
    setError('')
  }

  return (
    <Page title="Dictionary" lead="Names, jargon and acronyms Purr should always spell your way. It also learns words when you fix a transcript.">
      <form
        className="add-form panel"
        onSubmit={(e) => {
          e.preventDefault()
          void add()
        }}
      >
        <div className="add-fields">
          <label className="field">
            <span>{correcting ? 'Correct spelling' : 'Word or phrase'}</span>
            <input value={word} onChange={(e) => setWord(e.target.value)} maxLength={60} placeholder="e.g. Tathagata, Figma, OKRs" />
          </label>
          {correcting && (
            <label className="field">
              <span>Purr writes it as</span>
              <input value={misspelling} onChange={(e) => setMisspelling(e.target.value)} maxLength={60} placeholder="e.g. tata gata" />
            </label>
          )}
          <Button type="submit" variant="primary">
            Add word
          </Button>
        </div>
        <label className="inline-check">
          <input type="checkbox" checked={correcting} onChange={(e) => setCorrecting(e.target.checked)} /> Correct a misspelling
        </label>
        {error && <p className="form-error">{error}</p>}
      </form>

      <div className="list-tools">
        <Segmented
          label="Filter"
          value={filter}
          onChange={setFilter}
          options={[
            { value: 'all', label: 'All' },
            { value: 'mine', label: 'Added by you' },
            { value: 'auto', label: 'Learned' }
          ]}
        />
        <input className="search" type="search" placeholder="Search" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search dictionary" />
      </div>

      {lib && entries.length === 0 ? (
        <Empty title={query || filter !== 'all' ? 'No matching words' : 'No words yet'}>
          {query || filter !== 'all' ? 'Try another search or filter.' : 'Add the names and terms you say often. Purr spells them right and uses them to hear you better.'}
        </Empty>
      ) : (
        <ul className="word-grid">
          {entries.map((e) => (
            <li key={e.id} className="word">
              <span className="word-main">{e.word}</span>
              {e.misspelling && <span className="word-from">replaces “{e.misspelling}”</span>}
              {e.auto && <span className="badge">Learned</span>}
              <button className="icon-btn" aria-label={`Delete ${e.word}`} onClick={() => void invoke('dict:delete', e.id)}>
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
    </Page>
  )
}
