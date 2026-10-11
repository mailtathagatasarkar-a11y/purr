// Language model calls for clean-up, Command Mode and transforms.

import { LLM_PROVIDERS } from '../shared/defaults'
import type { LlmProvider, Settings } from '../shared/types'
import type { EngineClient } from './engineClient'
import { anthropicComplete, describeAnthropicError } from './llmAnthropic'
import type { ModelManager } from './models'
import { describe } from './stt'

export interface LlmRequest {
  system: string
  user: string
  maxTokens?: number
  json?: boolean
  timeoutMs?: number
}

export function llmModel(settings: Settings): string {
  const p = settings.llm.provider
  return settings.llm.models[p] || (p === 'local' ? 'qwen3-4b' : LLM_PROVIDERS[p].models[0] ?? '')
}

export function llmAvailable(settings: Settings, models: ModelManager, getKey: (p: string) => string): boolean {
  const p = settings.llm.provider
  if (p === 'off') return false
  if (p === 'local') return models.llmInstalled(llmModel(settings))
  if (LLM_PROVIDERS[p].needsKey) return !!getKey(p)
  if (p === 'custom') return !!settings.llm.customBaseUrl
  return true
}

// Reasoning-style OpenAI models reject temperature; leave sampling at defaults for them.
const NO_TEMPERATURE = /^(?:o\d|gpt-5)/

async function openAiChat(base: string, key: string, model: string, req: LlmRequest, provider: LlmProvider): Promise<string> {
  const body: Record<string, unknown> = {
    model,
    messages: [
      { role: 'system', content: req.system },
      { role: 'user', content: req.user }
    ]
  }
  if (!NO_TEMPERATURE.test(model)) body.temperature = 0.2
  if (req.json && provider !== 'ollama') body.response_format = { type: 'json_object' }
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (key) headers.Authorization = `Bearer ${key}`
  if (provider === 'openrouter') {
    headers['HTTP-Referer'] = 'https://github.com/purr-app'
    headers['X-Title'] = 'Purr'
  }
  const res = await fetch(`${base.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(req.timeoutMs ?? 25_000)
  })
  if (!res.ok) throw new Error(await describe(res))
  const j = (await res.json()) as { choices?: { message?: { content?: string } }[] }
  return (j.choices?.[0]?.message?.content ?? '').replace(/<think>[\s\S]*?<\/think>/g, '').trim()
}

export class LanguageModel {
  /** Which local model file is loaded in the engine, and the load in progress. */
  private loadedPath: string | null = null
  private warming: { path: string; done: Promise<void> } | null = null

  constructor(
    private engine: EngineClient,
    private models: ModelManager,
    private getKey: (provider: string) => string
  ) {
    engine.onExit(() => {
      this.loadedPath = null
      this.warming = null
    })
  }

  label(settings: Settings): string {
    return `${settings.llm.provider}:${llmModel(settings)}`
  }

  warm(settings: Settings): Promise<void> {
    if (settings.llm.provider !== 'local') return Promise.resolve()
    const id = llmModel(settings)
    if (!this.models.llmInstalled(id)) return Promise.resolve()
    const path = this.models.llmFile(id)
    if (this.loadedPath === path) return Promise.resolve()
    if (this.warming?.path === path) return this.warming.done
    const done = this.engine
      .call<{ gpu?: string | false }>('llm.warm', { modelPath: path }, 300_000)
      .then((r) => {
        this.loadedPath = path
        console.log(`[llm] local model ready (gpu: ${r.gpu || 'none'})`)
      })
      .catch((e) => console.warn('[llm] warm failed', e))
      .finally(() => {
        if (this.warming?.path === path) this.warming = null
      })
    this.warming = { path, done }
    return done
  }

  /**
   * `wait: false` (dictation) never blocks on a model that is still loading:
   * the caller falls back to the basic clean-up so typing stays instant.
   */
  async complete(settings: Settings, req: LlmRequest & { wait?: boolean }): Promise<string> {
    const provider = settings.llm.provider
    const model = llmModel(settings)
    if (provider === 'off') throw new Error('AI is turned off. Pick a provider in Settings → Engine.')
    if (provider === 'local') {
      if (!this.models.llmInstalled(model)) throw new Error('The local AI model is not downloaded yet. Open Settings → Engine to get it.')
      if (this.loadedPath !== this.models.llmFile(model)) {
        const loading = this.warm(settings)
        if (req.wait === false) throw new Error('The local AI model is still loading, so this one got the basic clean-up.')
        await loading
      }
      const r = await this.engine.call<{ text: string }>(
        'llm.complete',
        { modelPath: this.models.llmFile(model), system: req.system, user: req.user, maxTokens: req.maxTokens ?? 1500, json: !!req.json },
        req.timeoutMs ?? 60_000
      )
      return r.text.trim()
    }
    const info = LLM_PROVIDERS[provider]
    const key = this.getKey(provider)
    if (info.needsKey && !key) throw new Error(`Add your ${info.label} API key in Settings → Engine.`)
    if (provider === 'anthropic') {
      try {
        return await anthropicComplete({ apiKey: key, model, system: req.system, user: req.user, maxTokens: req.maxTokens ?? 4000 })
      } catch (err) {
        throw new Error(describeAnthropicError(err) ?? (err as Error).message)
      }
    }
    const base = provider === 'custom' ? settings.llm.customBaseUrl : (info.baseUrl as string)
    if (!base) throw new Error('Set the server URL for your custom AI provider in Settings → Engine.')
    return openAiChat(base, key, model, req, provider)
  }
}
