import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { JudgeCache, cacheKey } from '../src/judges/cache.ts'
import { createJevJudge, JEV_MODEL, JEV_URL } from '../src/judges/jev.ts'
import { createLayaJudge } from '../src/judges/laya.ts'
import { loadRubrics, renderQuestion } from '../src/judges/rubrics.ts'
import { chunkItems, parseRetryAfter, SystemOneError } from '../src/judges/systemone.ts'
import type { JudgeItem } from '../src/judges/types.ts'

const rubrics = loadRubrics()
const noulQ = renderQuestion(rubrics.get('gate.relevance.v1')!, { need: '需求' })
const scoreQ = renderQuestion(rubrics.get('score.support.v1')!, { need: '需求' })
const items = (n: number, prefix = 'u'): JudgeItem[] => Array.from({ length: n }, (_, i) => ({ id: prefix + i, text: '候选文本 ' + prefix + i }))

interface Call { url: string; headers: Record<string, string>; body: any }

/** Mock fetch: each call pops the next scripted step, or answers 200 with noul/score answers. */
function mockFetch(script: (Response | ((call: Call) => Response))[] = []) {
  const calls: Call[] = []
  const impl = (async (url: string, init: RequestInit) => {
    const call: Call = { url, headers: init.headers as Record<string, string>, body: JSON.parse(String(init.body)) }
    calls.push(call)
    const step = script.shift()
    if (step) return typeof step === 'function' ? step(call) : step
    return okResponse(call)
  }) as unknown as typeof fetch
  return { impl, calls }
}

function okResponse(call: Call): Response {
  const answers: Record<string, unknown> = {}
  for (const [id, q] of Object.entries<any>(call.body.questions)) {
    answers[id] = q.type === 'noul' ? { type: 'noul', noul: 0.8 } : q.type === 'score' ? { type: 'score', score: 2.4, probabilities: { 0: 0.1, 1: 0.1, 2: 0.4, 3: 0.4 } } : { type: 'choice', choice: Object.keys(q.criteria)[0], probabilities: { [Object.keys(q.criteria)[0]!]: 0.7 } }
  }
  return new Response(JSON.stringify({ answers, usage: { input_tokens: 100, output_tokens: 0 } }), { status: 200 })
}

const tmp = (): string => fs.mkdtempSync(path.join(os.tmpdir(), 'bench-judge-'))

test('chunkItems: at most 32 questions, candidates and body bounds', () => {
  const limits = { maxQuestions: 32, maxCandidates: 1024, maxBodyBytes: 1_000_000, baseBytes: 100 }
  const chunks = chunkItems(items(70), noulQ, () => 10, limits)
  assert.deepEqual(chunks.map(c => c.length), [32, 32, 6])
  // score counts 4 candidates per question: 1024 / 4 = 256 (not binding); a tiny candidate cap is
  const tight = chunkItems(items(10), scoreQ, () => 10, { ...limits, maxCandidates: 12 })
  assert.deepEqual(tight.map(c => c.length), [3, 3, 3, 1])
  // noul counts 2
  assert.deepEqual(chunkItems(items(5), noulQ, () => 10, { ...limits, maxCandidates: 6 }).map(c => c.length), [3, 2])
  // body size bound
  assert.deepEqual(chunkItems(items(5), noulQ, () => 100, { ...limits, baseBytes: 0, maxBodyBytes: 250 }).map(c => c.length), [2, 2, 1])
  assert.deepEqual(chunkItems([], noulQ, () => 1, limits), [])
})

test('parseRetryAfter: seconds, HTTP date, junk', () => {
  assert.equal(parseRetryAfter('3'), 3000)
  assert.equal(parseRetryAfter('Wed, 21 Oct 2026 07:28:05 GMT', Date.parse('Wed, 21 Oct 2026 07:28:00 GMT')), 5000)
  assert.equal(parseRetryAfter(null), undefined)
  assert.equal(parseRetryAfter('soon'), undefined)
})

