import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { registerHooks } from 'node:module'
import { resolveConfig } from '../src/config.ts'
import { Store } from '../src/store.ts'
import { SearchRouter } from '../src/router.ts'
import type { ProviderCall, ProviderOutcome } from '../src/pipeline/run.ts'
import { COVERAGE_CAVEAT } from '../src/pipeline/render.ts'
import { createFetchProvider, createSearchProvider, readProviderState, readSelection, renderProviderState } from '../src/provider.ts'
import { callAction, renderResult } from './call-helper.ts'

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === '@deepseek-ai/dsh-tools') return { url: 'data:text/javascript,export const defineTool = value => value', shortCircuit: true }
    return nextResolve(specifier, context)
  },
})
const { registerTools } = await import('../src/tools.ts')
const { EvidenceService } = await import('../src/pipeline/service.ts')
const plugin = (await import('../src/index.ts')).default

const BUSY = '# Busy timeout\n\nIn node:sqlite you set the busy timeout with PRAGMA busy_timeout = 5000 on the DatabaseSync connection. The busy timeout makes a blocked writer wait instead of failing at once.'
const PLAIN = { content: 'PLAIN', sources: [{ url: 'https://plain.test/a', title: 'Plain A' }], truncated: false }

function setup(over: Record<string, unknown> = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wsp-provider-route-'))
  const config = resolveConfig({
    engines: ['seam', 'ddg'], parallelEngines: false, searchMaxResults: 8, timeoutMs: 5_000, ttlSeconds: 60, memoryCacheEntries: 16,
    rrfConstant: 60, freshnessBoost: 0, authorityBoost: 0, freshnessDays: 30, authorityDomains: [], enableCliBackends: false,
    opencliEnabled: false, agentReachEnabled: false, registerProvider: true, providerId: 'wsp-test',
    dbPath: path.join(dir, 'store.db'), playwright: { enabled: true, snapshotDir: path.join(dir, 'shots') }, allowProxyFakeIp: false, verbose: false,
    ...over,
  } as never)
  const store = new Store(config.dbPath)
  const providerCalls: { call: ProviderCall; opts: unknown }[] = []
  const router = {
    providerStatuses: async (ids: string[]) => new Map(ids.map(id => [id, { state: 'ready' as const }])),
    runProvider: async (call: ProviderCall, opts?: unknown): Promise<ProviderOutcome> => {
      providerCalls.push({ call, opts })
      return { state: 'ok', sources: [{ url: 'https://docs.test/busy', title: 'Busy docs', snippet: 'node:sqlite busy timeout' }, { url: 'https://docs.test/wal', title: 'WAL docs', snippet: 'node:sqlite WAL mode' }] }
    },
    resolveSecret: async () => undefined,
    searchAsProvider: async () => PLAIN,
    anyEngineAvailable: () => true,
  }
  const fetchSvc = { fetchPage: async (url: string) => ({ url, title: 'T', text: BUSY, source: 'http', fromCache: false }) }
  const service = new EvidenceService({ router: router as any, fetch: fetchSvc as any, store, dynamic: () => config })
  const cleanup = (): void => { store.close(); fs.rmSync(dir, { recursive: true, force: true }) }
  return { dir, config, store, router, service, providerCalls, cleanup }
}

function provider(h: ReturnType<typeof setup>, over: { evidence?: any; router?: any; guardMs?: number } = {}) {
  return createSearchProvider({ router: over.router ?? h.router, evidence: () => over.evidence ?? h.service, dynamic: () => h.config, id: () => 'wsp-test', surface: 'indexed', ...over.guardMs !== undefined ? { guardMs: over.guardMs } : {} })
}

test('provider.evidence defaults to auto, accepts off, and rejects anything else', () => {
  assert.equal(resolveConfig({ dbPath: '/tmp/x.db' } as never).provider.evidence, 'auto')
  assert.equal(resolveConfig({ dbPath: '/tmp/x.db' } as never).provider.deadlineMs, 25_000)
  assert.equal(resolveConfig({ dbPath: '/tmp/x.db', provider: { evidence: 'off', deadlineMs: 9_000 } } as never).provider.evidence, 'off')
  assert.throws(() => resolveConfig({ dbPath: '/tmp/x.db', provider: { evidence: 'always' } } as never), /provider\.evidence must be one of: auto, off/)
  // The route stays opt-in: registering would make web_search ambiguous for a Host that pins nothing.
  assert.equal(resolveConfig({ dbPath: '/tmp/x.db' } as never).registerProvider, false)
})

