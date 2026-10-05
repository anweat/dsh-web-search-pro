import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { adaptivePreRankLimit, preRankBlocks, splitBlocks } from '../src/pipeline/blocks.ts'
import { CorpusStats } from '../src/pipeline/corpus.ts'
import { alignedScore } from '../src/pipeline/align.ts'
import { codeCredit, idfFactor, isDistinctive, splitProseCode, statsOverlap, type PageTermStats } from '../src/pipeline/lexical.ts'
import { renderEvidencePack } from '../src/pipeline/render.ts'
import { runPipeline, type PipelineDeps } from '../src/pipeline/run.ts'
import { capDiscussionGrades, isDiscussionUrl, RuleScorer, type ScoreJob, type ScoreOutcome, type ScoreTask } from '../src/pipeline/score.ts'
import { selectEvidence } from '../src/pipeline/select.ts'
import type { ScoredBlock, TaskSpec } from '../src/pipeline/types.ts'

// Real-host failure (after M3a): the node:sqlite page, Chinese task, English blocks. Sections about serialize(), aggregate
// window functions or loadExtension() were graded 2 for "DatabaseSync constructor timeout option" because their code samples
// contain `new DatabaseSync(`, while the section documenting the `timeout` option was not selected.
const FIXTURE = JSON.parse(fs.readFileSync(new URL('./fixtures/node-sqlite-api.json', import.meta.url), 'utf8')) as { source: string; fetchedAt: string; text: string }
const URL_SQLITE = FIXTURE.source
const NEEDS = [{ id: 'n1', text: 'DatabaseSync 构造参数中的 timeout 选项', critical: true }, { id: 'n2', text: '是否可以用 PRAGMA busy_timeout 代替', critical: true }]
const TASK: ScoreTask = { goal: '确认 Node.js 22 的 node:sqlite 如何设置 busy timeout', query: 'node:sqlite DatabaseSync busy timeout 设置', needs: NEEDS, constraints: [] }

const isCtor = (text: string): boolean => text.includes('busy timeout](https://sqlite.org')
/** Code-sample sections about other APIs: they contain `new DatabaseSync(` and never mention a timeout. */
const isUnrelatedSample = (text: string): boolean => text.includes('new DatabaseSync(') && !/timeout/i.test(text)

async function scoreFixture(withCorpus: boolean) {
  const blocks = splitBlocks(FIXTURE.text, URL_SQLITE)
  const limit = adaptivePreRankLimit(blocks.length)
  const all = blocks.map(b => ({ b, heading: b.heading, text: b.text }))
  const jobs: ScoreJob[] = NEEDS.map(need => ({
    need,
    blocks: preRankBlocks(need, TASK.query, all, limit).map(r => ({ blockId: r.item.b.blockId, url: URL_SQLITE, text: r.item.b.text, ...r.item.b.heading ? { heading: r.item.b.heading } : {} })),
  }))
  const corpus = blocks.map(b => ({ url: URL_SQLITE, text: b.text, ...b.heading ? { heading: b.heading } : {} }))
  const outcome = await new RuleScorer().score(TASK, jobs, withCorpus ? { corpus } : {})
  return { blocks, jobs, outcome }
}

test('fixture is small and carries its provenance', () => {
  assert.equal(FIXTURE.source, 'https://nodejs.org/api/sqlite.html')
  assert.match(FIXTURE.fetchedAt, /^\d{4}-\d{2}-\d{2}$/)
  assert.ok(Buffer.byteLength(FIXTURE.text) < 60 * 1024)
})

test('M3a behaviour (no page statistics) reproduces the failure: unrelated code-sample sections are graded 2', async () => {
  const { jobs, outcome } = await scoreFixture(false)
  const g = outcome.grades.get('n1')!
  const unrelated = jobs[0]!.blocks.filter(b => isUnrelatedSample(b.text))
  assert.ok(unrelated.length >= 6)
  assert.ok(unrelated.filter(b => g.get(b.blockId)!.grade >= 2).length >= 6, 'without statistics the shared identifier alone reaches grade 2')
})

test('page IDF: the constructor `timeout` section answers n1 (grade >= 2, ranked above the rest); unrelated code samples stay <= 1', async () => {
  const { jobs, outcome } = await scoreFixture(true)
  const g = outcome.grades.get('n1')!
  const ctor = jobs[0]!.blocks.find(b => isCtor(b.text))
  assert.ok(ctor, 'the constructor section reaches S6 through the pre-rank')
  assert.ok(g.get(ctor.blockId)!.grade >= 2, 'rank ' + g.get(ctor.blockId)!.rank)
  const unrelated = jobs[0]!.blocks.filter(b => isUnrelatedSample(b.text))
  assert.ok(unrelated.length >= 6)
  for (const b of unrelated) assert.ok(g.get(b.blockId)!.grade <= 1, 'unrelated block graded ' + g.get(b.blockId)!.grade + ': ' + b.text.slice(0, 50))
  const best = Math.max(...unrelated.map(b => g.get(b.blockId)!.rank!))
  assert.ok(g.get(ctor.blockId)!.rank! > best * 1.5)
  // The table of contents names every API but answers nothing: the goal terms (Node.js) must not lift it.
  const toc = jobs[0]!.blocks.find(b => b.text.startsWith('View as JSON'))!
  assert.ok(g.get(toc.blockId)!.grade <= 1)
})

