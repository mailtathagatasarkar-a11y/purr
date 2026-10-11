// Local model catalog and downloader. Files come straight from Hugging Face.

import { EventEmitter } from 'events'
import fs from 'fs'
import path from 'path'
import { Readable } from 'stream'
import { pipeline } from 'stream/promises'
import { Transform as StreamTransform } from 'stream'
import type { ModelInfo } from '../shared/types'

export type SttModelType = 'parakeet' | 'whisper' | 'moonshine' | 'sensevoice'

export interface SttModelDef {
  id: string
  name: string
  description: string
  languages: string
  type: SttModelType
  repo: string
  files: Record<string, string> // role -> file name in the repo
  sizeMB: number
  recommended?: boolean
  multilingual: boolean
  /** ISO codes it understands; undefined = everything Whisper knows. */
  langs?: string[]
}

export interface LlmModelDef {
  id: string
  name: string
  description: string
  url: string
  file: string
  sizeMB: number
  recommended?: boolean
}

const HF = 'https://huggingface.co'

export const STT_MODELS: SttModelDef[] = [
  {
    id: 'parakeet-v3',
    name: 'Parakeet v3',
    description: 'Fastest and most accurate for English and European languages.',
    languages: 'English + 24 European',
    type: 'parakeet',
    repo: 'csukuangfj/sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8',
    files: { encoder: 'encoder.int8.onnx', decoder: 'decoder.int8.onnx', joiner: 'joiner.int8.onnx', tokens: 'tokens.txt' },
    sizeMB: 670,
    recommended: true,
    multilingual: true,
    langs: ['en', 'bg', 'hr', 'cs', 'da', 'nl', 'et', 'fi', 'fr', 'de', 'el', 'hu', 'it', 'lv', 'lt', 'mt', 'pl', 'pt', 'ro', 'sk', 'sl', 'es', 'sv', 'ru', 'uk']
  },
  {
    id: 'whisper-turbo',
    name: 'Whisper Large v3 Turbo',
    description: 'Best for Hindi, Bengali, Asian and other languages. Slower on older laptops.',
    languages: '99 languages',
    type: 'whisper',
    repo: 'csukuangfj/sherpa-onnx-whisper-turbo',
    files: { encoder: 'turbo-encoder.int8.onnx', decoder: 'turbo-decoder.int8.onnx', tokens: 'turbo-tokens.txt' },
    sizeMB: 1040,
    multilingual: true
  },
  {
    id: 'whisper-small',
    name: 'Whisper Small',
    description: 'Lighter and faster multilingual model.',
    languages: '99 languages',
    type: 'whisper',
    repo: 'csukuangfj/sherpa-onnx-whisper-small',
    files: { encoder: 'small-encoder.int8.onnx', decoder: 'small-decoder.int8.onnx', tokens: 'small-tokens.txt' },
    sizeMB: 375,
    multilingual: true
  },
  {
    id: 'moonshine-base',
    name: 'Moonshine Base',
    description: 'Tiny and very fast.',
    languages: 'English',
    type: 'moonshine',
    repo: 'csukuangfj/sherpa-onnx-moonshine-base-en-int8',
    files: {
      preprocessor: 'preprocess.onnx',
      encoder: 'encode.int8.onnx',
      uncachedDecoder: 'uncached_decode.int8.onnx',
      cachedDecoder: 'cached_decode.int8.onnx',
      tokens: 'tokens.txt'
    },
    sizeMB: 287,
    multilingual: false,
    langs: ['en']
  },
  {
    id: 'sensevoice',
    name: 'SenseVoice',
    description: 'Fast and accurate for East Asian languages.',
    languages: 'zh, yue, en, ja, ko',
    type: 'sensevoice',
    repo: 'csukuangfj/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2025-09-09',
    files: { model: 'model.int8.onnx', tokens: 'tokens.txt' },
    sizeMB: 237,
    multilingual: true,
    langs: ['zh', 'yue', 'en', 'ja', 'ko']
  }
]

export const LLM_MODELS: LlmModelDef[] = [
  {
    id: 'qwen3-4b',
    name: 'Qwen3 4B Instruct',
    description: 'Best local clean-up quality. Needs about 3 GB of memory.',
    url: `${HF}/unsloth/Qwen3-4B-Instruct-2507-GGUF/resolve/main/Qwen3-4B-Instruct-2507-Q4_K_M.gguf`,
    file: 'Qwen3-4B-Instruct-2507-Q4_K_M.gguf',
    sizeMB: 2497,
    recommended: true
  },
  {
    id: 'llama-3.2-3b',
    name: 'Llama 3.2 3B Instruct',
    description: 'Good balance of speed and quality.',
    url: `${HF}/bartowski/Llama-3.2-3B-Instruct-GGUF/resolve/main/Llama-3.2-3B-Instruct-Q4_K_M.gguf`,
    file: 'Llama-3.2-3B-Instruct-Q4_K_M.gguf',
    sizeMB: 2019
  },
  {
    id: 'qwen2.5-1.5b',
    name: 'Qwen2.5 1.5B Instruct',
    description: 'Lightweight, for older laptops. Handles fillers and punctuation; weaker at backtracking.',
    url: `${HF}/bartowski/Qwen2.5-1.5B-Instruct-GGUF/resolve/main/Qwen2.5-1.5B-Instruct-Q4_K_M.gguf`,
    file: 'Qwen2.5-1.5B-Instruct-Q4_K_M.gguf',
    sizeMB: 986
  }
]

