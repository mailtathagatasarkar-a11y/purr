// Speech-to-text: local (sherpa-onnx in the engine process) or a cloud provider.

import { encodeWav, splitForStt } from '../shared/audio'
import { STT_PROVIDERS, sttLanguageCode } from '../shared/defaults'
import type { Settings, SttProvider } from '../shared/types'
import type { EngineClient } from './engineClient'
import { STT_MODELS, type ModelManager } from './models'

export interface SttRequest {
  samples: Float32Array
  languages: string[]
  vocabulary: string[]
}

export interface SttResult {
  text: string
  language?: string
  provider: string
}

export class SttError extends Error {}

export function sttModel(settings: Settings): string {
  const p = settings.stt.provider
  return settings.stt.models[p] || (p === 'local' ? 'parakeet-v3' : STT_PROVIDERS[p].models[0] ?? '')
}

function pickLanguage(languages: string[]): string {
  // One language selected = force it. Several or none = let the model detect.
  return languages.length === 1 ? sttLanguageCode(languages[0]) : ''
}

function promptFor(req: SttRequest): string {
  // Whisper-style prompts bias spelling toward the user's words. Keep it short.
  const parts: string[] = []
  if (req.languages.includes('hinglish')) parts.push('Hinglish conversation, Hindi and English mixed, written in Latin script.')
  if (req.vocabulary.length) parts.push(`Vocabulary: ${req.vocabulary.slice(0, 60).join(', ')}.`)
  return parts.join(' ').slice(0, 800)
}

async function openAiCompatible(base: string, key: string, model: string, wav: Uint8Array, req: SttRequest): Promise<SttResult> {
  const form = new FormData()
  form.append('file', new Blob([Buffer.from(wav)], { type: 'audio/wav' }), 'audio.wav')
  form.append('model', model)
  const lang = pickLanguage(req.languages)
  if (lang) form.append('language', lang)
  const prompt = promptFor(req)
  if (prompt) form.append('prompt', prompt)
  form.append('response_format', model.startsWith('gpt-4o') ? 'json' : 'verbose_json')
  form.append('temperature', '0')
  const res = await fetch(`${base.replace(/\/$/, '')}/audio/transcriptions`, {
    method: 'POST',
    headers: key ? { Authorization: `Bearer ${key}` } : {},
    body: form,
    signal: AbortSignal.timeout(90_000)
  })
  if (!res.ok) throw new SttError(await describe(res))
  const j = (await res.json()) as { text?: string; language?: string }
  return { text: (j.text ?? '').trim(), language: j.language, provider: base }
}

async function deepgram(key: string, model: string, wav: Uint8Array, req: SttRequest): Promise<SttResult> {
  const lang = pickLanguage(req.languages)
  const q = new URLSearchParams({ model, smart_format: 'true', punctuate: 'true' })
  q.set('language', lang || 'multi')
  for (const w of req.vocabulary.slice(0, 50)) q.append('keyterm', w)
  const res = await fetch(`https://api.deepgram.com/v1/listen?${q}`, {
    method: 'POST',
    headers: { Authorization: `Token ${key}`, 'Content-Type': 'audio/wav' },
    body: Buffer.from(wav),
    signal: AbortSignal.timeout(90_000)
  })
  if (!res.ok) throw new SttError(await describe(res))
  const j = (await res.json()) as { results?: { channels?: { alternatives?: { transcript?: string }[]; detected_language?: string }[] } }
  const ch = j.results?.channels?.[0]
  return { text: (ch?.alternatives?.[0]?.transcript ?? '').trim(), language: ch?.detected_language, provider: 'deepgram' }
}

