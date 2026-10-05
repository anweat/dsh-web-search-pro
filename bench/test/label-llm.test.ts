import test from 'node:test'
import assert from 'node:assert/strict'
import { BudgetGuard } from '../src/judges/budget.ts'
import { DeepSeekClient, parseBalanceCny, parseJsonLoose } from '../src/judges/deepseek-client.ts'
import { DeepSeekJudge, parseAnswers } from '../src/judges/deepseek.ts'
import { loadRubrics, renderQuestion } from '../src/judges/rubrics.ts'
import { BudgetStopError } from '../src/judges/types.ts'
import {
  buildCandidatePrompt, labelTask, validateCandidateAnswer, validateGoldAnswer, type Ask,
} from '../src/label-llm.ts'
import type { BenchTask, CandidateSnapshot } from '../src/types.ts'

const task: BenchTask = {
  id: 'dc-99', profile: 'docs_code', lang: 'en', goal: 'Find how to set a busy timeout in node:sqlite', query: 'node:sqlite busy timeout',
  needs: [{ id: 'n1', text: 'How to set a busy timeout', critical: true }, { id: 'n2', text: 'Which version added it', critical: false }],
  constraints: [
    { id: 'c1', kind: 'entity', value: 'node:sqlite', strength: 'hard' },
    { id: 'c2', kind: 'exclude_site', value: 'csdn.net', strength: 'hard' },
  ],
  traps: ['同名实体'], notes: 'n',
}

const snapshot: CandidateSnapshot = {
  version: 1, taskId: 'dc-99', harvestedAt: '2026-10-01T00:00:00.000Z',
  engineRuns: [
    { engine: 'ddg', query: task.query, status: 'ok', ms: 1, results: [
      { rank: 1, url: 'https://nodejs.org/api/sqlite.html', title: 'SQLite | Node.js', snippet: 'DatabaseSync options timeout' },
      { rank: 2, url: 'https://blog.csdn.net/a/1', title: 'sqlite tutorial', snippet: 'blah' },
    ] },
    { engine: 'bing', query: task.query, status: 'ok', ms: 1, results: [
      { rank: 1, url: 'https://nodejs.org/api/sqlite.html#fragment', title: 'dup', snippet: 'dup' },
      { rank: 2, url: 'https://example.com/', title: 'Home', snippet: '' },
    ] },
  ],
  pages: [{
    url: 'https://nodejs.org/api/sqlite.html', fetchedAt: 'x', status: 'ok', source: 'http', text: 'abc', from: ['ddg#1'],
    blocks: [
      { blockId: 'b_aaaaaaaaaaaa', text: 'Intro to sqlite', start: 0, end: 3, hash: 'h1' },
      { blockId: 'b_bbbbbbbbbbbb', heading: 'DatabaseSync', text: 'options.timeout is the busy timeout in ms', start: 3, end: 9, hash: 'h2' },
    ],
  }],
}

const candAnswer = JSON.stringify({ candidates: [
  { i: 1, rel: 3, c: { c1: 'y' }, nav: false, note: '官方文档' },
  { i: 2, rel: 0, c: { c1: 'n' }, nav: false },
  { i: 3, rel: 0, c: { c1: 'u' }, nav: true },
] })
const goldAnswer = JSON.stringify({ gold: [{ need: 'n1', blocks: ['1.2'] }, { need: 'n2', blocks: [] }] })