test('selection puts the constructor section in the pack and keeps the unrelated samples out', async () => {
  const { blocks, jobs, outcome } = await scoreFixture(true)
  const byId = new Map(blocks.map(b => [b.blockId, b]))
  const scored = new Map<string, ScoredBlock>()
  for (const job of jobs) for (const b of job.blocks) {
    const entry = scored.get(b.blockId) ?? { candidateId: 'c1', url: URL_SQLITE, title: 'SQLite', providers: ['ddg'], block: byId.get(b.blockId)!, grades: new Map() }
    entry.grades.set(job.need.id, outcome.grades.get(job.need.id)!.get(b.blockId)!)
    scored.set(b.blockId, entry)
  }
  const { selected } = selectEvidence({ query: TASK.query, needs: NEEDS }, [...scored.values()])
  assert.ok(selected.some(s => isCtor(s.block.block.text) && s.needIds.includes('n1')))
  assert.ok(!selected.some(s => isUnrelatedSample(s.block.block.text)))
})

test('pipeline end to end: n1 is covered by the documentation section, not by serialize() / aggregate() samples', async () => {
  const deps: PipelineDeps = {
    providerStatus: async ids => new Map(ids.map(id => [id, { state: 'ready' as const }])),
    searchProvider: async () => ({ state: 'ok', sources: [{ url: URL_SQLITE, title: 'SQLite | Node.js Documentation', snippet: 'node:sqlite DatabaseSync busy timeout' }] }),
    fetchPage: async url => ({ url, text: FIXTURE.text }),
    scorers: {},
    configuredEngines: ['ddg'],
    fusion: { k: 60, freshnessBoost: 0, freshnessDays: 30, authorityBoost: 0, authorityDomains: [] },
    newId: () => 'r_m3b0001',
  }
  const task: TaskSpec = { ...TASK, profile: 'docs_code', budget: {} }
  const { pack } = await runPipeline(task, deps)
  assert.ok(pack.coveredNeeds.includes('n1'))
  const ctor = pack.evidence.find(e => e.needIds.includes('n1') && /busy timeout/i.test(e.excerpt))
  assert.ok(ctor, 'an excerpt with the documented timeout option supports n1')
  assert.ok(ctor.grade >= 2)
  assert.ok(!pack.evidence.some(e => isUnrelatedSample(e.excerpt)), 'no serialize / aggregate / loadExtension sample in the pack')
})

// ── building blocks ─────────────────────────────────────────────────────────

const stats = (n: number, df: Record<string, number>): PageTermStats => ({ n, dfLexical: t => df[t] ?? 0, dfLatin: t => df[t] ?? 0 })

test('idfFactor / isDistinctive: floor 0.2, absent terms keep their weight, only rare terms are distinctive', () => {
  assert.equal(idfFactor(0, 100), 1)
  assert.ok(idfFactor(100, 100) < 0.25 && idfFactor(100, 100) >= 0.2)
  assert.ok(idfFactor(2, 100) > 0.85)
  assert.ok(idfFactor(10, 100) > idfFactor(50, 100))
  assert.equal(isDistinctive(0, 100), false, 'a term nobody has cannot distinguish blocks')
  assert.equal(isDistinctive(3, 100), true)
  assert.equal(isDistinctive(60, 100), false)
  assert.ok(codeCredit(1, 100) > 0.45 && codeCredit(100, 100) < 0.15, 'code-only credit shrinks as the term gets common')
})

test('splitProseCode: fences and code-looking lines are code, inline code stays prose', () => {
  const { prose, code } = splitProseCode('Use `timeout` to wait.\n```js\nconst db = new DatabaseSync(":memory:")\n```\nThen call it.\nimport { x } from "y";\nBusy handling is automatic.')
  assert.match(prose, /Use `timeout` to wait\./)
  assert.match(prose, /Busy handling is automatic\./)
  assert.match(code, /new DatabaseSync/)
  assert.match(code, /import \{ x \}/)
  assert.ok(!prose.includes('DatabaseSync'))
})

test('statsOverlap: a term found only in code counts less, a page-common term counts less, the goal cannot make a block distinctive', () => {
  const s = stats(40, { timeout: 2, databasesync: 30, node: 35 })
  const parts = [{ text: 'DatabaseSync timeout', weight: 1.6 }, { text: 'node js', weight: 0.8, context: true }]
  const prose = statsOverlap(parts, 'The timeout option of DatabaseSync is in milliseconds.', s)
  const code = statsOverlap(parts, '```\nnew DatabaseSync({ timeout: 5 })\n```', s)
  assert.ok(prose.relevance > code.relevance)
  assert.equal(prose.distinctiveHit, true)
  const common = statsOverlap(parts, 'DatabaseSync and node are mentioned, nothing else.', s)
  assert.equal(common.distinctiveAvailable, true)
  assert.equal(common.distinctiveHit, false, 'only page-common terms matched')
  assert.ok(common.relevance < prose.relevance)
  const goalOnly = statsOverlap([{ text: 'timeout', weight: 1 }, { text: 'node', weight: 0.8, context: true }], 'node node', stats(40, { timeout: 2, node: 3 }))
  assert.equal(goalOnly.distinctiveHit, false, 'a rare goal term alone is context, not evidence')
})

