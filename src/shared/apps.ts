import type { AppCategory, AppContext, AppKind } from './types'

interface AppRule {
  name: string
  // lower-case matches against the process name / bundle id
  ids?: string[]
  // lower-case matches against the window title (used for web apps inside browsers)
  titles?: string[]
  category: AppCategory
  kind: AppKind
  fileTagging?: boolean
}

// Order matters: the first match wins, and web apps are checked before generic browsers.
const RULES: AppRule[] = [
  // Email
  { name: 'Outlook', ids: ['outlook.exe', 'olk.exe', 'com.microsoft.outlook'], category: 'email', kind: 'email' },
  { name: 'Mail', ids: ['com.apple.mail'], category: 'email', kind: 'email' },
  { name: 'Superhuman', ids: ['superhuman', 'com.superhuman.electron'], titles: ['superhuman'], category: 'email', kind: 'email' },
  { name: 'Spark', ids: ['spark', 'com.readdle.smartemail'], category: 'email', kind: 'email' },
  { name: 'Thunderbird', ids: ['thunderbird'], category: 'email', kind: 'email' },
  { name: 'Missive', ids: ['missive'], titles: ['missive'], category: 'email', kind: 'email' },
  { name: 'Gmail', titles: ['gmail', 'inbox (', '- mail - '], category: 'email', kind: 'email' },
  { name: 'Outlook', titles: ['outlook.office', 'outlook.live', '- outlook'], category: 'email', kind: 'email' },
  { name: 'Proton Mail', titles: ['proton mail'], category: 'email', kind: 'email' },
  { name: 'HEY', titles: ['hey.com', '| hey'], category: 'email', kind: 'email' },

  // Work messaging
  { name: 'Slack', ids: ['slack', 'com.tinyspeck.slackmacgap'], titles: ['| slack', '- slack'], category: 'work', kind: 'chat' },
  { name: 'Teams', ids: ['ms-teams', 'teams', 'com.microsoft.teams'], titles: ['microsoft teams'], category: 'work', kind: 'chat' },
  { name: 'Google Chat', titles: ['google chat'], category: 'work', kind: 'chat' },
  { name: 'Zoom', ids: ['zoom', 'us.zoom.xos'], category: 'work', kind: 'chat' },
  { name: 'LinkedIn', titles: ['linkedin'], category: 'work', kind: 'chat' },
  { name: 'Linear', ids: ['linear'], titles: ['linear'], category: 'work', kind: 'docs' },

  // Personal messaging
  { name: 'WhatsApp', ids: ['whatsapp', 'net.whatsapp.whatsapp'], titles: ['whatsapp'], category: 'personal', kind: 'chat' },
  { name: 'Messages', ids: ['com.apple.mobilesms', 'messages'], category: 'personal', kind: 'chat' },
  { name: 'Telegram', ids: ['telegram', 'ru.keepcoder.telegram', 'org.telegram.desktop'], titles: ['telegram'], category: 'personal', kind: 'chat' },
  { name: 'Signal', ids: ['signal', 'org.whispersystems.signal-desktop'], category: 'personal', kind: 'chat' },
  { name: 'Messenger', ids: ['messenger', 'com.facebook.archon'], titles: ['messenger'], category: 'personal', kind: 'chat' },
  { name: 'Discord', ids: ['discord', 'com.hnc.discord'], titles: ['discord'], category: 'personal', kind: 'chat' },
  { name: 'Instagram', titles: ['instagram'], category: 'personal', kind: 'chat' },

  // AI assistants (Other)
  { name: 'ChatGPT', ids: ['chatgpt', 'com.openai.chat'], titles: ['chatgpt'], category: 'other', kind: 'ai' },
  { name: 'Claude', ids: ['claude', 'com.anthropic.claudefordesktop'], titles: ['claude'], category: 'other', kind: 'ai' },
  { name: 'Perplexity', ids: ['perplexity'], titles: ['perplexity'], category: 'other', kind: 'ai' },
  { name: 'Gemini', titles: ['gemini'], category: 'other', kind: 'ai' },

  // Code editors
  { name: 'Cursor', ids: ['cursor', 'com.todesktop.230313mzl4w4u92'], category: 'other', kind: 'ide', fileTagging: true },
  { name: 'Windsurf', ids: ['windsurf', 'com.exafunction.windsurf'], category: 'other', kind: 'ide', fileTagging: true },
  { name: 'VS Code', ids: ['code', 'code.exe', 'com.microsoft.vscode'], category: 'other', kind: 'ide' },
  { name: 'Zed', ids: ['zed', 'dev.zed.zed'], category: 'other', kind: 'ide' },
  { name: 'Xcode', ids: ['com.apple.dt.xcode'], category: 'other', kind: 'ide' },
  { name: 'JetBrains', ids: ['idea', 'pycharm', 'webstorm', 'goland', 'rider', 'clion', 'phpstorm', 'rubymine', 'com.jetbrains', 'studio64'], category: 'other', kind: 'ide' },
  { name: 'Sublime Text', ids: ['sublime_text', 'com.sublimetext'], category: 'other', kind: 'ide' },
  { name: 'Visual Studio', ids: ['devenv'], category: 'other', kind: 'ide' },

  // Terminals
  { name: 'Terminal', ids: ['windowsterminal', 'cmd', 'powershell', 'pwsh', 'conhost', 'com.apple.terminal', 'iterm', 'com.googlecode.iterm2', 'warp', 'dev.warp', 'ghostty', 'alacritty', 'wezterm', 'kitty', 'hyper', 'mintty'], category: 'other', kind: 'terminal' },

  // Documents
  { name: 'Word', ids: ['winword', 'com.microsoft.word'], category: 'other', kind: 'docs' },
  { name: 'Google Docs', titles: ['google docs'], category: 'other', kind: 'docs' },
  { name: 'Notion', ids: ['notion', 'notion.id'], titles: ['notion'], category: 'other', kind: 'docs' },
  { name: 'Obsidian', ids: ['obsidian', 'md.obsidian'], category: 'other', kind: 'docs' },
  { name: 'Pages', ids: ['com.apple.iwork.pages'], category: 'other', kind: 'docs' },
  { name: 'Notes', ids: ['com.apple.notes'], category: 'other', kind: 'docs' },
  { name: 'Figma', ids: ['figma', 'com.figma.desktop'], titles: ['figma'], category: 'other', kind: 'docs' },
  { name: 'Purr', ids: ['purr', 'electron', 'com.purr.app'], category: 'other', kind: 'docs' }
]