test('search provider (auto): content is the evidence pack with gaps, caveat and an expand hint; sources are shaped as before', async () => {
  const h = setup()
  try {
    const out = await provider(h).search({ query: 'node:sqlite busy timeout', maxResults: 5 })
    assert.match(out.content!, /^Evidence pack r_[0-9a-f]{10} \(/)
    assert.ok(out.content!.includes(COVERAGE_CAVEAT))
    assert.match(out.content!, /Needs: n1 "node:sqlite busy timeout"/)
    assert.match(out.content!, /busy_timeout = 5000/)
    assert.match(out.content!, /web_call history\.expand evidenceId=<id>.*web_call read\.fetch url=<url> \(offset=N continues\)\./)
    // The Host lists the sources itself: the pack does not repeat them as "Other sources".
    assert.doesNotMatch(out.content!, /Other sources:/)
    assert.doesNotMatch(out.content!, /seam/, 'no note about the excluded ctx.web engine')
    assert.equal(out.content!.match(/To read around an excerpt/g)!.length, 1, 'one how-to-read-on line')
    assert.deepEqual(out.sources.map(s => s.url), ['https://docs.test/busy', 'https://docs.test/wal'])
    assert.equal(out.sources[0]!.title, 'Busy docs')
    assert.equal(out.truncated, false)
    // The recursion guard reaches the router, and the ctx.web engine is never asked.
    assert.ok(h.providerCalls.length > 0)
    for (const { call, opts } of h.providerCalls) {
      assert.deepEqual(opts, { skipSeam: true })
      assert.notEqual(call.id, 'seam')
    }
    // The pack is stored like any search.run pack: history.expand can follow up on its id.
    const resultId = /Evidence pack (r_[0-9a-f]{10})/.exec(out.content!)![1]!
    assert.ok(h.store.evidenceRun(resultId), 'the run is persisted')
  } finally { h.cleanup() }
})

test('search provider (auto): truncated is true only when kept sources were left out', async () => {
  const h = setup()
  try {
    const cut = await provider(h).search({ query: 'node:sqlite busy timeout', maxResults: 1 })
    assert.equal(cut.sources.length, 1)
    assert.equal(cut.truncated, true)
    const whole = await provider(h).search({ query: 'node:sqlite busy timeout wal', maxResults: 5 })
    assert.equal(whole.truncated, false)
  } finally { h.cleanup() }
})

test('search provider (auto): the same evidence service called directly may use the seam; only the provider route excludes it', async () => {
  const h = setup()
  try {
    await h.service.search({ query: 'node:sqlite busy timeout', count: 5 })
    assert.ok(h.providerCalls.some(c => c.call.id === 'seam'), 'without skipSeam the seam is a normal source')
    assert.ok(h.providerCalls.every(c => (c.opts as { skipSeam?: boolean }).skipSeam === false))
  } finally { h.cleanup() }
})

test('search provider (off): identical to the plain router search, evidence never runs', async () => {
  const h = setup({ provider: { evidence: 'off' } })
  const received: unknown[] = []
  const router = { ...h.router, searchAsProvider: async (request: unknown, signal: unknown) => { received.push([request, signal]); return PLAIN } }
  try {
    const signal = new AbortController().signal
    const request = { query: 'q', maxResults: 3 }
    const out = await provider(h, { router, evidence: { search: async () => { throw new Error('evidence must not run') } } }).search(request, signal)
    assert.equal(out, PLAIN)
    assert.deepEqual(received, [[request, signal]])
  } finally { h.cleanup() }
})

test('search provider (auto): a pipeline failure falls back to the plain result', async () => {
  const h = setup()
  try {
    const out = await provider(h, { evidence: { search: async () => { throw new Error('judge exploded') } } }).search({ query: 'q' })
    assert.equal(out, PLAIN)
  } finally { h.cleanup() }
})

test('search provider (auto): a pipeline that never finishes is cut at deadline + guard and the plain result is returned', async t => {
  // The hung mock has no socket; keep the loop alive for unref'ed deadline timers.
  const keepAlive = setInterval(() => {}, 1_000)
  t.after(() => clearInterval(keepAlive))
  const h = setup({ provider: { evidence: 'auto', deadlineMs: 100 } })
  let seenDeadline: number | undefined
  let seenSignal: AbortSignal | undefined
  const hung = { search: (request: { deadlineMs?: number; signal?: AbortSignal }) => { seenDeadline = request.deadlineMs; seenSignal = request.signal; return new Promise<never>(() => {}) } }
  try {
    const started = Date.now()
    const out = await provider(h, { evidence: hung, guardMs: 30 }).search({ query: 'q' })
    assert.equal(out, PLAIN)
    assert.ok(Date.now() - started < 2_000, 'returned in ' + (Date.now() - started) + ' ms')
    assert.equal(seenDeadline, 100, 'the pipeline gets the provider deadline, not the tool deadline')
    assert.equal(seenSignal?.aborted, true, 'the abandoned run is cancelled')
  } finally { h.cleanup() }
})

test('search provider (auto): the pipeline deadline yields a PARTIAL pack, not a failure', async t => {
  // The hung mock has no socket; keep the loop alive for unref'ed deadline timers.
  const keepAlive = setInterval(() => {}, 1_000)
  t.after(() => clearInterval(keepAlive))
  const h = setup({ provider: { evidence: 'auto', deadlineMs: 100 } })
  try {
    const slowFetch = { fetchPage: (_url: string, opts: { signal?: AbortSignal }) => new Promise<never>((_, reject) => { opts.signal?.addEventListener('abort', () => reject(opts.signal!.reason), { once: true }) }) }
    const service = new EvidenceService({ router: h.router as any, fetch: slowFetch as any, store: h.store, dynamic: () => h.config })
    const out = await provider(h, { evidence: service, guardMs: 2_000 }).search({ query: 'node:sqlite busy timeout' })
    assert.notEqual(out, PLAIN)
    assert.match(out.content!, /PARTIAL: deadline reached/)
  } finally { h.cleanup() }
})

test('search provider (auto): the caller cancelling is rethrown, not answered with a fallback', async () => {
  const h = setup()
  try {
    const controller = new AbortController()
    const evidence = { search: async (request: { signal: AbortSignal }) => { controller.abort(new Error('user stopped')); throw request.signal.reason } }
    await assert.rejects(provider(h, { evidence }).search({ query: 'q' }, controller.signal), /user stopped/)
  } finally { h.cleanup() }
})

test('search provider keeps the router-level recursion guard: runProvider with skipSeam never calls ctx.web', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wsp-seam-guard-'))
  const store = new Store(path.join(dir, 'store.db'), { onDiagnostic: () => {} })
  let webCalls = 0
  const web = { search: async () => { webCalls++; return { sources: [{ url: 'https://seam.test/a', title: 'A' }], truncated: false } } }
  const config = { memoryCacheEntries: 8, ttlSeconds: 60, engines: ['seam'], rrfConstant: 60, freshnessBoost: 0, freshnessDays: 30, authorityBoost: 0, authorityDomains: [], searchMaxResults: 5, parallelEngines: false, exaApiKeyEnv: 'EXA_API_KEY', jinaApiKeyEnv: 'JINA_API_KEY', githubTokenEnv: 'GITHUB_TOKEN', enableCliBackends: false, opencliEnabled: false, agentReachEnabled: false, playwright: { enabled: false } }
  const router = new SearchRouter({ get: (name: string) => name === 'web' ? web : undefined } as never, config as never, store)
  try {
    const signal = new AbortController().signal
    const guarded = await router.runProvider({ id: 'seam', query: 'q', count: 3, signal }, { skipSeam: true })
    assert.notEqual(guarded.state, 'ok')
    assert.equal(webCalls, 0)
    const open = await router.runProvider({ id: 'seam', query: 'q2', count: 3, signal })
    assert.equal(open.state, 'ok')
    assert.equal(webCalls, 1)
  } finally { store.close(); fs.rmSync(dir, { recursive: true, force: true }) }
})

