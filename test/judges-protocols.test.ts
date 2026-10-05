import test from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import { applyCalibration, calibrationKey, calibrationProblems } from '../src/pipeline/judges/calibration.ts'
import { BudgetExceededError, JudgeError } from '../src/pipeline/judges/errors.ts'
import { LlmScorer, buildLlmPrompt, encodeLlmRequest, parseLlmGrades, LLM_SYSTEM } from '../src/pipeline/judges/protocols/llm.ts'
import { RerankScorer, decodeRerankResults, encodeRerankRequest } from '../src/pipeline/judges/protocols/rerank.ts'
import { candidatesFor, chunkItems, decodeAnswer, encodeQuestion, encodeRequest } from '../src/pipeline/judges/protocols/systemone.ts'
import { createModelScorer, endpointOf, PRESETS } from '../src/pipeline/judges/providers.ts'
import type { JudgeAnswerCache, JudgeProbe, ProviderConfig, ScoreJob } from '../src/pipeline/judges/types.ts'
import { builtinRubric } from '../src/pipeline/rubrics.ts'
import { JevScorer } from '../src/pipeline/score.ts'

const TASK = { goal: '了解 Node.js 22 中 node:sqlite 的 DatabaseSync 构造参数', query: 'q', needs: [], constraints: [] }
const NEED = { id: 'n1', text: 'DatabaseSync 构造参数中的 timeout 选项', critical: true }
const blocks = (n: number, text = '段落内容 timeout option') => Array.from({ length: n }, (_, i) => ({ blockId: 'b' + i, url: 'https://x.test/' + i, text: text + ' ' + i }))
const job = (n: number, need = NEED): ScoreJob => ({ need, blocks: blocks(n) })

interface Call { url: string; headers: Record<string, string>; raw: string; body: any }
function mock(handler?: (call: Call, i: number) => Response | Promise<Response>) {
  const calls: Call[] = []
  const fetchImpl = (async (url: string, init: { headers: Record<string, string>; body: string }) => {
    const call: Call = { url, headers: init.headers, raw: init.body, body: JSON.parse(init.body) }
    calls.push(call)
    return handler ? handler(call, calls.length - 1) : jevAnswer(call)
  }) as unknown as typeof fetch
  return { calls, fetchImpl }
}
const jevAnswer = (call: Call, score = 2): Response => new Response(JSON.stringify({ answers: Object.fromEntries(Object.keys(call.body.questions).map(k => [k, { score }])), usage: { input_tokens: 10 * Object.keys(call.body.questions).length, output_tokens: 0 } }))
const sleep = async (): Promise<void> => {}
const json = (value: unknown, status = 200): Response => new Response(JSON.stringify(value), { status })

// ── systemone ───────────────────────────────────────────────────────────────

test('systemone wire format: question and request encoding, answer decoding for the three kinds', () => {
  assert.deepEqual(encodeQuestion('noul', 'q'), { type: 'noul', instructions: 'q' })
  assert.deepEqual(encodeQuestion('score', 'q', ['a', 'b']), { type: 'score', instructions: 'q', criteria: ['a', 'b'] })
  assert.deepEqual(encodeQuestion('choice', 'q', { x: 'X' }), { type: 'choice', instructions: 'q', criteria: { x: 'X' } })
  assert.equal(encodeRequest('m', 's', { q0: { type: 'noul', instructions: 'i' } }), '{"model":"m","state":"s","questions":{"q0":{"type":"noul","instructions":"i"}}}')
  assert.equal(encodeRequest('m', 's', {}, { max_len: 512 }), '{"model":"m","state":"s","questions":{},"max_len":512}')
  assert.deepEqual(decodeAnswer('noul', { noul: 0.8 }), { kind: 'noul', prob: 0.8 })
  assert.deepEqual(decodeAnswer('score', { score: 2.4, probabilities: { 2: 0.4 } }), { kind: 'score', grade: 2.4, probabilities: { 2: 0.4 } })
  assert.deepEqual(decodeAnswer('choice', { choice: 'a', probabilities: { a: 0.7 } }), { kind: 'choice', choice: 'a', prob: 0.7, probabilities: { a: 0.7 } })
  for (const [kind, answer] of [['noul', { noul: 'x' }], ['score', {}], ['choice', { probabilities: {} }], ['score', undefined]] as const) assert.ok('error' in decodeAnswer(kind, answer))
})

