import test from 'node:test'
import assert from 'node:assert/strict'
import dns from 'node:dns/promises'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { resolveConfig } from '../src/config.ts'
import { createBuiltinRegistry } from '../src/providers/index.ts'
import { SearchRouter } from '../src/router.ts'
import { Store } from '../src/store.ts'
import { chainReport, resolveChain } from '../src/cli/chain.ts'
import { backendServes, platformBackendIssues } from '../src/cli/chains-spec.ts'
import { compileQuery } from '../src/pipeline/compile.ts'
import { noticesOf } from '../src/wechat/notices.ts'
import { WECHAT_DEFAULTS } from '../src/wechat/settings.ts'
import { accessProfileOf } from '../src/wechat/access.ts'
import { WSA_USAGE_PROVIDER, parseWsaPages, wsaBody, wsaCnt, wsaDate, wsaEngine, wsaErrorOf, wsaFailure, wsaFreshness, wsaQuery } from '../src/wechat/wsa.ts'
import { PUBLIC } from './keyed-harness.ts'

// 元宝搜索 is docs-only: no key exists, so nothing here (or anywhere) ever reaches the real service. The fetch is a stub that answers
// the shapes the documentation describes. The key is a distinctive string so a leak is easy to find.
const KEY = 'wsa-test-KEY-0123456789abcdefghij'
const NOW = Date.parse('2026-11-01T08:00:00Z')

const page = (over: Record<string, unknown> = {}): string => JSON.stringify({
  title: '大模型备案新规解读', url: 'https://mp.weixin.qq.com/s/AbCdEf', date: '2026-10-28 09:30:00', passage: '备案流程的最新变化', content: '更长的动态摘要', site: '某某公众号',
  score: 0.82, pics: [{ caption: 'c', origin_url: 'https://mmbiz.qpic.cn/x' }], ...over,
})
const ok = (pages: string[], extra: Record<string, unknown> = {}): Response => new Response(JSON.stringify({ Response: { Query: 'q', Pages: pages, Version: 'standard', RequestId: 'req-1', ...extra } }), { status: 200, headers: { 'content-type': 'application/json' } })
const fail = (Code: string, Message = 'm', status = 200): Response => new Response(JSON.stringify({ Response: { Error: { Code, Message }, RequestId: 'req-2' } }), { status, headers: { 'content-type': 'application/json' } })

interface Seen { url: string; method: string; headers: Record<string, string>; body: any; redirect: unknown }

function wsa(respond: (n: number) => Response, over: { usage?: any; settings?: Partial<typeof WECHAT_DEFAULTS.wsa>; key?: string | null } = {}) {
  const seen: Seen[] = []
  const recorded: any[] = []
  let used = 0
  const fetchImpl = (async (input: unknown, init: RequestInit) => {
    if (init.signal?.aborted) throw init.signal.reason
    seen.push({ url: String(input), method: String(init.method), headers: Object.fromEntries(Object.entries((init.headers ?? {}) as Record<string, string>).map(([k, v]) => [k.toLowerCase(), v])), body: init.body ? JSON.parse(String(init.body)) : undefined, redirect: init.redirect })
    return respond(seen.length - 1)
  }) as typeof fetch
  const usage = over.usage ?? { record: (e: any) => { recorded.push(e); used += e.requests }, today: () => used }
  const deps: any = { allowProxyFakeIp: false, enableCli: false, opencliEnabled: false, agentReachEnabled: false, skipSeam: false, fetchImpl, lookup: PUBLIC, usage, ...over.key === null ? {} : { wechatWsaKey: over.key ?? KEY } }
  const settings = { ...WECHAT_DEFAULTS.wsa, enabled: true, ...over.settings }
  return { seen, recorded, engine: wsaEngine(deps, settings, { now: () => NOW }), deps }
}

test('Cnt: the wanted count rounded up to 10/20/30/40/50, never above 50', () => {
  assert.deepEqual([1, 8, 10, 11, 20, 21, 35, 50, 51, 400, 0, -3, NaN].map(wsaCnt), [10, 10, 10, 20, 20, 30, 40, 50, 50, 50, 10, 10, 10])
})

