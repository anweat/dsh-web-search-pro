import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { SearchRouter } from '../src/router.ts'
import { resolveConfig } from '../src/config.ts'
import { Store } from '../src/store.ts'
import { resolveBudget, UsageLedger } from '../src/pipeline/ledger.ts'
import { defaultProviderRegistry } from '../src/providers/index.ts'
import { KEYED_SOURCE_ENVS } from '../src/providers/keyed.ts'
import { tavilyAdapter, tavilyBody, parseTavily, tavilyFailure } from '../src/providers/tavily.ts'
import { braveAdapter, braveParams, braveFreshness, parseBrave, braveFailure } from '../src/providers/brave.ts'
import { linkupAdapter, linkupBody, parseLinkup, linkupFailure } from '../src/providers/linkup.ts'
import { serperAdapter, serperBody, parseSerper, serperFailure } from '../src/providers/serper.ts'
import type { Constraint } from '../src/pipeline/types.ts'
import { fixture, fails, harness, reply, assertNoKey } from './keyed-harness.ts'

const NOW = new Date('2026-10-02T00:00:00Z')
const hard = (id: string, kind: Constraint['kind'], value: string, strength: Constraint['strength'] = 'hard'): Constraint => ({ id, kind, value, strength, origin: 'param' })
const task = (constraints: Constraint[], query = 'postgres logical replication slot lag') => ({ goal: query, query, needs: [{ id: 'n1', text: query, critical: true }], constraints })
const headersOf = (status: number, h: Record<string, string> = {}) => new Headers(h)

// ── Tavily ───────────────────────────────────────────────────────────────────

test('tavily (constructed fixture): ranked results only — the generated answer is never a source; url-less and non-http entries dropped', () => {
  const fx = fixture('tavily-search.json')
  assert.equal(fx.live, false)
  assert.match(fx._comment, /NOT a live capture/)
  const sources = parseTavily(fx.body, 10)
  assert.deepEqual(sources.map(s => s.url), ['https://www.postgresql.org/docs/current/logicaldecoding-explanation.html', 'https://blog.example.test/replication-slot-lag'])
  assert.equal(sources[0]!.title, 'Logical replication slots - PostgreSQL docs')
  assert.match(sources[0]!.snippet!, /^A logical slot represents a stream of changes/)
  assert.equal(sources[0]!.publishedAt, '2026-03-01')
  assert.ok(!('publishedAt' in sources[1]!))
  assert.ok(!JSON.stringify(sources).includes('GENERATED ANSWER'), 'answer not used')
  assert.equal(parseTavily(fx.body, 1).length, 1, 'bounded by count')
  assert.throws(() => parseTavily({ results: [] }, 5), (e: any) => e.code === 'ENGINE_EMPTY' && e.retryable)
  assert.throws(() => parseTavily({}, 5), (e: any) => e.code === 'ENGINE_ERROR')
  assert.throws(() => parseTavily([], 5), (e: any) => e.code === 'ENGINE_ERROR')
})

test('tavily request: POST /search, Bearer key, documented fields only (no answer, no raw content), domain lists and start_date; the key is never in the URL or body', async () => {
  const { engine, calls, usage, key } = harness('tavily', d => tavilyAdapter.create(d, {} as never), () => reply(200, fixture('tavily-search.json').body))
  const out = await engine.search('postgres slot lag', 5, undefined, { sites: { include: ['postgresql.org'], exclude: ['pinterest.com'] }, since: '2025-01-01T00:00:00.000Z' })
  assert.equal(out.sources.length, 2)
  const c = calls[0]!
  assert.equal(c.url, 'https://api.tavily.com/search')
  assert.equal(c.init.method, 'POST')
  assert.equal(c.headers.authorization, 'Bearer ' + key)
  assert.equal(c.init.redirect, 'manual')
  assert.deepEqual(c.body, { query: 'postgres slot lag', search_depth: 'basic', max_results: 5, topic: 'general', include_answer: false, include_raw_content: false, include_published_date: true, include_domains: ['postgresql.org'], exclude_domains: ['pinterest.com'], start_date: '2025-01-01' })
  assert.ok(!c.url.includes(key!) && !JSON.stringify(c.body).includes(key!))
  assert.deepEqual(usage, [{ provider: 'tavily', protocol: 'search', requests: 1, note: 'tokens n/a, price unknown' }])
  assert.equal(tavilyBody('q', 99).max_results, 20, 'at most 20')
  assert.equal(tavilyBody('q', 0).max_results, 1)
  assert.deepEqual(Object.keys(tavilyBody('q', 3)).sort(), ['include_answer', 'include_published_date', 'include_raw_content', 'max_results', 'query', 'search_depth', 'topic'])
})

