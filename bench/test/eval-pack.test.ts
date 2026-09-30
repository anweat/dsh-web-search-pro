import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { splitBlocks } from '../../src/pipeline/blocks.ts'
import { HybridScorer, JevScorer } from '../../src/pipeline/score.ts'
import {
  approxTokens, evaluate, goldPairs, jevMisses, pageFetcher, providerOutputs, r1JevCache, renderReport, runStages, summarize,
  type EvalOptions, type LoadedTask, type TaskEval,
} from '../src/eval-pack.ts'
import { JudgeCache } from '../src/judges/cache.ts'
import { loadRubrics, renderQuestion } from '../src/judges/rubrics.ts'
import { SystemOneJudge } from '../src/judges/systemone.ts'
import { JEV_MODEL } from '../src/judges/jev.ts'
import type { BenchTask, CandidateSnapshot, Label, PageSnapshot } from '../src/types.ts'

const PAGE_A = '# Busy timeout\n\nIn node:sqlite you set the busy timeout with PRAGMA busy_timeout = 5000 on the DatabaseSync connection. The busy timeout makes a blocked writer wait instead of failing at once.\n\n# Unrelated\n\nThe cooking section explains how to bake bread with flour and water in a hot oven for an hour.'
const PAGE_B = Array.from({ length: 40 }, (_, i) => 'Gardening paragraph ' + i + ' about tools, soil and watering schedules for the summer months, with plenty of unrelated detail to read.').join('\n\n')

const page = (url: string, text: string, status: PageSnapshot['status'] = 'ok'): PageSnapshot => ({ url, fetchedAt: 'x', status, source: 'http', text, from: [], blocks: splitBlocks(text, url) })

function fixture(): LoadedTask {
  const task: BenchTask = {
    id: 'dc-99', profile: 'docs_code', lang: 'en', goal: 'Set the busy timeout in node:sqlite', query: 'node:sqlite busy timeout',
    needs: [{ id: 'n1', text: 'how to set busy timeout in node:sqlite', critical: true }, { id: 'n2', text: 'quantum gravity lattice theory', critical: false }],
    constraints: [], traps: ['x'], notes: 'n',
  }
  const pageA = page('https://docs.test/a', PAGE_A)
  const pageB = page('https://docs.test/b', PAGE_B)
  const broken = page('https://docs.test/broken', '', 'error')
  const snapshot: CandidateSnapshot = {
    version: 1, taskId: task.id, harvestedAt: 'h',
    engineRuns: [
      { engine: 'ddg', query: task.query, status: 'ok', ms: 1, results: [
        { rank: 1, url: 'https://docs.test/a', title: 'Busy docs', snippet: 'node:sqlite busy timeout' },
        { rank: 2, url: 'https://docs.test/b', title: 'Gardening', snippet: 'node:sqlite busy timeout gardening' },
        { rank: 3, url: 'https://docs.test/broken', title: 'Broken', snippet: 'node:sqlite busy timeout' },
      ] },
      { engine: 'bing', query: task.query, status: 'empty', ms: 1, results: [] },
    ],
    pages: [pageA, pageB, broken],
  }
  const gold = pageA.blocks.find(b => b.text.includes('PRAGMA busy_timeout'))!
  const label: Label = {
    version: 1, taskId: task.id, snapshotHarvestedAt: 'h', labeler: { kind: 'llm', id: 't' }, labeledAt: 'now', candidates: [],
    gold: [{ needId: 'n1', evidence: [{ url: 'https://docs.test/a', blockId: gold.blockId, hash: gold.hash }] }, { needId: 'n2', evidence: [] }],
  }
  return { task, split: 'calibration', snapshot, label }
}
const OPTS: EvalOptions = { select: {}, fetchTopK: 4, blocksPerNeed: 12, allowJev: 0, jev: false }

test('goldPairs lists distinct (need, block) pairs with canonical URLs', () => {
  const f = fixture()
  const pairs = goldPairs({ ...f.label, gold: [{ needId: 'n1', evidence: [...f.label.gold[0]!.evidence, ...f.label.gold[0]!.evidence] }, { needId: 'n2', evidence: [] }] })
  assert.equal(pairs.length, 1)
  assert.equal(pairs[0]!.url, 'https://docs.test/a')
})

test('pageFetcher: ok pages carry their snapshot blocks, failed pages throw, missing pages are undefined', async () => {
  const f = fixture()
  const fetchPage = pageFetcher(f.snapshot)
  const ok = await fetchPage('https://docs.test/a#frag', new AbortController().signal)
  assert.equal(ok!.blocks!.length, f.snapshot.pages[0]!.blocks.length)
  await assert.rejects(fetchPage('https://docs.test/broken', new AbortController().signal), /snapshot fetch failed/)
  assert.equal(await fetchPage('https://docs.test/never-fetched', new AbortController().signal), undefined)
  assert.equal(providerOutputs(f.snapshot).length, 1, 'empty engine runs are not outputs')
})