test('systemone chunking: question count, candidate total and body bounds; candidates per kind', () => {
  assert.equal(candidatesFor({ kind: 'noul' }), 2)
  assert.equal(candidatesFor({ kind: 'score', criteria: ['a', 'b', 'c'] }), 3)
  assert.equal(candidatesFor({ kind: 'choice', options: { a: '', b: '' } }), 2)
  const limits = { maxQuestions: 32, maxCandidates: 1024, maxBodyBytes: 1_000_000, baseBytes: 100 }
  const items = Array.from({ length: 70 }, (_, i) => i)
  assert.deepEqual(chunkItems(items, { kind: 'noul' }, () => 10, limits).map(c => c.length), [32, 32, 6])
  assert.deepEqual(chunkItems(items.slice(0, 10), { kind: 'score', criteria: ['a', 'b', 'c', 'd'] }, () => 10, { ...limits, maxCandidates: 12 }).map(c => c.length), [3, 3, 3, 1])
})

test('systemone provider limits: questions per request, block cut, request token budget, state cut', async () => {
  const p: ProviderConfig = { id: 'my-jev', protocol: 'systemone', baseUrl: 'https://jev.example.test', model: 'm1', keyRef: 'MY_KEY', limits: { maxQuestionsPerRequest: 5, blockChars: 150, maxStateChars: 40, maxNeedChars: 12 } }
  const { calls, fetchImpl } = mock()
  const scorer = createModelScorer(p, { apiKey: 'sk-my', fetchImpl, sleep })
  const long = { need: NEED, blocks: [{ blockId: 'long', url: 'https://x.test/', text: '很长的内容'.repeat(200) }, ...blocks(11)] }
  const out = await scorer.score(TASK, [long])
  assert.deepEqual(calls.map(c => Object.keys(c.body.questions).length), [5, 5, 2])
  assert.equal(calls[0]!.url, 'https://jev.example.test/v1/systemone')
  assert.equal(calls[0]!.body.model, 'm1')
  assert.equal(calls[0]!.headers.authorization, 'Bearer sk-my')
  assert.ok(calls[0]!.body.state.length <= '搜索任务：'.length + 40)
  const q0 = calls[0]!.body.questions.q0.instructions as string
  assert.ok(q0.includes('需求：DatabaseSyn…'), 'need cut to 12 characters: ' + q0)
  assert.ok(q0.length < 200, 'block cut to 150 characters')
  assert.equal(out.grades.get('n1')!.size, 12)
  assert.equal(scorer.id, 'my-jev')
  assert.deepEqual(scorer.provider, { id: 'my-jev', protocol: 'systemone', model: 'm1' })

  // a small request token budget splits further (one question per request: each estimate alone passes it)
  const tight = mock()
  await createModelScorer({ ...p, limits: { requestTokenBudget: 1 } }, { apiKey: 'k', fetchImpl: tight.fetchImpl, sleep }).score(TASK, [job(3)])
  assert.deepEqual(tight.calls.map(c => Object.keys(c.body.questions).length), [1, 1, 1])
})

