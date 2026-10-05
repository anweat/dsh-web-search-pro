import test from 'node:test'
import assert from 'node:assert/strict'
import dns from 'node:dns/promises'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { FetchService, classifyPage } from '../src/fetch.ts'
import { resolveConfig } from '../src/config.ts'
import { Store } from '../src/store.ts'
import { BROWSER_020 } from './browser-stub.ts'

const PROSE = 'The busy timeout of a SQLite connection decides how long a writer waits for a lock before it fails with SQLITE_BUSY. Setting it to a few seconds avoids most spurious failures in applications with several writers, and the value can be changed at any time with a pragma. '.repeat(3)
const NAV = Array.from({ length: 12 }, (_, i) => `[Section ${i}](https://nav.test/s${i})`).join(' ')

test('classifyPage: content, shell, login wall, captcha, JS shell and error pages', () => {
  assert.equal(classifyPage(PROSE), 'content')
  assert.equal(classifyPage(NAV), 'shell')
  assert.equal(classifyPage(''), 'js_shell')
  assert.equal(classifyPage('', { statusCode: 502 }), 'error')
  assert.equal(classifyPage('Not Found', { statusCode: 404 }), 'error')
  assert.equal(classifyPage('Please sign in to continue. Email Password Forgot password? Create account'), 'login_wall')
  assert.equal(classifyPage('请先登录后查看完整内容。扫码登录 注册/登录'), 'login_wall')
  assert.equal(classifyPage('Just a moment... Checking your browser before accessing the site. Please complete the CAPTCHA.'), 'captcha')
  assert.equal(classifyPage('请完成安全验证以继续访问'), 'captcha')
  assert.equal(classifyPage('You need to enable JavaScript to run this app.'), 'js_shell')
  assert.equal(classifyPage('Loading...'), 'js_shell')
  assert.equal(classifyPage('请启用 JavaScript 后重试'), 'js_shell')
  assert.equal(classifyPage('', { jsHint: true }), 'js_shell')
  assert.equal(classifyPage('App', { jsHint: true }), 'js_shell')
})

test('classifyPage never calls short-but-substantive factual pages a shell (M0 C10)', () => {
  assert.equal(classifyPage('The Eiffel Tower is 330 metres tall and was completed in 1889.'), 'content')
  assert.equal(classifyPage('珠穆朗玛峰海拔8848.86米，位于中国与尼泊尔边境。'), 'content')
  assert.equal(classifyPage('Node 22.5.0 added node:sqlite. Status: experimental.'), 'content')
  // A login or JavaScript mention inside real prose is not a wall.
  assert.equal(classifyPage(PROSE + ' Users must log in to the admin console to change it, and JavaScript is required there.'), 'content')
  // A 404 that carries an actual explanation is read as content, a bare one is an error.
  assert.equal(classifyPage(PROSE, { statusCode: 404 }), 'content')
})

// ── FetchService: quality-driven escalation with fake transports and a fake browser ──

interface Net { jina?: { status?: number; body: string }; http?: { status?: number; body: string; type?: string }; jinaCalls: number; httpCalls: number }

function stubNetwork(net: Net) {
  const originalLookup = dns.lookup
  const originalFetch = globalThis.fetch
  dns.lookup = (async () => [{ address: '93.184.216.34', family: 4 }]) as typeof dns.lookup
  globalThis.fetch = (async (input: any) => {
    const url = String(input?.url ?? input)
    if (url.startsWith('https://r.jina.ai/')) {
      net.jinaCalls++
      if (!net.jina) return new Response('upstream error', { status: 500 })
      return new Response(net.jina.body, { status: net.jina.status ?? 200 })
    }
    net.httpCalls++
    if (!net.http) throw new TypeError('fetch failed')
    return new Response(net.http.body, { status: net.http.status ?? 200, headers: { 'content-type': net.http.type ?? 'text/html' } })
  }) as typeof fetch
  return () => { dns.lookup = originalLookup; globalThis.fetch = originalFetch }
}

function harness(browserText?: string | (() => string)) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wsp-fetch-escalation-'))
  const config = resolveConfig({ dbPath: path.join(dir, 'store.db'), ttlSeconds: 60, playwright: { enabled: true, snapshotDir: path.join(dir, 's') } } as never)
  const store = new Store(config.dbPath)
  const renders: string[] = []
  const browser = browserText === undefined ? undefined : {
    ...BROWSER_020,
    render: async (url: string, _rules: unknown, opts: { maxChars?: number }) => {
      renders.push(url)
      const text = typeof browserText === 'function' ? browserText() : browserText
      return { title: 'Rendered', text: text.slice(0, opts.maxChars ?? text.length), html: '<main/>' }
    },
  }
  const svc = new FetchService(store, config as never, (() => browser) as never)
  const net: Net = { jinaCalls: 0, httpCalls: 0 }
  return { dir, store, svc, net, renders, cleanup: () => { store.close(); fs.rmSync(dir, { recursive: true, force: true }) } }
}
const auto = (over: Record<string, unknown> = {}) => ({ mode: 'auto' as const, signal: undefined, maxChars: 20_000, fresh: false, persist: true, ...over })
const SPA = '<html><head><title>App</title></head><body><div id="root"></div><noscript>You need to enable JavaScript to run this app.</noscript><script src="/app.js"></script></body></html>'

