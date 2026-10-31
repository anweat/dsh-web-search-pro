import test from 'node:test'
import assert from 'node:assert/strict'
import dns from 'node:dns/promises'
import fs from 'node:fs'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { findAction } from '../src/actions/registry.ts'
import { ACTIONS } from '../src/actions/registry.ts'
import { checkOutput, validateArgs } from '../src/actions/schema.ts'
import { renderEnvelope } from '../src/actions/run.ts'
import { renderIndex } from '../src/actions/index-view.ts'
import { webPolicyDecision } from '../src/actions/approval.ts'
import { assertResolvedPublicUrl, assertSafePublicUrl } from '../src/safe-http.ts'
import { httpGet } from '../src/util.ts'
import {
  albumRefOf, albumUrl, decodeAlbumCursor, encodeAlbumCursor, fetchAlbum, parseAlbum, parseAlbumUrl, resetAlbumThrottle,
} from '../src/wechat/album.ts'
import { classifyHistoryError, createHistoryClient, historyBase, HistoryError, resetHistoryThrottles } from '../src/wechat/history.ts'
import { noticesOf } from '../src/wechat/notices.ts'
import { resetLayerHealth } from '../src/wechat/health.ts'
import { bootPlugin } from './plugin-harness.ts'

const fx = (name: string): any => JSON.parse(fs.readFileSync(new URL('./fixtures/wechat/' + name, import.meta.url), 'utf8'))
// album-page1.json / album-page2.json are anonymous live captures of 2026-11-01 (two requests, a public album from RSSHub's documentation),
// with link tokens, covers, names and the description replaced by placeholders. The single-object and error shapes below are built from
// the documented contract (not seen live).
const PAGE1 = fx('album-page1.json')
const PAGE2 = fx('album-page2.json')
const BIZ = 'MzA3MDM3NjE5NQ=='
const ALBUM = '1375870284640911361'
const ALBUM_URL = `https://mp.weixin.qq.com/mp/appmsgalbum?__biz=${BIZ}&action=getalbum&album_id=${ALBUM}&subscene=21&scenenote=x#wechat_redirect`

test.beforeEach(() => { resetLayerHealth(); resetHistoryThrottles(); resetAlbumThrottle({ wait: async () => {} }) })

// ── the group and its schemas ───────────────────────────────────────────────

test('the wechat group: four read-only actions that need no approval, registered and listed through web_index; examples fit their schemas', () => {
  const group = ACTIONS.filter(action => action.group === 'wechat')
  assert.deepEqual(group.map(action => action.name), ['wechat.status', 'wechat.album', 'wechat.accounts', 'wechat.articles'])
  for (const action of group) {
    assert.equal(action.approval, 'none', action.name)
    assert.equal(action.mutating, false, action.name)
    assert.equal(action.output.additionalProperties, false, action.name + ' output is closed')
    assert.ok(action.output.properties.notices, action.name + ' carries notices')
    for (const example of action.examples ?? []) {
      if (JSON.stringify(example.args).includes('<nextCursor>')) continue
      assert.deepEqual(validateArgs(action.params, example.args).errors, [], action.name)
    }
    assert.deepEqual(webPolicyDecision(action.name, {}, 'read-only'), { kind: 'allow' })
  }
  // Closed all the way down: every object node of every output schema declares additionalProperties: false.
  const open: string[] = []
  const walk = (node: any, where: string): void => {
    if (!node || typeof node !== 'object') return
    if (node.type === 'object' && node.additionalProperties !== false) open.push(where)
    for (const [key, child] of Object.entries<any>(node.properties ?? {})) walk(child, where + '.' + key)
    if (node.items) walk(node.items, where + '[]')
  }
  for (const action of group) walk(action.output, action.name)
  assert.deepEqual(open, [])
  const root = renderIndex({}, { skillAvailable: true, browserReady: true }).text
  assert.match(root, /wechat \(4\) .*: status\|album\|accounts\|articles/)
  const listing = renderIndex({ group: 'wechat' }, { skillAvailable: true, browserReady: true }).text
  for (const action of group) assert.match(listing, new RegExp('^' + action.name.replace('.', '\\.') + ' - ', 'm'))
  assert.doesNotMatch(listing, /\| asks/)
  assert.match(renderIndex({ action: 'wechat.articles' }, { skillAvailable: true, browserReady: true }).text, /nextBegin/)
})

// ── album ───────────────────────────────────────────────────────────────────

