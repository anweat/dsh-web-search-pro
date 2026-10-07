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
import { BROWSER_020 } from './browser-stub.ts'

interface Calls { searchResults: { url: string; opts: any }[]; opencli: { args: string[] }[] }

function harness(extra: Record<string, unknown> = {}, opts: { browser?: boolean; results?: any[] | (() => any[]) } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wsp-platform-search-'))
  const store = new Store(path.join(dir, 'store.db'))
  const calls: Calls = { searchResults: [], opencli: [] }
  const holder: { browser: any } = {
    browser: opts.browser === false ? undefined : {
      ...BROWSER_020,
      render: async () => ({}), snapshot: async () => ({}), close: async () => {},
      searchResults: async (url: string, _spec: unknown, o: unknown) => { calls.searchResults.push({ url, opts: o }); const r = opts.results ?? [{ url: 'https://zh.test/1', title: 'Browser hit', snippet: 'from the browser' }]; return typeof r === 'function' ? r() : r },
      opencli: async (args: string[]) => { calls.opencli.push({ args }); return { code: 0, stdout: '- url: https://x.com/a/status/1\n  title: tweet\n', stderr: '' } },
    },
  }
  const config = resolveConfig({ engines: ['ddg'], dbPath: path.join(dir, 'store.db'), enableCliBackends: true, opencliEnabled: true, agentReachEnabled: false, ttlSeconds: 60, ...extra } as never)
  const router = new SearchRouter({ get: () => undefined } as never, config, store, () => config, () => holder.browser, undefined, createBuiltinRegistry())
  const search = (query: string, platform: Record<string, unknown>, o: { count?: number; fresh?: boolean; signal?: AbortSignal } = {}) =>
    router.search({ query, count: o.count ?? 5, fresh: o.fresh ?? true, multi: false, signal: o.signal, platform: platform as never })
  const cleanup = () => { store.close(); fs.rmSync(dir, { recursive: true, force: true }) }
  return { router, store, calls, holder, search, cleanup }
}

test('a platform runs through the registry: persisted as kind platform with the backend that answered, replayed from the cache', async () => {
  const h = harness()
  try {
    const live = await h.search('rust', { id: 'zhihu' }, { fresh: false })
    assert.equal(live.engine, 'zhihu')
    assert.deepEqual(live.enginesTried, ['zhihu'])
    assert.equal(live.fromCache, false)
    assert.equal(live.sources[0]!.title, 'Browser hit')
    const rows = h.store.listQueries({ kind: 'platform' })
    assert.equal(rows.length, 1)
    assert.equal(rows[0]!.platform, 'zhihu')
    assert.equal(rows[0]!.engine, 'playwright-zhihu', 'history names the concrete backend')
    assert.equal(h.store.listQueries({ kind: 'search' }).length, 0)
    const again = await h.search('rust', { id: 'zhihu' }, { fresh: false })
    assert.equal(again.fromCache, true)
    assert.equal(h.calls.searchResults.length, 1, 'the cache answered')
    // A different count reuses the larger cached answer; fresh bypasses it.
    assert.equal((await h.search('rust', { id: 'zhihu' }, { fresh: false, count: 1 })).fromCache, true)
    assert.equal((await h.search('rust', { id: 'zhihu' }, { fresh: true })).fromCache, false)
    // SQLite replay (new process memory) keeps the shape.
    const second = new SearchRouter({ get: () => undefined } as never, resolveConfig({ engines: ['ddg'], dbPath: 'x', ttlSeconds: 60 } as never), h.store, undefined, () => h.holder.browser, undefined, createBuiltinRegistry())
    const replay = await second.search({ query: 'rust', count: 5, fresh: false, multi: false, signal: undefined, platform: { id: 'zhihu' } })
    assert.equal(replay.fromCache, true)
    assert.equal(replay.engine, 'zhihu')
  } finally { h.cleanup() }
})

