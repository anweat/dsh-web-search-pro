import test from 'node:test'
import assert from 'node:assert/strict'
import { buildReport, buildTruth, renderMarkdown } from '../src/report.ts'
import { buildJobs, interleaveBySplit, rowsOf, stateFor, type ResultRow } from '../src/run-judges.ts'
import { loadRubrics } from '../src/judges/rubrics.ts'
import type { BenchTask, CandidateSnapshot, Label, Split } from '../src/types.ts'

const rubrics = loadRubrics()

const task: BenchTask = {
  id: 'dc-98', profile: 'docs_code', lang: 'zh', goal: '查 pnpm catalog 用法', query: 'pnpm catalog 用法',
  needs: [{ id: 'n1', text: 'catalog 的写法', critical: true }, { id: 'n2', text: '最低版本', critical: false }],
  constraints: [
    { id: 'c1', kind: 'entity', value: 'pnpm', strength: 'hard' },
    { id: 'c2', kind: 'site', value: 'pnpm.io', strength: 'soft' },
  ],
  traps: ['x'], notes: 'n',
}

function snapshotWithBlocks(nBlocks: number): CandidateSnapshot {
  return {
    version: 1, taskId: task.id, harvestedAt: 't',
    engineRuns: [{ engine: 'ddg', query: task.query, status: 'ok', ms: 1, results: [
      { rank: 1, url: 'https://pnpm.io/catalogs', title: 'Catalogs', snippet: 'pnpm catalog' },
      { rank: 2, url: 'https://example.com/', title: 'Home', snippet: '' },
    ] }],
    pages: [{
      url: 'https://pnpm.io/catalogs', fetchedAt: 't', status: 'ok', source: 'http', text: '', from: [],
      blocks: Array.from({ length: nBlocks }, (_, i) => ({ blockId: 'b_' + String(i).padStart(12, '0'), text: i === 2 ? 'pnpm catalog 的写法示例 最低版本' : 'filler ' + i, start: i, end: i + 1, hash: 'h' + i })),
    }],
  }
}

test('buildJobs: S4 gate jobs, per-constraint jobs, S6 jobs capped per need with lexical pre-ranking', () => {
  const jobs = buildJobs(task, snapshotWithBlocks(30), rubrics, { groups: ['s4', 's6'], gates: ['single', 'relevance', 'constraint', 'nav'], blocksPerNeed: 5 })
  const s4 = jobs.filter(j => j.group === 's4')
  assert.deepEqual(s4.map(j => j.question.rubricId), ['gate.single.v1', 'gate.relevance.v1', 'gate.constraint.v1', 'gate.constraint.v1', 'gate.nav.v1'])
  assert.equal(s4[0]!.items.length, 2)
  assert.equal(s4[0]!.items[0]!.meta!.url, 'https://pnpm.io/catalogs')
  assert.equal(s4[2]!.constraintId, 'c1')
  assert.equal(s4[2]!.question.context!.constraint!.kind, 'entity')
  const s6 = jobs.filter(j => j.group === 's6')
  assert.equal(s6.length, 2)
  assert.equal(s6[0]!.items.length, 5)
  assert.equal(s6[0]!.items[0]!.id, 'b_000000000002')
  assert.equal(s6[0]!.question.kind, 'score')
  assert.match(s6[0]!.question.instructions, /需求：catalog 的写法/)
  assert.equal(stateFor(task), '搜索任务：查 pnpm catalog 用法')
  const none = buildJobs(task, snapshotWithBlocks(0), rubrics, { groups: ['s6'], gates: [], blocksPerNeed: 5 })
  assert.equal(none.length, 0)
})

test('interleaveBySplit alternates calibration and test', () => {
  const splits = new Map<string, Split>([['a', 'calibration'], ['b', 'calibration'], ['c', 'test'], ['d', 'calibration']])
  assert.deepEqual(interleaveBySplit([{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }], splits).map(t => t.id), ['a', 'c', 'b', 'd'])
})