test('tavily errors: 401 auth (no cooldown), 432 / 433 quota, 429 honours Retry-After, 400 / 422 request errors, 5xx retryable; empty is ENGINE_EMPTY and still counted', async () => {
  const run = async (status: number, body: unknown, headers: Record<string, string> = {}) => {
    const h = harness('tavily', d => tavilyAdapter.create(d, {} as never), () => reply(status, body, headers))
    const e = await fails(h.engine.search('q', 3))
    assertNoKey(e, h.key!)
    assert.equal(h.usage.length, 0, 'a failed request is not counted as a billed one')
    return e
  }
  const e401 = await run(401, { detail: { error: 'Unauthorized: missing or invalid API key.' } })
  assert.deepEqual([e401.code, e401.retryable, e401.retryAfterMs], ['ENGINE_AUTH', false, undefined])
  for (const status of [432, 433]) {
    const e = await run(status, { detail: { error: 'This request exceeds your plan\'s set usage limit.' } })
    assert.deepEqual([e.code, e.retryable], ['ENGINE_QUOTA', false], String(status))
  }
  const e429 = await run(429, { detail: { error: 'Too many requests' } }, { 'retry-after': '7' })
  assert.deepEqual([e429.code, e429.retryable, e429.retryAfterMs], ['ENGINE_RATE_LIMIT', true, 7000])
  assert.deepEqual([(await run(422, { detail: [{ type: 'x', loc: ['body', 'max_results'], msg: 'bad value', input: 99 }] })).code, (await run(400, { detail: { error: 'Invalid topic' } })).retryable], ['ENGINE_ERROR', false])
  assert.equal((await run(500, { detail: { error: 'boom' } })).retryable, true)
  const empty = harness('tavily', d => tavilyAdapter.create(d, {} as never), () => reply(200, { results: [] }))
  assert.equal((await fails(empty.engine.search('q', 3))).code, 'ENGINE_EMPTY')
  assert.equal(empty.usage.length, 1)
  assert.equal(tavilyFailure(401, headersOf(401), { detail: { error: 'Bearer abcdefghijklmnopqrstuvwxyz0123456789 is bad' } }).message.includes('abcdefghijklmnop'), false, 'credential-looking text in a message is redacted')
})

// ── Brave ────────────────────────────────────────────────────────────────────

test('brave (constructed fixture): web.results[] mapped, decorations and entities removed, page_age as the date; url-less dropped', () => {
  const fx = fixture('brave-search.json')
  assert.equal(fx.live, false)
  const sources = parseBrave(fx.body, 10)
  assert.deepEqual(sources.map(s => s.url), ['https://blog.example.test/tokio-vs-async-std', 'https://github.com/smol-rs/smol'])
  assert.equal(sources[0]!.title, 'Comparing Tokio and async-std')
  assert.equal(sources[0]!.snippet, 'A runtime comparison & benchmark of the two.')
  assert.equal(sources[0]!.publishedAt, '2026-05-04T10:15:00')
  assert.throws(() => parseBrave({ web: { results: [] } }, 5), (e: any) => e.code === 'ENGINE_EMPTY')
  assert.throws(() => parseBrave({ type: 'search' }, 5), (e: any) => e.code === 'ENGINE_EMPTY', 'no web section: nothing matched')
  assert.throws(() => parseBrave({ web: { results: 'x' } }, 5), (e: any) => e.code === 'ENGINE_ERROR')
})

