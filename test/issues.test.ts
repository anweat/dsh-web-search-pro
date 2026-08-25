import test from 'node:test'
import assert from 'node:assert/strict'
import dns from 'node:dns/promises'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { parseRss, rssEngine } from '../src/engines.ts'
import { FetchService } from '../src/fetch.ts'
import { replayHistory } from '../src/history.ts'
import { assertResolvedPublicUrl, assertSafePublicUrl } from '../src/safe-http.ts'
import { Store } from '../src/store.ts'

test('RSS platform search filters all feed items by the requested query before applying count', async () => {
  const originalLookup = dns.lookup
  const originalFetch = globalThis.fetch
  dns.lookup = (async () => [{ address: '93.184.216.34', family: 4 }]) as typeof dns.lookup
  globalThis.fetch = (async () => new Response(`
    <rss><channel>
      <item><title>First unrelated item</title><link>https://example.com/1</link><description>none</description></item>
      <item><title>Second unrelated item</title><link>https://example.com/2</link><description>none</description></item>
      <item><title>Needle appears later</title><link>https://example.com/3</link><description>match</description></item>
    </channel></rss>
  `, { status: 200 })) as typeof fetch
  try {
    const result = await rssEngine('https://feed.example/rss').search('needle', 1)
    assert.deepEqual(result.sources.map(source => source.title), ['Needle appears later'])
  } finally {
    dns.lookup = originalLookup
    globalThis.fetch = originalFetch
  }
})

test('RSS parser preserves CDATA titles and strips markup inside CDATA descriptions', () => {
  const sources = parseRss(`
    <rss><channel><item>
      <title><![CDATA[AI &amp; Search]]></title>
      <link>https://example.com/ai</link>
      <description><![CDATA[<p>Useful <strong>community</strong> feedback.</p>]]></description>
    </item></channel></rss>
  `)
  assert.equal(sources[0]?.title, 'AI & Search')
  assert.equal(sources[0]?.snippet, 'Useful community feedback.')
})

