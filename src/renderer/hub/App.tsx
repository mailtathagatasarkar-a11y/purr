import { useEffect, useState, type ReactNode } from 'react'
import { purr, useEngineStatus, useSettings } from './api'
import { Keycaps } from './ui'
import { Home } from './pages/Home'
import { Dictionary } from './pages/Dictionary'
import { Snippets } from './pages/Snippets'
import { Style } from './pages/Style'
import { Transforms } from './pages/Transforms'
import { Notes } from './pages/Notes'
import { Insights } from './pages/Insights'
import { SettingsPage } from './pages/Settings'
import { Welcome } from './pages/Welcome'

function useRoute(): [string, (r: string) => void] {
  const read = (): string => decodeURIComponent(location.hash.replace(/^#\/?/, ''))
  const [route, setRoute] = useState(read)
  useEffect(() => {
    const onHash = (): void => setRoute(read())
    window.addEventListener('hashchange', onHash)
    const off = purr.on('nav', (r: string) => {
      location.hash = `/${r}`
    })
    return () => {
      window.removeEventListener('hashchange', onHash)
      off()
    }
  }, [])
  return [route, (r) => (location.hash = `/${r}`)]
}

const NAV: { id: string; label: string; icon: ReactNode }[] = [
  { id: '', label: 'Home', icon: <path d="M3 9.5 10 4l7 5.5V16a1 1 0 0 1-1 1h-3.5v-4.5h-5V17H4a1 1 0 0 1-1-1Z" /> },
  { id: 'dictionary', label: 'Dictionary', icon: <path d="M5 3.5h9.5v13H5a1.5 1.5 0 0 1-1.5-1.5V5A1.5 1.5 0 0 1 5 3.5Zm0 10.5h9.5M7 7h5" /> },
  { id: 'snippets', label: 'Snippets', icon: <path d="M4 6.5h12M4 10h8M4 13.5h10M14.5 11.5l2 2-2 2" /> },
  { id: 'style', label: 'Style', icon: <path d="M4 16 13 7l2 2-9 9H4Zm7-7 2 2M13.5 4.5l2-1 1 1-1 2" /> },
  { id: 'transforms', label: 'Transforms', icon: <path d="M10 3v3M10 14v3M3 10h3M14 10h3M5.2 5.2l2 2M12.8 12.8l2 2M14.8 5.2l-2 2M7.2 12.8l-2 2" /> },
  { id: 'notes', label: 'Notes', icon: <path d="M5 3.5h7l3.5 3.5v9.5H5Zm7 0V7h3.5M7.5 10.5h5M7.5 13.5h3" /> },
  { id: 'insights', label: 'Insights', icon: <path d="M4 16V9m4 7V5m4 11v-5m4 5V8" /> }
]

export function App() {
  const [route, go] = useRoute()
  const [settings] = useSettings()
  const status = useEngineStatus()
  const [page, sub] = route.split('/')

  if (page === 'scratchpad') {
    return (
      <div className="scratch-shell">
        <div className="titlebar-drag" />
        <Notes compact />
      </div>
    )
  }
  if (page === 'welcome' || (settings && !settings.onboarded && page !== 'settings')) {
    return (
      <div className="welcome-shell">
        <div className="titlebar-drag" />
        <Welcome onDone={() => go('')} />
      </div>
    )
  }

  let content: ReactNode
  switch (page) {
    case 'dictionary':
      content = <Dictionary />
      break
    case 'snippets':
      content = <Snippets />
      break
    case 'style':
      content = <Style />
      break
    case 'transforms':
      content = <Transforms />
      break
    case 'notes':
      content = <Notes />
      break
    case 'insights':
      content = <Insights />
      break
    case 'settings':
      content = <SettingsPage tab={sub} onTab={(t) => go(`settings/${t}`)} />
      break
    default:
      content = <Home go={go} />
  }

  const ok = status && status.problems.length === 0
  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="titlebar-drag" />
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            <i />
            <i />
            <i />
            <i />
          </span>
          <span className="brand-name">Purr</span>
        </div>
        <nav aria-label="Sections">
          {NAV.map((n) => (
            <a key={n.id} href={`#/${n.id}`} className={page === n.id || (!page && !n.id) ? 'active' : ''} aria-current={page === n.id ? 'page' : undefined}>
              <svg viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                {n.icon}
              </svg>
              {n.label}
            </a>
          ))}
        </nav>
        <div className="sidebar-foot">
          <a href="#/settings" className={page === 'settings' ? 'active' : ''}>
            <svg viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
              <circle cx="10" cy="10" r="2.5" />
              <path d="M10 2.5v2M10 15.5v2M2.5 10h2M15.5 10h2M4.7 4.7l1.4 1.4M13.9 13.9l1.4 1.4M15.3 4.7l-1.4 1.4M6.1 13.9l-1.4 1.4" />
            </svg>
            Settings
            {status && !ok && <span className="dot dot-warn" aria-label="Needs attention" />}
          </a>
          {settings && (
            <div className="talk-hint">
              <span className="muted">Hold to talk</span>
              <Keycaps chord={settings.hotkeys.pushToTalk?.[0]} size="sm" />
            </div>
          )}
        </div>
      </aside>
      <main className="content">
        <div className="titlebar-drag" />
        {content}
      </main>
    </div>
  )
}
