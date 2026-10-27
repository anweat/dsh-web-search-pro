import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import dns from 'node:dns/promises'
import { SearchRouter } from '../src/router.ts'
import { resolveConfig } from '../src/config.ts'
import { Store } from '../src/store.ts'
import { FetchService } from '../src/fetch.ts'
import { UsageLedger, resolveBudget } from '../src/pipeline/ledger.ts'
import { createBuiltinRegistry, defaultProviderRegistry } from '../src/providers/index.ts'
import {
  DEEPSEEK_DEFAULT_BASE, DEEPSEEK_DESCRIPTOR, DEEPSEEK_MAX_ATTEMPTS, DEEPSEEK_RETRY_BASE_MS, DEEPSEEK_RETRY_WAIT_CAP_MS, DeepSeekFetchError,
  deepseekAdapter, deepseekFailure, deepseekFetchFailure, deepseekFetchPage, deepseekSearchBody, detailOf, fitQuery, mapDeepSeekResults, originalQuestion, parseDeepSeekSearch,
} from '../src/providers/deepseek.ts'
import { KEYED_SOURCE_ENVS } from '../src/providers/keyed-meta.ts'
import { compileDeepSeek, compileQuery } from '../src/pipeline/compile.ts'
import { planSources, type ProviderStatus } from '../src/pipeline/plan.ts'
import { mergeCandidates } from '../src/pipeline/candidates.ts'
import { fuseCandidates, providerSignal, PROVIDER_SIGNAL_BOOST } from '../src/pipeline/fusion.ts'
import { runPipeline, type PipelineDeps, type ProviderOutcome } from '../src/pipeline/run.ts'
import { recommendSources, renderRecommendation } from '../src/catalog/recommend.ts'
import { loadCatalog } from '../src/catalog/load.ts'
import { shapeSources } from '../src/util.ts'
import { formatSources } from '../src/actions/format.ts'
import { checkOutput } from '../src/actions/schema.ts'
import { findAction } from '../src/actions/registry.ts'
import type { Constraint, TaskSpec } from '../src/pipeline/types.ts'
import { fixture, fails, harness, reply, assertNoKey, PUBLIC } from './keyed-harness.ts'

const NOW = new Date('2026-10-26T00:00:00Z')
const KEY = 'sk-0123456789abcdef0123456789abcdef'
const hard = (id: string, kind: Constraint['kind'], value: string, strength: Constraint['strength'] = 'hard'): Constraint => ({ id, kind, value, strength, origin: 'param' })
const task = (constraints: Constraint[] = [], query = 'postgres logical replication slot lag', goal = query): Pick<TaskSpec, 'goal' | 'query' | 'needs' | 'constraints'> => ({ goal, query, needs: [{ id: 'n1', text: goal, critical: true }], constraints })
const spec = (over: Partial<TaskSpec> = {}): TaskSpec => ({ goal: 'goal', query: 'query', needs: [{ id: 'n1', text: 'goal', critical: true }], constraints: [], budget: {}, ...over })
const make = (d: Parameters<typeof deepseekAdapter.create>[0]) => deepseekAdapter.create(d, {} as never)
const live = (name: string): any => { const fx = fixture(name); assert.equal(fx.live, true, name + ' is a live capture'); return fx }
const errorBody = (n: 'bad-key' | 'over-128' | '404') => live('deepseek-errors.json').errors[n]
const noSleep = () => { const waits: number[] = []; return { waits, sleep: async (ms: number) => { waits.push(ms) } } }
const EN = { goal: 'Find how Postgres logical replication slots work', query: 'postgres logical replication slot lag' }
const ZH = { goal: '了解国内大模型备案的最新要求', query: '大模型备案 最新要求 2026' }

// ── response mapping (live fixtures) ─────────────────────────────────────────

