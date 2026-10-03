import test from 'node:test'
import assert from 'node:assert/strict'
import dns from 'node:dns/promises'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { registerHooks } from 'node:module'

// dsh-tools is a host peer; tool definitions are identity in this isolated run.
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === '@deepseek-ai/dsh-tools') {
      return { url: 'data:text/javascript,export const defineTool = value => value', shortCircuit: true }
    }
    return nextResolve(specifier, context)
  },
})
const plugin = await import('../src/index.ts')
const { findAction } = await import('../src/actions/registry.ts')
const { callAction, renderResult } = await import('./call-helper.ts')
const { buildPromptText } = await import('../src/prompt.ts')

const TOOLS = ['web_call', 'web_index']
const RSS = '<rss><channel><item><title>Feed hit</title><link>https://feed.test/a</link></item></channel></rss>'

interface FakeBrowser {
  calls: string[]
  render: (...a: any[]) => Promise<any>
  snapshot: (...a: any[]) => Promise<any>
  searchResults: (...a: any[]) => Promise<any>
  opencli: (...a: any[]) => Promise<any>
  close: () => Promise<void>
}

function fakeBrowser(): FakeBrowser {
  const calls: string[] = []
  return {
    calls,
    render: async (url: string) => { calls.push('render:' + url); return { title: 'Rendered', text: 'rendered by browser', html: '<p>x</p>' } },
    snapshot: async (url: string) => { calls.push('snapshot:' + url); return { title: 'Snap', text: 'snap text', htmlPath: '/tmp/x.html' } },
    searchResults: async (url: string) => { calls.push('searchResults:' + url); return [{ url: 'https://zh.test/1', title: 'Browser hit', snippet: 'from the browser' }] },
    opencli: async () => ({ code: 0, stdout: '', stderr: '' }),
    close: async () => {},
  }
}

/** Boot the real apply() against a fake ctx; `holder.browser` is what ctx.get('browser') returns. */
function boot(extra: Record<string, unknown> = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wsp-browser-optional-'))
  const holder: { browser: FakeBrowser | undefined } = { browser: undefined }
  const tools = new Map<string, any>()
  const sections: any[] = []
  const listeners: { event: string; handler: any }[] = []
  const disposers: (() => void)[] = []
  const web = { search: async () => ({ sources: [{ url: 'https://example.com/seam', title: 'Seam hit', snippet: 'native' }] }) }
  const config: any = {
    engines: ['seam'], parallelEngines: false, searchMaxResults: 8, timeoutMs: 5_000, ttlSeconds: 60,
    memoryCacheEntries: 16, rrfConstant: 60, freshnessBoost: 0, authorityBoost: 0, freshnessDays: 30,
    authorityDomains: [], enableCliBackends: false, opencliEnabled: false, agentReachEnabled: false,
    registerProvider: false, providerId: 'web-search-pro', allowProxyFakeIp: false, verbose: false,
    dbPath: path.join(dir, 'store.db'),
    playwright: { enabled: true, snapshotDir: path.join(dir, 'shots') },
    customPlatforms: { forum: { name: 'Forum', url: 'https://forum.test?q={query}', item: '.i', title: '.t', link: 'a' } },
    ...extra,
  }
  const ctx: any = {
    fiber: { config },
    get: (name: string) => name === 'browser' ? holder.browser : name === 'web' ? web : undefined,
    effect: (fn: () => () => void) => { disposers.push(fn()) },
    logger: () => ({ info() {}, warn() {}, error() {} }),
    tools: { register: (d: any) => tools.set(d.name, d) },
    systemPrompt: { section: (s: any) => sections.push(s) },
    on: (event: string, handler: any) => { listeners.push({ event, handler }); return () => {} },
    inject: () => {},
  }
  plugin.apply(ctx, config)
  const run = (action: string, args: any) => callAction(tools, action, args)
  const cleanup = () => {
    for (const d of disposers) d()
    fs.rmSync(dir, { recursive: true, force: true })
  }
  return { holder, tools, sections, listeners, run, cleanup, web }
}

/** Network stub: jina works only for urls containing `jinaOk`, http/rss are served per `pages`. */
function stubNetwork(opts: { jinaOk?: string; pages?: Record<string, string> } = {}) {
  const originalLookup = dns.lookup
  const originalFetch = globalThis.fetch
  dns.lookup = (async () => [{ address: '93.184.216.34', family: 4 }]) as typeof dns.lookup
  globalThis.fetch = (async (input: any) => {
    const url = String(input?.url ?? input)
    if (url.startsWith('https://r.jina.ai/')) {
      return opts.jinaOk && url.includes(opts.jinaOk)
        ? new Response('# Jina Title\n\njina body text for the page', { status: 200 })
        : new Response('nope', { status: 500 })
    }
    const page = opts.pages?.[url]
    if (!page) throw new TypeError('fetch failed') // host is down
    return new Response(page, { status: 200, headers: { 'content-type': 'text/xml' } })
  }) as typeof fetch
  return () => { dns.lookup = originalLookup; globalThis.fetch = originalFetch }
}

