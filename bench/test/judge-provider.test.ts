import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createModelScorer, PRESETS } from '../../src/pipeline/judges/providers.ts'
import type { ProviderConfig } from '../../src/pipeline/judges/types.ts'
import { evaluate, r1JevCache, runStages, type EvalOptions, type LoadedTask } from '../src/eval-pack.ts'
import { JudgeCache } from '../src/judges/cache.ts'
import { createJevJudge } from '../src/judges/jev.ts'
import { createLayaJudge } from '../src/judges/laya.ts'
import { createProviderJudge, judgeIdOf, loadProvidersFile, pickProvider } from '../src/judges/provider.ts'
import { loadRubrics, renderQuestion } from '../src/judges/rubrics.ts'
import { splitBlocks } from '../../src/pipeline/blocks.ts'
import type { BenchTask, CandidateSnapshot, Label, PageSnapshot } from '../src/types.ts'

const rubrics = loadRubrics()
const scoreQ = renderQuestion(rubrics.get('score.support.v1')!, { need: '需求' })
interface Call { url: string; headers: Record<string, string>; body: any }
function mock(score = 2.4) {
  const calls: Call[] = []
  const fetchImpl = (async (url: string, init: { headers: Record<string, string>; body: string }) => {
    const call: Call = { url, headers: init.headers, body: JSON.parse(init.body) }
    calls.push(call)
    return new Response(JSON.stringify({ answers: Object.fromEntries(Object.keys(call.body.questions).map(k => [k, { score }])), usage: { input_tokens: 10 } }))
  }) as unknown as typeof fetch
  return { calls, fetchImpl }
}
const tmp = (): string => fs.mkdtempSync(path.join(os.tmpdir(), 'bench-provider-'))

test('createProviderJudge: the laya-local preset gives the same wire as createLayaJudge (url, model, max_len, no auth, candidate cut)', async () => {
  const a = mock()
  const b = mock()
  const viaPreset = createProviderJudge(PRESETS['laya-local']!, { fetchImpl: a.fetchImpl })
  const viaLaya = createLayaJudge({ fetchImpl: b.fetchImpl })
  const items = [{ id: 'x', text: '候选'.repeat(500) }]
  await viaPreset.evaluate('s', scoreQ, items)
  await viaLaya.evaluate('s', scoreQ, items)
  assert.deepEqual(a.calls[0], b.calls[0])
  assert.equal(a.calls[0]!.url, 'http://127.0.0.1:8765/v1/systemone')
  assert.deepEqual(Object.keys(a.calls[0]!.headers), ['content-type'])
  assert.equal(a.calls[0]!.body.max_len, 1024)
  assert.equal(viaPreset.id, 'laya-local', 'the provider id (createLayaJudge keeps its experiment ids laya / laya-english)')
  assert.equal(viaLaya.id, 'laya')
})

test('createJevJudge is the bocha-jev preset: URL, model, bearer key, legacy id; the key is required', async () => {
  const { calls, fetchImpl } = mock()
  const jev = createJevJudge({ apiKey: 'k1', fetchImpl })
  await jev.evaluate('s', scoreQ, [{ id: 'x', text: 'c' }])
  assert.equal(calls[0]!.url, 'https://jev.bocha.cn/v1/systemone')
  assert.equal(calls[0]!.body.model, 'bocha-jev-v1')
  assert.equal(calls[0]!.headers.authorization, 'Bearer k1')
  assert.deepEqual(Object.keys(calls[0]!.body), ['model', 'state', 'questions'])
  assert.equal(jev.id, 'jev')
  assert.equal(judgeIdOf(PRESETS['bocha-jev']!), 'jev')
  const saved = process.env.BOCHA_JEV_API_KEY
  delete process.env.BOCHA_JEV_API_KEY
  try { assert.throws(() => createJevJudge(), /BOCHA_JEV_API_KEY is not set/) } finally { if (saved !== undefined) process.env.BOCHA_JEV_API_KEY = saved }
})

