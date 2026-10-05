import test from 'node:test'
import assert from 'node:assert/strict'
import {
  bucketGrade, estimateJevTokens, HybridScorer, JEV_CRITERIA, JEV_INSTRUCTIONS, JEV_MODEL, JEV_QUESTION_OVERHEAD_TOKENS, JEV_STATE_PREFIX, JevError, JevScorer, RuleScorer,
  type JevCache, type JevProbe, type ScoreJob, type ScoreOutcome, type ScoreTask, type Scorer,
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

// ── hybrid scorer ───────────────────────────────────────────────────────────

const zhNeed = { id: 'n1', text: 'DatabaseSync 构造参数中的 timeout 选项', critical: true }
const enNeed = { id: 'n2', text: 'how to set the busy timeout in DatabaseSync', critical: true }
const hybridTask: ScoreTask = { goal: '了解 node:sqlite 的 busy timeout', query: 'node:sqlite DatabaseSync busy timeout 设置', needs: [zhNeed, enNeed], constraints: [] }
const EN_OPT = 'sqlite.DatabaseSyncOptions.timeout — timeout?: number — The busy timeout in milliseconds.'
const EN_MID = 'The DatabaseSync class opens a database file and exposes exec and prepare for statements.'
const ZH_MID = 'DatabaseSync 类用于打开数据库文件，并提供 exec 和 prepare 方法来执行语句。'

/** A Jev stand-in: records the jobs it gets and answers every pair with `grade`. */
function stubJev(grade: number | ((needId: string, blockId: string) => number | undefined), opts: { fail?: Error; usage?: boolean } = {}) {
  const seen: ScoreJob[][] = []
  const scorer: Scorer = {
    id: 'jev', model: 'stub',
    async score(_task, jobs): Promise<ScoreOutcome> {
      seen.push(jobs.map(j => ({ need: j.need, blocks: [...j.blocks] })))
      if (opts.fail) throw opts.fail
      const grades = new Map<string, Map<string, { grade: number; rank: number }>>()
      for (const j of jobs) {
        const byBlock = new Map<string, { grade: number; rank: number }>()
        for (const b of j.blocks) {
          const g = typeof grade === 'function' ? grade(j.need.id, b.blockId) : grade
          if (g !== undefined) byBlock.set(b.blockId, { grade: g, rank: g })
        }
        grades.set(j.need.id, byBlock)
      }
      const questions = jobs.reduce((n, j) => n + j.blocks.length, 0)
      return { grades, ...opts.usage === false ? {} : { usage: { requests: 1, questions, cacheHits: 0, inputTokens: 10, outputTokens: 0 } } }
    },
  }
  return { scorer, seen }
}

const pairsOf = (jobs: ScoreJob[]): string[] => jobs.flatMap(j => j.blocks.map(b => j.need.id + '|' + b.blockId))

test('Hybrid: the rule scorer grades everything, Jev re-scores only need/block language mismatches and its grades replace the rule grades', async () => {
  const blocks = [blk('opt', EN_OPT), blk('zh', ZH_MID), blk('en', EN_MID)]
  const jev = stubJev(0.5)
  const hybrid = new HybridScorer({ jev: jev.scorer })
  const rule = await new RuleScorer().score(hybridTask, [job(blocks, zhNeed), job(blocks, enNeed)])
  const out = await hybrid.score(hybridTask, [job(blocks, zhNeed), job(blocks, enNeed)])
  assert.equal(jev.seen.length, 1)
  // zh need: the two English blocks; en need: the Chinese block. Nothing else.
  assert.deepEqual(pairsOf(jev.seen[0]!).sort(), ['n1|en', 'n1|opt', 'n2|zh'])
  for (const pair of ['n1|en', 'n1|opt', 'n2|zh']) {
    const [n, b] = pair.split('|') as [string, string]
    assert.deepEqual(out.grades.get(n)!.get(b), { grade: 0.5, rank: 0.5 / 3 })
  }
  for (const pair of [['n1', 'zh'], ['n2', 'opt'], ['n2', 'en']] as const) assert.deepEqual(out.grades.get(pair[0])!.get(pair[1]), rule.grades.get(pair[0])!.get(pair[1]), 'same-language pairs keep the rule grade')
  assert.deepEqual(out.usage, { requests: 1, questions: 3, cacheHits: 0, inputTokens: 10, outputTokens: 0 })
  assert.equal(hybrid.id, 'hybrid')
})

test('Hybrid: a Jev answer can also lower the rule grade; unanswered questions keep it', async () => {
  const blocks = [blk('opt', EN_OPT), blk('en', EN_MID)]
  const rule = await new RuleScorer().score(hybridTask, [job(blocks, zhNeed)])
  assert.ok(rule.grades.get('n1')!.get('opt')!.grade >= 2)
  const jev = stubJev((_n, b) => (b === 'opt' ? 0.4 : undefined))
  const out = await new HybridScorer({ jev: jev.scorer }).score(hybridTask, [job(blocks, zhNeed)])
  assert.equal(out.grades.get('n1')!.get('opt')!.grade, 0.4, 'Jev says no: the lexical guess is overruled')
  assert.deepEqual(out.grades.get('n1')!.get('en'), rule.grades.get('n1')!.get('en'), 'no Jev answer -> rule grade')
})

test('Hybrid: no mismatching pair means no Jev call at all', async () => {
  const jev = stubJev(3)
  const out = await new HybridScorer({ jev: jev.scorer }).score(hybridTask, [job([blk('en', EN_MID), blk('opt', EN_OPT)], enNeed)])
  assert.equal(jev.seen.length, 0)
  assert.equal(out.usage, undefined)
  assert.equal(out.grades.get('n2')!.size, 2)
})

test('Hybrid: hybridBorderline also sends rule grade-1 pairs of the same language, mismatches first; off by default', async () => {
  // a same-language block with rule grade exactly 1 for the English need
  const borderline = blk('mid', 'The DatabaseSync class opens a database file and exposes exec and prepare for statements, see the guide.')
  const rule = await new RuleScorer().score(hybridTask, [job([borderline], enNeed)])
  assert.equal(rule.grades.get('n2')!.get('mid')!.grade, 1, 'fixture must be rule-borderline: ' + rule.grades.get('n2')!.get('mid')!.rank)
  const blocks = [borderline, blk('zh', ZH_MID)]
  const off = stubJev(2)
  await new HybridScorer({ jev: off.scorer }).score(hybridTask, [job(blocks, enNeed)])
  assert.deepEqual(pairsOf(off.seen[0]!), ['n2|zh'])
  const on = stubJev(2)
  const out = await new HybridScorer({ jev: on.scorer, borderline: true }).score(hybridTask, [job(blocks, enNeed)])
  assert.deepEqual(pairsOf(on.seen[0]!), ['n2|zh', 'n2|mid'], 'mismatch pairs are queued before borderline ones')
  assert.equal(out.grades.get('n2')!.get('mid')!.grade, 2)
})

test('Hybrid: maxQuestions caps the Jev pairs round-robin over the needs, best rule relevance first', async () => {
  const many = Array.from({ length: 6 }, (_, i) => blk('b' + i, i === 3 ? EN_OPT : 'Plain English paragraph number ' + i + ' about cooking bread.'))
  const needB = { id: 'n3', text: '另一个中文需求 busy timeout', critical: true }
  const t: ScoreTask = { ...hybridTask, needs: [zhNeed, needB] }
  const jev = stubJev(1)
  await new HybridScorer({ jev: jev.scorer, maxQuestions: 3 }).score(t, [job(many, zhNeed), job(many, needB)])
  const sent = pairsOf(jev.seen[0]!)
  assert.equal(sent.length, 3)
  assert.ok(sent.includes('n1|b3') && sent.includes('n3|b3'), 'the most relevant block of each need goes first: ' + sent.join())
  assert.deepEqual(new Set(jev.seen[0]!.map(j => j.need.id)), new Set(['n1', 'n3']), 'both needs are served before one gets a second question')
  const none = stubJev(1)
  await new HybridScorer({ jev: none.scorer, maxQuestions: 0 }).score(t, [job(many, zhNeed)])
  assert.equal(none.seen.length, 0)
})

test('Hybrid: a Jev failure keeps every rule grade and says so; an abort is rethrown', async () => {
  const blocks = [blk('opt', EN_OPT), blk('en', EN_MID)]
  const rule = await new RuleScorer().score(hybridTask, [job(blocks, zhNeed)])
  const failing = stubJev(1, { fail: new JevError('Jev HTTP 503 down') })
  const out = await new HybridScorer({ jev: failing.scorer }).score(hybridTask, [job(blocks, zhNeed)])
  assert.deepEqual([...out.grades.get('n1')!], [...rule.grades.get('n1')!])
  assert.match(out.notes!.join(' '), /Jev re-scoring failed, kept the rule grades: Jev HTTP 503 down/)
  assert.equal(out.usage, undefined)
  const controller = new AbortController()
  const aborting: Scorer = { id: 'jev', model: 'x', async score() { controller.abort(); throw new Error('aborted') } }
  await assert.rejects(new HybridScorer({ jev: aborting }).score(hybridTask, [job(blocks, zhNeed)], { signal: controller.signal }), /aborted/)
})

test('Hybrid over the real JevScorer: only mismatch pairs are posted, in the score.support.v1 wording', async () => {
  const { calls, fetchImpl } = fakeJev()
  const jev = scorerWith(fetchImpl)
  const out = await new HybridScorer({ jev }).score(hybridTask, [job([blk('opt', EN_OPT), blk('zh', ZH_MID)], zhNeed)])
  assert.equal(calls.length, 1)
  const questions = Object.values(calls[0]!.body.questions)
  assert.equal(questions.length, 1)
  assert.ok(questions[0]!.instructions.includes('sqlite.DatabaseSyncOptions.timeout'))
  assert.equal(out.usage!.questions, 1)
  assert.equal(out.grades.get('n1')!.get('opt')!.grade, 2)
})