test('brave request: GET with X-Subscription-Token, count <= 20, freshness date range, query cut to the smaller documented limit', async () => {
  const { engine, calls, usage, key } = harness('brave', d => braveAdapter.create(d, {} as never), () => reply(200, fixture('brave-search.json').body))
  await engine.search('rust async runtime site:github.com', 50, undefined, { since: '2026-01-15T00:00:00.000Z' })
  const c = calls[0]!
  const u = new URL(c.url)
  assert.equal(u.origin + u.pathname, 'https://api.search.brave.com/res/v1/web/search')
  assert.equal(c.init.method, 'GET')
  assert.equal(c.headers['x-subscription-token'], key)
  assert.equal(u.searchParams.get('q'), 'rust async runtime site:github.com')
  assert.equal(u.searchParams.get('count'), '20')
  assert.equal(u.searchParams.get('freshness'), braveFreshness('2026-01-15T00:00:00.000Z', new Date()).replace(/to.*$/, '') + 'to' + new Date().toISOString().slice(0, 10))
  assert.equal(u.searchParams.get('result_filter'), 'web')
  assert.equal(u.searchParams.get('text_decorations'), 'false')
  assert.ok(!c.url.includes(key!), 'the key is a header, never in the URL')
  assert.equal(usage.length, 1)
  assert.equal(braveFreshness('2026-01-15T00:00:00.000Z', NOW), '2026-01-15to2026-10-02')
  assert.equal(braveParams('x', 5, undefined).freshness, undefined)
  const long = braveParams('word '.repeat(80), 5, undefined).q
  assert.equal(long.split(' ').length, 50, 'at most 50 words')
  assert.ok(braveParams('a'.repeat(1000), 5, undefined).q.length <= 400, 'at most 400 characters')
})

test('brave errors: the monthly window spent is quota (no cooldown), the per-second window gives a cooldown from X-RateLimit-Reset, Retry-After wins, auth is not retryable', async () => {
  const mk = (status: number, headers: Record<string, string> = {}) => braveFailure(status, new Headers(headers), { message: 'x' })
  const quota = mk(429, { 'x-ratelimit-remaining': '0, 0', 'x-ratelimit-reset': '1, 86400' })
  assert.deepEqual([quota.code, quota.retryable], ['ENGINE_QUOTA', false])
  const wait = mk(429, { 'x-ratelimit-remaining': '0, 1200', 'x-ratelimit-reset': '1, 86400' })
  assert.deepEqual([wait.code, wait.retryable, wait.retryAfterMs], ['ENGINE_RATE_LIMIT', true, 1000])
  assert.equal(mk(429, { 'retry-after': '5', 'x-ratelimit-reset': '1, 86400' }).retryAfterMs, 5000)
  assert.equal(mk(429).code, 'ENGINE_RATE_LIMIT', 'no headers: still a retryable rate limit')
  assert.deepEqual([mk(401).code, mk(401).retryable, mk(403).retryable], ['ENGINE_AUTH', false, false])
  assert.deepEqual([mk(422).code, mk(422).retryable], ['ENGINE_ERROR', false])
  assert.equal(mk(500).retryable, true)
  const h = harness('brave', d => braveAdapter.create(d, {} as never), () => reply(429, {}, { 'x-ratelimit-remaining': '0, 0' }))
  const e = await fails(h.engine.search('q', 3))
  assert.equal(e.code, 'ENGINE_QUOTA')
  assertNoKey(e, h.key!)
})

// ── Linkup ───────────────────────────────────────────────────────────────────

