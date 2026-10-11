import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'

const INVOKE = /^(app|settings|keys|engine|library|dict|snip|tf|note|history|stats|models|hotkeys|perm|dictate|file|text|sync|data):/
const SEND = /^(bar:|rec:result)/
const LISTEN = /^(settings|library|history|stats|keys|models|nav|bar:|rec:)/

contextBridge.exposeInMainWorld('purr', {
  platform: process.platform,
  invoke: (channel: string, ...args: unknown[]) => {
    if (!INVOKE.test(channel)) throw new Error(`Blocked channel ${channel}`)
    return ipcRenderer.invoke(channel, ...args)
  },
  send: (channel: string, ...args: unknown[]) => {
    if (SEND.test(channel)) ipcRenderer.send(channel, ...args)
  },
  on: (channel: string, cb: (...args: unknown[]) => void) => {
    if (!LISTEN.test(channel)) return () => undefined
    const listener = (_e: IpcRendererEvent, ...args: unknown[]): void => cb(...args)
    ipcRenderer.on(channel, listener)
    return () => ipcRenderer.off(channel, listener)
  }
})
