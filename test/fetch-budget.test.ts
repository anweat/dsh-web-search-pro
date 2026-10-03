import test from 'node:test'
import assert from 'node:assert/strict'
import dns from 'node:dns/promises'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { registerHooks } from 'node:module'
import { FETCH_HARD_MAX_CHARS, FETCH_STORE_CHARS, FetchService, sliceFetchResult } from '../src/fetch.ts'
import { resolveConfig } from '../src/config.ts'
import { Store } from '../src/store.ts'
import { capText } from '../src/util.ts'
import { findAction } from '../src/actions/registry.ts'
import { fairShareLimit } from '../src/actions/format.ts'
import { callAction, renderResult } from './call-helper.ts'

// dsh-tools is a host peer; tool definitions are identity in this isolated run.
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === '@deepseek-ai/dsh-tools') {
      return { url: 'data:text/javascript,export const defineTool = value => value', shortCircuit: true }
    }
    return nextResolve(specifier, context)
  },
})
const { registerTools } = await import('../src/tools.ts')
const plugin = await import('../src/index.ts')

/** A page whose every 100-character line carries its own offset, so a slice proves where it came from. */
function numberedPage(chars: number): string {
  let out = ''
  for (let i = 0; out.length < chars; i++) out += String(i * 100).padStart(8, '0') + 'x'.repeat(91) + '\n'
  return out.slice(0, chars)
}

function harness() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wsp-fetch-budget-'))
  const config = resolveConfig({ dbPath: path.join(dir, 'store.db'), ttlSeconds: 60, playwright: { enabled: true, snapshotDir: path.join(dir, 's') } } as never)
  const store = new Store(config.dbPath)
  return { dir, config, store, cleanup: () => { store.close(); fs.rmSync(dir, { recursive: true, force: true }) } }
}

/** FetchService whose HTTP backend serves `page` (honouring the cap it is given, like the real backends) and counts calls. */
function serviceFor(h: ReturnType<typeof harness>, page: string) {
  const calls: number[] = []
  const svc = new FetchService(h.store, h.config as never, {} as never)
  ;(svc as any).fetchHttp = async (url: string, _opts: unknown, maxChars: number) => {
    calls.push(maxChars)
    return { url, title: 'Page', text: capText(page, maxChars), source: 'http', fromCache: false, statusCode: 200 }
  }
  return { svc, calls }
}
const http = (over: Record<string, unknown> = {}) => ({ mode: 'http' as const, signal: undefined, maxChars: 20_000, fresh: false, persist: true, ...over })

test('sliceFetchResult: whole pages carry no truncation fields, windows get marker, nextOffset and totalChars', () => {
  const whole = sliceFetchResult({ url: 'u', text: 'abcdef', source: 'http', fromCache: false }, 0, 1000)
  assert.equal(whole.text, 'abcdef')
  assert.equal(whole.truncated, undefined)
  assert.equal(whole.nextOffset, undefined)
  assert.equal(whole.totalChars, 6)

  const first = sliceFetchResult({ url: 'u', text: 'abcdefghij', source: 'http', fromCache: false }, 0, 4)
  assert.equal(first.text, 'abcd\n\n(Content truncated at 4 characters.)')
  assert.deepEqual([first.truncated, first.nextOffset, first.totalChars], [true, 4, 10])

  const last = sliceFetchResult({ url: 'u', text: 'abcdefghij', source: 'http', fromCache: false }, 8, 4)
  assert.equal(last.text, 'ij')
  assert.deepEqual([last.truncated, last.nextOffset, last.totalChars], [undefined, undefined, 10])

  const beyond = sliceFetchResult({ url: 'u', text: 'abc', source: 'http', fromCache: false }, 99, 4)
  assert.equal(beyond.text, '')
  assert.equal(beyond.truncated, undefined)
})

test('sliceFetchResult: a page cut at the read cap is truncated with no known total; at the hard maximum there is nothing to continue', () => {
  const cut = sliceFetchResult({ url: 'u', text: capText('x'.repeat(100), 50), source: 'http', fromCache: false }, 0, 1000)
  assert.equal(cut.text.startsWith('x'.repeat(50)), true)
  assert.deepEqual([cut.truncated, cut.nextOffset, cut.totalChars], [true, 50, undefined])
  const hard = sliceFetchResult({ url: 'u', text: 'x'.repeat(10) + `\n\n(Content truncated at ${FETCH_HARD_MAX_CHARS} characters.)`, source: 'http', fromCache: false }, 0, 1000)
  assert.deepEqual([hard.truncated, hard.nextOffset], [true, undefined])
})