test('createProviderJudge: custom systemone provider with limits and a key from its keyRef; rerank / llm providers are refused with the reason', async () => {
  const p: ProviderConfig = { id: 'my-jev', protocol: 'systemone', baseUrl: 'https://jev.example.test', model: 'm1', keyRef: 'BENCH_TEST_JEV_KEY', limits: { maxQuestionsPerRequest: 2, blockChars: 20 } }
  delete process.env.BENCH_TEST_JEV_KEY
  assert.throws(() => createProviderJudge(p), /BENCH_TEST_JEV_KEY is not set/)
  process.env.BENCH_TEST_JEV_KEY = 'sk-env'
  try {
    const { calls, fetchImpl } = mock()
    const judge = createProviderJudge(p, { fetchImpl })
    const res = await judge.evaluate('s', scoreQ, Array.from({ length: 3 }, (_, i) => ({ id: 'i' + i, text: '很长很长的候选文本'.repeat(10) })))
    assert.deepEqual(calls.map(c => Object.keys(c.body.questions).length), [2, 1])
    assert.equal(calls[0]!.headers.authorization, 'Bearer sk-env')
    assert.equal(calls[0]!.url, 'https://jev.example.test/v1/systemone')
    assert.ok(calls[0]!.body.questions.q0.instructions.includes('候选文本…') || calls[0]!.body.questions.q0.instructions.length < 200)
    assert.equal(res[0]!.judge, 'my-jev')
    assert.ok(!JSON.stringify(res).includes('sk-env'))
  } finally { delete process.env.BENCH_TEST_JEV_KEY }
  assert.throws(() => createProviderJudge(PRESETS['jina-rerank']!), /speaks rerank.*use eval-pack/)
  assert.throws(() => createProviderJudge({ ...p, protocol: 'llm' }), /speaks llm/)
})

