import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { registerHooks } from 'node:module'
import { resolveConfig } from '../src/config.ts'
import { createBuiltinRegistry } from '../src/providers/index.ts'
import { SearchRouter } from '../src/router.ts'
import { Store } from '../src/store.ts'
import { SourceUnavailableError } from '../src/providers/unavailable.ts'
import { callEnvelope, renderResult } from './call-helper.ts'
import { BROWSER_020 } from './browser-stub.ts'

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === '@deepseek-ai/dsh-tools') return { url: 'data:text/javascript,export const defineTool = value => value', shortCircuit: true }
    return nextResolve(specifier, context)
  },
})
const { registerTools } = await import('../src/tools.ts')
const { EvidenceService } = await import('../src/pipeline/service.ts')

const PAGE = 'Rust async runtimes compared by people who ran them in production.\n\nTokio is the most widely used runtime: multi-threaded work stealing, mature ecosystem, and the default choice for network services.\n\nsmol is a small runtime with fewer dependencies, a good fit for tools that value compile time.'

function harness(opts: { browser?: boolean; extra?: Record<string, unknown> } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wsp-platform-evidence-'))
  const calls: { url: string; opts: any }[] = []
  const fetched: string[] = []
  const holder: { browser: any } = {
    browser: opts.browser === false ? undefined : {
      ...BROWSER_020,
      render: async () => ({}), snapshot: async () => ({}), close: async () => {}, opencli: async () => ({ code: 0, stdout: '', stderr: '' }),
      searchResults: async (url: string, _spec: unknown, o: unknown) => {
        calls.push({ url, opts: o })
        return [
          { url: 'https://www.zhihu.com/question/1', title: 'Rust 异步运行时怎么选 tokio smol', snippet: 'Tokio is the most widely used runtime for network services' },
          { url: 'https://www.zhihu.com/question/2', title: 'Rust async runtime comparison', snippet: 'tokio versus smol runtime production experience' },
        ]
      },
    },
  }
  const config = resolveConfig({
    engines: ['ddg'], dbPath: path.join(dir, 'store.db'), enableCliBackends: true, opencliEnabled: true, agentReachEnabled: false, ttlSeconds: 60, timeoutMs: 5_000,
    playwright: { enabled: true, snapshotDir: path.join(dir, 'shots') }, ...opts.extra,
  } as never)
  const store = new Store(config.dbPath)
  const router = new SearchRouter({ get: () => undefined } as never, config, store, () => config, () => holder.browser, undefined, createBuiltinRegistry())
  const entries = (router as any).backends.entries as Map<string, any>
  const web = { calls: 0 }
  entries.set('ddg', { id: 'ddg', probe: async () => ({ available: true }), run: async () => { web.calls++; return { sources: [{ url: 'https://web.test/rust', title: 'Rust async runtimes tokio smol', snippet: 'tokio and smol runtime comparison' }] } } })
  const fetchSvc = { fetchPage: async (url: string) => { fetched.push(url); return { url, title: 'Page', text: PAGE, source: 'http', shellPage: false } } }
  const service = new EvidenceService({ router, fetch: fetchSvc as never, store, dynamic: () => config })
  const definitions = new Map<string, any>()
  registerTools({ ctx: { tools: { register: (d: any) => definitions.set(d.name, d) } } as any, config, dynamic: () => config, store, router, fetch: fetchSvc as never, browser: () => holder.browser, evidence: service })
  const cleanup = () => { store.close(); fs.rmSync(dir, { recursive: true, force: true }) }
  return { router, service, store, calls, fetched, holder, web, definitions, cleanup }
}

const TASK = { query: 'rust async runtime tokio smol', task: 'compare Rust async runtimes tokio and smol from real experience', profile: 'experience' as const, count: 5 }

test('evidence with a platform: the platform is the explicit source set, S3-S8 run on its candidates', async () => {
  const h = harness()
  try {
    const out = await h.service.search({ ...TASK, platform: { id: 'zhihu', authProfile: 'zh-profile' } })
    assert.equal(h.web.calls, 0, 'no web engine was queried')
    assert.ok(h.calls.length >= 1, 'the platform was searched through the browser')
    assert.equal(h.calls[0]!.opts.authProfile, 'zh-profile', 'authProfile reaches the platform call')
    assert.deepEqual(out.enginesTried, ['zhihu'])
    assert.equal(out.profile, 'experience')
    assert.ok(out.stats.candidates >= 2)
    assert.ok(h.fetched.length >= 1 && h.fetched.every(u => u.startsWith('https://www.zhihu.com/')), 'top platform pages were read through the fetch service')
    assert.ok(out.evidence.length >= 1, 'evidence blocks came from the fetched pages')
    assert.ok(out.evidence.every(e => e.url.startsWith('https://www.zhihu.com/')))
    // The run is stored like any evidence run.
    assert.equal(h.store.listQueries({ kind: 'search' }).length, 1)
  } finally { h.cleanup() }
})