test('album URLs: biz and album id from an album page link (share extras and fragment ignored); other hosts and half links are refused', () => {
  assert.deepEqual(parseAlbumUrl(ALBUM_URL), { biz: BIZ, albumId: ALBUM })
  assert.deepEqual(parseAlbumUrl(`http://mp.weixin.qq.com/mp/appmsgalbum?action=getalbum&album_id=${ALBUM}&__biz=${encodeURIComponent(BIZ)}`), { biz: BIZ, albumId: ALBUM })
  assert.equal(parseAlbumUrl(`https://example.com/mp/appmsgalbum?__biz=${BIZ}&album_id=${ALBUM}`), undefined)
  assert.equal(parseAlbumUrl(`https://mp.weixin.qq.com/mp/appmsgalbum?__biz=${BIZ}`), undefined)
  assert.equal(parseAlbumUrl(`https://mp.weixin.qq.com/mp/appmsgalbum?album_id=${ALBUM}`), undefined)
  assert.equal(parseAlbumUrl(`https://mp.weixin.qq.com/mp/appmsgalbum?__biz=${BIZ}&album_id=12ab`), undefined)
  assert.equal(parseAlbumUrl('not a url'), undefined)
  assert.deepEqual(albumRefOf(BIZ, ALBUM), { biz: BIZ, albumId: ALBUM })
  assert.equal(albumRefOf('bad biz!', ALBUM), undefined)
  const url = new URL(albumUrl({ biz: BIZ, albumId: ALBUM }, 5, { msgid: '2650936806', itemidx: '1' }))
  assert.equal(url.origin + url.pathname, 'https://mp.weixin.qq.com/mp/appmsgalbum')
  assert.deepEqual(Object.fromEntries(url.searchParams), { __biz: BIZ, action: 'getalbum', album_id: ALBUM, count: '5', f: 'json', begin_msgid: '2650936806', begin_itemidx: '1' })
})

test('cursor: opaque, round trips msgid + itemidx, and anything else is refused', () => {
  const cursor = encodeAlbumCursor('2650936806', '1')
  assert.match(cursor, /^[A-Za-z0-9_-]+$/)
  assert.deepEqual(decodeAlbumCursor(cursor), { msgid: '2650936806', itemidx: '1' })
  for (const bad of ['', 'nope', Buffer.from('{"m":1,"i":2}').toString('base64url'), Buffer.from('{"m":"abc","i":"1"}').toString('base64url'), Buffer.from('[]').toString('base64url')]) assert.equal(decodeAlbumCursor(bad), undefined, bad)
})

test('parseAlbum on the live captures: title, account, total on the first page; https links; ISO time; the next cursor is the last article; the second page has no header', () => {
  const first = parseAlbum(PAGE1)
  assert.equal(first.title, '李想主义')
  assert.equal(first.nickname, '某某专栏号')
  assert.equal(first.totalArticles, 96)
  assert.equal(first.articles.length, 3)
  assert.deepEqual(first.articles[0], {
    title: '胡鑫宇们，需要的不是那“五分钟”', url: 'https://mp.weixin.qq.com/s?__biz=MzA3MDM3NjE5NQ==&mid=2650941860&idx=1&sn=FIXTURESN&chksm=FIXTURECHKSM#rd',
    msgid: '2650941860', itemidx: '1', publishedAt: '2023-02-06T05:24:22.000Z',
  })
  assert.deepEqual(decodeAlbumCursor(first.nextCursor!), { msgid: '2650936806', itemidx: '1' })
  const second = parseAlbum(PAGE2)
  assert.deepEqual([second.title, second.nickname, second.totalArticles], [undefined, undefined, undefined])
  assert.equal(second.articles.length, 2)
  assert.ok(second.nextCursor)
})

test('parseAlbum: article_list as a single object, an empty list, the last page (continue_flag 0), and base_resp.ret != 0', () => {
  const one = { base_resp: { ret: 0 }, getalbum_resp: { article_list: PAGE1.getalbum_resp.article_list[0], base_info: { title: 'T', article_count: '1' }, continue_flag: '0' } }
  const page = parseAlbum(one)
  assert.equal(page.articles.length, 1)
  assert.equal(page.nextCursor, undefined, 'continue_flag 0 ends the listing')
  assert.equal(page.title, 'T')
  assert.deepEqual(parseAlbum({ base_resp: { ret: 0 }, getalbum_resp: { continue_flag: '0' } }).articles, [])
  assert.equal(parseAlbum({ base_resp: { ret: 0 }, getalbum_resp: { article_list: [{ title: 'no url' }, { url: 'http://mp.weixin.qq.com/s?x=1' }, 'x'], continue_flag: '1' } }).articles.length, 0, 'entries without title and link are dropped')
  assert.equal(parseAlbum({ base_resp: { ret: 0 }, getalbum_resp: { article_list: [], album_resp_info: { title: 'Old place' } } }).title, 'Old place')
  assert.throws(() => parseAlbum({ base_resp: { ret: -1 } }), /base_resp\.ret=-1/)
  assert.throws(() => parseAlbum({ base_resp: { ret: 200003 }, getalbum_resp: {} }), (e: any) => /ret=200003/.test(e.message) && e.retryable === false)
  assert.throws(() => parseAlbum({ nothing: true }), /base_resp\.ret/)
  assert.throws(() => parseAlbum('x'), /not a JSON object/)
})

function stubNetwork(respond: (url: string) => Response | undefined) {
  const originalLookup = dns.lookup
  const originalFetch = globalThis.fetch
  const calls: { url: string; headers: Record<string, string> }[] = []
  dns.lookup = (async () => [{ address: '93.184.216.34', family: 4 }]) as typeof dns.lookup
  globalThis.fetch = (async (input: any, init: any) => {
    const url = String(input?.url ?? input)
    calls.push({ url, headers: Object.fromEntries(Object.entries(init?.headers ?? {}).map(([k, v]) => [k.toLowerCase(), String(v)])) })
    return respond(url) ?? new Response('not found', { status: 404 })
  }) as typeof fetch
  return { calls, restore: () => { dns.lookup = originalLookup; globalThis.fetch = originalFetch } }
}
const json = (body: unknown): Response => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json; charset=UTF-8' } })