const auto = { mode: 'auto' }

test('(a) without a browser service apply() succeeds and registers web_index and web_call', async () => {
  const h = boot()
  const restore = stubNetwork({ jinaOk: 'ok.test', pages: { 'https://feed.test/rss': RSS } })
  try {
    assert.deepEqual([...h.tools.keys()].sort(), [...TOOLS].sort())
    assert.deepEqual(plugin.inject, ['tools', 'systemPrompt'])

    const search = await h.run('search.run', { query: 'no browser needed' })
    assert.equal(search.engine, 'seam')
    assert.equal(search.sources[0].title, 'Seam hit')

    const fetched = await h.run('read.fetch', { url: 'https://ok.test/page', ...auto })
    assert.equal(fetched.source, 'jina')

    // auto: every cheap backend fails -> playwright step is skipped silently, plain failure with a short note
    await assert.rejects(h.run('read.fetch', { url: 'https://down.test/page', ...auto }), /all fetch backends failed.*dsh-browser not installed or not enabled/)
    // explicit playwright: clear dependency error
    await assert.rejects(h.run('read.fetch', { url: 'https://down.test/page', mode: 'playwright' }), /requires the optional dsh-browser plugin.*not installed or not enabled/)

    await assert.rejects(h.run('read.snapshot', { url: 'https://ok.test/page' }), /read\.snapshot requires the optional dsh-browser plugin.*Install\/enable @anweat\/dsh-browser/)

    // browser-only built-in and custom platforms say dsh-browser is needed
    await assert.rejects(h.run('search.run', { platform: 'zhihu', query: 'x', fresh: true }), /platform zhihu unavailable.*dsh-browser/)
    await assert.rejects(h.run('search.run', { platform: 'forum', query: 'x', fresh: true }), /platform forum unavailable.*dsh-browser/)

    // non-browser platform (rss) still works
    const rss = await h.run('search.run', { platform: 'rss', url: 'https://feed.test/rss', query: 'feed', fresh: true })
    assert.equal(rss.sources[0].title, 'Feed hit')

    const schema = findAction('sources.status')!.output
    assert.ok(schema.properties.browser, 'browser is declared in the output schema')
    assert.equal(schema.properties.browser.required, undefined, 'and stays optional')
    assert.equal(schema.additionalProperties, false)
    const status = await h.run('sources.status', {})
    assert.equal(status.browser.available, false)
    assert.equal(status.browser.state, 'missing')
    assert.match(status.browser.reason, /dsh-browser/)
  } finally {
    restore()
    h.cleanup()
  }
})

test('(b) with a browser service the render fallback, snapshot and browser platforms use it', async () => {
  const h = boot()
  const browser = fakeBrowser()
  h.holder.browser = browser
  const restore = stubNetwork()
  try {
    const fetched = await h.run('read.fetch', { url: 'https://down.test/b', ...auto })
    assert.equal(fetched.source, 'playwright')
    assert.equal(fetched.text, 'rendered by browser')

    const explicit = await h.run('read.fetch', { url: 'https://down.test/b2', mode: 'playwright' })
    assert.equal(explicit.source, 'playwright')

    const snap = await h.run('read.snapshot', { url: 'https://down.test/s', screenshot: false })
    assert.equal(snap.text, 'snap text')

    const zhihu = await h.run('search.run', { platform: 'zhihu', query: 'q', fresh: true })
    assert.equal(zhihu.sources[0].title, 'Browser hit')
    const forum = await h.run('search.run', { platform: 'forum', query: 'q', fresh: true })
    assert.equal(forum.sources[0].title, 'Browser hit')

    assert.deepEqual(browser.calls.map(c => c.split(':')[0]), ['render', 'render', 'snapshot', 'searchResults', 'searchResults'])
    const status = await h.run('sources.status', {})
    assert.deepEqual(status.browser, { available: true, state: 'ready' })
  } finally {
    restore()
    h.cleanup()
  }
})

test('(b2) an older browser missing a method reports which method and asks for an update', async () => {
  const h = boot()
  const partial = fakeBrowser() as any
  delete partial.snapshot
  h.holder.browser = partial
  try {
    await assert.rejects(h.run('read.snapshot', { url: 'https://x.test' }), /requires a newer dsh-browser \(service has no snapshot\(\)\)/)
    const status = await h.run('sources.status', {})
    assert.equal(status.browser.state, 'incomplete')
  } finally {
    h.cleanup()
  }
})