test('fetchPage cuts at maxChars and continues with offset from the stored snapshot, without refetching', async () => {
  const h = harness()
  try {
    const page = numberedPage(60_000)
    const { svc, calls } = serviceFor(h, page)
    const a = await svc.fetchPage('https://ex.test/long', http())
    assert.equal(a.truncated, true)
    assert.equal(a.nextOffset, 20_000)
    assert.equal(a.totalChars, 60_000)
    assert.equal(a.text.startsWith(page.slice(0, 20_000)), true)
    assert.match(a.text, /Content truncated at 20000 characters\.\)$/)

    const b = await svc.fetchPage('https://ex.test/long', http({ offset: a.nextOffset }))
    assert.equal(b.text.startsWith(page.slice(20_000, 40_000)), true)
    assert.equal(b.nextOffset, 40_000)
    assert.equal(b.fromCache, true)

    const c = await svc.fetchPage('https://ex.test/long', http({ offset: b.nextOffset }))
    assert.equal(c.text, page.slice(40_000))
    assert.equal(c.truncated, undefined)
    assert.equal(c.nextOffset, undefined)
    assert.equal(calls.length, 1, 'one network read served all three windows')
    assert.equal(calls[0], FETCH_STORE_CHARS, 'a small window still stores up to the store size')

    // A new service instance (cold memory) continues from the SQLite snapshot too.
    const cold = serviceFor(h, page)
    const d = await cold.svc.fetchPage('https://ex.test/long', http({ offset: 20_000 }))
    assert.equal(d.text.startsWith(page.slice(20_000, 40_000)), true)
    assert.equal(d.source, 'cache:http')
    assert.equal(cold.calls.length, 0)
  } finally { h.cleanup() }
})

test('fetchPage: pages longer than the store size are continued by a larger read, not by pretending the stored part is the whole', async () => {
  const h = harness()
  try {
    const page = numberedPage(150_000)
    const { svc, calls } = serviceFor(h, page)
    const a = await svc.fetchPage('https://ex.test/huge', http({ offset: 80_000 }))
    assert.equal(a.text.startsWith(page.slice(80_000, 100_000)), true)
    assert.deepEqual([a.truncated, a.nextOffset, a.totalChars], [true, 100_000, undefined])
    assert.equal(calls.length, 1)
    // Past the stored part: the cached text cannot answer, so the page is read again with a bigger cap.
    const b = await svc.fetchPage('https://ex.test/huge', http({ offset: a.nextOffset }))
    assert.equal(calls.length, 2)
    assert.equal(calls[1], 120_000)
    assert.equal(b.text.startsWith(page.slice(100_000, 120_000)), true)
    assert.equal(b.nextOffset, 120_000)
    // And it can be read to the end in one more window.
    const c = await svc.fetchPage('https://ex.test/huge', http({ offset: 120_000, maxChars: 50_000 }))
    assert.equal(c.text, page.slice(120_000))
    assert.equal(c.truncated, undefined)
    assert.equal(c.totalChars, 150_000)
  } finally { h.cleanup() }
})

test('fetchPage: different windows of one page share a single in-flight read', async () => {
  const h = harness()
  try {
    const page = numberedPage(30_000)
    const calls: number[] = []
    const svc = new FetchService(h.store, h.config as never, {} as never)
    ;(svc as any).fetchHttp = async (url: string, _o: unknown, maxChars: number) => {
      calls.push(maxChars)
      await new Promise(resolve => setTimeout(resolve, 10))
      return { url, text: capText(page, maxChars), source: 'http', fromCache: false }
    }
    const [x, y] = await Promise.all([svc.fetchPage('https://ex.test/p', http({ maxChars: 5_000 })), svc.fetchPage('https://ex.test/p', http({ maxChars: 5_000, offset: 5_000 }))])
    assert.equal(x.text.startsWith(page.slice(0, 5_000)), true)
    assert.equal(y.text.startsWith(page.slice(5_000, 10_000)), true)
    assert.equal(calls.length, 1)
  } finally { h.cleanup() }
})

// ---- read.contents ----

