// Claude via the official Anthropic SDK.

import Anthropic from '@anthropic-ai/sdk'

const clients = new Map<string, Anthropic>()

function client(apiKey: string): Anthropic {
  let c = clients.get(apiKey)
  if (!c) {
    c = new Anthropic({ apiKey, maxRetries: 1, timeout: 30_000 })
    clients.set(apiKey, c)
  }
  return c
}

// Models that accept the server-side refusal fallback ("default" routing).
const FALLBACK_MODELS = new Set(['claude-opus-5-5', 'claude-opus-5', 'claude-fable-5-1', 'claude-sonnet-5-5'])

export async function anthropicComplete(opts: { apiKey: string; model: string; system: string; user: string; maxTokens: number }): Promise<string> {
  const response = await client(opts.apiKey).beta.messages.create({
    model: opts.model,
    max_tokens: Math.max(1024, opts.maxTokens),
    system: opts.system,
    messages: [{ role: 'user', content: opts.user }],
    // Dictation is latency-sensitive: keep thinking shallow.
    output_config: { effort: 'low' },
    ...(FALLBACK_MODELS.has(opts.model) ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const } : {})
  })
  if (response.stop_reason === 'refusal') throw new Error('Claude declined to process this text.')
  return response.content
    .map((b) => (b.type === 'text' ? b.text : ''))
    .join('')
    .trim()
}

export function describeAnthropicError(err: unknown): string | null {
  if (err instanceof Anthropic.AuthenticationError) return 'Your Anthropic API key was rejected. Check it in Settings → Engine.'
  if (err instanceof Anthropic.RateLimitError) return 'Anthropic rate limit reached. Try again in a moment.'
  if (err instanceof Anthropic.NotFoundError) return 'That Claude model was not found. Pick another in Settings → Engine.'
  if (err instanceof Anthropic.APIError) return `Anthropic error ${err.status ?? ''}: ${err.message}`.trim()
  return null
}