test('systemone errors: 401 is fatal, a failing request loses only its chunk, more than half missing throws, 422 splits', async () => {
  const p: ProviderConfig = { ...PRESETS['laya-local']!, limits: { maxQuestionsPerRequest: 2 } }
  // fatal
  const fatal = mock(() => new Response('no', { status: 401 }))
  await assert.rejects(createModelScorer({ ...p, keyRef: 'K' }, { apiKey: 'k', fetchImpl: fatal.fetchImpl, sleep }).score(TASK, [job(4)]), (e: Error) => e instanceof JudgeError && /401/.test(e.message))
  // chunk 2 fails of 3: 2 of 6 missing -> answered, noted
  const some = mock((_c, i) => (i === 1 ? new Response('x', { status: 500 }) : jevAnswer(_c)))
  const out = await createModelScorer(p, { fetchImpl: some.fetchImpl, sleep }).score(TASK, [job(6)])
  assert.equal(out.grades.get('n1')!.size, 4)
  assert.match(out.notes!.join('|'), /HTTP 500/)
  assert.match(out.notes!.join('|'), /2 of 6 Laya questions got no answer/)
  // all fail: throws
  const none = mock(() => new Response('x', { status: 500 }))
  await assert.rejects(createModelScorer(p, { fetchImpl: none.fetchImpl, sleep }).score(TASK, [job(4)]), /Laya answered only 0 of 4/)
  // 422 token_budget_exceeded splits the request
  const splitting = mock(call => (Object.keys(call.body.questions).length > 1 ? new Response('{"detail":"token_budget_exceeded"}', { status: 422 }) : jevAnswer(call)))
  const split = await createModelScorer({ ...p, limits: { maxQuestionsPerRequest: 4 } }, { fetchImpl: splitting.fetchImpl, sleep }).score(TASK, [job(4)])
  assert.equal(split.grades.get('n1')!.size, 4)
})

test('laya-local preset: local URL, no authorization header, max_len extra field after the questions, plain token estimate', async () => {
  const { calls, fetchImpl } = mock()
  const scorer = createModelScorer(PRESETS['laya-local']!, { fetchImpl, sleep })
  await scorer.score(TASK, [job(1)])
  assert.equal(calls[0]!.url, 'http://127.0.0.1:8765/v1/systemone')
  assert.deepEqual(Object.keys(calls[0]!.headers), ['content-type'])
  assert.deepEqual(Object.keys(calls[0]!.body), ['model', 'state', 'questions', 'max_len'])
  assert.equal(calls[0]!.body.model, 'multilingual')
  assert.equal(calls[0]!.body.max_len, 1024)
  assert.equal(scorer.id, 'laya-local')
  assert.equal(endpointOf({ ...PRESETS['laya-local']!, baseUrl: 'http://127.0.0.1:9000/', path: '/x/y' }), 'http://127.0.0.1:9000/x/y')
})

test('a provider with a keyRef cannot be built without the key; the key never appears in an error', async () => {
  assert.throws(() => createModelScorer(PRESETS['bocha-jev']!, {}), /needs BOCHA_JEV_API_KEY/)
  const { fetchImpl } = mock(() => new Response('denied for sk-leak', { status: 401 }))
  await assert.rejects(createModelScorer(PRESETS['bocha-jev']!, { apiKey: 'sk-secret', fetchImpl, sleep }).score(TASK, [job(1)]), (e: Error) => !e.message.includes('sk-secret'))
})

// ── byte-identical default ──────────────────────────────────────────────────

const HASH_JOBS: ScoreJob[] = [
  { need: { id: 'n1', text: '  DatabaseSync   构造参数中的 timeout 选项\n是什么 {task} $1 ', critical: true }, blocks: [
    { blockId: 'b1', url: 'https://nodejs.org/api/sqlite.html', heading: 'new DatabaseSync(path[, options])', text: 'timeout <number> The busy timeout in milliseconds. $& $1 {need}' },
    { blockId: 'b2', url: 'https://x.test/', text: 'x$&y {need} {candidate} ' + '内容'.repeat(900) },
  ] },
  { need: { id: 'n2', text: 'PRAGMA busy_timeout', critical: false }, blocks: [{ blockId: 'b3', url: 'https://x.test/', text: 'English only block about PRAGMA.' }] },
]
const HASH_GOAL = '了解 Node.js 22 中 node:sqlite 的  DatabaseSync\n构造参数里 timeout 选项 ' + '很长的目标描述'.repeat(40)
const sha = (bodies: string[]): string => crypto.createHash('sha256').update(JSON.stringify(bodies)).digest('hex')