test('Freshness: d<N> within 30 days, an inclusive date range beyond, nothing for a missing, future or invalid bound', () => {
  assert.equal(wsaFreshness('2026-10-25T08:00:00Z', NOW), 'd7')
  assert.equal(wsaFreshness('2026-10-31T12:00:00Z', NOW), 'd1')
  assert.equal(wsaFreshness('2026-10-02T08:00:00Z', NOW), 'd30')
  assert.equal(wsaFreshness('2026-09-01T00:00:00Z', NOW), '2026-09-01,2026-11-01')
  assert.equal(wsaFreshness('2025-01-01T00:00:00Z', NOW), '2025-01-01,2026-11-01')
  assert.equal(wsaFreshness('2027-01-01T00:00:00Z', NOW), undefined)
  assert.equal(wsaFreshness('soon', NOW), undefined)
  assert.equal(wsaFreshness(undefined, NOW), undefined)
})

test('the request body per edition: lite sends neither Mode nor Cnt; Site is always mp.weixin.qq.com; Freshness only with a bound', () => {
  assert.deepEqual(wsaBody('大模型 备案', 8, { edition: 'standard', mode: 2 }, undefined, NOW), { Query: '大模型 备案', Site: 'mp.weixin.qq.com', Cnt: 10, Mode: 2 })
  assert.deepEqual(wsaBody('q', 25, { edition: 'flagship', mode: 0 }, { since: '2026-10-25T00:00:00Z' }, NOW), { Query: 'q', Site: 'mp.weixin.qq.com', Cnt: 30, Mode: 0, Freshness: 'd8' })
  assert.deepEqual(wsaBody('q', 25, { edition: 'lite', mode: 2 }, { since: '2026-01-01T00:00:00Z' }, NOW), { Query: 'q', Site: 'mp.weixin.qq.com', Freshness: '2026-01-01,2026-11-01' })
  const long = '微'.repeat(900)
  assert.ok(Buffer.byteLength(wsaQuery(long), 'utf8') <= 1500)
  assert.equal(wsaQuery('  a \n b  '), 'a b')
})

test('Pages are JSON strings parsed again: title, url, summary from passage, date as China time; pics and images both fine; bad entries skipped and counted', () => {
  const out = parseWsaPages([
    page(),
    page({ url: 'https://mp.weixin.qq.com/s/Img', title: '用 images 键', pics: undefined, images: [{ caption: 'c', origin_url: 'u' }], date: '2026-10-20' }),
    'not json {',
    JSON.stringify(['array']),
    page({ url: 'javascript:alert(1)' }),
    page({ url: '' }),
    page({ url: 'https://mp.weixin.qq.com/s/AbCdEf' }),
    page({ url: 'https://mp.weixin.qq.com/s/NoPassage', passage: '', content: '只有 content' }),
    { title: '已是对象', url: 'https://mp.weixin.qq.com/s/Obj', passage: 'object entry', date: 1793000000 },
    42, null,
  ])
  assert.equal(out.skipped, 7)
  assert.deepEqual(out.sources.map(s => s.url), ['https://mp.weixin.qq.com/s/AbCdEf', 'https://mp.weixin.qq.com/s/Img', 'https://mp.weixin.qq.com/s/NoPassage', 'https://mp.weixin.qq.com/s/Obj'])
  assert.deepEqual(out.sources[0], { url: 'https://mp.weixin.qq.com/s/AbCdEf', title: '大模型备案新规解读', snippet: '备案流程的最新变化', publishedAt: '2026-10-28T01:30:00.000Z' })
  assert.equal(out.sources[1]!.publishedAt, '2026-10-19T16:00:00.000Z')
  assert.equal(out.sources[2]!.snippet, '只有 content')
  assert.equal(out.sources[3]!.publishedAt, new Date(1793000000 * 1000).toISOString())
  assert.deepEqual(parseWsaPages(undefined), { sources: [], skipped: 0 })
  assert.equal(wsaDate('whenever'), undefined)
  assert.equal(wsaDate('2026-10-28T09:30:00Z'), '2026-10-28T09:30:00.000Z')
})