test('candidate prompt numbers candidates and only asks about non-site constraints', () => {
  const prompt = buildCandidatePrompt(task, [{ index: 1, cand: { url: 'https://a.com/', key: 'k', title: 't', snippet: 's', from: [] }, pageNote: '' }])
  assert.match(prompt[1]!.content, /\[1\] https:\/\/a\.com\//)
  assert.match(prompt[1]!.content, /对约束 c1 分别给/)
  assert.ok(!prompt[1]!.content.includes('对约束 c1、c2'))
})

test('validateCandidateAnswer: complete, missing, bad rel, bad constraint', () => {
  const ok = validateCandidateAnswer(JSON.parse(candAnswer), [1, 2, 3], ['c1'])
  assert.deepEqual(ok.errors, [])
  assert.equal(ok.rows.get(1)!.rel, 3)
  assert.equal(ok.rows.get(3)!.nav, true)
  assert.equal(ok.rows.get(2)!.checks.get('c1'), 'no')
  const missing = validateCandidateAnswer({ candidates: [{ i: 1, rel: 2, c: { c1: 'y' } }] }, [1, 2], ['c1'])
  assert.ok(missing.errors.some(e => e.includes('缺少编号 2')))
  assert.ok(validateCandidateAnswer({ candidates: [{ i: 1, rel: 5, c: { c1: 'y' } }] }, [1], ['c1']).errors.some(e => e.includes('rel')))
  assert.ok(validateCandidateAnswer({ candidates: [{ i: 1, rel: 1, c: {} }] }, [1], ['c1']).errors.some(e => e.includes('c1')))
  assert.ok(validateCandidateAnswer({ candidates: [{ i: 9, rel: 1, c: { c1: 'y' } }] }, [1], ['c1']).errors.some(e => e.includes('未知编号')))
  assert.ok(validateCandidateAnswer({ nope: 1 }, [1], []).errors.length)
  // no model constraints: empty c is fine
  assert.deepEqual(validateCandidateAnswer({ candidates: [{ i: 1, rel: 1, nav: 'true' }] }, [1], []).errors, [])
})

test('validateGoldAnswer: unknown refs and needs are rejected, empty evidence is allowed', () => {
  const refs = new Set(['1.1', '1.2'])
  const ok = validateGoldAnswer(JSON.parse(goldAnswer), ['n1', 'n2'], refs)
  assert.deepEqual(ok.errors, [])
  assert.deepEqual(ok.gold.get('n2'), [])
  assert.ok(validateGoldAnswer({ gold: [{ need: 'n1', blocks: ['9.9'] }, { need: 'n2', blocks: [] }] }, ['n1', 'n2'], refs).errors.some(e => e.includes('9.9')))
  assert.ok(validateGoldAnswer({ gold: [{ need: 'n1', blocks: [] }] }, ['n1', 'n2'], refs).errors.some(e => e.includes('缺少需求 n2')))
  assert.ok(validateGoldAnswer({ gold: [{ need: 'zz', blocks: [] }] }, ['n1'], refs).errors.some(e => e.includes('未知需求')))
})

test('labelTask: builds a Label file body, rules decide site constraints, evidence carries hash', async () => {
  const stages: string[] = []
  const ask: Ask = async stage => { stages.push(stage); return stage.endsWith(':gold') ? goldAnswer : candAnswer }
  const label = await labelTask(task, snapshot, ask, { model: 'deepseek-flash', effort: 'low' })
  assert.equal(label.version, 1)
  assert.equal(label.taskId, 'dc-99')
  assert.equal(label.snapshotHarvestedAt, snapshot.harvestedAt)
  assert.equal(label.labeler.kind, 'llm')
  assert.equal(label.labeler.reviewed, false)
  assert.equal(label.labeler.effort, 'low')
  assert.equal(label.labeler.promptVersion, 'label.v1')
  assert.equal(label.candidates.length, 3)
  assert.equal(label.candidates[0]!.relevance, 3)
  assert.deepEqual(label.candidates[1]!.constraintChecks, [{ constraintId: 'c1', satisfied: 'no' }, { constraintId: 'c2', satisfied: 'no' }])
  assert.equal(label.candidates[0]!.constraintChecks[1]!.satisfied, 'yes')
  assert.equal(label.candidates[2]!.navPage, true)
  assert.deepEqual(label.gold, [
    { needId: 'n1', evidence: [{ url: 'https://nodejs.org/api/sqlite.html', blockId: 'b_bbbbbbbbbbbb', hash: 'h2' }] },
    { needId: 'n2', evidence: [] },
  ])
  assert.deepEqual(stages, ['dc-99:candidates@1', 'dc-99:gold'])
})

test('labelTask: retries once on invalid JSON, fails after a second invalid answer', async () => {
  let calls = 0
  const flaky: Ask = async stage => { calls++; return calls === 1 ? 'not json at all' : stage.includes('gold') ? goldAnswer : candAnswer }
  const label = await labelTask(task, snapshot, flaky, { model: 'm' })
  assert.equal(label.candidates.length, 3)
  assert.equal(calls, 3)
  let n = 0
  const broken: Ask = async () => { n++; return '{"candidates":[{"i":1,"rel":9}]}' }
  await assert.rejects(labelTask(task, snapshot, broken, { model: 'm' }), /invalid output after retry/)
  assert.equal(n, 2)
})

test('labelTask: no fetched pages gives empty evidence without a gold request', async () => {
  const stages: string[] = []
  const ask: Ask = async s => { stages.push(s); return candAnswer }
  const label = await labelTask(task, { ...snapshot, pages: [] }, ask, { model: 'm' })
  assert.deepEqual(stages, ['dc-99:candidates@1'])
  assert.deepEqual(label.gold.map(g => g.evidence), [[], []])
})

// ── budget guard ────────────────────────────────────────────────────────────

function balances(seq: number[]) { let i = 0; return async () => seq[Math.min(i++, seq.length - 1)]! }

test('BudgetGuard: stops when spend >= max', async () => {
  const g = new BudgetGuard({ getBalance: balances([50, 49.5, 48.9, 47.9]), maxSpend: 2, minBalance: 41 })
  assert.equal((await g.start()).ok, true)
  assert.equal((await g.check()).ok, true)
  const s = await g.check()
  assert.equal(s.ok, true)
  assert.equal(s.spend, 1.1)
  const stop = await g.check()
  assert.equal(stop.ok, false)
  assert.match(stop.reason!, /reached max/)
  const g2 = new BudgetGuard({ getBalance: balances([50, 47]), maxSpend: 2, minBalance: 41 })
  await g2.start()
  await assert.rejects(g2.assertOk(), BudgetStopError)
})

test('BudgetGuard: stops when balance falls below the minimum, even with little spend', async () => {
  const g = new BudgetGuard({ getBalance: balances([41.5, 40.99]), maxSpend: 2, minBalance: 41 })
  assert.equal((await g.start()).ok, true)
  const s = await g.check()
  assert.equal(s.ok, false)
  assert.match(s.reason!, /below minimum/)
  const low = await new BudgetGuard({ getBalance: balances([30]), maxSpend: 2, minBalance: 41 }).start()
  assert.equal(low.ok, false)
  // exactly at the floor is still allowed (balance < min stops)
  assert.equal((await new BudgetGuard({ getBalance: balances([41]), maxSpend: 2, minBalance: 41 }).start()).ok, true)
})

test('DeepSeek client: balance parsing and request body (reasoning_effort only when set)', async () => {
  assert.equal(parseBalanceCny({ is_available: true, balance_infos: [{ currency: 'CNY', total_balance: '51.29' }] }), 51.29)
  assert.throws(() => parseBalanceCny({ balance_infos: [] }))
  const bodies: any[] = []
  const impl = (async (url: string, init: RequestInit) => {
    if (String(url).endsWith('/user/balance')) return new Response(JSON.stringify({ balance_infos: [{ currency: 'CNY', total_balance: '40.5' }] }))
    bodies.push(JSON.parse(String(init.body)))
    return new Response(JSON.stringify({ choices: [{ message: { content: '{"ok":1}' }, finish_reason: 'stop' }], usage: { prompt_tokens: 12, completion_tokens: 3 } }))
  }) as unknown as typeof fetch
  const client = new DeepSeekClient({ apiKey: 'k', fetchImpl: impl })
  assert.equal(await client.balanceCny(), 40.5)
  const r = await client.chat({ model: 'deepseek-flash', json: true, messages: [{ role: 'user', content: 'hi' }] })
  assert.equal(r.inputTokens, 12)
  assert.equal(r.outputTokens, 3)
  assert.equal('reasoning_effort' in bodies[0], false)
  await client.chat({ model: 'deepseek-flash', effort: 'low', messages: [{ role: 'user', content: 'hi' }] })
  assert.equal(bodies[1].reasoning_effort, 'low')
  assert.deepEqual(bodies[0].response_format, { type: 'json_object' })
})

test('parseJsonLoose: fences, prose around JSON, garbage', () => {
  assert.deepEqual(parseJsonLoose('```json\n{"a":1}\n```'), { a: 1 })
  assert.deepEqual(parseJsonLoose('Sure! Here it is: {"a":[1,2]} hope it helps'), { a: [1, 2] })
  assert.deepEqual(parseJsonLoose('[{"i":1}]'), [{ i: 1 }])
  assert.equal(parseJsonLoose('no json'), undefined)
})

test('DeepSeek judge: batches numbered items, parses results, flags missing ones, guard stops before a request', async () => {
  const rubrics = loadRubrics()
  const q = renderQuestion(rubrics.get('gate.relevance.v1')!, { need: 'x' })
  const prompts: string[] = []
  const impl = (async (_url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body))
    prompts.push(body.messages[1].content)
    return new Response(JSON.stringify({ choices: [{ message: { content: '```json\n{"results":[{"i":1,"p":0.9},{"i":3,"p":0.1}]}\n```' } }], usage: { prompt_tokens: 50, completion_tokens: 10 } }))
  }) as unknown as typeof fetch
  const client = new DeepSeekClient({ apiKey: 'k', fetchImpl: impl })
  const judge = new DeepSeekJudge({ client })
  const res = await judge.evaluate('搜索任务：X', q, [{ id: 'a', text: 'A' }, { id: 'b', text: 'B' }, { id: 'c', text: 'C' }])
  assert.equal(prompts.length, 1)
  assert.match(prompts[0]!, /\[1\] A/)
  assert.match(prompts[0]!, /\[3\] C/)
  assert.equal(res[0]!.prob, 0.9)
  assert.equal(res[2]!.prob, 0.1)
  assert.ok(res[1]!.error)
  assert.equal(res[0]!.usage!.inputTokens, 50)
  const stopGuard = new BudgetGuard({ getBalance: balances([50, 40]), maxSpend: 2, minBalance: 41 })
  await stopGuard.start()
  const guarded = new DeepSeekJudge({ client, guard: stopGuard })
  await assert.rejects(guarded.evaluate('s', q, [{ id: 'z', text: 'Z' }]), BudgetStopError)
  assert.equal(prompts.length, 1)
  assert.equal(parseAnswers({ results: [{ i: 1, grade: 7 }] }, renderQuestion(rubrics.get('score.support.v1')!, {}), 1).size, 0)
})
