import test from 'node:test'
import assert from 'node:assert/strict'
import dns from 'node:dns/promises'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { FetchService } from '../src/fetch.ts'
import { resolveConfig } from '../src/config.ts'
import { Store } from '../src/store.ts'
import { noticesOf } from '../src/wechat/notices.ts'
import {
  classifyWechatMarker, isSignedWechatUrl, isWechatArticleUrl, parseWechatArticle, readNotices, searchResultNotices,
} from '../src/wechat/article.ts'
import { dropSharedSession, resetSogouBlock } from '../src/wechat/sogou.ts'
import { PUBLIC } from './keyed-harness.ts'

// Fixtures under test/fixtures/wechat: the article page keeps the real structure (ids, meta, `var ct`) of a page captured
// anonymously on 2026-11-01 with a synthetic body; the verification page is the real redirect target, trimmed; the removed /
// migrated / violation pages and the 15 KB shell are constructed (named so). Offline: the network is stubbed.
const fx = (name: string): string => fs.readFileSync(new URL('./fixtures/wechat/' + name, import.meta.url), 'utf8')
const ARTICLE = fx('wechat-article.html')
const CAPTCHA = fx('wechat-captcha.html')
const SHELL = fx('wechat-shell.html')
const SIGNED = 'https://mp.weixin.qq.com/s?src=11&timestamp=1793462540&ver=7060&signature=FIXTURESIGNATURE-ab*cd&new=1'
const BARE = 'https://mp.weixin.qq.com/s?__biz=MzA5NjMzODEwNQ%3D%3D&mid=2650593200&idx=1&sn=87ec73ed183f8c53be20dbdb445b3066'
const CAPTCHA_URL = 'https://mp.weixin.qq.com/mp/wappoc_appmsgcaptcha?poc_token=FIXTURE&target_url=https%3A%2F%2Fmp.weixin.qq.com%2Fs'

test.beforeEach(() => { resetSogouBlock(); dropSharedSession() })

test('URLs: article, signed and bare links are told apart', () => {
  assert.equal(isWechatArticleUrl(SIGNED), true)
  assert.equal(isWechatArticleUrl(BARE), true)
  assert.equal(isWechatArticleUrl('https://mp.weixin.qq.com/mp/wappoc_appmsgcaptcha?x=1'), false)
  assert.equal(isWechatArticleUrl('https://weixin.qq.com/s?x=1'), false)
  assert.equal(isWechatArticleUrl('not a url'), false)
  assert.equal(isSignedWechatUrl(SIGNED), true)
  assert.equal(isSignedWechatUrl(BARE), false)
  assert.deepEqual(searchResultNotices([BARE, 'https://example.com/']), [])
  assert.deepEqual(searchResultNotices([BARE, SIGNED]).map(n => n.code), ['wechat.signed-url'])
})

test('parseWechatArticle: body from #js_content, title from #activity-name, account from #js_name, time from var ct', () => {
  const a = parseWechatArticle(ARTICLE, SIGNED)
  assert.equal(a.kind, 'content')
  assert.equal(a.title, 'AI Agent如何拼落地？十大领域30款产品盘点，这些赛道最热')
  assert.equal(a.account, '智东西')
  assert.equal(a.publishedAt, '2024-01-25T12:53:02.000Z')
  assert.match(a.text, /^公众号：智东西 · 发布：2024-01-25 20:53（UTC\+8）\n\n这是用于测试的合成正文第一段/)
  assert.match(a.text, /\[外部链接\]\(https:\/\/example\.com\/ref\)/)
  assert.match(a.text, /`npm test`/)
  assert.match(a.text, /第四行紧跟在换行之后/)
  assert.doesNotMatch(a.text, /var ct|rich_media|visibility/, 'no markup or script text leaks into the body')
})