test('fetchAlbum: a mobile UA and the mp.weixin.qq.com Referer, count clamped to 1-20, the cursor passed on; a captcha page and HTTP errors are explained', async () => {
  const net = stubNetwork(url => (url.includes('begin_msgid') ? json(PAGE2) : json(PAGE1)))
  try {
    const waits: number[] = []
    const io = { deps: {}, signal: undefined, throttle: { wait: async (ms: number) => { waits.push(ms) } } } as never
    const first = await fetchAlbum({ biz: BIZ, albumId: ALBUM }, 500, undefined, io)
    assert.equal(first.articles.length, 3)
    assert.equal(new URL(net.calls[0]!.url).searchParams.get('count'), '20')
    assert.match(net.calls[0]!.headers['user-agent']!, /iPhone/)
    assert.equal(net.calls[0]!.headers.referer, 'https://mp.weixin.qq.com/')
    await fetchAlbum({ biz: BIZ, albumId: ALBUM }, 0, decodeAlbumCursor(first.nextCursor!), io)
    assert.equal(new URL(net.calls[1]!.url).searchParams.get('begin_msgid'), '2650936806')
    assert.equal(new URL(net.calls[1]!.url).searchParams.get('count'), '10', 'a count of 0 is the default')
    assert.deepEqual(waits, [1000, 1000], 'every request waits for the pause between album requests')
  } finally { net.restore() }
  const wall = stubNetwork(() => new Response('<html>环境异常 完成验证后即可继续访问</html>', { status: 200, headers: { 'content-type': 'text/html' } }))
  try {
    const io = { deps: {}, signal: undefined, throttle: { wait: async () => {} } } as never
    await assert.rejects(fetchAlbum({ biz: BIZ, albumId: ALBUM }, 5, undefined, io), /not JSON.*verification wall/)
  } finally { wall.restore() }
  const limited = stubNetwork(() => new Response('', { status: 429 }))
  try {
    const io = { deps: {}, signal: undefined, throttle: { wait: async () => {} } } as never
    await assert.rejects(fetchAlbum({ biz: BIZ, albumId: ALBUM }, 5, undefined, io), (e: any) => e.code === 'ENGINE_RATE_LIMIT')
  } finally { limited.restore() }
})

test('wechat.album end to end: URL in, articles and nextCursor out, the cursor brings the second page, output fits the closed schema; bad arguments are INVALID_ARGS', async () => {
  const net = stubNetwork(url => (url.includes('begin_msgid') ? json(PAGE2) : json(PAGE1)))
  const h = bootPlugin()
  try {
    const first = await h.envelope('wechat.album', { url: ALBUM_URL, count: 3 })
    assert.equal(first.ok, true, JSON.stringify(first.error))
    assert.deepEqual(checkOutput(findAction('wechat.album')!.output, first.result), [])
    assert.equal(first.result.albumTitle, '李想主义')
    assert.equal(first.result.totalArticles, 96)
    assert.equal(first.result.articles.length, 3)
    assert.equal(first.result.notices, undefined, 'a login-free list carries no warning')
    const text = renderEnvelope(first, {})
    assert.match(text, /合集「李想主义」 · 某某专栏号 · 共 96 篇 — 3 articles \(more: pass cursor\)/)
    assert.match(text, /nextCursor: /)
    const second = await h.envelope('wechat.album', { biz: BIZ, albumId: ALBUM, count: 2, cursor: first.result.nextCursor })
    assert.equal(second.ok, true, JSON.stringify(second.error))
    assert.deepEqual(second.result.articles.map((a: any) => a.msgid), ['2650935971', '2650935567'])
    assert.equal(second.result.albumTitle, undefined)
    for (const call of net.calls) assert.equal(new URL(call.url).hostname, 'mp.weixin.qq.com')
    for (const bad of [{}, { url: 'https://example.com/x' }, { biz: BIZ }, { url: ALBUM_URL, cursor: 'garbage' }]) {
      const envelope = await h.envelope('wechat.album', bad)
      assert.equal(envelope.ok, false)
      assert.equal(envelope.error.code, 'INVALID_ARGS', JSON.stringify(bad))
    }
    const refused = stubNetwork(() => json({ base_resp: { ret: 200040 } }))
    try {
      const failed = await h.envelope('wechat.album', { url: ALBUM_URL })
      assert.equal(failed.ok, false)
      assert.match(failed.error.message, /base_resp\.ret=200040/)
    } finally { refused.restore() }
  } finally { net.restore(); h.cleanup() }
})

// ── the narrow allowance of the history origin ──────────────────────────────

