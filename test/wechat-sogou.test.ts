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
import { EngineError } from '../src/engine-error.ts'
import { chainReport, resolveChain } from '../src/cli/chain.ts'
import { DEFAULT_CHAINS, backendServes, platformBackendIssues } from '../src/cli/chains-spec.ts'
import { chainEngine } from '../src/providers/platforms.ts'
import { noticesOf } from '../src/wechat/notices.ts'
import { wechatSettings, WECHAT_DEFAULTS } from '../src/wechat/settings.ts'
import {
  CookieJar, createThrottle, dropSharedSession, isAntispider, isSogouLink, parseSogouLinkPage, parseSogouResults, resetSogouBlock, resolveSogouLink, sogouEngine, sogouSearch,
  type SogouIo, type Throttle,
} from '../src/wechat/sogou.ts'
import { accessProfileOf, renderAccess } from '../src/wechat/access.ts'
import { PUBLIC } from './keyed-harness.ts'

// Fixtures under test/fixtures/wechat were captured anonymously on 2026-11-01 (weixin.sogou.com search page, a /link page, the
// anti-spider page) and trimmed; the links, tokens and the signature are placeholders. Everything here runs offline.
const fx = (name: string): string => fs.readFileSync(new URL('./fixtures/wechat/' + name, import.meta.url), 'utf8')
const SEARCH = fx('sogou-search.html')
const LINK = fx('sogou-link.html')
const ANTISPIDER = fx('sogou-antispider.html')
const SIGNED = 'https://mp.weixin.qq.com/s?src=11&timestamp=1793462540&ver=7060&signature=FIXTURESIGNATURE-ab*cd&new=1'

interface Call { url: string; headers: Record<string, string> }

/** A fake Sogou: the search page sets SNUID, /link answers the link fixture unless told otherwise. */
function sogou(over: { search?: () => Response; link?: (n: number) => Response } = {}) {
  const calls: Call[] = []
  let links = 0
  const fetchImpl = (async (input: unknown, init: RequestInit) => {
    const url = String(input)
    calls.push({ url, headers: Object.fromEntries(Object.entries((init?.headers ?? {}) as Record<string, string>).map(([k, v]) => [k.toLowerCase(), v])) })
    const u = new URL(url)
    if (u.pathname === '/weixin') return over.search?.() ?? new Response(SEARCH, { status: 200, headers: [['content-type', 'text/html; charset=utf-8'], ['set-cookie', 'SNUID=snuid-1; path=/; domain=.sogou.com'], ['set-cookie', 'SUID=suid-1; path=/']] })
    if (u.pathname === '/link') return over.link?.(links++) ?? new Response(LINK, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } })
    return new Response('not found', { status: 404 })
  }) as typeof fetch
  const waits: number[] = []
  const throttle: Throttle = { wait: async ms => { waits.push(ms) } }
  const io = (over2: Partial<SogouIo> = {}): SogouIo => ({ allowProxyFakeIp: false, signal: undefined, minIntervalMs: 1500, throttle, fetchImpl, lookup: PUBLIC, ...over2 })
  return { calls, waits, throttle, fetchImpl, io }
}

const antispiderReply = (): Response => new Response(ANTISPIDER, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } })

test.beforeEach(() => { resetSogouBlock(); dropSharedSession() })

test('parseSogouResults: title (highlight markers stripped, no stray spaces), summary, account, time from timeConvert, absolute link', () => {
  const items = parseSogouResults(SEARCH)
  assert.equal(items.length, 4)
  assert.deepEqual(items[0], {
    title: 'AI Agent如何拼落地?十大领域30款产品盘点,这些赛道最热',
    summary: '一文看尽AI Agent落地与应用方向.作者 | 王吉伟GPT-4再次重磅更新,推出了整合了画图、插件、代码等所有工具的All Tools功能....',
    account: '智东西',
    publishedAt: '2024-01-25T12:53:03.000Z',
    link: 'https://weixin.sogou.com/link?url=FIXTURE-LINK-0&type=2&query=AI%20Agent%20%E8%90%BD%E5%9C%B0&token=FIXTURETOKEN',
  })
  assert.equal(items[1]!.account, '机器之心')
  // No summary and no time: the item is kept, the fields are just absent; entities in the title are decoded.
  assert.deepEqual([items[3]!.title, items[3]!.summary, items[3]!.account, items[3]!.publishedAt], ['没有摘要的一篇 & 测试', '', '某某号', undefined])
  assert.deepEqual(parseSogouResults('<html><body>nothing here</body></html>'), [])
})