test('linkup (constructed fixture): only text searchResults are sources; images skipped', () => {
  const fx = fixture('linkup-search.json')
  assert.equal(fx.live, false)
  const sources = parseLinkup(fx.body, 10)
  assert.deepEqual(sources.map(s => s.url), ['https://docs.linkup.so/', 'https://docs.linkup.so/pages/documentation/endpoints/search/reference'])
  assert.equal(sources[0]!.title, 'Linkup documentation')
  assert.equal(sources[1]!.snippet, 'The /search endpoint allows you to retrieve web content.')
  assert.throws(() => parseLinkup({ results: [{ type: 'image', name: 'x', url: 'https://a.test/i.png' }] }, 5), (e: any) => e.code === 'ENGINE_EMPTY')
  assert.throws(() => parseLinkup({ answer: 'generated', sources: [{ name: 'x', url: 'https://a.test/' }] }, 5), (e: any) => e.code === 'ENGINE_ERROR', 'a sourcedAnswer body is not a ranked result list and is never mapped')
})

test('linkup request: POST /v1/search with outputType searchResults only, Bearer key, domain lists and fromDate', async () => {
  const { engine, calls, key } = harness('linkup', d => linkupAdapter.create(d, {} as never), () => reply(200, fixture('linkup-search.json').body))
  await engine.search('linkup api', 5, undefined, { sites: { include: ['linkup.so'], exclude: ['example.com'] }, since: '2026-06-01T00:00:00.000Z' })
  const c = calls[0]!
  assert.equal(c.url, 'https://api.linkup.so/v1/search')
  assert.equal(c.headers.authorization, 'Bearer ' + key)
  assert.deepEqual(c.body, { q: 'linkup api', depth: 'fast', outputType: 'searchResults', maxResults: 5, includeImages: false, includeDomains: ['linkup.so'], excludeDomains: ['example.com'], fromDate: '2026-06-01' })
  assert.equal(linkupBody('q', 5).outputType, 'searchResults')
  assert.ok(!('includeDomains' in linkupBody('q', 5)))
})

test('linkup errors: 429 with credit wording is quota (not retryable), other 429 a rate limit, 402 never paid, 401 / 403 auth, 400 request error, 504 retryable', () => {
  const body = (message: string, code = 'X') => ({ statusCode: 0, error: { code, message, details: [] } })
  const credit = linkupFailure(429, new Headers(), body('Insufficient credit', 'INSUFFICIENT_CREDIT'))
  assert.deepEqual([credit.code, credit.retryable], ['ENGINE_QUOTA', false])
  const conc = linkupFailure(429, new Headers({ 'retry-after': '2' }), body('Too many concurrent requests'))
  assert.deepEqual([conc.code, conc.retryable, conc.retryAfterMs], ['ENGINE_RATE_LIMIT', true, 2000])
  assert.deepEqual([linkupFailure(402, new Headers(), body('payment required')).code, linkupFailure(402, new Headers(), {}).retryable], ['ENGINE_QUOTA', false])
  assert.deepEqual([linkupFailure(401, new Headers(), body('API Key is missing or invalid')).code, linkupFailure(403, new Headers(), body('forbidden')).retryable], ['ENGINE_AUTH', false])
  assert.deepEqual([linkupFailure(400, new Headers(), body('bad')).code, linkupFailure(400, new Headers(), body('bad')).retryable], ['ENGINE_ERROR', false])
  assert.equal(linkupFailure(504, new Headers(), body('Request deadline exceeded')).retryable, true)
})

// ── Serper ───────────────────────────────────────────────────────────────────

test('serper (constructed fixture): organic[] only; answerBox / knowledgeGraph are not sources; only an absolute date is kept', () => {
  const fx = fixture('serper-search.json')
  assert.equal(fx.live, false)
  const sources = parseSerper(fx.body, 10)
  assert.deepEqual(sources.map(s => s.url), ['https://www.apple.com/', 'https://en.wikipedia.org/wiki/Apple_Inc.', 'https://news.example.test/apple'])
  assert.equal(sources[1]!.publishedAt, '2025-09-13')
  assert.ok(!('publishedAt' in sources[0]!) && !('publishedAt' in sources[2]!), '"3 days ago" is not a date')
  const all = JSON.stringify(sources)
  assert.ok(!all.includes('ANSWER BOX') && !all.includes('KNOWLEDGE GRAPH') && !all.includes('answerbox.example'))
  assert.throws(() => parseSerper({ organic: [] }, 5), (e: any) => e.code === 'ENGINE_EMPTY')
  assert.throws(() => parseSerper({ searchParameters: {} }, 5), (e: any) => e.code === 'ENGINE_EMPTY')
  assert.throws(() => parseSerper({ organic: {} }, 5), (e: any) => e.code === 'ENGINE_ERROR')
})