test('safe-http allowOrigin: only the exact origin may be private; everything else is judged as before', async () => {
  const allow = 'http://127.0.0.1:5000'
  assert.doesNotThrow(() => assertSafePublicUrl('http://127.0.0.1:5000/api/health', allow))
  assert.equal((await assertResolvedPublicUrl('http://127.0.0.1:5000/x', { allowOrigin: allow })).origin, allow)
  for (const other of ['http://127.0.0.1:5001/x', 'https://127.0.0.1:5000/x', 'http://localhost:5000/x', 'http://10.0.0.5:5000/x', 'http://192.168.1.2/x', 'http://[::1]:5000/x', 'http://169.254.169.254/latest']) {
    assert.throws(() => assertSafePublicUrl(other, allow), /private or local network/, other)
    await assert.rejects(assertResolvedPublicUrl(other, { allowOrigin: allow }), /private or local network/, other)
  }
  assert.throws(() => assertSafePublicUrl('http://u:p@127.0.0.1:5000/x', allow), /credentials are not allowed/)
  assert.throws(() => assertSafePublicUrl('ftp://127.0.0.1:5000/x', allow), /only public HTTP/)
  assert.throws(() => assertSafePublicUrl('http://127.0.0.1:5000/x'), /private or local network/, 'without the allowance nothing changes')
  assert.throws(() => assertSafePublicUrl('http://127.0.0.1:5000/x', 'not a url'), /private or local network/, 'a broken allowance matches nothing')
  assert.throws(() => assertSafePublicUrl('http://127.0.0.1:5000/x', 'ftp://127.0.0.1:5000'), /private or local network/)
})

/** A tiny HTTP server on 127.0.0.1 standing in for wechat-download-api. */
async function stubService(handler: (req: http.IncomingMessage, res: http.ServerResponse) => void) {
  const hits: string[] = []
  const server = http.createServer((req, res) => { hits.push(req.url ?? ''); handler(req, res) })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const port = (server.address() as AddressInfo).port
  return { port, url: `http://127.0.0.1:${port}`, hits, close: () => new Promise<void>(resolve => { server.closeAllConnections(); server.close(() => resolve()) }) }
}
const send = (res: http.ServerResponse, body: unknown, status = 200): void => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(typeof body === 'string' ? body : JSON.stringify(body)) }

test('httpGet with allowOrigin: the allowed loopback origin is reachable, a redirect to another loopback port is refused, and so is any other private target', async () => {
  const other = await stubService((_req, res) => send(res, { secret: 'other service' }))
  const service = await stubService((req, res) => {
    if (req.url?.startsWith('/hop')) { res.writeHead(302, { location: other.url + '/x' }); res.end(); return }
    send(res, { ok: true })
  })
  try {
    const ok = await httpGet(service.url + '/api/health', { signal: undefined, allowOrigin: service.url })
    assert.equal(JSON.parse(ok.text).ok, true)
    await assert.rejects(httpGet(service.url + '/hop', { signal: undefined, allowOrigin: service.url }), /private or local network/)
    await assert.rejects(httpGet(other.url + '/x', { signal: undefined, allowOrigin: service.url }), /private or local network/)
    await assert.rejects(httpGet(service.url + '/hop', { signal: undefined, redirect: 'error', allowOrigin: service.url }), /redirect is not allowed/)
    assert.deepEqual(other.hits, [], 'the other service was never touched')
    await assert.rejects(httpGet(service.url + '/api/health', { signal: undefined }), /private or local network/)
  } finally { await service.close(); await other.close() }
})

// ── the history client ──────────────────────────────────────────────────────

const SEARCHBIZ = { success: true, data: { list: [{ fakeid: 'MzA1MjM1ODk2MA==', nickname: '某某号', alias: 'moumou', round_head_img: 'http://x/y', service_type: 0 }, { fakeid: 'MzAxMQ==', nickname: '企业号', alias: '', service_type: 2 }, { nickname: 'no fakeid' }], total: 2 }, error: null }
const ARTICLES = { success: true, data: { articles: [
  { aid: '100_1', title: '第一篇', link: 'http://mp.weixin.qq.com/s?__biz=A&mid=1&idx=1&sn=aa', update_time: 1793000000, create_time: 1792990000, digest: '摘要一', cover: 'c', author: '作者甲' },
  { aid: '100_2', title: '第二篇', link: 'https://mp.weixin.qq.com/s/xyz', create_time: 1792980000, digest: '', author: '' },
  { title: 'no link' },
], total: 37, begin: 0, count: 2, keyword: null }, error: null }

const quiet = { wait: async () => {} }