test('(c) a browser that appears after apply is picked up on the next call', async () => {
  const h = boot()
  const restore = stubNetwork()
  try {
    await assert.rejects(h.run('read.snapshot', { url: 'https://late.test' }), /dsh-browser/)
    const browser = fakeBrowser()
    h.holder.browser = browser
    const snap = await h.run('read.snapshot', { url: 'https://late.test' })
    assert.equal(snap.title, 'Snap')
    const fetched = await h.run('read.fetch', { url: 'https://down.test/late', ...auto })
    assert.equal(fetched.source, 'playwright')
    const zhihu = await h.run('search.run', { platform: 'zhihu', query: 'late', fresh: true })
    assert.equal(zhihu.sources[0].title, 'Browser hit')
    assert.equal(browser.calls.length, 3)
  } finally {
    restore()
    h.cleanup()
  }
})

test('(d) a browser removed after apply degrades to the no-browser behaviour without crashing', async () => {
  const h = boot()
  const restore = stubNetwork({ jinaOk: 'ok.test' })
  try {
    h.holder.browser = fakeBrowser()
    assert.equal((await h.run('read.snapshot', { url: 'https://gone.test' })).title, 'Snap')
    h.holder.browser = undefined
    await assert.rejects(h.run('read.snapshot', { url: 'https://gone.test' }), /not installed or not enabled/)
    await assert.rejects(h.run('read.fetch', { url: 'https://down.test/gone', ...auto }), /all fetch backends failed/)
    await assert.rejects(h.run('search.run', { platform: 'weibo', query: 'x', fresh: true }), /platform weibo unavailable.*dsh-browser/)
    assert.equal((await h.run('read.fetch', { url: 'https://ok.test/gone', ...auto })).source, 'jina')
    assert.equal((await h.run('search.run', { query: 'still works' })).engine, 'seam')
    assert.equal((await h.run('sources.status', {})).browser.state, 'missing')
  } finally {
    restore()
    h.cleanup()
  }
})

test('system prompt is one line, plus one line about dsh-browser only when it is present', () => {
  const h = boot()
  try {
    assert.equal(h.sections.length, 1)
    const section = h.sections[0]
    assert.equal(section.name, 'tool:web-search-pro')
    assert.equal(typeof section.text, 'function', 'text is evaluated at assembly time')
    const without = section.text()
    assert.doesNotMatch(without, /browser_/)
    assert.match(without, /web_index/)
    assert.match(without, /web_call/)
    assert.match(without, /skill dsh-web-search-pro/)
    assert.doesNotMatch(without, /dsh-browser/, 'no browser line without the service')
    h.holder.browser = fakeBrowser()
    const withBrowser = section.text()
    assert.equal(withBrowser, buildPromptText(true))
    assert.ok(withBrowser.startsWith(without))
    assert.match(withBrowser, /dsh-browser available; for interactive browsing see skill dsh-browser or browser_index\./)
    h.holder.browser = undefined
    assert.equal(section.text(), without)
    assert.ok(without.length <= 300, 'one short line: ' + without.length)
    assert.ok(withBrowser.length - without.length <= 110, 'one short browser line: ' + (withBrowser.length - without.length))
    assert.ok(!without.includes('\n') && !withBrowser.includes('\n'))
  } finally {
    h.cleanup()
  }
})

