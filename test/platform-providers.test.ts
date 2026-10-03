import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { EngineError, type Engine, type EngineDeps } from '../src/engines.ts'
import { resolveConfig, type ResolvedConfig } from '../src/config.ts'
import { createBuiltinRegistry, routeIdOf, type ProbeEnv } from '../src/providers/index.ts'
import { chainEngine, customPlatformAdapter, customProviderId } from '../src/providers/platforms.ts'
import { SearchRouter } from '../src/router.ts'
import { Store } from '../src/store.ts'

const PLATFORMS = ['github', 'github-code', 'github-issues', 'bilibili', 'youtube', 'v2ex', 'xiaohongshu', 'twitter', 'reddit', 'instagram', 'facebook', 'rss', 'zhihu', 'weibo', 'douban', 'tieba', 'douyin', 'kuaishou', 'arxiv', 'pubmed']
const BROWSER_ONLY = ['zhihu', 'weibo', 'douban', 'tieba', 'douyin', 'kuaishou']
const OPENCLI = ['xiaohongshu', 'reddit', 'instagram', 'facebook']

const fakeBrowser = (): any => ({ render: async () => ({}), snapshot: async () => ({}), searchResults: async () => [], opencli: async () => ({ code: 0, stdout: '', stderr: '' }), close: async () => {} })

function env(over: { browser?: unknown; config?: Record<string, unknown>; deps?: Partial<EngineDeps>; cli?: Map<string, boolean> } = {}): ProbeEnv {
  const config = resolveConfig({ engines: ['ddg'], ...over.config } as never)
  const deps = { enableCli: true, opencliEnabled: true, agentReachEnabled: true, allowProxyFakeIp: false, skipSeam: false, ...over.browser ? { browser: over.browser } : {}, ...over.deps } as EngineDeps
  return { deps, config, ...over.cli ? { cli: over.cli } : {} }
}

test('every platform backend is a registry provider of kind platform with its domains and requirements', () => {
  const registry = createBuiltinRegistry()
  for (const id of PLATFORMS) {
    const a = registry.resolve(id)
    assert.ok(a, id + ' is registered')
    const d = a.descriptor
    assert.equal(d.kind, 'platform', id)
    assert.equal(routeIdOf(d), id)
    if (id !== 'rss') assert.ok(d.domains?.length, id + ' names its domains') // a feed has no fixed site
    assert.ok(d.taskProfiles.length && d.languages.length, id)
  }
  assert.equal(registry.list().filter(a => a.descriptor.kind === 'platform').length, PLATFORMS.length, 'no other provider is a platform')
  for (const id of [...BROWSER_ONLY, ...OPENCLI, 'twitter']) assert.ok(registry.resolve(id)!.descriptor.requirements.some(r => r.kind === 'browser'), id + ' declares the browser')
  for (const id of BROWSER_ONLY) assert.equal(registry.resolve(id)!.descriptor.needsBrowser, 'searchResults', id)
  for (const id of [...OPENCLI, 'twitter']) assert.equal(registry.resolve(id)!.descriptor.needsBrowser, 'opencli', id)
  assert.deepEqual(registry.resolve('zhihu')!.descriptor.domains, ['zhihu.com'])
  assert.deepEqual(registry.resolve('twitter')!.descriptor.domains, ['twitter.com', 'x.com'])
  assert.equal(registry.resolve('github-code')!.descriptor.requirements.find(r => r.kind === 'key')!.optional, false)
  // The web engines stay kind web; nothing else changed their shape.
  for (const id of ['ddg', 'bing', 'exa', 'bocha', 'wikipedia']) assert.notEqual(registry.resolve(id)!.descriptor.kind, 'platform', id)
})

test('twitter is ONE provider whose chain keeps today\'s order: OpenCLI first, then twitter-cli', async () => {
  const registry = createBuiltinRegistry()
  assert.equal(registry.list().filter(a => a.descriptor.aliases.includes('twitter')).length, 1)
  assert.ok(!registry.resolve('opencli-twitter') && !registry.resolve('agentreach-twitter'), 'no separate providers for the legs')
  const trail: string[] = []
  const leg = (id: string, run: () => Promise<{ sources: { url: string }[] }>): Engine => ({ id, label: id, available: () => true, search: async () => { trail.push(id); return run() } })
  const empty = leg('opencli-twitter', async () => { throw new EngineError('no results', 'ENGINE_EMPTY', false) })
  const cli = leg('agentreach-twitter', async () => ({ sources: [{ url: 'https://x.com/a/status/1' }] }))
  const out = await chainEngine('twitter', 'Twitter / X', [empty, cli]).search('q', 5)
  assert.deepEqual(trail, ['opencli-twitter', 'agentreach-twitter'])
  assert.equal(out.via, 'agentreach-twitter', 'the leg that answered is named')
  // The first leg that answers ends the chain.
  trail.length = 0
  const first = await chainEngine('twitter', 'Twitter / X', [leg('opencli-twitter', async () => ({ sources: [{ url: 'https://x.com/b' }] })), cli]).search('q', 5)
  assert.deepEqual(trail, ['opencli-twitter'])
  assert.equal(first.via, 'opencli-twitter')
  // Empty legs only: an empty answer (not a fault); one failing leg among them: a retryable-aware fault.
  await assert.rejects(chainEngine('t', 'T', [empty, leg('b', async () => { throw new EngineError('none', 'ENGINE_EMPTY', false) })]).search('q', 1), (e: any) => e.code === 'ENGINE_EMPTY')
  await assert.rejects(chainEngine('t', 'T', [empty, leg('b', async () => { throw new EngineError('boom', 'ENGINE_ERROR') })]).search('q', 1), (e: any) => e.code === 'ENGINE_ERROR' && e.retryable === true && /opencli-twitter: no results; b: boom/.test(e.message))
  // A cancelled call is rethrown, never turned into a fallthrough.
  const ac = new AbortController()
  ac.abort()
  await assert.rejects(chainEngine('t', 'T', [leg('a', async () => { throw new Error('cancelled') }), cli]).search('q', 1, ac.signal), /cancelled/)
})

