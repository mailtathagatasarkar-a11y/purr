// "Test" buttons in Settings → Engine.

import { LLM_PROVIDERS, STT_PROVIDERS } from '../shared/defaults'
import type { LlmProvider, Settings, SttProvider } from '../shared/types'
import type { LanguageModel } from './llm'
import { describe } from './stt'

export async function testStt(settings: Settings, provider: SttProvider, key: string): Promise<string> {
  const info = STT_PROVIDERS[provider]
  if (provider === 'local') return 'Local models are tested when you download them.'
  if (info.needsKey && !key) throw new Error('Paste an API key first.')
  let url = ''
  const headers: Record<string, string> = {}
  if (provider === 'deepgram') {
    url = 'https://api.deepgram.com/v1/projects'
    headers.Authorization = `Token ${key}`
  } else if (provider === 'elevenlabs') {
    url = 'https://api.elevenlabs.io/v1/user'
    headers['xi-api-key'] = key
  } else {
    const base = provider === 'custom' ? settings.stt.customBaseUrl : info.baseUrl
    if (!base) throw new Error('Set the server URL first.')
    url = `${base.replace(/\/$/, '')}/models`
    if (key) headers.Authorization = `Bearer ${key}`
  }
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(10_000) })
  if (!res.ok) throw new Error(await describe(res))
  return `Connected to ${info.label}.`
}

export async function testLlm(settings: Settings, provider: LlmProvider, llm: LanguageModel): Promise<string> {
  if (provider === 'off') return 'AI is off.'
  const s: Settings = { ...settings, llm: { ...settings.llm, provider } }
  const t0 = Date.now()
  const out = await llm.complete(s, { system: 'Reply with the single word: ready', user: 'Are you ready?', maxTokens: 50, timeoutMs: 60_000 })
  return `${LLM_PROVIDERS[provider].label} replied "${out.slice(0, 40)}" in ${Date.now() - t0} ms.`
}
