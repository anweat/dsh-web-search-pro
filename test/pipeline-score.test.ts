import test from 'node:test'
import assert from 'node:assert/strict'
import {
  bucketGrade, estimateJevTokens, JEV_CRITERIA, JEV_INSTRUCTIONS, JEV_MODEL, JEV_QUESTION_OVERHEAD_TOKENS, JEV_STATE_PREFIX, JevError, JevScorer, RuleScorer,
  type JevCache, type JevProbe, type ScoreJob, type ScoreTask,
} from '../src/pipeline/score.ts'

const task: ScoreTask = {
  goal: '在 Node 22 里给 node:sqlite 设置 busy timeout', query: 'node:sqlite busy timeout',
  needs: [{ id: 'n1', text: 'node:sqlite 如何设置 busy timeout', critical: true }], constraints: [],
}
const blk = (id: string, text: string, heading?: string) => ({ blockId: id, url: 'https://ex.test/' + id, text, ...heading ? { heading } : {} })
const job = (blocks: ReturnType<typeof blk>[], need = task.needs[0]!): ScoreJob => ({ need, blocks })

// ── rule scorer ─────────────────────────────────────────────────────────────

test('RuleScorer: relevant blocks outgrade unrelated ones, buckets follow the r1 thresholds', async () => {
  const scorer = new RuleScorer()
  const out = await scorer.score(task, [job([
    blk('good', 'node:sqlite 的 DatabaseSync 可以执行 PRAGMA busy_timeout = 5000 来设置 busy timeout。', 'node:sqlite > busy timeout'),
    blk('meh', '这个模块提供 SQLite 数据库访问。'),
    blk('none', '今天天气很好，适合出门散步。'),
  ])])
  const g = out.grades.get('n1')!
  assert.ok(g.get('good')!.grade >= 2)
  assert.equal(g.get('none')!.grade, 0)
  assert.ok(g.get('good')!.rank! > g.get('none')!.rank!)
  assert.equal(scorer.id, 'rule')
  assert.equal(out.usage, undefined)
  assert.deepEqual([0.05, 0.12, 0.29, 0.3, 0.54, 0.55, 1].map(bucketGrade), [0, 1, 1, 2, 2, 3, 3])
})

test('RuleScorer: every need gets its own grades', async () => {
  const needs = [{ id: 'n1', text: 'busy timeout', critical: true }, { id: 'n2', text: 'WAL journal mode', critical: true }]
  const blocks = [blk('a', 'Set busy timeout with PRAGMA busy_timeout.'), blk('b', 'Enable WAL journal mode with PRAGMA journal_mode=WAL.')]
  const out = await new RuleScorer().score({ ...task, needs }, needs.map(need => job(blocks, need)))
  assert.ok(out.grades.get('n1')!.get('a')!.rank! > out.grades.get('n1')!.get('b')!.rank!)
  assert.ok(out.grades.get('n2')!.get('b')!.rank! > out.grades.get('n2')!.get('a')!.rank!)
})

// ── Jev scorer ──────────────────────────────────────────────────────────────

interface Call { url: string; headers: Record<string, string>; body: { model: string; state: string; questions: Record<string, { type: string; instructions: string; criteria: string[] }> } }

function fakeJev(handler?: (call: Call, index: number) => Response | Promise<Response>) {
  const calls: Call[] = []
  const fetchImpl = (async (url: string, init: { headers: Record<string, string>; body: string }) => {
    const call: Call = { url, headers: init.headers, body: JSON.parse(init.body) }
    calls.push(call)
    if (handler) return handler(call, calls.length - 1)
    return answer(call)
  }) as unknown as typeof fetch
  return { calls, fetchImpl }
}
function answer(call: Call, grade = (i: number) => 2 + (i % 2) * 0.5): Response {
  const answers = Object.fromEntries(Object.keys(call.body.questions).map((k, i) => [k, { score: grade(i), probabilities: { 0: 0.1, 1: 0.1, 2: 0.4, 3: 0.4 } }]))
  return new Response(JSON.stringify({ answers, usage: { input_tokens: 100 * Object.keys(answers).length, output_tokens: 0 } }), { status: 200 })
}
const scorerWith = (fetchImpl: typeof fetch, extra: Record<string, unknown> = {}) => new JevScorer({ apiKey: 'sk-test-secret', fetchImpl, sleep: async () => {}, ...extra })
const many = (n: number, text = '段落内容') => Array.from({ length: n }, (_, i) => blk('b' + i, text + i))