test('history client: searchbiz and articles are mapped (fakeid, type, https links, unix times, batches), entries without an id or link dropped', async () => {
  const service = await stubService((req, res) => (req.url?.startsWith('/api/public/searchbiz') ? send(res, SEARCHBIZ) : send(res, ARTICLES)))
  try {
    const client = createHistoryClient({ allowProxyFakeIp: false }, { baseUrl: service.url + '/', minIntervalMs: 0 }, { throttle: quiet })
    assert.equal(client.baseUrl, service.url)
    const found = await client.searchAccounts('某某')
    assert.deepEqual(found, { accounts: [{ fakeid: 'MzA1MjM1ODk2MA==', nickname: '某某号', alias: 'moumou', serviceType: 0 }, { fakeid: 'MzAxMQ==', nickname: '企业号', alias: '', serviceType: 2 }], total: 2 })
    assert.equal(decodeURIComponent(service.hits[0]!), '/api/public/searchbiz?query=某某')
    const list = await client.listArticles({ fakeid: 'MzA1MjM1ODk2MA==', begin: 20, count: 2, keyword: '备案 新规' })
    assert.equal(list.total, 37)
    assert.deepEqual(list.articles[0], { title: '第一篇', url: 'https://mp.weixin.qq.com/s?__biz=A&mid=1&idx=1&sn=aa', publishedAt: new Date(1793000000 * 1000).toISOString(), digest: '摘要一', author: '作者甲', aid: '100_1' })
    assert.deepEqual(list.articles[1], { title: '第二篇', url: 'https://mp.weixin.qq.com/s/xyz', publishedAt: new Date(1792980000 * 1000).toISOString(), aid: '100_2' })
    assert.equal(list.articles.length, 2)
    const query = new URL(service.url + service.hits[1]).searchParams
    assert.deepEqual(Object.fromEntries(query), { fakeid: 'MzA1MjM1ODk2MA==', begin: '20', count: '2', keyword: '备案 新规' })
  } finally { await service.close() }
})

test('history client failures: login expired (both service strings), not logged in, "服务器内部错误", ret=200013 / 频繁, a missing service, a wrong service', async () => {
  const bodies: Record<string, unknown> = {
    expired: { success: false, data: null, error: '微信登录已过期，请到管理面板重新扫码登录后再试' },
    never: { success: false, data: null, error: '服务器未登录，请先访问管理页面扫码登录' },
    article: { success: false, data: null, error: '登录已失效，请重新扫码登录' },
    internal: { success: false, data: null, error: '服务器内部错误，请稍后重试' },
    freq: { success: false, data: null, error: '获取文章列表失败: ret=200013, msg=freq control' },
    busy: { success: false, data: null, error: 'Rate limited: 请求过于频繁，请30秒后重试' },
    other: { success: false, data: null, error: '该公众号在微信侧已无法访问（可能已注销/改名/重新注册），请重新搜索最新的同名公众号' },
  }
  const service = await stubService((req, res) => {
    const key = new URL(req.url!, 'http://x').searchParams.get('query') ?? ''
    if (key === 'html') { res.writeHead(200, { 'content-type': 'text/html' }); res.end('<html>hi</html>'); return }
    if (key === 'fastapi404') { send(res, { detail: 'Not Found' }, 404); return }
    send(res, bodies[key] ?? SEARCHBIZ)
  })
  try {
    const client = createHistoryClient({ allowProxyFakeIp: false }, { baseUrl: service.url, minIntervalMs: 0 }, { throttle: quiet })
    const fail = async (query: string): Promise<HistoryError> => { try { await client.searchAccounts(query) } catch (e) { assert.ok(e instanceof HistoryError, String(e)); return e } throw new Error('expected a failure') }
    for (const key of ['expired', 'never', 'article']) {
      const error = await fail(key)
      assert.equal(error.kind, 'login-expired', key)
      assert.deepEqual(noticesOf(error).map(n => [n.code, n.level]), [['wechat.login-expired', 'action']])
      assert.match(noticesOf(error)[0]!.message, /重新扫码登录.*4 天/)
    }
    const internal = await fail('internal')
    assert.equal(internal.kind, 'maybe-not-logged-in')
    assert.match(internal.message, /usually means it is NOT LOGGED IN.*wechat\.status.*probe=true|NOT LOGGED IN[\s\S]*probe=true/)
    assert.deepEqual(noticesOf(internal), [])
    for (const key of ['freq', 'busy']) {
      const error = await fail(key)
      assert.equal(error.kind, 'rate-limited', key)
      assert.deepEqual(noticesOf(error).map(n => [n.code, n.level]), [['wechat.rate-limited', 'warn']])
    }
    assert.match(noticesOf(await fail('freq'))[0]!.message, /ret=200013/)
    const other = await fail('other')
    assert.equal(other.kind, 'service-error')
    assert.match(other.message, /已无法访问/)
    assert.deepEqual(noticesOf(other), [])
    assert.equal((await fail('html')).kind, 'bad-response')
    const wrong = await fail('fastapi404')
    assert.equal(wrong.kind, 'bad-response')
    assert.match(wrong.message, /404.*does not look like wechat-download-api/)
  } finally { await service.close() }
  // Nothing listens any more: the error names the address and tells the user to start the service.
  const dead = createHistoryClient({ allowProxyFakeIp: false }, { baseUrl: service.url, minIntervalMs: 0 }, { throttle: quiet })
  await assert.rejects(dead.searchAccounts('x'), (e: any) => e instanceof HistoryError && e.kind === 'unreachable' && e.message.includes(service.url) && /has to be running/.test(e.message))
  assert.equal(classifyHistoryError('', 'x').kind, 'service-error')
  assert.equal(historyBase('ftp://x'), undefined)
  assert.equal(historyBase('http://u:p@x'), undefined)
  assert.equal(historyBase('http://x/api?a=1'), undefined)
  assert.deepEqual(historyBase('http://127.0.0.1:5000//'), { base: 'http://127.0.0.1:5000', origin: 'http://127.0.0.1:5000' })
  assert.deepEqual(historyBase('https://host.example/wda/'), { base: 'https://host.example/wda', origin: 'https://host.example' })
})

