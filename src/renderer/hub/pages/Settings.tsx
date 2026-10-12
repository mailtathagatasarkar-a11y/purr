import { useEffect, useRef, useState } from 'react'
import { FEEDBACK_URL, LANGUAGES, LLM_PROVIDERS, STT_PROVIDERS } from '../../../shared/defaults'
import type { LlmProvider, ModelInfo, Settings, SttProvider } from '../../../shared/types'
import { invoke, isMac, useEngineStatus, useKeys, useModels, usePermissions, useSettings } from '../api'
import { Button, Page, Progress, Row, Section, Segmented, ShortcutField, Toggle } from '../ui'

const TABS = [
  { id: 'general', label: 'General' },
  { id: 'engine', label: 'Engine' },
  { id: 'system', label: 'System' },
  { id: 'coding', label: 'Vibe coding' },
  { id: 'privacy', label: 'Data & privacy' },
  { id: 'experimental', label: 'Experimental' },
  { id: 'about', label: 'About' }
]

const clean = (e: unknown): string => (e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')

type Update = (p: Partial<Settings>) => Promise<void>

// ---------------- General ----------------
function MicTest({ deviceId }: { deviceId: string }) {
  const [level, setLevel] = useState(0)
  const [on, setOn] = useState(false)
  const stop = useRef<() => void>(() => undefined)
  useEffect(() => () => stop.current(), [])
  const start = async (): Promise<void> => {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: deviceId ? { deviceId: { exact: deviceId } } : true })
    const ctx = new AudioContext()
    const an = ctx.createAnalyser()
    an.fftSize = 512
    ctx.createMediaStreamSource(stream).connect(an)
    const buf = new Float32Array(an.fftSize)
    let raf = 0
    const tick = (): void => {
      an.getFloatTimeDomainData(buf)
      let s = 0
      for (const v of buf) s += v * v
      setLevel(Math.min(1, Math.sqrt(s / buf.length) * 8))
      raf = requestAnimationFrame(tick)
    }
    tick()
    setOn(true)
    stop.current = () => {
      cancelAnimationFrame(raf)
      stream.getTracks().forEach((t) => t.stop())
      void ctx.close()
      setOn(false)
      setLevel(0)
    }
    setTimeout(() => stop.current(), 10_000)
  }
  return (
    <span className="mic-test">
      <span className="meter" aria-hidden="true">
        <span style={{ width: `${level * 100}%` }} />
      </span>
      <Button small onClick={() => (on ? stop.current() : void start().catch(() => undefined))}>
        {on ? 'Stop' : 'Test'}
      </Button>
    </span>
  )
}

function Languages({ s, update }: { s: Settings; update: Update }) {
  const [q, setQ] = useState('')
  const toggle = (code: string): void => {
    const has = s.languages.includes(code)
    void update({ languages: has ? s.languages.filter((c) => c !== code) : [...s.languages, code] })
  }
  const list = LANGUAGES.filter((l) => !q || l.name.toLowerCase().includes(q.toLowerCase()))
  return (
    <div className="pad">
      <div className="lang-head">
        <p className="row-label">{s.languages.length === 0 ? 'Auto-detect (any language)' : `${s.languages.length} selected`}</p>
        {s.languages.length > 0 && (
          <Button small variant="quiet" onClick={() => void update({ languages: [] })}>
            Use auto-detect
          </Button>
        )}
        <input className="search" type="search" placeholder="Find a language" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Find a language" />
      </div>
      <p className="muted small">Pick one to always use it, or a few to limit detection to them. For Hindi mixed with English, pick Hinglish.</p>
      <div className="chips">
        {list.map((l) => (
          <button key={l.code} className={`chip${s.languages.includes(l.code) ? ' on' : ''}`} aria-pressed={s.languages.includes(l.code)} onClick={() => toggle(l.code)}>
            {l.name}
          </button>
        ))}
      </div>
    </div>
  )
}

