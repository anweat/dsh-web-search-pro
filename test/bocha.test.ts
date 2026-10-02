import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { EngineError, type EngineDeps } from '../src/engines.ts'
import { BackendRegistry } from '../src/backend-registry.ts'
import {
  bochaEngine, bochaFailure, bochaRequestBody, joinSites, mapBochaPages, parseBochaResponse, parseRetryAfter, BOCHA_USAGE_PROVIDER,
} from '../src/providers/bocha.ts'
import { compileQuery, compileBocha } from '../src/pipeline/compile.ts'
import { SearchRouter } from '../src/router.ts'
import { resolveConfig } from '../src/config.ts'
import { resolveBudget, UsageLedger } from '../src/pipeline/ledger.ts'
import { Store } from '../src/store.ts'
import type { Constraint } from '../src/pipeline/types.ts'

const fixture = (name: string): any => JSON.parse(fs.readFileSync(new URL('./fixtures/' + name, import.meta.url), 'utf8'))
const SUCCESS = fixture('bocha-web-search.json')
const QUOTA = fixture('bocha-quota-403.json')
const KEY = 'sk-test-bocha-secret-0001'

interface Call { url: string; init: RequestInit; body: any }
const reply = (status: number, body: unknown, headers: Record<string, string> = {}): Response =>
  new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } })

function engine(respond: (call: Call) => Response | Promise<Response>, deps: Partial<EngineDeps> = {}) {
  const calls: Call[] = []
  const usage: unknown[] = []
  const fetchImpl = (async (url: unknown, init: RequestInit) => {
    const call: Call = { url: String(url), init, body: JSON.parse(String(init.body)) }
    calls.push(call)
    return respond(call)
  }) as typeof fetch
  const e = bochaEngine({ bochaApiKey: KEY, fetchImpl, usage: { record: entry => { usage.push(entry) } }, enableCli: false, opencliEnabled: false, agentReachEnabled: false, allowProxyFakeIp: false, skipSeam: false, ...deps })
  return { e, calls, usage }
}

const hard = (id: string, kind: Constraint['kind'], value: string, strength: Constraint['strength'] = 'hard'): Constraint => ({ id, kind, value, strength, origin: 'param' })
const task = (constraints: Constraint[], query = '博查 搜索') => ({ goal: query, query, needs: [{ id: 'n1', text: query, critical: true }], constraints })

// ── mapping ──────────────────────────────────────────────────────────────────

test('bocha mapping (contract fixture): summary over snippet, title, publishedAt; URL-less and non-http entries dropped', () => {
  const sources = parseBochaResponse(SUCCESS.body, 10)
  assert.deepEqual(sources.map(s => s.url), ['https://open.bochaai.com/', 'https://example.test/docs/web-search', 'https://news.example.test/a?utm=1'])
  assert.equal(sources[0]!.title, '博查 AI 开放平台')
  assert.match(sources[0]!.snippet!, /^博查提供面向 AI 的网页搜索 API/, 'the summary wins over the short snippet')
  assert.equal(sources[0]!.publishedAt, '2026-08-14T08:00:00+08:00')
  assert.equal(sources[1]!.snippet, '请求参数 query、freshness、summary、count。', 'no summary: the snippet')
  assert.ok(!('publishedAt' in sources[1]!), 'null date omitted')
  assert.equal(sources[2]!.snippet, '只有简短 snippet，没有 summary。', 'blank summary falls back')
  assert.equal(parseBochaResponse(SUCCESS.body, 2).length, 2, 'bounded by count')
  // the envelope-less shape (webPages at the top level) is tolerated too
  assert.equal(parseBochaResponse({ webPages: { value: [{ url: 'https://a.test/' }] } }, 5).length, 1)
  assert.equal(mapBochaPages([{ url: 'https://a.test/', summary: 'x'.repeat(5000) }], 1)[0]!.snippet!.length, 1001, 'cut at 1000 characters plus an ellipsis')
})

