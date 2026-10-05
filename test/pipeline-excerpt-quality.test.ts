import test from 'node:test'
import assert from 'node:assert/strict'
import { adaptivePreRankLimit, preRankBlocks, splitBlocks } from '../src/pipeline/blocks.ts'
import { stripUiNoise } from '../src/pipeline/clean.ts'
import { weightedOverlap } from '../src/pipeline/lexical.ts'
import { runPipeline, type PipelineDeps, type ProviderOutcome } from '../src/pipeline/run.ts'
import { excerptOf } from '../src/pipeline/select.ts'
import type { TaskSpec } from '../src/pipeline/types.ts'

// ── noise stripping ─────────────────────────────────────────────────────────

test('stripUiNoise drops standalone UI labels (en + zh), also several labels on one line, and collapses blank runs', () => {
  const text = 'JS\nCOPY\nCJS MJS\nCopy code\n复制代码\n展开\n收起\n\n\n\nThe timeout option sets the busy timeout.\n\n\nMore text here.\n  Copied!  \n'
  assert.equal(stripUiNoise(text), 'The timeout option sets the busy timeout.\n\nMore text here.')
  assert.equal(stripUiNoise('展开全部\n本页目录：\n超时时间单位为毫秒。'), '超时时间单位为毫秒。')
})

test('stripUiNoise never alters content lines: prose with label words, numbers, code and fenced blocks', () => {
  const prose = 'Copy the file to disk, then expand the archive.\nJS engines differ: see section 4.2.\nversion 22\n3000\n'
  assert.equal(stripUiNoise(prose), prose.trim())
  const fenced = '```js\nJS\n\n\nCOPY\nconst timeout = 5000\n```\nCOPY\nafter'
  assert.equal(stripUiNoise(fenced), '```js\nJS\n\n\nCOPY\nconst timeout = 5000\n```\nafter')
  assert.equal(stripUiNoise('db.exec("PRAGMA busy_timeout = 5000")\n  indented code line  '), 'db.exec("PRAGMA busy_timeout = 5000")\n  indented code line')
  assert.equal(stripUiNoise('JS\nCOPY'), '')
})

test('excerptOf builds from the cleaned text, and a label-only block has no excerpt', () => {
  assert.equal(excerptOf('JS\nCOPY\nnew DatabaseSync(path[, options])\nCJS\nMJS', [{ text: 'options', weight: 1 }], 600), 'new DatabaseSync(path[, options])')
  assert.equal(excerptOf('JS\nCOPY\n展开', [{ text: 'x', weight: 1 }], 600), '')
})

// ── sentence-targeted excerpts ──────────────────────────────────────────────

test('excerpt: a long block is centred on the best sentence, not its first characters', () => {
  const parts = [{ text: 'timeout option busy', weight: 1.6 }]
  const before = Array.from({ length: 14 }, (_, i) => 'Earlier sentence ' + i + ' describes other things.').join(' ')
  const key = 'The timeout option sets the busy timeout in milliseconds.'
  const after = Array.from({ length: 14 }, (_, i) => 'Later sentence ' + i + ' covers unrelated details.').join(' ')
  const out = excerptOf(before + ' ' + key + ' ' + after, parts, 400)
  assert.ok(out.length <= 402)
  assert.ok(out.includes(key))
  assert.ok(out.startsWith('…') && out.endsWith('…'))
  assert.ok(out.includes('Earlier sentence 13') && out.includes('Later sentence 0'), 'context on both sides of the anchor')
  // anchored at the very start: no leading marker; at the very end: no trailing marker
  const head = excerptOf(key + ' ' + after, parts, 300)
  assert.ok(head.startsWith(key) && head.endsWith('…'))
  const tail = excerptOf(before + ' ' + key, parts, 300)
  assert.ok(tail.startsWith('…') && tail.endsWith(key))
})

test('excerpt: Chinese sentences split on 。！？； and the window centres on the relevant one', () => {
  const parts = [{ text: '超时 选项', weight: 1.6 }]
  const filler = (tag: string): string => Array.from({ length: 12 }, (_, i) => tag + '段落第' + i + '句介绍其他无关的内容说明。').join('')
  const key = '构造函数的 timeout 选项用于设置忙等待超时，单位为毫秒；默认值为 0！'
  const out = excerptOf(filler('前') + key + filler('后'), parts, 120)
  assert.ok(out.length <= 122)
  assert.ok(out.includes('构造函数的 timeout 选项用于设置忙等待超时，单位为毫秒；'), out)
  assert.ok(out.startsWith('…') && out.endsWith('…'))
  // the window starts and ends on sentence boundaries
  assert.match(out.replace(/^…/, ''), /^(?:前|后|构)/)
  assert.match(out.replace(/…$/, ''), /[。！；]$/)
})

