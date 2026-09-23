import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createSearchCacheKey, createPlatformCacheKey } from '../src/cache-key.ts'
import { assertSafePublicUrl, readBoundedBody, stripSensitiveHeadersForRedirect } from '../src/safe-http.ts'
import { ExaClient } from '../src/exa-client.ts'
import { exaEngine, jinaSearchEngine, parseMcporterExaSearch, youtubeEngine } from '../src/engines.ts'
import { BackendRegistry } from '../src/backend-registry.ts'
import { Store } from '../src/store.ts'
import { SearchRouter } from '../src/router.ts'
import { runCli } from '../src/util.ts'

test('cache fingerprints cover mode, engine order, and Exa options while allowing smaller-count reuse', () => {
  const base = { query: '  New   Query ', engines: ['exa', 'ddg'], count: 5, multi: true }
  const a = createSearchCacheKey(base)
  assert.equal(a, createSearchCacheKey({ ...base }))
  assert.equal(a, createSearchCacheKey({ ...base, count: 10 }))
  assert.notEqual(a, createSearchCacheKey({ ...base, engines: ['ddg', 'exa'] }))
  assert.notEqual(a, createSearchCacheKey({ ...base, exa: { type: 'deep' } }))
  assert.equal(createPlatformCacheKey({ platform: 'rss', query: 'x', count: 5 }), createPlatformCacheKey({ platform: 'rss', query: 'x', count: 8 }))
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

test('platform cache replay preserves publishedAt metadata', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-web-platform-cache-'))
  const store = new Store(path.join(dir, 'store.db'))
  const config = {
    memoryCacheEntries: 8, ttlSeconds: 60, engines: ['arxiv'], rrfConstant: 60,
    freshnessBoost: 0, freshnessDays: 30, authorityBoost: 0, authorityDomains: [],
    exaApiKeyEnv: 'EXA_API_KEY', jinaApiKeyEnv: 'JINA_API_KEY', githubTokenEnv: 'GITHUB_TOKEN',
    enableCliBackends: false, opencliEnabled: false, agentReachEnabled: false, allowProxyFakeIp: false,
  }
  const key = createPlatformCacheKey({ platform: 'arxiv', query: 'deepseek', count: 4 })
  try {
    const id = store.recordQuery({ kind: 'platform', query: 'deepseek', platform: 'arxiv', engine: 'arxiv', cacheKey: key, status: 'ok', detail: JSON.stringify({ requestedCount: 4 }) })
    store.recordResults(id, [{ url: 'https://arxiv.org/abs/2402.03300', title: 'DeepSeek', publishedAt: '2024-02-18T17:10:07Z' }], 'arxiv')
    const router = new SearchRouter({ get: () => undefined } as never, config as never, store)
    const result = await router.platformSearch('arxiv', 'deepseek', undefined, 3, { fresh: false })
    assert.equal(result.fromCache, true)
    assert.equal(result.sources[0]?.publishedAt, '2024-02-18T17:10:07Z')
  } finally {
    store.close()
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('a single requested engine stays single even when multi mode is enabled globally', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-web-single-engine-'))
  const store = new Store(path.join(dir, 'store.db'))
  const web = { search: async () => ({ sources: [{ url: 'https://example.com/a', title: 'A' }] }) }
  const config = {
    memoryCacheEntries: 8, ttlSeconds: 60, engines: ['seam'], rrfConstant: 60,
    freshnessBoost: 0, freshnessDays: 30, authorityBoost: 0, authorityDomains: [],
    exaApiKeyEnv: 'EXA_API_KEY', jinaApiKeyEnv: 'JINA_API_KEY', githubTokenEnv: 'GITHUB_TOKEN',
    enableCliBackends: false, opencliEnabled: false, agentReachEnabled: false, allowProxyFakeIp: false,
  }
  try {
    const router = new SearchRouter({ get: (name: string) => name === 'web' ? web : undefined } as never, config as never, store)
    const result = await router.search({ query: 'one engine', engines: ['seam'], count: 3, fresh: true, multi: true, signal: undefined })
    assert.equal(result.engine, 'seam')
    assert.deepEqual(result.enginesTried, ['seam'])
  } finally {
    store.close()
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('a smaller result count reuses a larger cached search without another backend call', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-web-count-cache-'))
  const store = new Store(path.join(dir, 'store.db'))
  let calls = 0
  const web = { search: async ({ maxResults }: { maxResults: number }) => {
    calls++
    return { sources: Array.from({ length: maxResults }, (_, index) => ({ url: `https://example.com/${index}`, title: `R${index}` })) }
  } }
  const config = {
    memoryCacheEntries: 8, ttlSeconds: 60, engines: ['seam'], rrfConstant: 60,
    freshnessBoost: 0, freshnessDays: 30, authorityBoost: 0, authorityDomains: [],
    exaApiKeyEnv: 'EXA_API_KEY', jinaApiKeyEnv: 'JINA_API_KEY', githubTokenEnv: 'GITHUB_TOKEN',
    enableCliBackends: false, opencliEnabled: false, agentReachEnabled: false, allowProxyFakeIp: false,
  }
  try {
    const router = new SearchRouter({ get: (name: string) => name === 'web' ? web : undefined } as never, config as never, store)
    const larger = await router.search({ query: 'same query', count: 4, fresh: false, multi: false, signal: undefined })
    const smaller = await router.search({ query: 'same query', count: 3, fresh: false, multi: false, signal: undefined })
    assert.equal(larger.fromCache, false)
    assert.equal(smaller.fromCache, true)
    assert.equal(smaller.sources.length, 3)
    assert.equal(calls, 1)
  } finally {
    store.close()
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('external CLI argv is passed verbatim without cmd.exe metacharacter execution', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wsp-cli-argv-'))
  const script = path.join(dir, 'argv.mjs')
  fs.writeFileSync(script, 'process.stdout.write(JSON.stringify(process.argv.slice(2)))', 'utf8')
  const args = ['hello world', 'a" & echo CMD_INJECTION_PROBE & "b', '100% literal']
  try {
    const result = await runCli(process.execPath, [script, ...args], { signal: undefined, timeoutMs: 5_000 })
    assert.equal(result.code, 0)
    assert.deepEqual(JSON.parse(result.stdout), args)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('external CLI output can be decoded as GB18030 after byte collection', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wsp-cli-gb18030-'))
  const script = path.join(dir, 'gb18030.mjs')
  // GBK/GB18030 bytes for 中文, split across writes to exercise chunk boundaries.
  fs.writeFileSync(script, 'process.stdout.write(Buffer.from([0xd6, 0xd0])); process.stdout.write(Buffer.from([0xce, 0xc4]))', 'utf8')
  try {
    const result = await runCli(process.execPath, [script], { signal: undefined, timeoutMs: 5_000, outputEncoding: 'gb18030' })
    assert.equal(result.code, 0)
    assert.equal(result.stdout, '中文')
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('YouTube CLI requests UTF-8 on Windows and preserves Chinese titles', async () => {
  const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform')!
  let requestedEncoding: string | undefined
  try {
    Object.defineProperty(process, 'platform', { ...originalPlatform, value: 'win32' })
    const engine = youtubeEngine({ enableCli: true } as never, async (bin, _args, opts) => {
      assert.equal(bin, 'yt-dlp')
      requestedEncoding = opts.outputEncoding
      return { code: 0, stdout: 'abc123\t中文标题\t中文频道\t100\t01:00\n', stderr: '', timedOut: false }
    })
    const result = await engine.search('中文', 1)
    assert.equal(requestedEncoding, 'utf-8')
    assert.equal(result.sources[0]?.title, '中文标题')
  } finally {
    Object.defineProperty(process, 'platform', originalPlatform)
  }
})

test('Exa MCP fallback rejects advanced filters instead of silently dropping them', async () => {
  const engine = exaEngine({ enableCli: true } as any)
  await assert.rejects(
    () => engine.search('dsh', 3, AbortSignal.abort(), { exa: { includeDomains: ['github.com'], type: 'auto' } }),
    /advanced.*not supported|cannot honor/i,
  )
})

test('Jina search diagnostics require a configured key', () => {
  const previous = process.env.JINA_API_KEY
  delete process.env.JINA_API_KEY
  try {
    assert.equal(jinaSearchEngine({} as any).available(), false)
    assert.equal(jinaSearchEngine({ jinaApiKey: 'configured' } as any).available(), true)
  } finally {
    if (previous === undefined) delete process.env.JINA_API_KEY
    else process.env.JINA_API_KEY = previous
  }
})