export class ModelManager extends EventEmitter<{ change: [] }> {
  private progress = new Map<string, { received: number; total: number; abort: AbortController }>()

  constructor(private root: string) {
    super()
  }

  sttDir(id: string): string {
    return path.join(this.root, 'stt', id)
  }

  llmFile(id: string): string {
    const def = LLM_MODELS.find((m) => m.id === id)
    return path.join(this.root, 'llm', def?.file ?? `${id}.gguf`)
  }

  sttInstalled(id: string): boolean {
    const def = STT_MODELS.find((m) => m.id === id)
    if (!def) return false
    return Object.values(def.files).every((f) => fs.existsSync(path.join(this.sttDir(id), f)))
  }

  llmInstalled(id: string): boolean {
    return fs.existsSync(this.llmFile(id))
  }

  /** Absolute paths for each role of an installed STT model. */
  sttPaths(id: string): Record<string, string> | null {
    const def = STT_MODELS.find((m) => m.id === id)
    if (!def || !this.sttInstalled(id)) return null
    return Object.fromEntries(Object.entries(def.files).map(([role, f]) => [role, path.join(this.sttDir(id), f)]))
  }

  list(kind: 'stt' | 'llm'): ModelInfo[] {
    const defs = kind === 'stt' ? STT_MODELS : LLM_MODELS
    return defs.map((d) => {
      const p = this.progress.get(`${kind}:${d.id}`)
      return {
        id: d.id,
        name: d.name,
        description: d.description,
        sizeMB: d.sizeMB,
        languages: 'languages' in d ? d.languages : '',
        recommended: d.recommended,
        installed: kind === 'stt' ? this.sttInstalled(d.id) : this.llmInstalled(d.id),
        langs: 'langs' in d ? d.langs : undefined,
        downloading: p ? { received: p.received, total: p.total } : undefined
      }
    })
  }

  isDownloading(kind: 'stt' | 'llm', id: string): boolean {
    return this.progress.has(`${kind}:${id}`)
  }

  cancel(kind: 'stt' | 'llm', id: string): void {
    this.progress.get(`${kind}:${id}`)?.abort.abort()
  }

  remove(kind: 'stt' | 'llm', id: string): void {
    if (kind === 'stt') fs.rmSync(this.sttDir(id), { recursive: true, force: true })
    else fs.rmSync(this.llmFile(id), { force: true })
    this.emit('change')
  }

  async download(kind: 'stt' | 'llm', id: string): Promise<void> {
    const key = `${kind}:${id}`
    if (this.progress.has(key)) return
    const jobs: { url: string; dest: string }[] = []
    if (kind === 'stt') {
      const def = STT_MODELS.find((m) => m.id === id)
      if (!def) throw new Error(`Unknown model ${id}`)
      for (const f of Object.values(def.files)) jobs.push({ url: `${HF}/${def.repo}/resolve/main/${f}`, dest: path.join(this.sttDir(id), f) })
    } else {
      const def = LLM_MODELS.find((m) => m.id === id)
      if (!def) throw new Error(`Unknown model ${id}`)
      jobs.push({ url: def.url, dest: this.llmFile(id) })
    }
    const abort = new AbortController()
    const state = { received: 0, total: 0, abort }
    this.progress.set(key, state)
    this.emit('change')
    let lastEmit = 0
    try {
      // HEAD every file first so the progress bar has a real total.
      const sizes = await Promise.all(
        jobs.map(async (j) => {
          if (fs.existsSync(j.dest)) return 0
          const r = await fetch(j.url, { method: 'HEAD', redirect: 'follow', signal: abort.signal })
          return Number(r.headers.get('content-length') ?? 0)
        })
      )
      state.total = sizes.reduce((a, b) => a + b, 0)
      for (const j of jobs) {
        if (fs.existsSync(j.dest)) continue
        fs.mkdirSync(path.dirname(j.dest), { recursive: true })
        const res = await fetch(j.url, { redirect: 'follow', signal: abort.signal })
        if (!res.ok || !res.body) throw new Error(`Download failed (${res.status}) for ${path.basename(j.dest)}`)
        const part = `${j.dest}.part`
        const counter = new StreamTransform({
          transform: (chunk: Buffer, _enc, cb) => {
            state.received += chunk.length
            if (Date.now() - lastEmit > 250) {
              lastEmit = Date.now()
              this.emit('change')
            }
            cb(null, chunk)
          }
        })
        await pipeline(Readable.fromWeb(res.body as import('stream/web').ReadableStream), counter, fs.createWriteStream(part))
        fs.renameSync(part, j.dest)
      }
    } finally {
      this.progress.delete(key)
      this.emit('change')
    }
  }
}