test('parseSogouLinkPage joins the url += chunks and removes @; a plain link in the page is a fallback; no target is undefined', () => {
  assert.equal(parseSogouLinkPage(LINK), SIGNED)
  assert.equal(parseSogouLinkPage('<script>window.location.replace("https://mp.weixin.qq.com/s?src=11&signature=ab@c")</script>'), 'https://mp.weixin.qq.com/s?src=11&signature=abc')
  assert.equal(parseSogouLinkPage('<html>no target</html>'), undefined)
  assert.equal(isSogouLink('https://weixin.sogou.com/link?url=abc&type=2'), true)
  assert.equal(isSogouLink('https://weixin.sogou.com/weixin?type=2'), false)
  assert.equal(isSogouLink('https://evil.test/link?url=abc'), false)
})

test('isAntispider: the redirect to /antispider/ and the captcha page are recognised, the result page is not', () => {
  assert.equal(isAntispider('https://weixin.sogou.com/antispider/?from=%2Flink', ''), true)
  assert.equal(isAntispider('https://weixin.sogou.com/link?url=x', ANTISPIDER), true)
  assert.equal(isAntispider('https://weixin.sogou.com/weixin?type=2', SEARCH), false)
  assert.equal(isAntispider('https://weixin.sogou.com/link?url=x', LINK), false)
})

test('CookieJar keeps names and values only, replaces and deletes', () => {
  const jar = new CookieJar()
  jar.absorb(new Headers([['set-cookie', 'SNUID=a; path=/; HttpOnly'], ['set-cookie', 'SUID=b; path=/']]))
  assert.equal(jar.header(), 'SNUID=a; SUID=b')
  jar.absorb(new Headers([['set-cookie', 'SNUID=c; path=/'], ['set-cookie', 'SUID=; max-age=0']]))
  assert.equal(jar.header(), 'SNUID=c')
  assert.equal(jar.has('SNUID'), true)
  assert.equal(new CookieJar().header(), undefined)
})

test('throttle: requests are spaced by the minimum interval, queued in order, and an aborted wait does not block the queue', async () => {
  let clock = 1_000
  const sleeps: number[] = []
  const throttle = createThrottle({ now: () => clock, sleep: async ms => { sleeps.push(ms); clock += ms } })
  const order: number[] = []
  await Promise.all([1, 2, 3].map(async n => { await throttle.wait(1500); order.push(n) }))
  assert.deepEqual(order, [1, 2, 3])
  assert.deepEqual(sleeps, [1500, 1500], 'the first request goes at once, the next two wait the full interval')
  clock += 400
  await throttle.wait(1500)
  assert.deepEqual(sleeps, [1500, 1500, 1100], 'only the rest of the interval is waited')
  clock += 5_000
  await throttle.wait(1500)
  assert.equal(sleeps.length, 3, 'a long pause needs no wait')
  const aborted = new AbortController()
  aborted.abort(new Error('stop'))
  await assert.rejects(throttle.wait(1500, aborted.signal), /stop/)
  await throttle.wait(0)
})