test('bocha: an empty or missing result list is ENGINE_EMPTY; a malformed one is a retryable ENGINE_ERROR', () => {
  for (const body of [{ code: 200, data: { webPages: { value: [] } } }, { code: 200 }, { code: 200, data: { webPages: null } }]) {
    assert.throws(() => parseBochaResponse(body, 5), (e: any) => e instanceof EngineError && e.code === 'ENGINE_EMPTY' && e.retryable)
  }
  for (const body of [null, [], { data: { webPages: { value: {} } } }]) {
    assert.throws(() => parseBochaResponse(body, 5), (e: any) => e instanceof EngineError && e.code === 'ENGINE_ERROR')
  }
})

// ── request ──────────────────────────────────────────────────────────────────

test('bocha request: bearer key, documented body fields, native options, count bound; the key stays out of the body and errors', async () => {
  const { e, calls, usage } = engine(() => reply(200, SUCCESS.body))
  const out = await e.search('博查 搜索', 5, undefined, { bocha: { freshness: '2026-01-01..2026-10-02', include: ['Open.BochaAI.com', 'bad host', 'a.test', 'a.test'], exclude: ['spam.example'] } })
  assert.equal(out.sources.length, 3)
  const [call] = calls
  assert.equal(call!.url, 'https://api.bochaai.com/v1/web-search')
  assert.equal(call!.init.method, 'POST')
  assert.equal(call!.init.redirect, 'error')
  assert.equal((call!.init.headers as Record<string, string>).authorization, 'Bearer ' + KEY)
  assert.deepEqual(call!.body, { query: '博查 搜索', count: 5, summary: true, freshness: '2026-01-01..2026-10-02', include: 'open.bochaai.com|a.test', exclude: 'spam.example' })
  assert.ok(!JSON.stringify(call!.body).includes(KEY))
  assert.deepEqual(usage, [{ provider: BOCHA_USAGE_PROVIDER, protocol: 'search', requests: 1, note: 'tokens n/a, price unknown' }])

  await e.search('big', 500)
  assert.equal(calls[1]!.body.count, 50)
  assert.ok(!('freshness' in calls[1]!.body) && !('include' in calls[1]!.body), 'unset options are omitted')
  assert.deepEqual(bochaRequestBody('q', 0, false, undefined), { query: 'q', count: 1, summary: false })
  assert.equal(joinSites(['a.test', 'not a domain', '']), 'a.test')
  assert.equal(joinSites(Array.from({ length: 150 }, (_, i) => 'h' + i + '.test'))!.split('|').length, 100)

  const custom = engine(() => reply(200, SUCCESS.body), { bochaBaseUrl: 'https://api.bocha.cn/', bochaSummary: false })
  await custom.e.search('q', 3)
  assert.equal(custom.calls[0]!.url, 'https://api.bocha.cn/v1/web-search')
  assert.equal(custom.calls[0]!.body.summary, false)
})

test('bocha: no key is a non-retryable ENGINE_UNAVAILABLE; a private base URL is refused before any request', async () => {
  const none = engine(() => reply(200, SUCCESS.body), { bochaApiKey: '' })
  assert.equal(none.e.available(), false)
  await assert.rejects(none.e.search('q', 3), (e: any) => e.code === 'ENGINE_UNAVAILABLE' && e.retryable === false && !e.message.includes(KEY))
  const bad = engine(() => reply(200, SUCCESS.body), { bochaBaseUrl: 'http://127.0.0.1:9' })
  await assert.rejects(bad.e.search('q', 3), (e: any) => e.code === 'ENGINE_UNAVAILABLE' && /base URL/.test(e.message))
  assert.equal(bad.calls.length, 0)
})

// ── errors ───────────────────────────────────────────────────────────────────