test('approval is decided per action by this plugin: web_call -> action -> policy, reading automationMode from dsh-browser when present', async () => {
  const h = boot()
  try {
    const hook = h.listeners.find(l => l.event === 'tools/pre-execute')
    assert.ok(hook, 'the plugin registers a tools/pre-execute hook')
    const allow = async () => ({ kind: 'allow' as const })
    const decide = (name: string, args: unknown): Promise<any> => hook!.handler({ name, arguments: args }, allow)
    const call = (action: string, args: unknown = {}) => decide('web_call', { action, args })

    // No browser: automationMode unknown, so the ordinary (standard) rule applies.
    assert.equal((await call('cache.clear')).kind, 'ask')
    assert.match((await call('sources.install', { backend: 'twitter', installer: 'uv' })).reason, /^sources\.install backend=twitter installer=uv: Install an external Web Search Pro backend dependency/)
    for (const action of ['history.delete', 'rules.upsert', 'rules.remove', 'rules.import']) assert.equal((await call(action, { id: 'q', hostname: 'a.test', rulesJson: '[]' })).kind, 'ask', action)
    for (const action of ['search.run', 'read.fetch', 'read.contents', 'read.snapshot', 'history.list', 'history.expand', 'history.export', 'sources.status', 'sources.deps', 'rules.list', 'rules.export', 'cache.stats', 'search.recommend']) assert.equal((await call(action)).kind, 'allow', action)
    // Not ours, the index, an unknown action, and a call another hook already refused pass through unchanged.
    assert.equal((await decide('web_index', {})).kind, 'allow')
    assert.equal((await decide('web_call', { action: 'nope' })).kind, 'allow')
    assert.equal((await decide('web_call', {})).kind, 'allow')
    assert.equal((await decide('read_file', { path: '/x' })).kind, 'allow')
    assert.equal((await hook!.handler({ name: 'web_call', arguments: { action: 'cache.clear' } }, async () => ({ kind: 'deny', reason: 'no' }))).kind, 'deny')

    // With dsh-browser: its automationMode decides, as the old by-name rules did.
    const withMode = (mode: string) => { h.holder.browser = { ...fakeBrowser(), status: async () => ({ automationMode: mode }) } as any }
    withMode('read-only')
    assert.match((await call('cache.clear')).reason, /disabled by automationMode=read-only/)
    assert.equal((await call('cache.clear')).kind, 'deny')
    assert.equal((await call('sources.install', { backend: 'bili' })).kind, 'deny')
    assert.equal((await call('search.run', { query: 'q' })).kind, 'allow')
    withMode('standard')
    assert.equal((await call('cache.clear')).kind, 'ask')
    assert.equal((await call('rules.upsert', { hostname: 'a.test' })).kind, 'ask')
    withMode('autonomous')
    assert.equal((await call('cache.clear')).kind, 'allow')
    assert.equal((await call('rules.import', { rulesJson: '[]' })).kind, 'allow')
    assert.equal((await call('sources.install', { backend: 'bili' })).kind, 'ask')
    withMode('unrestricted')
    assert.equal((await call('sources.install', { backend: 'bili' })).kind, 'allow')
    // A browser without status() (older) or with an unreadable mode counts as unknown.
    h.holder.browser = { ...fakeBrowser(), status: async () => { throw new Error('boom') } } as any
    assert.equal((await call('cache.clear')).kind, 'ask')
    h.holder.browser = fakeBrowser()
    assert.equal((await call('cache.clear')).kind, 'ask')
  } finally {
    h.cleanup()
  }
})

test('built lib has no runtime import of @anweat/dsh-browser', () => {
  const libDir = new URL('../lib/', import.meta.url)
  if (!fs.existsSync(libDir)) return // lib is produced by `pnpm run build`; verify runs build first
  const offenders: string[] = []
  const walk = (dir: URL) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const child = new URL(entry.name + (entry.isDirectory() ? '/' : ''), dir)
      if (entry.isDirectory()) { if (entry.name !== 'types') walk(child); continue }
      if (!/\.(js|mjs|cjs)$/.test(entry.name)) continue
      const text = fs.readFileSync(child, 'utf8')
      if (/(?:from\s*|import\s*\(?\s*|require\(\s*)['"]@anweat\/dsh-browser/.test(text)) offenders.push(entry.name)
    }
  }
  walk(libDir)
  assert.deepEqual(offenders, [])
})

test('(d) sources.status shows the active judge rubric versions, whether overridden, and why an override was ignored', async () => {
  const plain = boot()
  try {
    const status = await plain.run('sources.status', {})
    assert.deepEqual(status.evidence.scorer, 'rule')
    assert.deepEqual(status.evidence.rubrics.map((r: any) => [r.id, r.version, r.overridden]), [['score.support', 'v1', false], ['gate.relevance', 'v1', false], ['gate.constraint', 'v1', false]])
    assert.equal(status.evidence.diagnostics, undefined)
    const schema = findAction('sources.status')!.output
    assert.equal(schema.properties.evidence!.required, undefined, 'optional, closed schema extended only')
    assert.match(renderResult('sources.status', status), /rubric score\.support@v1 #[0-9a-f]{12} \(built-in\)/)
  } finally { plain.cleanup() }

  const tuned = boot({ evidence: { rubrics: {
    'score.support': { version: 'v2', instructions: '文本块直接给出答案吗？\n需求：{need}\n文本块：{candidate}' },
    'gate.relevance': { version: 'v2', instructions: '主题相关吗？{nope}\n{need}\n{candidate}' },
    'nope.rubric': { version: 'v1' },
  } } })
  try {
    const status = await tuned.run('sources.status', {})
    assert.deepEqual(status.evidence.rubrics.map((r: any) => [r.id, r.version, r.overridden]), [['score.support', 'v2', true], ['gate.relevance', 'v1', false], ['gate.constraint', 'v1', false]])
    assert.equal(status.evidence.diagnostics.length, 2)
    assert.match(status.evidence.diagnostics.join('|'), /gate\.relevance: override ignored, built-in v1 used: unknown variable \{nope\}/)
    assert.match(status.evidence.diagnostics.join('|'), /nope\.rubric: override ignored: unknown rubric id/)
    assert.match(renderResult('sources.status', status), /rubric score\.support@v2 #[0-9a-f]{12} \(override\)/)
  } finally { tuned.cleanup() }
})
