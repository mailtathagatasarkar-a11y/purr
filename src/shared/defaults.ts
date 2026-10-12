import type { HotkeyMap, LlmProvider, Settings, SttProvider, Transform } from './types'

/** Google Form; each answer becomes a GitHub issue for the feedback agent. No sign-in needed. */
export const FEEDBACK_URL = 'https://docs.google.com/forms/d/e/1FAIpQLSeaix64Z6WT2gB735oajZK7coogDhDaPLJXYBxQVSN8l0Ag3Q/viewform'

export function defaultHotkeys(platform: string, hasFnKey: boolean): HotkeyMap {
  if (platform === 'darwin') {
    // Same defaults as Wispr Flow: Fn on Apple keyboards, Ctrl+Option otherwise.
    const base = hasFnKey ? ['Fn'] : ['Ctrl', 'Alt']
    return {
      pushToTalk: [base],
      handsFree: [[...base, 'Space']],
      commandMode: [hasFnKey ? ['Fn', 'Ctrl'] : ['Ctrl', 'Alt', 'Meta']],
      cancel: [['Escape']],
      pasteLast: [['Ctrl', 'Meta', 'V']],
      scratchpad: [['Alt', 'S']],
      viewDiff: [['Alt', 'O']],
      'transform:polish': [['Alt', '1']],
      'transform:prompt': [['Alt', '2']]
    }
  }
  return {
    pushToTalk: [['Ctrl', 'Meta']],
    handsFree: [['Ctrl', 'Meta', 'Space']],
    commandMode: [['Ctrl', 'Meta', 'Alt']],
    cancel: [['Escape']],
    pasteLast: [['Alt', 'Shift', 'Z']],
    scratchpad: [['Meta', 'Alt', 'S']],
    viewDiff: [['Meta', 'Alt', 'O']],
    'transform:polish': [['Meta', 'Alt', '1']],
    'transform:prompt': [['Meta', 'Alt', '2']]
  }
}

export function defaultSettings(platform: string, hasFnKey: boolean): Settings {
  return {
    onboarded: false,
    hotkeys: defaultHotkeys(platform, hasFnKey),
    microphoneId: '',
    keepMicWarm: false,
    languages: [],
    sounds: true,
    soundVolume: 0.5,
    showFlowBar: true,
    flowBarHiddenUntil: 0,
    launchAtLogin: true,
    showInDock: true,
    stt: { provider: 'local', models: {}, customBaseUrl: '' },
    llm: { provider: 'local', models: {}, customBaseUrl: '' },
    styles: { personal: 'casual', work: 'formal', email: 'formal', other: 'formal' },
    cleanupLevel: 'light',
    smartFormatting: true,
    backtrack: true,
    commandMode: true,
    searchEngine: 'perplexity',
    vibe: { variableRecognition: true, fileTagging: true },
    privacy: { saveHistory: true, saveAudio: true, audioRetentionDays: 14 },
    whisperBoost: true,
    addTrailingSpace: true,
    keepTranscriptInClipboard: false,
    autoTransformId: null,
    transformUseWholeField: true,
    syncFolder: '',
    maxRecordingMinutes: 20,
    autoLearnWords: true
  }
}

export function defaultTransforms(now: number): Transform[] {
  return [
    {
      id: 'polish',
      name: 'Polish',
      kind: 'polish',
      instructions: '',
      rules: { concise: true, clarity: true, reorder: false, structure: false, keepTone: true },
      customRules: [],
      samples: [],
      createdAt: now,
      updatedAt: now
    },
    {
      id: 'prompt',
      name: 'Prompt Engineer',
      kind: 'prompt',
      instructions: '',
      createdAt: now,
      updatedAt: now
    }
  ]
}

interface ProviderInfo {
  label: string
  needsKey: boolean
  keyUrl?: string
  baseUrl?: string
  models: string[]
  note?: string
}

export const STT_PROVIDERS: Record<SttProvider, ProviderInfo> = {
  local: { label: 'On this computer', needsKey: false, models: [], note: 'Private and offline. Downloads a model once.' },
  groq: {
    label: 'Groq',
    needsKey: true,
    keyUrl: 'https://console.groq.com/keys',
    baseUrl: 'https://api.groq.com/openai/v1',
    models: ['whisper-large-v3-turbo', 'whisper-large-v3'],
    note: 'Very fast. Has a free tier.'
  },
  openai: {
    label: 'OpenAI',
    needsKey: true,
    keyUrl: 'https://platform.openai.com/api-keys',
    baseUrl: 'https://api.openai.com/v1',
    models: ['gpt-4o-transcribe', 'gpt-4o-mini-transcribe', 'whisper-1'],
    note: 'Most accurate on accents and mixed languages.'
  },
  deepgram: {
    label: 'Deepgram',
    needsKey: true,
    keyUrl: 'https://console.deepgram.com/',
    models: ['nova-3', 'nova-2'],
    note: 'Fast, strong on English and Hindi.'
  },
  elevenlabs: {
    label: 'ElevenLabs Scribe',
    needsKey: true,
    keyUrl: 'https://elevenlabs.io/app/settings/api-keys',
    models: ['scribe_v1'],
    note: '99 languages.'
  },
  custom: {
    label: 'Custom (OpenAI-compatible)',
    needsKey: false,
    models: ['whisper-1'],
    note: 'Any /audio/transcriptions server, e.g. a local whisper.cpp server.'
  }
}