test('the error envelope: Response.Error, a top-level Code / Message, or Error', () => {
  assert.deepEqual(wsaErrorOf({ Response: { Error: { Code: 'AuthFailure.SignatureFailure', Message: 'bad' } } }), { code: 'AuthFailure.SignatureFailure', message: 'bad' })
  assert.deepEqual(wsaErrorOf({ Code: 'UnauthorizedOperation', Message: 'no' }), { code: 'UnauthorizedOperation', message: 'no' })
  assert.deepEqual(wsaErrorOf({ Error: { Code: 'InternalError' } }), { code: 'InternalError', message: '' })
  assert.equal(wsaErrorOf({ Response: { Pages: [] } }), undefined)
  assert.equal(wsaErrorOf('x'), undefined)
})

test('every documented error maps to a code, retryability and (for setup problems) the wechat.wsa-setup action notice', () => {
  const map = (code: string) => { const e = wsaFailure({ code, message: 'detail' }, KEY); return { code: e.code, retryable: e.retryable, notices: noticesOf(e).map(n => [n.code, n.level]) } }
  for (const code of ['ResourceNotFound', 'UnauthorizedOperation', 'AuthFailure.InvalidAuthorization', 'AuthFailure.SignatureFailure', 'AuthFailure.UnauthorizedOperation']) {
    assert.deepEqual(map(code), { code: 'ENGINE_AUTH', retryable: false, notices: [['wechat.wsa-setup', 'action']] }, code)
  }
  assert.deepEqual(map('ResourceUnavailable'), { code: 'ENGINE_QUOTA', retryable: false, notices: [['wechat.wsa-setup', 'action']] })
  assert.deepEqual(map('RequestLimitExceeded'), { code: 'ENGINE_RATE_LIMIT', retryable: true, notices: [] })
  assert.deepEqual(map('RequestLimitExceeded.UinLimitExceeded'), { code: 'ENGINE_RATE_LIMIT', retryable: true, notices: [] })
  assert.deepEqual(map('InvalidParameter'), { code: 'ENGINE_ERROR', retryable: false, notices: [] })
  assert.deepEqual(map('InternalError'), { code: 'ENGINE_ERROR', retryable: true, notices: [] })
  assert.match(noticesOf(wsaFailure({ code: 'ResourceUnavailable', message: '' }))[0]!.message, /欠费/)
  assert.match(noticesOf(wsaFailure({ code: 'ResourceNotFound', message: '' }))[0]!.message, /未开通/)
})

test('a search: POST to /SearchPro with the Bearer key, the documented body, no redirect; sources, paid notice with today\'s usage, one ledger row', async () => {
  const s = wsa(() => ok([page(), page({ url: 'https://mp.weixin.qq.com/s/Two', title: '第二篇' })]))
  const out = await s.engine.search('大模型 备案', 8, undefined, { since: '2026-10-25T00:00:00Z' })
  assert.equal(s.seen.length, 1)
  const req = s.seen[0]!
  assert.equal(req.url, 'https://api.wsa.cloud.tencent.com/SearchPro')
  assert.equal(req.method, 'POST')
  assert.equal(req.headers.authorization, 'Bearer ' + KEY)
  assert.match(req.headers['content-type']!, /^application\/json/)
  assert.deepEqual(req.body, { Query: '大模型 备案', Site: 'mp.weixin.qq.com', Cnt: 10, Mode: 2, Freshness: 'd8' })
  assert.equal(out.backend, 'tencent-wsa')
  assert.equal(out.sources.length, 2)
  assert.deepEqual(s.recorded.map(r => [r.provider, r.protocol, r.requests]), [[WSA_USAGE_PROVIDER, 'search', 1]])
  assert.deepEqual(out.notices!.map(n => n.code), ['wechat.paid'])
  assert.match(out.notices![0]!.message, /标准版 20 元\/千次.*今日已用 1\/100/)
  const again = await s.engine.search('q2', 3)
  assert.match(again.notices![0]!.message, /今日已用 2\/100/)
  assert.doesNotMatch(JSON.stringify([out, again]), new RegExp(KEY))
})

test('results are trimmed to the requested count after the API rounded Cnt up; lite and a custom base URL', async () => {
  const pages = Array.from({ length: 10 }, (_, i) => page({ url: 'https://mp.weixin.qq.com/s/' + i }))
  const s = wsa(() => ok(pages), { settings: { edition: 'lite', baseUrl: 'https://wsa.example.com/' } })
  const out = await s.engine.search('q', 3)
  assert.equal(out.sources.length, 3)
  assert.equal(s.seen[0]!.url, 'https://wsa.example.com/SearchPro')
  assert.deepEqual(s.seen[0]!.body, { Query: 'q', Site: 'mp.weixin.qq.com' })
  assert.match(out.notices![0]!.message, /极速版 14 元\/千次/)
})