test('alignedScore: without statistics code-only matches keep full credit (M3a behaviour)', () => {
  const ctx = { goal: '了解 DatabaseSync 超时', query: 'DatabaseSync timeout', need: 'DatabaseSync 的 timeout 选项', constraints: [] }
  const item = { text: '```js\nconst db = new DatabaseSync(path, { timeout: 100 })\n```' }
  const plain = alignedScore(ctx, item)
  const s = stats(50, { databasesync: 40, timeout: 2 })
  const weighted = alignedScore(ctx, item, s)
  assert.equal(plain.distinctiveHit, false)
  assert.equal(weighted.distinctiveHit, true)
  assert.ok(plain.relevance > 0)
})

test('RuleScorer: fewer than 8 blocks in the corpus means no statistics (same grades as without a corpus)', async () => {
  const blocks = ['DatabaseSync timeout option in ms', 'DatabaseSync open()', 'other'].map((text, i) => ({ blockId: 'b' + i, url: 'https://x.test/p', text }))
  const job: ScoreJob = { need: NEEDS[0]!, blocks }
  const a = await new RuleScorer().score(TASK, [job])
  const b = await new RuleScorer().score(TASK, [job], { corpus: blocks })
  assert.deepEqual([...b.grades.get('n1')!], [...a.grades.get('n1')!])
})

// ── issue / PR pages versus docs (docs_code) ────────────────────────────────

test('isDiscussionUrl', () => {
  assert.ok(isDiscussionUrl('https://github.com/nodejs/node/issues/57597'))
  assert.ok(isDiscussionUrl('https://github.com/nodejs/node/pull/1?x=1'))
  assert.ok(isDiscussionUrl('https://github.com/nodejs/node/discussions/9'))
  assert.ok(!isDiscussionUrl('https://github.com/nodejs/node/blob/main/doc/api/sqlite.md'))
  assert.ok(!isDiscussionUrl('https://nodejs.org/api/sqlite.html'))
})

function outcomeOf(grade: number, ids: string[]): ScoreOutcome {
  return { grades: new Map([['n1', new Map(ids.map(id => [id, { grade, rank: grade / 3 }]))]]) }
}

test('capDiscussionGrades: an issue cannot reach grade 3 for a docs need while a docs page is present; everything else is untouched', () => {
  const issue = { blockId: 'i', url: 'https://github.com/nodejs/node/issues/57597', text: 'proposal: add timeout option' }
  const docs = { blockId: 'd', url: 'https://nodejs.org/api/sqlite.html', text: 'timeout' }
  const need = { id: 'n1', text: '官方文档是否提供 timeout 构造选项', critical: true }
  const plain = { id: 'n1', text: 'timeout 构造选项的默认值', critical: true }
  const out = outcomeOf(3, ['i', 'd'])
  assert.equal(capDiscussionGrades('docs_code', [{ need, blocks: [issue, docs] }], out), 1)
  assert.equal(out.grades.get('n1')!.get('i')!.grade, 2)
  assert.equal(out.grades.get('n1')!.get('d')!.grade, 3)
  const other = outcomeOf(3, ['i', 'd'])
  assert.equal(capDiscussionGrades('news', [{ need, blocks: [issue, docs] }], other), 0, 'only docs_code')
  assert.equal(capDiscussionGrades('docs_code', [{ need: plain, blocks: [issue, docs] }], other), 0, 'the need does not ask for the docs')
  const alone = outcomeOf(3, ['i'])
  assert.equal(capDiscussionGrades('docs_code', [{ need, blocks: [issue] }], alone), 0, 'no docs page scored: nothing to prefer')
  assert.equal(alone.grades.get('n1')!.get('i')!.grade, 3)
})

// ── coverage caveat ─────────────────────────────────────────────────────────

test('render: one short heuristic-coverage line under the header', () => {
  const text = renderEvidencePack({
    resultId: 'r_1', profile: 'docs_code', needs: [{ id: 'n1', text: 'x', critical: true }], evidence: [], coveredNeeds: [], gaps: [], partial: false, notes: [],
    verification: { native: [], local: [] },
  }, [], 'Engine: none')
  const lines = text.split('\n')
  assert.match(lines[0]!, /^Evidence pack r_1 /)
  assert.match(lines[1]!, /^Coverage is heuristic/)
  assert.ok(lines[1]!.length <= 120)
  assert.match(lines[1]!, /does not mean it does not exist/)
})