test('fairShareLimit: short texts keep everything and the room they leave goes to the long ones', () => {
  assert.equal(fairShareLimit([100, 200], 8_000, 30_000), 8_000)
  assert.equal(fairShareLimit([20_000, 20_000, 20_000], 8_000, 30_000), 8_000)
  assert.equal(fairShareLimit([20_000, 20_000, 20_000, 20_000], 8_000, 30_000), 7_500)
  assert.equal(fairShareLimit([1_000, 40_000, 40_000], 20_000, 30_000), 14_500)
  assert.equal(fairShareLimit([], 8_000, 30_000), 8_000)
  assert.equal(fairShareLimit([0, 0], 8_000, 30_000), 8_000)
})

function exaHarness(rows: { url: string; title?: string; text?: string }[], over: Record<string, unknown> = {}) {
  const h = harness()
  Object.assign(h.config, over)
  const definitions = new Map<string, any>()
  registerTools({
    ctx: { tools: { register: (d: any) => definitions.set(d.name, d) } } as any,
    config: h.config, dynamic: () => h.config, store: h.store,
    router: { exaContents: async () => rows } as any, fetch: {} as any, browser: {} as any,
  })
  return { h, tool: { execute: (args: Record<string, unknown>) => callAction(definitions, 'read.contents', args) } }
}

