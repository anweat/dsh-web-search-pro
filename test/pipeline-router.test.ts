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

test('providerStatuses reports registry state (ready / unavailable / cooldown) for the requested ids only', async () => {
  const h = harness()
  h.engine('e1', async () => { throw new EngineError('HTTP 503', 'ENGINE_ERROR', true) })
  h.entries.set('e2', { id: 'e2', probe: async () => ({ available: false, reason: 'no key' }), run: async () => { throw new Error('unreachable') } })
  h.engine('e3', async () => ({ sources: [{ url: 'https://ex.test/', snippet: 's' }] }))
  try {
    await h.router.runProvider({ id: 'e1', query: 'q', count: 3, signal: new AbortController().signal })
    const status = await h.router.providerStatuses(['e1', 'e2', 'e3', 'nope'])
    assert.deepEqual([...status.keys()].sort(), ['e1', 'e2', 'e3'])
    assert.equal(status.get('e1')!.state, 'cooldown')
    assert.match(status.get('e1')!.reason!, /HTTP 503/)
    assert.deepEqual(status.get('e2'), { state: 'unavailable', reason: 'no key' })
    assert.deepEqual(status.get('e3'), { state: 'ready' })
  } finally { h.cleanup() }
})

test('runProvider maps registry outcomes to values: ok, empty, skipped, error; cancellation rethrows', async () => {
  const h = harness()
  const signal = new AbortController().signal
  h.engine('ok', async () => ({ sources: [{ url: 'https://ex.test/a', title: 'A', snippet: 's' }] }))
  h.engine('empty', async () => { throw new EngineError('no results', 'ENGINE_EMPTY', true) })
  h.entries.set('off', { id: 'off', probe: async () => ({ available: false, reason: 'down' }), run: async () => { throw new Error('unreachable') } })
  h.engine('bad', async () => { throw new EngineError('HTTP 500', 'ENGINE_ERROR', true) })
  let seen: unknown
  h.engine('opts', async input => { seen = input.options; return { sources: [{ url: 'https://ex.test/o', snippet: 's' }] } })
  try {
    const ok = await h.router.runProvider({ id: 'ok', query: 'q', count: 3, signal })
    assert.equal(ok.state, 'ok')
    assert.equal(ok.state === 'ok' && ok.sources[0]!.url, 'https://ex.test/a')
    assert.deepEqual(await h.router.runProvider({ id: 'empty', query: 'q', count: 3, signal }), { state: 'empty' })
    assert.deepEqual(await h.router.runProvider({ id: 'off', query: 'q', count: 3, signal }), { state: 'skipped', reason: 'down' })
    assert.deepEqual(await h.router.runProvider({ id: 'nope', query: 'q', count: 3, signal }), { state: 'skipped', reason: 'unknown' })
    const bad = await h.router.runProvider({ id: 'bad', query: 'q', count: 3, signal })
    assert.equal(bad.state, 'error')
    assert.deepEqual(await h.router.runProvider({ id: 'bad', query: 'q', count: 3, signal }), { state: 'skipped', reason: 'cooldown' }, 'cooling down now')
    await h.router.runProvider({ id: 'opts', query: 'q', count: 3, signal, options: { exa: { includeDomains: ['x.test'] } } })
    assert.deepEqual(seen, { exa: { includeDomains: ['x.test'] } })
    assert.equal(h.store.listQueries({ kind: 'search' }).length, 0, 'provider runs are not persisted by the router')

    const controller = new AbortController()
    h.engine('hang', input => new Promise((_resolve, reject) => { input.signal?.addEventListener('abort', () => reject(input.signal.reason)) }))
    const pending = h.router.runProvider({ id: 'hang', query: 'q', count: 3, signal: controller.signal })
    await new Promise(resolve => setTimeout(resolve, 5))
    controller.abort(new Error('stop'))
    await assert.rejects(pending, /stop/)
    assert.equal((await h.router.providerStatuses(['hang'])).get('hang')!.state, 'ready', 'a cancelled call cools nothing')
  } finally { h.cleanup() }
})

test('resolveSecret reads the environment when no credentials service exists', async () => {
  const h = harness()
  process.env.WSP_TEST_SECRET_REF = 'from-env'
  try {
    assert.equal(await h.router.resolveSecret('WSP_TEST_SECRET_REF'), 'from-env')
    assert.equal(await h.router.resolveSecret('WSP_TEST_SECRET_REF_MISSING'), undefined)
  } finally { delete process.env.WSP_TEST_SECRET_REF; h.cleanup() }
})