export const LLM_PROVIDERS: Record<LlmProvider, ProviderInfo> = {
  off: { label: 'Off (rules only)', needsKey: false, models: [], note: 'No AI. Purr still removes ums, stutters and "scratch that".' },
  local: { label: 'On this computer', needsKey: false, models: [], note: 'Private and offline. Downloads a model once.' },
  groq: {
    label: 'Groq',
    needsKey: true,
    keyUrl: 'https://console.groq.com/keys',
    baseUrl: 'https://api.groq.com/openai/v1',
    models: ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant', 'openai/gpt-oss-20b'],
    note: 'Very fast. Has a free tier.'
  },
  openai: {
    label: 'OpenAI',
    needsKey: true,
    keyUrl: 'https://platform.openai.com/api-keys',
    baseUrl: 'https://api.openai.com/v1',
    models: ['gpt-4.1-mini', 'gpt-4.1-nano', 'gpt-5-mini']
  },
  anthropic: {
    label: 'Anthropic Claude',
    needsKey: true,
    keyUrl: 'https://platform.claude.com/settings/keys',
    models: ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5'],
    note: 'Haiku is the fastest Claude for dictation.'
  },
  gemini: {
    label: 'Google Gemini',
    needsKey: true,
    keyUrl: 'https://aistudio.google.com/apikey',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    models: ['gemini-flash-latest', 'gemini-flash-lite-latest', 'gemini-pro-latest'],
    note: 'Has a free tier.'
  },
  openrouter: {
    label: 'OpenRouter',
    needsKey: true,
    keyUrl: 'https://openrouter.ai/keys',
    baseUrl: 'https://openrouter.ai/api/v1',
    models: ['openai/gpt-4.1-mini', 'anthropic/claude-haiku-5.5', 'google/gemini-flash-latest']
  },
  ollama: {
    label: 'Ollama',
    needsKey: false,
    baseUrl: 'http://localhost:11434/v1',
    models: ['qwen3:4b-instruct', 'llama3.2:3b', 'gemma3:4b'],
    note: 'Uses models you already run in Ollama.'
  },
  lmstudio: {
    label: 'LM Studio',
    needsKey: false,
    baseUrl: 'http://localhost:1234/v1',
    models: ['local-model'],
    note: 'Uses the model loaded in LM Studio.'
  },
  custom: { label: 'Custom (OpenAI-compatible)', needsKey: false, models: ['gpt-4.1-mini'] }
}

export const LANGUAGES: { code: string; name: string }[] = [
  { code: 'en', name: 'English' },
  { code: 'hinglish', name: 'Hinglish (Hindi + English)' },
  { code: 'hi', name: 'Hindi' },
  { code: 'bn', name: 'Bengali' },
  { code: 'es', name: 'Spanish' },
  { code: 'fr', name: 'French' },
  { code: 'de', name: 'German' },
  { code: 'it', name: 'Italian' },
  { code: 'pt', name: 'Portuguese' },
  { code: 'nl', name: 'Dutch' },
  { code: 'sv', name: 'Swedish' },
  { code: 'da', name: 'Danish' },
  { code: 'no', name: 'Norwegian' },
  { code: 'fi', name: 'Finnish' },
  { code: 'pl', name: 'Polish' },
  { code: 'cs', name: 'Czech' },
  { code: 'sk', name: 'Slovak' },
  { code: 'hu', name: 'Hungarian' },
  { code: 'ro', name: 'Romanian' },
  { code: 'bg', name: 'Bulgarian' },
  { code: 'hr', name: 'Croatian' },
  { code: 'sl', name: 'Slovenian' },
  { code: 'el', name: 'Greek' },
  { code: 'et', name: 'Estonian' },
  { code: 'lv', name: 'Latvian' },
  { code: 'lt', name: 'Lithuanian' },
  { code: 'mt', name: 'Maltese' },
  { code: 'ru', name: 'Russian' },
  { code: 'uk', name: 'Ukrainian' },
  { code: 'tr', name: 'Turkish' },
  { code: 'ar', name: 'Arabic' },
  { code: 'he', name: 'Hebrew' },
  { code: 'fa', name: 'Persian' },
  { code: 'ur', name: 'Urdu' },
  { code: 'ta', name: 'Tamil' },
  { code: 'te', name: 'Telugu' },
  { code: 'mr', name: 'Marathi' },
  { code: 'gu', name: 'Gujarati' },
  { code: 'kn', name: 'Kannada' },
  { code: 'ml', name: 'Malayalam' },
  { code: 'pa', name: 'Punjabi' },
  { code: 'zh', name: 'Chinese (Mandarin)' },
  { code: 'yue', name: 'Cantonese' },
  { code: 'ja', name: 'Japanese' },
  { code: 'ko', name: 'Korean' },
  { code: 'vi', name: 'Vietnamese' },
  { code: 'th', name: 'Thai' },
  { code: 'id', name: 'Indonesian' },
  { code: 'ms', name: 'Malay' },
  { code: 'tl', name: 'Filipino' },
  { code: 'sw', name: 'Swahili' }
]

/**
 * The Whisper/ISO code we send to speech-to-text for a Purr language code.
 * Hinglish goes through auto-detect (forcing "hi" gives Devanagari); the cleanup
 * step then writes it in Latin script.
 */
export function sttLanguageCode(code: string): string {
  if (code === 'hinglish') return ''
  return code
}
