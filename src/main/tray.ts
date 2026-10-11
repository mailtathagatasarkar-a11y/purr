import { app, Menu, nativeImage, Tray } from 'electron'
import path from 'path'
import fs from 'fs'

export interface TrayActions {
  openHub: (route?: string) => void
  startDictation: () => void
  pasteLast: () => void
  scratchpad: () => void
  hideBarForHour: () => void
  showBar: () => void
  barHidden: () => boolean
  quit: () => void
}

function icon(): Electron.NativeImage {
  const dir = path.join(app.getAppPath(), 'resources')
  const file = process.platform === 'darwin' ? 'trayTemplate.png' : 'tray.png'
  const p = path.join(dir, file)
  if (!fs.existsSync(p)) return nativeImage.createEmpty()
  const img = nativeImage.createFromPath(p)
  if (process.platform === 'darwin') img.setTemplateImage(true)
  return img
}

export function createTray(a: TrayActions): { tray: Tray; refresh: () => void } {
  const tray = new Tray(icon())
  tray.setToolTip('Purr')
  const refresh = (): void => {
    tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: 'Open Purr', click: () => a.openHub() },
        { label: 'Start dictation (hands-free)', click: () => a.startDictation() },
        { label: 'Paste last transcript', click: () => a.pasteLast() },
        { label: 'Scratchpad', click: () => a.scratchpad() },
        { type: 'separator' },
        a.barHidden() ? { label: 'Show Flow Bar', click: () => (a.showBar(), refresh()) } : { label: 'Hide Flow Bar for 1 hour', click: () => (a.hideBarForHour(), refresh()) },
        { label: 'Settings…', click: () => a.openHub('settings') },
        { type: 'separator' },
        { label: 'Quit Purr', click: () => a.quit() }
      ])
    )
  }
  refresh()
  tray.on('click', () => (process.platform === 'win32' ? a.openHub() : undefined))
  return { tray, refresh }
}