test('sogouSearch: signed links for the first N results, the rest keep the sogou link; cookies, referer and throttle on every request', async () => {
  const s = sogou()
  const out = await sogouSearch('AI Agent 落地', 4, s.io(), { resolveLinks: 2 })
  assert.deepEqual(out.sources.map(x => x.url), [SIGNED, SIGNED, parseSogouResults(SEARCH)[2]!.link, parseSogouResults(SEARCH)[3]!.link])
  assert.equal(out.sources[0]!.title, 'AI Agent如何拼落地?十大领域30款产品盘点,这些赛道最热')
  assert.match(out.sources[0]!.snippet!, /^智东西 · 一文看尽AI Agent落地/)
  assert.equal(out.sources[0]!.publishedAt, '2024-01-25T12:53:03.000Z')
  assert.equal(out.sources[3]!.snippet, '某某号 · ', 'an item without a summary still names its account')
  assert.match(out.notes.join('|'), /2 of 4 links resolved/)
  assert.deepEqual(out.notices, [])
  // One search page + two link pages; each went through the throttle with the configured interval.
  assert.equal(s.calls.length, 3)
  assert.deepEqual(s.waits, [1500, 1500, 1500])
  assert.match(s.calls[0]!.url, /^https:\/\/weixin\.sogou\.com\/weixin\?type=2&query=AI%20Agent%20%E8%90%BD%E5%9C%B0&page=1$/)
  assert.equal(s.calls[0]!.headers.referer, 'https://weixin.sogou.com/')
  assert.equal(s.calls[0]!.headers.cookie, undefined, 'the search itself carries no cookie yet')
  for (const call of s.calls.slice(1)) {
    assert.match(call.url, /^https:\/\/weixin\.sogou\.com\/link\?url=FIXTURE-LINK-\d/)
    assert.equal(call.headers.cookie, 'SNUID=snuid-1; SUID=suid-1', 'the cookies of the search response ride on the link requests')
    assert.match(call.headers['user-agent']!, /Chrome\/126/)
  }
})

test('sogouSearch: resolveLinks 0 makes one request; no parseable result is ENGINE_EMPTY', async () => {
  const s = sogou()
  const out = await sogouSearch('q', 2, s.io(), { resolveLinks: 0 })
  assert.equal(s.calls.length, 1)
  assert.equal(out.sources.length, 2)
  assert.ok(out.sources.every(x => x.url.startsWith('https://weixin.sogou.com/link?')))
  const empty = sogou({ search: () => new Response('<html><body>没有找到</body></html>') })
  await assert.rejects(sogouSearch('q', 5, empty.io(), { resolveLinks: 3 }), (e: any) => e instanceof EngineError && e.code === 'ENGINE_EMPTY')
})

test('antispider on the search page: ENGINE_RATE_LIMIT with the wechat.antispider notice; the leg then stays closed without asking Sogou again', async () => {
  const s = sogou({ search: antispiderReply })
  const error: any = await sogouSearch('q', 5, s.io(), { resolveLinks: 3 }).then(() => undefined, e => e)
  assert.ok(error instanceof EngineError)
  assert.equal(error.code, 'ENGINE_RATE_LIMIT')
  assert.equal(error.retryable, true)
  assert.ok(error.retryAfterMs > 0)
  assert.deepEqual(noticesOf(error).map(n => [n.level, n.code]), [['warn', 'wechat.antispider']])
  assert.match(noticesOf(error)[0]!.message, /反爬/)
  assert.equal(s.calls.length, 1)
  // Blocked: the second call fails at once, with the notice, and makes no request.
  const second: any = await sogouSearch('q', 5, s.io(), { resolveLinks: 3 }).then(() => undefined, e => e)
  assert.equal(second.code, 'ENGINE_RATE_LIMIT')
  assert.deepEqual(noticesOf(second).map(n => n.code), ['wechat.antispider'])
  assert.equal(s.calls.length, 1)
})

