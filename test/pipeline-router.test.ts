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

test('multi: merged sources keep provenance in results.extra, and the cache-hit path ignores it', async () => {
  const h = harness()
  h.engine('e1', async () => ({ sources: [{ url: 'https://ex.test/x?utm_source=a', title: 'X', snippet: 'from e1' }, { url: 'https://ex.test/y', title: 'Y', snippet: 'only e1' }] }))
  h.engine('e2', async () => ({ sources: [{ url: 'https://ex.test/x#frag', title: 'X longer title', snippet: 'a different snippet from e2' }] }))
  h.engine('e3', async () => { throw new EngineError('HTTP 503', 'ENGINE_ERROR', true) })
  try {
    const req = { query: 'provenance', count: 5, fresh: false, multi: true, signal: undefined }
    const live = await h.router.search(req)
    assert.equal(live.engine, 'multi(e1+e2+e3)')
    assert.deepEqual(live.sources.map(s => s.url), ['https://ex.test/x?utm_source=a', 'https://ex.test/y'])
    assert.equal(live.sources[0]!.title, 'X longer title')
    assert.equal(live.sources[0]!.snippet, 'from e1 … a different snippet from e2')
    assert.equal(live.availableCount, 2)

    const query = h.store.listQueries({ kind: 'search' })[0]!
    const rows = h.store.resultsForQuery(query.id)
    assert.equal(rows.length, 2)
    const extra = JSON.parse(rows[0]!.extra!) as { contributions: { providerId: string; rank: number; query: string }[]; score: number }
    assert.deepEqual(extra.contributions, [{ providerId: 'e1', rank: 1, query: 'provenance' }, { providerId: 'e2', rank: 1, query: 'provenance' }])
    assert.ok(extra.score > 0)
    assert.deepEqual(JSON.parse(rows[1]!.extra!).contributions, [{ providerId: 'e1', rank: 2, query: 'provenance' }])

    // A fresh router on the same store replays from SQLite: same sources, no provenance leaking into the output shape.
    const replay = await new SearchRouter({ get: () => undefined } as never, h.config as never, h.store).search(req)
    assert.equal(replay.fromCache, true)
    assert.deepEqual(replay.sources, live.sources)
    assert.ok(replay.sources.every(s => !('extra' in s)))
  } finally { h.cleanup() }
})

test('multi: authority bonus does not reorder a clear rank difference (router level)', async () => {
  const h = harness({ authorityBoost: 1, freshnessBoost: 1 })
  const ten = Array.from({ length: 10 }, (_, i) => ({ url: 'https://plain.test/' + i, title: 'P' + i, snippet: 's' }))
  ten[9] = { url: 'https://github.com/o/r', title: 'repo', snippet: 's' }
  h.engine('e1', async () => ({ sources: ten }))
  h.engine('e2', async () => { throw new EngineError('no results', 'ENGINE_EMPTY', true) })
  try {
    const result = await h.router.search({ query: 'authority', engines: ['e1', 'e2'], count: 10, fresh: true, multi: true, signal: undefined })
    const order = result.sources.map(s => s.url)
    assert.equal(order[0], 'https://plain.test/0')
    // Even at the maximum boosts the rank-10 authority result gains about one position, nowhere near the top.
    assert.ok(order.indexOf('https://github.com/o/r') >= 7, 'github at ' + order.indexOf('https://github.com/o/r'))
  } finally { h.cleanup() }
})