test('evidence with a platform through search.run: the platform plus task/profile/needs is accepted, bindings and feed URL are honoured', async () => {
  const h = harness({ extra: { browserBindings: { zhihu: { authProfile: 'bound' } } } })
  try {
    const env = await callEnvelope(h.definitions, 'search.run', { platform: 'zhihu', query: TASK.query, task: TASK.task, profile: 'experience', needs: 'which runtime is the default choice;when smol fits' })
    assert.equal(env.ok, true, JSON.stringify(env.error))
    assert.deepEqual(env.result.enginesTried, ['zhihu'])
    assert.equal(env.result.needs.length, 2)
    assert.equal(h.calls[0]!.opts.authProfile, 'bound', 'binding fills the auth profile in evidence mode too')
    assert.equal(env.result.platform, undefined, 'the output stays an evidence pack')
    // platform + engines is a contradiction, not a silent choice.
    const both = await callEnvelope(h.definitions, 'search.run', { platform: 'zhihu', engines: 'ddg', task: 't', query: 'q' })
    assert.equal(both.error.code, 'INVALID_ARGS')
    // allowFallback is meaningless outside evidence mode.
    const lone = await callEnvelope(h.definitions, 'search.run', { query: 'q', allowFallback: true })
    assert.equal(lone.error.code, 'INVALID_ARGS')
    // A web provider is not a platform.
    const web = await callEnvelope(h.definitions, 'search.run', { platform: 'ddg', query: 'q', task: 't' })
    assert.equal(web.error.code, 'INVALID_ARGS')
    assert.match(web.error.message, /unsupported platform: ddg/)
  } finally { h.cleanup() }
})

test('an unavailable platform is a structured error with what is missing and the catalog setup text; no silent fallback', async () => {
  const h = harness({ browser: false })
  try {
    await assert.rejects(h.service.search({ ...TASK, platform: { id: 'zhihu' } }), (e: unknown) => {
      assert.ok(e instanceof SourceUnavailableError)
      assert.equal(e.source, 'zhihu')
      assert.match(e.missing.join(' '), /dsh-browser/)
      return true
    })
    assert.equal(h.web.calls, 0, 'the web engines were not used')
    const env = await callEnvelope(h.definitions, 'search.run', { platform: 'zhihu', query: TASK.query, task: TASK.task, profile: 'experience' })
    assert.equal(env.ok, false)
    assert.equal(env.error.code, 'CAPABILITY_UNAVAILABLE')
    assert.match(env.error.message, /platform zhihu unavailable: unavailable: no usable backend: zhihu: zhihu not found on PATH.*; browser-search: platform zhihu requires the optional dsh-browser plugin/)
    assert.match(env.error.hint, /Default chain: zhihu-cli .*browserBindings/, 'the catalog install text of the zhihu entry')
    assert.match(env.error.hint, /allowFallback=true/)
    // Plain platform mode reports it the same way.
    const plain = await callEnvelope(h.definitions, 'search.run', { platform: 'zhihu', query: 'x' })
    assert.equal(plain.error.code, 'CAPABILITY_UNAVAILABLE')
    // `engines` that are all platforms behave the same; a mix with a ready web engine just skips the unavailable one.
    const viaEngines = await callEnvelope(h.definitions, 'search.run', { engines: 'zhihu,weibo', query: TASK.query, task: TASK.task })
    assert.equal(viaEngines.error.code, 'CAPABILITY_UNAVAILABLE')
    const mixed = await callEnvelope(h.definitions, 'search.run', { engines: 'zhihu,ddg', query: TASK.query, task: TASK.task, profile: 'experience' })
    assert.equal(mixed.ok, true)
    assert.match(mixed.result.notes.join('\n'), /skipped providers: zhihu/)
  } finally { h.cleanup() }
})

