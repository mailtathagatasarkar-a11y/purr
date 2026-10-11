// Which app is the user dictating into?

import { execFile } from 'child_process'
import { classifyApp } from '../../shared/apps'
import type { AppContext } from '../../shared/types'
import { foregroundWindow } from './win32'
import type { Helper } from './helper'

let helperRef: Helper | null = null
export function useHelperForContext(h: Helper | null): void {
  helperRef = h
}

function osascript(script: string): Promise<string> {
  return new Promise((resolve) => {
    execFile('osascript', ['-e', script], { timeout: 800 }, (err, stdout) => resolve(err ? '' : stdout.trim()))
  })
}

export async function getAppContext(): Promise<AppContext> {
  try {
    if (process.platform === 'win32') {
      const fg = foregroundWindow()
      if (fg) return classifyApp(fg.exe, fg.title)
    } else if (process.platform === 'darwin') {
      if (helperRef?.running) {
        const r = await helperRef.request<{ bundleId?: string; name?: string; title?: string }>('frontmost', {}, 400)
        if (r?.bundleId || r?.name) return classifyApp(r.bundleId || r.name || '', r.title ?? '', r.name)
      }
      const out = await osascript(
        'tell application "System Events" to set p to first application process whose frontmost is true\n' +
          'set t to ""\ntry\nset t to name of front window of p\nend try\n' +
          'return (bundle identifier of p) & "\t" & (name of p) & "\t" & t'
      )
      const [bundle, name, title] = out.split('\t')
      if (bundle || name) return classifyApp(bundle || name, title ?? '', name)
    }
  } catch (err) {
    console.warn('[context] failed', err)
  }
  return classifyApp('', '')
}