test('default Bocha Jev: the provider path sends byte-identical requests to the pre-M5 scorer (golden hashes taken at HEAD 068feae)', async () => {
  const rubric = builtinRubric('score.support')
  const viaProvider = async (jobs: ScoreJob[], goal: string): Promise<string[]> => {
    const bodies: string[] = []
    const headers: string[] = []
    const urls: string[] = []
    const fetchImpl = (async (url: string, init: { headers: Record<string, string>; body: string }) => {
      bodies.push(init.body); headers.push(JSON.stringify(init.headers)); urls.push(url)
      return jevAnswer({ body: JSON.parse(init.body) } as Call)
    }) as unknown as typeof fetch
    const scorer = createModelScorer(PRESETS['bocha-jev']!, { apiKey: 'k', rubric, fetchImpl, sleep })
    await scorer.score({ goal, query: 'q', needs: [], constraints: [] }, jobs)
    assert.ok(urls.every(u => u === 'https://jev.bocha.cn/v1/systemone'))
    assert.ok(headers.every(h => h === '{"content-type":"application/json","authorization":"Bearer k"}'))
    return bodies
  }
  // the same input as test/pipeline-rubrics.test.ts (sha taken before rubrics existed)
  assert.equal(sha(await viaProvider(HASH_JOBS, HASH_GOAL)), 'fd35ae6dd2ad0cb7fcbfe693e56ad23aa3591d2328cec900ae14e60502f3daf0')

  // 70 blocks over two needs: 11 chunked requests (taken from the unmodified JevScorer at HEAD 068feae)
  const many = Array.from({ length: 70 }, (_, i) => ({ blockId: 'b' + i, url: 'https://x.test/' + i, ...i % 3 ? { heading: 'H' + i } : {}, text: (i % 5 === 0 ? 'English text with PRAGMA busy_timeout. ' : '中文段落内容，关于超时设置。').repeat(1 + (i % 7) * 12) + i }))
  const jobs: ScoreJob[] = [{ need: { id: 'n1', text: '如何设置 busy timeout', critical: true }, blocks: many.slice(0, 40) }, { need: { id: 'n2', text: 'WAL 模式', critical: false }, blocks: many.slice(30) }]
  const bodies = await viaProvider(jobs, '目标 goal')
  assert.equal(bodies.length, 11)
  assert.equal(sha(bodies), 'f6582736d27279c4229a30bdcf625f976881fdf55561472a2a406513c0a30d33')

  // and it is the JevScorer's bytes: same class of request, scorer id and recorded provider differ only in metadata
  const direct: string[] = []
  const f = (async (_u: string, init: { body: string }) => { direct.push(init.body); return jevAnswer({ body: JSON.parse(init.body) } as Call) }) as unknown as typeof fetch
  await new JevScorer({ apiKey: 'k', fetchImpl: f, sleep }).score({ goal: '目标 goal', query: 'q', needs: [], constraints: [] }, jobs)
  assert.deepEqual(direct, bodies)
})

test('the bocha-jev preset records the legacy scorer id "jev" and its provider identity', async () => {
  const { fetchImpl } = mock()
  const scorer = createModelScorer(PRESETS['bocha-jev']!, { apiKey: 'k', fetchImpl, sleep })
  assert.equal(scorer.id, 'jev')
  assert.deepEqual(scorer.provider, { id: 'bocha-jev', protocol: 'systemone', model: 'bocha-jev-v1' })
  assert.equal(scorer.rubricRef?.id, 'score.support')
})

// ── calibration ─────────────────────────────────────────────────────────────