async function elevenlabs(key: string, model: string, wav: Uint8Array, req: SttRequest): Promise<SttResult> {
  const form = new FormData()
  form.append('file', new Blob([Buffer.from(wav)], { type: 'audio/wav' }), 'audio.wav')
  form.append('model_id', model)
  form.append('tag_audio_events', 'false')
  const lang = pickLanguage(req.languages)
  if (lang) form.append('language_code', lang)
  const res = await fetch('https://api.elevenlabs.io/v1/speech-to-text', {
    method: 'POST',
    headers: { 'xi-api-key': key },
    body: form,
    signal: AbortSignal.timeout(90_000)
  })
  if (!res.ok) throw new SttError(await describe(res))
  const j = (await res.json()) as { text?: string; language_code?: string }
  return { text: (j.text ?? '').trim(), language: j.language_code, provider: 'elevenlabs' }
}

export async function describe(res: Response): Promise<string> {
  let detail = ''
  try {
    const body = await res.text()
    try {
      const j = JSON.parse(body) as { error?: { message?: string } | string; message?: string; detail?: unknown }
      detail = typeof j.error === 'string' ? j.error : j.error?.message ?? j.message ?? (j.detail ? JSON.stringify(j.detail) : body)
    } catch {
      detail = body
    }
  } catch {
    // ignore
  }
  if (res.status === 401 || res.status === 403) return `The API key was rejected (${res.status}). Check it in Settings → Engine.`
  if (res.status === 429) return 'Rate limit reached at the provider. Wait a moment and try again.'
  return `Provider error ${res.status}: ${detail.slice(0, 200)}`
}

export class SpeechToText {
  constructor(
    private engine: EngineClient,
    private models: ModelManager,
    private getKey: (provider: string) => string
  ) {}

  private warmedKey = ''

  resetWarm(): void {
    this.warmedKey = ''
  }

  async warm(settings: Settings): Promise<void> {
    if (settings.stt.provider !== 'local') return
    const id = sttModel(settings)
    const def = STT_MODELS.find((m) => m.id === id)
    const paths = this.models.sttPaths(id)
    if (!def || !paths) return
    const language = def.type === 'whisper' ? pickLanguage(settings.languages) : ''
    const key = `${id}:${language}`
    if (key === this.warmedKey) return
    this.warmedKey = key
    await this.engine.call('stt.warm', { modelType: def.type, paths, language }).catch(() => (this.warmedKey = ''))
  }

  async transcribe(settings: Settings, req: SttRequest): Promise<SttResult> {
    const provider: SttProvider = settings.stt.provider
    const model = sttModel(settings)
    if (provider === 'local') {
      const def = STT_MODELS.find((m) => m.id === model)
      const paths = this.models.sttPaths(model)
      if (!def || !paths) throw new SttError(`The local speech model "${def?.name ?? model}" isn't downloaded yet. Open Settings → Engine to get it.`)
      const r = await this.engine.call<{ text: string; language?: string }>('stt.transcribe', {
        modelType: def.type,
        paths,
        language: def.type === 'whisper' ? pickLanguage(req.languages) : '',
        samples: req.samples
      })
      return { ...r, provider: `local:${model}` }
    }
    const info = STT_PROVIDERS[provider]
    const key = this.getKey(provider)
    if (info.needsKey && !key) throw new SttError(`Add your ${info.label} API key in Settings → Engine.`)
    // Cloud APIs cap uploads (~25 MB). Ten-minute chunks stay well under.
    const chunks = splitForStt(req.samples, 600)
    const results: SttResult[] = []
    for (const chunk of chunks) {
      const wav = encodeWav(chunk)
      if (provider === 'deepgram') results.push(await deepgram(key, model, wav, req))
      else if (provider === 'elevenlabs') results.push(await elevenlabs(key, model, wav, req))
      else {
        const base = provider === 'custom' ? settings.stt.customBaseUrl : (info.baseUrl as string)
        if (!base) throw new SttError('Set the server URL for your custom speech-to-text provider in Settings → Engine.')
        results.push(await openAiCompatible(base, key, model, wav, req))
      }
    }
    return { text: results.map((r) => r.text).join(' ').trim(), language: results[0]?.language, provider: `${provider}:${model}` }
  }
}
