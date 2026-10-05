import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { SearchRouter } from '../src/router.ts'
import { resolveConfig } from '../src/config.ts'
import { Store } from '../src/store.ts'
import { resolveBudget, UsageLedger } from '../src/pipeline/ledger.ts'
import { EngineError, type Engine, type EngineDeps } from '../src/engines.ts'
import { defaultProviderRegistry } from '../src/providers/index.ts'
import { PROVIDER_USER_AGENT, Blocker, safeDetail, statusFailure } from '../src/providers/http.ts'
import { wikipediaEngine, wikipediaUrl, wikipediaLang, articleUrl, parseWikipedia, wikipediaAdapter } from '../src/providers/wikipedia.ts'
import { hackerNewsEngine, hackerNewsUrl, parseHackerNews, mapHackerNews, hackerNewsAdapter } from '../src/providers/hackernews.ts'
import { stackExchangeEngine, stackExchangeUrl, parseStackExchange, stackExchangeFailure, throttleSeconds, stackExchangeBlock, stackExchangeAdapter } from '../src/providers/stackexchange.ts'
import { openAlexEngine, openAlexUrl, parseOpenAlex, reconstructAbstract, openAlexBlock, openAlexAdapter } from '../src/providers/openalex.ts'
import { semanticScholarEngine, semanticScholarUrl, parseSemanticScholar, semanticScholarAdapter } from '../src/providers/semanticscholar.ts'
import { anySearchEngine, anySearchBody, parseAnySearch, anySearchBlock, anySearchAdapter, ANYSEARCH_URL } from '../src/providers/anysearch.ts'
import { searxngEngine, searxngBase, searxngUrl, parseSearxng, searxngAdapter } from '../src/providers/searxng.ts'
import { KEYED_SOURCE_IDS } from '../src/providers/keyed.ts'
import { compileSince } from '../src/pipeline/compile.ts'
import { planSources } from '../src/pipeline/plan.ts'
import type { Constraint } from '../src/pipeline/types.ts'

const fixture = (name: string): any => JSON.parse(fs.readFileSync(new URL('./fixtures/' + name, import.meta.url), 'utf8'))
const PUBLIC = async () => [{ address: '93.184.216.34', family: 4 }]
const reply = (status: number, body: unknown, headers: Record<string, string> = {}): Response =>
  new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } })

interface Call { url: string; init: RequestInit; headers: Record<string, string>; body?: any }
function harness(make: (deps: EngineDeps) => Engine, respond: (call: Call) => Response | Promise<Response>, deps: Partial<EngineDeps> = {}) {
  const calls: Call[] = []
  const usage: any[] = []
  const fetchImpl = (async (url: unknown, init: RequestInit) => {
    const headers = Object.fromEntries(Object.entries((init?.headers ?? {}) as Record<string, string>).map(([k, v]) => [k.toLowerCase(), v]))
    const call: Call = { url: String(url), init, headers, ...typeof init?.body === 'string' ? { body: JSON.parse(init.body) } : {} }
    calls.push(call)
    return respond(call)
  }) as typeof fetch
  const engine = make({ enableCli: false, opencliEnabled: false, agentReachEnabled: false, allowProxyFakeIp: false, skipSeam: false, fetchImpl, lookup: PUBLIC, usage: { record: e => { usage.push(e) } }, ...deps })
  return { engine, calls, usage }
}
const fails = async (p: Promise<unknown>): Promise<EngineError> => { try { await p } catch (e) { assert.ok(e instanceof EngineError, String(e)); return e } throw new Error('expected a failure') }

// ── Wikipedia ───────────────────────────────────────────────────────────────

test('wikipedia: live fixtures map to sources (en and zh); snippet markup is stripped without splitting Chinese words', () => {
  const en = parseWikipedia(fixture('wikipedia-en-search.json').body, 'en', 5)
  assert.equal(en.length, 3)
  assert.equal(en[0]!.url, 'https://en.wikipedia.org/wiki/Raft_(algorithm)')
  assert.equal(en[0]!.title, 'Raft (algorithm)')
  assert.ok(!/[<>]/.test(en[0]!.snippet!) && !/searchmatch/.test(en[0]!.snippet!), 'no markup left')
  assert.match(en[0]!.publishedAt!, /^\d{4}-\d\d-\d\dT/)
  const zh = parseWikipedia(fixture('wikipedia-zh-search.json').body, 'zh', 2)
  assert.equal(zh.length, 2, 'bounded by count')
  assert.ok(zh[0]!.url.startsWith('https://zh.wikipedia.org/wiki/') && decodeURIComponent(zh[0]!.url).endsWith('大型语言模型'))
  assert.match(zh[0]!.snippet!, /大型语言模型（英語/, 'the highlighted words keep their neighbours: no inserted spaces')
})