test('local probes by dimension: browser platforms say dsh-browser is missing, a binding counts as a configured credential', () => {
  const registry = createBuiltinRegistry()
  for (const id of [...BROWSER_ONLY, ...OPENCLI]) {
    const none = registry.resolve(id)!.probeLocal(env()) as any
    assert.equal(none.available, false, id)
    assert.equal(none.installation, 'missing', id)
    assert.equal(none.diagnosticCode, 'browser_missing', id)
    assert.match(none.reason, new RegExp('platform ' + id + ' requires the optional dsh-browser plugin'), id)
    const ready = registry.resolve(id)!.probeLocal(env({ browser: fakeBrowser() })) as any
    assert.equal(ready.available, true, id)
    assert.equal(ready.installation, 'detected', id)
    assert.equal(ready.credential, undefined, 'a login cannot be checked locally')
    assert.equal(ready.diagnosticCode, 'login_unverified')
    const bound = registry.resolve(id)!.probeLocal(env({ browser: fakeBrowser(), config: { browserBindings: { [id]: { authProfile: 'p' } } } })) as any
    assert.equal(bound.credential, 'configured', id)
  }
  // An older browser without the method is incompatible, not missing.
  const old = fakeBrowser()
  delete old.searchResults
  const incompatible = registry.resolve('zhihu')!.probeLocal(env({ browser: old })) as any
  assert.equal(incompatible.installation, 'incompatible')
  assert.match(incompatible.reason, /requires a newer dsh-browser/)
  // OpenCLI platforms also honour the settings switches.
  const off = registry.resolve('reddit')!.probeLocal(env({ browser: fakeBrowser(), deps: { opencliEnabled: false } })) as any
  assert.equal(off.available, false)
  assert.match(off.reason, /opencliEnabled/)
  // rss and the API platforms need nothing local; github-code needs a token.
  assert.equal((registry.resolve('rss')!.probeLocal(env()) as any).available, true)
  assert.equal((registry.resolve('v2ex')!.probeLocal(env()) as any).available, true)
  const hadToken = [process.env.GITHUB_TOKEN, process.env.GH_TOKEN]
  delete process.env.GITHUB_TOKEN
  delete process.env.GH_TOKEN
  try {
    const bare = registry.resolve('github-code')!.probeLocal(env()) as any
    assert.equal(bare.available, false)
    assert.equal(bare.credential, 'missing')
    assert.match(bare.reason, /GITHUB_TOKEN/)
    assert.equal((registry.resolve('github-code')!.probeLocal(env({ deps: { githubToken: 't' } })) as any).credential, 'configured')
  } finally {
    if (hadToken[0] !== undefined) process.env.GITHUB_TOKEN = hadToken[0]
    if (hadToken[1] !== undefined) process.env.GH_TOKEN = hadToken[1]
  }
})

test('twitter probe: ready through either leg; the reason names both when neither works', () => {
  const registry = createBuiltinRegistry()
  const tokens = [process.env.TWITTER_AUTH_TOKEN, process.env.TWITTER_CT0]
  delete process.env.TWITTER_AUTH_TOKEN
  delete process.env.TWITTER_CT0
  try {
    const none = registry.resolve('twitter')!.probeLocal(env()) as any
    assert.equal(none.available, false)
    assert.match(none.reason, /dsh-browser/)
    assert.match(none.reason, /twitter-cli: TWITTER_AUTH_TOKEN \/ TWITTER_CT0 are not set/)
    assert.equal((registry.resolve('twitter')!.probeLocal(env({ browser: fakeBrowser() })) as any).available, true, 'the OpenCLI leg alone is enough')
    process.env.TWITTER_AUTH_TOKEN = 'a'
    process.env.TWITTER_CT0 = 'b'
    const viaCli = registry.resolve('twitter')!.probeLocal(env({ cli: new Map([['twitter', true]]) })) as any
    assert.equal(viaCli.available, true, 'the twitter-cli leg alone is enough')
    assert.equal(viaCli.credential, 'configured')
    assert.equal(viaCli.installation, 'detected')
  } finally {
    if (tokens[0] === undefined) delete process.env.TWITTER_AUTH_TOKEN; else process.env.TWITTER_AUTH_TOKEN = tokens[0]
    if (tokens[1] === undefined) delete process.env.TWITTER_CT0; else process.env.TWITTER_CT0 = tokens[1]
  }
})

