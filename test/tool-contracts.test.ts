import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { registerHooks } from 'node:module'
import { resolveConfig } from '../src/config.ts'
import { Store } from '../src/store.ts'

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

test('tool layer accepts configured custom platforms and forwards them to the router', async () => {
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
    const result = await h.definitions.get('web_platform_search').execute({ platform: 'forum', query: 'dsh' }, { signal: undefined })
    assert.equal(routedPlatform, 'forum')
    assert.equal(result.platform, 'forum')
  } finally {
    h.store.close()
    fs.rmSync(h.dir, { recursive: true, force: true })
  }
})

test('web_snapshot forwards screenshot=false and persists no PNG path', async () => {
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
    const result = await h.definitions.get('web_snapshot').execute({ url: 'https://example.com', screenshot: false }, { signal: undefined })
    assert.equal(snapshotOption, false)
    assert.equal(result.screenshotPath, undefined)
    const query = h.store.listQueries({ kind: 'snapshot', limit: 1 })[0]!
    assert.equal(h.store.pageForQuery(query.id)?.screenshotPath ?? undefined, undefined)
  } finally {
    h.store.close()
    fs.rmSync(h.dir, { recursive: true, force: true })
  }
})

test('web_history replay omits a SQLite NULL page status', async () => {
  const h = toolHarness()
  try {
    registerTools({
      ctx: { tools: { register: (definition: any) => h.definitions.set(definition.name, definition) } } as any,
      config: h.config, dynamic: () => h.config, store: h.store,
      router: {} as any, fetch: {} as any, browser: {} as any,
    })
    const queryId = h.store.recordQuery({ kind: 'snapshot', query: 'page', url: 'https://example.com/page', engine: 'playwright', status: 'ok' })
    h.store.savePage({ queryId, url: 'https://example.com/page', text: 'snapshot', source: 'playwright' })

    const result = await h.definitions.get('web_history').execute({ replay: queryId }, { signal: undefined })
    assert.equal(result.replayedPage.status, undefined)
    assert.equal(Object.hasOwn(result.replayedPage, 'status'), false)
  } finally {
    h.store.close()
    fs.rmSync(h.dir, { recursive: true, force: true })
  }
})
