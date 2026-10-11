import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  applyDictionary,
  applyFileTagging,
  applyScratchThat,
  applySpokenCommands,
  applyStyle,
  collapseRepeats,
  deterministicClean,
  exactSnippet,
  guardAiOutput,
  learnCandidates,
  protectSnippets,
  removeFillers,
  restoreSnippets
} from '../src/shared/text.ts'

const entry = (word: string, misspelling?: string) => ({ id: word, word, misspelling, createdAt: 0, updatedAt: 0 })
const snip = (trigger: string, expansion: string) => ({ id: trigger, trigger, expansion, createdAt: 0, updatedAt: 0 })

test('removes English fillers but keeps real words', () => {
  assert.equal(removeFillers('So um, I think, uh, we should go.').text, 'So I think, we should go.')
  assert.equal(removeFillers('Umbrella and hummus are fine.').text, 'Umbrella and hummus are fine.')
  assert.equal(removeFillers('Ich komme um 3 Uhr', 'de').text, 'Ich komme um 3 Uhr')
})

test('collapses stutters and repeated phrases', () => {
  assert.equal(collapseRepeats('I I I think we should we should go').text, 'I think we should go')
  assert.equal(collapseRepeats('I w- want the the report').text, 'I want the report')
  assert.equal(collapseRepeats('He had had enough, bye bye').text, 'He had had enough, bye bye')
})

test('scratch that removes the previous sentence', () => {
  assert.equal(applyScratchThat("Let's meet Monday. Scratch that, let's meet Tuesday.").text, "Let's meet Tuesday.")
  assert.equal(applyScratchThat('I want pizza scratch that I want sushi').text, 'I want sushi')
  assert.equal(applyScratchThat('Hi Sam. The deadline is Friday. Scratch that. The deadline is Monday.').text, 'Hi Sam. The deadline is Monday.')
})

test('spoken layout and punctuation commands', () => {
  assert.equal(applySpokenCommands('Hi John. New paragraph. Thanks for this.', false), 'Hi John.\n\nThanks for this.')
  assert.equal(applySpokenCommands('Milk, new line, eggs', false), 'Milk\neggs')
  assert.equal(applySpokenCommands('We launched a new line of products', false), 'We launched a new line of products')
  assert.equal(applySpokenCommands('hello comma how are you question mark', true), 'hello, how are you?')
})

test('style trailing period rules', () => {
  assert.equal(applyStyle('Sounds good.', 'casual', 'personal', 'chat'), 'Sounds good')
  assert.equal(applyStyle('Sounds good.', 'formal', 'work', 'chat'), 'Sounds good.')
  assert.equal(applyStyle('Are you in?', 'casual', 'personal', 'chat'), 'Are you in?')
  assert.equal(applyStyle('Sure thing. See you there.', 'veryCasual', 'personal', 'chat'), 'sure thing. see you there')
  assert.equal(applyStyle('Thanks for the update.', 'casual', 'email', 'email'), 'Thanks for the update.')
})

test('file tagging for Cursor chat', () => {
  assert.equal(applyFileTagging('look at index dot ts and fix it'), 'look @index.ts and fix it')
  assert.equal(applyFileTagging('check tag app.tsx please'), 'check @app.tsx please')
})

test('dictionary corrections keep possessives and casing', () => {
  const d = [entry('Tathagata', 'tata gata'), entry('GitHub')]
  assert.equal(applyDictionary("tata gata's repo is on github", d).text, "Tathagata's repo is on GitHub")
})

test('snippets expand without the AI rewording them', () => {
  const s = [snip('my email signature', 'Best,\nTathagata'), snip('office address', '12 Park St')]
  assert.equal(exactSnippet('My email signature.', s)?.expansion, 'Best,\nTathagata')
  const p = protectSnippets('Send it to my office address thanks', s)
  assert.equal(p.text, 'Send it to my ⟦1⟧ thanks')
  assert.equal(restoreSnippets('Send it to my ⟦1⟧, thanks.', p.tokens), 'Send it to my 12 Park St, thanks.')
})

test('AI output guard rejects answers and chatter', () => {
  assert.equal(guardAiOutput('can you send me the report', 'Can you send me the report?', 'light'), 'Can you send me the report?')
  assert.equal(guardAiOutput('hi', 'Here is the cleaned text: Hi.', 'light'), 'Hi.')
  assert.equal(
    guardAiOutput('what is the capital of france', 'The capital of France is Paris. It is known for the Eiffel Tower, the Louvre, fine food and much more besides that.', 'light'),
    null
  )
})

test('learns proper nouns from user fixes', () => {
  const words = learnCandidates('I talked to wisper flow and sarah', 'I talked to Wispr Flow and Sarah', new Set())
  assert.deepEqual(words, ['Wispr', 'Flow', 'Sarah'])
})

test('full deterministic pass without AI', () => {
  const r = deterministicClean('um so I I think we should uh meet at 2 scratch that meet at 3 comma okay', {
    aiWillRun: false,
    backtrack: true,
    smartFormatting: true
  })
  assert.equal(r.text, 'Meet at 3, okay.')
  assert.ok(r.fixes >= 3)
})

test('heatmap is whole Sunday-to-Saturday weeks ending today', async () => {
  const { summarize } = await import('../src/shared/stats.ts')
  const now = new Date(2026, 9, 12) // a Monday
  const s = summarize({ daily: {}, totalWords: 0, totalFixes: 0, totalSessions: 0, recent: [] }, now)
  assert.equal(new Date(`${s.heatmap[0].date}T12:00:00`).getDay(), 0)
  assert.equal(s.heatmap.at(-1)?.date, '2026-10-12')
  assert.equal(Math.ceil(s.heatmap.length / 7), 52)
})