test('Jev: request shape, auth header, one request per <=32 questions, usage recorded', async () => {
  const { impl, calls } = mockFetch()
  const jev = createJevJudge({ apiKey: 'secret-key', fetchImpl: impl, requestCap: 50 })
  const res = await jev.evaluate('搜索任务：X', noulQ, items(70))
  assert.equal(calls.length, 3)
  assert.deepEqual(calls.map(c => Object.keys(c.body.questions).length), [32, 32, 6])
  assert.equal(calls[0]!.url, JEV_URL)
  assert.equal(calls[0]!.body.model, JEV_MODEL)
  assert.equal(calls[0]!.body.state, '搜索任务：X')
  assert.equal(calls[0]!.headers.authorization, 'Bearer secret-key')
  const q0 = calls[0]!.body.questions.q0
  assert.equal(q0.type, 'noul')
  assert.ok(q0.instructions.includes('候选文本 u0') && !q0.instructions.includes('{candidate}'))
  assert.equal(res.length, 70)
  assert.equal(res[0]!.prob, 0.8)
  assert.equal(res[0]!.decision, 'true')
  assert.equal(res[0]!.usage!.inputTokens, 100)
  assert.equal(res[1]!.usage, undefined)
  assert.equal(res[0]!.requestId, res[31]!.requestId)
  assert.notEqual(res[31]!.requestId, res[32]!.requestId)
  assert.equal(res[69]!.batchSize, 6)
  assert.ok(!JSON.stringify(res).includes('secret-key'))
  assert.equal(jev.requests, 3)
})

test('Jev: score criteria are sent and grade parsed', async () => {
  const { impl, calls } = mockFetch()
  const jev = createJevJudge({ apiKey: 'k', fetchImpl: impl })
  const res = await jev.evaluate('s', scoreQ, items(2))
  assert.equal(calls[0]!.body.questions.q0.type, 'score')
  assert.equal(calls[0]!.body.questions.q0.criteria.length, 4)
  assert.equal(res[0]!.grade, 2.4)
  assert.equal(res[0]!.decision, '2')
})

test('Jev retries: 429/503/529 honour Retry-After, at most 2 retries', async () => {
  const waits: number[] = []
  const sleep = async (ms: number): Promise<void> => { waits.push(ms) }
  const fail = (status: number, retryAfter?: string) => new Response('busy', { status, headers: retryAfter ? { 'retry-after': retryAfter } : {} })
  // 429 (Retry-After 2) then 529 then success: 2 retries are allowed.
  const a = mockFetch([fail(429, '2'), fail(529)])
  const jevA = createJevJudge({ apiKey: 'k', fetchImpl: a.impl, sleep })
  const resA = await jevA.evaluate('s', noulQ, items(1))
  assert.equal(a.calls.length, 3)
  assert.equal(resA[0]!.prob, 0.8)
  assert.deepEqual(waits, [2000, 2000])
  // three failures in a row: the item is reported as an error after 1 + 2 attempts
  waits.length = 0
  const b = mockFetch([fail(503, '1'), fail(503, '1'), fail(503, '1')])
  const jevB = createJevJudge({ apiKey: 'k', fetchImpl: b.impl, sleep })
  const resB = await jevB.evaluate('s', noulQ, items(1))
  assert.equal(b.calls.length, 3)
  assert.match(resB[0]!.error!, /HTTP 503/)
  assert.deepEqual(waits, [1000, 1000])
})

test('Jev: 401 is fatal, 413/422 are not retried and mark items as errors', async () => {
  const sleep = async (): Promise<void> => {}
  const c = mockFetch([new Response('nope', { status: 401 })])
  await assert.rejects(createJevJudge({ apiKey: 'k', fetchImpl: c.impl, sleep }).evaluate('s', noulQ, items(1)), (e: Error) => e instanceof SystemOneError && /401/.test(e.message))
  assert.equal(c.calls.length, 1)
  for (const status of [413, 422]) {
    const m = mockFetch([new Response('bad', { status })])
    const res = await createJevJudge({ apiKey: 'k', fetchImpl: m.impl, sleep }).evaluate('s', noulQ, items(2))
    assert.equal(m.calls.length, 1, 'status ' + status)
    assert.match(res[0]!.error!, new RegExp('HTTP ' + status))
  }
})

test('Jev: hard request cap stops further requests and flags the judge', async () => {
  const { impl, calls } = mockFetch()
  const jev = createJevJudge({ apiKey: 'k', fetchImpl: impl, requestCap: 2 })
  const res = await jev.evaluate('s', noulQ, items(100))
  assert.equal(calls.length, 2)
  assert.equal(jev.capReached, true)
  assert.equal(res.filter(r => !r.error).length, 64)
  assert.ok(res.slice(64).every(r => r.error === 'request-cap'))
  // a later call does not send anything
  const again = await jev.evaluate('s', noulQ, items(1, 'z'))
  assert.equal(calls.length, 2)
  assert.equal(again[0]!.error, 'request-cap')
})

