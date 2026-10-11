// Deterministic text clean-up. These rules always run, even with AI turned off,
// so "um", stutters and "scratch that" are handled offline and instantly.
// The AI pass (see prompts.ts) handles the subtler fumbles on top.

import type { AppCategory, AppKind, DictionaryEntry, Snippet, StyleId } from './types'

export function countWords(text: string): number {
  const m = text.trim().match(/[\p{L}\p{N}][\p{L}\p{N}'’_-]*/gu)
  return m ? m.length : 0
}

const ENGLISH_FILLERS = /(^|[\s,.;:!?(])(?:u+m+|u+h+m*|e+r+m+|e+r+|h+m+|m{2,}|a+h{2,})(?=$|[\s,.;:!?)])[,.]?/giu

/** Languages where "um" / "er" are real words, so filler removal must be skipped. */
const FILLER_UNSAFE = new Set(['de', 'nl', 'da', 'no', 'sv', 'af', 'fr', 'ro', 'pl', 'cs', 'sk', 'hu', 'tr'])

export function removeFillers(text: string, lang?: string): { text: string; removed: number } {
  if (lang && FILLER_UNSAFE.has(lang)) return { text, removed: 0 }
  let removed = 0
  const out = text.replace(ENGLISH_FILLERS, (_m, lead: string) => {
    removed++
    return lead
  })
  return { text: tidy(out), removed }
}

// Repeats that are real English and must survive ("had had", "bye bye").
const REPEAT_OK = new Set([
  'that', 'had', 'is', 'bye', 'no', 'very', 'so', 'ha', 'haha', 'really', 'well', 'now', 'yes', 'yeah',
  'go', 'knock', 'never', 'many', 'more', 'far', 'long', 'too', 'ok', 'okay', 'hey', 'please', 'again', 'do', 'la', 'na'
])

/** "I I I think" -> "I think", "we should we should" -> "we should", "w- want" -> "want". */
export function collapseRepeats(text: string): { text: string; removed: number } {
  let removed = 0
  // Cut-off word fragments like "w- want" or "wan- want".
  let out = text.replace(/(^|\s)([\p{L}]{1,4})-\s+(?=(\p{L}+))/gu, (m, lead: string, frag: string, next: string) => {
    if (next.toLowerCase().startsWith(frag.toLowerCase())) {
      removed++
      return lead
    }
    return m
  })
  // Repeated n-grams of 3, 2, then 1 words.
  for (const n of [3, 2, 1]) {
    const re = new RegExp(
      `(^|[\\s,])((?:[\\p{L}\\p{N}'’]+[\\s,]+){${n - 1}}[\\p{L}\\p{N}'’]+)(?:[\\s,]+\\2)+(?=$|[\\s,.;:!?])`,
      'giu'
    )
    out = out.replace(re, (m, lead: string, phrase: string) => {
      if (n === 1 && REPEAT_OK.has(phrase.toLowerCase())) return m
      removed++
      return lead + phrase
    })
  }
  return { text: tidy(out), removed }
}

const SCRATCH = /\b(?:scratch that|strike that|delete that|erase that|forget that)\b[\s,.;:!?]*/i

/** "Let's meet Monday. Scratch that, let's meet Tuesday." -> "Let's meet Tuesday." */
export function applyScratchThat(text: string): { text: string; removed: number } {
  let out = text
  let removed = 0
  for (let guard = 0; guard < 10; guard++) {
    const m = SCRATCH.exec(out)
    if (!m) break
    const before = out.slice(0, m.index)
    const after = out.slice(m.index + m[0].length)
    // Drop everything back to the previous sentence boundary or line break.
    const trimmedBefore = before.replace(/[\s,;:]+$/, '')
    const cut = Math.max(
      trimmedBefore.lastIndexOf('. ') >= 0 ? trimmedBefore.lastIndexOf('. ') + 2 : -1,
      trimmedBefore.lastIndexOf('! ') >= 0 ? trimmedBefore.lastIndexOf('! ') + 2 : -1,
      trimmedBefore.lastIndexOf('? ') >= 0 ? trimmedBefore.lastIndexOf('? ') + 2 : -1,
      trimmedBefore.lastIndexOf('\n') >= 0 ? trimmedBefore.lastIndexOf('\n') + 1 : -1,
      0
    )
    const lastChar = trimmedBefore.slice(-1)
    // If "scratch that" directly follows a finished sentence, that whole sentence goes.
    let keep: string
    if (/[.!?]/.test(lastChar)) {
      const prev = trimmedBefore.slice(0, -1)
      const prevCut = Math.max(prev.lastIndexOf('. '), prev.lastIndexOf('! '), prev.lastIndexOf('? '), prev.lastIndexOf('\n'))
      keep = prevCut >= 0 ? prev.slice(0, prevCut + 1) + ' ' : ''
    } else {
      keep = trimmedBefore.slice(0, cut)
    }
    out = keep + capitalizeFirst(after)
    removed++
  }
  return { text: tidy(out), removed }
}

const DETERMINERS = new Set(['a', 'an', 'the', 'our', 'their', 'his', 'her', 'my', 'your', 'this', 'that', 'every', 'each', 'another', 'one', 'first', 'whole', 'entire'])

/**
 * Spoken layout commands. "new line" / "new paragraph" always apply (unless used as
 * a noun phrase, e.g. "a new line of products"). Spoken punctuation ("comma",
 * "period") only applies when `punctuation` is true, i.e. when AI is off.
 */
export function applySpokenCommands(text: string, punctuation: boolean): string {
  let out = text
  const layout: [RegExp, string][] = [
    [/(?:start a )?new paragraph/gi, '\n\n'],
    [/new line|next line|line break|skip a line/gi, '\n']
  ]
  for (const [re, rep] of layout) {
    out = out.replace(new RegExp(`(^|[\\s,.;:!?]+)(${re.source})(?=$|[\\s,.;:!?])[,.;:!?]*`, 'gi'), (m, lead: string, _p, offset: number) => {
      const prevWord = out.slice(0, offset).trim().split(/\s+/).pop()?.toLowerCase().replace(/[^\p{L}]/gu, '') ?? ''
      if (!/[.!?,;:]/.test(lead) && DETERMINERS.has(prevWord)) return m
      const keepPunct = lead.replace(/\s+/g, '').replace(/,$/, '')
      return keepPunct + rep
    })
  }
  if (punctuation) {
    const marks: [RegExp, string][] = [
      [/\b(?:question mark)\b/gi, '?'],
      [/\b(?:exclamation (?:point|mark))\b/gi, '!'],
      [/\b(?:full stop|period)\b/gi, '.'],
      [/\bsemicolon\b/gi, ';'],
      [/\bcolon\b/gi, ':'],
      [/\bcomma\b/gi, ','],
      [/\bem[ -]?dash\b/gi, ' — '],
      [/\b(?:open (?:quote|quotes|quotation mark))\b\s*/gi, ' "'],
      [/\s*\b(?:close (?:quote|quotes|quotation mark)|end quote|unquote)\b/gi, '" '],
      [/\b(?:open (?:paren|parenthesis|bracket))\b\s*/gi, ' ('],
      [/\s*\b(?:close (?:paren|parenthesis|bracket))\b/gi, ') ']
    ]
    for (const [re, rep] of marks) out = out.replace(re, rep)
    // "Hello , how" -> "Hello, how"; "you ." -> "you."
    out = out.replace(/\s+([,.;:!?])/g, '$1').replace(/([,.;:!?])[,.]+/g, '$1')
  }
  return tidy(out)
}

export function capitalizeFirst(s: string): string {
  const i = s.search(/\p{L}/u)
  if (i < 0) return s
  return s.slice(0, i) + s.charAt(i).toUpperCase() + s.slice(i + 1)
}

/** Basic sentence casing for the no-AI path. */
export function capitalizeSentences(text: string, english = true): string {
  let out = text.replace(/(^|[.!?]\s+|\n\s*)(\p{Ll})/gu, (_m, lead: string, ch: string) => lead + ch.toUpperCase())
  if (english) out = out.replace(/(^|[\s(])i(?=$|[\s,.;:!?)'’])/g, '$1I').replace(/\bi'(m|d|ll|ve)\b/gi, "I'$1")
  return out
}

/** Make sure dictation that stops mid-sentence still reads as a sentence. */
export function ensureFinalPunctuation(text: string): string {
  const t = text.trimEnd()
  if (!t) return t
  if (/[.!?…:;,"')\]}>*`]$/.test(t)) return t
  if (/\n\s*([-*•]|\d+[.)])\s+[^\n]*$/.test(t)) return t // last line is a list item
  if (countWords(t) < 3) return t
  return t + '.'
}

export function tidy(text: string): string {
  return text
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/\s+([,.;:!?])/g, '$1')
    .replace(/([,;:])(?=[^\s\d"'’)\]])/g, '$1 ')
    .replace(/,\s*([.!?])/g, '$1')
    .replace(/^[\s,.;:]+/, '')
    .replace(/\(\s+/g, '(')
    .trim()
}

/**
 * Style rules that run after the AI pass (matches Wispr Flow's trailing-period rules):
 * casual drops the final period for up to 10 sentences, very casual always, and
 * "no style / excited" only in short messaging-app messages.
 */
export function applyStyle(text: string, style: StyleId, category: AppCategory, kind: AppKind, protectedWords: Set<string> = new Set()): string {
  let out = text
  if (kind === 'terminal') return out.replace(/\.$/, '')
  if (style === 'veryCasual') {
    out = out.replace(/(^|[.!?]\s+|\n\s*)(\p{Lu})(\p{Ll}*)/gu, (m, lead: string, first: string, rest: string) => {
      const word = first + rest
      if (word === 'I' || protectedWords.has(word.toLowerCase())) return m
      return lead + first.toLowerCase() + rest
    })
  }
  const sentences = (out.match(/[.!?](\s|$)/g) ?? []).length || 1
  const lastLine = out.split('\n').pop() ?? ''
  const messaging = category === 'personal' || category === 'work'
  let strip = false
  if (category !== 'email' && !/[!?]$/.test(lastLine)) {
    if (style === 'casual') strip = sentences <= 10
    else if (style === 'veryCasual') strip = true
    else if (style === 'excited') strip = messaging && sentences <= 2
  }
  if (strip) out = out.replace(/(?<!\.)\.$/, '').replace(/\.\.\.$|…$/, '')
  return out
}

/** Cursor / Windsurf chat: "at index dot ts" -> "@index.ts". */
export function applyFileTagging(text: string): string {
  return text.replace(
    /(^|\s)(?:at|tag|@)\s+((?:dot\s+)?[\w-]+(?:(?:\s*\.\s*|\s+dot\s+)[\w-]{1,10})+)(?=$|[\s,;:!?)]|\.(?:\s|$))/gi,
    (_m, lead: string, name: string) => lead + '@' + name.replace(/\s*\.\s*|\s+dot\s+|^dot\s+/gi, '.').replace(/^\./, '.')
  )
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Dictionary corrections: whole-word, case-insensitive, longest first,
 * possessives kept ("John's" -> "Bob's"), "n't" contractions left alone.
 */
export function applyDictionary(text: string, entries: DictionaryEntry[]): { text: string; count: number } {
  let count = 0
  const rules = entries
    .filter((e) => !e.deleted && e.misspelling && e.misspelling.trim())
    .sort((a, b) => (b.misspelling as string).length - (a.misspelling as string).length)
  let out = text
  for (const e of rules) {
    const from = escapeRe((e.misspelling as string).trim()).replace(/\s+/g, '\\s+')
    const re = new RegExp(`(?<![\\p{L}\\p{N}_])${from}(?=('s|’s)?(?![\\p{L}\\p{N}_]))(?!n't)`, 'giu')
    out = out.replace(re, () => {
      count++
      return e.word
    })
  }
  // Fix casing of known words ("open ai" stays, but "github" -> "GitHub").
  for (const e of entries) {
    if (e.deleted || e.misspelling) continue
    const w = e.word.trim()
    if (!w || w.toLowerCase() === w) continue
    const re = new RegExp(`(?<![\\p{L}\\p{N}_])${escapeRe(w).replace(/\s+/g, '\\s+')}(?![\\p{L}\\p{N}_])`, 'giu')
    out = out.replace(re, (m) => {
      if (m !== w) count++
      return w
    })
  }
  return { text: out, count }
}

export interface ProtectedSnippets {
  text: string
  tokens: Map<string, string>
  count: number
}

function snippetPattern(trigger: string): RegExp {
  const words = trigger.trim().split(/\s+/).map(escapeRe).join('[\\s,]+')
  return new RegExp(`(?<![\\p{L}\\p{N}_])${words}(?=('s|’s)?(?![\\p{L}\\p{N}_]))(?!n't)`, 'giu')
}

function normalizeTrigger(s: string): string {
  return s.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, '').replace(/\s+/g, ' ').trim()
}

/** When the whole dictation is just a trigger, insert the expansion exactly as saved. */
export function exactSnippet(text: string, snippets: Snippet[]): Snippet | null {
  const n = normalizeTrigger(text)
  if (!n) return null
  return snippets.find((s) => !s.deleted && s.expansion && normalizeTrigger(s.trigger) === n) ?? null
}

/**
 * Swap snippet triggers for tokens before the AI pass, so the AI can't reword them,
 * then swap the tokens for the expansions afterwards. Longest trigger wins.
 */
export function protectSnippets(text: string, snippets: Snippet[]): ProtectedSnippets {
  const tokens = new Map<string, string>()
  let count = 0
  let out = text
  const sorted = snippets.filter((s) => !s.deleted && s.trigger.trim() && s.expansion).sort((a, b) => b.trigger.length - a.trigger.length)
  for (const s of sorted) {
    out = out.replace(snippetPattern(s.trigger), () => {
      count++
      const token = `⟦${count}⟧`
      tokens.set(token, s.expansion)
      return token
    })
  }
  return { text: out, tokens, count }
}

export function restoreSnippets(text: string, tokens: Map<string, string>): string {
  let out = text
  for (const [token, expansion] of tokens) {
    if (out.includes(token)) out = out.split(token).join(expansion)
    else out = out.trimEnd() + (out.trim() ? '\n' : '') + expansion // the AI dropped it: append
  }
  return out
}

/**
 * Reject AI output that answered the dictation instead of cleaning it, or that
 * wrapped it in chatter. Returns the usable text or null.
 */
export function guardAiOutput(input: string, output: string, level: 'light' | 'medium' | 'high'): string | null {
  let out = output.trim()
  out = out.replace(/^```[a-z]*\n?|\n?```$/g, '').trim()
  out = out.replace(/^<\/?(?:transcript|text|output)>|<\/?(?:transcript|text|output)>$/gi, '').trim()
  out = out.replace(/^(?:here(?:'s| is) (?:the |your )?(?:cleaned|corrected|edited|formatted|polished)[^:\n]*:\s*)/i, '')
  if ((out.startsWith('"') && out.endsWith('"') && !input.trim().startsWith('"')) || (out.startsWith('“') && out.endsWith('”'))) {
    out = out.slice(1, -1).trim()
  }
  // Markdown-style hard breaks ("two spaces + newline") and stray trailing spaces.
  out = out.replace(/[ \t]+$/gm, '').trim()
  if (!out) return null
  const inWords = Math.max(1, countWords(input))
  const outWords = countWords(out)
  const maxRatio = level === 'high' ? 2.2 : level === 'medium' ? 1.8 : 1.5
  if (outWords > inWords * maxRatio + 12) return null
  if (outWords < inWords * 0.15 && inWords > 8) return null
  return out
}

export type DiffOp = { type: 'same' | 'add' | 'del'; text: string }

/** Word-level diff (LCS). Fine for dictation-sized text. */
export function wordDiff(a: string, b: string): DiffOp[] {
  // Whitespace and punctuation are their own tokens, so "week" -> "week." is one small change.
  const tokenize = (s: string): string[] => s.split(/(\s+|[.,!?;:"“”()])/).filter((x) => x !== '')
  const A = tokenize(a)
  const B = tokenize(b)
  const n = A.length
  const m = B.length
  if (n * m > 4_000_000) return [{ type: 'del', text: a }, { type: 'add', text: b }]
  const dp: Uint32Array[] = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1))
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i][j] = A[i] === B[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1])
  const ops: DiffOp[] = []
  const push = (type: DiffOp['type'], text: string): void => {
    const last = ops[ops.length - 1]
    if (last && last.type === type) last.text += text
    else ops.push({ type, text })
  }
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (A[i] === B[j]) {
      push('same', A[i])
      i++
      j++
    } else if (dp[i + 1][j] >= dp[i][j + 1]) push('del', A[i++])
    else push('add', B[j++])
  }
  while (i < n) push('del', A[i++])
  while (j < m) push('add', B[j++])
  return ops
}

const COMMON = new Set(
  'the be to of and a in that have i it for not on with he as you do at this but his by from they we say her she or an will my one all would there their what so up out if about who get which go me when make can like time no just him know take people into year your good some could them see other than then now look only come its over think also back after use two how our work first well way even new want because any these give day most us is are was were been has had did said ok okay yes yeah hi hello thanks thank please sorry pdf url api email'.split(' ')
)

/**
 * Words worth auto-adding to the dictionary after the user fixes a transcript:
 * proper nouns, acronyms, jargon. Skips URLs, numbers, code and everyday words.
 */
export function learnCandidates(before: string, after: string, known: Set<string>): string[] {
  const added = wordDiff(before, after)
    .filter((op) => op.type === 'add')
    .flatMap((op) => op.text.split(/\s+/))
  const out = new Set<string>()
  for (const raw of added) {
    const w = raw.replace(/^[^\p{L}\p{N}@]+|[^\p{L}\p{N}]+$/gu, '')
    if (w.length < 2 || w.length > 40) continue
    if (/^\d+$/.test(w) || /[/\\]|https?:|www\.|\.(?:com|ts|js|py|md|json)$/i.test(w)) continue
    if (/[_{}()=<>]/.test(w)) continue
    const lower = w.toLowerCase()
    if (COMMON.has(lower) || known.has(lower)) continue
    const interesting = /\p{Lu}/u.test(w.slice(1)) || /^\p{Lu}/u.test(w) || /\d/.test(w) || /@/.test(w)
    if (interesting) out.add(w)
  }
  return [...out].slice(0, 10)
}

export interface DeterministicResult {
  text: string
  fixes: number
}

/** Everything that runs before (or instead of) the AI pass. */
export function deterministicClean(raw: string, opts: { lang?: string; aiWillRun: boolean; backtrack: boolean; smartFormatting: boolean }): DeterministicResult {
  let fixes = 0
  let text = tidy(raw)
  const f = removeFillers(text, opts.lang)
  text = f.text
  fixes += f.removed
  const r = collapseRepeats(text)
  text = r.text
  fixes += r.removed
  // With AI on, the model resolves "scratch that" using the whole dictation as context.
  if (opts.backtrack && !opts.aiWillRun) {
    const s = applyScratchThat(text)
    text = s.text
    fixes += s.removed
  }
  text = applySpokenCommands(text, !opts.aiWillRun)
  if (!opts.aiWillRun && opts.smartFormatting) {
    text = capitalizeSentences(text, !opts.lang || opts.lang === 'en')
    text = ensureFinalPunctuation(text)
  }
  return { text, fixes }
}