test('parseWechatArticle: a page without #js_content is classified: verification wall, removed, violation, migrated, shell', () => {
  const captcha = parseWechatArticle(CAPTCHA, CAPTCHA_URL)
  assert.equal(captcha.kind, 'captcha')
  assert.equal(classifyWechatMarker(captcha.text), 'captcha')
  assert.equal(parseWechatArticle(CAPTCHA, '').kind, 'captcha', 'the TCaptcha page is recognised without the redirect')
  assert.equal(parseWechatArticle('<html><body><div>当前环境异常，完成验证后即可继续访问。</div><a>去验证</a></body></html>', '').kind, 'captcha')
  for (const [file, reason] of [['wechat-deleted.html', '该内容已被发布者删除'], ['wechat-violation.html', '此内容因违规无法查看'], ['wechat-migrated.html', '该公众号已迁移']] as const) {
    const gone = parseWechatArticle(fx(file), SIGNED)
    assert.equal(gone.kind, 'error', file)
    assert.match(gone.reason!, new RegExp(reason), file)
    assert.equal(classifyWechatMarker(gone.text), 'error')
    assert.ok(gone.text.includes(reason), 'the reason is in the text the model reads')
  }
  const shell = parseWechatArticle(SHELL, BARE)
  assert.equal(shell.kind, 'shell')
  assert.equal(classifyWechatMarker(shell.text), 'shell')
  assert.equal(classifyWechatMarker('一篇普通文章'), undefined)
})