test('antispider through a redirect to /antispider/ is recognised the same way', async () => {
  const calls: string[] = []
  const fetchImpl = (async (input: unknown) => {
    const url = String(input)
    calls.push(url)
    if (url.includes('/antispider/')) return new Response(ANTISPIDER, { status: 200 })
    return new Response(null, { status: 302, headers: { location: '/antispider/?from=%2Fweixin' } })
  }) as typeof fetch
  const s = sogou()
  const error: any = await sogouSearch('q', 5, s.io({ fetchImpl }), { resolveLinks: 1 }).then(() => undefined, e => e)
  assert.equal(error.code, 'ENGINE_RATE_LIMIT')
  assert.equal(calls.length, 2)
})

test('antispider while resolving: the results found so far are kept, the rest stay sogou links, the notice rides on the outcome', async () => {
  const s = sogou({ link: n => (n === 0 ? new Response(LINK, { status: 200 }) : antispiderReply()) })
  const out = await sogouSearch('q', 4, s.io(), { resolveLinks: 3 })
  assert.equal(out.sources[0]!.url, SIGNED)
  assert.ok(out.sources.slice(1).every(x => x.url.startsWith('https://weixin.sogou.com/link?')))
  assert.deepEqual(out.notices.map(n => n.code), ['wechat.antispider'])
  assert.match(out.notes.join('|'), /stopped resolving/)
  assert.equal(s.calls.length, 3, 'the third link was never asked for')
})

test('resolveSogouLink: a lone link first runs the search it came from (SNUID is only set by a search), then resolves; the cookies are reused for the next link', async () => {
  const s = sogou()
  const link = parseSogouResults(SEARCH)[1]!.link
  const signed = await resolveSogouLink(link, s.io())
  assert.equal(signed, SIGNED)
  assert.equal(s.calls.length, 2)
  assert.match(s.calls[0]!.url, /\/weixin\?type=2&query=AI%20Agent%20%E8%90%BD%E5%9C%B0&page=1$/, 'the warm-up searches for the query named in the link')
  assert.equal(s.calls[1]!.headers.cookie, 'SNUID=snuid-1; SUID=suid-1')
  // The session is kept for a while (memory only): the next lone link needs no warm-up.
  await resolveSogouLink(parseSogouLinkOf(2), s.io())
  assert.equal(s.calls.length, 3)
})

function parseSogouLinkOf(i: number): string { return parseSogouResults(SEARCH)[i]!.link }

test('resolveSogouLink: antispider is ENGINE_RATE_LIMIT with the notice; a page without a target is an ENGINE_ERROR', async () => {
  const s = sogou({ link: () => antispiderReply() })
  await assert.rejects(resolveSogouLink(parseSogouLinkOf(0), s.io()), (e: any) => e.code === 'ENGINE_RATE_LIMIT' && noticesOf(e).some(n => n.code === 'wechat.antispider'))
  resetSogouBlock(); dropSharedSession()
  const none = sogou({ link: () => new Response('<html>moved</html>', { status: 200 }) })
  await assert.rejects(resolveSogouLink(parseSogouLinkOf(0), none.io()), (e: any) => e.code === 'ENGINE_ERROR' && /no mp\.weixin\.qq\.com target/.test(e.message))
})

test('abort: a cancelled signal stops the request before it goes out', async () => {
  const s = sogou()
  const controller = new AbortController()
  controller.abort(new Error('cancelled by caller'))
  const throttle = createThrottle()
  await assert.rejects(sogouSearch('q', 3, s.io({ signal: controller.signal, throttle }), { resolveLinks: 1 }), /cancelled by caller/)
  assert.equal(s.calls.length, 0)
})