test('flat tool surface names the follow-up calls with the flat tool names', async () => {
  const h = setup()
  try {
    const out = await createSearchProvider({ router: h.router, evidence: () => h.service, dynamic: () => h.config, id: () => 'wsp-test', surface: 'flat' }).search({ query: 'node:sqlite busy timeout' })
    assert.match(out.content!, /web_history_expand evidenceId=<id>.*web_read_fetch url=<url>/)
    assert.doesNotMatch(out.content!, /web_call/)
  } finally { h.cleanup() }
})

// ── fetch provider ──────────────────────────────────────────────────────────

test('fetch provider: a truncated page gets a trailing continue hint with the next offset; a whole page gets none', async () => {
  const h = setup({ fetchDefaultChars: 1_000 })
  const calls: any[] = []
  const pages: Record<string, any> = {
    'https://big.test/p': { url: 'https://big.test/p', text: 'x'.repeat(2_000) + '\n\n(Content truncated at 2000 characters.)', truncated: true, nextOffset: 2_000 },
    'https://hard.test/p': { url: 'https://hard.test/p', text: 'y'.repeat(10) + '\n\n(Content truncated at 10 characters.)', truncated: true },
    'https://small.test/p': { url: 'https://small.test/p', text: 'short page' },
  }
  const fetchProvider = createFetchProvider({ fetch: { fetchPage: async (url: string, opts: unknown) => { calls.push(opts); return pages[url] } } as any, dynamic: () => h.config, id: () => 'wsp-test', surface: 'indexed' })
  try {
    const big = await fetchProvider.fetch({ url: 'https://big.test/p' })
    assert.equal(big.truncated, true)
    assert.equal(calls[0].maxChars, 2_000, 'budget is twice fetchDefaultChars')
    assert.ok(big.body.content.endsWith('\n\n[Continue with web_call read.fetch url=https://big.test/p offset=2000]'))
    const hard = await fetchProvider.fetch({ url: 'https://hard.test/p' })
    assert.equal(hard.truncated, true)
    assert.ok(hard.body.content.endsWith('[Continue with web_call read.fetch url=https://hard.test/p]'), 'no offset when the page cannot be read further')
    const small = await fetchProvider.fetch({ url: 'https://small.test/p' })
    assert.equal(small.truncated, false)
    assert.equal(small.body.content, 'short page')
    assert.equal(small.statusCode, 200)
  } finally { h.cleanup() }
})

