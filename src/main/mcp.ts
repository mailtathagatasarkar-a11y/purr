// Purr MCP server (stdio). Lets Claude, ChatGPT, Cursor or any MCP client read your
// dictation history, notes and dictionary. Read-only. Runs with Electron as Node:
//   command: <Purr executable>, args: [<path to mcp.js>], env: { ELECTRON_RUN_AS_NODE: "1" }

import fs from 'fs'
import os from 'os'
import path from 'path'
import readline from 'readline'
import type { HistoryItem, Library } from '../shared/types'

function dataDir(): string {
  if (process.env.PURR_DATA) return process.env.PURR_DATA
  if (process.platform === 'win32') return path.join(process.env.APPDATA ?? path.join(os.homedir(), 'AppData', 'Roaming'), 'Purr')
  if (process.platform === 'darwin') return path.join(os.homedir(), 'Library', 'Application Support', 'Purr')
  return path.join(process.env.XDG_CONFIG_HOME ?? path.join(os.homedir(), '.config'), 'Purr')
}

function read<T>(file: string, fallback: T): T {
  try {
    return JSON.parse(fs.readFileSync(path.join(dataDir(), file), 'utf8')) as T
  } catch {
    return fallback
  }
}

const history = (): HistoryItem[] => read<HistoryItem[]>('history.json', [])
const library = (): Library => read<Library>('library.json', { dictionary: [], snippets: [], transforms: [], notes: [] })

function slim(h: HistoryItem): Record<string, unknown> {
  return { id: h.id, when: new Date(h.at).toISOString(), app: h.app, kind: h.mode, text: h.text, ...(h.instruction ? { instruction: h.instruction } : {}) }
}

const TOOLS = [
  {
    name: 'search_dictations',
    description: 'Search the text the user dictated with Purr (newest first).',
    inputSchema: { type: 'object', properties: { query: { type: 'string' }, limit: { type: 'number' } }, required: ['query'] }
  },
  {
    name: 'recent_dictations',
    description: 'The most recent things the user dictated, optionally only from one app (e.g. "Slack").',
    inputSchema: { type: 'object', properties: { limit: { type: 'number' }, app: { type: 'string' } } }
  },
  {
    name: 'list_notes',
    description: 'List the user\'s Purr notes (scratchpad), optionally filtered by a search query.',
    inputSchema: { type: 'object', properties: { query: { type: 'string' } } }
  },
  {
    name: 'read_note',
    description: 'Read one Purr note in full.',
    inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] }
  },
  {
    name: 'dictionary',
    description: 'The user\'s personal dictionary: names, jargon and spellings they care about.',
    inputSchema: { type: 'object', properties: {} }
  }
]

function call(name: string, args: Record<string, unknown>): unknown {
  const limit = Math.min(100, Math.max(1, Number(args.limit ?? 20)))
  switch (name) {
    case 'search_dictations': {
      const q = String(args.query ?? '').toLowerCase()
      return history()
        .filter((h) => h.text.toLowerCase().includes(q))
        .slice(0, limit)
        .map(slim)
    }
    case 'recent_dictations': {
      const app = args.app ? String(args.app).toLowerCase() : ''
      return history()
        .filter((h) => !app || h.app.toLowerCase().includes(app))
        .slice(0, limit)
        .map(slim)
    }
    case 'list_notes': {
      const q = String(args.query ?? '').toLowerCase()
      return library()
        .notes.filter((n) => !n.deleted && (!q || `${n.title} ${n.body}`.toLowerCase().includes(q)))
        .map((n) => ({ id: n.id, title: n.title || n.body.slice(0, 60), updated: new Date(n.updatedAt).toISOString(), preview: n.body.slice(0, 200) }))
    }
    case 'read_note': {
      const n = library().notes.find((x) => x.id === args.id && !x.deleted)
      if (!n) throw new Error('No note with that id.')
      return { id: n.id, title: n.title, body: n.body, updated: new Date(n.updatedAt).toISOString() }
    }
    case 'dictionary':
      return library()
        .dictionary.filter((d) => !d.deleted)
        .map((d) => (d.misspelling ? `${d.word} (replaces "${d.misspelling}")` : d.word))
    default:
      throw new Error(`Unknown tool ${name}`)
  }
}

type Req = { jsonrpc: '2.0'; id?: number | string; method: string; params?: Record<string, unknown> }

function reply(id: Req['id'], result?: unknown, error?: { code: number; message: string }): void {
  if (id === undefined) return
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, ...(error ? { error } : { result }) }) + '\n')
}

const rl = readline.createInterface({ input: process.stdin })
rl.on('line', (line) => {
  let req: Req
  try {
    req = JSON.parse(line) as Req
  } catch {
    return
  }
  try {
    if (req.method === 'initialize') {
      reply(req.id, {
        protocolVersion: (req.params?.protocolVersion as string) ?? '2025-06-18',
        capabilities: { tools: {} },
        serverInfo: { name: 'purr', version: '0.1.0' },
        instructions: 'Read-only access to what the user dictated with Purr, plus their notes and dictionary.'
      })
    } else if (req.method === 'tools/list') reply(req.id, { tools: TOOLS })
    else if (req.method === 'tools/call') {
      const name = String(req.params?.name)
      try {
        const out = call(name, (req.params?.arguments as Record<string, unknown>) ?? {})
        reply(req.id, { content: [{ type: 'text', text: JSON.stringify(out, null, 1) }] })
      } catch (err) {
        reply(req.id, { content: [{ type: 'text', text: (err as Error).message }], isError: true })
      }
    } else if (req.method === 'ping') reply(req.id, {})
    else if (!req.method.startsWith('notifications/')) reply(req.id, undefined, { code: -32601, message: `Method not found: ${req.method}` })
  } catch (err) {
    reply(req.id, undefined, { code: -32603, message: (err as Error).message })
  }
})