test('serper request: POST google.serper.dev/search with X-API-KEY and { q, num } only; descriptor says google', async () => {
  const { engine, calls, key } = harness('serper', d => serperAdapter.create(d, {} as never), () => reply(200, fixture('serper-search.json').body))
  await engine.search('apple inc -site:pinterest.com', 500)
  const c = calls[0]!
  assert.equal(c.url, 'https://google.serper.dev/search')
  assert.equal(c.headers['x-api-key'], key)
  assert.deepEqual(c.body, { q: 'apple inc -site:pinterest.com', num: 100 })
  assert.deepEqual(serperBody('q', 5), { q: 'q', num: 5 })
  assert.equal(serperAdapter.descriptor.sourceFamily, 'google', 'a Google wrapper is not independent of other Google-based sources')
  assert.equal(serperAdapter.descriptor.aliases[0], 'serper')
})

test('serper errors: auth not retryable, a 400 that says the credits are gone is quota, 429 honours Retry-After', () => {
  assert.deepEqual([serperFailure(403, new Headers(), { message: 'Unauthorized.' }).code, serperFailure(403, new Headers(), {}).retryable], ['ENGINE_AUTH', false])
  const credits = serperFailure(400, new Headers(), { message: 'Not enough credits' })
  assert.deepEqual([credits.code, credits.retryable], ['ENGINE_QUOTA', false])
  assert.match(credits.message, /HTTP 400/)
  assert.deepEqual([serperFailure(400, new Headers(), { message: 'Query not allowed' }).code, serperFailure(400, new Headers(), {}).retryable], ['ENGINE_ERROR', false])
  assert.equal(serperFailure(429, new Headers({ 'retry-after': '3' }), {}).retryAfterMs, 3000)
})

// ── redirects, missing keys, readiness ───────────────────────────────────────

test('a redirect is refused for every keyed source: the key is never forwarded to another origin', async () => {
  for (const [route, adapter] of [['tavily', tavilyAdapter], ['brave', braveAdapter], ['linkup', linkupAdapter], ['serper', serperAdapter]] as const) {
    const seen: string[] = []
    const h = harness(route, d => adapter.create(d, {} as never), call => { seen.push(call.url); return new Response('', { status: 302, headers: { location: 'https://evil.example.test/steal' } }) })
    const e = await fails(h.engine.search('q', 3))
    assert.equal(seen.length, 1, route + ': no second request')
    assertNoKey(e, h.key!)
  }
})

test('no key: not available, search refuses without any request, probeLocal says credential missing and where to set it', async () => {
  for (const [route, adapter] of [['tavily', tavilyAdapter], ['brave', braveAdapter], ['linkup', linkupAdapter], ['serper', serperAdapter]] as const) {
    const h = harness(route, d => adapter.create(d, {} as never), () => reply(200, {}), null)
    assert.equal(h.engine.available(), false, route)
    const e = await fails(h.engine.search('q', 3))
    assert.equal(e.code, 'ENGINE_UNAVAILABLE')
    assert.equal(e.retryable, false)
    assert.match(e.message, new RegExp(KEYED_SOURCE_ENVS[route]![0]!))
    assert.equal(h.calls.length, 0)
    const env = { deps: { enableCli: false, opencliEnabled: false, agentReachEnabled: false, allowProxyFakeIp: false, skipSeam: false }, config: {} as never }
    const missing = await adapter.probeLocal(env)
    assert.deepEqual([missing.available, missing.credential, missing.diagnosticCode], [false, 'missing', 'credential_missing'])
    assert.match(missing.reason!, new RegExp(KEYED_SOURCE_ENVS[route]![0]!))
    const present = await adapter.probeLocal({ ...env, deps: { ...env.deps, sourceKeys: { [route]: 'k' } } })
    assert.deepEqual([present.available, present.credential], [true, 'configured'])
  }
})