test('interleaveBySplit keeps heldout tasks (v2) after the interleaved ones', () => {
  const splits = new Map<string, Split>([['a', 'calibration'], ['b', 'test'], ['h1', 'heldout'], ['h2', 'heldout']])
  assert.deepEqual(interleaveBySplit([{ id: 'h1' }, { id: 'a' }, { id: 'h2' }, { id: 'b' }], splits).map(t => t.id), ['a', 'b', 'h1', 'h2'])
  assert.deepEqual(interleaveBySplit([{ id: 'h1' }, { id: 'h2' }], splits).map(t => t.id), ['h1', 'h2'])
})

// ── report ──────────────────────────────────────────────────────────────────

function label(taskId: string, cands: [string, number, boolean?][], gold: Record<string, [string, string][]>): Label {
  return {
    version: 1, taskId, snapshotHarvestedAt: 't', labeler: { kind: 'llm', id: 'deepseek-flash', reviewed: false }, labeledAt: 't',
    candidates: cands.map(([url, relevance, nav]) => ({ url, relevance: relevance as 0, constraintChecks: [{ constraintId: 'c1', satisfied: relevance >= 2 ? 'yes' : 'no' }], navPage: nav ?? false })),
    gold: Object.entries(gold).map(([needId, ev]) => ({ needId, evidence: ev.map(([url, blockId]) => ({ url, blockId, hash: 'h' })) })),
  }
}

function snap(taskId: string, url: string, blockIds: string[]): CandidateSnapshot {
  return { version: 1, taskId, harvestedAt: 't', engineRuns: [], pages: [{ url, fetchedAt: 't', status: 'ok', source: 'http', text: '', from: [], blocks: blockIds.map((blockId, i) => ({ blockId, text: '', start: i, end: i, hash: 'h' })) }] }
}

let rowNo = 0
const row = (p: Partial<ResultRow>): ResultRow => ({
  runId: 'r', stage: 's4', judge: 'x', rubricId: 'gate.single.v1', rubricVersion: 'v1', taskId: 'A', split: 'calibration', lang: 'en', profile: 'docs_code',
  itemId: 'u' + rowNo++, kind: 'noul', latencyMs: 0, ...p,
})

test('buildReport: AUC, calibration threshold, test recall / dropped / gold recall, coverage', () => {
  const truth = new Map([
    ['A', buildTruth(label('A', [['https://a/u1', 3], ['https://a/u2', 2], ['https://a/u3', 0], ['https://a/u4', 0]], { n1: [['https://a/u1', 'bA1']] }), undefined)],
    ['B', buildTruth(label('B', [['https://b/v1', 3], ['https://b/v2', 0], ['https://b/v3', 1]], { n1: [['https://b/v1', 'bB1']] }), undefined)],
  ])
  const splits = new Map<string, Split>([['A', 'calibration'], ['B', 'test']])
  const rows: ResultRow[] = [
    ...[['https://a/u1', 0.9], ['https://a/u2', 0.6], ['https://a/u3', 0.3], ['https://a/u4', 0.2]].map(([u, p]) => row({ taskId: 'A', split: 'calibration', lang: 'en', itemId: u as string, prob: p as number })),
    ...[['https://b/v1', 0.8], ['https://b/v2', 0.5], ['https://b/v3', 0.7]].map(([u, p]) => row({ taskId: 'B', split: 'test', lang: 'zh', itemId: u as string, prob: p as number })),
    row({ taskId: 'B', split: 'test', lang: 'zh', itemId: 'https://b/v1', prob: 0.4, error: 'boom' }),
  ]
  const rep = buildReport({ runId: 'r', rows, tasks: [], splits, truth, labelers: ['deepseek-flash（未复核）'] })
  const g = rep.gate.find(x => x.judge === 'x' && x.rubricId === 'gate.single.v1')!
  assert.ok(Math.abs(g.slices.all!.auc! - 11 / 12) < 1e-9)
  assert.equal(g.slices.all!.n, 7)
  assert.equal(g.slices.all!.positives, 3)
  assert.equal(g.slices.zh!.n, 3)
  assert.equal(g.slices.en!.auc, 1)
  assert.equal(g.threshold, 0.6)
  // test: keep prob >= 0.6 -> v1 (0.8), v3 (0.7); v2 dropped
  assert.equal(g.test.all!.recall2, 1)
  assert.equal(g.test.all!.recall1, 1)
  assert.ok(Math.abs(g.test.all!.dropped! - 1 / 3) < 1e-9)
  assert.equal(g.test.all!.goldRecall, 1)
  assert.equal(g.test.all!.goldN, 1)
  assert.equal(g.calibrationTasks, 1)
  assert.equal(g.testTasks, 1)
  assert.equal(rep.coverage.x, 2)
  assert.equal(rep.cost[0]!.errors, 1)
  const md = renderMarkdown(rep)
  assert.match(md, /未经人工复核/)
  assert.match(md, /gate\.single\.v1/)
  assert.match(md, /0\.917/)
})