test('an unavailable platform is an error that says what is missing; it never cools down or falls back', async () => {
  const h = harness({}, { browser: false })
  try {
    for (let i = 0; i < 3; i++) await assert.rejects(h.search('x', { id: 'zhihu' }), /platform zhihu unavailable \(tried: zhihu\): no usable backend: zhihu: zhihu not found on PATH.*; browser-search: platform zhihu requires the optional dsh-browser plugin/)
    const status = await h.router.providerStatuses(['zhihu'])
    assert.equal(status.get('zhihu')!.state, 'unavailable', 'a probe failure is not a cooldown')
    assert.equal(h.store.listQueries({ kind: 'platform' }).length, 0)
    // The browser shows up later: the very next call works.
    h.holder.browser = harness().holder.browser
    assert.equal((await h.search('x', { id: 'zhihu' })).sources.length, 1)
  } finally { h.cleanup() }
})

test('M0 cooldown rules hold for platforms: empty and cancelled calls do not cool down, a transient fault does', async () => {
  let mode: 'empty' | 'boom' | 'ok' = 'empty'
  const h = harness({}, { results: () => { if (mode === 'boom') throw new Error('browser crashed'); return mode === 'ok' ? [{ url: 'https://zh.test/ok', title: 'ok' }] : [] } })
  try {
    // Empty: a result that carries the platform's own hint (login, selectors), not an error.
    const empty = await h.search('x', { id: 'weibo' })
    assert.deepEqual(empty.sources, [])
    assert.match(empty.fallbackNote!, /^no results: 微博 未取到结果.*登录态/)
    assert.equal((await h.router.providerStatuses(['weibo'])).get('weibo')!.state, 'ready', 'empty is not a fault')
    assert.equal(h.store.listQueries({ kind: 'platform' }).length, 0, 'an empty answer is not cached')
    // A cancelled call is rethrown and cools nothing.
    const ac = new AbortController()
    ac.abort()
    await assert.rejects(h.search('x', { id: 'weibo' }, { signal: ac.signal }))
    assert.equal((await h.router.providerStatuses(['weibo'])).get('weibo')!.state, 'ready')
    // A transient fault is an error with the reason and puts the platform on cooldown.
    mode = 'boom'
    await assert.rejects(h.search('x', { id: 'weibo' }), /platform weibo unavailable \(tried: weibo\): browser crashed/)
    assert.equal((await h.router.providerStatuses(['weibo'])).get('weibo')!.state, 'cooldown')
    mode = 'ok'
    await assert.rejects(h.search('x', { id: 'weibo' }), /platform weibo unavailable.*cooldown/, 'skipped while cooling down')
  } finally { h.cleanup() }
})

test('twitter: one provider, the OpenCLI leg answers and history names it', async () => {
  const h = harness()
  try {
    const out = await h.search('release notes', { id: 'twitter' })
    assert.equal(out.engine, 'twitter')
    assert.deepEqual(h.calls.opencli[0]!.args.slice(0, 3), ['twitter', 'search', 'release notes'])
    assert.equal(h.store.listQueries({ kind: 'platform' })[0]!.engine, 'opencli-twitter')
    // Without the browser and without any CLI nothing is left to try, and every leg is named with what to install.
    const none = harness({ agentReachEnabled: true }, { browser: false })
    const savedTokens = [process.env.TWITTER_AUTH_TOKEN, process.env.TWITTER_CT0]
    delete process.env.TWITTER_AUTH_TOKEN
    delete process.env.TWITTER_CT0
    try { await assert.rejects(none.search('x', { id: 'twitter' }), /platform twitter unavailable.*twitter: twitter not found on PATH.*opencli: opencli not found on PATH.*browser-opencli: platform twitter requires the optional dsh-browser/) } finally {
      if (savedTokens[0] !== undefined) process.env.TWITTER_AUTH_TOKEN = savedTokens[0]
      if (savedTokens[1] !== undefined) process.env.TWITTER_CT0 = savedTokens[1]
      none.cleanup()
    }
  } finally { h.cleanup() }
})

