import test from 'node:test'
import assert from 'node:assert/strict'
import dns from 'node:dns/promises'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { parseRss, rssEngine } from '../src/engines.ts'
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

    assert.equal(store.deleteQuery(first), true)
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