test('bocha errors: 401 and the live 403 are non-retryable (no cooldown), 429 honours Retry-After, 5xx is retryable', async () => {
  const auth = engine(() => reply(401, { code: 401, msg: 'invalid api key', log_id: 'L1' }))
  await assert.rejects(auth.e.search('q', 3), (e: any) => e.code === 'ENGINE_AUTH' && e.retryable === false && /invalid api key \(log_id: L1\)/.test(e.message) && !e.message.includes(KEY))

  // The recorded live answer: HTTP 403, `code` is the STRING "403".
  const quota = engine(() => reply(QUOTA.status, QUOTA.body))
  await assert.rejects(quota.e.search('q', 3), (e: any) => e.code === 'ENGINE_QUOTA' && e.retryable === false && /enough money or package quota/.test(e.message) && /log_id: 9a4c880abc39956b/.test(e.message))
  assert.equal(quota.usage.length, 0, 'a refused request is not counted')

  const forbidden = engine(() => reply(403, { message: 'forbidden', code: '403' }))
  await assert.rejects(forbidden.e.search('q', 3), (e: any) => e.code === 'ENGINE_AUTH' && e.retryable === false)

  const limited = engine(() => reply(429, { code: 429, msg: 'too many requests' }, { 'retry-after': '7' }))
  await assert.rejects(limited.e.search('q', 3), (e: any) => e.code === 'ENGINE_RATE_LIMIT' && e.retryable === true && e.retryAfterMs === 7000 && /retry after 7s/.test(e.message))
  assert.equal(limited.usage.length, 0)

  const down = engine(() => reply(503, 'upstream down'))
  await assert.rejects(down.e.search('q', 3), (e: any) => e.code === 'ENGINE_ERROR' && e.retryable === true && /HTTP 503/.test(e.message))
  const badRequest = engine(() => reply(400, { code: 400, msg: 'freshness invalid' }))
  await assert.rejects(badRequest.e.search('q', 3), (e: any) => e.code === 'ENGINE_ERROR' && e.retryable === false && /freshness invalid/.test(e.message))
})

test('bocha: provider-declared failures inside a 200 envelope map like HTTP ones (string or number code); bad JSON is retryable', async () => {
  assert.throws(() => parseBochaResponse({ code: '401', msg: 'invalid key' }, 3), (e: any) => e.code === 'ENGINE_AUTH')
  assert.throws(() => parseBochaResponse({ code: 429, msg: 'slow down' }, 3), (e: any) => e.code === 'ENGINE_RATE_LIMIT')
  assert.throws(() => parseBochaResponse({ code: 500 }, 3), (e: any) => e.code === 'ENGINE_ERROR' && e.retryable)
  const junk = engine(() => reply(200, 'not json'))
  await assert.rejects(junk.e.search('q', 3), (e: any) => e.code === 'ENGINE_ERROR' && /invalid JSON/.test(e.message))
  assert.equal(junk.usage.length, 1, 'a 2xx answer was a billed request')
  const empty = engine(() => reply(200, { code: 200, data: { webPages: { value: [] } } }))
  await assert.rejects(empty.e.search('q', 3), (e: any) => e.code === 'ENGINE_EMPTY')
  assert.equal(empty.usage.length, 1)
  assert.equal(parseRetryAfter('120'), 120_000)
  assert.equal(parseRetryAfter('Fri, 02 Oct 2026 12:00:30 GMT', Date.parse('2026-10-02T12:00:00Z')), 30_000)
  assert.equal(parseRetryAfter('soon'), undefined)
  assert.equal(parseRetryAfter(null), undefined)
  assert.equal(bochaFailure(429, {}).retryAfterMs, undefined)
})

test('bocha: a network failure is retryable, a caller abort is rethrown untouched, a timeout is ENGINE_TIMEOUT', async () => {
  const down = engine(() => { throw new TypeError('fetch failed') })
  await assert.rejects(down.e.search('q', 3), (e: any) => e.code === 'ENGINE_ERROR' && e.retryable === true)
  const controller = new AbortController()
  const slow = engine(call => new Promise<Response>((_, reject) => { (call.init.signal as AbortSignal).addEventListener('abort', () => reject((call.init.signal as AbortSignal).reason)) }))
  const pending = slow.e.search('q', 3, controller.signal)
  controller.abort(new DOMException('cancelled', 'AbortError'))
  await assert.rejects(pending, (e: any) => e.name === 'AbortError')
})