test('parseWechatArticle: an article with only images still reads as an article', () => {
  const html = ARTICLE.replace(/(<div class="rich_media_content[^>]*id="js_content"[^>]*>)[\s\S]*?(<\/div>\s*<\/div>\s*<script>)/, '$1<p><img data-src="x"></p>$2')
  const a = parseWechatArticle(html, SIGNED)
  assert.equal(a.kind, 'content')
  assert.match(a.text, /没有文字内容/)
})

test('readNotices: copyright for a body, signed-url for a signed link, bare-url for an unsigned link without a body; none off WeChat', () => {
  const codes = (r: Parameters<typeof readNotices>[0]): string[] => readNotices(r).map(n => n.code)
  assert.deepEqual(codes({ requestedUrl: SIGNED, url: SIGNED }), ['wechat.copyright', 'wechat.signed-url'])
  assert.deepEqual(codes({ requestedUrl: BARE, url: BARE }), ['wechat.copyright'])
  assert.deepEqual(codes({ requestedUrl: BARE, url: BARE, pageClass: 'captcha' }), ['wechat.bare-url'])
  assert.deepEqual(codes({ requestedUrl: BARE, url: BARE, pageClass: 'shell' }), ['wechat.bare-url'])
  assert.deepEqual(codes({ requestedUrl: SIGNED, url: SIGNED, pageClass: 'captcha' }), [], 'a signed link that hit the wall is not a bare-link problem')
  assert.deepEqual(codes({ requestedUrl: BARE, url: BARE, pageClass: 'error' }), [])
  assert.deepEqual(codes({ requestedUrl: 'https://example.com/a', url: 'https://example.com/a' }), [])
})

// ── FetchService with a stubbed network ─────────────────────────────────────

interface Seen { url: string; headers: Record<string, string> }

function stubNetwork(respond: (url: string, seen: Seen[]) => Response | undefined) {
  const originalLookup = dns.lookup
  const originalFetch = globalThis.fetch
  const seen: Seen[] = []
  dns.lookup = (async () => [{ address: '93.184.216.34', family: 4 }]) as typeof dns.lookup
  globalThis.fetch = (async (input: any, init: RequestInit) => {
    const url = String(input?.url ?? input)
    seen.push({ url, headers: Object.fromEntries(Object.entries((init?.headers ?? {}) as Record<string, string>).map(([k, v]) => [k.toLowerCase(), v])) })
    return respond(url, seen) ?? new Response('not found', { status: 404 })
  }) as typeof fetch
  return { seen, restore: () => { dns.lookup = originalLookup; globalThis.fetch = originalFetch } }
}

const html = (body: string, status = 200): Response => new Response(body, { status, headers: { 'content-type': 'text/html; charset=utf-8' } })
const auto = (over: Record<string, unknown> = {}) => ({ mode: 'auto' as const, signal: undefined, maxChars: 20_000, fresh: false, persist: true, ...over })
const PROSE = 'Jina read this page as markdown prose: the busy timeout of a SQLite connection decides how long a writer waits for a lock. '.repeat(4)

function service(extra: Record<string, unknown> = {}, seams: ConstructorParameters<typeof FetchService>[4] = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wsp-wechat-fetch-'))
  const config = resolveConfig({ dbPath: path.join(dir, 'store.db'), ttlSeconds: 60, playwright: { enabled: false, snapshotDir: path.join(dir, 's') }, wechat: { sogou: { minIntervalMs: 0 } }, ...extra } as never)
  const store = new Store(config.dbPath)
  const svc = new FetchService(store, config as never, (() => undefined) as never, undefined, seams)
  return { dir, store, config, svc, cleanup: () => { store.close(); fs.rmSync(dir, { recursive: true, force: true }) } }
}

test('read.fetch of a signed mp link: HTTP first with the phone UA and the referer (no Jina), the article is extracted, copyright and signed-url notices', async () => {
  const h = service()
  const net = stubNetwork(url => (url.startsWith('https://mp.weixin.qq.com/s?') ? html(ARTICLE) : undefined))
  try {
    const out = await h.svc.fetchPage(SIGNED, auto())
    assert.equal(out.source, 'http')
    assert.equal(out.usedRule, 'mp.weixin.qq.com')
    assert.equal(out.title, 'AI Agent如何拼落地？十大领域30款产品盘点，这些赛道最热')
    assert.equal(out.shellPage, undefined)
    assert.match(out.text, /^公众号：智东西 · 发布：2024-01-25 20:53/)
    assert.deepEqual(out.notices!.map(n => n.code), ['wechat.copyright', 'wechat.signed-url'])
    assert.equal(net.seen.length, 1, 'Jina was not asked')
    assert.match(net.seen[0]!.headers['user-agent']!, /iPhone/)
    assert.equal(net.seen[0]!.headers.referer, 'https://mp.weixin.qq.com/')
    assert.deepEqual(out.attempts!.map(a => [a.source, a.class]), [['http', 'content']])
    // A page further down reads from the stored snapshot and keeps the notices.
    const again = await h.svc.fetchPage(SIGNED, auto({ offset: 10 }))
    assert.equal(again.fromCache, true)
    assert.deepEqual(again.notices!.map(n => n.code), ['wechat.copyright', 'wechat.signed-url'])
  } finally { net.restore(); h.cleanup() }
})

test('read.fetch of a bare mp link: the redirect to the verification page is a captcha, the result keeps the asked-for URL and carries wechat.bare-url; Jina is tried next', async () => {
  const h = service()
  const net = stubNetwork(url => {
    if (url.startsWith('https://mp.weixin.qq.com/s?')) return new Response(null, { status: 302, headers: { location: CAPTCHA_URL } })
    if (url.startsWith('https://mp.weixin.qq.com/mp/wappoc_appmsgcaptcha')) return html(CAPTCHA)
    if (url.startsWith('https://r.jina.ai/')) return new Response('upstream error', { status: 500 })
    return undefined
  })
  try {
    const out = await h.svc.fetchPage(BARE, auto())
    assert.equal(out.shellPage, true)
    assert.equal(out.pageClass, 'captcha')
    assert.equal(out.url, BARE)
    assert.match(out.text, /^【微信·验证页】/)
    assert.deepEqual(out.notices!.map(n => n.code), ['wechat.bare-url'])
    assert.deepEqual(out.attempts!.map(a => [a.source, a.class]), [['http', 'captcha'], ['jina', 'error']])
    // A stored copy is classified the same way when it is read back (by its marker line), in a fresh service on the same store.
    const second = new FetchService(h.store, h.config as never, (() => undefined) as never)
    const cached = await second.fetchPage(BARE, auto())
    assert.equal(cached.fromCache, true)
    assert.equal(cached.pageClass, 'captcha')
    assert.deepEqual(cached.notices!.map(n => n.code), ['wechat.bare-url'])
  } finally { net.restore(); h.cleanup() }
})

test('read.fetch: a removed article is an error with the reason, final (Jina is not asked); an empty shell goes on to Jina, which can win', async () => {
  const h = service()
  const net = stubNetwork(url => (url.startsWith('https://mp.weixin.qq.com/s?') ? html(fx('wechat-deleted.html')) : undefined))
  try {
    const gone = await h.svc.fetchPage(SIGNED, auto())
    assert.equal(gone.pageClass, 'error')
    assert.equal(gone.shellPage, true)
    assert.match(gone.text, /该内容已被发布者删除/)
    assert.deepEqual(gone.attempts!.map(a => a.source), ['http'])
    assert.deepEqual(gone.notices ?? [], [])
  } finally { net.restore() }
  const net2 = stubNetwork(url => (url.startsWith('https://mp.weixin.qq.com/s?') ? html(SHELL) : url.startsWith('https://r.jina.ai/') ? new Response('# Title\n\n' + PROSE) : undefined))
  try {
    const out = await h.svc.fetchPage(SIGNED + '&x=1', auto())
    assert.equal(out.source, 'jina')
    assert.equal(out.pageClass, undefined)
    assert.deepEqual(out.attempts!.map(a => [a.source, a.class]), [['http', 'shell'], ['jina', 'content']])
  } finally { net2.restore(); h.cleanup() }
})

test('read.fetch mode=http on an mp link uses the same reader; other hosts are untouched', async () => {
  const h = service()
  const net = stubNetwork(url => (url.startsWith('https://mp.weixin.qq.com/s?') ? html(ARTICLE) : url.startsWith('https://r.jina.ai/') ? new Response('# T\n\n' + PROSE) : html('<html><head><title>Plain</title></head><body><article><p>' + PROSE + '</p></article></body></html>')))
  try {
    const out = await h.svc.fetchPage(SIGNED, auto({ mode: 'http' }))
    assert.equal(out.title, 'AI Agent如何拼落地？十大领域30款产品盘点，这些赛道最热')
    const other = await h.svc.fetchPage('https://example.com/a', auto())
    assert.equal(other.source, 'jina', 'auto on another host still starts with Jina')
    assert.equal(other.notices, undefined)
  } finally { net.restore(); h.cleanup() }
})

test('read.fetch of a weixin.sogou.com/link URL: resolved to the signed link first (search warm-up for SNUID, then /link), and the result is the resolved URL', async () => {
  const sogouCalls: string[] = []
  const sogouFetch = (async (input: unknown, init: RequestInit) => {
    const url = String(input)
    sogouCalls.push(url + ' cookie=' + (((init?.headers ?? {}) as Record<string, string>).cookie ?? ''))
    return url.includes('/weixin?') ? new Response('<html><body>search</body></html>', { headers: [['set-cookie', 'SNUID=ok; path=/']] }) : new Response(fx('sogou-link.html'))
  }) as typeof fetch
  const h = service({}, { fetchImpl: sogouFetch, lookup: PUBLIC, throttle: { wait: async () => {} } })
  const net = stubNetwork(url => (url.startsWith('https://mp.weixin.qq.com/s?') ? html(ARTICLE) : undefined))
  try {
    const link = 'https://weixin.sogou.com/link?url=FIXTURE-LINK-0&type=2&query=AI%20Agent%20%E8%90%BD%E5%9C%B0&token=FIXTURETOKEN'
    const out = await h.svc.fetchPage(link, auto())
    assert.equal(out.url, SIGNED)
    assert.equal(out.source, 'http')
    assert.deepEqual(out.notices!.map(n => n.code), ['wechat.copyright', 'wechat.signed-url'])
    assert.equal(sogouCalls.length, 2)
    assert.match(sogouCalls[0]!, /\/weixin\?type=2&query=AI%20Agent%20%E8%90%BD%E5%9C%B0/)
    assert.match(sogouCalls[1]!, /\/link\?url=FIXTURE-LINK-0.* cookie=SNUID=ok$/)
    assert.deepEqual(net.seen.map(s => s.url), [SIGNED], 'only the resolved article was fetched from mp.weixin.qq.com')
  } finally { net.restore(); h.cleanup() }
})

test('read.fetch of a sogou link: antispider fails the read with the wechat.antispider notice on the error; the built-in client switched off is said so', async () => {
  const anti = (async () => new Response(fx('sogou-antispider.html'))) as typeof fetch
  const h = service({}, { fetchImpl: anti, lookup: PUBLIC, throttle: { wait: async () => {} } })
  const link = 'https://weixin.sogou.com/link?url=FIXTURE-LINK-0&type=2&query=q&token=T'
  try {
    const error: any = await h.svc.fetchPage(link, auto()).then(() => undefined, e => e)
    assert.equal(error.code, 'ENGINE_RATE_LIMIT')
    assert.deepEqual(noticesOf(error).map(n => n.code), ['wechat.antispider'])
  } finally { h.cleanup() }
  const off = service({ wechat: { sogou: { enabled: false } } })
  try {
    await assert.rejects(off.svc.fetchPage(link, auto()), /disabled in settings \(wechat\.sogou\.enabled\)/)
  } finally { off.cleanup() }
})