test('Jev: request uses the score.support.v1 wording, short state, criteria and bearer header', async () => {
  const { calls, fetchImpl } = fakeJev()
  const scorer = scorerWith(fetchImpl)
  const out = await scorer.score(task, [job([blk('b1', 'PRAGMA busy_timeout = 5000;', 'node:sqlite > busy')])])
  assert.equal(calls.length, 1)
  const call = calls[0]!
  assert.equal(call.url, 'https://jev.bocha.cn/v1/systemone')
  assert.equal(call.headers.authorization, 'Bearer sk-test-secret')
  assert.equal(call.body.model, JEV_MODEL)
  assert.equal(call.body.state, JEV_STATE_PREFIX + task.goal)
  const q = call.body.questions.q0!
  assert.equal(q.type, 'score')
  assert.deepEqual(q.criteria, [...JEV_CRITERIA])
  assert.equal(q.instructions, '下面的文本块对该需求的支撑程度如何？\n需求：node:sqlite 如何设置 busy timeout\n文本块：node:sqlite > busy\nPRAGMA busy_timeout = 5000;')
  assert.ok(JEV_INSTRUCTIONS.includes('{need}') && JEV_INSTRUCTIONS.includes('{candidate}'))
  assert.equal(out.grades.get('n1')!.get('b1')!.grade, 2)
  assert.deepEqual(out.usage, { requests: 1, questions: 1, cacheHits: 0, inputTokens: 100, outputTokens: 0 })
})

test('Jev: at most 32 questions per request and every request fits the token budget', async () => {
  const { calls, fetchImpl } = fakeJev()
  const out = await scorerWith(fetchImpl).score(task, [job(many(70))])
  const sizes = calls.map(c => Object.keys(c.body.questions).length)
  assert.equal(sizes.reduce((a, b) => a + b, 0), 70)
  assert.ok(sizes.every(n => n <= 32) && sizes.length >= 3, 'sizes ' + sizes)
  assert.equal(out.grades.get('n1')!.size, 70)
  assert.equal(out.usage!.requests, sizes.length)
  // 100 tiny questions with a roomy token budget fill the documented 32 per request.
  const roomy = fakeJev()
  await scorerWith(roomy.fetchImpl, { requestTokenBudget: 1_000_000 }).score(task, [job(many(70))])
  assert.deepEqual(roomy.calls.map(c => Object.keys(c.body.questions).length), [32, 32, 6])

  // 1200 Chinese characters each: ~7k expanded tokens per question, so only a few fit a request.
  const heavy = fakeJev()
  const big = Array.from({ length: 20 }, (_, i) => blk('h' + i, '字'.repeat(1500)))
  const res = await scorerWith(heavy.fetchImpl).score(task, [job(big)])
  assert.equal(res.grades.get('n1')!.size, 20)
  for (const c of heavy.calls) {
    const est = Object.values(c.body.questions).reduce((sum, q) => sum + JEV_QUESTION_OVERHEAD_TOKENS + estimateJevTokens(c.body.state + q.instructions), 0)
    assert.ok(est <= 26_000, 'request estimate ' + est)
    assert.ok(Object.keys(c.body.questions).length <= 3)
  }
  assert.ok(heavy.calls.length >= 7)
})

test('Jev: blocks and state are trimmed so each question stays far below 32k tokens', async () => {
  const { calls, fetchImpl } = fakeJev()
  const longGoal = '很长的任务描述'.repeat(400)
  await scorerWith(fetchImpl).score({ ...task, goal: longGoal }, [job([blk('x', 'a'.repeat(200_000)), blk('y', '汉'.repeat(200_000), '标题'.repeat(500))])])
  const call = calls[0]!
  assert.ok(call.body.state.length <= JEV_STATE_PREFIX.length + 200)
  for (const q of Object.values(call.body.questions)) {
    assert.ok(q.instructions.length < 1500, 'instruction chars ' + q.instructions.length)
    assert.ok(q.instructions.endsWith('…'))
    assert.ok(JEV_QUESTION_OVERHEAD_TOKENS + estimateJevTokens(call.body.state + q.instructions) < 9_000, 'each question far below 32k')
  }
  assert.equal(estimateJevTokens(''), 0)
  assert.ok(estimateJevTokens('汉'.repeat(100)) > estimateJevTokens('a'.repeat(100)), 'CJK text is costlier per character')
})

test('Jev: 422 token_budget_exceeded splits the request and still answers every question', async () => {
  let first = true
  const { calls, fetchImpl } = fakeJev(call => {
    if (first && Object.keys(call.body.questions).length > 4) {
      first = false
      return new Response(JSON.stringify({ detail: { code: 'token_budget_exceeded', counted_tokens: 33331, limit_tokens: 32768 } }), { status: 422 })
    }
    return answer(call)
  })
  const out = await scorerWith(fetchImpl).score(task, [job(many(12))])
  assert.equal(out.grades.get('n1')!.size, 12)
  assert.deepEqual(calls.map(c => Object.keys(c.body.questions).length), [12, 6, 6])
  assert.equal(out.usage!.requests, 3)
})

test('Jev: a single oversized question is halved once after a 422', async () => {
  let n = 0
  const { calls, fetchImpl } = fakeJev(call => (n++ === 0 ? new Response('{"detail":{"code":"token_budget_exceeded"}}', { status: 422 }) : answer(call)))
  const out = await scorerWith(fetchImpl).score(task, [job([blk('solo', 'x'.repeat(1000))])])
  assert.equal(out.grades.get('n1')!.size, 1)
  assert.ok(calls[1]!.body.questions.q0!.instructions.length < calls[0]!.body.questions.q0!.instructions.length)
})