const BROWSERS = [
  'applicationframehost', // Windows Store apps (WhatsApp, Teams) report this host; the title says which app
  'chrome', 'msedge', 'firefox', 'brave', 'opera', 'vivaldi', 'arc', 'safari', 'zen',
  'com.google.chrome', 'com.microsoft.edgemac', 'org.mozilla.firefox', 'com.brave.browser',
  'company.thebrowser.browser', 'com.apple.safari', 'com.operasoftware.opera', 'com.vivaldi.vivaldi'
]

function normalizeId(exe: string): string {
  return exe.toLowerCase().replace(/\.exe$/, '').replace(/\.app$/, '')
}

function idMatches(id: string, candidates: string[] | undefined): boolean {
  if (!candidates) return false
  return candidates.some((c) => id === c || id === normalizeId(c) || (c.includes('.') && id.startsWith(c)))
}

export function classifyApp(exe: string, title: string, appName = ''): AppContext {
  const id = normalizeId(exe)
  const lowerTitle = title.toLowerCase()
  const isBrowser = BROWSERS.some((b) => id === b || id.startsWith(b))

  let rule = RULES.find((r) => idMatches(id, r.ids))
  if (!rule && isBrowser) rule = RULES.find((r) => r.titles?.some((t) => lowerTitle.includes(t)))

  const kind: AppKind = rule?.kind ?? (isBrowser ? 'browser' : 'generic')
  const name = rule?.name ?? (appName || prettify(exe))
  return {
    exe,
    appName: name,
    title,
    category: rule?.category ?? 'other',
    kind,
    fileTagging: !!rule?.fileTagging,
    // Wispr Flow pastes with Shift+Insert in Windows code editors and terminals.
    pasteWith: kind === 'ide' || kind === 'terminal' ? 'shiftInsert' : 'paste'
  }
}

function prettify(exe: string): string {
  const base = exe.split(/[\\/]/).pop() ?? exe
  const clean = base.replace(/\.exe$/i, '').replace(/^com\.[^.]+\./, '')
  return clean ? clean.charAt(0).toUpperCase() + clean.slice(1) : 'Unknown app'
}

export const CATEGORY_LABELS: Record<AppCategory, string> = {
  personal: 'Personal messages',
  work: 'Work messages',
  email: 'Email',
  other: 'Other'
}