test('Msg "hit black query" with no pages is an empty answer with the message, still counted and paid; unreadable pages are noted', async () => {
  const s = wsa(() => ok([], { Msg: 'hit black query' }))
  await assert.rejects(s.engine.search('q', 5), (e: any) => e.code === 'ENGINE_EMPTY' && /Msg: hit black query/.test(e.message) && noticesOf(e).some(n => n.code === 'wechat.paid'))
  assert.equal(s.recorded.length, 1)
  const partial = wsa(() => ok(['bad json', page()]))
  const out = await partial.engine.search('q', 5)
  assert.equal(out.sources.length, 1)
  assert.ok(out.notes!.some(n => /1 unreadable page\(s\) skipped/.test(n)))
})

test('error answers: Tencent codes inside HTTP 200, HTTP 401/403/429/5xx, a body that is not the envelope; a failed request is not counted and the key never appears', async () => {
  const cases: [string, Response, string, boolean][] = [
    ['ResourceNotFound', fail('ResourceNotFound', 'user resource not opened'), 'ENGINE_AUTH', false],
    ['UnauthorizedOperation', fail('UnauthorizedOperation', 'check ' + KEY), 'ENGINE_AUTH', false],
    ['AuthFailure', fail('AuthFailure.InvalidSecretId', ''), 'ENGINE_AUTH', false],
    ['ResourceUnavailable', fail('ResourceUnavailable'), 'ENGINE_QUOTA', false],
    ['RequestLimitExceeded', fail('RequestLimitExceeded'), 'ENGINE_RATE_LIMIT', true],
    ['top-level Code', new Response(JSON.stringify({ Code: 'UnauthorizedOperation', Message: 'x' })), 'ENGINE_AUTH', false],
    ['HTTP 401', new Response('nope', { status: 401 }), 'ENGINE_AUTH', false],
    ['HTTP 403', new Response('{"x":1}', { status: 403 }), 'ENGINE_AUTH', false],
    ['HTTP 429', new Response('slow', { status: 429 }), 'ENGINE_RATE_LIMIT', true],
    ['HTTP 502', new Response('bad gateway', { status: 502 }), 'ENGINE_ERROR', true],
    ['HTTP 400', new Response('bad', { status: 400 }), 'ENGINE_ERROR', false],
    ['no envelope', new Response('{"hello":1}'), 'ENGINE_ERROR', true],
    ['not json', new Response('<html>'), 'ENGINE_ERROR', true],
  ]
  for (const [name, response, code, retryable] of cases) {
    const s = wsa(() => response.clone())
    await assert.rejects(s.engine.search('q', 5), (e: any) => {
      assert.equal(e.code, code, name)
      assert.equal(e.retryable, retryable, name)
      assert.doesNotMatch(e.message + JSON.stringify(noticesOf(e)), new RegExp(KEY), name)
      return true
    })
    assert.equal(s.recorded.length, 0, name + ' is not counted')
  }
  const setup = wsa(() => fail('ResourceNotFound'))
  await assert.rejects(setup.engine.search('q', 5), (e: any) => noticesOf(e).some(n => n.code === 'wechat.wsa-setup' && n.level === 'action' && /ResourceNotFound/.test(n.message)))
})

test('a transport failure and a redirect are refused without the key in the message', async () => {
  const boom = wsa(() => { throw new Error('connect ECONNREFUSED while sending Authorization: Bearer ' + KEY) })
  await assert.rejects(boom.engine.search('q', 5), (e: any) => e.code === 'ENGINE_ERROR' && !e.message.includes(KEY))
  const redirect = wsa(() => new Response(null, { status: 302, headers: { location: 'https://evil.example/' } }))
  await assert.rejects(redirect.engine.search('q', 5), (e: any) => /redirect/i.test(e.message) && !e.message.includes(KEY))
  assert.equal(redirect.seen.length, 1, 'the redirect was not followed')
  const lookup = wsa(() => ok([page()]))
  const blocked = wsaEngine({ ...lookup.deps, lookup: async () => [{ address: '10.0.0.5', family: 4 }] }, { ...WECHAT_DEFAULTS.wsa, enabled: true })
  await assert.rejects(blocked.search('q', 5), (e: any) => e.code === 'ENGINE_UNAVAILABLE' && /public addresses/.test(e.message))
  assert.equal(lookup.seen.length, 0, 'the SSRF check stops a private endpoint before any request')
})