test('settings: defaults, the optional wechat object of the configuration, and malformed values fall back', () => {
  assert.deepEqual(wechatSettings({}), WECHAT_DEFAULTS)
  assert.deepEqual(wechatSettings(undefined), WECHAT_DEFAULTS)
  assert.deepEqual(wechatSettings({ wechat: { notices: 'always', sogou: { enabled: false, resolveLinks: 5, minIntervalMs: 3000 } } }), { ...WECHAT_DEFAULTS, notices: 'always', sogou: { enabled: false, resolveLinks: 5, minIntervalMs: 3000 } })
  assert.deepEqual(wechatSettings({ wechat: { notices: 'loud', sogou: { enabled: 'no', resolveLinks: -4, minIntervalMs: 'fast' } } }), { ...WECHAT_DEFAULTS, notices: 'once', sogou: { enabled: true, resolveLinks: 0, minIntervalMs: 1500 } })
  assert.equal(wechatSettings({ wechat: { sogou: { resolveLinks: 99, minIntervalMs: 1e9 } } }).sogou.resolveLinks, 10)
  assert.equal(wechatSettings({ wechat: { sogou: { minIntervalMs: 1e9 } } }).sogou.minIntervalMs, 60_000)
  assert.equal(wechatSettings(resolveConfig({ wechat: { notices: 'off' } } as never)).notices, 'off', 'resolveConfig keeps the optional object')
})

test('the sogou engine: available only when enabled, names its backend, returns notes and notices on the outcome', async () => {
  const s = sogou({ link: n => (n === 0 ? new Response(LINK, { status: 200 }) : antispiderReply()) })
  const deps = { allowProxyFakeIp: false, enableCli: false, opencliEnabled: false, agentReachEnabled: false, skipSeam: false, fetchImpl: s.fetchImpl, lookup: PUBLIC } as never
  const off = sogouEngine(deps, { ...WECHAT_DEFAULTS.sogou, enabled: false })
  assert.equal(off.available(), false)
  assert.match(off.unavailableReason!()!, /wechat\.sogou\.enabled/)
  await assert.rejects(off.search('q', 3), (e: any) => e.code === 'ENGINE_UNAVAILABLE')
  const engine = sogouEngine(deps, { enabled: true, resolveLinks: 3, minIntervalMs: 0 }, { throttle: s.throttle })
  assert.equal(engine.backend, 'sogou')
  const out = await engine.search('q', 4)
  assert.equal(out.backend, 'sogou')
  assert.equal(out.sources[0]!.url, SIGNED)
  assert.deepEqual(out.notices!.map(n => n.code), ['wechat.antispider'])
  assert.ok(out.notes!.length)
})

// ── the chain ───────────────────────────────────────────────────────────────

function chainHarness(extra: Record<string, unknown> = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wsp-wechat-'))
  const config = resolveConfig({ engines: ['ddg'], dbPath: path.join(dir, 'store.db'), enableCliBackends: false, opencliEnabled: false, agentReachEnabled: false, ttlSeconds: 60, wechat: { sogou: { minIntervalMs: 0 } }, ...extra } as never)
  const store = new Store(config.dbPath)
  const router = new SearchRouter({ get: () => undefined } as never, config, store, () => config, () => undefined, undefined, createBuiltinRegistry())
  const deps = (): any => ({ enableCli: false, opencliEnabled: false, agentReachEnabled: false, allowProxyFakeIp: false, skipSeam: false })
  return { dir, config, store, router, deps, cleanup: () => { router.dispose(); store.close(); fs.rmSync(dir, { recursive: true, force: true }) } }
}

function stubNetwork(respond: (url: string) => Response | undefined) {
  const originalLookup = dns.lookup
  const originalFetch = globalThis.fetch
  const urls: string[] = []
  dns.lookup = (async () => [{ address: '93.184.216.34', family: 4 }]) as typeof dns.lookup
  globalThis.fetch = (async (input: any) => {
    const url = String(input?.url ?? input)
    urls.push(url)
    return respond(url) ?? new Response('not found', { status: 404 })
  }) as typeof fetch
  return { urls, restore: () => { dns.lookup = originalLookup; globalThis.fetch = originalFetch } }
}