test('auto: a shell from Jina and a JS app shell from HTTP escalate to the browser, which wins; attempts are recorded and stored', async () => {
  const h = harness(PROSE)
  h.net.jina = { body: '# Docs\n\n' + NAV }
  h.net.http = { body: SPA }
  const restore = stubNetwork(h.net)
  try {
    const out = await h.svc.fetchPage('https://spa.test/docs', auto())
    assert.equal(out.source, 'playwright')
    assert.equal(out.shellPage, undefined)
    assert.equal(out.pageClass, undefined)
    assert.deepEqual(out.attempts?.map(a => a.source + ':' + a.class), ['jina:shell', 'http:js_shell', 'playwright:content'])
    assert.deepEqual(h.renders, ['https://spa.test/docs'])
    const row = h.store.listQueries({ kind: 'fetch', limit: 1 })[0]!
    assert.deepEqual(JSON.parse(row.detail!).attempts.map((a: any) => a.source + ':' + a.class), ['jina:shell', 'http:js_shell', 'playwright:content'])
    assert.equal(row.engine, 'playwright')
    // The rendered page is now the snapshot: served from cache, no further network or render.
    const again = await h.svc.fetchPage('https://spa.test/docs', auto())
    assert.equal(again.fromCache, true)
    assert.equal(h.renders.length, 1)
    assert.equal(h.net.jinaCalls, 1)
  } finally { restore(); h.cleanup() }
})

test('auto: without a browser the best non-content attempt is returned flagged, never an error, and nothing is installed', async () => {
  const h = harness()
  h.net.jina = { body: '# Docs\n\n' + NAV }
  h.net.http = { body: SPA }
  const restore = stubNetwork(h.net)
  try {
    const out = await h.svc.fetchPage('https://spa.test/docs', auto())
    assert.equal(out.shellPage, true)
    assert.equal(out.pageClass, 'shell', 'the link list is more informative than an empty JS shell')
    assert.equal(out.source, 'jina')
    assert.deepEqual(out.attempts?.map(a => a.source + ':' + a.class), ['jina:shell', 'http:js_shell', 'playwright:error'])
    assert.match(out.attempts!.at(-1)!.detail!, /skipped: dsh-browser not installed/)
  } finally { restore(); h.cleanup() }
})

test('auto: content from Jina stops at once; short factual pages are never escalated', async () => {
  const h = harness(PROSE)
  h.net.jina = { body: '# Eiffel\n\nThe Eiffel Tower is 330 metres tall and was completed in 1889.' }
  h.net.http = { body: SPA }
  const restore = stubNetwork(h.net)
  try {
    const out = await h.svc.fetchPage('https://facts.test/eiffel', auto())
    assert.equal(out.source, 'jina')
    assert.deepEqual(out.attempts?.map(a => a.class), ['content'])
    assert.equal(h.net.httpCalls, 0)
    assert.deepEqual(h.renders, [])
  } finally { restore(); h.cleanup() }
})

test('auto: Jina failure then HTTP content never reaches the browser; HTTP shell after a failed Jina does', async () => {
  const content = harness(PROSE)
  content.net.http = { body: '<html><body><article><p>' + PROSE + '</p></article></body></html>' }
  const restoreA = stubNetwork(content.net)
  try {
    const out = await content.svc.fetchPage('https://plain.test/a', auto())
    assert.equal(out.source, 'http')
    assert.deepEqual(out.attempts?.map(a => a.source + ':' + a.class), ['jina:error', 'http:content'])
    assert.deepEqual(content.renders, [])
  } finally { restoreA(); content.cleanup() }

  const spa = harness(PROSE)
  spa.net.http = { body: SPA }
  const restoreB = stubNetwork(spa.net)
  try {
    const out = await spa.svc.fetchPage('https://plain.test/spa', auto())
    assert.equal(out.source, 'playwright')
    assert.deepEqual(out.attempts?.map(a => a.source + ':' + a.class), ['jina:error', 'http:js_shell', 'playwright:content'])
  } finally { restoreB(); spa.cleanup() }
})

