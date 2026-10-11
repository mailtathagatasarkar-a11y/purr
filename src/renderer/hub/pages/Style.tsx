import { useState } from 'react'
import { CATEGORY_LABELS } from '../../../shared/apps'
import type { AppCategory, CleanupLevel, StyleId } from '../../../shared/types'
import { invoke, useSettings } from '../api'
import { Button, Page, Section, Segmented, Toggle } from '../ui'

const STYLE_INFO: Record<StyleId, { name: string; desc: string; sample: Record<AppCategory, string> }> = {
  formal: {
    name: 'Formal',
    desc: 'Capitals and full punctuation.',
    sample: {
      personal: 'Hey, are you free for dinner tonight? Let me know.',
      work: 'Can we move the review to Thursday? I need one more day.',
      email: 'Hi Sam,\n\nThanks for the update. I will send the deck by Friday.\n\nBest,\nAsha',
      other: 'Summarize this article in three bullet points.'
    }
  },
  casual: {
    name: 'Casual',
    desc: 'Capitals, lighter punctuation.',
    sample: {
      personal: 'Hey are you free for dinner tonight? Let me know',
      work: 'Can we move the review to Thursday? I need one more day',
      email: 'Hi Sam,\n\nThanks for the update, I’ll send the deck by Friday\n\nAsha',
      other: 'Summarize this article in three bullet points'
    }
  },
  veryCasual: {
    name: 'Very casual',
    desc: 'Lowercase, minimal punctuation.',
    sample: { personal: 'hey are you free for dinner tonight? let me know', work: '', email: '', other: '' }
  },
  excited: {
    name: 'Excited!',
    desc: 'More exclamation points.',
    sample: {
      personal: '',
      work: 'Can we move the review to Thursday? I need one more day!',
      email: 'Hi Sam!\n\nThanks so much for the update! I’ll send the deck by Friday.\n\nBest,\nAsha',
      other: 'Summarize this article in three bullet points!'
    }
  }
}

const OPTIONS: Record<AppCategory, StyleId[]> = {
  personal: ['formal', 'casual', 'veryCasual'],
  work: ['formal', 'casual', 'excited'],
  email: ['formal', 'casual', 'excited'],
  other: ['formal', 'casual', 'excited']
}

const APPS: Record<AppCategory, string> = {
  personal: 'WhatsApp, Messages, Telegram, Signal, Discord',
  work: 'Slack, Teams, Google Chat, LinkedIn',
  email: 'Gmail, Outlook, Apple Mail, Superhuman',
  other: 'Docs, Notion, ChatGPT, Claude, code editors, everything else'
}

const LEVELS: { id: CleanupLevel; name: string; desc: string; example: string }[] = [
  { id: 'none', name: 'None', desc: 'The raw transcript, ums and all.', example: 'So um I think we should, uh, meet on Tuesday, no Wednesday.' },
  { id: 'light', name: 'Light', desc: 'Removes fillers and restarts, fixes grammar. Keeps your wording.', example: 'I think we should meet on Wednesday.' },
  { id: 'medium', name: 'Medium', desc: 'Also rewords awkward bits to be clearer and shorter.', example: "Let's meet on Wednesday." },
  { id: 'high', name: 'Polished', desc: 'Rewrites into tidy, well-structured prose.', example: 'Could we meet on Wednesday?' }
]

export function Style() {
  const [s, update] = useSettings()
  const [cat, setCat] = useState<AppCategory>('personal')
  const [tryText, setTryText] = useState('um so I I think we should uh meet at 2 actually 3 and can you bring the the deck')
  const [tryOut, setTryOut] = useState('')
  const [trying, setTrying] = useState(false)
  if (!s) return null

  const runTry = async (): Promise<void> => {
    setTrying(true)
    try {
      const r = await invoke<{ text: string; usedAi: boolean; aiError?: string }>('text:process', tryText, cat)
      setTryOut(r.text + (r.usedAi ? '' : r.aiError ? `\n\n(Basic clean-up only: ${r.aiError})` : '\n\n(Basic clean-up only. Turn on AI in Settings → Engine for smarter edits.)'))
    } finally {
      setTrying(false)
    }
  }

  return (
    <Page title="Style" lead="How Purr writes depends on where you are. Pick a tone for each kind of app.">
      <Section title="Tone by app">
        <div className="style-tabs">
          <Segmented
            label="App category"
            value={cat}
            onChange={setCat}
            options={(Object.keys(CATEGORY_LABELS) as AppCategory[]).map((c) => ({ value: c, label: CATEGORY_LABELS[c] }))}
          />
          <p className="muted small">{APPS[cat]}</p>
        </div>
        <div className="style-cards">
          {OPTIONS[cat].map((id) => {
            const info = STYLE_INFO[id]
            const on = s.styles[cat] === id
            return (
              <button key={id} className={`style-card${on ? ' on' : ''}`} aria-pressed={on} onClick={() => void update({ styles: { ...s.styles, [cat]: id } })}>
                <span className="style-name">{info.name}</span>
                <span className="muted small">{info.desc}</span>
                <span className="style-sample">{info.sample[cat] || info.sample.personal}</span>
              </button>
            )
          })}
        </div>
        <p className="muted small pad">Tone applies to English. Other languages keep standard punctuation.</p>
      </Section>

      <Section title="Auto clean-up" description="How much Purr edits what you say. Applies everywhere.">
        <div className="level-cards">
          {LEVELS.map((l) => (
            <button key={l.id} className={`level-card${s.cleanupLevel === l.id ? ' on' : ''}`} aria-pressed={s.cleanupLevel === l.id} onClick={() => void update({ cleanupLevel: l.id })}>
              <span className="style-name">{l.name}</span>
              <span className="muted small">{l.desc}</span>
              <span className="level-example">{l.example}</span>
            </button>
          ))}
        </div>
      </Section>

      <Section title="Fumbles and formatting">
        <Toggle
          label="Backtrack"
          description={'Keep only what you meant when you correct yourself: "at 2, actually 3" becomes "at 3". Also "scratch that".'}
          checked={s.backtrack}
          onChange={(v) => void update({ backtrack: v })}
        />
        <Toggle
          label="Smart formatting"
          description='Punctuation, capitals, lists when you count items off, and spoken commands like "new paragraph" or "question mark".'
          checked={s.smartFormatting}
          onChange={(v) => void update({ smartFormatting: v })}
        />
      </Section>

      <Section title="Try it" description={`Type something the way you'd say it. Purr cleans it up with your ${CATEGORY_LABELS[cat].toLowerCase()} style.`}>
        <div className="try">
          <textarea value={tryText} onChange={(e) => setTryText(e.target.value)} rows={3} aria-label="Messy text to clean up" />
          <Button variant="primary" onClick={() => void runTry()} disabled={trying}>
            {trying ? 'Cleaning up…' : 'Clean it up'}
          </Button>
          {tryOut && <p className="try-out">{tryOut}</p>}
        </div>
      </Section>
    </Page>
  )
}