test('wikipedia: request fields, edition from the task language, URL building, errors and empty results', async () => {
  const u = new URL(wikipediaUrl('zh', 5, '大模型 备案'))
  assert.equal(u.hostname, 'zh.wikipedia.org')
  assert.deepEqual([...u.searchParams.entries()].filter(([k]) => ['action', 'list', 'format', 'srsearch', 'srlimit', 'srnamespace'].includes(k)).sort(), [['action', 'query'], ['format', 'json'], ['list', 'search'], ['srlimit', '5'], ['srnamespace', '0'], ['srsearch', '大模型 备案']])
  assert.equal(new URL(wikipediaUrl('en', 999, 'x')).searchParams.get('srlimit'), '50', 'bounded to the non-bot maximum')
  assert.equal(wikipediaLang('大语言模型'), 'zh')
  assert.equal(wikipediaLang('raft consensus'), 'en')
  assert.equal(wikipediaLang('raft consensus', 'zh'), 'zh', 'the explicit option wins')
  assert.equal(articleUrl('en', 'C++ (language)'), 'https://en.wikipedia.org/wiki/C%2B%2B_(language)')

  const { engine, calls, usage } = harness(wikipediaEngine, () => reply(200, fixture('wikipedia-en-search.json').body))
  const out = await engine.search('raft consensus algorithm', 5)
  assert.equal(out.sources.length, 3)
  assert.equal(new URL(calls[0]!.url).hostname, 'en.wikipedia.org')
  assert.equal(calls[0]!.headers['user-agent'], PROVIDER_USER_AGENT, 'a polite, descriptive User-Agent')
  assert.match(PROVIDER_USER_AGENT, /dsh-web-search-pro\/.*github\.com\/anweat/)
  assert.deepEqual(usage, [{ provider: 'wikipedia', protocol: 'search', requests: 1, note: 'tokens n/a, free tier' }], 'one request counted, tokens n/a')

  assert.throws(() => parseWikipedia({ query: { search: [] } }, 'en', 5), (e: any) => e.code === 'ENGINE_EMPTY' && e.retryable)
  assert.throws(() => parseWikipedia({ error: { code: 'ratelimited', info: 'slow down' } }, 'en', 5), (e: any) => e.code === 'ENGINE_RATE_LIMIT' && e.retryable)
  assert.throws(() => parseWikipedia({ error: { code: 'nosrsearch', info: 'x' } }, 'en', 5), (e: any) => e.code === 'ENGINE_ERROR' && !e.retryable)
  assert.throws(() => parseWikipedia('nope', 'en', 5), (e: any) => e.code === 'ENGINE_ERROR')
  const empty = harness(wikipediaEngine, () => reply(200, { batchcomplete: true, query: { searchinfo: { totalhits: 0 }, search: [] } }))
  assert.equal((await fails(empty.engine.search('zzzz', 5))).code, 'ENGINE_EMPTY')
  assert.equal(empty.usage.length, 1, 'an empty answer was still a request')
})

// ── Hacker News ─────────────────────────────────────────────────────────────

test('hackernews: live fixture mapping (article URL, thread in the snippet), request fields and the native date filter', async () => {
  const sources = parseHackerNews(fixture('hackernews-search.json').body, 5)
  assert.equal(sources.length, 3)
  assert.equal(sources[0]!.url, 'https://corrode.dev/blog/async/')
  assert.match(sources[0]!.snippet!, /^HN: 258 points, 198 comments \(discussion https:\/\/news\.ycombinator\.com\/item\?id=37639896\)/)
  assert.equal(sources[0]!.publishedAt, '2023-09-25T05:20:13Z')
  // Ask HN has no external URL: the thread is the result, its text the snippet.
  const ask = mapHackerNews([{ objectID: '42', title: 'Ask HN: what do you use?', url: null, points: 3, num_comments: 1, story_text: '<p>I use <i>Rust</i> &amp; Go</p>', created_at: '2026-01-01T00:00:00Z' }], 5)
  assert.equal(ask[0]!.url, 'https://news.ycombinator.com/item?id=42')
  assert.match(ask[0]!.snippet!, /HN: 3 points, 1 comments — I use Rust & Go/)
  assert.deepEqual(mapHackerNews([{ objectID: '1' }, { title: 'x' }], 5), [], 'entries without id or title dropped')

  const u = new URL(hackerNewsUrl('rust async', 5, '2025-01-01T00:00:00.000Z'))
  assert.equal(u.origin + u.pathname, 'https://hn.algolia.com/api/v1/search')
  assert.equal(u.searchParams.get('tags'), 'story')
  assert.equal(u.searchParams.get('hitsPerPage'), '5')
  assert.equal(u.searchParams.get('numericFilters'), 'created_at_i>' + Date.parse('2025-01-01T00:00:00.000Z') / 1000)
  assert.equal(new URL(hackerNewsUrl('x', 5)).searchParams.get('numericFilters'), null)

  const { engine, calls, usage } = harness(hackerNewsEngine, () => reply(200, fixture('hackernews-search.json').body))
  assert.equal((await engine.search('rust async runtime', 3, undefined, { since: '2025-01-01T00:00:00.000Z' })).sources.length, 3)
  assert.match(calls[0]!.url, /numericFilters=created_at_i%3E1735689600/)
  assert.equal(usage.length, 1)
  assert.throws(() => parseHackerNews({ hits: [] }, 5), (e: any) => e.code === 'ENGINE_EMPTY')
  assert.throws(() => parseHackerNews({}, 5), (e: any) => e.code === 'ENGINE_ERROR')
})

// ── Stack Exchange ──────────────────────────────────────────────────────────