test('history client: a redirect from the service is refused (it could lead anywhere), and the requests are paced by minIntervalMs', async () => {
  const other = await stubService((_req, res) => send(res, SEARCHBIZ))
  const service = await stubService((_req, res) => { res.writeHead(302, { location: other.url + '/api/public/searchbiz' }); res.end() })
  try {
    const client = createHistoryClient({ allowProxyFakeIp: false }, { baseUrl: service.url, minIntervalMs: 0 }, { throttle: quiet })
    await assert.rejects(client.searchAccounts('x'), (e: any) => e.kind === 'unreachable' && /redirect/i.test(e.message))
    assert.deepEqual(other.hits, [])
  } finally { await service.close(); await other.close() }
  const calm = await stubService((_req, res) => send(res, SEARCHBIZ))
  try {
    const waits: number[] = []
    const spy = { wait: async (ms: number) => { waits.push(ms) } }
    const client = createHistoryClient({ allowProxyFakeIp: false }, { baseUrl: calm.url, minIntervalMs: 2000 }, { throttle: spy })
    await client.searchAccounts('a'); await client.health(); await client.loginStatus()
    assert.deepEqual(waits, [2000, 2000, 2000], 'one wait of the configured interval before every request')
    // The real throttle: two calls at least minIntervalMs apart.
    const timed = createHistoryClient({ allowProxyFakeIp: false }, { baseUrl: calm.url, minIntervalMs: 150 })
    const t0 = Date.now()
    await timed.searchAccounts('a'); await timed.searchAccounts('b')
    assert.ok(Date.now() - t0 >= 140, 'the second request waited for the interval')
  } finally { await calm.close() }
})

// ── the actions against a stub service ──────────────────────────────────────

test('wechat.accounts / wechat.articles without wechat.history.baseUrl: CAPABILITY_UNAVAILABLE naming the setting; a broken address too', async () => {
  const h = bootPlugin()
  try {
    for (const [action, args] of [['wechat.accounts', { query: 'x' }], ['wechat.articles', { fakeid: 'x' }]] as const) {
      const envelope = await h.envelope(action, args)
      assert.equal(envelope.ok, false)
      assert.equal(envelope.error.code, 'CAPABILITY_UNAVAILABLE')
      assert.match(envelope.error.message, /wechat\.history\.baseUrl is not set/)
      assert.match(envelope.error.hint, /wechat-download-api/)
    }
    h.config.wechat = { history: { baseUrl: 'ftp://nope' } }
    assert.match((await h.envelope('wechat.accounts', { query: 'x' })).error.message, /not an http\(s\) address/)
  } finally { h.cleanup() }
})

