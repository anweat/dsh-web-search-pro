import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createSearchCacheKey, createPlatformCacheKey } from '../src/cache-key.ts'
import { assertSafePublicUrl, readBoundedBody, stripSensitiveHeadersForRedirect } from '../src/safe-http.ts'
import { ExaClient } from '../src/exa-client.ts'
import { parseMcporterExaSearch } from '../src/engines.ts'
import { BackendRegistry } from '../src/backend-registry.ts'
import { Store } from '../src/store.ts'
import { SearchRouter } from '../src/router.ts'

test('cache fingerprints cover mode, engine order, count, and Exa options', () => {
  const base = { query: '  New   Query ', engines: ['exa', 'ddg'], count: 5, multi: true }
  const a = createSearchCacheKey(base)
  assert.equal(a, createSearchCacheKey({ ...base }))
  assert.notEqual(a, createSearchCacheKey({ ...base, count: 10 }))
  assert.notEqual(a, createSearchCacheKey({ ...base, engines: ['ddg', 'exa'] }))
  assert.notEqual(a, createSearchCacheKey({ ...base, exa: { type: 'deep' } }))
  assert.notEqual(createPlatformCacheKey({ platform: 'rss', query: 'x', count: 5 }), createPlatformCacheKey({ platform: 'rss', query: 'x', count: 8 }))
})

test('SQLite cache lookup uses kind plus an explicit cache fingerprint', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-web-search-pro-'))
  const store = new Store(path.join(dir, 'store.db'))
  try {
    const id = store.recordQuery({ kind: 'platform', query: 'x', platform: 'rss', engine: 'rss', cacheKey: 'platform-key', status: 'ok' })
    assert.equal(store.getCachedQuery('platform', 'platform-key', 60)?.id, id)
    assert.equal(store.getCachedQuery('search', 'platform-key', 60), undefined)
  } finally {
    store.close()
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('router replays a persisted multi-engine result with the complete fingerprint', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-web-router-'))
  const store = new Store(path.join(dir, 'store.db'))
  const config = {
    memoryCacheEntries: 8, ttlSeconds: 60, engines: ['ddg', 'bing'], rrfConstant: 60,
    freshnessBoost: 0, freshnessDays: 30, authorityBoost: 0, authorityDomains: [],
    exaApiKeyEnv: 'EXA_API_KEY', jinaApiKeyEnv: 'JINA_API_KEY', githubTokenEnv: 'GITHUB_TOKEN',
    enableCliBackends: false, opencliEnabled: false, agentReachEnabled: false,
  }
  const key = createSearchCacheKey({ query: 'cached query', engines: config.engines, count: 5, multi: true })
  try {
    const id = store.recordQuery({ kind: 'search', query: 'cached query', engine: 'multi(ddg+bing)', cacheKey: key, status: 'ok', detail: JSON.stringify({ engine: 'multi(ddg+bing)', enginesTried: config.engines }) })
    store.recordResults(id, [{ url: 'https://example.com/a', title: 'Cached' }], 'multi(ddg+bing)')
    const router = new SearchRouter({ get: () => undefined } as never, config as never, store)
    const result = await router.search({ query: 'cached query', count: 5, fresh: false, multi: true, signal: undefined })
    assert.equal(result.fromCache, true)
    assert.equal(result.engine, 'multi(ddg+bing)')
    assert.equal(result.sources[0]?.title, 'Cached')
  } finally {
    store.close()
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('public HTTP validation rejects credentialed and private-network targets', () => {
  for (const url of ['http://127.0.0.1/a', 'http://localhost/a', 'http://10.0.0.2/a', 'http://[::1]/a', 'https://user:pass@example.com/a']) {
    assert.throws(() => assertSafePublicUrl(url), /not allowed|credentials|public/i)
  }
  assert.equal(assertSafePublicUrl('https://example.com/a').hostname, 'example.com')
})

test('cross-origin redirects strip credentials while same-origin redirects preserve them', () => {
  const headers = { Authorization: 'Bearer secret', 'x-api-key': 'secret', cookie: 'a=b', accept: 'text/plain' }
  assert.deepEqual(stripSensitiveHeadersForRedirect(headers, new URL('https://a.test/x'), new URL('https://b.test/y')), { accept: 'text/plain' })
  assert.deepEqual(stripSensitiveHeadersForRedirect(headers, new URL('https://a.test/x'), new URL('https://a.test/y')), headers)
})

test('bounded HTTP reader aborts oversized streamed bodies', async () => {
  const response = new Response(new Uint8Array(32))
  await assert.rejects(() => readBoundedBody(response, 16), /exceeds 16 bytes/)
})

test('Exa client maps advanced search and batch contents without leaking the key', async () => {
  const calls: { url: string; init?: RequestInit }[] = []
  const fakeFetch: typeof fetch = async (input, init) => {
    calls.push({ url: String(input), init })
    const body = String(input).endsWith('/contents')
      ? { results: [{ url: 'https://example.com/a', text: 'full text' }] }
      : { results: [{ url: 'https://example.com/a', title: 'A', highlights: ['hit'] }] }
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
  }
  const client = new ExaClient({ apiKey: 'secret-key', fetch: fakeFetch })
  const result = await client.search({ query: 'q', numResults: 3, type: 'deep', includeDomains: ['example.com'], startPublishedDate: '2026-01-01T00:00:00.000Z' })
  assert.equal(result[0]?.url, 'https://example.com/a')
  const sent = JSON.parse(String(calls[0]?.init?.body))
  assert.equal(sent.type, 'deep')
  assert.deepEqual(sent.includeDomains, ['example.com'])
  const contents = await client.contents(['https://example.com/a'])
  assert.equal(contents[0]?.text, 'full text')
  assert.equal(calls[1]?.url, 'https://api.exa.ai/contents')
  assert.equal(String(client), '[ExaClient]')
})

test('mcporter Exa output is normalized into native search sources', () => {
  const output = [
    'Title: First result',
    'URL: https://example.com/a',
    'Published: 2026-08-21',
    'Author: Example',
    'Highlights:',
    'Useful <b>community</b> feedback.',
    '',
    '---',
    '',
    'Title: Second result',
    'URL: https://example.org/b',
    'Published: N/A',
    'Highlights:',
    'Another result.',
  ].join('\n')
  const sources = parseMcporterExaSearch(output, 2)
  assert.deepEqual(sources, [
    { url: 'https://example.com/a', title: 'First result', snippet: 'Useful community feedback.', publishedAt: '2026-08-21' },
    { url: 'https://example.org/b', title: 'Second result', snippet: 'Another result.' },
  ])
})

test('backend registry honors override, records failure, and cools down retryable backends', async () => {
  let primaryCalls = 0
  const registry = new BackendRegistry<void, string>({ cooldownMs: 60_000 })
  registry.register({ id: 'primary', probe: () => ({ available: true }), run: async () => { primaryCalls++; throw new Error('rate limited') } })
  registry.register({ id: 'fallback', probe: () => ({ available: true }), run: async () => 'ok' })
  assert.equal(await registry.run(undefined, { preferred: ['primary', 'fallback'] }), 'ok')
  assert.equal(await registry.run(undefined, { preferred: ['primary', 'fallback'] }), 'ok')
  assert.equal(primaryCalls, 1)
  assert.equal(await registry.run(undefined, { preferred: ['primary', 'fallback'], override: 'fallback' }), 'ok')
  const diagnostics = registry.diagnostics()
  assert.equal(diagnostics.find(v => v.id === 'primary')?.state, 'cooldown')
  assert.match(diagnostics.find(v => v.id === 'primary')?.lastError ?? '', /rate limited/)
})