test('bocha cooldown semantics: auth / quota never cool the engine down; a 429 cools it for the Retry-After the service gave', async () => {
  const run = async (respond: () => Response) => {
    const { e, calls } = engine(respond)
    const registry = new BackendRegistry<void, unknown>({ cooldownMs: 30_000 })
    registry.register({ id: 'bocha', probe: () => ({ available: true }), run: () => e.search('q', 3) })
    for (let i = 0; i < 2; i++) await registry.run(undefined, { preferred: ['bocha'] }).catch(() => undefined)
    return { calls: calls.length, diag: registry.diagnostics()[0]! }
  }
  const auth = await run(() => reply(401, { msg: 'no' }))
  assert.deepEqual([auth.calls, auth.diag.state], [2, 'ready'], 'the second call ran: no cooldown')
  const quota = await run(() => reply(403, QUOTA.body))
  assert.deepEqual([quota.calls, quota.diag.state], [2, 'ready'])
  const limited = await run(() => reply(429, { msg: 'slow' }, { 'retry-after': '120' }))
  assert.deepEqual([limited.calls, limited.diag.state], [1, 'cooldown'], 'the second call was skipped')
  const wait = Date.parse(limited.diag.cooldownUntil!) - Date.now()
  assert.ok(wait > 100_000 && wait <= 120_500, 'cooldown follows Retry-After, not the 30 s default: ' + wait)
})

// ── native compilation ───────────────────────────────────────────────────────

test('bocha compile: hard site / exclude_site / time_window go native, the rest stays local and is reported', () => {
  const now = new Date('2026-10-02T09:00:00Z')
  const c = compileQuery(task([
    hard('c1', 'site', 'https://www.Gov.cn/news'), hard('c2', 'exclude_site', 'spam.example'), hard('c3', 'time_window', '最近一周'),
    hard('c4', 'exclude_term', '广告'), hard('c5', 'must_term', '博查'), hard('c6', 'site', 'example.org', 'soft'),
  ]), 'bocha', now)
  assert.equal(c.query, '博查 搜索', 'no operators are added to the text')
  assert.deepEqual(c.options, { bocha: { include: ['gov.cn'], exclude: ['spam.example'], freshness: '2026-09-25..2026-10-02' } })
  assert.deepEqual(c.native.sort(), ['c1', 'c2', 'c3'])
  assert.deepEqual(c.local.sort(), ['c4', 'c5', 'c6'], 'soft and unsupported constraints are verified locally')

  const year = compileBocha(task([hard('y', 'time_window', '2025 年以后')]), 'bocha', now)
  assert.equal(year.options!.bocha!.freshness, '2025-01-01..2026-10-02')
  const strictest = compileBocha(task([hard('a', 'time_window', '2024'), hard('b', 'time_window', '最近一个月')]), 'bocha', now)
  assert.equal(strictest.options!.bocha!.freshness, '2026-09-02..2026-10-02')
  assert.deepEqual(strictest.native.sort(), ['a', 'b'])
  const unknown = compileBocha(task([hard('u', 'time_window', '某个时候')]), 'bocha', now)
  assert.equal(unknown.options, undefined)
  assert.deepEqual([unknown.native, unknown.local], [[], ['u']])
  assert.equal(compileBocha(task([]), 'bocha', now).options, undefined)
})

// ── router wiring: key resolution, usage ledger, registry id ─────────────────

async function withRouter(env: Record<string, string | undefined>, fn: (h: { router: SearchRouter; store: Store; fetched: Call[]; dir: string }) => Promise<void>, over: Record<string, unknown> = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wsp-bocha-router-'))
  const saved: Record<string, string | undefined> = {}
  for (const k of ['BOCHA_SEARCH_API_KEY', 'BOCHA_JEV_API_KEY', 'MY_BOCHA_KEY']) { saved[k] = process.env[k]; delete process.env[k] }
  Object.assign(process.env, Object.fromEntries(Object.entries(env).filter(([, v]) => v !== undefined)))
  const realFetch = globalThis.fetch
  const fetched: Call[] = []
  globalThis.fetch = (async (url: unknown, init: RequestInit) => { const call = { url: String(url), init, body: JSON.parse(String(init.body)) }; fetched.push(call); return reply(200, SUCCESS.body) }) as typeof fetch
  const config = resolveConfig({ dbPath: path.join(dir, 'store.db'), engines: ['bocha'], enableCliBackends: false, opencliEnabled: false, agentReachEnabled: false, ...over } as never)
  const store = new Store(config.dbPath)
  const router = new SearchRouter({ get: () => undefined } as never, config, store)
  try { await fn({ router, store, fetched, dir }) } finally {
    globalThis.fetch = realFetch
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v }
    store.close()
    fs.rmSync(dir, { recursive: true, force: true })
  }
}

