import { useState, type ReactNode } from 'react'
import { chordText, invoke } from './api'

export function Page({ title, lead, actions, children, narrow }: { title: string; lead?: ReactNode; actions?: ReactNode; children: ReactNode; narrow?: boolean }) {
  return (
    <div className={`page${narrow ? ' page-narrow' : ''}`}>
      <header className="page-head">
        <div>
          <h1>{title}</h1>
          {lead && <p className="lead">{lead}</p>}
        </div>
        {actions && <div className="page-actions">{actions}</div>}
      </header>
      {children}
    </div>
  )
}

export function Section({ title, description, children, aside }: { title?: string; description?: ReactNode; children: ReactNode; aside?: ReactNode }) {
  return (
    <section className="section">
      {(title || aside) && (
        <div className="section-head">
          <div>
            {title && <h2>{title}</h2>}
            {description && <p className="muted">{description}</p>}
          </div>
          {aside}
        </div>
      )}
      <div className="panel">{children}</div>
    </section>
  )
}

export function Button({
  children,
  variant = 'ghost',
  onClick,
  disabled,
  type = 'button',
  title,
  small
}: {
  children: ReactNode
  variant?: 'primary' | 'ghost' | 'quiet' | 'danger'
  onClick?: () => void
  disabled?: boolean
  type?: 'button' | 'submit'
  title?: string
  small?: boolean
}) {
  return (
    <button type={type} className={`btn btn-${variant}${small ? ' btn-small' : ''}`} onClick={onClick} disabled={disabled} title={title}>
      {children}
    </button>
  )
}

export function Toggle({ label, description, checked, onChange, disabled }: { label: ReactNode; description?: ReactNode; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <label className={`row toggle-row${disabled ? ' disabled' : ''}`}>
      <span className="row-text">
        <span className="row-label">{label}</span>
        {description && <span className="row-desc">{description}</span>}
      </span>
      <input type="checkbox" role="switch" className="switch" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
    </label>
  )
}

export function Row({ label, description, children }: { label: ReactNode; description?: ReactNode; children: ReactNode }) {
  return (
    <div className="row">
      <span className="row-text">
        <span className="row-label">{label}</span>
        {description && <span className="row-desc">{description}</span>}
      </span>
      <span className="row-control">{children}</span>
    </div>
  )
}

export function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; label: string }) {
  return (
    <div className="segmented" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} role="radio" aria-checked={value === o.value} className={value === o.value ? 'on' : ''} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function Keycaps({ chord, size }: { chord: string[] | undefined; size?: 'sm' }) {
  const keys = chordText(chord)
  if (!keys.length) return <span className="muted">Not set</span>
  return (
    <span className={`keycaps${size === 'sm' ? ' keycaps-sm' : ''}`}>
      {keys.map((k, i) => (
        <kbd key={i}>{k}</kbd>
      ))}
    </span>
  )
}

/** The loudness outline of a dictation: Purr's signature. */
export function Voiceprint({ wave, height = 22, accent, width }: { wave?: number[]; height?: number; accent?: boolean; width?: number }) {
  const w = wave?.length ? wave : []
  const n = w.length || 24
  const bw = 2
  const gap = 1.5
  const total = width ?? n * (bw + gap)
  return (
    <svg
      className={`voiceprint${accent ? ' accent' : ''}${w.length ? '' : ' empty'}`}
      style={{ height, width: width === undefined ? total : undefined }}
      viewBox={`0 0 ${n * (bw + gap)} ${height}`}
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      {Array.from({ length: n }, (_, i) => {
        const v = w.length ? Math.max(0.08, w[i]) : 0.08
        const h = v * height
        return <rect key={i} x={i * (bw + gap)} y={(height - h) / 2} width={bw} height={h} rx={1} />
      })}
    </svg>
  )
}

export function Empty({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty">
      <h3>{title}</h3>
      {children && <p className="muted">{children}</p>}
      {action}
    </div>
  )
}

export function ShortcutField({ chords, onChange, allowClear = true }: { chords: string[][] | undefined; onChange: (c: string[][]) => void; allowClear?: boolean }) {
  const [recording, setRecording] = useState(false)
  const record = async (): Promise<void> => {
    setRecording(true)
    try {
      const chord = await invoke<string[]>('hotkeys:record')
      if (chord.length) onChange([chord])
    } finally {
      setRecording(false)
    }
  }
  return (
    <span className="shortcut-field">
      {recording ? <span className="recording-hint">Press the keys…</span> : <Keycaps chord={chords?.[0]} />}
      {recording ? (
        <Button small variant="quiet" onClick={() => void invoke('hotkeys:cancelRecord')}>
          Cancel
        </Button>
      ) : (
        <Button small onClick={() => void record()}>
          Change
        </Button>
      )}
      {allowClear && !recording && chords?.[0]?.length ? (
        <Button small variant="quiet" onClick={() => onChange([])} title="Remove shortcut">
          Remove
        </Button>
      ) : null}
    </span>
  )
}

export function Progress({ value }: { value: number }) {
  return (
    <span className="progress" role="progressbar" aria-valuenow={Math.round(value * 100)} aria-valuemin={0} aria-valuemax={100}>
      <span style={{ width: `${Math.max(2, value * 100)}%` }} />
    </span>
  )
}