test('mapping (live capture): summary is the long excerpt, date -> publishedAt, rerank_score / authority are source metadata; the title heading and the empty content are not used', () => {
  const fx = live('deepseek-search.json')
  assert.match(fx._comment, /LIVE capture, 2026-10-26/)
  const sources = parseDeepSeekSearch(fx.body, 10)
  assert.equal(sources.length, 4)
  const [first, second] = sources
  assert.equal(first!.title, 'Re: Regarding huge logical slot lag between source and target')
  assert.equal(first!.publishedAt, '2026-10-18T16:00:00+00:00', 'date (RFC 3339) -> publishedAt')
  assert.equal(first!.rerankScore, fx.body.results[0].rerank_score)
  assert.equal(first!.authority, 4)
  assert.ok(first!.snippet!.length > 400 && first!.snippet!.length <= 1001, 'the summary (cut at 1,000 characters), not the 200-character snippet')
  assert.ok(!first!.snippet!.startsWith('#'), 'the summary opens with the title as an H1: dropped')
  assert.notEqual(first!.snippet, fx.body.results[0].snippet)
  assert.ok(!('publishedAt' in second!), 'date null -> no publishedAt')
  assert.ok(sources.every(s => /^https?:\/\//.test(s.url)))
  assert.equal(parseDeepSeekSearch(fx.body, 2).length, 2, 'bounded by count')
  const zh = parseDeepSeekSearch(live('deepseek-search-zh.json').body, 5)
  assert.equal(zh.length, 3)
  assert.match(zh[0]!.title!, /备案/)
  assert.ok(zh.every(s => typeof s.rerankScore === 'number' && typeof s.authority === 'number'))
})

test('mapping: authority -1 (unknown) is absent, never the lowest grade; scores are clamped; rows without an http(s) url are dropped; summary falls back to snippet', () => {
  const rows = mapDeepSeekResults([
    { url: 'https://a.test/1', title: 'A', summary: '', snippet: 'short snippet', rerank_score: 7.5, authority: -1, date: null, content: '' },
    { url: 'ftp://a.test/2', title: 'FTP', rerank_score: 1 },
    { title: 'no url' },
    { url: 'https://a.test/3', title: 'C', summary: '# C\n\nbody of the summary', rerank_score: -2, authority: 9, date: '2026-01-01T00:00:00+00:00' },
    { url: 'https://a.test/4', summary: '# Other heading\n\nkept', rerank_score: 'x', authority: 2.4 },
  ], 10)
  assert.deepEqual(rows.map(r => r.url), ['https://a.test/1', 'https://a.test/3', 'https://a.test/4'])
  assert.deepEqual([rows[0]!.rerankScore, rows[0]!.authority, rows[0]!.snippet], [3, undefined, 'short snippet'])
  assert.ok(!('authority' in rows[0]!))
  assert.deepEqual([rows[1]!.rerankScore, rows[1]!.authority, rows[1]!.snippet, rows[1]!.publishedAt], [0, 4, 'body of the summary', '2026-01-01T00:00:00+00:00'])
  assert.deepEqual([rows[2]!.rerankScore, rows[2]!.authority, rows[2]!.snippet], [undefined, 2, '# Other heading kept'], 'only a heading equal to the title is dropped')
  assert.throws(() => parseDeepSeekSearch({ results: [] }, 5), (e: any) => e.code === 'ENGINE_EMPTY' && e.retryable)
  assert.throws(() => parseDeepSeekSearch({ results: [{ title: 'no url' }] }, 5), (e: any) => e.code === 'ENGINE_EMPTY')
  assert.throws(() => parseDeepSeekSearch({}, 5), (e: any) => e.code === 'ENGINE_ERROR')
  assert.throws(() => parseDeepSeekSearch([], 5), (e: any) => e.code === 'ENGINE_ERROR')
})

// ── request construction ─────────────────────────────────────────────────────

test('request: POST {base}/search with a Bearer key, query / count / need_content=false / ori_question only; the key is never in the URL or the body; one request is booked per billed answer', async () => {
  const h = harness('deepseek', make, () => reply(200, live('deepseek-search.json').body), KEY)
  const out = await h.engine.search('PostgreSQL logical replication slot lag', 7, undefined, { originalQuestion: '  How do I monitor\n slot lag?  ' })
  assert.equal(out.sources.length, 4)
  const c = h.calls[0]!
  assert.equal(c.url, 'https://api.deepseek.com/v1/tools/search')
  assert.equal(c.init.method, 'POST')
  assert.equal(c.headers.authorization, 'Bearer ' + KEY)
  assert.equal(c.headers['content-type'], 'application/json')
  assert.equal(c.init.redirect, 'manual')
  assert.deepEqual(c.body, { query: 'PostgreSQL logical replication slot lag', count: 7, need_content: false, ori_question: 'How do I monitor slot lag?' })
  assert.ok(!c.url.includes(KEY) && !JSON.stringify(c.body).includes(KEY))
  assert.deepEqual(h.usage, [{ provider: 'deepseek-search', protocol: 'search', requests: 1, note: 'tokens n/a, $0.75 per 1,000 successful requests' }])
  assert.equal(DEEPSEEK_DEFAULT_BASE, 'https://api.deepseek.com/v1/tools')
  assert.equal(out.notes, undefined)
})

test('request: count is clamped to 1..50 (default 10 when not a number), ori_question is dropped when it adds nothing and cut to 128 characters, the base URL is configurable', async () => {
  assert.equal(deepseekSearchBody('q', 99).count, 50)
  assert.equal(deepseekSearchBody('q', 0).count, 10, 'not a usable count: the service default')
  assert.equal(deepseekSearchBody('q', 3.9).count, 3)
  assert.equal(deepseekSearchBody('q', Number.NaN).count, 10)
  assert.deepEqual(Object.keys(deepseekSearchBody('q', 5)).sort(), ['count', 'need_content', 'query'])
  assert.equal(originalQuestion('Same Query', 'same   query'), undefined)
  assert.equal(originalQuestion('   ', 'q'), undefined)
  assert.equal(originalQuestion(undefined, 'q'), undefined)
  const long = '问'.repeat(300)
  assert.equal([...originalQuestion(long, 'q')!].length, 128)
  assert.equal([...originalQuestion('x'.repeat(200), 'q')!].length, 128)
  const h = harness('deepseek', make, () => reply(200, live('deepseek-search.json').body), KEY, { sourceBaseUrls: { deepseek: 'https://gateway.example.test/deepseek/v1/tools/' } })
  await h.engine.search('q', 3)
  assert.equal(h.calls[0]!.url, 'https://gateway.example.test/deepseek/v1/tools/search')
  assert.deepEqual(h.calls[0]!.body, { query: 'q', count: 3, need_content: false })
})

test('query over 128 characters: the free text is cut at a word (or by character without spaces), every operator is kept, and the result says so', async () => {
  const short = fitQuery('  one   two\tthree ')
  assert.deepEqual(short, { query: 'one two three', cut: false, from: 13 })
  const words = 'alpha beta gamma delta '.repeat(12).trim()
  const withOps = words + ' site:postgresql.org OR site:lwn.net -site:medium.com -pinterest after:2026-01-01'
  const fitted = fitQuery(withOps)
  assert.equal(fitted.cut, true)
  assert.ok([...fitted.query].length <= 128, String([...fitted.query].length))
  for (const op of ['site:postgresql.org', 'OR', 'site:lwn.net', '-site:medium.com', '-pinterest', 'after:2026-01-01']) assert.ok(fitted.query.split(' ').includes(op), op + ' kept in: ' + fitted.query)
  assert.ok(fitted.query.startsWith('alpha beta gamma delta'), 'the head of the free text is what stays')
  const zh = fitQuery('国内大模型备案要求'.repeat(30) + ' site:gov.cn')
  assert.ok(zh.cut && [...zh.query].length <= 128 && zh.query.endsWith(' site:gov.cn'), zh.query.slice(-30))
  assert.ok(zh.query.startsWith('国内大模型备案要求'))
  const emoji = fitQuery('😀'.repeat(200))
  assert.deepEqual([[...emoji.query].length, emoji.cut], [128, true], 'characters, not UTF-16 units')
  const opsOnly = fitQuery(Array.from({ length: 30 }, (_, i) => 'site:d' + i + '.example.test').join(' '))
  assert.ok(opsOnly.cut && [...opsOnly.query].length <= 128)
  const h = harness('deepseek', make, () => reply(200, live('deepseek-search.json').body), KEY)
  const out = await h.engine.search(withOps, 5)
  assert.ok([...h.calls[0]!.body.query].length <= 128)
  assert.match(out.notes!.join('\n'), /query cut from \d+ to \d+ characters \(the API takes at most 128\); site:\/-site:\/after: operators were kept/)
})

// ── errors ───────────────────────────────────────────────────────────────────

test('errors (live bodies and the documented statuses): 401 / 403 auth, 402 balance (余额不足), 400 / 413 / 404 request errors, 408 timeout, 429 rate limit with Retry-After, 5xx retryable; none contains the key, and the request id is kept', async () => {
  const run = async (status: number, body: unknown, headers: Record<string, string> = {}) => {
    const t = noSleep()
    const h = harness('deepseek', make, () => reply(status, body, headers), KEY, { sleep: t.sleep })
    const e = await fails(h.engine.search('q', 3))
    assertNoKey(e, KEY)
    assert.equal(h.usage.length, 0, 'a failed request is not booked')
    return { e, calls: h.calls.length, waits: t.waits }
  }
  const bad = await run(401, errorBody('bad-key').body)
  assert.deepEqual([bad.e.code, bad.e.retryable, bad.e.retryAfterMs, bad.calls], ['ENGINE_AUTH', false, undefined, 1], '401 is not retried')
  assert.match(bad.e.message, /rejected the API key \(HTTP 401: Authentication Fails/)
  assert.match(bad.e.message, /request_id 00000000-0000-0000-0000-000000000000/, 'the request id (what support asks for) survives the redaction')
  const e402 = await run(402, { error: { message: 'Insufficient Balance', type: 'insufficient_balance', param: null, code: 'invalid_request_error' } })
  assert.deepEqual([e402.e.code, e402.e.retryable, e402.calls], ['ENGINE_QUOTA', false, 1])
  assert.match(e402.e.message, /balance is insufficient \(HTTP 402, 余额不足: Insufficient Balance\)\. Top up the API balance at platform\.deepseek\.com/)
  const e403 = await run(403, { error: { message: 'forbidden' } })
  assert.deepEqual([e403.e.code, e403.e.retryable, e403.calls], ['ENGINE_AUTH', false, 1])
  const e400 = await run(400, errorBody('over-128').body)
  assert.deepEqual([e400.e.code, e400.e.retryable, e400.calls], ['ENGINE_ERROR', false, 1])
  assert.match(e400.e.message, /'query' must be at most 128 characters/)
  for (const status of [404, 413, 422]) assert.deepEqual([(await run(status, { error: { message: 'x' } })).e.retryable, status], [false, status])
  const e408 = await run(408, { error: { message: 'request body read timed out' } })
  assert.deepEqual([e408.e.code, e408.e.retryable, e408.calls], ['ENGINE_TIMEOUT', true, DEEPSEEK_MAX_ATTEMPTS], '408 is waited for and retried, then reported')
  const e429 = await run(429, { error: { message: 'rate limit' } }, { 'retry-after': '3' })
  assert.deepEqual([e429.e.code, e429.e.retryable, e429.e.retryAfterMs, e429.calls, e429.waits], ['ENGINE_RATE_LIMIT', true, 3000, DEEPSEEK_MAX_ATTEMPTS, [3000, 3000]])
  for (const status of [500, 504]) {
    const e = await run(status, { error: { message: 'upstream' } })
    assert.deepEqual([e.e.code, e.e.retryable, e.calls], ['ENGINE_ERROR', true, DEEPSEEK_MAX_ATTEMPTS], String(status))
  }
  // empty result: the service works, nothing was billed
  const t = noSleep()
  const empty = harness('deepseek', make, () => reply(200, { results: [] }), KEY, { sleep: t.sleep })
  const e = await fails(empty.engine.search('nothing here', 3))
  assert.deepEqual([e.code, e.retryable, empty.usage.length], ['ENGINE_EMPTY', true, 0], 'an empty answer is not booked: the API does not bill it')
  const html = harness('deepseek', make, () => new Response('<html>bad gateway</html>', { status: 200, headers: { 'content-type': 'text/html' } }), KEY)
  assert.equal((await fails(html.engine.search('q', 3))).code, 'ENGINE_ERROR')
})

test('errors never carry the key even when the service echoes it; no key means unavailable, with where to put it', async () => {
  const echoing = harness('deepseek', make, () => reply(401, { error: { message: 'bad key ' + KEY + ' (api_key=' + KEY + ')', type: 'authentication_error' } }), KEY)
  const e = await fails(echoing.engine.search('q', 3))
  assertNoKey(e, KEY)
  assert.match(e.message, /\[redacted\]/)
  assert.ok(!detailOf({ error: { message: 'x ' + KEY } }, KEY).includes(KEY))
  assert.ok(!detailOf({ message: 'x ' + KEY }, KEY).includes(KEY))
  const none = harness('deepseek', make, () => reply(200, {}), null)
  assert.equal(none.engine.available(), false)
  const unavailable = await fails(none.engine.search('q', 3))
  assert.deepEqual([unavailable.code, unavailable.retryable], ['ENGINE_UNAVAILABLE', false])
  assert.match(unavailable.message, /DEEPSEEK_API_KEY/)
  assert.match(unavailable.message, /settings keyedSources\.deepseek\.apiKey/)
  assert.equal(none.calls.length, 0, 'nothing is sent without a key')
  assert.equal(deepseekFailure('DeepSeek Search', 599, new Headers(), undefined).retryable, true)
})

// ── retry ────────────────────────────────────────────────────────────────────

test('retry: 408 / 429 / 5xx are retried after a wait (Retry-After, else 0.8 s then 1.6 s), at most 3 tries; only the final answer is booked', async () => {
  const sequence = (statuses: number[], headers: Record<string, string> = {}) => {
    let i = 0
    const t = noSleep()
    const h = harness('deepseek', make, () => { const s = statuses[Math.min(i++, statuses.length - 1)]!; return s === 200 ? reply(200, live('deepseek-search.json').body) : reply(s, { error: { message: 'wait' } }, headers) }, KEY, { sleep: t.sleep })
    return { h, t }
  }
  const a = sequence([503, 503, 200])
  assert.equal((await a.h.engine.search('q', 4)).sources.length, 4)
  assert.deepEqual([a.h.calls.length, a.t.waits, a.h.usage.length], [3, [DEEPSEEK_RETRY_BASE_MS, DEEPSEEK_RETRY_BASE_MS * 2], 1])
  const b = sequence([429, 200], { 'retry-after': '2' })
  await b.h.engine.search('q', 3)
  assert.deepEqual([b.h.calls.length, b.t.waits], [2, [2000]], 'the service\'s own Retry-After is the wait')
  const c = sequence([408, 200])
  await c.h.engine.search('q', 3)
  assert.deepEqual([c.h.calls.length, c.t.waits], [2, [DEEPSEEK_RETRY_BASE_MS]])
  const d = sequence([500])
  assert.equal((await fails(d.h.engine.search('q', 3))).code, 'ENGINE_ERROR')
  assert.deepEqual([d.h.calls.length, d.t.waits.length, d.h.usage.length], [DEEPSEEK_MAX_ATTEMPTS, DEEPSEEK_MAX_ATTEMPTS - 1, 0])
  // the same request is sent every time (read-only API, nothing changes between tries)
  assert.deepEqual(d.h.calls[0]!.body, d.h.calls[2]!.body)
  // other 4xx: never retried
  for (const status of [400, 401, 402, 403, 404, 413]) {
    const s = sequence([status, 200])
    await fails(s.h.engine.search('q', 3))
    assert.deepEqual([s.h.calls.length, s.t.waits.length], [1, 0], 'HTTP ' + status + ' is not retried')
  }
})

test('retry: a Retry-After longer than the cap is not slept through (the failure carries it as the cooldown); an abort during the wait ends the call', async () => {
  const long = noSleep()
  const h = harness('deepseek', make, () => reply(429, { error: { message: 'slow down' } }, { 'retry-after': String(DEEPSEEK_RETRY_WAIT_CAP_MS / 1000 + 52) }), KEY, { sleep: long.sleep })
  const e = await fails(h.engine.search('q', 3))
  assert.deepEqual([e.code, e.retryAfterMs, h.calls.length, long.waits.length], ['ENGINE_RATE_LIMIT', DEEPSEEK_RETRY_WAIT_CAP_MS + 52_000, 1, 0])
  const controller = new AbortController()
  const g = harness('deepseek', make, () => reply(503, { error: { message: 'x' } }), KEY, { sleep: async (_ms, signal) => { controller.abort(); if (signal?.aborted) throw signal.reason } })
  await assert.rejects(g.engine.search('q', 3, controller.signal))
  assert.equal(g.calls.length, 1, 'no second request after the abort')
})

// ── compilation ──────────────────────────────────────────────────────────────

test('compile: hard site / exclude_site / exclude_term / time_window become the API\'s query operators; soft constraints and unknown windows stay local; ori_question carries the goal', () => {
  const c = [hard('c1', 'site', 'https://www.postgresql.org/docs'), hard('c2', 'site', 'lwn.net'), hard('c3', 'exclude_site', 'pinterest.com'), hard('c4', 'exclude_term', 'cloud hosted'), hard('c5', 'time_window', 'past 30 days'), hard('c6', 'must_term', 'slot'), hard('c7', 'site', 'soft.example', 'soft')]
  const out = deepseekAdapter.compile!(task(c, 'postgres slot lag', 'Understand why logical replication slots lag'), NOW)
  assert.equal(out.query, 'postgres slot lag site:postgresql.org OR site:lwn.net -site:pinterest.com -"cloud hosted" after:2026-09-26')
  assert.deepEqual(out.native, ['c1', 'c2', 'c3', 'c4', 'c5'])
  assert.deepEqual(out.local, ['c6', 'c7'])
  assert.deepEqual(out.options, { originalQuestion: 'Understand why logical replication slots lag' })
  assert.equal(compileQuery(task(c), 'deepseek', NOW).query, compileDeepSeek(task(c), 'deepseek', NOW).query, 'compileQuery routes deepseek here')
  // an unparsable window stays local; a goal equal to the query adds no ori_question; the first critical need is the fallback
  const w = compileDeepSeek(task([hard('c1', 'time_window', 'recently')]), 'deepseek', NOW)
  assert.deepEqual([w.query, w.native, w.local, w.options], ['postgres logical replication slot lag', [], ['c1'], undefined])
  const needs = compileDeepSeek({ ...task([], 'q'), goal: 'q', needs: [{ id: 'n1', text: 'minor', critical: false }, { id: 'n2', text: 'the critical need', critical: true }] }, 'deepseek', NOW)
  assert.equal(needs.options?.originalQuestion, 'the critical need')
  // operators the query already spells are not repeated; a site restriction elsewhere in the query keeps ours local
  const spelled = compileDeepSeek(task([hard('c1', 'site', 'nodejs.org'), hard('c2', 'exclude_site', 'medium.com'), hard('c3', 'time_window', '2025')], 'sqlite site:nodejs.org -site:medium.com after:2025-01-01'), 'deepseek', NOW)
  assert.equal(spelled.query, 'sqlite site:nodejs.org -site:medium.com after:2025-01-01')
  assert.deepEqual(spelled.native, ['c1', 'c2'], 'the window is not marked native when the query already carries its own after:')
  const other = compileDeepSeek(task([hard('c1', 'site', 'lwn.net')], 'sqlite site:nodejs.org'), 'deepseek', NOW)
  assert.deepEqual([other.query, other.native, other.local], ['sqlite site:nodejs.org', [], ['c1']])
})

// ── planning: the 常用 priority ──────────────────────────────────────────────

const descriptors = createBuiltinRegistry().list({ operation: 'search' }).map(a => a.descriptor)
const CONFIGURED = ['ddg', 'bing', 'exa', 'seam', 'jina']
const KEYED = ['deepseek', 'bocha', 'jina', 'tavily', 'brave', 'linkup', 'serper', 'metaso', 'zhipu', 'baidu-qianfan']
const statusWith = (...keys: string[]) => (id: string): ProviderStatus =>
  keys.includes(id) ? { state: 'ready', credential: 'configured', ...id === 'exa' ? { costTier: 'free-quota' as const } : {} }
    : id === 'exa' ? { state: 'ready', credential: 'missing', keyless: true, costTier: 'anonymous' }
      : KEYED.includes(id) ? { state: 'unavailable', credential: 'missing', reason: 'no key' }
        : id === 'seam' ? { state: 'unavailable', reason: 'no ctx.web' } : { state: 'ready', credential: 'not_required' }
const plan = (task: Partial<TaskSpec>, keys: string[], over: object = {}) => planSources(spec(task), { configured: CONFIGURED, status: statusWith(...keys), descriptors, ...over })
const ids = (p: ReturnType<typeof planSources>): string[] => p.providers.map(x => x.id)

test('常用: the descriptor is common, paid-tier, Chinese and English, priority 5, and the catalog and the client list agree', async () => {
  assert.equal(DEEPSEEK_DESCRIPTOR.common, true)
  assert.deepEqual([DEEPSEEK_DESCRIPTOR.costTier, DEEPSEEK_DESCRIPTOR.languages, DEEPSEEK_DESCRIPTOR.priority], ['paid', ['zh', 'en'], 5])
  assert.equal(DEEPSEEK_DESCRIPTOR.verification?.live, true)
  assert.deepEqual(DEEPSEEK_DESCRIPTOR.requirements[0]!.env, ['DEEPSEEK_API_KEY'])
  assert.deepEqual(KEYED_SOURCE_ENVS.deepseek, ['DEEPSEEK_API_KEY'])
  const { COMMON_SOURCE_IDS } = await import('../src/providers/keyed-meta.ts')
  const common = defaultProviderRegistry.list({ operation: 'search' }).filter(a => a.descriptor.common).map(a => a.descriptor.aliases[0])
  assert.deepEqual([...COMMON_SOURCE_IDS], common, 'the client list is pinned to the descriptors')
  const entry = loadCatalog().entries.find(e => e.id === 'deepseek')!
  assert.deepEqual([entry.common, entry.provider, entry.costTier, entry.verification.status, entry.keyEnv], [true, 'deepseek', 'paid', 'verified', ['DEEPSEEK_API_KEY']])
  assert.deepEqual(loadCatalog().entries.filter(e => e.common).map(e => e.id), ['deepseek'])
})

test('常用 in the evidence plan: with a key it is first for Chinese AND English tasks, ahead of Exa and Bocha even when those are configured; without a key it is never planned', () => {
  for (const [t, profiles] of [[EN, ['general', 'docs_code', 'news_fact', 'experience', 'compare']], [ZH, ['general', 'docs_code', 'news_fact', 'experience', 'compare']]] as const) {
    for (const profile of profiles) assert.equal(ids(plan({ ...t, profile }, ['deepseek']))[0], 'deepseek', t.query + ' ' + profile)
  }
  assert.deepEqual(ids(plan({ ...EN, profile: 'general' }, ['deepseek', 'exa', 'bocha'])).slice(0, 2), ['deepseek', 'exa'], 'two promoted at most: DeepSeek then Exa (10)')
  assert.deepEqual(ids(plan({ ...ZH, profile: 'general' }, ['bocha', 'deepseek', 'metaso'])).slice(0, 2), ['deepseek', 'bocha'], 'Chinese: DeepSeek before Bocha (10) and Metaso (20)')
  assert.match(plan({ ...EN, profile: 'general' }, ['deepseek']).notes.join('\n'), /language en: preferred deepseek/)
  for (const t of [EN, ZH]) assert.ok(!ids(plan({ ...t, profile: 'general' }, [])).includes('deepseek'), 'no key: not planned')
  assert.ok(!ids(plan({ ...EN, profile: 'academic' }, ['deepseek'])).includes('deepseek'), 'academic keeps its indexes')
  assert.ok(!plan({ ...EN, profile: 'general' }, []).wanted.includes('deepseek'))
})

test('常用 yields to what the user said: explicit engines > sources.priority / sources.disabled > the default; anonymous-only and autoProviders=false switch it off', () => {
  const t = { ...EN, profile: 'general' as const }
  assert.deepEqual(ids(plan(t, ['deepseek'], { engines: ['ddg'] })), ['ddg'], 'explicit engines')
  assert.deepEqual(ids(plan(t, ['deepseek'], { engines: ['deepseek', 'bing'] })), ['deepseek', 'bing'], 'explicit engines may name it')
  assert.deepEqual(ids(plan(t, ['deepseek', 'exa'], { priority: ['exa'] })).slice(0, 2), ['exa', 'deepseek'], 'sources.priority outranks the default')
  assert.equal(ids(plan(t, ['deepseek'], { priority: ['bing'] }))[0], 'bing')
  const disabled = plan(t, ['deepseek'], { disabled: ['deepseek'] })
  assert.ok(!ids(disabled).includes('deepseek') && !disabled.wanted.includes('deepseek'), 'sources.disabled')
  const anon = plan(t, ['deepseek'], { policy: 'anonymous-only' })
  assert.ok(!ids(anon).includes('deepseek') && !anon.wanted.includes('deepseek'), 'anonymous-only: it is paid, so never planned automatically')
  assert.ok(!ids(plan(t, ['deepseek'], { autoProviders: false })).includes('deepseek'))
  // a platform named by a hard site constraint still comes first; DeepSeek stays the web source behind it
  const site = plan({ ...t, constraints: [hard('c1', 'site', 'github.com')] }, ['deepseek'])
  assert.equal(ids(site)[0], 'github')
})

// ── the default chain of a plain search (router) ─────────────────────────────

function routerFor(over: Record<string, unknown>, env: Record<string, string | undefined> = {}, credentials?: (ref: string) => string | undefined) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wsp-deepseek-'))
  const store = new Store(path.join(dir, 'store.db'))
  const saved = Object.fromEntries(Object.keys({ DEEPSEEK_API_KEY: 1, ...env }).map(n => [n, process.env[n]]))
  delete process.env.DEEPSEEK_API_KEY
  for (const [n, v] of Object.entries(env)) { if (v === undefined) delete process.env[n]; else process.env[n] = v }
  const ctx = { get: (name: string) => name === 'credentials' && credentials ? { resolve: async (ref: unknown) => { const v = credentials(String((ref as { name?: string })?.name ?? ref)); return v ? { value: v } : undefined } } : undefined }
  const config = resolveConfig({ dbPath: path.join(dir, 'store.db'), allowProxyFakeIp: true, enableCliBackends: false, opencliEnabled: false, agentReachEnabled: false, ...over } as never)
  const router = new SearchRouter(ctx as never, config, store)
  const preferred = (ids: string[]): Promise<string[]> => (router as unknown as { preferred(ids: string[]): Promise<string[]> }).preferred(ids)
  return { router, store, preferred, cleanup: () => { for (const [n, v] of Object.entries(saved)) { if (v === undefined) delete process.env[n]; else process.env[n] = v } store.close(); fs.rmSync(dir, { recursive: true, force: true }) } }
}
const DEFAULT = ['ddg', 'bing', 'exa', 'seam', 'jina']

test('default chain: a resolved key puts DeepSeek first, from the environment or from a DSH credential; no key leaves the chain as it was', async () => {
  const none = routerFor({})
  try { assert.deepEqual(await none.preferred(DEFAULT), DEFAULT, 'no key: unchanged') } finally { none.cleanup() }
  const env = routerFor({}, { DEEPSEEK_API_KEY: KEY })
  try { assert.deepEqual(await env.preferred(DEFAULT), ['deepseek', ...DEFAULT], 'environment') } finally { env.cleanup() }
  const cred = routerFor({}, {}, ref => ref === 'DEEPSEEK_API_KEY' ? KEY : undefined)
  try { assert.deepEqual(await cred.preferred(DEFAULT), ['deepseek', ...DEFAULT], 'DSH credentials ref') } finally { cred.cleanup() }
  const own = routerFor({ keyedSources: { deepseek: { apiKeyEnv: 'MY_DEEPSEEK' } } }, { MY_DEEPSEEK: KEY })
  try { assert.deepEqual(await own.preferred(DEFAULT), ['deepseek', ...DEFAULT], 'a custom reference name') } finally { own.cleanup() }
  const literal = routerFor({ keyedSources: { deepseek: { apiKey: KEY } } })
  try { assert.deepEqual(await literal.preferred(DEFAULT), ['deepseek', ...DEFAULT], 'the settings key field') } finally { literal.cleanup() }
})

test('default chain precedence: sources.priority, then sources.disabled, then the 常用 default; a customised engines list is the user\'s own; anonymous-only never adds it', async () => {
  const withKey = (over: Record<string, unknown>) => routerFor(over, { DEEPSEEK_API_KEY: KEY })
  let r = withKey({ sources: { priority: ['bing'] } })
  try { assert.deepEqual(await r.preferred(DEFAULT), ['bing', 'deepseek', 'ddg', 'exa', 'seam', 'jina'], 'sources.priority first, then the common source') } finally { r.cleanup() }
  r = withKey({ sources: { priority: ['deepseek', 'jina'] } })
  try { assert.deepEqual(await r.preferred(DEFAULT), ['jina', 'deepseek', 'ddg', 'bing', 'exa', 'seam'], 'priority moves ids that are in the list; the default rule still adds DeepSeek behind them') } finally { r.cleanup() }
  r = withKey({ sources: { disabled: ['deepseek'] } })
  try { assert.deepEqual(await r.preferred(DEFAULT), DEFAULT, 'sources.disabled') } finally { r.cleanup() }
  r = withKey({ evidence: { sourcePolicy: 'anonymous-only' } })
  try { assert.deepEqual(await r.preferred(DEFAULT), DEFAULT, 'anonymous-only') } finally { r.cleanup() }
  r = withKey({ engines: ['ddg', 'bing'] })
  try { assert.deepEqual(await r.preferred(['ddg', 'bing']), ['ddg', 'bing'], 'a list the user wrote is not touched') } finally { r.cleanup() }
  r = withKey({ engines: ['ddg', 'deepseek'] })
  try { assert.deepEqual(await r.preferred(['ddg', 'deepseek']), ['ddg', 'deepseek'], 'and keeps the position given to DeepSeek in it') } finally { r.cleanup() }
})

test('router end to end: with a key a plain search answers from DeepSeek first and books the request; explicit engines bypass it; the status shows 常用, key found, no key text', async t => {
  t.mock.method(dns, 'lookup', PUBLIC)
  const realFetch = globalThis.fetch
  const calls: string[] = []
  globalThis.fetch = (async (url: unknown, init: RequestInit) => {
    calls.push(String(url))
    assert.equal((init.headers as Record<string, string>).authorization, 'Bearer ' + KEY)
    return reply(200, live('deepseek-search.json').body)
  }) as typeof fetch
  const h = routerFor({}, { DEEPSEEK_API_KEY: KEY })
  try {
    const r = await h.router.search({ query: 'postgres slot lag', count: 3, fresh: true, multi: false, signal: undefined })
    assert.equal(r.engine, 'deepseek')
    assert.deepEqual(calls, ['https://api.deepseek.com/v1/tools/search'])
    assert.equal(r.sources.length, 3)
    assert.ok(r.sources.every(s => typeof (s as { rerankScore?: number }).rerankScore === 'number'), 'the provider\'s grades reach the result')
    assert.deepEqual(new UsageLedger(h.store, resolveBudget().caps).today().providers.map(p => [p.provider, p.requests]), [['deepseek-search', 1]])
    const report = await h.router.providerReport()
    const ds = report.find(x => x.route === 'deepseek')!
    assert.deepEqual([ds.common, ds.readiness.credential, ds.readiness.available, ds.unverified, ds.costTier], [true, 'configured', true, undefined, 'paid'])
    const { commonSources } = await import('../src/actions/sources.ts')
    assert.deepEqual(commonSources(report), { common: [{ id: 'deepseek', label: 'DeepSeek Search', ready: true }] })
    assert.ok(!JSON.stringify(report).includes(KEY), 'the status shows no key')
  } finally { globalThis.fetch = realFetch; h.cleanup() }
  const bare = routerFor({})
  try {
    const report = await bare.router.providerReport()
    const ds = report.find(x => x.route === 'deepseek')!
    assert.deepEqual([ds.common, ds.readiness.credential, ds.readiness.available], [true, 'missing', false])
    assert.match(ds.readiness.reason!, /no DeepSeek API key \(set \$DEEPSEEK_API_KEY/)
    const { commonSources } = await import('../src/actions/sources.ts')
    const c = commonSources(report).common![0]!
    assert.deepEqual([c.id, c.ready], ['deepseek', false])
    assert.match(c.setup!, /set \$DEEPSEEK_API_KEY \(or a DSH credentials ref \/ the settings key field\)/)
  } finally { bare.cleanup() }
})

test('per-source request budget applies to it: the request is reserved before sending, a used-up budget skips the source (a note, not an error)', async t => {
  t.mock.method(dns, 'lookup', PUBLIC)
  const realFetch = globalThis.fetch
  let sent = 0
  globalThis.fetch = (async () => { sent++; return reply(200, live('deepseek-search.json').body) }) as typeof fetch
  const h = routerFor({ engines: ['deepseek'], sources: { budget: { deepseek: { total: 1 } } } }, { DEEPSEEK_API_KEY: KEY })
  try {
    const first = await h.router.search({ query: 'one', count: 3, fresh: true, multi: false, signal: undefined })
    assert.equal(first.engine, 'deepseek')
    const status = h.router.requestBudgetOf('deepseek')!
    assert.deepEqual([status.total?.used, status.total?.remaining, status.exhausted], [1, 0, true])
    const second = await h.router.search({ query: 'two', count: 3, fresh: true, multi: false, signal: undefined })
    assert.equal(sent, 1, 'the second call never reached the API')
    assert.equal(second.sources.length, 0)
    assert.match(JSON.stringify(second), /request budget used up/)
    const report = (await h.router.providerReport()).find(x => x.route === 'deepseek')!
    assert.equal(report.budget?.exhausted, true)
  } finally { globalThis.fetch = realFetch; h.cleanup() }
})

// ── recommend ────────────────────────────────────────────────────────────────

test('search.recommend marks 常用 and ranks the configured one first; without a key it is a setup step that says where the key goes', () => {
  const catalog = loadCatalog()
  const READY: ProviderStatus = { state: 'ready', credential: 'not_required' }
  const providers = (keys: string[]): Map<string, ProviderStatus> => new Map([
    ['ddg', READY], ['bing', READY], ['github', READY], ['wikipedia', READY], ['stackexchange', READY], ['seam', READY],
    ['exa', { state: 'ready', credential: 'missing' }], ['bocha', { state: 'unavailable', credential: 'missing', reason: 'no key' }],
    ...KEYED.filter(id => !['jina', 'bocha'].includes(id)).map(id => [id, keys.includes(id) ? { state: 'ready', credential: 'configured' } : { state: 'unavailable', credential: 'missing', reason: 'no DeepSeek API key (set $DEEPSEEK_API_KEY)' }] as [string, ProviderStatus]),
  ])
  const ctx = (keys: string[]) => ({ catalog, providers: providers(keys), cli: new Map<string, boolean>(), browser: false, hasEnv: (n: string) => keys.includes('deepseek') && n === 'DEEPSEEK_API_KEY' || keys.includes('tavily') && n === 'TAVILY_API_KEY', hasConfig: () => false })
  for (const task of [EN, ZH]) {
    const withKey = recommendSources({ ...task, profile: 'general' }, ctx(['deepseek', 'tavily']))
    const first = withKey.picks.find(p => p.executable && ['deepseek', 'tavily'].includes(p.id))!
    assert.equal(first.id, 'deepseek', 'configured: the common source leads the other configured one')
    assert.deepEqual([first.common, first.status, first.costTier], [true, 'ready', 'paid'])
    assert.match(renderRecommendation(withKey), /DeepSeek Search API \[deepseek\] ready, paid, 常用 \(common\)/)
  }
  // Without a key it is a setup step like any paid source: free ones are offered first (the existing policy), so it is not forced into
  // the three picks, but asking for it by name says exactly where the key goes.
  for (const task of [EN, ZH]) {
    const bare = recommendSources({ ...task, profile: 'general' }, ctx([]))
    assert.ok(!bare.picks.some(p => p.id === 'deepseek' && p.executable))
    const named = recommendSources({ ...task, profile: 'general', platform: 'deepseek' }, ctx([]))
    assert.deepEqual(named.picks.map(p => [p.id, p.status, p.executable, p.common]), [['deepseek', 'needs_setup', false, true]])
    assert.match(named.picks[0]!.missing![0]!, /^key: set DEEPSEEK_API_KEY/)
    assert.match(named.picks[0]!.setup!, /platform\.deepseek\.com and set DEEPSEEK_API_KEY \(or a DSH credential \/ the settings key field\)/)
  }
})

// ── signals: metadata and a small fusion weight ──────────────────────────────

test('signals: candidates keep the best grade over providers; the fusion weight is a fraction of one rank step, never lifts a rank-10 result over rank-1, and does nothing for ungraded URLs', () => {
  assert.equal(PROVIDER_SIGNAL_BOOST, 0.3)
  assert.equal(providerSignal({}), 0)
  assert.equal(providerSignal({ signals: { rerankScore: 3, authority: 4 } }), 1)
  assert.equal(providerSignal({ signals: { rerankScore: 3 } }), 1, 'one signal alone')
  assert.equal(providerSignal({ signals: { authority: 2 } }), 0.5)
  assert.ok(Math.abs(providerSignal({ signals: { rerankScore: 1.5, authority: 4 } }) - (0.7 * 0.5 + 0.3)) < 1e-12)
  assert.equal(providerSignal({ signals: { rerankScore: 99, authority: -4 } }), 1, 'clamped')
  const merged = mergeCandidates([
    { providerId: 'deepseek', query: 'q', sources: [{ url: 'https://a.test/x', title: 'A', snippet: 's', rerankScore: 1.2, authority: 2 }, { url: 'https://b.test/y', title: 'B' }] },
    { providerId: 'ddg', query: 'q', sources: [{ url: 'https://a.test/x', title: 'A' }, { url: 'https://b.test/y', rerankScore: 2.5, authority: 1 }, { url: 'https://c.test/z', rerankScore: 0.5 }] },
    { providerId: 'bing', query: 'q', sources: [{ url: 'https://b.test/y', authority: 4, rerankScore: 1 }] },
  ])
  assert.deepEqual(merged.map(c => c.signals), [{ rerankScore: 1.2, authority: 2 }, { rerankScore: 2.5, authority: 4 }, { rerankScore: 0.5 }], 'best per field, never a sum')
  const opts = { k: 60, freshnessBoost: 0.2, freshnessDays: 30, authorityBoost: 0.25, authorityDomains: [] as string[], now: NOW }
  // Rank 10 with the best possible grades does not pass rank 1 without any (one provider): the three bonuses together stay under one rank step.
  const one = mergeCandidates([{ providerId: 'p', query: 'q', sources: Array.from({ length: 10 }, (_, i) => ({ url: `https://h${i}.test/`, title: 't', ...i === 9 ? { rerankScore: 3, authority: 4, publishedAt: NOW.toISOString() } : {} })) }])
  const ranked = fuseCandidates(one, { ...opts, authorityDomains: ['h9.test'] })
  assert.equal(ranked[0]!.candidate.url, 'https://h0.test/')
  assert.ok(ranked[0]!.score > ranked.find(r => r.candidate.url === 'https://h9.test/')!.score)
  const step = (1 / 61 - 1 / 62) * 61 // one rank position on the normalised scale
  const top = ranked.find(r => r.candidate.url === 'https://h9.test/')!
  assert.ok(top.bonus < step, 'all three bonuses at their maximum: ' + top.bonus + ' < ' + step)
  assert.ok(top.bonus > 0.5 * step, 'but it is a real nudge: ' + top.bonus / step + ' of a rank step')
  // Near-ties: the graded URL wins; with signalBoost 0 the order is the old one.
  // Two providers that rank the same two URLs in opposite order tie exactly; the graded URL breaks the tie. Alone it cannot pass the rank above it.
  const tie = mergeCandidates([
    { providerId: 'p1', query: 'q', sources: [{ url: 'https://plain.test/' }, { url: 'https://graded.test/', rerankScore: 2.8, authority: 4 }] },
    { providerId: 'p2', query: 'q', sources: [{ url: 'https://graded.test/' }, { url: 'https://plain.test/' }] },
  ])
  assert.equal(fuseCandidates(tie, opts)[0]!.candidate.url, 'https://graded.test/')
  assert.equal(fuseCandidates(tie, { ...opts, signalBoost: 0 })[0]!.candidate.url, 'https://plain.test/', 'without the signal the tie keeps first-seen order')
  const alone = mergeCandidates([{ providerId: 'p', query: 'q', sources: [{ url: 'https://plain.test/' }, { url: 'https://graded.test/', rerankScore: 3, authority: 4 }] }])
  assert.equal(fuseCandidates(alone, opts)[0]!.candidate.url, 'https://plain.test/', 'rank 1 stays above a rank-2 result with the best possible grade')
  const ungraded = mergeCandidates([{ providerId: 'p', query: 'q', sources: [{ url: 'https://a.test/' }, { url: 'https://b.test/' }] }])
  assert.deepEqual(fuseCandidates(ungraded, opts).map(r => r.bonus), [0, 0], 'no signal, no bonus')
  assert.equal(fuseCandidates(ungraded, opts)[0]!.score, fuseCandidates(ungraded, { ...opts, signalBoost: 1 })[0]!.score)
})

test('signals reach the output: the pack sources and search results carry rerankScore / authority, the schema accepts them, and the text shows them; the engine\'s notes reach the pack notes', async () => {
  const sources = [{ url: 'https://a.test/x', title: 'Postgres replication slot lag', snippet: 'postgres logical replication slot lag explained', rerankScore: 2.2578, authority: 4 }, { url: 'https://b.test/y', title: 'Other', snippet: 'postgres replication slot', rerankScore: 1.1 }]
  const outcome: ProviderOutcome = { state: 'ok', sources, notes: ['deepseek: query cut from 200 to 120 characters (the API takes at most 128); site:/-site:/after: operators were kept'] }
  const deps: PipelineDeps = {
    providerStatus: async list => new Map(list.map(id => [id, { state: 'ready' as const, credential: 'configured' as const }])),
    searchProvider: async () => outcome,
    fetchPage: async () => undefined,
    scorers: {},
    configuredEngines: ['deepseek'],
    fusion: { k: 60, freshnessBoost: 0, freshnessDays: 30, authorityBoost: 0, authorityDomains: [] },
  }
  const { pack } = await runPipeline(spec({ ...EN, profile: 'general' }), deps, { engines: ['deepseek'], maxRounds: 1 })
  const first = pack.sources.find(s => s.url === 'https://a.test/x')!
  assert.deepEqual([first.rerankScore, first.authority], [2.2578, 4])
  assert.deepEqual([pack.sources.find(s => s.url === 'https://b.test/y')!.authority], [undefined])
  assert.ok(pack.notes.some(n => /deepseek: query cut from 200 to 120/.test(n)))
  const shaped = shapeSources(pack.sources, 5)
  assert.deepEqual([shaped[0]!.rerankScore, shaped[0]!.authority], [2.26, 4], 'rounded to two decimals')
  const def = findAction('search.run')!
  assert.deepEqual(checkOutput(def.output, { sources: shaped, engine: 'deepseek', enginesTried: ['deepseek'], fromCache: false }), [])
  assert.match(formatSources(shaped), /\[rerank 2\.26\/3, authority 4\/4\]/)
  assert.match(formatSources(shaped), /\[rerank 1\.1\/3\]/)
  assert.ok(!formatSources(shapeSources([{ url: 'https://c.test/', title: 'C' }], 1)).includes('rerank'))
})

// ── Fetch ────────────────────────────────────────────────────────────────────

test('fetch API: POST {base}/fetch with the url; Markdown content and title come back; 403 / 404 are DeepSeek\'s verdicts, not the target\'s status; success is booked once', async () => {
  const usage: any[] = []
  const calls: { url: string; body: any; auth: string }[] = []
  const fx = live('deepseek-fetch.json')
  const respond = (status: number, body: unknown) => (async (url: unknown, init: RequestInit) => {
    calls.push({ url: String(url), body: JSON.parse(String(init.body)), auth: String((init.headers as Record<string, string>).authorization) })
    return reply(status, body)
  }) as typeof fetch
  const access = (fetchImpl: typeof fetch) => ({ apiKey: KEY, fetchImpl, lookup: PUBLIC, allowProxyFakeIp: false, sleep: async () => {}, usage: { record: (e: unknown) => { usage.push(e) } } })
  const page = await deepseekFetchPage('https://nodejs.org/api/sqlite.html', access(respond(200, fx.body)))
  assert.deepEqual([page.title, page.text.length], [fx.body.title, fx.body.content.length])
  assert.deepEqual(calls[0], { url: 'https://api.deepseek.com/v1/tools/fetch', body: { url: 'https://nodejs.org/api/sqlite.html' }, auth: 'Bearer ' + KEY })
  assert.deepEqual(usage, [{ provider: 'deepseek-fetch', protocol: 'fetch', requests: 1, note: 'tokens n/a, $0.75 per 1,000 successful requests' }])
  const denied = await deepseekFetchPage('http://localhost/', access(respond(403, { error: { message: 'url blocked by security policy' } }))).catch(e => e)
  assert.ok(denied instanceof DeepSeekFetchError)
  assert.deepEqual([denied.code, denied.retryable], ['DEEPSEEK_FETCH_DENIED', false])
  assert.match(denied.message, /refused this URL under its security policy \(DeepSeek's decision, not the target page's HTTP status; HTTP 403: url blocked by security policy\)/)
  const missing = await deepseekFetchPage('https://example.com/nope', access(respond(404, errorBody('404').body))).catch(e => e)
  assert.equal(missing.code, 'DEEPSEEK_FETCH_NO_CONTENT')
  assert.match(missing.message, /got no usable content \(DeepSeek's result, not the target page's HTTP status; HTTP 404: failed to fetch URL\)\. The URL may be unavailable.*\[request_id 00000000-0000-0000-0000-000000000000\]$/)
  assert.equal(usage.length, 1, 'refusals are not booked')
  assert.equal((await deepseekFetchPage('https://x.test/', access(respond(200, { title: '', content: '   ' }))).catch(e => e)).code, 'DEEPSEEK_FETCH_NO_CONTENT', 'empty content is a failure and not booked')
  assert.equal(usage.length, 1)
  assert.equal((await deepseekFetchPage('https://x.test/' + 'a'.repeat(9000), access(respond(200, fx.body))).catch(e => e)).code, 'DEEPSEEK_FETCH_ERROR', 'URLs over 8,192 characters are refused locally')
  assert.equal(deepseekFetchFailure(401, new Headers(), {}, KEY).code, 'DEEPSEEK_FETCH_AUTH')
  assert.match(deepseekFetchFailure(402, new Headers(), {}).message, /余额不足/)
  assert.equal(deepseekFetchFailure(500, new Headers(), {}).retryable, true)
  // retried like Search: 429 then 200
  let i = 0
  const waits: number[] = []
  const flaky = (async () => (i++ === 0 ? reply(429, { error: { message: 'slow' } }, { 'retry-after': '1' }) : reply(200, fx.body))) as typeof fetch
  const ok = await deepseekFetchPage('https://nodejs.org/', { ...access(flaky), sleep: async ms => { waits.push(ms) } })
  assert.deepEqual([ok.text.length > 0, waits], [true, [1000]])
})

const PROSE = 'The busy timeout of a SQLite connection decides how long a writer waits for a lock before it fails with SQLITE_BUSY. Setting it to a few seconds avoids most spurious failures in applications that write from several processes at once, while a very long timeout hides real contention and makes the application look hung when another process holds the write lock for a long time.'

function fetchHarness(over: Record<string, unknown>, access: 'key' | 'none' = 'key', deepseekReply: (n: number) => Response = () => reply(200, { title: 'From DeepSeek', content: PROSE })) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wsp-deepseek-fetch-'))
  const config = resolveConfig({ dbPath: path.join(dir, 'store.db'), ttlSeconds: 60, playwright: { enabled: false }, allowProxyFakeIp: true, ...over } as never)
  const store = new Store(config.dbPath)
  const api: { url: string; body: any }[] = []
  const fetchImpl = (async (url: unknown, init: RequestInit) => { api.push({ url: String(url), body: JSON.parse(String(init.body)) }); return deepseekReply(api.length) }) as typeof fetch
  const svc = new FetchService(store, config as never, (() => undefined) as never, async () => access === 'key' ? { apiKey: KEY, fetchImpl, lookup: PUBLIC, allowProxyFakeIp: false, sleep: async () => {}, usage: { record: () => {} } } : undefined)
  const originalLookup = dns.lookup
  const originalFetch = globalThis.fetch
  const net = { jina: 0, http: 0, jinaBody: undefined as string | undefined, httpBody: undefined as string | undefined }
  dns.lookup = (async () => [{ address: '93.184.216.34', family: 4 }]) as typeof dns.lookup
  globalThis.fetch = (async (input: any) => {
    const u = String(input?.url ?? input)
    if (u.startsWith('https://r.jina.ai/')) { net.jina++; return net.jinaBody === undefined ? new Response('err', { status: 500 }) : new Response(net.jinaBody) }
    net.http++
    if (net.httpBody === undefined) throw new TypeError('fetch failed')
    return new Response(net.httpBody, { headers: { 'content-type': 'text/plain' } })
  }) as typeof fetch
  return { svc, api, net, cleanup: () => { dns.lookup = originalLookup; globalThis.fetch = originalFetch; store.close(); fs.rmSync(dir, { recursive: true, force: true }) } }
}
const opts = (over: Record<string, unknown> = {}) => ({ mode: 'auto' as const, signal: undefined, maxChars: 20_000, fresh: true, persist: false, ...over })

test('fetch backend: off by default (auto never calls it, explicit mode=deepseek says why); on, it runs after the free backends found nothing and before the browser, without a made-up status code', async () => {
  const off = fetchHarness({})
  try {
    // Jina and HTTP both fail, DeepSeek Fetch is off: the old outcome (all backends failed), and not a single API request.
    await assert.rejects(off.svc.fetchPage('https://docs.test/a', opts()), /all fetch backends failed/)
    assert.equal(off.api.length, 0)
    await assert.rejects(off.svc.fetchPage('https://docs.test/a', opts({ mode: 'deepseek' })), /DeepSeek Fetch is off: it is billed/)
    assert.equal(off.api.length, 0)
  } finally { off.cleanup() }
  const on = fetchHarness({ deepseekFetch: true })
  try {
    const page = await on.svc.fetchPage('https://docs.test/a', opts())
    assert.equal(page.source, 'deepseek')
    assert.equal(page.title, 'From DeepSeek')
    assert.equal(page.statusCode, undefined, 'the API reports no target status: none is claimed')
    assert.equal(page.shellPage, undefined)
    assert.deepEqual(page.attempts!.map(a => a.source + ':' + a.class), ['jina:error', 'http:error', 'deepseek:content'])
    assert.deepEqual(on.api, [{ url: 'https://api.deepseek.com/v1/tools/fetch', body: { url: 'https://docs.test/a' } }])
  } finally { on.cleanup() }
  const free = fetchHarness({ deepseekFetch: true })
  try {
    free.net.jinaBody = '# Docs\n\n' + PROSE
    const page = await free.svc.fetchPage('https://docs.test/b', opts())
    assert.equal(page.source, 'jina')
    assert.equal(free.api.length, 0, 'a free backend produced content: the paid one is not called')
  } finally { free.cleanup() }
  const explicit = fetchHarness({ deepseekFetch: true })
  try {
    explicit.net.jinaBody = '# Docs\n\n' + PROSE
    const page = await explicit.svc.fetchPage('https://docs.test/c', opts({ mode: 'deepseek' }))
    assert.deepEqual([page.source, explicit.net.jina, explicit.net.http, explicit.api.length], ['deepseek', 0, 0, 1], 'mode=deepseek runs only that backend')
  } finally { explicit.cleanup() }
})

test('fetch backend failures: 403 / 404 become a recorded failed attempt that says they are DeepSeek\'s verdict; explicit mode throws the coded error; no key says where to put it', async () => {
  const denied = fetchHarness({ deepseekFetch: true }, 'key', () => reply(403, { error: { message: 'blocked by policy' } }))
  try {
    await assert.rejects(denied.svc.fetchPage('https://docs.test/a', opts()), /all fetch backends failed/)
    const err = await denied.svc.fetchPage('https://docs.test/a', opts({ mode: 'deepseek' })).catch(e => e)
    assert.ok(err instanceof DeepSeekFetchError)
    assert.equal(err.code, 'DEEPSEEK_FETCH_DENIED')
    const { mapError } = await import('../src/actions/errors.ts')
    const body = mapError(err)
    assert.equal(body.code, 'ACTION_FAILED')
    assert.match(body.message, /not the target page's HTTP status/)
    assert.match(body.hint!, /DeepSeek's answer, not the page's own status/)
  } finally { denied.cleanup() }
  // auto mode with a browser-less setup: jina content missing, deepseek 404 -> the attempt detail carries the verdict
  const missing = fetchHarness({ deepseekFetch: true }, 'key', () => reply(404, errorBody('404').body))
  try {
    missing.net.httpBody = '' // an empty page from the direct request: a result exists, so the attempts can be inspected
    const page = await missing.svc.fetchPage('https://docs.test/b', opts())
    assert.deepEqual(page.attempts!.map(a => a.source + ':' + a.class), ['jina:error', 'http:js_shell', 'deepseek:error'])
    assert.match(page.attempts![2]!.detail!, /got no usable content \(DeepSeek's result, not the target page's HTTP status; HTTP 404/, 'the verdict survives the 160-character cut of attempt details')
    assert.equal(page.shellPage, true, 'the best attempt is returned flagged, as for any other failed backend')
  } finally { missing.cleanup() }
  const nokey = fetchHarness({ deepseekFetch: true }, 'none')
  try {
    await assert.rejects(nokey.svc.fetchPage('https://docs.test/a', opts({ mode: 'deepseek' })), /DeepSeek Fetch has no API key: set \$DEEPSEEK_API_KEY, a DSH credentials ref or the DeepSeek key in the plugin settings/)
    assert.equal(nokey.api.length, 0)
  } finally { nokey.cleanup() }
})

test('the read.fetch action offers mode=deepseek and rejects other modes; the router resolves the Fetch key like the search key (settings literal, credentials ref, environment) and not at all without one', async () => {
  const action = findAction('read.fetch')!
  assert.ok((action.params.mode as { enum?: string[] }).enum!.includes('deepseek'))
  const none = routerFor({})
  try { assert.equal(await none.router.deepseekAccess(), undefined) } finally { none.cleanup() }
  const env = routerFor({ allowProxyFakeIp: true, keyedSources: { deepseek: { baseUrl: 'https://gw.example.test/v1/tools' } } }, { DEEPSEEK_API_KEY: KEY })
  try {
    const access = await env.router.deepseekAccess()
    assert.deepEqual([access?.apiKey, access?.baseUrl, access?.allowProxyFakeIp], [KEY, 'https://gw.example.test/v1/tools', true])
  } finally { env.cleanup() }
  const cred = routerFor({}, {}, ref => ref === 'DEEPSEEK_API_KEY' ? KEY : undefined)
  try { assert.equal((await cred.router.deepseekAccess())?.apiKey, KEY) } finally { cred.cleanup() }
})

// ── nothing leaks ────────────────────────────────────────────────────────────

test('the key is in no log line, note, ledger row, status output or error of a search that fails, retries and succeeds', async t => {
  t.mock.method(dns, 'lookup', PUBLIC)
  const realFetch = globalThis.fetch
  const logged: string[] = []
  for (const m of ['log', 'info', 'warn', 'error', 'debug'] as const) t.mock.method(console, m, (...a: unknown[]) => { logged.push(a.map(String).join(' ')) })
  let n = 0
  globalThis.fetch = (async () => (++n === 1 ? reply(503, { error: { message: 'busy, key was ' + KEY } }) : reply(200, live('deepseek-search.json').body))) as typeof fetch
  const h = routerFor({ engines: ['deepseek'] }, { DEEPSEEK_API_KEY: KEY })
  try {
    const out = await h.router.search({ query: 'x'.repeat(200) + ' site:postgresql.org', count: 3, fresh: true, multi: false, signal: undefined, engines: ['deepseek'] })
    const status = await h.router.providerReport()
    const rows = h.store.listQueries({ kind: 'search', limit: 10 })
    const everything = JSON.stringify({ out, status, rows, ledger: new UsageLedger(h.store, resolveBudget().caps).today(), logged })
    assert.ok(!everything.includes(KEY), 'no key anywhere')
    assert.equal(n, 2)
    assert.match(JSON.stringify(out), /query cut from/)
  } finally { globalThis.fetch = realFetch; h.cleanup() }
})