test('wechat.accounts and wechat.articles: results, the account-risk warning once, nextBegin, closed schemas; failures come back with their notices', async () => {
  let mode: 'ok' | 'expired' | 'freq' | 'internal' = 'ok'
  const service = await stubService((req, res) => {
    if (mode === 'expired') return send(res, { success: false, error: '微信登录已过期，请到管理面板重新扫码登录后再试' })
    if (mode === 'freq') return send(res, { success: false, error: '获取文章列表失败: ret=200013, msg=freq control' })
    if (mode === 'internal') return send(res, { success: false, error: '服务器内部错误，请稍后重试' })
    return send(res, req.url?.startsWith('/api/public/searchbiz') ? SEARCHBIZ : req.url?.startsWith('/api/public/articles') ? ARTICLES : {})
  })
  const h = bootPlugin({ wechat: { history: { baseUrl: service.url, minIntervalMs: 0 } } })
  try {
    const accounts = await h.envelope('wechat.accounts', { query: '某某' })
    assert.equal(accounts.ok, true, JSON.stringify(accounts.error))
    assert.deepEqual(checkOutput(findAction('wechat.accounts')!.output, accounts.result), [])
    assert.deepEqual(accounts.result.accounts.map((a: any) => [a.fakeid, a.kind]), [['MzA1MjM1ODk2MA==', '订阅号'], ['MzAxMQ==', '企业号']])
    assert.deepEqual(accounts.result.notices.map((n: any) => [n.code, n.level]), [['wechat.account-risk', 'warn']])
    assert.match(renderEnvelope(accounts, {}), /某某号 \(moumou\) · 订阅号 · fakeid MzA1MjM1ODk2MA==[\s\S]*提醒用户/)

    const articles = await h.envelope('wechat.articles', { fakeid: 'MzA1MjM1ODk2MA==', begin: 10, count: 20, keyword: '备案' })
    assert.equal(articles.ok, true, JSON.stringify(articles.error))
    assert.deepEqual(checkOutput(findAction('wechat.articles')!.output, articles.result), [])
    assert.equal(articles.result.begin, 10)
    assert.equal(articles.result.nextBegin, 30, 'begin + the requested count, not + the number of articles')
    assert.equal(articles.result.total, 37)
    assert.equal(articles.result.notices, undefined, 'the account-risk warning was shown once')
    assert.match(renderEnvelope(articles, {}), /2 article\(s\) from batch 10 \(service total 37\); next page: begin=30/)
    const query = new URL(service.url + service.hits.at(-1)).searchParams
    assert.deepEqual(Object.fromEntries(query), { fakeid: 'MzA1MjM1ODk2MA==', begin: '10', count: '20', keyword: '备案' })

    // count is clamped to 100; begin defaults to 0
    await h.envelope('wechat.articles', { fakeid: 'F', count: 5000 })
    assert.deepEqual(Object.fromEntries(new URL(service.url + service.hits.at(-1)).searchParams), { fakeid: 'F', begin: '0', count: '100' })

    mode = 'expired'
    const expired = await h.envelope('wechat.articles', { fakeid: 'F' })
    assert.equal(expired.ok, false)
    assert.equal(expired.error.code, 'ACTION_FAILED')
    assert.deepEqual(expired.error.notices.map((n: any) => [n.code, n.level]), [['wechat.login-expired', 'action']])
    assert.match(expired.error.notices[0].message, /wechat-download-api 管理页面重新扫码登录/)
    const again = await h.envelope('wechat.articles', { fakeid: 'F' })
    assert.equal(again.error.notices, undefined, 'the same failure is shown once per session')

    mode = 'ok'
    assert.equal((await h.envelope('wechat.articles', { fakeid: 'F' })).ok, true)
    mode = 'expired'
    assert.ok((await h.envelope('wechat.articles', { fakeid: 'F' })).error.notices, 'after a success a new expiry is shown again')

    mode = 'freq'
    const freq = await h.envelope('wechat.accounts', { query: 'q' })
    assert.deepEqual(freq.error.notices.map((n: any) => n.code), ['wechat.rate-limited'])
    mode = 'internal'
    const internal = await h.envelope('wechat.articles', { fakeid: 'F' })
    assert.equal(internal.error.code, 'ACTION_FAILED')
    assert.match(internal.error.message, /NOT LOGGED IN[\s\S]*probe=true/)
    assert.equal(internal.error.notices, undefined)
  } finally { h.cleanup(); await service.close() }
  const down = bootPlugin({ wechat: { history: { baseUrl: service.url, minIntervalMs: 0 } } })
  try {
    const envelope = await down.envelope('wechat.accounts', { query: 'x' })
    assert.equal(envelope.ok, false)
    assert.ok(envelope.error.message.includes(service.url) && /has to be running/.test(envelope.error.message))
    assert.equal(envelope.error.code, 'ACTION_FAILED', 'an unreachable service is not an argument error')
  } finally { down.cleanup() }
})

test('the history actions never reach a private address other than the configured origin, even when the service answers with one', async () => {
  const trap = await stubService((_req, res) => send(res, SEARCHBIZ))
  const service = await stubService((_req, res) => { res.writeHead(307, { location: trap.url + '/api/public/searchbiz' }); res.end() })
  const h = bootPlugin({ wechat: { history: { baseUrl: service.url, minIntervalMs: 0 } } })
  try {
    const envelope = await h.envelope('wechat.accounts', { query: 'x' })
    assert.equal(envelope.ok, false)
    assert.deepEqual(trap.hits, [])
  } finally { h.cleanup(); await service.close(); await trap.close() }
})

// ── wechat.status ───────────────────────────────────────────────────────────

test('wechat.status: every layer with its state and access line, the album live, history off, 元宝搜索 not in the chain; no network', async () => {
  const net = stubNetwork(() => { throw new Error('wechat.status must not use the network without probe') })
  const h = bootPlugin()
  try {
    const envelope = await h.envelope('wechat.status')
    assert.equal(envelope.ok, true, JSON.stringify(envelope.error))
    assert.deepEqual(checkOutput(findAction('wechat.status')!.output, envelope.result), [])
    const layers = Object.fromEntries(envelope.result.layers.map((l: any) => [l.id, l]))
    assert.deepEqual(envelope.result.layers.map((l: any) => l.id), ['omnireach', 'wx-search-cli', 'sogou', 'tencent-wsa', 'history', 'album'])
    assert.equal(layers.sogou.state, 'ready')
    assert.equal(layers.sogou.access.risk, 'medium')
    assert.equal(layers['tencent-wsa'].state, 'off')
    assert.equal(layers['tencent-wsa'].verification, 'docs-only')
    assert.equal(layers['tencent-wsa'].access.login, 'api-key')
    assert.equal(layers.history.state, 'off')
    assert.match(layers.history.reason, /wechat\.history\.baseUrl is empty/)
    assert.equal(layers.history.access.risk, 'high')
    assert.equal(layers.history.verification, 'contract-only')
    assert.deepEqual([layers.album.state, layers.album.verification], ['ready', 'live'])
    assert.deepEqual(envelope.result.wsa, { enabled: false, edition: 'standard', mode: 2, dailyLimit: 100, usedToday: 0, remaining: 100 })
    assert.deepEqual(envelope.result.history, { configured: false })
    const text = renderEnvelope(envelope, {})
    assert.match(text, /✅ sogou \[ready\]/)
    assert.match(text, /元宝搜索: off, standard mode 2, today 0\/100 requests \(100 left\)/)
    assert.equal(net.calls.length, 0)
    const noService = await h.envelope('wechat.status', { probe: true })
    assert.equal(noService.error.code, 'CAPABILITY_UNAVAILABLE')
  } finally { net.restore(); h.cleanup() }
})