test('abort: a cancelled signal stops the request', async () => {
  const s = wsa(() => ok([page()]))
  const controller = new AbortController()
  controller.abort(new Error('cancelled by caller'))
  await assert.rejects(s.engine.search('q', 5, controller.signal), /cancelled by caller/)
  assert.equal(s.recorded.length, 0)
})

test('the daily limit comes from the ledger: at the limit nothing is sent, the error is not retryable and carries the wechat.wsa-limit warning', async () => {
  const s = wsa(() => ok([page()]), { settings: { dailyLimit: 2 } })
  await s.engine.search('a', 5)
  await s.engine.search('b', 5)
  await assert.rejects(s.engine.search('c', 5), (e: any) => e.code === 'ENGINE_BUDGET' && e.retryable === false && /2\/2/.test(e.message) && noticesOf(e).some(n => n.code === 'wechat.wsa-limit' && n.level === 'warn' && /今日已用 2\/2/.test(n.message)))
  assert.equal(s.seen.length, 2)
  const noLedger = wsa(() => ok([page()]), { usage: { record: () => {} }, settings: { dailyLimit: 1 } })
  await noLedger.engine.search('a', 5)
  await noLedger.engine.search('b', 5)
  assert.equal(noLedger.seen.length, 2, 'without a ledger count there is nothing to enforce')
})

test('availability: off, no key (named reasons), on with a key; a call while unavailable is refused without a request', async () => {
  const off = wsa(() => ok([page()]), { settings: { enabled: false } })
  assert.equal(off.engine.available(), false)
  assert.match(off.engine.unavailableReason!()!, /wechat\.wsa\.enabled/)
  await assert.rejects(off.engine.search('q', 5), (e: any) => e.code === 'ENGINE_UNAVAILABLE')
  const keyless = wsa(() => ok([page()]), { key: null })
  assert.equal(keyless.engine.available(), false)
  assert.match(keyless.engine.unavailableReason!()!, /no API key.*TENCENT_WSA_API_KEY/)
  assert.equal(wsa(() => ok([page()])).engine.available(), true)
  assert.equal(off.seen.length + keyless.seen.length, 0)
})

// ── the chain ───────────────────────────────────────────────────────────────

function chainHarness(extra: Record<string, unknown> = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wsp-wsa-'))
  const config = resolveConfig({ engines: ['ddg'], dbPath: path.join(dir, 'store.db'), enableCliBackends: false, opencliEnabled: false, agentReachEnabled: false, ttlSeconds: 60, ...extra } as never)
  const store = new Store(config.dbPath)
  const router = new SearchRouter({ get: () => undefined } as never, config, store, () => config, () => undefined, undefined, createBuiltinRegistry())
  const deps = (key?: string): any => ({ enableCli: false, opencliEnabled: false, agentReachEnabled: false, allowProxyFakeIp: false, skipSeam: false, ...key ? { wechatWsaKey: key } : {} })
  return { dir, config, store, router, deps, cleanup: () => { router.dispose(); store.close(); fs.rmSync(dir, { recursive: true, force: true }) } }
}

function stubNetwork(respond: (url: string, init: any) => Response | undefined) {
  const originalLookup = dns.lookup
  const originalFetch = globalThis.fetch
  const calls: { url: string; init: any }[] = []
  dns.lookup = (async () => [{ address: '93.184.216.34', family: 4 }]) as typeof dns.lookup
  globalThis.fetch = (async (input: any, init: any) => {
    const url = String(input?.url ?? input)
    calls.push({ url, init })
    return respond(url, init) ?? new Response('not found', { status: 404 })
  }) as typeof fetch
  return { calls, restore: () => { dns.lookup = originalLookup; globalThis.fetch = originalFetch } }
}