test('pickProvider and --providers-file: presets, custom entries, and the reasons a provider cannot be used', () => {
  const dir = tmp()
  try {
    assert.equal(pickProvider(undefined).id, 'bocha-jev')
    assert.equal(pickProvider('laya-local').id, 'laya-local')
    assert.throws(() => pickProvider('typesafe-jev'), /placeholder preset/)
    assert.throws(() => pickProvider('jina-rerank'), /calibration\.points/)
    assert.throws(() => pickProvider('nope'), /not defined/)
    const file = path.join(dir, 'providers.json')
    fs.writeFileSync(file, JSON.stringify({ 'jina-rerank': { calibration: { version: 'v1', points: [[0, 0], [1, 3]] } }, 'my-llm': { protocol: 'llm', baseUrl: 'https://llm.example.test/v1', model: 'j' } }))
    const providers = loadProvidersFile(file)
    assert.equal(pickProvider('jina-rerank', providers).calibration!.version, 'v1')
    assert.equal(pickProvider('my-llm', providers).protocol, 'llm', 'the bench is explicit about the provider, the llm gate is open')
    fs.writeFileSync(file, '[]')
    assert.throws(() => loadProvidersFile(file), /must be a JSON object/)
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
})

test('judge cache adapter is per provider: the hosted Jev keeps the jev directory, another provider gets its own and never sees its answers', async () => {
  const root = tmp()
  try {
    const probe = { state: '搜索任务：x', need: '需求', candidate: '文本块' }
    const jev = r1JevCache(root)
    jev.set(probe, { grade: 3 })
    assert.ok(fs.existsSync(path.join(root, 'jev')))
    const other: ProviderConfig = { id: 'my-jev', protocol: 'systemone', baseUrl: 'https://j2.example.test', model: 'bocha-jev-v1', keyRef: 'K' }
    const mine = r1JevCache(root, undefined, other)
    assert.equal(mine.get(probe), undefined, 'same model name, different provider: no reuse')
    mine.set(probe, { grade: 1 })
    assert.ok(fs.existsSync(path.join(root, 'my-jev')))
    assert.equal(r1JevCache(root, undefined, other).get(probe)!.grade, 1)
    assert.equal(r1JevCache(root).get(probe)!.grade, 3)
    // a different model of the same provider is a different key
    assert.equal(r1JevCache(root, undefined, { ...other, model: 'm2' }).get(probe), undefined)
  } finally { fs.rmSync(root, { recursive: true, force: true }) }
})

test('judge cache adapter reads what the bench judge of the same provider wrote (laya-local)', async () => {
  const root = tmp()
  try {
    const laya = PRESETS['laya-local']!
    const judge = createProviderJudge(laya, { cache: new JudgeCache(root, judgeIdOf(laya)), fetchImpl: mock(1.5).fetchImpl })
    const state = '搜索任务：x'
    const text = '块文本'
    await judge.evaluate(state, renderQuestion(rubrics.get('score.support.v1')!, { need: '需求' }), [{ id: 'b', text }])
    assert.equal(r1JevCache(root, undefined, laya).get({ state, need: '需求', candidate: text })!.grade, 1.5)
  } finally { fs.rmSync(root, { recursive: true, force: true }) }
})

// ── a reranker through the offline evaluation ───────────────────────────────

const PAGE_A = '# Busy timeout\n\nIn node:sqlite you set the busy timeout with PRAGMA busy_timeout = 5000 on the DatabaseSync connection. The busy timeout makes a blocked writer wait instead of failing at once.\n\n# Unrelated\n\nThe cooking section explains how to bake bread with flour and water in a hot oven for an hour.'
const page = (url: string, text: string): PageSnapshot => ({ url, fetchedAt: 'x', status: 'ok', source: 'http', text, from: [], blocks: splitBlocks(text, url) })

function fixture(): LoadedTask {
  const task: BenchTask = { id: 'dc-98', profile: 'docs_code', lang: 'en', goal: 'Set the busy timeout in node:sqlite', query: 'node:sqlite busy timeout', needs: [{ id: 'n1', text: 'how to set busy timeout in node:sqlite', critical: true }], constraints: [], traps: ['x'], notes: 'n' }
  const pageA = page('https://docs.test/a', PAGE_A)
  const snapshot: CandidateSnapshot = { version: 1, taskId: task.id, harvestedAt: 'h', engineRuns: [{ engine: 'ddg', query: task.query, status: 'ok', ms: 1, results: [{ rank: 1, url: 'https://docs.test/a', title: 'Busy docs', snippet: 'node:sqlite busy timeout' }] }], pages: [pageA] }
  const gold = pageA.blocks.find(b => b.text.includes('PRAGMA busy_timeout'))!
  const label: Label = { version: 1, taskId: task.id, snapshotHarvestedAt: 'h', labeler: { kind: 'llm', id: 't' }, labeledAt: 'now', candidates: [], gold: [{ needId: 'n1', evidence: [{ url: 'https://docs.test/a', blockId: gold.blockId, hash: gold.hash }] }] }
  return { task, split: 'calibration', snapshot, label }
}

test('eval-pack with a reranker provider: cached RAW scores answer the arm, a new calibration re-grades them without a request', async () => {
  const root = tmp()
  try {
    const f = fixture()
    const rerank = (calibration: ProviderConfig['calibration']): ProviderConfig => ({ ...PRESETS['jina-rerank']!, calibration })
    const lenient = rerank({ version: 'lenient', points: [[0, 0], [0.1, 3]] })
    const strict = rerank({ version: 'strict', points: [[0.9, 0], [1, 3]] })
    const opts = (provider: ProviderConfig): EvalOptions => ({ select: {}, fetchTopK: 4, blocksPerNeed: 0, allowJev: 0, jev: true, jevRoot: root, provider })
    // cold: no cache, no allowance: the arm falls back and counts what it would need
    const cold = await evaluate([f], opts(lenient))
    assert.equal(cold.tasks[0]!.jevStatus, 'fallback')
    assert.equal(cold.jevRequests, 0)
    assert.ok(cold.tasks[0]!.uses.jev!.cold >= 1)
    // answer the questions the rerank scorer asks from the cache with RAW scores (relevance of a block that says busy_timeout is high)
    const cache = r1JevCache(root, undefined, lenient)
    const probes: { state: string; need: string; candidate: string }[] = []
    const recorder = createModelScorer(lenient, { apiKey: 'offline', requestCap: 0, cache: { get: p => { probes.push(p); return undefined }, set() {} }, fetchImpl: (async () => { throw new Error('offline') }) as never })
    await runStages(f, opts(lenient), recorder)
    assert.ok(probes.length > 0)
    for (const p of probes) cache.set(p, { grade: p.candidate.includes('PRAGMA busy_timeout') ? 0.95 : 0.2 })
    const hot = await evaluate([f], opts(lenient))
    assert.equal(hot.tasks[0]!.jevStatus, 'answered')
    assert.equal(hot.tasks[0]!.jevRequests, 0)
    assert.equal(hot.tasks[0]!.jev!.retained, 1)
    // the strict calibration reads the same raw scores (same cache directory and keys) and grades the 0.2 blocks 0
    const again = await evaluate([f], opts(strict))
    assert.equal(again.tasks[0]!.jevStatus, 'answered')
    assert.equal(again.tasks[0]!.jevMisses, 0, 'no new question: raw scores are calibration independent')
    // another provider (own directory) cannot use them
    const elsewhere = await evaluate([f], opts({ ...lenient, id: 'other-rerank' }))
    assert.equal(elsewhere.tasks[0]!.jevStatus, 'fallback')
  } finally { fs.rmSync(root, { recursive: true, force: true }) }
})