test('wechat.status shows the 元宝搜索 setup and today\'s usage from the ledger, and the last failure of a layer', async () => {
  const net = stubNetwork(url => (url.startsWith('https://api.wsa.cloud.tencent.com') ? json({ Response: { Error: { Code: 'ResourceUnavailable', Message: 'arrears' } } }) : undefined))
  const keyless = bootPlugin({ wechat: { wsa: { enabled: true } } })
  const h = bootPlugin({ wechat: { wsa: { enabled: true, apiKey: 'status-test-key-0123456789', dailyLimit: 5 }, sogou: { enabled: false } } })
  try {
    const noKey = (await keyless.envelope('wechat.status')).result
    assert.equal(noKey.layers[0].id, 'tencent-wsa')
    assert.equal(noKey.layers[0].state, 'needs_setup')
    assert.equal(noKey.wsa.keyConfigured, false)
    const before = (await h.envelope('wechat.status')).result
    assert.equal(before.layers[0].state, 'ready')
    assert.equal(before.wsa.keyConfigured, true)
    assert.equal(before.layers.find((l: any) => l.id === 'sogou').state, 'off')
    // A real search through the plugin fails at the WSA leg (arrears) and falls through; the status remembers why and says the key is fine.
    await h.envelope('search.run', { query: '备案', platform: 'wechat', fresh: true })
    const after = (await h.envelope('wechat.status')).result
    assert.match(after.layers[0].lastFailure.message, /arrears|ResourceUnavailable/)
    assert.doesNotMatch(JSON.stringify(after), /status-test-key/)
  } finally { net.restore(); h.cleanup(); keyless.cleanup() }
})

test('wechat.status probe: reachable and logged in, expired, not logged in, unreachable; an expired login is an action notice and a good one clears it', async () => {
  let login: Record<string, unknown> = { authenticated: true, loggedIn: true, account: 'x', nickname: '我的号', fakeid: 'F', expireTime: 1793000000000, isExpired: false, status: '登录正常' }
  const service = await stubService((req, res) => (req.url === '/api/health' ? send(res, { status: 'healthy', version: '1.0.0', framework: 'FastAPI' }) : send(res, login)))
  const h = bootPlugin({ wechat: { history: { baseUrl: service.url, minIntervalMs: 0 } } })
  try {
    const good = await h.envelope('wechat.status', { probe: true })
    assert.equal(good.ok, true, JSON.stringify(good.error))
    assert.deepEqual(checkOutput(findAction('wechat.status')!.output, good.result), [])
    assert.deepEqual(good.result.history.probe, { reachable: true, version: '1.0.0', loggedIn: true, expired: false, account: '我的号', expireTime: new Date(1793000000000).toISOString(), status: '登录正常' })
    assert.equal(good.result.layers.find((l: any) => l.id === 'history').state, 'ready')
    assert.equal(good.result.notices, undefined)
    assert.match(renderEnvelope(good, {}), /history service probe: up 1\.0\.0, logged in as 我的号/)

    login = { authenticated: true, loggedIn: true, nickname: '我的号', expireTime: 1700000000000, isExpired: true, status: '登录已过期' }
    const expired = await h.envelope('wechat.status', { probe: true })
    assert.equal(expired.result.history.probe.loggedIn, false)
    assert.equal(expired.result.history.probe.expired, true)
    assert.equal(expired.result.layers.find((l: any) => l.id === 'history').state, 'needs_login')
    assert.deepEqual(expired.result.notices.map((n: any) => [n.code, n.level]), [['wechat.login-expired', 'action']])

    login = { authenticated: false, loggedIn: false, account: '', status: '未登录，请先扫码登录' }
    const never = await h.envelope('wechat.status', { probe: true })
    assert.equal(never.result.history.probe.loggedIn, false)
    assert.equal(never.result.notices, undefined, 'the same notice is not repeated within the session')
    assert.match(renderEnvelope(never, {}), /NOT logged in — 未登录/)

    login = { authenticated: true, loggedIn: true, nickname: '我的号', expireTime: 1793000000000, isExpired: false }
    await h.envelope('wechat.status', { probe: true })
    login = { authenticated: false, loggedIn: false, status: '未登录' }
    assert.ok((await h.envelope('wechat.status', { probe: true })).result.notices, 'after a good login a new loss is shown again')
  } finally { h.cleanup(); await service.close() }
  const down = bootPlugin({ wechat: { history: { baseUrl: service.url, minIntervalMs: 0 } } })
  try {
    const result = (await down.envelope('wechat.status', { probe: true })).result
    assert.equal(result.history.probe.reachable, false)
    assert.ok(result.history.probe.problem.includes(service.url))
    const layer = result.layers.find((l: any) => l.id === 'history')
    assert.equal(layer.state, 'unreachable')
    assert.ok(layer.lastFailure.message.includes(service.url), 'the failure is remembered')
  } finally { down.cleanup() }
})
