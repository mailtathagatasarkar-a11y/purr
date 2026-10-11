import { useState } from 'react'
import type { ModelInfo } from '../../../shared/types'
import { invoke, isMac, useKeys, useModels, usePermissions, useSettings } from '../api'
import { Button, Keycaps, Progress } from '../ui'

const STEPS = ['Engine', 'Setup', 'Permissions', 'Try it'] as const

function Download({ kind, model }: { kind: 'stt' | 'llm'; model: ModelInfo }) {
  const [err, setErr] = useState('')
  return (
    <div className="model">
      <span>
        <span className="row-label">
          {model.name} {model.recommended && <span className="badge">Recommended</span>}
        </span>
        <span className="row-desc">
          {model.description} · {model.sizeMB >= 1000 ? `${(model.sizeMB / 1000).toFixed(1)} GB` : `${model.sizeMB} MB`}
        </span>
        {err && <span className="form-error">{err}</span>}
      </span>
      <span className="model-action">
        {model.installed ? (
          <span className="done-mark">Ready</span>
        ) : model.downloading ? (
          <Progress value={model.downloading.total ? model.downloading.received / model.downloading.total : 0} />
        ) : (
          <Button
            small
            variant="primary"
            onClick={() =>
              void invoke('models:download', kind, model.id).catch((e) => setErr(String((e as Error).message).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')))
            }
          >
            Download
          </Button>
        )}
      </span>
    </div>
  )
}

export function Welcome({ onDone }: { onDone: () => void }) {
  const [s, update] = useSettings()
  const [step, setStep] = useState(0)
  const [mode, setMode] = useState<'local' | 'cloud'>('local')
  const [key, setKey] = useState('')
  const [keyMsg, setKeyMsg] = useState('')
  const sttModels = useModels('stt')
  const llmModels = useModels('llm')
  const keys = useKeys()
  const [perm, reloadPerm] = usePermissions()
  const [micOk, setMicOk] = useState<boolean | null>(null)
  if (!s) return null

  const choose = async (m: 'local' | 'cloud'): Promise<void> => {
    setMode(m)
    if (m === 'local') await update({ stt: { ...s.stt, provider: 'local' }, llm: { ...s.llm, provider: 'local' } })
    else await update({ stt: { ...s.stt, provider: 'groq' }, llm: { ...s.llm, provider: 'groq' } })
    setStep(1)
  }

  const saveKey = async (): Promise<void> => {
    setKeyMsg('Checking…')
    try {
      await invoke('keys:set', 'groq', key)
      setKeyMsg(await invoke<string>('keys:testStt', 'groq'))
      setKey('')
    } catch (e) {
      setKeyMsg(String((e as Error).message).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''))
    }
  }

  const askMic = async (): Promise<void> => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      stream.getTracks().forEach((t) => t.stop())
      setMicOk(true)
    } catch {
      setMicOk(false)
      await invoke('perm:request', 'microphone')
    }
    reloadPerm()
  }

  const parakeet = sttModels?.find((m) => m.id === 'parakeet-v3')
  const whisper = sttModels?.find((m) => m.id === 'whisper-turbo')
  const qwen = llmModels?.find((m) => m.id === 'qwen3-4b')
  const light = llmModels?.find((m) => m.id === 'qwen2.5-1.5b')
  const setupReady = mode === 'local' ? !!sttModels?.some((m) => m.installed) : !!keys?.groq

  return (
    <div className="welcome">
      <ol className="steps" aria-label="Setup steps">
        {STEPS.map((t, i) => (
          <li key={t} className={i === step ? 'on' : i < step ? 'done' : ''}>
            {t}
          </li>
        ))}
      </ol>

      {step === 0 && (
        <section>
          <h1>Talk, and it types.</h1>
          <p className="lead">Purr turns your voice into clean text in any app. First, choose where it does the work.</p>
          <div className="choice-cards">
            <button className="choice" onClick={() => void choose('local')}>
              <span className="choice-title">On this computer</span>
              <span className="muted">Private and offline. Nothing you say leaves your machine. A one-time download of about 0.7 to 3 GB.</span>
            </button>
            <button className="choice" onClick={() => void choose('cloud')}>
              <span className="choice-title">In the cloud</span>
              <span className="muted">Fastest and the most accurate on accents and noise. Uses your own API key; Groq has a free tier.</span>
            </button>
          </div>
          <p className="muted small">You can mix and match later in Settings → Engine.</p>
        </section>
      )}

      {step === 1 && mode === 'local' && (
        <section>
          <h1>Download the models</h1>
          <p className="lead">One speech model is enough to start. Add the AI model for smart clean-up: backtracking, lists and tone.</p>
          <h2 className="small-head">Speech</h2>
          <div className="models">
            {parakeet && <Download kind="stt" model={parakeet} />}
            {whisper && <Download kind="stt" model={whisper} />}
          </div>
          <h2 className="small-head">AI clean-up (optional)</h2>
          <div className="models">
            {qwen && <Download kind="llm" model={qwen} />}
            {light && <Download kind="llm" model={light} />}
          </div>
          <p className="muted small">Without the AI model, Purr still removes ums, stutters and “scratch that”, and adds basic punctuation.</p>
          <div className="btn-row">
            <Button variant="primary" disabled={!setupReady} onClick={() => setStep(2)}>
              Continue
            </Button>
            <Button variant="quiet" onClick={() => setStep(0)}>
              Back
            </Button>
          </div>
        </section>
      )}

      {step === 1 && mode === 'cloud' && (
        <section>
          <h1>Add your Groq key</h1>
          <p className="lead">One free key covers both speech and clean-up. Prefer OpenAI, Claude, Gemini or Deepgram? Set them up later in Settings → Engine.</p>
          <ol className="howto">
            <li>
              Open{' '}
              <a href="https://console.groq.com/keys" target="_blank" rel="noreferrer">
                console.groq.com/keys
              </a>{' '}
              and sign in.
            </li>
            <li>Create an API key and copy it.</li>
            <li>Paste it here.</li>
          </ol>
          <div className="key-field">
            <input type="password" value={key} onChange={(e) => setKey(e.target.value)} placeholder={keys?.groq ? 'Key saved' : 'gsk_…'} aria-label="Groq API key" autoComplete="off" />
            <Button variant="primary" onClick={() => void saveKey()} disabled={!key.trim()}>
              Save and test
            </Button>
          </div>
          {keyMsg && <p className="small key-result">{keyMsg}</p>}
          <div className="btn-row">
            <Button variant="primary" disabled={!setupReady} onClick={() => setStep(2)}>
              Continue
            </Button>
            <Button variant="quiet" onClick={() => setStep(0)}>
              Back
            </Button>
          </div>
        </section>
      )}

      {step === 2 && (
        <section>
          <h1>Let Purr hear you</h1>
          <p className="lead">{isMac ? 'Purr needs the microphone, plus Accessibility to type into other apps and see your shortcut.' : 'Purr needs the microphone.'}</p>
          <div className="perm-list">
            <div className="model">
              <span>
                <span className="row-label">Microphone</span>
                <span className="row-desc">Only used while you hold the shortcut.</span>
              </span>
              {micOk ? (
                <span className="done-mark">Allowed</span>
              ) : (
                <Button small variant="primary" onClick={() => void askMic()}>
                  {micOk === false ? 'Open settings' : 'Allow'}
                </Button>
              )}
            </div>
            {isMac && (
              <div className="model">
                <span>
                  <span className="row-label">Accessibility</span>
                  <span className="row-desc">Lets Purr paste text and listen for the fn key. Turn on Purr in the list, then come back.</span>
                </span>
                {perm?.accessibility ? (
                  <span className="done-mark">Allowed</span>
                ) : (
                  <Button small variant="primary" onClick={() => void invoke('perm:request', 'accessibility').then(reloadPerm)}>
                    Open settings
                  </Button>
                )}
              </div>
            )}
          </div>
          <div className="btn-row">
            <Button variant="primary" onClick={() => setStep(3)}>
              Continue
            </Button>
            <Button variant="quiet" onClick={() => setStep(1)}>
              Back
            </Button>
          </div>
        </section>
      )}

      {step === 3 && (
        <section>
          <h1>Try it</h1>
          <p className="lead">
            Click in the box, hold <Keycaps chord={s.hotkeys.pushToTalk?.[0]} /> and say:
          </p>
          <blockquote className="say">“Um, let's meet at 2, actually 3, and can you bring the, uh, the deck?”</blockquote>
          <textarea className="practice" rows={4} placeholder="Your words appear here" aria-label="Practice box" />
          <ul className="tips">
            <li>
              Double-tap <Keycaps chord={s.hotkeys.pushToTalk?.[0]} size="sm" /> to talk hands-free, tap once more to finish.
            </li>
            <li>
              Press <Keycaps chord={s.hotkeys.cancel?.[0]} size="sm" /> to cancel.
            </li>
            <li>
              Select text, hold <Keycaps chord={s.hotkeys.commandMode?.[0]} size="sm" /> and say “make this friendlier”.
            </li>
          </ul>
          <div className="btn-row">
            <Button
              variant="primary"
              onClick={() => {
                void update({ onboarded: true })
                onDone()
              }}
            >
              Start using Purr
            </Button>
            <Button variant="quiet" onClick={() => setStep(2)}>
              Back
            </Button>
          </div>
        </section>
      )}
    </div>
  )
}