test('buildReport: constraint and nav rubrics use their own truth; unknown constraint labels are excluded', () => {
  const l = label('A', [['https://a/u1', 3, false], ['https://a/u2', 0, true], ['https://a/u3', 0, false]], {})
  l.candidates[2]!.constraintChecks[0]!.satisfied = 'unknown'
  const truth = new Map([['A', buildTruth(l, undefined)]])
  const rows = [
    row({ rubricId: 'gate.constraint.v1', constraintId: 'c1', itemId: 'https://a/u1', prob: 0.9 }),
    row({ rubricId: 'gate.constraint.v1', constraintId: 'c1', itemId: 'https://a/u2', prob: 0.2 }),
    row({ rubricId: 'gate.constraint.v1', constraintId: 'c1', itemId: 'https://a/u3', prob: 0.5 }),
    row({ rubricId: 'gate.nav.v1', itemId: 'https://a/u1', prob: 0.1 }),
    row({ rubricId: 'gate.nav.v1', itemId: 'https://a/u2', prob: 0.8 }),
  ]
  const rep = buildReport({ runId: 'r', rows, tasks: [], splits: new Map([['A', 'calibration']]), truth, labelers: [] })
  const cons = rep.gate.find(g => g.rubricId === 'gate.constraint.v1')!
  assert.equal(cons.slices.all!.n, 2)
  assert.equal(cons.slices.all!.auc, 1)
  assert.equal(cons.threshold, undefined)
  const nav = rep.gate.find(g => g.rubricId === 'gate.nav.v1')!
  assert.equal(nav.slices.all!.positives, 1)
  assert.equal(nav.slices.all!.auc, 1)
})

test('buildReport: S6 Spearman, confusion matrix and nDCG@5 (shared needs across judges)', () => {
  const l = label('A', [['https://a/p1', 3], ['https://a/p2', 0]], { n1: [['https://a/p1', 'b1']], n2: [] })
  const s = { version: 1 as const, taskId: 'A', harvestedAt: 't', engineRuns: [], pages: [
    ...snap('A', 'https://a/p1', ['b1', 'b2']).pages, ...snap('A', 'https://a/p2', ['b3']).pages,
  ] }
  const truth = new Map([['A', buildTruth(l, s)]])
  const mk = (judge: string, grades: Record<string, number>): ResultRow[] => Object.entries(grades).map(([b, g]) =>
    row({ stage: 's6', judge, rubricId: 'score.support.v1', kind: 'score', needId: 'n1', itemId: b, grade: g }))
  const rows = [...mk('good', { b1: 3, b2: 1, b3: 0 }), ...mk('bad', { b1: 1, b2: 1, b3: 1 })]
  const rep = buildReport({ runId: 'r', rows, tasks: [], splits: new Map([['A', 'calibration']]), truth, labelers: [] })
  const good = rep.score.find(x => x.judge === 'good')!
  const bad = rep.score.find(x => x.judge === 'bad')!
  assert.equal(good.ndcg5.all!.mean, 1)
  assert.equal(good.ndcg5.all!.needs, 1)
  // all tied: the relevant block gets the average gain 1/3 at each of 3 positions
  const expected = (1 / 3) * (1 + 1 / Math.log2(3) + 0.5)
  assert.ok(Math.abs(bad.ndcg5.all!.mean! - expected) < 1e-9)
  // page-level labels: b1,b2 -> 3; b3 -> 0. good grades 3,1,0 -> rho > 0
  assert.ok(good.spearman.all!.rho! > 0.8)
  assert.equal(good.spearman.all!.n, 3)
  assert.equal(good.confusion[3]![3], 1)
  assert.equal(good.confusion[1]![3], 1)
  assert.equal(good.confusion[0]![0], 1)
  assert.equal(bad.spearman.all!.rho, undefined)
  assert.equal(good.ndcg5Common.needs, 1)
})