test('auto: login walls escalate, captcha and error pages do not (a browser cannot get past them)', async () => {
  const login = harness(PROSE)
  login.net.jina = { body: 'Please sign in to continue. Email Password Forgot password? Create account' }
  login.net.http = { body: '<html><body><p>Please sign in to continue.</p></body></html>' }
  const restoreA = stubNetwork(login.net)
  try {
    const out = await login.svc.fetchPage('https://members.test/a', auto())
    assert.equal(out.source, 'playwright')
    assert.deepEqual(out.attempts?.map(a => a.class), ['login_wall', 'login_wall', 'content'])
  } finally { restoreA(); login.cleanup() }

  const captcha = harness(PROSE)
  captcha.net.jina = { body: 'Just a moment... Checking your browser before accessing the site.' }
  captcha.net.http = { body: '<html><body><p>Just a moment... Checking your browser before accessing the site.</p></body></html>', status: 403 }
  const restoreB = stubNetwork(captcha.net)
  try {
    const out = await captcha.svc.fetchPage('https://guarded.test/a', auto())
    assert.equal(out.pageClass, 'captcha')
    assert.equal(out.shellPage, true)
    assert.deepEqual(captcha.renders, [])
  } finally { restoreB(); captcha.cleanup() }

  const gone = harness(PROSE)
  gone.net.http = { body: '<html><body>Not Found</body></html>', status: 404 }
  const restoreC = stubNetwork(gone.net)
  try {
    const out = await gone.svc.fetchPage('https://gone.test/a', auto())
    assert.equal(out.pageClass, 'error')
    assert.deepEqual(gone.renders, [])
  } finally { restoreC(); gone.cleanup() }
})

test('auto: when the browser also returns a shell the most informative attempt is kept', async () => {
  const h = harness('Loading...')
  h.net.jina = { body: '# Docs\n\n' + NAV }
  h.net.http = { body: SPA }
  const restore = stubNetwork(h.net)
  try {
    const out = await h.svc.fetchPage('https://spa.test/still-shell', auto())
    assert.equal(out.pageClass, 'shell')
    assert.equal(out.source, 'jina')
    assert.deepEqual(out.attempts?.map(a => a.class), ['shell', 'js_shell', 'js_shell'])
  } finally { restore(); h.cleanup() }
})

test('explicit modes do not escalate or fall back', async () => {
  const h = harness(PROSE)
  h.net.jina = { body: '# Docs\n\n' + NAV }
  h.net.http = { body: SPA }
  const restore = stubNetwork(h.net)
  try {
    const jina = await h.svc.fetchPage('https://spa.test/x', auto({ mode: 'jina' }))
    assert.equal(jina.source, 'jina')
    assert.equal(jina.pageClass, 'shell')
    assert.deepEqual(jina.attempts?.map(a => a.source), ['jina'])
    const http = await h.svc.fetchPage('https://spa.test/x', auto({ mode: 'http' }))
    assert.equal(http.pageClass, 'js_shell')
    assert.deepEqual(h.renders, [])
    h.net.jina = undefined
    await assert.rejects(h.svc.fetchPage('https://spa.test/err', auto({ mode: 'jina' })), /jina reader HTTP 500/)
  } finally { restore(); h.cleanup() }
})

test('a cached shell snapshot is re-fetched through the browser when one is available, and served as is when not', async () => {
  const h = harness(PROSE)
  const queryId = h.store.recordQuery({ kind: 'fetch', query: 'x', url: 'https://spa.test/cached', engine: 'http', status: 'ok' })
  h.store.savePage({ queryId, url: 'https://spa.test/cached', text: NAV, source: 'http' })
  h.net.jina = undefined
  const restore = stubNetwork(h.net)
  try {
    const out = await h.svc.fetchPage('https://spa.test/cached', auto())
    assert.equal(out.fromCache, false)
    assert.equal(out.source, 'playwright')
    assert.deepEqual(h.renders, ['https://spa.test/cached'])
  } finally { restore(); h.cleanup() }

  const bare = harness()
  const q2 = bare.store.recordQuery({ kind: 'fetch', query: 'x', url: 'https://spa.test/cached', engine: 'http', status: 'ok' })
  bare.store.savePage({ queryId: q2, url: 'https://spa.test/cached', text: NAV, source: 'http' })
  const restore2 = stubNetwork(bare.net)
  try {
    const out = await bare.svc.fetchPage('https://spa.test/cached', auto())
    assert.equal(out.fromCache, true)
    assert.equal(out.pageClass, 'shell')
    assert.equal(bare.net.jinaCalls + bare.net.httpCalls, 0)
  } finally { restore2(); bare.cleanup() }
})