// ── registration and selection state ────────────────────────────────────────

function boot(config: Record<string, unknown>, web: unknown) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wsp-route-boot-'))
  const full: any = {
    engines: ['ddg'], enableCliBackends: false, providerId: 'web-search-pro', dbPath: path.join(dir, 'store.db'), ttlSeconds: 60, timeoutMs: 5_000,
    playwright: { enabled: true, snapshotDir: path.join(dir, 'shots') }, ...config,
  }
  const disposers: (() => void)[] = []
  const tools = new Map<string, any>()
  const registered: { search: any[]; fetch: any[] } = { search: [], fetch: [] }
  const hostWeb = web ? { ...web as object, registerSearchProvider: (p: any) => { registered.search.push(p) }, registerFetchProvider: (p: any) => { registered.fetch.push(p) } } : undefined
  const ctx: any = {
    fiber: { config: full },
    get: (name: string) => name === 'web' ? hostWeb : undefined,
    effect: (fn: () => () => void) => { disposers.push(fn()) },
    logger: () => ({ info() {}, warn() {}, error() {} }),
    tools: { register: (d: any) => tools.set(d.name, d) },
    systemPrompt: { section() {} },
    on: () => () => {},
    inject: () => {},
  }
  plugin.apply(ctx, full)
  return { tools, registered, cleanup: () => { for (const d of disposers) d(); fs.rmSync(dir, { recursive: true, force: true }) } }
}