test('descriptors: registered, keyed, metered, unverified, English web sources; the key requirement names the documented environment variable', () => {
  for (const [route, env, priority] of [['tavily', 'TAVILY_API_KEY', 20], ['brave', 'BRAVE_API_KEY', 30], ['linkup', 'LINKUP_API_KEY', 40], ['serper', 'SERPER_API_KEY', 60]] as const) {
    const d = defaultProviderRegistry.resolve(route)!.descriptor
    assert.equal(d.id, 'builtin:' + route)
    assert.deepEqual(d.languages, ['en'])
    assert.ok(d.resultKinds.includes('web') && d.operations.includes('search'))
    assert.equal(d.verification?.live, false, 'never called live')
    assert.equal(d.costModel.kind, 'metered')
    assert.deepEqual(d.requirements[0]?.env, [env])
    assert.equal(d.priority, priority)
    assert.ok((d.priority ?? 100) > 10, 'below Exa and Bocha')
  }
  assert.equal(defaultProviderRegistry.resolve('brave')!.descriptor.sourceFamily, 'brave')
  assert.equal(defaultProviderRegistry.resolve('tavily')!.descriptor.sourceFamily, undefined)
})

// ── compilation ──────────────────────────────────────────────────────────────

test('compile: Tavily / Linkup take domain lists and a date bound natively; Brave / Serper take operators; Brave also a date range; soft constraints are never pushed down', () => {
  const c = [hard('c1', 'site', 'https://www.postgresql.org/docs'), hard('c2', 'exclude_site', 'pinterest.com'), hard('c3', 'time_window', 'past 30 days'), hard('c4', 'must_term', 'slot'), hard('c5', 'site', 'lwn.net', 'soft')]
  const t = tavilyAdapter.compile!(task(c), NOW)
  assert.deepEqual(t.options, { sites: { include: ['postgresql.org'], exclude: ['pinterest.com'] }, since: '2026-09-02T00:00:00.000Z' })
  assert.deepEqual(t.native, ['c1', 'c2', 'c3'])
  assert.deepEqual(t.local, ['c4', 'c5'], 'must_term and the soft site stay local')
  assert.equal(t.query, 'postgres logical replication slot lag')
  assert.deepEqual(linkupAdapter.compile!(task(c), NOW).options, t.options)
  const b = braveAdapter.compile!(task(c), NOW)
  assert.equal(b.query, 'postgres logical replication slot lag site:postgresql.org -site:pinterest.com')
  assert.equal(b.options?.since, '2026-09-02T00:00:00.000Z')
  assert.deepEqual(b.native, ['c1', 'c2', 'c3'])
  const s = serperAdapter.compile!(task(c), NOW)
  assert.equal(s.query, b.query)
  assert.equal(s.options, undefined, 'Serper documents no date filter: the time window stays local')
  assert.deepEqual(s.native, ['c1', 'c2'])
  assert.ok(s.local.includes('c3'))
  const plain = tavilyAdapter.compile!(task([hard('c1', 'site', 'a.com', 'soft')]), NOW)
  assert.equal(plain.options, undefined)
  assert.deepEqual(plain.local, ['c1'])
  const many = Array.from({ length: 120 }, (_, i) => hard('s' + i, 'site', 'd' + i + '.example.test'))
  assert.equal(linkupAdapter.compile!(task(many), NOW).options?.sites?.include?.length, 100, 'Linkup takes at most 100 domains')
  assert.equal(linkupAdapter.compile!(task(many), NOW).local.length, 20, 'the surplus stays local')
})

// ── router wiring ────────────────────────────────────────────────────────────