test('buildReport: cost counts unique non-cached requests, tokens, p50/p95', () => {
  const rows = [
    row({ requestId: 'r1', latencyMs: 100, batchSize: 2, usage: { inputTokens: 500, outputTokens: 0 }, prob: 0.5 }),
    row({ requestId: 'r1', latencyMs: 100, batchSize: 2, prob: 0.5 }),
    row({ requestId: 'r2', latencyMs: 300, batchSize: 1, usage: { inputTokens: 250, outputTokens: 0 }, prob: 0.5 }),
    row({ cached: true, latencyMs: 0, prob: 0.5 }),
  ]
  const rep = buildReport({ runId: 'r', rows, tasks: [], splits: new Map(), truth: new Map(), labelers: [] })
  const c = rep.cost[0]!
  assert.equal(c.requests, 2)
  assert.equal(c.inputTokens, 750)
  assert.equal(c.cachedRows, 1)
  assert.equal(c.latencyP50, 200)
  assert.equal(c.latencyP95, 290)
  assert.equal(c.avgBatch, 1.5)
})

test('rowsOf carries split, language and usage into result rows', () => {
  const [r] = rowsOf('run1', { group: 's4', taskId: 'dc-98', state: '', question: { kind: 'noul', rubricId: 'gate.single.v1', rubricVersion: 'v1', instructions: '' }, items: [] }, task, 'test', 'jev',
    [{ id: 'u', prob: 0.7, judge: 'jev', rubricId: 'gate.single.v1', rubricVersion: 'v1', latencyMs: 12, usage: { inputTokens: 5, outputTokens: 0 } }])
  assert.equal(r!.split, 'test')
  assert.equal(r!.lang, 'zh')
  assert.equal(r!.usage!.inputTokens, 5)
})

test('buildReport on a heldout-only input: threshold comes from --thresholds-from, never from heldout data', () => {
  const truth = new Map([['H', buildTruth(label('H', [['https://h/u1', 3], ['https://h/u2', 0], ['https://h/u3', 2], ['https://h/u4', 0]], { n1: [['https://h/u1', 'bH1']] }), undefined)]])
  const splits = new Map<string, Split>([['H', 'heldout']])
  const rows: ResultRow[] = [['https://h/u1', 0.9], ['https://h/u2', 0.2], ['https://h/u3', 0.5], ['https://h/u4', 0.4]]
    .map(([u, p]) => row({ taskId: 'H', split: 'heldout', itemId: u as string, prob: p as number }))
  const none = buildReport({ runId: 'r', rows, tasks: [], splits, truth, labelers: [] })
  const g0 = none.gate.find(x => x.rubricId === 'gate.single.v1')!
  assert.equal(g0.threshold, undefined)
  assert.deepEqual(g0.test, {})
  assert.equal(none.tasks.heldout, 1)
  const rep = buildReport({ runId: 'r', rows, tasks: [], splits, truth, labelers: [], frozenThresholds: { 'x|gate.single.v1': 0.45 } })
  const g = rep.gate.find(x => x.rubricId === 'gate.single.v1')!
  assert.equal(g.threshold, 0.45)
  assert.equal(g.thresholdSource, 'frozen')
  assert.equal(g.calibrationDropped, undefined)
  assert.equal(g.testTasks, 1)
  // keep prob >= 0.45: u1 (0.9) and u3 (0.5); u2, u4 dropped
  assert.equal(g.test.all!.recall2, 1)
  assert.equal(g.test.all!.dropped, 0.5)
  assert.match(renderMarkdown(rep), /heldout 1/)
})