test('stackexchange: live fixture mapping, request fields and fromdate', async () => {
  stackExchangeBlock.reset()
  const sources = parseStackExchange(fixture('stackexchange-search.json').body, 5)
  assert.equal(sources.length, 3)
  assert.equal(sources[0]!.url, 'https://stackoverflow.com/questions/54987361/python-asyncio-handling-exceptions-in-gather-documentation-unclear')
  assert.match(sources[0]!.snippet!, /^answered \(accepted\), 2 answers, score 53, tags: python, python-3\.x — The documentation for asyncio\.gather/)
  assert.ok(!/<[a-z]/.test(sources[0]!.snippet!) && !/&#?\w+;/.test(sources[0]!.title + sources[0]!.snippet!), 'HTML and entities decoded')
  assert.match(sources[0]!.publishedAt!, /^2019-03-04T/)
  const u = new URL(stackExchangeUrl('asyncio gather', 5, '2025-01-01T00:00:00.000Z'))
  assert.equal(u.origin + u.pathname, 'https://api.stackexchange.com/2.3/search/advanced')
  assert.deepEqual(Object.fromEntries(u.searchParams), { order: 'desc', sort: 'relevance', q: 'asyncio gather', site: 'stackoverflow', pagesize: '5', filter: 'withbody', fromdate: String(Date.parse('2025-01-01T00:00:00.000Z') / 1000) })

  // The wire format is gzip (fixture `contentEncoding`); Node's fetch inflates it before the body is read — the live smoke ran through that path.
  assert.equal(fixture('stackexchange-search.json').contentEncoding, 'gzip')
  const fine = harness(stackExchangeEngine, () => reply(200, fixture('stackexchange-search.json').body))
  assert.equal((await fine.engine.search('python asyncio', 2)).sources.length, 2)
  assert.equal(fine.usage[0].provider, 'stackexchange')
  assert.throws(() => parseStackExchange({ items: [], quota_remaining: 3 }, 5), (e: any) => e.code === 'ENGINE_EMPTY')
  stackExchangeBlock.reset()
})

test('stackexchange: a `backoff` field is honoured before the next request; throttle violations map to rate limit or quota; no cooldown on quota', async () => {
  stackExchangeBlock.reset()
  const now = Date.now()
  const blocker = new Blocker(() => now)
  blocker.block(10_000, 'ENGINE_RATE_LIMIT', 'x')
  assert.throws(() => blocker.check('X'), (e: any) => e.code === 'ENGINE_RATE_LIMIT' && e.retryable && e.retryAfterMs === 10_000)
  assert.equal(throttleSeconds('too many requests from this IP, more requests available in 74268 seconds'), 74268)

  const { engine, calls } = harness(stackExchangeEngine, () => reply(200, { ...fixture('stackexchange-search.json').body, backoff: 30 }))
  assert.equal((await engine.search('q', 3)).sources.length, 3, 'the answer itself is used')
  const waiting = await fails(engine.search('q again', 3))
  assert.equal(waiting.code, 'ENGINE_RATE_LIMIT')
  assert.ok(waiting.retryable && waiting.retryAfterMs! > 0 && waiting.retryAfterMs! <= 30_000, 'the cooldown is the backoff')
  assert.equal(calls.length, 1, 'no request while the backoff runs')
  stackExchangeBlock.reset()

  const burst = stackExchangeFailure(400, new Headers(), { error_id: 502, error_name: 'throttle_violation', error_message: 'too many requests from this IP, more requests available in 40 seconds' })
  assert.equal(burst.code, 'ENGINE_RATE_LIMIT')
  assert.equal(burst.retryAfterMs, 40_000)
  stackExchangeBlock.reset()
  const quota = stackExchangeFailure(400, new Headers(), { error_id: 502, error_name: 'throttle_violation', error_message: 'too many requests from this IP, more requests available in 74268 seconds' })
  assert.equal(quota.code, 'ENGINE_QUOTA')
  assert.equal(quota.retryable, false, 'the daily quota: no cooldown')
  const again = await fails(harness(stackExchangeEngine, () => reply(200, {})).engine.search('q', 3))
  assert.equal(again.code, 'ENGINE_QUOTA', 'and the engine does not ask again while the quota is out')
  stackExchangeBlock.reset()
  assert.equal(stackExchangeFailure(400, new Headers(), { error_id: 400, error_name: 'bad_parameter', error_message: 'q is required' }).retryable, false)
})

// ── OpenAlex ────────────────────────────────────────────────────────────────

test('openalex: live fixture mapping, abstract reconstruction from the inverted index, request fields, native date filter', async () => {
  openAlexBlock.reset()
  assert.equal(reconstructAbstract({ Hello: [0], world: [1, 3], again: [2] }), 'Hello world again world')
  assert.equal(reconstructAbstract(null), '')
  assert.equal(reconstructAbstract({ a: [-1, 1e9] } as never), '', 'out-of-range positions ignored')
  const sources = parseOpenAlex(fixture('openalex-works.json').body, 5)
  assert.equal(sources.length, 3)
  assert.equal(sources[0]!.url, 'https://doi.org/10.48550/arxiv.2312.10997', 'the DOI URL first')
  assert.equal(sources[0]!.title, 'Retrieval-Augmented Generation for Large Language Models: A Survey')
  assert.match(sources[0]!.snippet!, /^arXiv \(Cornell University\), 2023, cited by 749 — Large Language Models \(LLMs\) showcase/)
  assert.equal(sources[0]!.publishedAt, '2023-12-18')
  const u = new URL(openAlexUrl('rag', 5, '2025-03-04T00:00:00.000Z'))
  assert.equal(u.origin + u.pathname, 'https://api.openalex.org/works')
  assert.equal(u.searchParams.get('search'), 'rag')
  assert.equal(u.searchParams.get('per_page'), '5')
  assert.equal(u.searchParams.get('filter'), 'from_publication_date:2025-03-04')
  assert.match(u.searchParams.get('select')!, /abstract_inverted_index/)
  assert.ok(!u.searchParams.has('api_key') && !u.searchParams.has('mailto'))
  assert.throws(() => parseOpenAlex({ results: [] }, 5), (e: any) => e.code === 'ENGINE_EMPTY')
  assert.deepEqual(parseOpenAlex({ results: [{ id: 'https://openalex.org/W1', display_name: 'T' }] }, 5).map(s => s.url), ['https://openalex.org/W1'], 'falls back to the OpenAlex id')
})

test('openalex: the key goes in a bearer header (never the URL), the contact address in the User-Agent; a spent daily budget is quota, not a cooldown', async () => {
  openAlexBlock.reset()
  const body = fixture('openalex-works.json').body
  const keyed = harness(openAlexEngine, () => reply(200, body), { openalexApiKey: 'oa-secret-key-0001', openalexMailto: 'me@example.test' })
  await keyed.engine.search('rag', 3)
  assert.equal(keyed.calls[0]!.headers.authorization, 'Bearer oa-secret-key-0001')
  assert.ok(!keyed.calls[0]!.url.includes('oa-secret-key-0001'), 'the key is not in the URL')
  assert.match(keyed.calls[0]!.headers['user-agent']!, /mailto:me@example\.test/)
  const anon = harness(openAlexEngine, () => reply(200, body))
  await anon.engine.search('rag', 3)
  assert.ok(!('authorization' in anon.calls[0]!.headers))
  assert.equal(anon.calls[0]!.headers['user-agent'], PROVIDER_USER_AGENT)

  const spent = harness(openAlexEngine, () => reply(429, { error: 'Rate limit exceeded', message: 'budget' }, { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '3600' }))
  const quota = await fails(spent.engine.search('rag', 3))
  assert.equal(quota.code, 'ENGINE_QUOTA')
  assert.equal(quota.retryable, false)
  const next = await fails(spent.engine.search('rag again', 3))
  assert.equal(next.code, 'ENGINE_QUOTA')
  assert.equal(spent.calls.length, 1, 'not asked again until the reset')
  openAlexBlock.reset()
  assert.equal(spent.usage.length, 0, 'failures are not counted')
  const burst = harness(openAlexEngine, () => reply(429, { error: 'Too many' }, { 'retry-after': '7', 'x-ratelimit-remaining': '800' }))
  const e = await fails(burst.engine.search('rag', 3))
  assert.equal(e.code, 'ENGINE_RATE_LIMIT')
  assert.equal(e.retryAfterMs, 7000)
})

// ── Semantic Scholar ────────────────────────────────────────────────────────

test('semanticscholar: the recorded 429 maps to a short rate-limit cooldown; success mapping (from the API docs) and request fields', async () => {
  const f = fixture('semanticscholar-429.json')
  assert.equal(f.status, 429)
  const busy = harness(semanticScholarEngine, () => reply(429, f.body))
  const e = await fails(busy.engine.search('rag', 3))
  assert.equal(e.code, 'ENGINE_RATE_LIMIT')
  assert.equal(e.retryable, true)
  assert.equal(e.retryAfterMs, 15_000, 'no Retry-After: a short default wait')
  assert.equal(busy.usage.length, 0)
  assert.ok(!/semanticscholar\.org\/product\/api#api-key-form/.test(e.message) || e.message.length < 400)

  const ok = {
    total: 2, offset: 0, next: 2,
    data: [
      { paperId: 'abc', url: 'https://www.semanticscholar.org/paper/abc', title: 'Retrieval-Augmented Generation', abstract: 'We propose RAG.\n  Models retrieve.', year: 2020, venue: 'NeurIPS', publicationDate: '2020-05-22', citationCount: 5000 },
      { paperId: 'def', title: 'No url', abstract: null, year: 2021, venue: '', citationCount: null },
    ],
  }
  const sources = parseSemanticScholar(ok, 5)
  assert.equal(sources.length, 2)
  assert.equal(sources[0]!.snippet, 'NeurIPS, 2020, cited by 5000 — We propose RAG. Models retrieve.')
  assert.equal(sources[0]!.publishedAt, '2020-05-22')
  assert.equal(sources[1]!.url, 'https://www.semanticscholar.org/paper/def', 'url built from paperId when absent')
  assert.equal(sources[1]!.publishedAt, '2021')
  assert.throws(() => parseSemanticScholar({ total: 0, offset: 0 }, 5), (e: any) => e.code === 'ENGINE_EMPTY', 'no matches answers without `data`')
  assert.throws(() => parseSemanticScholar({ total: 0, data: [] }, 5), (e: any) => e.code === 'ENGINE_EMPTY')
  const u = new URL(semanticScholarUrl('rag', 5, '2025-01-01T00:00:00.000Z'))
  assert.equal(u.origin + u.pathname, 'https://api.semanticscholar.org/graph/v1/paper/search')
  assert.deepEqual(Object.fromEntries(u.searchParams), { query: 'rag', fields: 'title,url,abstract,year,venue,publicationDate,citationCount', limit: '5', year: '2025-' })

  const keyed = harness(semanticScholarEngine, () => reply(200, ok), { semanticScholarApiKey: 'ss-secret-0002' })
  assert.equal((await keyed.engine.search('rag', 5)).sources.length, 2)
  assert.equal(keyed.calls[0]!.headers['x-api-key'], 'ss-secret-0002')
  assert.ok(!keyed.calls[0]!.url.includes('ss-secret-0002'))
  const anon = harness(semanticScholarEngine, () => reply(200, ok))
  await anon.engine.search('rag', 5)
  assert.ok(!('x-api-key' in anon.calls[0]!.headers))
})

// ── AnySearch ───────────────────────────────────────────────────────────────

const SECRET_USER = 'user_generated_8841'
const SECRET_PASS = 'p4ss-Generated-7d2f9c'
const SECRET_KEY = 'asr_live_0123456789abcdef0123456789abcdef'
/** Synthetic 402 in the documented shape (the live service was never driven to its quota). */
const QUOTA_402 = { code: -1, message: 'Your account and API key have been automatically generated. Use the API key below to continue.\nusername=' + SECRET_USER + '\npassword=' + SECRET_PASS + '\napi_key=' + SECRET_KEY, request_id: '5a3f8c27-1e64-4b90-a752-6d9e2f41c083' }

test('anysearch: live fixture mapping, anonymous request (no Authorization), zone and language from the task language', async () => {
  anySearchBlock.reset()
  const sources = parseAnySearch(fixture('anysearch-search.json').body, 5)
  assert.equal(sources.length, 3)
  assert.equal(sources[0]!.url, 'https://go.dev/doc/go1.24')
  assert.equal(sources[0]!.title, 'Go 1.24 Release Notes')
  assert.deepEqual(anySearchBody('大模型 备案', 50), { query: '大模型 备案', max_results: 10, zone: 'cn', language: 'zh-CN' })
  assert.deepEqual(anySearchBody('go release', 5), { query: 'go release', max_results: 5, zone: 'intl', language: 'en' })
  assert.deepEqual(anySearchBody('go release', 5, 'zh').zone, 'cn')
  const { engine, calls, usage } = harness(anySearchEngine, () => reply(200, fixture('anysearch-search.json').body))
  assert.equal((await engine.search('Go 1.24 release notes', 5)).sources.length, 3)
  assert.equal(calls[0]!.url, ANYSEARCH_URL)
  assert.equal(calls[0]!.init.method, 'POST')
  assert.ok(!('authorization' in calls[0]!.headers), 'anonymous: no Authorization header')
  assert.equal(calls[0]!.headers['content-type'], 'application/json')
  assert.deepEqual(calls[0]!.body, { query: 'Go 1.24 release notes', max_results: 5, zone: 'intl', language: 'en' })
  assert.equal(usage.length, 1)
  const keyed = harness(anySearchEngine, () => reply(200, fixture('anysearch-search.json').body), { anysearchApiKey: 'as-key-0003' })
  await keyed.engine.search('q', 3)
  assert.equal(keyed.calls[0]!.headers.authorization, 'Bearer as-key-0003')
  assert.throws(() => parseAnySearch({ code: 0, data: { results: [] } }, 5), (e: any) => e.code === 'ENGINE_EMPTY')
  assert.throws(() => parseAnySearch({ code: -1, message: 'x' }, 5), (e: any) => e.code === 'ENGINE_ERROR')
})

test('anysearch: a 402 with generated credentials becomes quota_exhausted and the credentials appear nowhere (error, ledger, logs, later calls)', async () => {
  anySearchBlock.reset()
  const logged: string[] = []
  const origLog = console.log; const origError = console.error; const origWarn = console.warn
  console.log = console.error = console.warn = (...a: unknown[]) => { logged.push(a.map(String).join(' ')) }
  try {
    const h = harness(anySearchEngine, () => reply(402, QUOTA_402))
    const e = await fails(h.engine.search('Go 1.24 release notes', 5))
    assert.equal(e.code, 'ENGINE_QUOTA')
    assert.equal(e.retryable, false, 'no cooldown on quota')
    assert.match(e.message, /quota_exhausted/)
    const dump = [e.message, e.stack ?? '', JSON.stringify(e), String(e), JSON.stringify(h.usage), JSON.stringify(logged), JSON.stringify(Object.getOwnPropertyNames(e).map(k => String((e as any)[k])))].join('\n')
    for (const secret of [SECRET_USER, SECRET_PASS, SECRET_KEY, 'username=', 'password=', 'api_key=', 'automatically generated']) assert.ok(!dump.includes(secret), 'leaked: ' + secret)
    assert.equal(h.usage.length, 0, 'a rejected request is not counted')
    // stop asking: every further anonymous 402 may mint another account
    const again = await fails(h.engine.search('another query', 5))
    assert.equal(again.code, 'ENGINE_QUOTA')
    assert.equal(h.calls.length, 1, 'no second request while the quota block holds')
    assert.ok(!(again.message + again.stack).includes(SECRET_KEY))
  } finally { console.log = origLog; console.error = origError; console.warn = origWarn }
  anySearchBlock.reset()
  // other statuses: only a redacted message is shown, never credential-looking values
  const bad = harness(anySearchEngine, () => reply(400, { code: -1, message: 'Query is required. api_key=' + SECRET_KEY + ' token: ' + SECRET_PASS, request_id: 'r' }))
  const e400 = await fails(bad.engine.search('q', 3))
  assert.equal(e400.retryable, false)
  assert.ok(!e400.message.includes(SECRET_KEY) && !e400.message.includes(SECRET_PASS), e400.message)
  assert.match(e400.message, /Query is required/)
  const unauth = await fails(harness(anySearchEngine, () => reply(401, { code: -1, message: 'Invalid API key' }), { anysearchApiKey: 'bad' }).engine.search('q', 3))
  assert.equal(unauth.code, 'ENGINE_AUTH', 'an invalid key is surfaced, not retried anonymously')
  assert.equal(unauth.retryable, false)
  const redacted = safeDetail('password=hunter2 and Authorization: Bearer abcdefghijklmnopqrstuvwxyz0123456789 ok')
  assert.ok(!/hunter2|abcdefghijklmnop/.test(redacted) && redacted.endsWith('ok'), redacted)
})

// ── SearXNG ─────────────────────────────────────────────────────────────────

test('searxng: available only with searxngUrl; JSON request; a private self-hosted URL is allowed, credentials in the URL and redirects are not', async () => {
  const noUrl = harness(searxngEngine, () => reply(200, {}))
  assert.equal(noUrl.engine.available(), false)
  assert.equal((await fails(noUrl.engine.search('q', 3))).code, 'ENGINE_UNAVAILABLE')
  assert.equal(noUrl.calls.length, 0)
  const probe = (deps: Partial<EngineDeps>, config: object = {}): any => searxngAdapter.probeLocal({ deps: { enableCli: false, opencliEnabled: false, agentReachEnabled: false, allowProxyFakeIp: false, skipSeam: false, ...deps }, config: config as never })
  assert.equal(probe({}).available, false)
  assert.match(probe({}).reason, /searxngUrl is not set/)
  assert.equal(probe({ searxngUrl: 'http://127.0.0.1:8888' }).available, true)
  assert.equal(searxngAdapter.descriptor.requirements[0]!.kind, 'service')

  const body = { query: 'q', number_of_results: 2, results: [{ url: 'https://a.test/1', title: 'A', content: 'text  a', engine: 'google', publishedDate: '2026-01-02T00:00:00' }, { url: 'https://a.test/1', title: 'dup' }, { url: 'ftp://x', title: 'bad' }, { url: 'https://b.test/', title: 'B' }] }
  const h = harness(searxngEngine, () => reply(200, body), { searxngUrl: 'http://127.0.0.1:8888/searx/' })
  const out = await h.engine.search('大模型 备案', 5)
  assert.deepEqual(out.sources.map(s => s.url), ['https://a.test/1', 'https://b.test/'], 'duplicates and non-http URLs dropped')
  assert.equal(out.sources[0]!.snippet, 'text a')
  assert.equal(h.calls[0]!.url, 'http://127.0.0.1:8888/searx/search?q=%E5%A4%A7%E6%A8%A1%E5%9E%8B+%E5%A4%87%E6%A1%88&format=json&language=zh-CN')
  assert.equal(h.calls[0]!.init.redirect, 'error')
  assert.equal(h.usage.length, 1)
  assert.throws(() => searxngBase('http://user:pw@host.test/'), /credentials/)
  assert.throws(() => searxngBase('ftp://host.test/'), /http\(s\)/)
  assert.throws(() => searxngBase('nope'), /not a valid URL/)
  assert.equal(searxngBase('https://s.test/base/?x=1#f').href, 'https://s.test/base')
  assert.equal(searxngUrl(searxngBase('https://s.test'), 'rust', 'en'), 'https://s.test/search?q=rust&format=json&language=en')
  assert.throws(() => parseSearxng({ results: [] }, 5), (e: any) => e.code === 'ENGINE_EMPTY')
  assert.throws(() => parseSearxng({ nope: 1 }, 5), (e: any) => e.code === 'ENGINE_ERROR')

  const forbidden = await fails(harness(searxngEngine, () => reply(403, 'Forbidden'), { searxngUrl: 'https://s.test' }).engine.search('q', 3))
  assert.equal(forbidden.code, 'ENGINE_UNAVAILABLE')
  assert.equal(forbidden.retryable, false)
  assert.match(forbidden.message, /json format/)
  const limited = await fails(harness(searxngEngine, () => reply(429, 'x', { 'retry-after': '5' }), { searxngUrl: 'https://s.test' }).engine.search('q', 3))
  assert.equal(limited.code, 'ENGINE_RATE_LIMIT')
  assert.equal(limited.retryAfterMs, 5000)
  const notJson = await fails(harness(searxngEngine, () => new Response('<html>', { status: 200 }), { searxngUrl: 'https://s.test' }).engine.search('q', 3))
  assert.equal(notJson.code, 'ENGINE_ERROR')
})

// ── shared behaviour: errors, SSRF-safe path, cancellation ──────────────────

const ALL: [string, (deps: EngineDeps) => Engine, Partial<EngineDeps>][] = [
  ['wikipedia', wikipediaEngine, {}], ['hackernews', hackerNewsEngine, {}], ['stackexchange', stackExchangeEngine, {}],
  ['openalex', openAlexEngine, {}], ['semanticscholar', semanticScholarEngine, {}], ['anysearch', anySearchEngine, {}],
]

test('error mapping for every API source: auth is not retryable (no cooldown), 429 honours Retry-After, 5xx retryable, bad request not retryable', async () => {
  for (const [name, make, deps] of ALL) {
    stackExchangeBlock.reset(); openAlexBlock.reset(); anySearchBlock.reset()
    const code = async (status: number, headers: Record<string, string> = {}): Promise<EngineError> => fails(harness(make, () => reply(status, { message: 'm' }, headers), deps).engine.search('q', 3))
    const auth = await code(401)
    assert.equal(auth.code, 'ENGINE_AUTH', name); assert.equal(auth.retryable, false, name)
    assert.equal((await code(403)).retryable, false, name)
    const limited = await code(429, { 'retry-after': '12' })
    assert.equal(limited.code, 'ENGINE_RATE_LIMIT', name); assert.equal(limited.retryable, true, name)
    if (name !== 'stackexchange') assert.equal(limited.retryAfterMs, 12_000, name + ' honours Retry-After')
    const server = await code(503)
    assert.equal(server.code, 'ENGINE_ERROR', name); assert.equal(server.retryable, true, name)
    assert.equal((await code(400)).retryable, false, name)
    stackExchangeBlock.reset(); openAlexBlock.reset(); anySearchBlock.reset()
  }
  const http = new Headers({ 'retry-after': 'Wed, 21 Oct 2099 07:28:00 GMT' })
  assert.ok(statusFailure('X', 429, http).retryAfterMs! > 0, 'HTTP-date Retry-After')
  assert.equal(statusFailure('X', 402, new Headers()).code, 'ENGINE_QUOTA')
})

test('invalid JSON, timeouts and cancellation: coded errors, nothing counted, an abort is passed through untouched', async () => {
  for (const [name, make, deps] of ALL) {
    stackExchangeBlock.reset(); openAlexBlock.reset(); anySearchBlock.reset()
    const bad = harness(make, () => new Response('<html>not json</html>', { status: 200, headers: { 'content-type': 'text/html' } }), deps)
    const e = await fails(bad.engine.search('q', 3))
    assert.equal(e.code, 'ENGINE_ERROR', name)
    const net = harness(make, () => { throw new TypeError('fetch failed') }, deps)
    const n = await fails(net.engine.search('q', 3))
    assert.equal(n.code, 'ENGINE_ERROR', name); assert.equal(n.retryable, true, name)
    assert.equal(net.usage.length, 0, name)
    const ctl = new AbortController()
    const aborting = harness(make, ({ init }) => new Promise((_, reject) => { const stop = (): void => reject(init.signal!.reason); if (init.signal!.aborted) stop(); else init.signal!.addEventListener('abort', stop) }), deps)
    const pending = aborting.engine.search('q', 3, ctl.signal)
    ctl.abort(new Error('user stop'))
    await assert.rejects(pending, (err: any) => !(err instanceof EngineError) && /user stop/.test(String(err.message)), name + ': the caller\'s abort is not turned into an engine failure')
  }
})

test('SSRF-safe path: private resolutions are refused (non-retryable), proxy fake-IPs only with allowProxyFakeIp, redirects to private hosts are refused', async () => {
  const resolve = (address: string) => async () => [{ address, family: 4 }]
  const priv = harness(wikipediaEngine, () => reply(200, {}), { lookup: resolve('10.0.0.5') })
  const e = await fails(priv.engine.search('q', 3))
  assert.equal(e.code, 'ENGINE_UNAVAILABLE')
  assert.equal(e.retryable, false)
  assert.equal(priv.calls.length, 0, 'nothing was sent')
  const fake = harness(hackerNewsEngine, () => reply(200, fixture('hackernews-search.json').body), { lookup: resolve('198.18.0.7') })
  const blocked = await fails(fake.engine.search('q', 3))
  assert.match(blocked.message, /allowProxyFakeIp/, 'the error names the switch')
  assert.equal(fake.calls.length, 0)
  const allowed = harness(hackerNewsEngine, () => reply(200, fixture('hackernews-search.json').body), { lookup: resolve('198.18.0.7'), allowProxyFakeIp: true })
  assert.equal((await allowed.engine.search('q', 3)).sources.length, 3, 'allowed with allowProxyFakeIp')
  const hop = harness(wikipediaEngine, call => call.url.startsWith('https://en.wikipedia.org') ? new Response(null, { status: 302, headers: { location: 'http://169.254.169.254/latest/meta-data' } }) : reply(200, {}))
  const redirected = await fails(hop.engine.search('q', 3))
  assert.equal(redirected.code, 'ENGINE_UNAVAILABLE', 'a redirect to a private target is refused')
  assert.equal(hop.calls.length, 1)
})

// ── registry, descriptors, planning, compilation ────────────────────────────

test('descriptors: own source families, languages, profiles and priorities; supplementary kinds so S1 never promotes them over web search', () => {
  const d = (id: string) => defaultProviderRegistry.resolve(id)!.descriptor
  for (const id of ['wikipedia', 'hackernews', 'stackexchange', 'openalex', 'semanticscholar']) assert.equal(d(id).sourceFamily, id, id + ' is its own family')
  assert.deepEqual(d('wikipedia').languages, ['zh', 'en'])
  assert.deepEqual(d('hackernews').languages, ['en'])
  assert.deepEqual(d('hackernews').taskProfiles, ['experience', 'news_fact'])
  assert.deepEqual(d('stackexchange').taskProfiles, ['docs_code', 'experience'])
  assert.deepEqual(d('openalex').taskProfiles, ['academic'])
  assert.deepEqual(d('semanticscholar').taskProfiles, ['academic'])
  for (const id of ['wikipedia', 'hackernews', 'stackexchange', 'openalex', 'semanticscholar']) assert.ok(!d(id).resultKinds.includes('web'), id + ' is not a web engine for promotion')
  assert.deepEqual(d('openalex').supportedFilters, ['time_window'])
  assert.deepEqual(d('hackernews').supportedFilters, ['time_window'])
  assert.deepEqual(d('anysearch').languages, ['*'], 'AnySearch is never promoted by language')
  assert.deepEqual(d('searxng').languages, ['*'])
  assert.equal(d('wikipedia').verification?.live, true)
  assert.equal(d('semanticscholar').verification?.live, false, 'only a 429 was recorded live')
  assert.equal(d('searxng').verification?.live, false)
  assert.equal(d('anysearch').sourceFamily, undefined, 'unknown upstream index stays unknown')
})

test('S1 plans: the vertical sources serve academic / experience, never displace the web engines, and wikipedia / stackoverflow stay second-round supplements', () => {
  // Exa is reachable only through the keyless MCP fallback here: not promoted
  const ready = (id?: string) => ({ state: 'ready' as const, credential: id === 'exa' || KEYED_SOURCE_IDS.includes(id ?? '') ? 'missing' as const : 'not_required' as const })
  const descriptors = defaultProviderRegistry.list({ operation: 'search' }).map(a => a.descriptor)
  const task = (goal: string, query: string, profile: any) => ({ goal, query, profile, needs: [{ id: 'n1', text: goal, critical: true }], constraints: [], budget: {} })
  const plan = (t: ReturnType<typeof task>, over: object = {}) => planSources(t, { configured: ['ddg', 'bing', 'exa', 'seam', 'jina'], status: ready, descriptors, ...over })
  const academic = plan(task('survey of retrieval augmented generation', 'retrieval augmented generation survey', 'academic'))
  assert.deepEqual(academic.providers.map(p => p.id), ['arxiv', 'openalex', 'pubmed', 'semanticscholar'])
  const exp = plan(task('what do developers think of Bun in production', 'bun production experience', 'experience'))
  assert.ok(exp.providers.some(p => p.id === 'hackernews') && !exp.providers.some(p => p.id === 'v2ex'), 'English experience: Hacker News in, V2EX out of the first plan')
  const code = plan(task('fix a Postgres error', 'postgres replication slot error', 'docs_code'))
  assert.deepEqual(code.providers.map(p => p.id), ['ddg', 'bing', 'github'])
  assert.ok(code.wanted.includes('stackexchange') && !code.providers.some(p => p.id === 'stackexchange'))
  for (const p of [academic, exp, code, plan(task('background of Raft', 'raft consensus', 'general')), plan(task('latest Go release', 'go release', 'news_fact'))]) {
    assert.ok(!p.providers.some(x => ['anysearch', 'searxng'].includes(x.id)), 'the keyless / self-hosted web engines are not planned by default')
  }
  const general = plan(task('background of Raft', 'raft consensus', 'general'))
  assert.equal(general.wanted.at(-1), 'wikipedia')
  assert.ok(!general.providers.some(p => p.id === 'wikipedia'), 'a supplement, not part of round 1')
})

test('native filter compilation: a hard time_window becomes `since` (exact lower bound) for HN / Stack Exchange / OpenAlex, year-exact only for Semantic Scholar; language for Wikipedia / AnySearch', () => {
  const now = new Date('2026-10-02T00:00:00Z')
  const hard = (kind: Constraint['kind'], value: string, id = 'c1'): Constraint => ({ id, kind, value, strength: 'hard', origin: 'param' })
  const task = (constraints: Constraint[], q = 'rust async runtime') => ({ goal: q, query: q, needs: [{ id: 'n1', text: q, critical: true }], constraints })
  const hn = hackerNewsAdapter.compile!(task([hard('time_window', '2025 年以后'), hard('must_term', 'rust', 'c2')]), now)
  assert.equal(hn.options?.since, '2025-01-01T00:00:00.000Z')
  assert.deepEqual(hn.native, ['c1'])
  assert.deepEqual(hn.local, ['c2'], 'the rest stays local')
  const soft = hackerNewsAdapter.compile!(task([{ ...hard('time_window', '2025'), strength: 'soft' }]), now)
  assert.equal(soft.options, undefined, 'soft constraints are never pushed down')
  assert.deepEqual(soft.local, ['c1'])
  for (const adapter of [stackExchangeAdapter, openAlexAdapter]) assert.equal(adapter.compile!(task([hard('time_window', 'past 30 days')]), now).options?.since, '2026-09-02T00:00:00.000Z')
  const s2 = semanticScholarAdapter.compile!(task([hard('time_window', 'past 30 days')]), now)
  assert.equal(s2.options, undefined, 'a year filter cannot express 30 days: left for local verification')
  assert.deepEqual(s2.local, ['c1'])
  assert.equal(semanticScholarAdapter.compile!(task([hard('time_window', '2024')]), now).options?.since, '2024-01-01T00:00:00.000Z')
  assert.equal(wikipediaAdapter.compile!(task([], '大语言模型 备案'), now).options?.lang, 'zh')
  assert.equal(wikipediaAdapter.compile!(task([], 'raft consensus'), now).options?.lang, 'en')
  assert.equal(anySearchAdapter.compile!(task([], '大模型'), now).options?.lang, 'zh')
  assert.equal(compileSince(task([hard('time_window', '2030')]), 'x', now, { since: true }).options, undefined, 'a lower bound in the future is not pushed down')
})

test('AND-matching sources (HN, Stack Exchange, Wikipedia) get a short keyword query with broader retries; OpenAlex and AnySearch keep the query', () => {
  const now = new Date('2026-10-02T00:00:00Z')
  const task = (query: string, constraints: Constraint[] = []) => ({ goal: query, query, needs: [{ id: 'n1', text: query, critical: true }], constraints })
  // the live check: keyword-stuffed task queries answered "no results" on every AND-matching source
  const long = task('Redis Cluster MULTI EXEC keys different hash slots CROSSSLOT supported hash tags')
  for (const adapter of [hackerNewsAdapter, stackExchangeAdapter, wikipediaAdapter]) {
    const c = adapter.compile!(long, now)
    assert.ok(c.query.split(' ').length <= 4 && c.query.split(' ').length >= 2, adapter.descriptor.id + ': ' + c.query)
    assert.ok(long.query.toLowerCase().includes(c.query.split(' ')[0]!), 'built from the task words')
    assert.deepEqual(c.fallbacks, [c.query.split(' ').slice(0, 3).join(' '), c.query.split(' ').slice(0, 2).join(' ')], 'broader retries with fewer terms')
  }
  // entities and must_terms lead, like the GitHub keyword query
  const entity: Constraint = { id: 'c1', kind: 'entity', value: 'CrowdStrike', strength: 'hard', origin: 'param' }
  assert.equal(wikipediaAdapter.compile!(task('CrowdStrike July 2024 outage root cause channel file 291', [entity]), now).query.split(' ')[0], 'crowdstrike')
  assert.equal(openAlexAdapter.compile!(long, now).query, long.query, 'OpenAlex ranks by relevance over many words: unchanged')
  assert.equal(anySearchAdapter.compile!(long, now).query, long.query)
  assert.equal(hackerNewsAdapter.compile!(task('x'), now).query, 'x', 'fewer than two keywords: sent as it is')
  assert.equal(hackerNewsAdapter.compile!(task('x'), now).fallbacks, undefined)
  // Chinese: Han terms come from entity / must_term constraints
  const zh = wikipediaAdapter.compile!(task('大模型 备案 最新 要求', [{ id: 'c1', kind: 'entity', value: '大模型备案', strength: 'hard', origin: 'param' }, { id: 'c2', kind: 'must_term', value: '算法备案', strength: 'hard', origin: 'param' }]), now)
  assert.equal(zh.query, '大模型备案 算法备案')
  assert.equal(zh.options?.lang, 'zh')
})

test('registered engines are created from the descriptors: every new adapter yields an engine whose id is its route id', () => {
  for (const id of ['wikipedia', 'hackernews', 'stackexchange', 'openalex', 'semanticscholar', 'anysearch', 'searxng']) {
    const adapter = defaultProviderRegistry.resolve(id)!
    const engine = adapter.create({ enableCli: false, opencliEnabled: false, agentReachEnabled: false, allowProxyFakeIp: false, skipSeam: false })
    assert.equal(engine.id, id)
    assert.equal(engine.available(), id !== 'searxng', id)
    assert.ok(adapter.descriptor.operations.includes('search'))
  }
})

// ── router wiring ───────────────────────────────────────────────────────────

test('router: searxng exists only with searxngUrl (config -> deps -> engine), counts its request in the ledger; keyless sources report no credential gap', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wsp-anon-router-'))
  const realFetch = globalThis.fetch
  const fetched: string[] = []
  globalThis.fetch = (async (url: unknown) => { fetched.push(String(url)); return reply(200, { results: [{ url: 'https://a.test/x', title: 'X', content: 'hit' }] }) }) as typeof fetch
  const base = { dbPath: path.join(dir, 'store.db'), enableCliBackends: false, opencliEnabled: false, agentReachEnabled: false }
  const store = new Store(base.dbPath)
  try {
    const off = new SearchRouter({ get: () => undefined } as never, resolveConfig({ ...base, engines: ['searxng'] } as never), store)
    const status = await off.providerStatuses(['searxng', 'wikipedia', 'openalex'])
    assert.equal(status.get('searxng')?.state, 'unavailable')
    assert.match(status.get('searxng')?.reason ?? '', /searxngUrl|unavailable/)
    assert.equal(status.get('wikipedia')?.state, 'ready')
    assert.equal(status.get('wikipedia')?.credential, 'not_required')
    assert.equal(status.get('openalex')?.credential, 'not_required', 'the optional key is not a gap')
    const none = await off.search({ query: 'q', count: 3, fresh: true, multi: false, signal: undefined }).catch(() => undefined)
    assert.deepEqual(none?.sources ?? [], [], 'nothing usable is not a result')
    assert.equal(fetched.length, 0, 'no instance configured: nothing is sent')

    const on = new SearchRouter({ get: () => undefined } as never, resolveConfig({ ...base, engines: ['searxng'], searxngUrl: 'http://127.0.0.1:8888' } as never), store)
    const result = await on.search({ query: 'rust', count: 3, fresh: true, multi: false, signal: undefined })
    assert.equal(result.engine, 'searxng')
    assert.deepEqual(result.sources.map(x => x.url), ['https://a.test/x'])
    assert.equal(fetched[0], 'http://127.0.0.1:8888/search?q=rust&format=json')
    const report = await on.providerReport()
    const sx = report.find(r => r.route === 'searxng')!
    assert.equal(sx.readiness.available, true)
    assert.equal(sx.readiness.health, 'ready')
    assert.equal(sx.unverified, true, 'never run against a real instance')
    assert.equal(report.find(r => r.route === 'wikipedia')!.unverified, undefined, 'verified live')
    assert.equal(report.find(r => r.route === 'semanticscholar')!.unverified, true)
    const ledger = new UsageLedger(store, resolveBudget().caps)
    assert.deepEqual(ledger.today().providers.map(p => [p.provider, p.requests]), [['searxng', 1]], 'the request is in the usage ledger (tokens n/a)')
  } finally {
    globalThis.fetch = realFetch
    store.close()
    fs.rmSync(dir, { recursive: true, force: true })
  }
})