test('createJevJudge requires a key', () => {
  const saved = process.env.BOCHA_JEV_API_KEY
  delete process.env.BOCHA_JEV_API_KEY
  try { assert.throws(() => createJevJudge(), /BOCHA_JEV_API_KEY/) } finally { if (saved !== undefined) process.env.BOCHA_JEV_API_KEY = saved }
})

test('cache: a second run is served from disk without any request; only misses are sent', async () => {
  const root = tmp()
  try {
    const first = mockFetch()
    const jev1 = createJevJudge({ apiKey: 'k', fetchImpl: first.impl, cache: new JudgeCache(root, 'jev') })
    const r1 = await jev1.evaluate('s', noulQ, items(5))
    assert.equal(first.calls.length, 1)
    assert.ok(r1.every(r => !r.cached))
    const second = mockFetch()
    const jev2 = createJevJudge({ apiKey: 'k', fetchImpl: second.impl, cache: new JudgeCache(root, 'jev') })
    const r2 = await jev2.evaluate('s', noulQ, items(5))
    assert.equal(second.calls.length, 0)
    assert.ok(r2.every(r => r.cached))
    assert.deepEqual(r2.map(r => r.prob), r1.map(r => r.prob))
    assert.deepEqual(r2.map(r => r.id), r1.map(r => r.id))
    // 5 old + 3 new items: only the 3 new ones are requested
    const third = mockFetch()
    const jev3 = createJevJudge({ apiKey: 'k', fetchImpl: third.impl, cache: new JudgeCache(root, 'jev') })
    const r3 = await jev3.evaluate('s', noulQ, [...items(5), ...items(3, 'n')])
    assert.equal(third.calls.length, 1)
    assert.equal(Object.keys(third.calls[0]!.body.questions).length, 3)
    assert.equal(r3.filter(r => r.cached).length, 5)
    // a different state or rubric is a different cache key
    const fourth = mockFetch()
    await createJevJudge({ apiKey: 'k', fetchImpl: fourth.impl, cache: new JudgeCache(root, 'jev') }).evaluate('other state', noulQ, items(1))
    assert.equal(fourth.calls.length, 1)
    // the cache files never contain the key
    const files = fs.readdirSync(path.join(root, 'jev'))
    assert.ok(files.length >= 9)
    assert.ok(files.every(f => !fs.readFileSync(path.join(root, 'jev', f), 'utf8').includes('"k"')))
  } finally { fs.rmSync(root, { recursive: true, force: true }) }
})

test('cache: errors are not cached; key depends on model and rubric version', async () => {
  const root = tmp()
  try {
    const bad = mockFetch([new Response('x', { status: 422 })])
    const jev = createJevJudge({ apiKey: 'k', fetchImpl: bad.impl, cache: new JudgeCache(root, 'jev') })
    const r = await jev.evaluate('s', noulQ, items(1))
    assert.ok(r[0]!.error)
    assert.equal(fs.existsSync(path.join(root, 'jev')), false)
    const item = items(1)[0]!
    const base = cacheKey({ id: 'jev', model: 'm1' }, 's', noulQ, item)
    assert.notEqual(base, cacheKey({ id: 'jev', model: 'm2' }, 's', noulQ, item))
    assert.notEqual(base, cacheKey({ id: 'jev', model: 'm1' }, 's', { ...noulQ, rubricVersion: 'v2' }, item))
    assert.equal(base, cacheKey({ id: 'jev', model: 'm1' }, 's', noulQ, { ...item }))
  } finally { fs.rmSync(root, { recursive: true, force: true }) }
})

test('Laya: local URL, model selection, max_len and choice options', async () => {
  const { impl, calls } = mockFetch()
  const laya = createLayaJudge({ fetchImpl: impl, layaModel: 'router', maxLen: 512 })
  assert.equal(laya.id, 'laya-router')
  const choiceQ = renderQuestion(rubrics.get('profile.choice.v1')!, {})
  const res = await laya.evaluate('', choiceQ, [{ id: 't1', text: '任务一' }])
  assert.equal(calls[0]!.url, 'http://127.0.0.1:8765/v1/systemone')
  assert.equal(calls[0]!.body.model, 'router')
  assert.equal(calls[0]!.body.max_len, 512)
  assert.equal(Object.keys(calls[0]!.body.questions.q0.criteria).length, 6)
  assert.equal(res[0]!.decision, 'docs_code')
  assert.equal(createLayaJudge().id, 'laya')
})