test('fetch and snapshot history keep exact page content per query id', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wsp-page-history-'))
  const store = new Store(path.join(dir, 'store.db'))
  try {
    const first = store.recordQuery({ kind: 'fetch', url: 'https://example.com/page', query: 'First', engine: 'http', status: 'ok' })
    store.savePage({ queryId: first, url: 'https://example.com/page', title: 'First', text: 'first version', source: 'http' })
    const second = store.recordQuery({ kind: 'snapshot', url: 'https://example.com/page', query: 'Second', engine: 'playwright', status: 'ok' })
    store.savePage({ queryId: second, url: 'https://example.com/page', title: 'Second', text: 'second version', source: 'playwright' })

    assert.equal(store.pageForQuery(first)?.text, 'first version')
    assert.equal(store.pageForQuery(second)?.text, 'second version')
  } finally {
    store.close()
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('history replay returns sources for searches and exact pages for fetches', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wsp-history-replay-'))
  const store = new Store(path.join(dir, 'store.db'))
  try {
    const search = store.recordQuery({ kind: 'search', query: 'q', engine: 'test', status: 'ok' })
    store.recordResults(search, [{ url: 'https://example.com/a', title: 'A' }], 'test')
    const fetch = store.recordQuery({ kind: 'fetch', query: 'page', url: 'https://example.com/page', engine: 'http', status: 'ok' })
    store.savePage({ queryId: fetch, url: 'https://example.com/page', title: 'Page', text: 'full text', source: 'http' })

    assert.equal(replayHistory(store, search).sources?.[0]?.title, 'A')
    assert.equal(replayHistory(store, fetch).page?.text, 'full text')
  } finally {
    store.close()
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('RSS parser decodes escaped HTML before stripping snippet tags', () => {
  const sources = parseRss(`
    <rss><channel><item>
      <title>Release</title>
      <link>https://example.com/release</link>
      <description>&lt;p&gt;&lt;a href=&quot;#cn&quot;&gt;中文&lt;/a&gt;&lt;/p&gt; &lt;h3&gt;体验优化&lt;/h3&gt;</description>
    </item></channel></rss>
  `)
  assert.equal(sources[0]?.snippet, '中文 体验优化')
})

test('history replay preserves a successful search with zero results', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wsp-empty-history-'))
  const store = new Store(path.join(dir, 'store.db'))
  try {
    const search = store.recordQuery({ kind: 'search', query: 'no hits', engine: 'test', status: 'ok' })
    assert.deepEqual(replayHistory(store, search).sources, [])
  } finally {
    store.close()
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('legacy page cache schema migrates without losing cached content', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wsp-page-migration-'))
  const dbPath = path.join(dir, 'store.db')
  const legacy = new DatabaseSync(dbPath)
  legacy.exec(`
    CREATE TABLE pages (
      id TEXT PRIMARY KEY, url TEXT UNIQUE NOT NULL, title TEXT, text TEXT,
      html_path TEXT, screenshot_path TEXT, status INTEGER, fetched_at TEXT NOT NULL, source TEXT
    );
    INSERT INTO pages VALUES ('legacy-page', 'https://example.com/legacy', 'Legacy', 'preserved', NULL, NULL, 200, '2026-08-23T00:00:00.000Z', 'http');
  `)
  legacy.close()
  const store = new Store(dbPath)
  try {
    assert.equal(store.getPage('https://example.com/legacy', 315_360_000)?.text, 'preserved')
    const query = store.recordQuery({ kind: 'fetch', query: 'new', url: 'https://example.com/legacy', engine: 'http', status: 'ok' })
    store.savePage({ queryId: query, url: 'https://example.com/legacy', text: 'new version', source: 'http' })
    assert.equal(store.pageForQuery(query)?.text, 'new version')
  } finally {
    store.close()
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('deleting one history record removes its linked page without removing newer snapshots', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wsp-page-delete-'))
  const store = new Store(path.join(dir, 'store.db'))
  try {
    const first = store.recordQuery({ kind: 'fetch', url: 'https://example.com/page', query: 'First', engine: 'http', status: 'ok' })
    store.savePage({ queryId: first, url: 'https://example.com/page', text: 'first', source: 'http' })
    const second = store.recordQuery({ kind: 'fetch', url: 'https://example.com/page', query: 'Second', engine: 'http', status: 'ok' })
    store.savePage({ queryId: second, url: 'https://example.com/page', text: 'second', source: 'http' })

    assert.deepEqual(store.deleteQuery(first), { queries: 1, results: 0, pages: 1 })
    assert.equal(store.pageForQuery(first), undefined)
    assert.equal(store.pageForQuery(second)?.text, 'second')
    assert.equal(store.getPage('https://example.com/page', 60)?.text, 'second')
  } finally {
    store.close()
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('engine-scoped cache clearing reports exact query, result, and page counts', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wsp-cache-counts-'))
  const store = new Store(path.join(dir, 'store.db'))
  try {
    const search = store.recordQuery({ kind: 'search', query: 'q', engine: 'test', status: 'ok' })
    store.recordResults(search, [{ url: 'https://example.com/a' }, { url: 'https://example.com/b' }], 'test')
    const fetch = store.recordQuery({ kind: 'fetch', query: 'page', url: 'https://example.com/page', engine: 'test', status: 'ok' })
    store.savePage({ queryId: fetch, url: 'https://example.com/page', text: 'page', source: 'test' })

    assert.deepEqual(store.clearCache({ engine: 'test' }), { queries: 2, results: 2, pages: 1 })
  } finally {
    store.close()
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('engine-and-age scoped cache clearing preserves unattributed legacy pages', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wsp-cache-legacy-scope-'))
  const dbPath = path.join(dir, 'store.db')
  const legacy = new DatabaseSync(dbPath)
  legacy.exec(`
    CREATE TABLE pages (
      id TEXT PRIMARY KEY, url TEXT UNIQUE NOT NULL, title TEXT, text TEXT,
      html_path TEXT, screenshot_path TEXT, status INTEGER, fetched_at TEXT NOT NULL, source TEXT
    );
    INSERT INTO pages VALUES ('legacy-page', 'https://example.com/legacy', 'Legacy', 'preserved', NULL, NULL, 200, '2020-01-01T00:00:00.000Z', 'http');
  `)
  legacy.close()
  const store = new Store(dbPath)
  try {
    store.recordQuery({ kind: 'search', query: 'q', engine: 'test', status: 'ok' })
    // clearCache uses a strict `ts < cutoff` predicate; cross a millisecond so
    // the freshly inserted fixture is unambiguously older than the cutoff.
    await new Promise(resolve => setTimeout(resolve, 5))
    const removed = store.clearCache({ engine: 'test', olderThanDays: 0 })
    assert.equal(removed.queries, 1)
    assert.equal(removed.pages, 0)
    assert.equal(store.getPage('https://example.com/legacy', 315_360_000)?.text, 'preserved')
  } finally {
    store.close()
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('fetch memory cache respects maxChars and does not cross persist semantics', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wsp-fetch-memory-'))
  const store = new Store(path.join(dir, 'store.db'))
  let renders = 0
  const browser = {
    async render(_url: string, _rules: unknown, opts: { maxChars?: number }) {
      renders++
      const maxChars = opts.maxChars ?? 200_000
      return {
        title: 'Long page',
        text: 'x'.repeat(maxChars) + `\n\n(Content truncated at ${maxChars} characters.)`,
        html: '<main>long page</main>',
      }
    },
  }
  const config = { ttlSeconds: 60, playwright: { enabled: true } }
  const fetch = new FetchService(store, config as never, browser as never)
  try {
    await fetch.fetchPage('https://example.com/page', {
      mode: 'playwright', signal: undefined, maxChars: 5_000, fresh: false, persist: false,
    })
    const smaller = await fetch.fetchPage('https://example.com/page', {
      mode: 'playwright', signal: undefined, maxChars: 1_000, fresh: false, persist: true,
    })
    assert.match(smaller.text, /Content truncated at 1000 characters/)
    assert.equal(store.listQueries({ kind: 'fetch' }).length, 1)
    assert.equal(renders, 2)
  } finally {
    store.close()
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('fetch cache omits a SQLite NULL status instead of returning statusCode null', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wsp-fetch-null-status-'))
  const store = new Store(path.join(dir, 'store.db'))
  const queryId = store.recordQuery({ kind: 'fetch', query: 'page', url: 'https://example.com/page', engine: 'playwright', status: 'ok' })
  store.savePage({ queryId, url: 'https://example.com/page', text: 'cached page', source: 'playwright' })
  const fetch = new FetchService(store, { ttlSeconds: 60 } as never, {} as never)
  try {
    const result = await fetch.fetchPage('https://example.com/page', {
      mode: 'playwright', signal: undefined, maxChars: 5_000, fresh: false, persist: true,
    })
    assert.equal(result.fromCache, true)
    assert.equal(result.statusCode, undefined)
    assert.equal(Object.hasOwn(result, 'statusCode'), false)
  } finally {
    store.close()
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('proxy fake-IP DNS answers require an explicit opt-in and never permit literal private targets', async () => {
  const fakeLookup = async () => [
    { address: '198.18.0.42', family: 4 },
    { address: 'fdfe:dcba:9876::42', family: 6 },
  ]
  await assert.rejects(
    () => assertResolvedPublicUrl('https://public.example/path', { lookup: fakeLookup }),
    /public addresses/,
  )
  await assert.doesNotReject(
    () => assertResolvedPublicUrl('https://public.example/path', { allowProxyFakeIp: true, lookup: fakeLookup }),
  )
  await assert.rejects(
    () => assertResolvedPublicUrl('https://public.example/path', {
      allowProxyFakeIp: true,
      lookup: async () => [{ address: '127.0.0.1', family: 4 }],
    }),
    /public addresses/,
  )
  await assert.rejects(
    () => assertResolvedPublicUrl('https://public.example/path', {
      allowProxyFakeIp: true,
      lookup: async () => [{ address: 'fdfe:dcba:9876:1::42', family: 6 }],
    }),
    /public addresses/,
  )
  assert.throws(() => assertSafePublicUrl('http://198.18.0.42/private'), /private or local/)
})
