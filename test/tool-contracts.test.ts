import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { registerHooks } from 'node:module'
import { resolveConfig } from '../src/config.ts'
import { Store } from '../src/store.ts'
import { findAction } from '../src/actions/registry.ts'
import { checkOutput } from '../src/actions/schema.ts'
import { callAction, callEnvelope, renderResult } from './call-helper.ts'

// Tool definitions are the unit under test; the Harness registry itself is a
// host peer and is replaced with its identity constructor in this isolated run.
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === '@deepseek-ai/dsh-tools') {
      return { url: 'data:text/javascript,export const defineTool = value => value', shortCircuit: true }
    }
    return nextResolve(specifier, context)
  },
})
const { registerTools } = await import('../src/tools.ts')

function toolHarness(customPlatforms: Record<string, any> = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wsp-tool-contracts-'))
  const config = resolveConfig({
    engines: ['ddg'], parallelEngines: false, searchMaxResults: 8,
    timeoutMs: 5_000, ttlSeconds: 60, memoryCacheEntries: 16,
    rrfConstant: 60, freshnessBoost: 0, authorityBoost: 0,
    freshnessDays: 30, authorityDomains: [], enableCliBackends: false,
    opencliEnabled: false, agentReachEnabled: false, registerProvider: false,
    providerId: 'web-search-pro', customPlatforms,
    dbPath: path.join(dir, 'store.db'), playwright: { enabled: true, snapshotDir: path.join(dir, 'shots') },
    allowProxyFakeIp: false, verbose: false,
  })
  const definitions = new Map<string, any>()
  const store = new Store(config.dbPath)
  return { dir, config, definitions, store }
}

test('search.run accepts configured custom platforms and forwards them to the router', async () => {
  const customPlatforms = {
    forum: { name: 'Forum', url: 'https://example.com?q={query}', item: '.item', title: '.title', link: 'a' },
  }
  const h = toolHarness(customPlatforms)
  let routedPlatform = ''
  try {
    registerTools({
      ctx: { tools: { register: (definition: any) => h.definitions.set(definition.name, definition) } } as any,
      config: h.config, dynamic: () => h.config, store: h.store,
      router: { platformSearch: async (platform: string) => { routedPlatform = platform; return { sources: [], engine: 'custom-forum', fromCache: false } } } as any,
      fetch: {} as any, browser: {} as any,
    })
    const result = await callAction(h.definitions, 'search.run', { platform: 'forum', query: 'dsh' })
    assert.equal(routedPlatform, 'forum')
    assert.equal(result.platform, 'forum')
  } finally {
    h.store.close()
    fs.rmSync(h.dir, { recursive: true, force: true })
  }
})

test('read.snapshot forwards screenshot=false and persists no PNG path', async () => {
  const h = toolHarness()
  let snapshotOption: boolean | undefined
  try {
    registerTools({
      ctx: { tools: { register: (definition: any) => h.definitions.set(definition.name, definition) } } as any,
      config: h.config, dynamic: () => h.config, store: h.store,
      router: {} as any, fetch: {} as any,
      browser: { snapshot: async (_url: string, _rules: unknown, opts: { screenshot?: boolean }) => {
        snapshotOption = opts.screenshot
        return { title: 'Fixture', text: 'body', htmlPath: path.join(h.dir, 'page.html') }
      } } as any,
    })
    const result = await callAction(h.definitions, 'read.snapshot', { url: 'https://example.com', screenshot: false })
    assert.equal(snapshotOption, false)
    assert.equal(result.screenshotPath, undefined)
    const query = h.store.listQueries({ kind: 'snapshot', limit: 1 })[0]!
    assert.equal(h.store.pageForQuery(query.id)?.screenshotPath ?? undefined, undefined)
  } finally {
    h.store.close()
    fs.rmSync(h.dir, { recursive: true, force: true })
  }
})

test('history.replay omits a SQLite NULL page status', async () => {
  const h = toolHarness()
  try {
    registerTools({
      ctx: { tools: { register: (definition: any) => h.definitions.set(definition.name, definition) } } as any,
      config: h.config, dynamic: () => h.config, store: h.store,
      router: {} as any, fetch: {} as any, browser: {} as any,
    })
    const queryId = h.store.recordQuery({ kind: 'snapshot', query: 'page', url: 'https://example.com/page', engine: 'playwright', status: 'ok' })
    h.store.savePage({ queryId, url: 'https://example.com/page', text: 'snapshot', source: 'playwright' })

    const result = await callAction(h.definitions, 'history.replay', { id: queryId })
    assert.equal(result.replayedPage.status, undefined)
    assert.equal(Object.hasOwn(result.replayedPage, 'status'), false)
  } finally {
    h.store.close()
    fs.rmSync(h.dir, { recursive: true, force: true })
  }
})

test('history.list accepts kind=all as an unfiltered query', async () => {
  const h = toolHarness()
  try {
    registerTools({
      ctx: { tools: { register: (definition: any) => h.definitions.set(definition.name, definition) } } as any,
      config: h.config, dynamic: () => h.config, store: h.store,
      router: {} as any, fetch: {} as any, browser: {} as any,
    })
    h.store.recordQuery({ kind: 'search', query: 'all fixture', engine: 'ddg', status: 'ok' })
    h.store.recordQuery({ kind: 'fetch', query: 'page fixture', engine: 'http', status: 'ok' })

    const result = await callAction(h.definitions, 'history.list', { kind: 'all' })
    assert.deepEqual(new Set(result.records.map((record: any) => record.kind)), new Set(['search', 'fetch']))
  } finally {
    h.store.close()
    fs.rmSync(h.dir, { recursive: true, force: true })
  }
})