test('router: the search key wins, the Jev key of the same account is the documented fallback, the env name is configurable', async () => {
  await withRouter({ BOCHA_SEARCH_API_KEY: 'search-key', BOCHA_JEV_API_KEY: 'jev-key' }, async ({ router, fetched }) => {
    await router.search({ query: '博查', count: 3, fresh: true, multi: false, signal: undefined })
    assert.equal((fetched[0]!.init.headers as Record<string, string>).authorization, 'Bearer search-key')
  })
  await withRouter({ BOCHA_JEV_API_KEY: 'jev-key' }, async ({ router, fetched }) => {
    const result = await router.search({ query: '博查', count: 3, fresh: true, multi: false, signal: undefined })
    assert.equal(result.engine, 'bocha')
    assert.equal((fetched[0]!.init.headers as Record<string, string>).authorization, 'Bearer jev-key')
  })
  await withRouter({ MY_BOCHA_KEY: 'mine', BOCHA_JEV_API_KEY: 'jev-key' }, async ({ router, fetched }) => {
    await router.search({ query: '博查', count: 3, fresh: true, multi: false, signal: undefined })
    assert.equal((fetched[0]!.init.headers as Record<string, string>).authorization, 'Bearer mine')
  }, { bochaApiKeyEnv: 'MY_BOCHA_KEY' })
  await withRouter({}, async ({ router, fetched }) => {
    const result = await router.search({ query: '博查', count: 3, fresh: true, multi: false, signal: undefined })
    assert.equal(fetched.length, 0, 'without a key bocha is skipped, not called')
    assert.equal(result.sources.length, 0)
    assert.match(result.fallbackNote ?? '', /unavailable/)
  })
})

test('router: a Bocha request is counted in the usage ledger as bocha-search (tokens n/a, amount null) and stays out of the model totals', async () => {
  await withRouter({ BOCHA_SEARCH_API_KEY: 'k' }, async ({ router, store }) => {
    await router.search({ query: '一', count: 3, fresh: true, multi: false, signal: undefined })
    await router.search({ query: '二', count: 3, fresh: true, multi: false, signal: undefined })
    const ledger = new UsageLedger(store, resolveBudget().caps)
    const rows = store.usageRows(ledger.day()).filter(r => r.provider === 'bocha-search')
    assert.equal(rows.length, 2)
    assert.deepEqual(rows.map(r => [r.status, r.protocol, r.requests, r.inputTokens, r.outputTokens, r.estimated, r.amount]), [['settled', 'search', 1, 0, 0, false, null], ['settled', 'search', 1, 0, 0, false, null]])
    const today = ledger.today()
    assert.deepEqual(today.providers.map(p => [p.provider, p.requests]), [['bocha-search', 2]])
    assert.deepEqual([today.totals.requests, today.totals.amount], [0, 0], 'model totals are untouched')
  })
})

test('router: the compiled native options reach the engine through runProvider (pipeline path)', async () => {
  await withRouter({ BOCHA_SEARCH_API_KEY: 'k' }, async ({ router, fetched }) => {
    const out = await router.runProvider({ id: 'bocha', query: '博查', count: 5, options: { bocha: { include: ['gov.cn'], freshness: '2026-09-01..2026-10-02' } }, signal: new AbortController().signal })
    assert.equal(out.state, 'ok')
    assert.deepEqual([fetched[0]!.body.include, fetched[0]!.body.freshness], ['gov.cn', '2026-09-01..2026-10-02'])
  })
})