test('evaluate: baseline keeps the gold page whole, the pipeline keeps the gold block in a far smaller pack and flags the unanswerable need', async () => {
  const f = fixture()
  const { tasks, jevRequests } = await evaluate([f], OPTS)
  const t = tasks[0]!
  assert.equal(jevRequests, 0)
  assert.equal(t.jevStatus, 'off')
  assert.equal(t.goldPairs, 1)
  assert.equal(t.baseline.retained, 1)
  assert.equal(t.rule.retained, 1, 'the PRAGMA block is selected')
  assert.ok(t.rule.chars < t.baseline.chars / 2, t.rule.chars + ' vs ' + t.baseline.chars)
  assert.equal(t.rule.needsHit, 1)
  // The rule scorer also counts query and goal terms for every need, so it cannot separate the two needs
  // here: both count as covered (known limit, see the pack report); only n1 has gold.
  assert.equal(t.rule.claimedHit, 1)
  assert.ok(t.rule.claimed >= 1 && t.rule.claimed <= 2)
  assert.equal(t.rule.noGold, 1)
  assert.equal(t.rule.pages, 2, 'the broken page used a slot but produced no blocks')
  assert.ok(t.rule.scored >= 1 && t.rule.strong >= 1)
  assert.ok(t.baselineCut.chars <= t.rule.chars + 50 && t.baselineCut.retained <= t.baseline.retained)
  assert.equal(approxTokens('汉字'), Math.round(2 * 0.7))
  assert.equal(approxTokens('abcd'), Math.round(4 * 0.3))
})

test('the Jev cache adapter reads exactly what the r1 judge (SystemOneJudge) wrote, and writes entries it can read back', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wsp-evalpack-'))
  try {
    const rubric = loadRubrics().get('score.support.v1')!
    const state = '搜索任务：找 busy timeout'
    const need = '如何设置 busy timeout'
    const text = 'PRAGMA 节\nPRAGMA busy_timeout = 5000;'
    const judge = new SystemOneJudge({
      id: 'jev', model: JEV_MODEL, url: 'http://invalid.test', cache: new JudgeCache(root, 'jev'), sleep: async () => {},
      fetchImpl: (async (_url: string, init: { body: string }) => new Response(JSON.stringify({ answers: { q0: { score: 2.5, probabilities: { 2: 0.5, 3: 0.5 } } }, usage: { input_tokens: 1 } }), { status: 200, headers: {} })) as unknown as typeof fetch,
    })
    const [r] = await judge.evaluate(state, renderQuestion(rubric, { need }), [{ id: 'b1', text }])
    assert.equal(r!.grade, 2.5)
    const adapter = r1JevCache(root)
    const probe = { state, need, candidate: text }
    assert.equal(adapter.get(probe)!.grade, 2.5, 'same key as the judge that wrote it')
    assert.equal(adapter.hits, 1)
    assert.equal(adapter.get({ ...probe, candidate: text + ' changed' }), undefined)
    assert.equal(adapter.misses, 1)
    adapter.set({ ...probe, candidate: 'new block' }, { grade: 1.25 })
    assert.equal(r1JevCache(root).get({ ...probe, candidate: 'new block' })!.grade, 1.25)
    // and the r1 judge would also serve that entry from its cache
    const again = await judge.evaluate(state, renderQuestion(rubric, { need }), [{ id: 'b2', text: 'new block' }])
    assert.equal(again[0]!.cached, true)
    assert.equal(again[0]!.grade, 1.25)
  } finally { fs.rmSync(root, { recursive: true, force: true }) }
})

test('Jev arm: cache-only mode counts misses without any request, falls back per task, and uses fully cached tasks', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wsp-evalpack-'))
  try {
    const f = fixture()
    const opts: EvalOptions = { ...OPTS, jev: true, jevRoot: root }
    const misses = await jevMisses([f], opts)
    assert.ok(misses.get('dc-99')! > 0)
    const cold = await evaluate([f], opts)
    assert.equal(cold.jevRequests, 0)
    assert.equal(cold.tasks[0]!.jevStatus, 'fallback')
    assert.equal(cold.tasks[0]!.jevMisses, misses.get('dc-99'))
    // Record the questions the pipeline asks, answer them into the cache, and everything is served from it.
    const cache = r1JevCache(root)
    const questions: { state: string; need: string; candidate: string }[] = []
    const recorder = new JevScorer({ apiKey: 'offline', requestCap: 0, cache: { get: p => { questions.push(p); return undefined }, set() {} }, fetchImpl: (async () => { throw new Error('offline') }) as never })
    const { runEvidenceStages } = await import('../../src/pipeline/run.ts')
    const { toTaskSpec } = await import('../src/types.ts')
    const spec = toTaskSpec(f.task)
    const outputs = providerOutputs(f.snapshot)
    const never = new AbortController().signal
    await runEvidenceStages(spec, outputs, {
      fetchPage: pageFetcher(f.snapshot), scorers: { control: recorder }, configuredEngines: [], fusion: { k: 60, freshnessBoost: 0.2, freshnessDays: 30, authorityBoost: 0.25, authorityDomains: [] },
    }, { fetchTopK: 4, fetchConcurrency: 1 }, { plan: { profile: 'docs_code', profileInferred: false, providers: [{ id: 'ddg' }] }, notes: [], partial: false, stage: never, deadlineSignal: never, now: new Date(), verification: { native: [], local: [] } })
    assert.ok(questions.length > 0)
    for (const q of questions) cache.set(q, { grade: q.candidate.includes('PRAGMA busy_timeout') ? 3 : 0.4 })
    const hot = await evaluate([f], opts)
    assert.equal(hot.tasks[0]!.jevStatus, 'answered')
    assert.equal(hot.tasks[0]!.jevRequests, 0)
    assert.equal(hot.tasks[0]!.jev!.retained, 1)
    // an English need against English pages has no language mismatch: the hybrid arms ask Jev nothing and equal the aligned rule arm
    assert.equal(hot.tasks[0]!.uses.hybrid!.status, 'answered')
    assert.equal(hot.tasks[0]!.uses.hybrid!.questions, 0)
    assert.equal(hot.tasks[0]!.hybrid!.retained, hot.tasks[0]!.ruleAligned.retained)
    assert.equal(hot.tasks[0]!.uses.hybridB!.status, 'answered')
    assert.ok(hot.tasks[0]!.jevCacheHits >= questions.length)
  } finally { fs.rmSync(root, { recursive: true, force: true }) }
})