test('calibration: validation, piecewise-linear mapping with clamped ends, key follows the points', () => {
  const c = { version: 'v1', points: [[0.1, 0], [0.5, 1], [0.8, 3]] as [number, number][] }
  assert.deepEqual(calibrationProblems(c), [])
  assert.equal(applyCalibration(c, -5), 0)
  assert.equal(applyCalibration(c, 0.1), 0)
  assert.ok(Math.abs(applyCalibration(c, 0.3) - 0.5) < 1e-9)
  assert.equal(applyCalibration(c, 0.5), 1)
  assert.ok(Math.abs(applyCalibration(c, 0.65) - 2) < 1e-9)
  assert.equal(applyCalibration(c, 0.99), 3)
  assert.equal(applyCalibration(c, Number.NaN), 0)
  const bad = (x: unknown): string => calibrationProblems(x).join('|')
  assert.match(bad(null), /must be an object/)
  assert.match(bad({ version: 'v 1', points: c.points }), /version/)
  assert.match(bad({ version: 'v1', points: [[0, 0]] }), /2-32/)
  assert.match(bad({ version: 'v1', points: [[0, 0], [0, 1]] }), /greater than the previous/)
  assert.match(bad({ version: 'v1', points: [[0, 2], [1, 1]] }), /must not decrease/)
  assert.match(bad({ version: 'v1', points: [[0, 0], [1, 4]] }), /within 0\.\.3/)
  assert.match(bad({ version: 'v1', points: [[0, 0], ['a', 1]] }), /finite numbers/)
  assert.match(calibrationKey(c), /^v1#[0-9a-f]{8}$/)
  assert.notEqual(calibrationKey(c), calibrationKey({ ...c, points: [[0.1, 0], [0.5, 1], [0.8, 2]] }))
})

test('systemone grades go through the calibration too, after the level rescale', async () => {
  const p: ProviderConfig = { ...PRESETS['laya-local']!, calibration: { version: 'laya-fit-1', points: [[0, 0], [2, 0], [3, 3]] } }
  const { fetchImpl } = mock(call => jevAnswer(call, 2.5))
  const scorer = createModelScorer(p, { fetchImpl, sleep })
  const out = await scorer.score(TASK, [job(1)])
  assert.equal(out.grades.get('n1')!.get('b0')!.grade, 1.5)
  assert.match(scorer.provider!.calibration!, /^laya-fit-1#/)
})

// ── rerank ──────────────────────────────────────────────────────────────────

const CAL = { version: 'v1', points: [[0.1, 0], [0.4, 1], [0.7, 2], [0.9, 3]] as [number, number][] }
const rerankProvider = (over: Partial<ProviderConfig> = {}): ProviderConfig => ({ ...PRESETS['jina-rerank']!, calibration: CAL, ...over })

test('rerank encoding: model, query, documents, top_n, then the provider extras; decoding drops malformed rows', () => {
  assert.equal(encodeRerankRequest('m', 'q', ['a', 'b'], { return_documents: false }), '{"model":"m","query":"q","documents":["a","b"],"top_n":2,"return_documents":false}')
  const m = decodeRerankResults({ results: [{ index: 1, relevance_score: 0.9 }, { index: 0, relevance_score: 0.2 }, { index: 1, relevance_score: 0.1 }, { index: 5, relevance_score: 1 }, { index: 'x', relevance_score: 1 }, { index: 0 }, { index: 2, relevance_score: 'n/a' }] }, 3)
  assert.deepEqual([...m], [[1, 0.9], [0, 0.2]])
  assert.deepEqual([...decodeRerankResults({ data: [{ index: 0, score: 0.5 }] }, 1)], [[0, 0.5]])
  assert.equal(decodeRerankResults({}, 3).size, 0)
})

test('rerank scorer: one request per need with the need as query, results mapped back by index and calibrated to 0..3', async () => {
  const needs = [NEED, { id: 'n2', text: 'PRAGMA busy_timeout', critical: false }]
  const { calls, fetchImpl } = mock(call => json({ results: call.body.documents.map((_: string, i: number) => ({ index: call.body.documents.length - 1 - i, relevance_score: [0.05, 0.4, 0.7, 0.95][call.body.documents.length - 1 - i] ?? 0.5 })), usage: { total_tokens: 321 } }))
  const scorer = createModelScorer(rerankProvider(), { apiKey: 'jina-key', fetchImpl, sleep })
  const out = await scorer.score(TASK, needs.map(n => job(4, n)))
  assert.equal(calls.length, 2)
  assert.equal(calls[0]!.url, 'https://api.jina.ai/v1/rerank')
  assert.equal(calls[0]!.headers.authorization, 'Bearer jina-key')
  assert.deepEqual(Object.keys(calls[0]!.body), ['model', 'query', 'documents', 'top_n', 'return_documents'])
  assert.equal(calls[0]!.body.query, NEED.text)
  assert.equal(calls[1]!.body.query, 'PRAGMA busy_timeout')
  assert.equal(calls[0]!.body.top_n, 4)
  const g = out.grades.get('n1')!
  assert.deepEqual(['b0', 'b1', 'b2', 'b3'].map(id => Number(g.get(id)!.grade.toFixed(3))), [0, 1, 2, 3])
  assert.equal(g.get('b2')!.rank, g.get('b2')!.grade)
  assert.deepEqual(out.usage, { requests: 2, questions: 8, cacheHits: 0, inputTokens: 642, outputTokens: 0 })
  assert.equal(scorer.id, 'jina-rerank')
  assert.equal(scorer.rubricRef, undefined)
  assert.equal(scorer.provider!.protocol, 'rerank')
  assert.match(scorer.provider!.calibration!, /^v1#/)
})

test('rerank scorer: documents per request, unanswered documents, Cohere-style usage, and an uncalibrated reranker cannot be built', async () => {
  const cohere = rerankProvider({ ...PRESETS['cohere-rerank']!, limits: { maxDocumentsPerRequest: 3 } })
  const { calls, fetchImpl } = mock(call => json({ results: call.body.documents.slice(0, 2).map((_: string, i: number) => ({ index: i, relevance_score: 0.8 })), meta: { tokens: { input_tokens: 50 }, billed_units: { search_units: 1 } } }))
  const out = await createModelScorer(cohere, { apiKey: 'k', fetchImpl, sleep }).score(TASK, [job(7)])
  assert.deepEqual(calls.map(c => c.body.documents.length), [3, 3, 1])
  assert.equal(calls[0]!.url, 'https://api.cohere.com/v2/rerank')
  assert.equal(out.grades.get('n1')!.size, 5, 'two answered per request of 3, the last request answers its only document')
  assert.equal(out.usage!.inputTokens, 150)
  assert.match(out.notes!.join('|'), /2 of 7 Cohere rerank questions got no answer/)
  assert.throws(() => createModelScorer({ ...PRESETS['jina-rerank']! }, { apiKey: 'k' }), /set calibration\.points/)
  assert.throws(() => new RerankScorer({ id: 'x', label: 'x', model: 'm', url: 'https://x.test/rerank' }), /not grades/)
})

test('rerank scorer: documents are cut, and relevance outside the calibrated range is clamped', async () => {
  const { calls, fetchImpl } = mock(call => json({ results: call.body.documents.map((_: string, i: number) => ({ index: i, relevance_score: i === 0 ? -3 : 42 })) }))
  const scorer = createModelScorer(rerankProvider({ limits: { blockChars: 50 } }), { apiKey: 'k', fetchImpl, sleep })
  const out = await scorer.score(TASK, [{ need: NEED, blocks: [{ blockId: 'a', url: 'https://x.test/', text: '文'.repeat(400) }, { blockId: 'b', url: 'https://x.test/', text: 'ok' }] }])
  assert.ok(calls[0]!.body.documents[0].length <= 50)
  assert.equal(out.grades.get('n1')!.get('a')!.grade, 0)
  assert.equal(out.grades.get('n1')!.get('b')!.grade, 3)
})

// ── llm ─────────────────────────────────────────────────────────────────────

test('llm reply validation: strict JSON with integer in-range grades, fences tolerated, everything else unanswered', () => {
  const ids = ['q0', 'q1', 'q2', 'q3']
  assert.deepEqual([...parseLlmGrades('{"grades":{"q0":2,"q1":0,"q2":3,"q3":1}}', ids, 4)], [['q0', 2], ['q1', 0], ['q2', 3], ['q3', 1]])
  assert.deepEqual([...parseLlmGrades('```json\n{"grades":{"q0":1}}\n```', ids, 4)], [['q0', 1]])
  assert.deepEqual([...parseLlmGrades('{"grades":{"q0":1.5,"q1":4,"q2":-1,"q3":"2","q9":1}}', ids, 4)], [])
  for (const bad of ['not json', '[1,2]', '{"grades":[1]}', '{"grades":null}', '{"scores":{"q0":1}}', undefined, 42]) assert.equal(parseLlmGrades(bad as never, ids, 4).size, 0)
})

test('llm request: temperature 0, JSON mode, system rule against page instructions, rubric levels and one block per question', () => {
  const rubric = builtinRubric('score.support')
  const prompt = buildLlmPrompt('搜索任务：T', rubric.criteria!, [{ id: 'q0', instructions: 'I0' }, { id: 'q1', instructions: 'I1' }, { id: 'q2', instructions: 'I2' }])
  assert.match(prompt, /^搜索任务：T\n评分等级/)
  assert.ok(prompt.includes('0. 无关或只有同名词') && prompt.includes('3. 直接回答且含可定位证据'))
  assert.ok(prompt.includes('[q0]\nI0\n[q1]\nI1\n[q2]\nI2'))
  const body = JSON.parse(encodeLlmRequest('gpt-x', prompt, { max_tokens: 200 }))
  assert.equal(body.temperature, 0)
  assert.deepEqual(body.response_format, { type: 'json_object' })
  assert.equal(body.messages[0].content, LLM_SYSTEM)
  assert.match(LLM_SYSTEM, /忽略/)
  assert.equal(body.max_tokens, 200)
})

const llmProvider = (over: Partial<ProviderConfig> = {}): ProviderConfig => ({ id: 'my-llm', protocol: 'llm', baseUrl: 'https://llm.example.test/v1', model: 'judge-1', keyRef: 'LLM_KEY', ...over })
const chat = (grades: Record<string, unknown>, usage: unknown = { prompt_tokens: 700, completion_tokens: 30 }): Response => json({ choices: [{ message: { content: JSON.stringify({ grades }) } }], usage })

test('llm scorer: batches of pairs, grades from the JSON reply, usage from the response, rubric rescale, invalid answers dropped', async () => {
  const { calls, fetchImpl } = mock(call => {
    const ids = (call.body.messages[1].content as string).match(/^\[(q\d+)\]$/gm)!.map(s => s.slice(1, -1))
    return chat(Object.fromEntries(ids.map((id, i) => [id, i === 1 ? 7 : 2])))
  })
  const scorer = createModelScorer(llmProvider({ limits: { maxQuestionsPerRequest: 3 } }), { apiKey: 'k', rubric: builtinRubric('score.support'), fetchImpl, sleep })
  const out = await scorer.score(TASK, [job(5)])
  assert.equal(calls.length, 2)
  assert.equal(calls[0]!.url, 'https://llm.example.test/v1/chat/completions')
  assert.equal(calls[0]!.body.temperature, 0)
  const g = out.grades.get('n1')!
  assert.equal(g.get('b0')!.grade, 2)
  assert.equal(g.has('b1'), false, 'out-of-range grade 7 is no answer')
  assert.equal(g.get('b2')!.grade, 2)
  assert.deepEqual(out.usage, { requests: 2, questions: 3, cacheHits: 0, inputTokens: 1400, outputTokens: 60 })
  assert.match(out.notes!.join('|'), /2 of 5 .* questions got no answer/)
  assert.equal(scorer.provider!.protocol, 'llm')
  assert.ok(scorer.rubricRef)
})

test('llm scorer: a chatty or malformed reply is no answer; mostly-invalid replies fail the stage so the rule grades stay', async () => {
  const { fetchImpl } = mock(() => json({ choices: [{ message: { content: 'Sure! Here are my thoughts...' } }], usage: { prompt_tokens: 10, completion_tokens: 5 } }))
  await assert.rejects(createModelScorer(llmProvider(), { apiKey: 'k', fetchImpl, sleep }).score(TASK, [job(2)]), /answered only 0 of 2/)
})

test('a missing usage block is booked as the conservative estimate, flagged estimated (needs a meter)', async () => {
  const { fetchImpl } = mock(call => chat(Object.fromEntries(((call.body.messages[1].content as string).match(/^\[(q\d+)\]$/gm) ?? []).map(s => [s.slice(1, -1), 1])), null))
  const booked: { reserved: number; settled?: unknown }[] = []
  const meter = { headroom: () => Infinity, reserve: (e: { inputTokens: number }) => { const row: { reserved: number; settled?: unknown } = { reserved: e.inputTokens }; booked.push(row); return { settle: (a: { inputTokens?: number }) => { row.settled = a; return { inputTokens: a.inputTokens ?? e.inputTokens, outputTokens: 0, estimated: a.inputTokens === undefined } }, unknown: () => ({ inputTokens: e.inputTokens, outputTokens: 0, estimated: true }), refused: () => {} } } }
  const out = await createModelScorer(llmProvider(), { apiKey: 'k', fetchImpl, sleep, meter }).score(TASK, [job(2)])
  assert.equal(booked.length, 1)
  assert.equal(out.usage!.estimated, true)
  assert.equal(out.usage!.inputTokens, booked[0]!.reserved)
  assert.ok(booked[0]!.reserved > 100)
})

test('a refused reservation is a BudgetExceededError that stops the stage before any request', async () => {
  const meter = { headroom: () => Infinity, reserve: (): never => { throw new BudgetExceededError('per-search cap 1 input tokens') } }
  const { calls, fetchImpl } = mock()
  await assert.rejects(createModelScorer(PRESETS['laya-local']!, { fetchImpl, sleep, meter: meter as never }).score(TASK, [job(3)]), (e: Error) => e instanceof BudgetExceededError && /^model budget exceeded: per-search cap/.test(e.message))
  assert.equal(calls.length, 0)
})

// ── cache separation ────────────────────────────────────────────────────────

test('answer caches are keyed by provider: one provider\'s raw scores are never reused for another', async () => {
  const store = new Map<string, number>()
  const cache: JudgeAnswerCache = { get: (p: JudgeProbe) => (store.has(JSON.stringify(p)) ? { grade: store.get(JSON.stringify(p))! } : undefined), set: (p, a) => { store.set(JSON.stringify(p), a.grade) } }
  const a = mock(call => jevAnswer(call, 3))
  const b = mock(call => jevAnswer(call, 1))
  const pa: ProviderConfig = { id: 'jev-a', protocol: 'systemone', baseUrl: 'https://a.example.test', model: 'm', keyRef: 'K' }
  const pb: ProviderConfig = { ...pa, id: 'jev-b', baseUrl: 'https://b.example.test' }
  const ga = await createModelScorer(pa, { apiKey: 'k', fetchImpl: a.fetchImpl, sleep, cache }).score(TASK, [job(2)])
  const gb = await createModelScorer(pb, { apiKey: 'k', fetchImpl: b.fetchImpl, sleep, cache }).score(TASK, [job(2)])
  assert.equal(b.calls.length, 1, 'the second provider asked its own service')
  assert.deepEqual([ga.grades.get('n1')!.get('b0')!.grade, gb.grades.get('n1')!.get('b0')!.grade], [3, 1])
  // the same provider is served from the cache
  const again = mock()
  const ga2 = await createModelScorer(pa, { apiKey: 'k', fetchImpl: again.fetchImpl, sleep, cache }).score(TASK, [job(2)])
  assert.equal(again.calls.length, 0)
  assert.equal(ga2.usage!.cacheHits, 2)
  // a different model of the same provider is a different key too
  const model2 = mock(call => jevAnswer(call, 0))
  await createModelScorer({ ...pa, model: 'm2' }, { apiKey: 'k', fetchImpl: model2.fetchImpl, sleep, cache }).score(TASK, [job(2)])
  assert.equal(model2.calls.length, 1)
  // a bare JevScorer (the bench) keeps probes without a provider field: its r1 cache keys do not change
  const probes: JudgeProbe[] = []
  await new JevScorer({ apiKey: 'k', fetchImpl: mock().fetchImpl, sleep, cache: { get: p => { probes.push(p); return undefined }, set: () => {} } }).score(TASK, [job(1)])
  assert.equal('provider' in probes[0]!, false)
  const viaFactory: JudgeProbe[] = []
  await createModelScorer(PRESETS['bocha-jev']!, { apiKey: 'k', fetchImpl: mock().fetchImpl, sleep, cache: { get: p => { viaFactory.push(p); return undefined }, set: () => {} } }).score(TASK, [job(1)])
  assert.equal(viaFactory[0]!.provider, 'bocha-jev|systemone|bocha-jev-v1')
})