test('tencent-wsa is a fixed backend that serves only wechat, with an api-key / low-risk / billed access profile', () => {
  assert.equal(backendServes('tencent-wsa', 'wechat', new Map()).ok, true)
  assert.match(backendServes('tencent-wsa', 'zhihu', new Map()).why!, /does not serve platform zhihu/)
  assert.deepEqual(platformBackendIssues({ wechat: ['tencent-wsa', 'sogou'] }, undefined), [])
  assert.deepEqual(platformBackendIssues({ twitter: ['tencent-wsa'] }, undefined), ['platformBackends.twitter: "tencent-wsa" does not serve platform twitter'])
  const profile = accessProfileOf('wechat', 'tencent-wsa')!
  assert.deepEqual([profile.login, profile.risk], ['api-key', 'low'])
  assert.match(profile.billing!, /14.*20.*26 元每千次/)
  assert.ok(profile.riskNotes.some(n => /docs-only/.test(n)))
})

test('chain position: off = not in the default chain at all; enabled = first; an explicit platformBackends.wechat keeps the order written (and omits the leg unless written)', () => {
  const ids = (extra: Record<string, unknown>, key?: string): string[] => { const h = chainHarness(extra); try { return resolveChain('wechat', { deps: h.deps(key), config: h.config }).legs.map(l => l.id) } finally { h.cleanup() } }
  assert.deepEqual(ids({}), ['omnireach', 'wx-search-cli', 'sogou'])
  assert.deepEqual(ids({ wechat: { wsa: { enabled: false } } }, KEY), ['omnireach', 'wx-search-cli', 'sogou'], 'a key alone does not turn it on')
  assert.deepEqual(ids({ wechat: { wsa: { enabled: true } } }, KEY), ['tencent-wsa', 'omnireach', 'wx-search-cli', 'sogou'])
  assert.deepEqual(ids({ wechat: { wsa: { enabled: true } } }), ['tencent-wsa', 'omnireach', 'wx-search-cli', 'sogou'], 'enabled without a key is still shown (skipped with its reason)')
  assert.deepEqual(ids({ wechat: { wsa: { enabled: true } }, platformBackends: { wechat: ['sogou', 'tencent-wsa'] } }, KEY), ['sogou', 'tencent-wsa'])
  assert.deepEqual(ids({ wechat: { wsa: { enabled: true } }, platformBackends: { wechat: ['sogou'] } }, KEY), ['sogou'], 'the user\'s list wins: the leg is used only where written')
  assert.deepEqual(ids({ platformBackends: { wechat: ['tencent-wsa'] } }, KEY), ['tencent-wsa'], 'written explicitly it is in the chain even if wsa.enabled is false (and then skipped as disabled)')
})

test('chainReport: disabled it is listed after the chain as available-to-configure (docs-only, with its access profile); enabled it is first; keyless it says what is missing', async () => {
  const off = chainHarness()
  try {
    const report = await chainReport('wechat', { deps: off.deps(), config: off.config })
    assert.deepEqual(report.entries.map(e => [e.id, e.state]), [['omnireach', 'skipped'], ['wx-search-cli', 'skipped'], ['sogou', 'ready'], ['tencent-wsa', 'skipped']])
    const entry = report.entries.at(-1)!
    assert.match(entry.reason!, /not in the chain.*wechat\.wsa\.enabled/)
    assert.equal(entry.verification, 'docs-only')
    assert.equal(entry.access!.login, 'api-key')
    assert.equal(report.available, true, 'the unlisted paid leg never changes what is available')
  } finally { off.cleanup() }
  const on = chainHarness({ wechat: { wsa: { enabled: true } } })
  try {
    const keyless = await chainReport('wechat', { deps: on.deps(), config: on.config })
    assert.equal(keyless.entries[0]!.id, 'tencent-wsa')
    assert.equal(keyless.entries[0]!.state, 'skipped')
    assert.equal(keyless.entries[0]!.credential, 'missing')
    assert.match(keyless.entries[0]!.reason!, /no API key/)
    const ready = await chainReport('wechat', { deps: on.deps(KEY), config: on.config })
    assert.deepEqual([ready.entries[0]!.id, ready.entries[0]!.state, ready.entries[0]!.credential], ['tencent-wsa', 'ready', 'configured'])
  } finally { on.cleanup() }
})