test('registration is opt-in: nothing is registered by default, both providers are with registerProvider', () => {
  const off = boot({}, {})
  try {
    assert.equal(off.registered.search.length + off.registered.fetch.length, 0)
  } finally { off.cleanup() }
  const on = boot({ registerProvider: true, providerId: 'wsp-test' }, {})
  try {
    assert.deepEqual([on.registered.search.map(p => p.id), on.registered.fetch.map(p => p.id)], [['wsp-test'], ['wsp-test']])
    assert.equal(typeof on.registered.search[0].search, 'function')
  } finally { on.cleanup() }
})

test('readSelection: the pinned id comes from the web runtime, falls back to the environment, and says which', () => {
  assert.deepEqual(readSelection({ searchProviderId: 'wsp' }, 'search', 'wsp'), { pinned: 'wsp', via: 'host', state: 'selected' })
  assert.deepEqual(readSelection({ searchProviderId: 'deepseek-official' }, 'search', 'wsp'), { pinned: 'deepseek-official', via: 'host', state: 'other' })
  assert.deepEqual(readSelection({ searchProviderId: undefined, fetchProviderId: undefined }, 'fetch', 'wsp'), { via: 'host', state: 'unpinned' })
  assert.deepEqual(readSelection({}, 'search', 'wsp', { DSH_WEB_SEARCH_PROVIDER: 'wsp' }), { pinned: 'wsp', via: 'env', state: 'selected' })
  assert.deepEqual(readSelection(undefined, 'fetch', 'wsp', { DSH_WEB_FETCH_PROVIDER: ' other ' }), { pinned: 'other', via: 'env', state: 'other' })
  assert.deepEqual(readSelection({}, 'search', 'wsp', {}), { via: 'env', state: 'unpinned' })
})

test('renderProviderState: off, selected, pinned elsewhere and unpinned each say what to do', () => {
  const base = { id: 'wsp', evidence: 'auto' as const }
  const off = renderProviderState({ ...base, registered: false }).join('\n')
  assert.match(off, /off \(registerProvider=false\)/)
  assert.match(off, /searchProvider: <id>, fetchProvider: <id>/)
  assert.match(off, /DSH_WEB_SEARCH_PROVIDER/)

  const active = renderProviderState(readProviderState({ web: { searchProviderId: 'wsp', fetchProviderId: 'wsp' }, registered: true, ...base })).join('\n')
  assert.match(active, /web_search: this plugin \(evidence=auto\); web_fetch: this plugin/)
  assert.doesNotMatch(active, /to use it/)

  const elsewhere = renderProviderState(readProviderState({ web: { searchProviderId: 'deepseek-official', fetchProviderId: 'http' }, registered: true, ...base })).join('\n')
  assert.match(elsewhere, /web_search: NOT this plugin \(the Host is pinned to "deepseek-official"\)/)
  assert.match(elsewhere, /to use it:/)

  const unpinned = renderProviderState(readProviderState({ web: { searchProviderId: undefined, fetchProviderId: 'wsp' }, registered: true, ...base })).join('\n')
  assert.match(unpinned, /web_search: not pinned .*WEB_PROVIDER_AMBIGUOUS/)
  assert.match(unpinned, /web_fetch: this plugin/)
})

test('sources.status reports the route: not registered by default, registered and selected when the Host is pinned to it', async () => {
  const off = boot({}, { searchProviderId: 'deepseek-official', fetchProviderId: 'http' })
  try {
    const result = await callAction(off.tools, 'sources.status')
    assert.deepEqual(result.webRoute, { id: 'web-search-pro', registered: false, evidence: 'auto' })
    assert.match(renderResult('sources.status', result), /ctx\.web route: off \(registerProvider=false\)/)
  } finally { off.cleanup() }

  const on = boot({ registerProvider: true, providerId: 'wsp-test', provider: { evidence: 'off' } }, { searchProviderId: 'wsp-test', fetchProviderId: 'http' })
  try {
    const result = await callAction(on.tools, 'sources.status')
    assert.deepEqual(result.webRoute, { id: 'wsp-test', registered: true, evidence: 'off', search: { pinned: 'wsp-test', via: 'host', state: 'selected' }, fetch: { pinned: 'http', via: 'host', state: 'other' } })
    const text = renderResult('sources.status', result)
    assert.match(text, /web_search: this plugin \(evidence=off\); web_fetch: NOT this plugin \(the Host is pinned to "http"\)/)
  } finally { on.cleanup() }
})