test('excerpt: a single over-long best sentence still keeps its start and a marker', () => {
  const longSentence = 'The timeout option ' + 'and more words '.repeat(60) + 'ends here.'
  const out = excerptOf('Intro sentence. ' + longSentence + ' Outro sentence.', [{ text: 'timeout option', weight: 1 }], 200)
  assert.ok(out.startsWith('…The timeout option') && out.endsWith('…'))
  assert.ok(out.length <= 202)
})

// ── IDF pre-rank ────────────────────────────────────────────────────────────

test('adaptive pre-rank size: 12 up to 80 blocks, then one more per 10 blocks, at most 24', () => {
  assert.equal(adaptivePreRankLimit(0), 12)
  assert.equal(adaptivePreRankLimit(80), 12)
  assert.equal(adaptivePreRankLimit(81), 13)
  assert.equal(adaptivePreRankLimit(100), 14)
  assert.equal(adaptivePreRankLimit(150), 19)
  assert.equal(adaptivePreRankLimit(1000), 24)
})

test('pre-rank weights distinctive terms: a term in every block counts less than one in a few', () => {
  const generic = Array.from({ length: 30 }, (_, i) => ({ heading: 'Class: DatabaseSync method ' + i, text: 'DatabaseSync instance method number ' + i + ' works on the DatabaseSync instance of the node:sqlite module; a busy DatabaseSync connection stays open until db.close().' }))
  const target = { heading: 'new DatabaseSync(path[, options])', text: 'options.timeout: The busy timeout in milliseconds, number, default 0. This is the maximum time a connection waits when the database is locked by another connection.' }
  const blocks = [...generic.slice(0, 15), target, ...generic.slice(15)]
  const need = { text: 'DatabaseSync 构造参数中的 timeout 选项' }
  const query = 'node:sqlite DatabaseSync busy timeout'
  // plain overlap prefers the generic blocks (they match more of the query words) ...
  const parts = [{ text: need.text, weight: 1.6 }, { text: query, weight: 1 }]
  assert.ok(weightedOverlap(parts, target.heading + '\n' + target.text) < weightedOverlap(parts, blocks[0]!.heading + '\n' + blocks[0]!.text))
  // ... the IDF rank puts the block with the distinctive terms first
  assert.equal(preRankBlocks(need, query, blocks, 1)[0]!.item, target)
})

// ── real-case fixture: a long API page that repeats the class name everywhere ──

const TASK: TaskSpec = {
  goal: '确认 Node.js 22 的 node:sqlite 如何设置 busy timeout',
  query: 'node:sqlite DatabaseSync busy timeout',
  profile: 'docs_code',
  needs: [
    { id: 'n1', text: 'DatabaseSync 构造参数中的 timeout 选项', critical: true },
    { id: 'n2', text: '是否可以用 PRAGMA busy_timeout 代替', critical: false },
  ],
  constraints: [], budget: {},
}

function longSqlitePage(): { text: string; targetHeading: string } {
  const sections: string[] = ['# SQLite\n\nThe node:sqlite module provides DatabaseSync and StatementSync classes.']
  for (let i = 0; i < 70; i++) {
    sections.push('## Class: DatabaseSync method ' + i + '\n\nThe DatabaseSync method db.method' + i + '() works on a DatabaseSync instance of the node:sqlite module; a busy DatabaseSync connection stays open until db.close() is called, after which every DatabaseSync method throws.')
  }
  sections.push('## sqlTagStore\n\nThe sqlTagStore of a DatabaseSync caches prepared statements for tagged templates. Use DatabaseSync tagged templates as db.sql`SELECT 1` inside node:sqlite, and the DatabaseSync busy state is unaffected.')
  const target = 'new DatabaseSync(path[, options])'
  sections.push('## ' + target + '\n\nJS\nCOPY\n\nThe options object accepts:\n\noptions.timeout: The busy timeout in milliseconds, number, default 0. This is the maximum time a connection waits when the database is locked by another connection.\n\nCJS\nMJS\n\noptions.open: boolean, default true.')
  for (let i = 0; i < 40; i++) {
    sections.push('## Class: StatementSync method ' + i + '\n\nThe StatementSync method stmt.method' + i + '() runs a prepared statement created by the DatabaseSync instance and returns rows of the node:sqlite module.')
  }
  return { text: sections.join('\n\n'), targetHeading: target }
}