test('the wechat default chain is omnireach, wx-search-cli, sogou; sogou serves only wechat and is a fixed backend', () => {
  assert.deepEqual(DEFAULT_CHAINS.wechat, ['omnireach', 'wx-search-cli', 'sogou'])
  const h = chainHarness()
  try {
    assert.deepEqual(resolveChain('wechat', { deps: h.deps(), config: h.config }).legs.map(l => [l.id, l.kind]), [['omnireach', 'cli'], ['wx-search-cli', 'cli'], ['sogou', 'sogou']])
    assert.equal(backendServes('sogou', 'wechat', new Map()).ok, true)
    assert.match(backendServes('sogou', 'zhihu', new Map()).why!, /does not serve platform zhihu/)
    assert.deepEqual(platformBackendIssues({ wechat: ['sogou'] }, undefined), [])
    assert.deepEqual(platformBackendIssues({ twitter: ['sogou'] }, undefined), ['platformBackends.twitter: "sogou" does not serve platform twitter'])
    const sogouOnly = chainHarness({ platformBackends: { wechat: ['sogou'] } })
    assert.deepEqual(resolveChain('wechat', { deps: sogouOnly.deps(), config: sogouOnly.config }).legs.map(l => l.id), ['sogou'])
    sogouOnly.cleanup()
  } finally { h.cleanup() }
})

test('chainReport: the sogou leg is ready without any CLI, carries its access profile, and a disabled one says why; the other wechat legs carry theirs', async () => {
  const h = chainHarness()
  try {
    const report = await chainReport('wechat', { deps: h.deps(), config: h.config })
    const sogouEntry = report.entries.find(e => e.id === 'sogou')!
    assert.deepEqual([sogouEntry.state, sogouEntry.installation, sogouEntry.credential, sogouEntry.verification], ['ready', 'not_required', 'not_required', 'live'])
    assert.equal(sogouEntry.access!.login, 'none')
    assert.equal(sogouEntry.access!.risk, 'medium')
    assert.ok(sogouEntry.access!.riskNotes.some(n => /antispider/.test(n)))
    assert.deepEqual(report.entries.map(e => [e.id, e.access?.login]), [['omnireach', 'none'], ['wx-search-cli', 'none'], ['sogou', 'none'], ['tencent-wsa', 'api-key']])
    assert.equal(report.available, true, 'wechat is usable with nothing installed')
    assert.equal(report.state, 'ready')
    assert.equal((await chainReport('twitter', { deps: h.deps(), config: h.config })).entries.every(e => e.access === undefined), true, 'platforms without a profile report none')
    const off = chainHarness({ wechat: { sogou: { enabled: false } }, platformBackends: { wechat: ['sogou'] } })
    const offReport = await chainReport('wechat', { deps: off.deps(), config: off.config })
    assert.equal(offReport.available, false)
    assert.match(offReport.reason!, /sogou: disabled in settings \(wechat\.sogou\.enabled\)/)
    off.cleanup()
    assert.match(renderAccess(accessProfileOf('wechat', 'sogou')!), /^免登录 · 风险中: 搜狗对高频请求会弹出验证码/)
    assert.equal(accessProfileOf('wechat', 'nope'), undefined)
  } finally { h.cleanup() }
})

test('router: the wechat platform through the sogou leg returns signed links; the second call is cached', async () => {
  const h = chainHarness({ platformBackends: { wechat: ['sogou'] } })
  const net = stubNetwork(url => (url.includes('/weixin?') ? new Response(SEARCH, { headers: [['set-cookie', 'SNUID=n1; path=/']] }) : url.includes('/link?') ? new Response(LINK) : undefined))
  try {
    const result = await h.router.search({ query: 'AI Agent 落地', count: 4, fresh: false, multi: false, signal: undefined, platform: { id: 'wechat' } as never })
    assert.equal(result.backend, 'sogou')
    assert.equal(result.sources.length, 4)
    assert.equal(result.sources.filter(s => s.url === SIGNED).length, 3, 'the default resolves the first 3')
    assert.ok(result.sources[3]!.url.startsWith('https://weixin.sogou.com/link?'))
    assert.match(result.fallbackNote ?? '', /3 of 4 links resolved/)
    assert.equal(result.notices, undefined)
    const before = net.urls.length
    const again = await h.router.search({ query: 'AI Agent 落地', count: 4, fresh: false, multi: false, signal: undefined, platform: { id: 'wechat' } as never })
    assert.equal(again.fromCache, true)
    assert.equal(net.urls.length, before)
  } finally { net.restore(); h.cleanup() }
})