test('router end to end: enabled with a literal key the wechat search goes to 元宝搜索 first, books the ledger, enforces the daily limit and falls through to the next leg', async () => {
  const h = chainHarness({ wechat: { wsa: { enabled: true, apiKey: KEY, dailyLimit: 2 }, sogou: { minIntervalMs: 0 } }, platformBackends: undefined })
  const net = stubNetwork((url, init) => url.startsWith('https://api.wsa.cloud.tencent.com/SearchPro') ? ok([page({ url: 'https://mp.weixin.qq.com/s/R' + net.calls.length })]) : undefined)
  try {
    const first = await h.router.search({ query: '备案 一', count: 5, fresh: true, multi: false, signal: undefined, platform: { id: 'wechat' } as never })
    assert.equal(first.backend, 'tencent-wsa')
    assert.deepEqual(first.notices?.map(n => n.code), ['wechat.paid'])
    assert.equal(net.calls[0]!.init.headers.authorization, 'Bearer ' + KEY)
    await h.router.search({ query: '备案 二', count: 5, fresh: true, multi: false, signal: undefined, platform: { id: 'wechat' } as never })
    const day = new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
    assert.equal(h.store.requestCounts(WSA_USAGE_PROVIDER, day).today, 2, 'both requests are in the usage ledger')
    // Third search: the limit is reached; the chain moves on (every later leg is unavailable here, so the search fails) and says why.
    await assert.rejects(h.router.search({ query: '备案 三', count: 5, fresh: true, multi: false, signal: undefined, platform: { id: 'wechat' } as never }), (e: any) => /tencent-wsa: Tencent WSA daily limit reached \(2\/2/.test(e.message) && noticesOf(e).some(n => n.code === 'wechat.wsa-limit'))
    assert.equal(net.calls.filter(c => c.url.includes('wsa.cloud.tencent.com')).length, 2, 'no third request was sent')
    assert.doesNotMatch(JSON.stringify(h.store.listQueries({ kind: 'platform' })), new RegExp(KEY))
  } finally { net.restore(); h.cleanup() }
})

test('the wechat time window compiles to options.since (not native: the local check still applies); other platforms are unaffected', () => {
  const task = { goal: 'g', query: '备案', needs: [], constraints: [{ id: 'c1', kind: 'time_window', value: 'last 7 days', strength: 'hard', origin: 'param' }], budget: {} } as never
  const compiled = compileQuery(task, 'wechat', new Date('2026-11-01T08:00:00Z'))
  assert.equal(compiled.options?.since, '2026-10-25T08:00:00.000Z')
  assert.deepEqual(compiled.native, [])
  assert.deepEqual(compiled.local, ['c1'])
  assert.equal(compileQuery({ ...(task as object), constraints: [] } as never, 'wechat').options, undefined)
})

test('the whole plugin: search.run platform=wechat shows the paid notice once (wechat.notices once) and never with notices off; the key stays out of the output', async () => {
  const { bootPlugin } = await import('./plugin-harness.ts')
  const net = stubNetwork(url => url.startsWith('https://api.wsa.cloud.tencent.com/SearchPro') ? ok([page()]) : undefined)
  const once = bootPlugin({ wechat: { wsa: { enabled: true, apiKey: KEY } } })
  const off = bootPlugin({ wechat: { wsa: { enabled: true, apiKey: KEY }, notices: 'off' } })
  try {
    const first = await once.envelope('search.run', { query: '备案', platform: 'wechat', fresh: true })
    assert.equal(first.ok, true, JSON.stringify(first.error))
    assert.deepEqual(first.result.notices.map((n: any) => n.code), ['wechat.paid', 'wechat.signed-url'].filter(code => first.result.notices.some((n: any) => n.code === code)))
    assert.ok(first.result.notices.some((n: any) => n.code === 'wechat.paid'))
    assert.equal(first.result.engine, 'wechat')
    const second = await once.envelope('search.run', { query: '备案 2', platform: 'wechat', fresh: true })
    assert.equal(second.result.notices, undefined, 'once: the second search is quiet')
    const quiet = await off.envelope('search.run', { query: '备案', platform: 'wechat', fresh: true })
    assert.equal(quiet.result.notices, undefined)
    assert.doesNotMatch(JSON.stringify([first, second, quiet]), new RegExp(KEY))
  } finally { net.restore(); once.cleanup(); off.cleanup() }
})