test('browserBindings fill authProfile / rulePack for platform and engines calls alike; an explicit value wins and is part of the cache key', async () => {
  const h = harness({ browserBindings: { zhihu: { authProfile: 'bound-profile', rulePack: 'bound-pack' } } })
  try {
    await h.search('a', { id: 'zhihu' })
    assert.equal(h.calls.searchResults.at(-1)!.opts.authProfile, 'bound-profile')
    assert.equal(h.calls.searchResults.at(-1)!.opts.rulePack, 'bound-pack')
    await h.search('a', { id: 'zhihu', authProfile: 'explicit' })
    assert.equal(h.calls.searchResults.at(-1)!.opts.authProfile, 'explicit')
    assert.equal(h.calls.searchResults.at(-1)!.opts.rulePack, 'bound-pack')
    // The same name in `engines` of a classic search gets the binding too.
    await h.router.search({ query: 'a', engines: ['zhihu'], count: 5, fresh: true, multi: false, signal: undefined })
    assert.equal(h.calls.searchResults.at(-1)!.opts.authProfile, 'bound-profile')
    // Rebinding changes the cache key: the old answer is not replayed for the new profile.
    const first = await h.search('b', { id: 'zhihu' }, { fresh: false })
    const cached = await h.search('b', { id: 'zhihu' }, { fresh: false })
    assert.equal(cached.fromCache, true)
    const other = await h.search('b', { id: 'zhihu', authProfile: 'someone-else' }, { fresh: false })
    assert.equal(other.fromCache, false)
    void first
  } finally { h.cleanup() }
})

test('engines naming a platform provider run the same way in a classic search (no platform field, search history)', async () => {
  const h = harness()
  try {
    const out = await h.router.search({ query: 'a', engines: ['zhihu'], count: 5, fresh: true, multi: false, signal: undefined })
    assert.equal(out.engine, 'zhihu')
    assert.equal(out.sources[0]!.title, 'Browser hit')
    assert.equal(h.store.listQueries({ kind: 'search' }).length, 1)
    assert.equal(h.store.listQueries({ kind: 'platform' }).length, 0)
  } finally { h.cleanup() }
})

test('rss: url, legacy feed URL in query, query filter; the feed is part of the cache key', async () => {
  const h = harness()
  const originalLookup = dns.lookup
  const originalFetch = globalThis.fetch
  const hits: string[] = []
  dns.lookup = (async () => [{ address: '93.184.216.34', family: 4 }]) as typeof dns.lookup
  globalThis.fetch = (async (input: any) => {
    hits.push(String(input?.url ?? input))
    return new Response('<rss><channel><item><title>Alpha post</title><link>https://f.test/a</link></item><item><title>Beta post</title><link>https://f.test/b</link></item></channel></rss>', { status: 200 })
  }) as typeof fetch
  try {
    const all = await h.search('', { id: 'rss', url: 'https://f.test/one.xml' })
    assert.equal(all.sources.length, 2)
    const filtered = await h.search('beta', { id: 'rss', url: 'https://f.test/one.xml' })
    assert.deepEqual(filtered.sources.map(s => s.title), ['Beta post'])
    const legacy = await h.search('https://f.test/two.xml', { id: 'rss' })
    assert.equal(legacy.sources.length, 2, 'a feed URL in query is the feed, not a filter')
    assert.ok(hits.includes('https://f.test/two.xml'))
    const rows = h.store.listQueries({ kind: 'platform' })
    assert.equal(rows.length, 3)
    // Two feeds with the same text never share a cache entry.
    await h.search('', { id: 'rss', url: 'https://f.test/three.xml' }, { fresh: false })
    assert.equal((await h.search('', { id: 'rss', url: 'https://f.test/four.xml' }, { fresh: false })).fromCache, false)
    // No feed at all: a clear error, never a cooldown.
    await assert.rejects(h.search('news', { id: 'rss' }), /platform rss unavailable.*RSS needs a feed URL/)
    assert.equal((await h.router.providerStatuses(['rss'])).get('rss')!.state, 'ready')
  } finally {
    dns.lookup = originalLookup
    globalThis.fetch = originalFetch
    h.cleanup()
  }
})

test('a custom platform searches through the same path as a built-in one', async () => {
  const h = harness({ customPlatforms: { forum: { name: 'Forum', url: 'https://forum.test/s?q={query}', item: '.i', title: '.t', link: 'a', cookie: 'a=b' } } })
  try {
    const out = await h.search('dsh', { id: 'forum' })
    assert.equal(out.engine, 'forum')
    assert.match(h.calls.searchResults[0]!.url, /^https:\/\/forum\.test\/s\?q=dsh$/)
    assert.deepEqual(h.calls.searchResults[0]!.opts.cookies, [{ name: 'a', value: 'b', domain: 'forum.test', path: '/' }])
    const row = h.store.listQueries({ kind: 'platform' })[0]!
    assert.equal(row.platform, 'forum')
    assert.equal(row.engine, 'custom-forum')
  } finally { h.cleanup() }
})