test('router: Sogou antispider fails the platform with the notice on the error, and runProvider (evidence mode) returns it on the error outcome', async () => {
  const h = chainHarness({ platformBackends: { wechat: ['sogou'] } })
  const net = stubNetwork(() => antispiderReply())
  try {
    const error: any = await h.router.search({ query: 'q1', count: 3, fresh: true, multi: false, signal: undefined, platform: { id: 'wechat' } as never }).then(() => undefined, e => e)
    assert.match(error.message, /platform wechat unavailable/)
    assert.match(error.message, /anti-spider/)
    assert.deepEqual(noticesOf(error).map(n => n.code), ['wechat.antispider'])
    // The platform now cools down (the service said wait): the next call is skipped, not repeated.
    resetSogouBlock()
    const cooling = await h.router.runProvider({ id: 'wechat', query: 'q2', count: 3, signal: new AbortController().signal })
    assert.equal(cooling.state, 'skipped')
  } finally { net.restore(); h.cleanup() }
  resetSogouBlock()
  const fresh = chainHarness({ platformBackends: { wechat: ['sogou'] } })
  const again = stubNetwork(() => antispiderReply())
  try {
    const outcome = await fresh.router.runProvider({ id: 'wechat', query: 'q2', count: 3, signal: new AbortController().signal })
    assert.equal(outcome.state, 'error')
    assert.deepEqual((outcome as any).notices.map((n: any) => n.code), ['wechat.antispider'])
  } finally { again.restore(); fresh.cleanup() }
})

test('chainEngine: a failed leg\'s notices ride on the answer of a later leg and on the error when nothing answers', async () => {
  const failing = (notices: any[]): any => ({ id: 'a', label: 'A', available: () => true, search: async () => { throw Object.assign(new EngineError('captcha', 'ENGINE_RATE_LIMIT'), { notices }) } })
  const works: any = { id: 'b', label: 'B', available: () => true, search: async () => ({ sources: [{ url: 'https://x.test/1' }], notices: [{ level: 'info', code: 'wechat.signed-url', message: 'm' }] }) }
  const bad = [{ level: 'warn', code: 'wechat.antispider', message: 'x' }]
  const answer = await chainEngine('wechat', '微信', [failing(bad), works]).search('q', 3)
  assert.deepEqual(answer.notices!.map(n => n.code), ['wechat.antispider', 'wechat.signed-url'])
  assert.match(answer.notes!.join('|'), /skipped backends: a: captcha/)
  const one: any = await chainEngine('wechat', '微信', [failing(bad)]).search('q', 3).then(() => undefined, e => e)
  assert.equal(one.code, 'ENGINE_RATE_LIMIT')
  assert.deepEqual(noticesOf(one).map(n => n.code), ['wechat.antispider'])
  const two: any = await chainEngine('wechat', '微信', [failing(bad), failing(bad)]).search('q', 3).then(() => undefined, e => e)
  assert.equal(two.code, 'ENGINE_ERROR')
  assert.deepEqual(noticesOf(two).map(n => n.code), ['wechat.antispider'])
})

test('Sogou titles and summaries decode the named quote / dash / arrow entities (live 2026-11-01)', async () => {
  const { htmlDecode } = await import('../src/util.ts')
  assert.equal(htmlDecode('&ldquo;RAG&rdquo; &mdash;&mdash; 试水&rarr; &hellip; a &amp;ldquo; b'), '\u201cRAG\u201d \u2014\u2014 试水\u2192 \u2026 a &ldquo; b')
})