function General({ s, update }: { s: Settings; update: Update }) {
  const [mics, setMics] = useState<MediaDeviceInfo[]>([])
  useEffect(() => {
    const load = (): void => void navigator.mediaDevices.enumerateDevices().then((d) => setMics(d.filter((x) => x.kind === 'audioinput' && x.deviceId !== 'default' && x.deviceId !== 'communications')))
    load()
    navigator.mediaDevices.addEventListener('devicechange', load)
    return () => navigator.mediaDevices.removeEventListener('devicechange', load)
  }, [])
  const hk = (id: string, label: string, description?: string, allowClear = true) => (
    <Row key={id} label={label} description={description}>
      <ShortcutField chords={s.hotkeys[id]} onChange={(c) => void update({ hotkeys: { ...s.hotkeys, [id]: c } })} allowClear={allowClear} />
    </Row>
  )
  return (
    <>
      <Section title="Shortcuts" description="Up to three keys, or a mouse side button. Tap twice quickly to go hands-free.">
        {hk('pushToTalk', 'Push to talk', 'Hold while you speak. Double-tap for hands-free.', false)}
        {hk('handsFree', 'Hands-free', 'Press to start, press again to stop and insert.')}
        {hk('commandMode', 'Command Mode', 'Hold, then say what to do with the selected text.')}
        {hk('cancel', 'Cancel', 'Stops a dictation without inserting.', false)}
        {hk('pasteLast', 'Paste last transcript')}
        {hk('scratchpad', 'Open scratchpad')}
        {isMac && <p className="muted small pad">Using fn? In System Settings → Keyboard, set “Press 🌐 key to” to “Do Nothing” so macOS doesn't open the emoji picker.</p>}
      </Section>
      <Section title="Microphone">
        <Row label="Input" description="Purr falls back to the system default if this one is unplugged.">
          <select value={s.microphoneId} onChange={(e) => void update({ microphoneId: e.target.value })}>
            <option value="">System default</option>
            {mics.map((m) => (
              <option key={m.deviceId} value={m.deviceId}>
                {m.label || 'Microphone'}
              </option>
            ))}
          </select>
          <MicTest deviceId={s.microphoneId} />
        </Row>
        <Toggle label="Boost quiet speech" description="Lets you whisper or mumble in an open office and still be heard." checked={s.whisperBoost} onChange={(v) => void update({ whisperBoost: v })} />
      </Section>
      <Section title="Languages">
        <Languages s={s} update={update} />
      </Section>
      <Section title="Sounds">
        <Toggle label="Play sounds" description="A soft cue when Purr starts and stops listening." checked={s.sounds} onChange={(v) => void update({ sounds: v })} />
        <Row label="Volume">
          <input type="range" min={0} max={1} step={0.05} value={s.soundVolume} onChange={(e) => void update({ soundVolume: Number(e.target.value) })} aria-label="Sound volume" />
        </Row>
      </Section>
    </>
  )
}

// ---------------- Engine ----------------
function ModelList({ kind, selected, onSelect }: { kind: 'stt' | 'llm'; selected: string; onSelect: (id: string) => void }) {
  const models = useModels(kind)
  const [error, setError] = useState('')
  if (!models) return null
  const download = async (m: ModelInfo): Promise<void> => {
    setError('')
    try {
      await invoke('models:download', kind, m.id)
      onSelect(m.id)
    } catch (e) {
      setError(`${m.name}: ${clean(e)}`)
    }
  }
  return (
    <div className="models">
      {models.map((m) => (
        <div key={m.id} className={`model${selected === m.id ? ' on' : ''}`}>
          <label className="model-pick">
            <input type="radio" name={`model-${kind}`} checked={selected === m.id} disabled={!m.installed} onChange={() => onSelect(m.id)} />
            <span>
              <span className="row-label">
                {m.name} {m.recommended && <span className="badge">Recommended</span>}
              </span>
              <span className="row-desc">
                {m.description}
                {m.languages ? ` · ${m.languages}` : ''} · {m.sizeMB >= 1000 ? `${(m.sizeMB / 1000).toFixed(1)} GB` : `${m.sizeMB} MB`}
              </span>
            </span>
          </label>
          <span className="model-action">
            {m.downloading ? (
              <>
                <Progress value={m.downloading.total ? m.downloading.received / m.downloading.total : 0} />
                <Button small variant="quiet" onClick={() => void invoke('models:cancel', kind, m.id)}>
                  Cancel
                </Button>
              </>
            ) : m.installed ? (
              <Button small variant="quiet" onClick={() => void invoke('models:remove', kind, m.id)}>
                Remove
              </Button>
            ) : (
              <Button small onClick={() => void download(m)}>
                Download
              </Button>
            )}
          </span>
        </div>
      ))}
      {error && <p className="form-error pad">{error}</p>}
    </div>
  )
}

function LanguageFit({ model, languages }: { model: string; languages: string[] }) {
  const models = useModels('stt')
  const m = models?.find((x) => x.id === model)
  if (!m?.langs || languages.length === 0) return null
  const missing = languages.filter((l) => !m.langs!.includes(l === 'hinglish' ? 'hi' : l))
  if (!missing.length) return null
  const names = missing.map((c) => LANGUAGES.find((l) => l.code === c)?.name ?? c).join(', ')
  return <p className="form-error pad">{m.name} doesn't understand {names}. Download Whisper Large v3 Turbo below and select it.</p>
}

function KeyField({ provider, kind }: { provider: string; kind: 'stt' | 'llm' }) {
  const keys = useKeys()
  const [value, setValue] = useState('')
  const [result, setResult] = useState('')
  const [busy, setBusy] = useState(false)
  const saved = !!keys?.[provider]
  const test = async (): Promise<void> => {
    setBusy(true)
    setResult('')
    try {
      if (value.trim()) await invoke('keys:set', provider, value)
      setValue('')
      setResult(await invoke<string>(kind === 'stt' ? 'keys:testStt' : 'keys:testLlm', provider))
    } catch (e) {
      setResult(clean(e))
    } finally {
      setBusy(false)
    }
  }
  const info = kind === 'stt' ? STT_PROVIDERS[provider as SttProvider] : LLM_PROVIDERS[provider as LlmProvider]
  return (
    <div className="key-field">
      <input type="password" value={value} placeholder={saved ? 'Key saved. Paste a new one to replace it.' : 'Paste your API key'} onChange={(e) => setValue(e.target.value)} aria-label={`${info.label} API key`} autoComplete="off" />
      <Button small variant="primary" onClick={() => void test()} disabled={busy}>
        {busy ? 'Checking…' : value ? 'Save and test' : 'Test'}
      </Button>
      {info.keyUrl && (
        <a href={info.keyUrl} target="_blank" rel="noreferrer" className="small">
          Get a key
        </a>
      )}
      {result && <p className="small key-result">{result}</p>}
    </div>
  )
}

function ProviderBlock({ kind, s, update }: { kind: 'stt' | 'llm'; s: Settings; update: Update }) {
  const table = kind === 'stt' ? STT_PROVIDERS : LLM_PROVIDERS
  const conf = kind === 'stt' ? s.stt : s.llm
  const provider = conf.provider as string
  const info = (table as Record<string, (typeof STT_PROVIDERS)['groq']>)[provider]
  const model = (conf.models as Record<string, string | undefined>)[provider] ?? (provider === 'local' ? (kind === 'stt' ? 'parakeet-v3' : 'qwen3-4b') : info.models[0] ?? '')
  const set = (patch: Partial<Settings['stt']> | Partial<Settings['llm']>): void => void update(kind === 'stt' ? { stt: { ...s.stt, ...(patch as Partial<Settings['stt']>) } } : { llm: { ...s.llm, ...(patch as Partial<Settings['llm']>) } })
  const setModel = (m: string): void => set({ models: { ...conf.models, [provider]: m } })
  return (
    <>
      <Row label="Provider" description={info.note}>
        <select value={provider} onChange={(e) => set({ provider: e.target.value as never })}>
          {Object.entries(table).map(([id, p]) => (
            <option key={id} value={id}>
              {p.label}
            </option>
          ))}
        </select>
      </Row>
      {provider === 'local' ? (
        <>
          {kind === 'stt' && <LanguageFit model={model} languages={s.languages} />}
          <ModelList kind={kind} selected={model} onSelect={setModel} />
        </>
      ) : provider !== 'off' ? (
        <>
          {(provider === 'custom' || provider === 'ollama' || provider === 'lmstudio') && (
            <Row label="Server URL" description="An OpenAI-compatible endpoint, ending in /v1.">
              <input
                defaultValue={provider === 'custom' ? conf.customBaseUrl : info.baseUrl}
                disabled={provider !== 'custom'}
                onBlur={(e) => set({ customBaseUrl: e.target.value.trim() })}
                placeholder="http://localhost:8080/v1"
              />
            </Row>
          )}
          <Row label="Model">
            <input list={`models-${kind}-${provider}`} value={model} onChange={(e) => setModel(e.target.value)} aria-label="Model name" />
            <datalist id={`models-${kind}-${provider}`}>
              {info.models.map((m) => (
                <option key={m} value={m} />
              ))}
            </datalist>
          </Row>
          {(info.needsKey || provider === 'custom') && (
            <div className="pad">
              <KeyField provider={provider} kind={kind} />
            </div>
          )}
          {!info.needsKey && provider !== 'custom' && (
            <div className="pad">
              <TestOnly kind={kind} provider={provider} />
            </div>
          )}
        </>
      ) : null}
    </>
  )
}

function TestOnly({ kind, provider }: { kind: 'stt' | 'llm'; provider: string }) {
  const [result, setResult] = useState('')
  return (
    <div className="key-field">
      <Button
        small
        onClick={async () => {
          try {
            setResult(await invoke<string>(kind === 'stt' ? 'keys:testStt' : 'keys:testLlm', provider))
          } catch (e) {
            setResult(clean(e))
          }
        }}
      >
        Test connection
      </Button>
      {result && <p className="small key-result">{result}</p>}
    </div>
  )
}

function Engine({ s, update }: { s: Settings; update: Update }) {
  const status = useEngineStatus()
  const mode = s.stt.provider === 'local' && (s.llm.provider === 'local' || s.llm.provider === 'off') ? 'local' : s.stt.provider !== 'local' && s.llm.provider !== 'local' ? 'cloud' : 'mixed'
  return (
    <>
      <Section title="Where Purr thinks">
        <div className="pad mode-pick">
          <Segmented
            label="Engine mode"
            value={mode}
            onChange={(m) => {
              if (m === 'local') void update({ stt: { ...s.stt, provider: 'local' }, llm: { ...s.llm, provider: 'local' } })
              if (m === 'cloud') void update({ stt: { ...s.stt, provider: 'groq' }, llm: { ...s.llm, provider: 'groq' } })
            }}
            options={[
              { value: 'local', label: 'On this computer' },
              { value: 'cloud', label: 'Cloud' },
              { value: 'mixed', label: 'Mixed' }
            ]}
          />
          <p className="muted small">
            {mode === 'local'
              ? 'Private and works offline. Your voice never leaves this computer.'
              : mode === 'cloud'
                ? 'Fastest and most accurate on hard audio. Audio goes to the provider you choose, using your own key.'
                : 'Speech and clean-up run in different places.'}
          </p>
        </div>
        {status && (
          <div className={`engine-status${status.problems.length ? ' warn' : ''}`}>
            <span className="mono small">Speech: {status.sttLabel}</span>
            <span className="mono small">AI: {status.llmLabel}</span>
            {status.problems.map((p) => (
              <span key={p} className="small">
                {p}
              </span>
            ))}
          </div>
        )}
      </Section>
      <Section title="Speech to text" description="Turns your voice into words.">
        <ProviderBlock kind="stt" s={s} update={update} />
      </Section>
      <Section title="AI clean-up" description="Fixes fumbles, formatting and tone. Also powers Command Mode and transforms.">
        <ProviderBlock kind="llm" s={s} update={update} />
      </Section>
    </>
  )
}

// ---------------- System / coding / privacy / experimental ----------------
function System({ s, update }: { s: Settings; update: Update }) {
  return (
    <Section title="System">
      <Toggle label="Open Purr when you log in" checked={s.launchAtLogin} onChange={(v) => void update({ launchAtLogin: v })} />
      <Toggle label="Show the Flow Bar at all times" description="When off, it only appears while you dictate." checked={s.showFlowBar} onChange={(v) => void update({ showFlowBar: v, flowBarHiddenUntil: 0 })} />
      <Row label="Hide the Flow Bar for an hour">
        {s.flowBarHiddenUntil > Date.now() ? (
          <Button small onClick={() => void update({ flowBarHiddenUntil: 0 })}>
            Show it now
          </Button>
        ) : (
          <Button small onClick={() => void update({ flowBarHiddenUntil: Date.now() + 3_600_000 })}>
            Hide for 1 hour
          </Button>
        )}
      </Row>
      {isMac && <Toggle label="Show Purr in the Dock" checked={s.showInDock} onChange={(v) => void update({ showInDock: v })} />}
      <Toggle label="Keep the microphone ready" description="Starts instantly and catches your first word. The mic stays on for a minute after each dictation." checked={s.keepMicWarm} onChange={(v) => void update({ keepMicWarm: v })} />
      <Row label="Longest dictation" description="Purr warns a minute before and then inserts what it has.">
        <select value={s.maxRecordingMinutes} onChange={(e) => void update({ maxRecordingMinutes: Number(e.target.value) })}>
          {[5, 10, 20, 30, 60].map((m) => (
            <option key={m} value={m}>
              {m} minutes
            </option>
          ))}
        </select>
      </Row>
    </Section>
  )
}

function Coding({ s, update }: { s: Settings; update: Update }) {
  return (
    <Section title="Vibe coding" description="Extra help in Cursor, Windsurf, VS Code, JetBrains, Xcode and terminals.">
      <Toggle
        label="Variable recognition"
        description='Writes code names the way they are written: "user id" becomes userId, "index dot ts" becomes index.ts.'
        checked={s.vibe.variableRecognition}
        onChange={(v) => void update({ vibe: { ...s.vibe, variableRecognition: v } })}
      />
      <Toggle
        label="File tagging in Cursor and Windsurf chat"
        description='Say "at app dot tsx" to tag @app.tsx.'
        checked={s.vibe.fileTagging}
        onChange={(v) => void update({ vibe: { ...s.vibe, fileTagging: v } })}
      />
    </Section>
  )
}

function Privacy({ s, update }: { s: Settings; update: Update }) {
  const [sync, setSync] = useState<{ folder: string; lastSync: number; error: string } | null>(null)
  const [confirm, setConfirm] = useState(false)
  useEffect(() => void invoke<typeof sync>('sync:status').then(setSync), [s.syncFolder])
  return (
    <>
      <Section title="History">
        <Toggle label="Save dictation history" description="Turn off for privacy mode. Nothing you say is kept after it's typed." checked={s.privacy.saveHistory} onChange={(v) => void update({ privacy: { ...s.privacy, saveHistory: v } })} />
        <Toggle
          label="Keep audio so you can transcribe again"
          checked={s.privacy.saveAudio}
          disabled={!s.privacy.saveHistory}
          onChange={(v) => void update({ privacy: { ...s.privacy, saveAudio: v } })}
        />
        <Row label="Delete audio after">
          <select value={s.privacy.audioRetentionDays} onChange={(e) => void update({ privacy: { ...s.privacy, audioRetentionDays: Number(e.target.value) } })}>
            {[1, 7, 14, 30].map((d) => (
              <option key={d} value={d}>
                {d} {d === 1 ? 'day' : 'days'}
              </option>
            ))}
          </select>
        </Row>
        <Row label="Delete all history" description="Removes every saved dictation and its audio. Your stats stay.">
          {confirm ? (
            <>
              <Button small variant="danger" onClick={() => (void invoke('history:clear'), setConfirm(false))}>
                Delete everything
              </Button>
              <Button small variant="quiet" onClick={() => setConfirm(false)}>
                Keep it
              </Button>
            </>
          ) : (
            <Button small onClick={() => setConfirm(true)}>
              Delete history
            </Button>
          )}
        </Row>
      </Section>
      <Section title="Sync across devices" description="Point Purr at a folder that iCloud Drive, OneDrive, Dropbox or Google Drive syncs. Your dictionary, snippets, transforms and notes follow you. Share the folder with your team for a shared dictionary.">
        <Row label={sync?.folder ? sync.folder : 'Not syncing'} description={sync?.error || (sync?.lastSync ? `Last synced ${new Date(sync.lastSync).toLocaleTimeString()}` : undefined)}>
          <Button small onClick={() => void invoke('sync:choose')}>
            {sync?.folder ? 'Change folder' : 'Choose folder'}
          </Button>
          {sync?.folder && (
            <>
              <Button small variant="quiet" onClick={() => void invoke<typeof sync>('sync:now').then(setSync)}>
                Sync now
              </Button>
              <Button small variant="quiet" onClick={() => void update({ syncFolder: '' })}>
                Stop syncing
              </Button>
            </>
          )}
        </Row>
      </Section>
      <Section title="Connect an AI assistant" description="Let Claude Desktop, ChatGPT, Cursor or any MCP client search what you've dictated, your notes and your dictionary. Read-only.">
        <McpRow />
      </Section>
      <Section title="Your data">
        <Row label="Export" description="Dictionary, snippets, notes, history and stats as one JSON file.">
          <Button small onClick={() => void invoke('data:export')}>
            Export
          </Button>
        </Row>
        <Row label="Import" description="Merge a Purr export into this computer.">
          <Button small onClick={() => void invoke('data:import')}>
            Import
          </Button>
        </Row>
        <Row label="Data folder">
          <Button small variant="quiet" onClick={() => void invoke('app:openDataFolder')}>
            Show in folder
          </Button>
        </Row>
      </Section>
    </>
  )
}

function McpRow() {
  const [copied, setCopied] = useState(false)
  return (
    <Row label="MCP server config" description="Paste this into your client's MCP settings (for Claude Desktop: claude_desktop_config.json).">
      <Button
        small
        onClick={async () => {
          const cfg = await invoke<unknown>('app:mcpConfig')
          await navigator.clipboard.writeText(JSON.stringify(cfg, null, 2))
          setCopied(true)
          setTimeout(() => setCopied(false), 2000)
        }}
      >
        {copied ? 'Copied' : 'Copy config'}
      </Button>
    </Row>
  )
}

function Experimental({ s, update }: { s: Settings; update: Update }) {
  return (
    <Section title="Experimental">
      <Toggle label="Command Mode" description="Hold the Command Mode shortcut and say what to do: “make this friendlier”, “reply saying I'm in”, “search flights to Goa”." checked={s.commandMode} onChange={(v) => void update({ commandMode: v })} />
      <Row label="Search with" description="Where Command Mode sends web searches.">
        <select value={s.searchEngine} onChange={(e) => void update({ searchEngine: e.target.value as Settings['searchEngine'] })}>
          <option value="perplexity">Perplexity</option>
          <option value="google">Google</option>
          <option value="chatgpt">ChatGPT</option>
        </select>
      </Row>
      <Toggle label="Learn words from your corrections" description="When you fix a word after Purr types it, add it to your dictionary." checked={s.autoLearnWords} onChange={(v) => void update({ autoLearnWords: v })} />
      <Toggle label="Add a space after each dictation" checked={s.addTrailingSpace} onChange={(v) => void update({ addTrailingSpace: v })} />
      <Toggle label="Leave the transcript on the clipboard" description="Normally Purr puts back whatever you had copied." checked={s.keepTranscriptInClipboard} onChange={(v) => void update({ keepTranscriptInClipboard: v })} />
    </Section>
  )
}

function About() {
  const [info, setInfo] = useState<{ version: string; platform: string; userData: string } | null>(null)
  const [perm, reloadPerm] = usePermissions()
  useEffect(() => void invoke<typeof info>('app:info').then(setInfo), [])
  return (
    <>
      <Section title="Permissions">
        <Row label="Microphone" description={perm?.microphone}>
          <Button small onClick={() => void invoke('perm:request', 'microphone').then(reloadPerm)}>
            Open settings
          </Button>
        </Row>
        {isMac && (
          <Row label="Accessibility" description={perm?.accessibility ? 'Granted' : 'Needed to paste text and use shortcuts'}>
            <Button small onClick={() => void invoke('perm:request', 'accessibility').then(reloadPerm)}>
              Open settings
            </Button>
          </Row>
        )}
        <Row label="Keyboard shortcuts" description={perm?.keyboardHook ? 'Working' : 'Not working. Check permissions and restart Purr.'}>
          <span className={`dot ${perm?.keyboardHook ? 'dot-ok' : 'dot-warn'}`} />
        </Row>
      </Section>
      <Section title="About Purr">
        <div className="pad about">
          <p>
            Purr {info?.version} · {info?.platform}
          </p>
          <p>
            <Button small variant="primary" onClick={() => void invoke('app:openExternal', FEEDBACK_URL)}>
              Send feedback
            </Button>
          </p>
          <p className="muted small">
            Speech recognition by sherpa-onnx with NVIDIA Parakeet (CC-BY-4.0) and OpenAI Whisper (MIT) models. Local AI by llama.cpp via node-llama-cpp with Qwen (Apache-2.0) and Llama 3.2 (Llama Community License). Keyboard hooks by
            libuiohook. Purr is an independent project and is not affiliated with Wispr.
          </p>
        </div>
      </Section>
    </>
  )
}

export function SettingsPage({ tab, onTab }: { tab?: string; onTab: (t: string) => void }) {
  const [s, update] = useSettings()
  const active = TABS.find((t) => t.id === tab)?.id ?? 'general'
  if (!s) return null
  return (
    <Page title="Settings">
      <div className="tabs" role="tablist">
        {TABS.map((t) => (
          <button key={t.id} role="tab" aria-selected={active === t.id} className={active === t.id ? 'on' : ''} onClick={() => onTab(t.id)}>
            {t.label}
          </button>
        ))}
      </div>
      {active === 'general' && <General s={s} update={update} />}
      {active === 'engine' && <Engine s={s} update={update} />}
      {active === 'system' && <System s={s} update={update} />}
      {active === 'coding' && <Coding s={s} update={update} />}
      {active === 'privacy' && <Privacy s={s} update={update} />}
      {active === 'experimental' && <Experimental s={s} update={update} />}
      {active === 'about' && <About />}
    </Page>
  )
}