test('read.contents caps each URL at 8k and all URLs at 30k, flags what was cut, and stays schema-compatible', async () => {
  const rows = Array.from({ length: 6 }, (_, i) => ({ url: 'https://ex.test/' + i, title: 'T' + i, text: ('word' + i + ' ').repeat(10_000) }))
  const { h, tool } = exaHarness([...rows, { url: 'https://ex.test/short', text: 'tiny' }])
  try {
    const out = await tool.execute({ urls: rows.map(r => r.url) })
    const long = out.results.slice(0, 6)
    const chars = out.results.reduce((n: number, r: any) => n + (r.text ?? '').replace(/\n\n\(Content truncated.*$/s, '').length, 0)
    assert.ok(chars <= 30_000, 'total cap holds: ' + chars)
    assert.ok(long.every((r: any) => r.truncated === true && r.totalChars === 60_000 && r.text.length <= 5_000 + 60))
    assert.equal(out.results[6].text, 'tiny', 'short text untouched')
    assert.equal(out.results[6].truncated, undefined)
    assert.match(out.note, /6 of 7 text\(s\) cut to 4\d{3} chars/)
    assert.deepEqual(Object.keys(out.results[0]).filter(k => !Object.hasOwn(findAction('read.contents')!.output.properties.results!.items!.properties!, k)), [])
    assert.match(renderResult('read.contents', out), /read\.fetch url=<url> offset=/)
  } finally { h.cleanup() }
})

test('read.contents per-URL cap applies alone when the total allows it, and both are configurable', async () => {
  const { h, tool } = exaHarness([{ url: 'https://ex.test/a', text: 'a'.repeat(20_000) }, { url: 'https://ex.test/b', text: 'b'.repeat(500) }])
  try {
    const out = await tool.execute({ urls: ['https://ex.test/a', 'https://ex.test/b'] })
    assert.equal(out.results[0].truncated, true)
    assert.equal(out.results[0].text.startsWith('a'.repeat(8_000)), true)
    assert.equal(out.results[0].text.startsWith('a'.repeat(8_001)), false)
    assert.equal(out.results[1].truncated, undefined)
  } finally { h.cleanup() }
  const custom = exaHarness([{ url: 'https://ex.test/a', text: 'a'.repeat(20_000) }], { exaContentsPerUrlChars: 12_000, exaContentsTotalChars: 12_000 })
  try {
    const out = await custom.tool.execute({ urls: ['https://ex.test/a'] })
    assert.equal(out.results[0].text.startsWith('a'.repeat(12_000)), true)
    assert.equal(out.results[0].text.startsWith('a'.repeat(12_001)), false)
  } finally { custom.h.cleanup() }
  const none = exaHarness([{ url: 'https://ex.test/a', text: 'short' }])
  try {
    const out = await none.tool.execute({ urls: ['https://ex.test/a'] })
    assert.equal(out.note, undefined)
    assert.deepEqual(out.results, [{ url: 'https://ex.test/a', text: 'short' }])
  } finally { none.h.cleanup() }
})

// ---- ctx.web fetch provider ----

function bootProvider(extra: Record<string, unknown> = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wsp-fetch-provider-'))
  const providers: { fetch?: any } = {}
  const config: any = {
    engines: ['ddg'], enableCliBackends: false, registerProvider: true, providerId: 'web-search-pro',
    dbPath: path.join(dir, 'store.db'), ttlSeconds: 60, timeoutMs: 5_000,
    playwright: { enabled: true, snapshotDir: path.join(dir, 'shots') }, ...extra,
  }
  const disposers: (() => void)[] = []
  const web = { registerSearchProvider: () => {}, registerFetchProvider: (p: any) => { providers.fetch = p } }
  const ctx: any = {
    fiber: { config },
    get: (name: string) => name === 'web' ? web : undefined,
    effect: (fn: () => () => void) => { disposers.push(fn()) },
    logger: () => ({ info() {}, warn() {}, error() {} }),
    tools: { register() {} },
    systemPrompt: { section() {} },
    on: () => () => {},
    inject: () => {},
  }
  plugin.apply(ctx, config)
  return { providers, cleanup: () => { for (const d of disposers) d(); fs.rmSync(dir, { recursive: true, force: true }) } }
}

function stubJina(body: string) {
  const originalLookup = dns.lookup
  const originalFetch = globalThis.fetch
  dns.lookup = (async () => [{ address: '93.184.216.34', family: 4 }]) as typeof dns.lookup
  globalThis.fetch = (async () => new Response(body, { status: 200 })) as typeof fetch
  return () => { dns.lookup = originalLookup; globalThis.fetch = originalFetch }
}

test('ctx.web fetch provider caps the body at twice fetchDefaultChars and reports truncated accurately', async () => {
  const restore = stubJina('# Big\n\n' + 'sentence about nothing in particular. '.repeat(3_000))
  const h = bootProvider()
  try {
    const result = await h.providers.fetch.fetch({ url: 'https://big.test/page' })
    assert.equal(result.truncated, true)
    assert.ok(result.body.content.length <= 40_000 + 60, 'body ' + result.body.content.length)
    assert.ok(result.body.content.length > 30_000)
  } finally { h.cleanup(); restore() }

  const restoreSmall = stubJina('# Small\n\nA short page with a couple of ordinary sentences about databases and their configuration.')
  const small = bootProvider({ fetchDefaultChars: 1_000 })
  try {
    const result = await small.providers.fetch.fetch({ url: 'https://small.test/page' })
    assert.equal(result.truncated, false)
    assert.match(result.body.content, /ordinary sentences/)
  } finally { small.cleanup(); restoreSmall() }

  const restoreCut = stubJina('# Cut\n\n' + 'another plain sentence for the budget test. '.repeat(500))
  const cut = bootProvider({ fetchDefaultChars: 1_000 })
  try {
    const result = await cut.providers.fetch.fetch({ url: 'https://cut.test/page' })
    assert.equal(result.truncated, true)
    assert.ok(result.body.content.length <= 2_000 + 60)
  } finally { cut.cleanup(); restoreCut() }
})

// ---- the other text exits: read.snapshot and history replay ----

test('read.snapshot and history page replay return at most fetchDefaultChars; the full text stays stored', async () => {
  const h = harness()
  const definitions = new Map<string, any>()
  const long = 'z'.repeat(50_000)
  try {
    registerTools({
      ctx: { tools: { register: (d: any) => definitions.set(d.name, d) } } as any,
      config: h.config, dynamic: () => h.config, store: h.store,
      router: {} as any, fetch: {} as any,
      browser: { snapshot: async () => ({ title: 'Snap', text: long, htmlPath: path.join(h.dir, 'p.html') }) } as any,
    })
    const snap = await callAction(definitions, 'read.snapshot', { url: 'https://ex.test/snap', screenshot: false })
    assert.ok(snap.text.length <= 20_000 + 60 && snap.text.length > 19_000)
    assert.match(snap.text, /Content truncated at 20000 characters/)
    const stored = h.store.getPage('https://ex.test/snap', 60)
    assert.equal(stored?.text?.length, 50_000)
    const queryId = h.store.listQueries({ kind: 'snapshot', limit: 1 })[0]!.id
    const replay = await callAction(definitions, 'history.replay', { id: queryId })
    assert.ok(replay.replayedPage.text.length <= 20_000 + 60)
    assert.match(replay.replayedPage.text, /Content truncated at 20000 characters/)
  } finally { h.cleanup() }
})
