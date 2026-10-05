import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { EngineError } from '../src/engines.ts'
import { SearchRouter } from '../src/router.ts'
import { Store } from '../src/store.ts'

type Entries = Map<string, { id: string; probe: () => unknown; run: (i: any) => Promise<unknown>; assess?: (v: unknown) => unknown }>

function harness(overrides: Record<string, unknown> = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-web-pipeline-router-'))
  const store = new Store(path.join(dir, 'store.db'), { onDiagnostic: () => {} })
  const config = {
    memoryCacheEntries: 8, ttlSeconds: 60, engines: ['e1', 'e2', 'e3'], rrfConstant: 60,
    freshnessBoost: 0, freshnessDays: 30, authorityBoost: 0, authorityDomains: [],
    searchMaxResults: 5, parallelEngines: true,
    exaApiKeyEnv: 'EXA_API_KEY', jinaApiKeyEnv: 'JINA_API_KEY', githubTokenEnv: 'GITHUB_TOKEN',
    enableCliBackends: false, opencliEnabled: false, agentReachEnabled: false,
    playwright: { enabled: false },
    ...overrides,
  }
  const router = new SearchRouter({ get: () => undefined } as never, config as never, store)
  const entries = (router as any).backends.entries as Entries
  const engine = (id: string, run: (i: any) => Promise<unknown>) => { entries.set(id, { id, probe: async () => ({ available: true }), run }) }
  const cleanup = () => { store.close(); fs.rmSync(dir, { recursive: true, force: true }) }
  return { store, config, router, entries, engine, cleanup }
}

const empty = () => { throw new EngineError('no results', 'ENGINE_EMPTY', true) }

test('all-empty: multi returns zero sources with an explanatory note and caches nothing', async () => {
  const h = harness()
  let calls = 0
  for (const id of ['e1', 'e2']) h.engine(id, async () => { calls++; return empty() })
  try {
    const req = { query: 'nothing at all', engines: ['e1', 'e2'], count: 5, fresh: false, multi: true, signal: undefined }
    const result = await h.router.search(req)
    assert.deepEqual(result.sources, [])
    assert.equal(result.fromCache, false)
    assert.deepEqual(result.enginesTried, ['e1', 'e2'])
    assert.match(result.fallbackNote!, /all engines returned no results/)
    assert.match(result.fallbackNote!, /e1, e2/)
    assert.equal(h.store.listQueries({ kind: 'search' }).length, 0, 'empty answers are not persisted')
    await h.router.search(req)
    assert.equal(calls, 4, 'and not served from the memory cache either')
    const diag = await (h.router as any).backends.diagnosticsAsync()
    assert.deepEqual(diag.filter((d: { id: string }) => ['e1', 'e2'].includes(d.id)).map((d: { state: string }) => d.state), ['ready', 'ready'])
  } finally { h.cleanup() }
})

test('all-empty: single-mode fallback chain ending in empty also returns zero sources', async () => {
  const h = harness({ engines: ['e1', 'e2'], parallelEngines: false })
  h.engine('e1', async () => empty())
  h.engine('e2', async () => empty())
  try {
    const result = await h.router.search({ query: 'still nothing', engines: ['e1', 'e2'], count: 5, fresh: true, multi: false, signal: undefined })
    assert.deepEqual(result.sources, [])
    assert.equal(result.engine, 'none')
    assert.deepEqual(result.enginesTried, ['e1', 'e2'])
    assert.match(result.fallbackNote!, /all engines returned no results/)
    const provider = await h.router.searchAsProvider({ query: 'still nothing again' } as never)
    assert.deepEqual(provider.sources, [])
  } finally { h.cleanup() }
})

test('mixed empty and failed engines keep throwing and mention both', async () => {
  const setup = () => {
    const h = harness()
    h.engine('e1', async () => empty())
    h.engine('e2', async () => { throw new EngineError('HTTP 503', 'ENGINE_ERROR', true) })
    return h
  }
  const single = setup()
  try {
    await assert.rejects(
      single.router.search({ query: 'mixed single', engines: ['e1', 'e2'], count: 5, fresh: true, multi: false, signal: undefined }),
      /no backend succeeded: e1: no results; e2: HTTP 503/,
    )
  } finally { single.cleanup() }
  const h = setup()
  try {
    await assert.rejects(
      h.router.search({ query: 'mixed multi', engines: ['e1', 'e2'], count: 5, fresh: true, multi: true, signal: undefined }),
      /all engines failed: e1: .*no results.*; e2: .*HTTP 503/,
    )
  } finally { h.cleanup() }
})