test('report: sections and numbers render for a run with and without Jev', async () => {
  const f = fixture()
  const { tasks } = await evaluate([f], OPTS)
  const md = renderReport({ runId: 't', tasks, opts: OPTS, jevRequests: 0, generatedAt: 'now' })
  for (const heading of ['## 1. 设置', '## 2. 总体对比', '## 4. 按 profile', '## 5. 按语言', '## 8. 逐任务', '## 9. 局限']) assert.ok(md.includes(heading), heading)
  assert.ok(!md.includes('NaN') && !md.includes('undefined'))
  assert.match(md, /\| \(b\) 管线 \+ 规则评分 \| 1 \| 1 \| 100\.0% \|/)
  assert.ok(!md.includes('## 3. Jev 对照'))
  const jevTask: TaskEval = { ...tasks[0]!, jev: tasks[0]!.rule, jevStatus: 'answered', jevCacheHits: 3, jevMisses: 0, jevRequests: 0 }
  const withJev = renderReport({ runId: 't', tasks: [jevTask], opts: { ...OPTS, jev: true }, jevRequests: 0, generatedAt: 'now' })
  assert.ok(withJev.includes('## 3. Jev 对照') && withJev.includes('## 7. Jev 缓存与请求') && withJev.includes('(c) 管线 + Jev 评分'))
  assert.ok(!withJev.includes('NaN') && !withJev.includes('undefined'))
  const s = summarize([], t => t.rule)
  assert.equal(s.retention, undefined)
})

test('hybrid arms: a Chinese need against English pages costs Jev questions; cold requests are counted without any network; cached answers complete the arm', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wsp-evalpack-'))
  try {
    const f = fixture()
    f.task = { ...f.task, lang: 'zh', needs: [{ id: 'n1', text: '如何在 node:sqlite 中设置 busy timeout', critical: true }, { id: 'n2', text: '量子引力格点理论', critical: false }] }
    const opts: EvalOptions = { ...OPTS, jev: true, jevRoot: root }
    const cold = await evaluate([f], opts)
    const t = cold.tasks[0]!
    assert.equal(t.uses.hybrid!.status, 'fallback', 'unanswered questions and no allowance: the arm keeps the rule grades and is excluded')
    assert.ok(t.uses.hybrid!.cold >= 1 && t.uses.hybrid!.requests === 0 && t.uses.hybrid!.misses > 0)
    assert.ok(t.uses.jev!.cold >= t.uses.hybrid!.cold, 'Jev on every pair never needs fewer requests than Jev on mismatches only')
    assert.equal(t.hybrid!.retained, t.ruleAligned.retained, 'fallback = aligned rule pack')
    // answer exactly the hybrid questions from the cache, then the arm completes
    const cache = r1JevCache(root)
    const questions: { state: string; need: string; candidate: string }[] = []
    const recorder = new JevScorer({ apiKey: 'offline', requestCap: 0, cache: { get: p => { questions.push(p); return undefined }, set() {} }, fetchImpl: (async () => { throw new Error('offline') }) as never })
    await runStages(f, opts, new HybridScorer({ jev: recorder }))
    assert.ok(questions.length > 0)
    for (const q of questions) cache.set(q, { grade: 3 })
    const hot = await evaluate([f], opts)
    assert.equal(hot.tasks[0]!.uses.hybrid!.status, 'answered')
    assert.equal(hot.tasks[0]!.uses.hybrid!.questions, questions.length)
    assert.equal(hot.tasks[0]!.uses.hybrid!.misses, 0)
    const md = renderReport({ runId: 't', tasks: hot.tasks, opts, jevRequests: 0, generatedAt: 'now' })
    assert.ok(!md.includes('NaN') && !md.includes('undefined'))
    assert.ok(md.includes('(b′) 管线 + 规则评分（跨语言对齐）') && md.includes('(d) 混合') && md.includes('(d′) 混合 + 规则边界对'))
  } finally { fs.rmSync(root, { recursive: true, force: true }) }
})