test('fixture: a >100-block page repeating DatabaseSync pre-ranks and selects the constructor block with the timeout option', async () => {
  const { text, targetHeading } = longSqlitePage()
  const url = 'https://nodejs.test/api/sqlite.html'
  const blocks = splitBlocks(text, url)
  assert.ok(blocks.length >= 100, 'synthetic page has ' + blocks.length + ' blocks')
  const target = blocks.find(b => b.heading?.includes(targetHeading))!
  assert.ok(target)

  // Pre-rank: the target is inside the adaptive top N for n1, and first.
  const limit = adaptivePreRankLimit(blocks.length)
  assert.ok(limit > 12 && limit <= 24)
  const rows = blocks.map(b => ({ b, heading: b.heading, text: b.text }))
  const ranked = preRankBlocks(TASK.needs[0]!, TASK.query, rows, limit)
  assert.ok(ranked.some(r => r.item.b === target), 'target is in the pre-rank')
  assert.equal(ranked[0]!.item.b, target, 'and ranks first')
  // the old r1 ordering (no IDF) drowns it in generic DatabaseSync blocks
  const plain = rows.map((r, pos) => ({ r, pos, score: weightedOverlap([{ text: TASK.needs[0]!.text, weight: 1.6 }, { text: TASK.query, weight: 1 }], (r.heading ? r.heading + '\n' : '') + r.text) }))
    .sort((a, b) => b.score - a.score || a.pos - b.pos).slice(0, 12)
  assert.ok(!plain.some(p => p.r.b === target), 'sanity: plain overlap misses it in the top 12')

  // End to end: selected for n1, excerpt free of UI noise and containing the timeout sentence.
  const deps: PipelineDeps = {
    providerStatus: async ids => new Map(ids.map(id => [id, { state: 'ready' as const }])),
    searchProvider: async (): Promise<ProviderOutcome> => ({ state: 'ok', sources: [{ url, title: 'SQLite | Node.js', snippet: 'node:sqlite DatabaseSync' }] }),
    fetchPage: async () => ({ url, text }),
    scorers: {},
    configuredEngines: ['ddg'],
    fusion: { k: 60, freshnessBoost: 0, freshnessDays: 30, authorityBoost: 0, authorityDomains: [] },
    newId: () => 'r_m2c00001',
  }
  const { pack } = await runPipeline(TASK, deps, { engines: ['ddg'] })
  const hit = pack.evidence.find(e => e.needIds[0] === 'n1' && e.excerpt.includes('options.timeout'))
  assert.ok(hit, 'the constructor block is selected for n1: ' + JSON.stringify(pack.evidence.map(e => e.heading)))
  assert.equal(hit.heading, 'SQLite > ' + targetHeading)
  assert.ok(!/^(JS|COPY|CJS|MJS)$/m.test(hit.excerpt), hit.excerpt)
  assert.ok(pack.coveredNeeds.includes('n1'))
})


test('pipeline: separate windows of one source block have distinct persistent evidence IDs', async () => {
  const url = 'https://docs.test/sqlite-options'
  const text = 'The busy timeout is set with PRAGMA busy_timeout = 5000. '
    + 'Unrelated configuration details are described here. '.repeat(20)
    + 'WAL mode is enabled with PRAGMA journal_mode=WAL.'
  const task: TaskSpec = { goal: 'SQLite configuration', query: 'busy timeout WAL mode', profile: 'docs_code',
    needs: [{ id: 'n1', text: 'busy timeout', critical: true }, { id: 'n2', text: 'WAL mode', critical: true }], constraints: [], budget: {} }
  const deps: PipelineDeps = {
    providerStatus: async ids => new Map(ids.map(id => [id, { state: 'ready' as const }])),
    searchProvider: async () => ({ state: 'ok', sources: [{ url, title: 'SQLite configuration', snippet: 'busy timeout WAL mode' }] }),
    fetchPage: async () => ({ url, text }),
    scorers: {}, configuredEngines: ['ddg'],
    fusion: { k: 60, freshnessBoost: 0, freshnessDays: 30, authorityBoost: 0, authorityDomains: [] },
    newId: () => 'r_windows',
  }
  const { pack, evidenceBlocks } = await runPipeline(task, deps, { engines: ['ddg'], select: { maxExcerptChars: 140 } })
  assert.deepEqual(pack.coveredNeeds, ['n1', 'n2'])
  assert.equal(pack.evidence.length, 2)
  assert.equal(new Set(pack.evidence.map(e => e.blockId)).size, 1)
  assert.equal(new Set(pack.evidence.map(e => e.evidenceId)).size, 2)
  assert.deepEqual(evidenceBlocks.map(b => b.evidenceId), pack.evidence.map(e => e.evidenceId))
  assert.ok(evidenceBlocks.every(b => b.text === text))
})
