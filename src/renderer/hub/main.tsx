import { createRoot } from 'react-dom/client'
import '@fontsource-variable/bricolage-grotesque'
import '@fontsource-variable/jetbrains-mono'
import './hub.css'
import { App } from './App'

document.documentElement.dataset.platform = window.purr.platform
createRoot(document.getElementById('root') as HTMLElement).render(<App />)