// ── custom platforms ─────────────────────────────────────────────────────────

function routerWith(initial: Record<string, unknown>) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wsp-custom-platform-'))
  const store = new Store(path.join(dir, 'store.db'))
  let live: Record<string, unknown> = initial
  const dynamic = (): ResolvedConfig => resolveConfig({ engines: ['ddg'], dbPath: path.join(dir, 'store.db'), ...live } as never)
  const registry = createBuiltinRegistry()
  const router = new SearchRouter({ get: () => undefined } as never, dynamic(), store, dynamic, undefined, undefined, registry)
  return { router, registry, set: (next: Record<string, unknown>) => { live = next }, cleanup: () => { store.close(); fs.rmSync(dir, { recursive: true, force: true }) } }
}

const forum = (name = 'Forum', url = 'https://forum.test/s?q={query}') => ({ name, url, item: '.i', title: '.t', link: 'a' })

test('custom platforms are registered from the settings, re-synced on change and unregistered when removed', async () => {
  const h = routerWith({ customPlatforms: { forum: forum() } })
  try {
    await h.router.providerReport()
    const a = h.registry.resolve('forum')
    assert.ok(a, 'registered as a provider')
    assert.equal(a.descriptor.id, 'custom:forum')
    assert.equal(a.descriptor.kind, 'platform')
    assert.equal(a.descriptor.needsBrowser, 'searchResults')
    assert.deepEqual(a.descriptor.domains, ['forum.test'])
    assert.equal(routeIdOf(a.descriptor), 'forum')
    assert.ok((await h.router.providerReport()).some(p => p.route === 'forum' && p.kind === 'platform'), 'listed with the other sources')
    assert.deepEqual(await h.router.providerStatuses(['forum']).then(m => m.get('forum')?.state), 'unavailable', 'no browser: not ready')

    // An edit replaces the provider (same alias, new descriptor data).
    h.set({ customPlatforms: { forum: forum('Forum 2', 'https://other.test/s?q={query}') } })
    await h.router.providerReport()
    assert.equal(h.registry.resolve('forum')!.descriptor.label, 'Forum 2 (自定义)')
    assert.deepEqual(h.registry.resolve('forum')!.descriptor.domains, ['other.test'])
    // Another key appears; the first one is removed.
    h.set({ customPlatforms: { second: forum('Second') } })
    await h.router.providerReport()
    assert.equal(h.registry.resolve('forum'), undefined, 'removed from the settings: unregistered')
    assert.ok(h.registry.resolve('second'))
    // No custom platforms left.
    h.set({})
    await h.router.providerReport()
    assert.equal(h.registry.resolve('second'), undefined)
    assert.equal(h.registry.list().filter(p => p.descriptor.id.startsWith('custom:')).length, 0)
    // The backend of an unregistered provider stops being scheduled.
    assert.equal((h.router as any).backends.has('forum'), false)
  } finally { h.cleanup() }
})

test('a custom key that clashes with a registered provider is refused and reported; dispose unregisters what the router added', async () => {
  const h = routerWith({ customPlatforms: { github: forum('Mine'), 'two words': forum('Spaces'), 'ok-key': forum('Fine') } })
  try {
    await h.router.providerReport()
    assert.equal(h.registry.resolve('github')!.descriptor.id, 'builtin:github', 'the built-in source is never replaced')
    assert.ok(h.registry.resolve('ok-key'))
    const problems = h.router.customPlatformProblems()
    assert.equal(problems.length, 2)
    assert.ok(problems.some(p => /github/.test(p)))
    assert.ok(problems.some(p => /two words.*whitespace/.test(p)))
    h.router.dispose()
    assert.equal(h.registry.resolve('ok-key'), undefined)
    assert.ok(h.registry.resolve('github'), 'built-ins are untouched')
  } finally { h.cleanup() }
})

test('custom ids that are not valid registry ids get a stable hashed id and keep their key as the route', () => {
  assert.equal(customProviderId('forum'), 'custom:forum')
  const id = customProviderId('我的论坛')
  assert.match(id, /^custom:k[0-9a-f]{10}$/)
  assert.equal(id, customProviderId('我的论坛'))
  const registry = createBuiltinRegistry()
  registry.register(customPlatformAdapter('我的论坛', forum()))
  assert.equal(registry.routeId('我的论坛'), '我的论坛')
  assert.equal(registry.validate(['我的论坛', 'ddg']).join(), '我的论坛,ddg')
})
