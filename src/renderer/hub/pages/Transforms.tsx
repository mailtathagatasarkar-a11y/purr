import { useEffect, useRef, useState } from 'react'
import type { PolishRules, Settings, Transform } from '../../../shared/types'
import { invoke, useLibrary, useSettings } from '../api'
import { Button, Page, Row, Section, ShortcutField, Toggle } from '../ui'

const RULES: { id: keyof PolishRules; label: string }[] = [
  { id: 'concise', label: 'Make it more concise' },
  { id: 'clarity', label: 'Reword for clarity' },
  { id: 'reorder', label: 'Reorder for readability' },
  { id: 'structure', label: 'Add structure (paragraphs, lists)' },
  { id: 'keepTone', label: 'Keep my tone' }
]

/** Saves as you type, like the rest of the app. */
function useAutosave(t: Transform): [Transform, (patch: Partial<Transform>) => void] {
  const [draft, setDraft] = useState(t)
  const timer = useRef<number | null>(null)
  useEffect(() => setDraft(t), [t.id]) // eslint-disable-line react-hooks/exhaustive-deps
  const change = (patch: Partial<Transform>): void => {
    const next = { ...draft, ...patch }
    setDraft(next)
    if (timer.current) clearTimeout(timer.current)
    timer.current = window.setTimeout(() => void invoke('tf:save', next), 400)
  }
  return [draft, change]
}

function ListEditor({ items, onChange, max, placeholder, multiline }: { items: string[]; onChange: (v: string[]) => void; max: number; placeholder: string; multiline?: boolean }) {
  return (
    <div className="list-editor">
      {items.map((it, i) => (
        <div key={i} className="list-editor-row">
          {multiline ? (
            <textarea value={it} rows={3} onChange={(e) => onChange(items.map((x, j) => (j === i ? e.target.value : x)))} placeholder={placeholder} />
          ) : (
            <input value={it} onChange={(e) => onChange(items.map((x, j) => (j === i ? e.target.value : x)))} placeholder={placeholder} />
          )}
          <button className="icon-btn" aria-label="Remove" onClick={() => onChange(items.filter((_, j) => j !== i))}>
            ×
          </button>
        </div>
      ))}
      {items.length < max && (
        <Button small onClick={() => onChange([...items, ''])}>
          Add
        </Button>
      )}
    </div>
  )
}

function TransformCard({ t, settings, update }: { t: Transform; settings: Settings; update: (p: Partial<Settings>) => Promise<void> }) {
  const [draft, change] = useAutosave(t)
  const hotkeyId = `transform:${t.id}`
  const setHotkey = (c: string[][]): void => void update({ hotkeys: { ...settings.hotkeys, [hotkeyId]: c } })
  return (
    <Section
      title={t.kind === 'custom' ? undefined : t.name}
      description={
        t.kind === 'polish'
          ? 'Select text anywhere and press the shortcut. Purr rewrites it in place.'
          : t.kind === 'prompt'
            ? 'Turn a rambling spoken thought into a clear, structured prompt for ChatGPT, Claude or Cursor.'
            : undefined
      }
      aside={
        t.kind === 'custom' ? (
          <Button small variant="quiet" onClick={() => void invoke('tf:delete', t.id)}>
            Delete
          </Button>
        ) : undefined
      }
    >
      {t.kind === 'custom' && (
        <label className="field pad">
          <span>Name</span>
          <input value={draft.name} onChange={(e) => change({ name: e.target.value })} maxLength={40} placeholder="Reply like me" />
        </label>
      )}
      <Row label="Shortcut">
        <ShortcutField chords={settings.hotkeys[hotkeyId]} onChange={setHotkey} />
      </Row>
      {t.kind === 'polish' &&
        RULES.map((r) => (
          <Toggle key={r.id} label={r.label} checked={!!draft.rules?.[r.id]} onChange={(v) => change({ rules: { ...(draft.rules as PolishRules), [r.id]: v } })} />
        ))}
      {t.kind === 'polish' && (
        <div className="pad">
          <p className="row-label">Your own rules</p>
          <p className="muted small">Up to five short instructions, like “Use British spelling”.</p>
          <ListEditor items={draft.customRules ?? []} onChange={(v) => change({ customRules: v.map((x) => x.split(/\s+/).slice(0, 50).join(' ')) })} max={5} placeholder="Never use exclamation marks" />
        </div>
      )}
      {t.kind === 'custom' && (
        <label className="field pad">
          <span>What it should do</span>
          <textarea value={draft.instructions} onChange={(e) => change({ instructions: e.target.value })} rows={4} placeholder="Rewrite as a friendly, short reply. Keep any dates and names." />
        </label>
      )}
      {t.kind !== 'prompt' && (
        <div className="pad">
          <p className="row-label">Writing samples</p>
          <p className="muted small">Optional. Paste a few things you wrote so the result sounds like you.</p>
          <ListEditor items={draft.samples ?? []} onChange={(v) => change({ samples: v })} max={5} placeholder="Paste 50 to 500 words you wrote" multiline />
        </div>
      )}
    </Section>
  )
}

export function Transforms() {
  const lib = useLibrary()
  const [s, update] = useSettings()
  if (!s || !lib) return null
  const transforms = lib.transforms.filter((t) => !t.deleted)
  const customs = transforms.filter((t) => t.kind === 'custom')

  const addCustom = async (): Promise<void> => {
    const t = await invoke<Transform>('tf:save', { name: 'New transform', kind: 'custom', instructions: '', samples: [] })
    const used = new Set(Object.values(s.hotkeys).flat().map((c) => c.join('+')))
    const n = customs.length + 3
    const suggestion = s.hotkeys['transform:polish']?.[0]?.slice(0, -1).concat(String(n))
    const hotkeys = { ...s.hotkeys, [`transform:${t.id}`]: suggestion && n <= 9 && !used.has(suggestion.join('+')) ? [suggestion] : [] }
    await update({ hotkeys })
  }

  return (
    <Page title="Transforms" lead="Rewrite selected text in any app with a shortcut. If nothing is selected, Purr uses the whole text box.">
      {transforms
        .filter((t) => t.kind !== 'custom')
        .map((t) => (
          <TransformCard key={t.id} t={t} settings={s} update={update} />
        ))}
      <div className="history-head">
        <h2>Your transforms</h2>
        {customs.length < 8 && <Button onClick={() => void addCustom()}>New transform</Button>}
      </div>
      {customs.length === 0 && <p className="muted pad-x">Make your own: “Reply like me”, “Translate to Hindi”, “Make it a tweet”.</p>}
      {customs.map((t) => (
        <TransformCard key={t.id} t={t} settings={s} update={update} />
      ))}
      <Section title="After every dictation">
        <Row label="Run a transform automatically" description="Applied before Purr types your words. If it fails, your dictation is typed as normal.">
          <select value={s.autoTransformId ?? ''} onChange={(e) => void update({ autoTransformId: e.target.value || null })}>
            <option value="">Off</option>
            {transforms.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </Row>
        <Row label="Compare changes" description="Show what the last transform changed, with Undo.">
          <ShortcutField chords={s.hotkeys.viewDiff} onChange={(c) => void update({ hotkeys: { ...s.hotkeys, viewDiff: c } })} />
        </Row>
        <Toggle
          label="Use the whole text box when nothing is selected"
          checked={s.transformUseWholeField}
          onChange={(v) => void update({ transformUseWholeField: v })}
        />
      </Section>
    </Page>
  )
}
