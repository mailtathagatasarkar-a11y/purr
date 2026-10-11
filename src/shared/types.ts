// Types shared by the main process, preload and renderers.

export type AppCategory = 'personal' | 'work' | 'email' | 'other'
export type StyleId = 'formal' | 'casual' | 'veryCasual' | 'excited'
export type CleanupLevel = 'none' | 'light' | 'medium' | 'high'
export type AppKind = 'ide' | 'terminal' | 'ai' | 'docs' | 'chat' | 'email' | 'browser' | 'generic'

export interface AppContext {
  exe: string // process name, e.g. "slack.exe" or bundle id on macOS
  appName: string // friendly name, e.g. "Slack"
  title: string // window title
  category: AppCategory
  kind: AppKind
  fileTagging: boolean // Cursor / Windsurf chat @-file tagging
  pasteWith: 'paste' | 'shiftInsert'
}

export type SttProvider = 'local' | 'openai' | 'groq' | 'deepgram' | 'elevenlabs' | 'custom'
export type LlmProvider =
  | 'off'
  | 'local'
  | 'openai'
  | 'anthropic'
  | 'groq'
  | 'gemini'
  | 'openrouter'
  | 'ollama'
  | 'lmstudio'
  | 'custom'

export type ActionId =
  | 'pushToTalk'
  | 'handsFree'
  | 'commandMode'
  | 'cancel'
  | 'pasteLast'
  | 'scratchpad'
  | 'viewDiff'
  | `transform:${string}`

/** A chord is a list of key names, e.g. ["Ctrl", "Meta"]. An action can have several chords. */
export type Chord = string[]
export type HotkeyMap = Record<string, Chord[]>

export interface Settings {
  onboarded: boolean
  hotkeys: HotkeyMap
  microphoneId: string
  keepMicWarm: boolean
  languages: string[] // empty = auto-detect
  sounds: boolean
  soundVolume: number
  showFlowBar: boolean
  flowBarHiddenUntil: number
  launchAtLogin: boolean
  showInDock: boolean
  stt: { provider: SttProvider; models: Partial<Record<SttProvider, string>>; customBaseUrl: string }
  llm: { provider: LlmProvider; models: Partial<Record<LlmProvider, string>>; customBaseUrl: string }
  styles: Record<AppCategory, StyleId>
  cleanupLevel: CleanupLevel
  smartFormatting: boolean
  backtrack: boolean
  commandMode: boolean
  searchEngine: 'perplexity' | 'google' | 'chatgpt'
  vibe: { variableRecognition: boolean; fileTagging: boolean }
  privacy: { saveHistory: boolean; saveAudio: boolean; audioRetentionDays: number }
  whisperBoost: boolean
  addTrailingSpace: boolean
  keepTranscriptInClipboard: boolean
  autoTransformId: string | null
  transformUseWholeField: boolean
  syncFolder: string
  maxRecordingMinutes: number
  autoLearnWords: boolean
}

interface Synced {
  id: string
  createdAt: number
  updatedAt: number
  deleted?: boolean
}

export interface DictionaryEntry extends Synced {
  word: string // correct spelling
  misspelling?: string // optional: what the transcriber writes instead
  auto?: boolean // learned automatically
  shared?: boolean // lives in the shared (sync folder) dictionary
}

export interface Snippet extends Synced {
  trigger: string
  expansion: string
  shared?: boolean
}

export interface PolishRules {
  concise: boolean
  clarity: boolean
  reorder: boolean
  structure: boolean
  keepTone: boolean
}

export interface Transform extends Synced {
  name: string
  kind: 'polish' | 'prompt' | 'custom'
  instructions: string // custom prompt text (custom) or extra instructions (polish)
  rules?: PolishRules
  customRules?: string[]
  samples?: string[]
}

export interface NoteVersion {
  at: number
  title: string
  body: string
}

export interface Note extends Synced {
  title: string
  body: string
  pinned: boolean
  versions: NoteVersion[]
}

export type HistoryMode = 'dictation' | 'command' | 'transform' | 'file'

export interface HistoryItem {
  id: string
  at: number
  mode: HistoryMode
  app: string
  category: AppCategory
  raw: string // straight from speech-to-text
  text: string // what was inserted (after AI edits)
  showRaw?: boolean // "Undo AI edit" pressed
  instruction?: string // command / transform instruction
  durationMs: number
  words: number
  fixes: number
  language?: string
  stt: string
  llm: string
  latencyMs: number
  audioFile?: string
  wave?: number[] // voiceprint: loudness outline of the recording
  error?: string
}

export interface DayStats {
  words: number
  sessions: number
  fixes: number
  speechMs: number
  apps: Record<string, number>
  categories: Record<string, number>
}

export interface Stats {
  daily: Record<string, DayStats>
  totalWords: number
  totalFixes: number
  totalSessions: number
  recent: { words: number; ms: number }[] // last 100 dictations for WPM
}

export interface Library {
  dictionary: DictionaryEntry[]
  snippets: Snippet[]
  transforms: Transform[]
  notes: Note[]
}

export type BarState = 'rest' | 'recording' | 'processing' | 'hidden'

export interface BarView {
  state: BarState
  mode: 'dictate' | 'command' | 'transform'
  locked: boolean // hands-free
  label?: string
  hint: string // e.g. "Hold Ctrl + Win to dictate"
  sounds: boolean
  volume: number
}

export interface Toast {
  id: string
  kind: 'info' | 'error' | 'success' | 'warning'
  text: string
  actions?: { id: string; label: string }[]
  ttlMs?: number
}

export interface ResultCard {
  id: string
  title: string
  text: string
}

export interface ModelInfo {
  id: string
  name: string
  description: string
  sizeMB: number
  languages: string
  recommended?: boolean
  installed: boolean
  langs?: string[]
  downloading?: { received: number; total: number }
}

export interface TransformDiff {
  name: string
  before: string
  after: string
  at: number
}

export interface EngineStatus {
  sttReady: boolean
  llmReady: boolean
  sttLabel: string
  llmLabel: string
  problems: string[]
}

export interface PermissionStatus {
  platform: string
  microphone: 'granted' | 'denied' | 'not-determined' | 'restricted' | 'unknown'
  accessibility: boolean
  keyboardHook: boolean
  helper: boolean
}