test('allowFallback searches the profile\'s web engines instead and the pack says so', async () => {
  const h = harness({ browser: false })
  try {
    const out = await h.service.search({ ...TASK, platform: { id: 'zhihu' }, allowFallback: true })
    assert.ok(h.web.calls >= 1, 'the web engine answered')
    assert.ok(out.enginesTried.includes('ddg'))
    assert.ok(!out.enginesTried.includes('zhihu'))
    assert.match(out.notes.join('\n'), /platform zhihu unavailable: .*dsh-browser.*allowFallback: the profile's web engines were searched instead/)
    // When the platform is ready allowFallback changes nothing.
    const ready = harness()
    try {
      const out2 = await ready.service.search({ ...TASK, platform: { id: 'zhihu' }, allowFallback: true })
      assert.deepEqual(out2.enginesTried, ['zhihu'])
      assert.ok(!out2.notes.some(n => /allowFallback/.test(n)))
      assert.equal(ready.web.calls, 0)
    } finally { ready.cleanup() }
  } finally { h.cleanup() }
})

test('a platform on cooldown is reported, not silently replaced', async () => {
  const h = harness({}, )
  try {
    h.holder.browser.searchResults = async () => { throw new Error('browser crashed') }
    await assert.rejects(h.router.search({ query: 'x', count: 3, fresh: true, multi: false, signal: undefined, platform: { id: 'zhihu' } }), /browser crashed/)
    await assert.rejects(h.service.search({ ...TASK, platform: { id: 'zhihu' } }), /platform zhihu unavailable: cooling down: browser crashed/)
  } finally { h.cleanup() }
})

test('rss in evidence mode: a feed URL in query is the feed, the task text becomes the query', async () => {
  const h = harness()
  const seen: string[] = []
  const entries = (h.router as any).backends.entries as Map<string, any>
  entries.set('rss', { id: 'rss', probe: async () => ({ available: true }), run: async (i: any) => { seen.push(JSON.stringify([i.query, i.options])); return { sources: [{ url: 'https://f.test/a', title: 'Rust async runtimes tokio smol', snippet: 'tokio smol' }] } } })
  try {
    const env = await callEnvelope(h.definitions, 'search.run', { platform: 'rss', query: 'https://f.test/feed.xml', task: TASK.task, profile: 'news_fact' })
    assert.equal(env.ok, true, JSON.stringify(env.error))
    assert.equal(seen.length >= 1, true)
    const [query, options] = JSON.parse(seen[0]!)
    assert.equal(query, TASK.task)
    assert.equal(options.url, 'https://f.test/feed.xml')
  } finally { h.cleanup() }
})

test('sources.status lists platforms in the one provider list with browser and login readiness; custom platforms and their problems show too', async () => {
  const h = harness({ browser: false, extra: { browserBindings: { zhihu: { authProfile: 'bound' } }, customPlatforms: { forum: { name: 'Forum', url: 'https://forum.test/s?q={query}', item: '.i', title: '.t', link: 'a' }, github: { name: 'Mine', url: 'https://x.test/?q={query}', item: '.i', title: '.t', link: 'a' } } } })
  try {
    const env = await callEnvelope(h.definitions, 'search.run', { platform: 'forum', query: 'x' }) // registers the custom platform through the router sync
    assert.equal(env.error.code, 'CAPABILITY_UNAVAILABLE')
    const status = (await callEnvelope(h.definitions, 'sources.status', {})).result
    const byRoute = new Map<string, any>(status.providers.map((p: any) => [p.route, p]))
    const zhihu = byRoute.get('zhihu')
    assert.equal(zhihu.kind, 'platform')
    assert.deepEqual(zhihu.domains, ['zhihu.com'])
    assert.equal(zhihu.needsBrowser, undefined, 'zhihu has a CLI leg, so it does not need the browser')
    assert.deepEqual(zhihu.chain.map((leg: any) => [leg.id, leg.state]), [['zhihu', 'skipped'], ['browser-search', 'skipped']])
    assert.equal(zhihu.readiness.available, false)
    assert.equal(zhihu.readiness.installation, 'missing')
    assert.equal(zhihu.readiness.credential, 'configured', 'the binding counts as a configured login')
    assert.equal(zhihu.readiness.diagnosticCode, 'cli_missing', 'the first skipped leg decides: zhihu-cli is not installed')
    assert.match(zhihu.readiness.reason, /dsh-browser/)
    assert.equal(byRoute.get('ddg').kind, 'web')
    assert.equal(byRoute.get('forum').kind, 'platform')
    assert.equal(byRoute.get('forum').id, 'custom:forum')
    assert.ok(status.engines.some((e: any) => e.id === 'zhihu' && e.available === false), 'the engines list is the same registry')
    assert.ok(status.notes.some((n: string) => /custom platform "github" was not registered/.test(n)))
    const text = renderResult('sources.status', status)
    assert.match(text, /platform zhihu \(platform:zhihu\): installation=missing credential=configured/)
    assert.match(text, /provider ddg \(builtin:ddg\)/)
    assert.match(text, /⚠ custom platform "github" was not registered/)
    // With the browser the platform becomes ready and still says the login is unverified.
    h.holder.browser = { ...BROWSER_020, render: async () => ({}), snapshot: async () => ({}), searchResults: async () => [], opencli: async () => ({ code: 0, stdout: '', stderr: '' }), close: async () => {} }
    const ready = (await callEnvelope(h.definitions, 'sources.status', {})).result.providers.find((p: any) => p.route === 'zhihu')
    assert.equal(ready.readiness.available, true)
    assert.equal(ready.readiness.installation, 'detected')
    assert.equal(ready.readiness.diagnosticCode, 'login_unverified')
  } finally { h.cleanup() }
})