test('Jev: 429 honours Retry-After, retries are bounded, and the wait is reported to sleep()', async () => {
  const waits: number[] = []
  let n = 0
  const { fetchImpl, calls } = fakeJev(call => (n++ < 2 ? new Response('slow down', { status: 429, headers: { 'retry-after': '2' } }) : answer(call)))
  const out = await new JevScorer({ apiKey: 'k', fetchImpl, sleep: async ms => { waits.push(ms) } }).score(task, [job(many(2))])
  assert.equal(out.grades.get('n1')!.size, 2)
  assert.deepEqual(waits, [2000, 2000])
  assert.equal(calls.length, 3)

  const always = fakeJev(() => new Response('busy', { status: 503 }))
  const scorer = new JevScorer({ apiKey: 'k', fetchImpl: always.fetchImpl, sleep: async () => {}, maxRetries: 2 })
  await assert.rejects(scorer.score(task, [job(many(2))]), /answered only 0 of 2/)
  assert.equal(always.calls.length, 3, 'one try plus two retries, then give up')
})

test('Jev: a retry that would pass the deadline is not attempted', async () => {
  const { fetchImpl, calls } = fakeJev(() => new Response('busy', { status: 429, headers: { 'retry-after': '5' } }))
  await assert.rejects(scorerWith(fetchImpl).score(task, [job(many(1))], { deadline: Date.now() + 1000 }), JevError)
  assert.equal(calls.length, 1)
  const past = fakeJev()
  await assert.rejects(scorerWith(past.fetchImpl).score(task, [job(many(1))], { deadline: Date.now() - 1 }), /answered only 0|deadline/)
  assert.equal(past.calls.length, 0)
})

test('Jev: 401 is fatal; the key never appears in the error', async () => {
  const { fetchImpl } = fakeJev(() => new Response('{"detail":"invalid key"}', { status: 401 }))
  await assert.rejects(scorerWith(fetchImpl).score(task, [job(many(3))]), (error: Error) => {
    assert.ok(error instanceof JevError && error.fatal && error.status === 401)
    assert.ok(!error.message.includes('sk-test-secret'))
    return true
  })
})

test('Jev: unanswered questions are dropped, but more than half missing is a failure', async () => {
  const partial = fakeJev(call => {
    const res = JSON.parse(JSON.stringify({ answers: Object.fromEntries(Object.keys(call.body.questions).map((k, i) => [k, i === 0 ? { score: 'nan' } : { score: 3 }])) }))
    return new Response(JSON.stringify(res), { status: 200 })
  })
  const out = await scorerWith(partial.fetchImpl).score(task, [job(many(4))])
  assert.equal(out.grades.get('n1')!.size, 3)
  assert.match(out.notes!.join(' '), /1 of 4 Jev questions got no answer/)

  const bad = fakeJev(() => new Response(JSON.stringify({ answers: {} }), { status: 200 }))
  await assert.rejects(scorerWith(bad.fetchImpl).score(task, [job(many(4))]), /answered only 0 of 4/)
})

test('Jev: the request cap stops further HTTP attempts', async () => {
  const { calls, fetchImpl } = fakeJev()
  await assert.rejects(scorerWith(fetchImpl, { requestCap: 2 }).score(task, [job(many(100))]), JevError)
  assert.equal(calls.length, 2)
})

test('Jev: cache hits skip the request, misses are stored', async () => {
  const store = new Map<string, number>()
  const key = (p: JevProbe): string => p.need + '|' + p.candidate
  const cache: JevCache = { get: p => (store.has(key(p)) ? { grade: store.get(key(p))! } : undefined), set: (p, a) => { store.set(key(p), a.grade) } }
  const { calls, fetchImpl } = fakeJev()
  const scorer = scorerWith(fetchImpl, { cache })
  const blocks = many(3)
  store.set(key({ state: '', need: task.needs[0]!.text, candidate: blocks[0]!.text }), 1.25)
  const out = await scorer.score(task, [job(blocks)])
  assert.equal(out.grades.get('n1')!.get('b0')!.grade, 1.25)
  assert.equal(Object.keys(calls[0]!.body.questions).length, 2)
  assert.deepEqual([out.usage!.cacheHits, out.usage!.questions], [1, 2])
  const again = await scorer.score(task, [job(blocks)])
  assert.equal(calls.length, 1, 'fully cached: no request')
  assert.equal(again.usage!.cacheHits, 3)
})

test('Jev: an aborted signal rejects without a request', async () => {
  const { calls, fetchImpl } = fakeJev()
  const controller = new AbortController()
  controller.abort(new Error('stop'))
  await assert.rejects(scorerWith(fetchImpl).score(task, [job(many(2))], { signal: controller.signal }), /stop/)
  assert.equal(calls.length, 0)
})

test('Jev: constructing without a key fails', () => {
  assert.throws(() => new JevScorer({ apiKey: '' }), /API key/)
})