test('search.run platform=rss accepts a feed URL in query', async () => {
  const h = toolHarness()
  let routedQuery: string | undefined
  let routedUrl: string | undefined
  try {
    registerTools({
      ctx: { tools: { register: (definition: any) => h.definitions.set(definition.name, definition) } } as any,
      config: h.config, dynamic: () => h.config, store: h.store,
      router: { platformSearch: async (_platform: string, query: string, url: string | undefined) => {
        routedQuery = query
        routedUrl = url
        return { sources: [], engine: 'rss', fromCache: false }
      } } as any,
      fetch: {} as any, browser: {} as any,
    })

    await callAction(h.definitions, 'search.run', { platform: 'rss', query: 'https://example.com/feed.xml' })
    assert.equal(routedUrl, 'https://example.com/feed.xml')
    assert.equal(routedQuery, '')
  } finally {
    h.store.close()
    fs.rmSync(h.dir, { recursive: true, force: true })
  }
})

test('sources.deps lists the CLI dependencies in its closed output schema', async () => {
  const h = toolHarness()
  try {
    registerTools({
      ctx: { tools: { register: (definition: any) => h.definitions.set(definition.name, definition) } } as any,
      config: h.config, dynamic: () => h.config, store: h.store,
      router: {} as any, fetch: {} as any, browser: {} as any,
    })
    const definition = findAction('sources.deps')!
    assert.deepEqual(Object.keys(definition.params), [], 'check takes no arguments')
    const result = await callAction(h.definitions, 'sources.deps')
    assert.deepEqual(checkOutput(definition.output, result), [])
    assert.equal(Array.isArray(result.backends), true)
    const backendProperties = definition.output.properties.backends!.items!.properties!
    for (const backend of result.backends) {
      assert.deepEqual(
        Object.keys(backend).filter(key => !(key in backendProperties)),
        [],
        `sources.deps output schema is missing fields returned by ${backend.id}`,
      )
    }
    assert.deepEqual(
      ['source', 'requiredVersion', 'version', 'diagnostic'].filter(key => !(key in backendProperties)),
      [],
    )

    const text = renderResult('sources.deps', {
      backends: [{
        id: 'bili', label: 'bili-cli', usedBy: 'bilibili 后端', available: false,
        source: 'public-clis/bilibili-cli', requiredVersion: '>=0.6.2', version: '0.5.0',
        diagnostic: 'bili 0.5.0 is older than required 0.6.2',
        installs: [{ installer: 'uv', command: 'uv tool install bili' }],
      }],
    })
    assert.match(text, /版本 0\.5\.0/)
    assert.match(text, /要求 >=0\.6\.2/)
    assert.match(text, /来源 public-clis\/bilibili-cli/)
    assert.match(text, /诊断: bili 0\.5\.0 is older/)
  } finally {
    h.store.close()
    fs.rmSync(h.dir, { recursive: true, force: true })
  }
})

test('rules.export writes an importable versioned JSON rule pack', async () => {
  const h = toolHarness()
  try {
    registerTools({
      ctx: { tools: { register: (definition: any) => h.definitions.set(definition.name, definition) } } as any,
      config: h.config, dynamic: () => h.config, store: h.store,
      router: {} as any, fetch: {} as any, browser: {} as any,
    })
    h.store.upsertRule('example.com', 'main', '.ad')

    const result = await callAction(h.definitions, 'rules.export')
    assert.equal(typeof result.exportPath, 'string')
    const pack = JSON.parse(fs.readFileSync(result.exportPath, 'utf8'))
    assert.equal(pack.version, 1)
    assert.deepEqual(pack.rules, [{ hostname: 'example.com', content: 'main', remove: '.ad' }])
  } finally {
    h.store.close()
    fs.rmSync(h.dir, { recursive: true, force: true })
  }
})

test('read.fetch reports truncation through its documented optional fields and hints at offset', async () => {
  const h = toolHarness()
  try {
    const seen: any[] = []
    registerTools({
      ctx: { tools: { register: (definition: any) => h.definitions.set(definition.name, definition) } } as any,
      config: h.config, dynamic: () => h.config, store: h.store,
      router: {} as any, browser: {} as any,
      fetch: { fetchPage: async (_url: string, opts: unknown) => { seen.push(opts); return { url: 'https://example.com', text: 'body', source: 'http', fromCache: false, truncated: true, nextOffset: 4, totalChars: 9, attempts: [{ source: 'http', class: 'content' }] } } } as any,
    })
    const out = await callAction(h.definitions, 'read.fetch', { url: 'https://example.com', offset: 2 })
    assert.equal(out.truncated, true)
    assert.equal(out.nextOffset, 4)
    assert.equal(out.totalChars, 9)
    assert.equal(out.text, 'body')
    // The schema is closed: every output key is a declared property.
    assert.deepEqual(out.attempts, [{ source: 'http', class: 'content' }])
    assert.deepEqual(checkOutput(findAction('read.fetch')!.output, out), [])
    // Default output cap is the configured fetchDefaultChars (20k), offset is forwarded.
    assert.equal(seen[0].maxChars, 20_000)
    assert.equal(seen[0].offset, 2)
    assert.match(renderResult('read.fetch', out), /more: call read\.fetch with offset=4/)
    await assert.rejects(callAction(h.definitions, 'read.fetch', { url: 'https://example.com', offset: -1 }), /offset must be/)
    assert.equal((await callEnvelope(h.definitions, 'read.fetch', { url: 'https://example.com', offset: -1 })).error.code, 'INVALID_ARGS')
  } finally {
    h.store.close()
    fs.rmSync(h.dir, { recursive: true, force: true })
  }
})