test('router: keys resolve config literal -> credentials ref -> environment into executable providers; counted in the usage ledger; no key = credential missing', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wsp-keyed-en-'))
  const realFetch = globalThis.fetch
  const saved = Object.fromEntries(['TAVILY_API_KEY', 'BRAVE_API_KEY', 'LINKUP_API_KEY', 'SERPER_API_KEY', 'MY_TAVILY'].map(n => [n, process.env[n]]))
  for (const n of Object.keys(saved)) delete process.env[n]
  const fetched: { url: string; headers: Record<string, string> }[] = []
  globalThis.fetch = (async (url: unknown, init: RequestInit) => {
    fetched.push({ url: String(url), headers: Object.fromEntries(Object.entries((init.headers ?? {}) as Record<string, string>).map(([k, v]) => [k.toLowerCase(), v])) })
    return reply(200, fixture('tavily-search.json').body)
  }) as typeof fetch
  const base = { dbPath: path.join(dir, 'store.db'), allowProxyFakeIp: true, enableCliBackends: false, opencliEnabled: false, agentReachEnabled: false }
  const store = new Store(base.dbPath)
  try {
    const none = new SearchRouter({ get: () => undefined } as never, resolveConfig({ ...base, engines: ['tavily'] } as never), store)
    const st = await none.providerStatuses(['tavily', 'brave', 'linkup', 'serper'])
    for (const id of ['tavily', 'brave', 'linkup', 'serper']) {
      assert.equal(st.get(id)?.state, 'unavailable', id)
      assert.equal(st.get(id)?.credential, 'missing', id)
    }
    assert.equal(fetched.length, 0)

    // environment, under a custom variable name configured in settings
    process.env.MY_TAVILY = 'env-key-from-custom-name'
    const viaEnv = new SearchRouter({ get: () => undefined } as never, resolveConfig({ ...base, engines: ['tavily'], keyedSources: { tavily: { apiKeyEnv: 'MY_TAVILY' } } } as never), store)
    assert.equal((await viaEnv.providerStatuses(['tavily'])).get('tavily')?.state, 'ready')
    const r = await viaEnv.search({ query: 'postgres slot', count: 3, fresh: true, multi: false, signal: undefined })
    assert.equal(r.engine, 'tavily')
    assert.equal(fetched[0]!.headers.authorization, 'Bearer env-key-from-custom-name')

    // credentials service beats nothing, config literal beats the credentials service
    const credentials = { resolve: async (ref: unknown) => ({ value: 'cred-key-for-' + String(ref).slice(-12) }) }
    const ctx = { get: (name: string) => name === 'credentials' ? credentials : undefined }
    const viaCred = new SearchRouter(ctx as never, resolveConfig({ ...base, engines: ['brave'] } as never), store)
    assert.equal((await viaCred.providerStatuses(['brave'])).get('brave')?.state, 'ready', 'a credentials ref makes it ready')
    const literal = new SearchRouter(ctx as never, resolveConfig({ ...base, engines: ['tavily'], keyedSources: { tavily: { apiKey: 'literal-key-wins', baseUrl: 'https://tavily-proxy.example.test' } } } as never), store)
    await literal.search({ query: 'q2', count: 3, fresh: true, multi: false, signal: undefined })
    const last = fetched.at(-1)!
    assert.equal(last.headers.authorization, 'Bearer literal-key-wins')
    assert.equal(last.url, 'https://tavily-proxy.example.test/search', 'baseUrl override')

    const report = await literal.providerReport()
    const tav = report.find(x => x.route === 'tavily')!
    assert.equal(tav.readiness.available, true)
    assert.equal(tav.readiness.credential, 'configured')
    assert.equal(tav.unverified, true)
    assert.equal(report.find(x => x.route === 'serper')!.sourceFamily, 'google')
    const ledger = new UsageLedger(store, resolveBudget().caps)
    assert.deepEqual(ledger.today().providers.map(p => [p.provider, p.requests]), [['tavily', 2]], 'one counted request per call, tokens n/a')
  } finally {
    globalThis.fetch = realFetch
    for (const [n, v] of Object.entries(saved)) { if (v === undefined) delete process.env[n]; else process.env[n] = v }
    store.close()
    fs.rmSync(dir, { recursive: true, force: true })
  }
})
