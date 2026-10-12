// Putting text into the focused app, and reading what's selected there.
// Like Wispr Flow: briefly use the clipboard, paste, then restore what was there.

import { clipboard, ClipboardItem } from 'electron'
import { sendCopy, sendPaste, sendSelectAll, sendTerminalCopy } from './native/keys'

type ClipSnapshot = Record<string, Blob> | null

/** null = couldn't read the clipboard (locked by another app); restoring then must not clear it. */
async function snapshot(): Promise<ClipSnapshot> {
  const out: Record<string, Blob> = {}
  try {
    for (const item of await clipboard.read()) {
      for (const type of item.types) {
        if (out[type] || type === 'electron application/bookmark') continue
        try {
          const v = await item.getType(type)
          if (v instanceof Blob) out[type] = v
        } catch {
          // format vanished while reading
        }
      }
    }
  } catch (err) {
    console.warn('[clipboard] snapshot failed', err)
    return null
  }
  return out
}

async function restore(s: ClipSnapshot): Promise<void> {
  if (s === null) return
  try {
    if (Object.keys(s).length === 0) clipboard.clear()
    else await clipboard.write([new ClipboardItem(s)])
  } catch (err) {
    console.warn('[clipboard] restore failed', err)
  }
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

let modifiersDown: () => boolean = () => false
export function setModifierProbe(fn: () => boolean): void {
  modifiersDown = fn
}

/** Don't inject Ctrl+V while the user still physically holds Ctrl+Win (it would become Ctrl+Win+V). */
async function waitForModifiers(maxMs = 1200): Promise<void> {
  const until = Date.now() + maxMs
  while (modifiersDown() && Date.now() < until) await sleep(15)
  await sleep(30)
}

let restoreTimer: NodeJS.Timeout | null = null
let pendingRestore: ClipSnapshot | null = null

export interface PasteOptions {
  pasteWith: 'paste' | 'shiftInsert'
  keepInClipboard: boolean
}

const debug = (...a: unknown[]): void => {
  if (process.env.PURR_DEBUG) console.log('[paste]', Date.now() % 100000, ...a)
}

export async function pasteText(text: string, opts: PasteOptions): Promise<void> {
  // If a previous paste hasn't restored yet, keep the original clipboard, not our text.
  const original = pendingRestore ?? (await snapshot())
  if (restoreTimer) clearTimeout(restoreTimer)
  pendingRestore = original
  debug('snapshot types', original ? Object.keys(original) : 'unreadable')
  await clipboard.writeText(text)
  debug('wrote', JSON.stringify(text.slice(0, 40)), 'readback ok:', (await clipboard.readText()) === text)
  await waitForModifiers()
  debug('modifiers clear, sending', opts.pasteWith)
  sendPaste(opts.pasteWith)
  if (opts.keepInClipboard) {
    pendingRestore = null
    return
  }
  // Give the target app time to read the clipboard (remote desktops need longer).
  restoreTimer = setTimeout(
    async () => {
      restoreTimer = null
      if ((await clipboard.readText()) === text) await restore(original)
      pendingRestore = null
    },
    process.platform === 'win32' ? 900 : 600
  )
}

async function isVsCodeEmptySelection(): Promise<boolean> {
  try {
    for (const item of await clipboard.read()) {
      const type = item.types.find((t) => t.includes('vscode-editor-data'))
      if (!type) continue
      const blob = await item.getType(type)
      if (blob instanceof Blob) {
        const meta = JSON.parse(await blob.text()) as { isFromEmptySelection?: boolean }
        return !!meta.isFromEmptySelection
      }
    }
  } catch {
    // not VS Code
  }
  return false
}

/** Copy the selection with a simulated Ctrl/Cmd+C, then put the clipboard back. */
export async function readSelection(opts: { selectAllIfEmpty?: boolean; terminal?: boolean } = {}): Promise<{ text: string; wholeField: boolean }> {
  const original = pendingRestore ?? (await snapshot())
  if (restoreTimer) clearTimeout(restoreTimer)
  restoreTimer = null
  await waitForModifiers()
  const marker = `⁣purr-${Date.now()}`
  const read = async (): Promise<string> => {
    await clipboard.writeText(marker)
    // In a terminal Ctrl+C interrupts the running program; Ctrl+Insert copies instead.
    if (opts.terminal) sendTerminalCopy()
    else sendCopy()
    for (let i = 0; i < 25; i++) {
      await sleep(16)
      const t = await clipboard.readText()
      if (t !== marker) return (await isVsCodeEmptySelection()) ? '' : t
    }
    return ''
  }
  let text = await read()
  let wholeField = false
  if (!text.trim() && opts.selectAllIfEmpty) {
    sendSelectAll()
    await sleep(40)
    text = await read()
    wholeField = !!text.trim()
  }
  await restore(original)
  pendingRestore = null
  return { text, wholeField }
}
