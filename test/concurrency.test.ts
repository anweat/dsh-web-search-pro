import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { BackendRegistry } from '../src/backend-registry.ts'
import { EngineError } from '../src/engines.ts'
import { FetchService } from '../src/fetch.ts'
import { SearchRouter } from '../src/router.ts'
import { SingleFlight } from '../src/singleflight.ts'
import { Store } from '../src/store.ts'
import { capText } from '../src/util.ts'

type Src = { url: string; title?: string; snippet?: string; publishedAt?: string }
type Entries = Map<string, { id: string; probe: () => unknown; run: (i: any) => Promise<unknown>; assess?: (v: unknown) => unknown }>

function deferred<T = void>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

const tick = (ms = 5) => new Promise(resolve => setTimeout(resolve, ms))

function harness(opts: { engines?: string[]; busyTimeoutMs?: number; parallel?: boolean } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-web-concurrency-'))
  const dbPath = path.join(dir, 'store.db')
  const store = new Store(dbPath, { ...opts.busyTimeoutMs !== undefined ? { busyTimeoutMs: opts.busyTimeoutMs } : {}, onDiagnostic: () => {} })
  const config = {
    memoryCacheEntries: 8, ttlSeconds: 60, engines: opts.engines ?? ['e1', 'e2'], rrfConstant: 60,
    freshnessBoost: 0, freshnessDays: 30, authorityBoost: 0, authorityDomains: [],
    searchMaxResults: 5, parallelEngines: opts.parallel ?? false,
    exaApiKeyEnv: 'EXA_API_KEY', jinaApiKeyEnv: 'JINA_API_KEY', githubTokenEnv: 'GITHUB_TOKEN',
    enableCliBackends: false, opencliEnabled: false, agentReachEnabled: false,
    playwright: { enabled: false },
  }
  const router = new SearchRouter({ get: () => undefined } as never, config as never, store)
  const entries = (router as any).backends.entries as Entries
  const engine = (id: string, run: (i: any) => Promise<unknown>) => { entries.set(id, { id, probe: async () => ({ available: true }), run }) }
  const cleanup = () => { store.close(); fs.rmSync(dir, { recursive: true, force: true }) }
  return { dir, dbPath, store, config, router, entries, engine, cleanup }
}

const sources = (n: number, snippet = 'snippet'): Src[] => Array.from({ length: n }, (_, i) => ({ url: 'https://ex.test/' + i, title: 'T' + i, snippet }))

/** Hold a write lock on `dbPath` from another process for `holdMs`. */
async function holdLock(dbPath: string, holdMs: number): Promise<{ done: Promise<number | null> }> {
  const script = `
    const { DatabaseSync } = require('node:sqlite')
    const db = new DatabaseSync(process.argv[1])
    db.exec('PRAGMA busy_timeout = 5000')
    db.exec('BEGIN IMMEDIATE')
    process.stdout.write('locked\\n')
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ${holdMs})
    db.exec('COMMIT')
    db.close()
  `
  const child = spawn(process.execPath, ['-e', script, dbPath], { stdio: ['ignore', 'pipe', 'inherit'] })
  const locked = deferred()
  child.stdout.on('data', chunk => { if (String(chunk).includes('locked')) locked.resolve() })
  const done = new Promise<number | null>(resolve => child.on('exit', resolve))
  await locked.promise
  return { done }
}

// ---- C1 / C2 / C4: store ----

test('C1: a write waits for another process holding the lock instead of failing', async () => {
  const h = harness()
  try {
    const lock = await holdLock(h.dbPath, 400)
    const started = Date.now()
    const id = h.store.recordQuery({ kind: 'search', query: 'waited', engine: 'e1', status: 'ok' })
    const elapsed = Date.now() - started
    assert.ok(elapsed >= 150, 'write should have waited on busy_timeout, waited ' + elapsed + 'ms')
    assert.equal(h.store.queryById(id)?.query, 'waited')
    assert.equal(await lock.done, 0)
    assert.equal(h.store.diagnostics().writeFailures, 0)
  } finally { h.cleanup() }
})

test('C1: SQLITE_BUSY after the timeout is logged and never fails a search that has results', async () => {
  const messages: string[] = []
  const h = harness({ busyTimeoutMs: 30 })
  const store = new Store(h.dbPath, { busyTimeoutMs: 30, onDiagnostic: m => messages.push(m) })
  const router = new SearchRouter({ get: () => undefined } as never, h.config as never, store)
  ;((router as any).backends.entries as Entries).set('e1', { id: 'e1', probe: async () => ({ available: true }), run: async () => ({ sources: sources(2) }) })
  try {
    const lock = await holdLock(h.dbPath, 500)
    assert.throws(() => store.recordQuery({ kind: 'search', status: 'ok' }), /locked|busy/i)
    const result = await router.search({ query: 'busy', engines: ['e1'], count: 5, fresh: true, multi: false, signal: undefined })
    assert.equal(result.sources.length, 2)
    assert.equal(store.diagnostics().writeFailures, 1)
    assert.match(store.diagnostics().lastError ?? '', /recordSearch/)
    assert.ok(messages.some(m => /persistence failed/.test(m)))
    await lock.done
    // The lock is gone: persistence works again.
    await router.search({ query: 'after', engines: ['e1'], count: 5, fresh: true, multi: false, signal: undefined })
    assert.equal(store.listQueries({ kind: 'search' }).length, 1)
  } finally { store.close(); h.cleanup() }
})

test('C2: transaction commits on success and rolls back everything when the body throws', () => {
  const h = harness()
  try {
    assert.throws(() => h.store.transaction(() => {
      h.store.recordQuery({ kind: 'search', query: 'half', status: 'ok' })
      throw new Error('boom')
    }), /boom/)
    assert.equal(h.store.listQueries({}).length, 0)
    const id = h.store.transaction(() => h.store.recordQuery({ kind: 'search', query: 'whole', status: 'ok' }))
    assert.equal(h.store.queryById(id)?.query, 'whole')
  } finally { h.cleanup() }
})

test('C2: nested transactions roll back only the inner failure', () => {
  const h = harness()
  try {
    h.store.transaction(() => {
      h.store.recordQuery({ kind: 'search', query: 'outer', status: 'ok' })
      assert.throws(() => h.store.transaction(() => {
        h.store.recordQuery({ kind: 'search', query: 'inner', status: 'ok' })
        throw new Error('inner')
      }), /inner/)
    })
    assert.deepEqual(h.store.listQueries({}).map(q => q.query), ['outer'])
  } finally { h.cleanup() }
})

test('C2: recordSearch is all-or-nothing when a result row fails midway', () => {
  const h = harness()
  try {
    const bad = [{ url: 'https://ok.test/1' }, { url: {} as never }]
    assert.throws(() => h.store.recordSearch({ kind: 'search', query: 'q', status: 'ok', cacheKey: 'k' }, bad, 'e1'))
    assert.equal(h.store.listQueries({}).length, 0)
    assert.equal(h.store.stats().results, 0)
    assert.equal(h.store.bestEffort('recordSearch', () => h.store.recordSearch({ kind: 'search', query: 'q', status: 'ok' }, bad, 'e1')), undefined)
    assert.equal(h.store.diagnostics().writeFailures, 1)
    // The connection is not left inside a dangling transaction.
    const id = h.store.recordSearch({ kind: 'search', query: 'good', status: 'ok' }, [{ url: 'https://ok.test/1' }], 'e1')
    assert.equal(h.store.resultsForQuery(id).length, 1)
  } finally { h.cleanup() }
})

test('C2: recordFetch writes the query and page together or not at all', () => {
  const h = harness()
  try {
    assert.throws(() => h.store.recordFetch({ kind: 'fetch', url: 'https://ex.test', status: 'ok' }, { url: {} as never }))
    assert.equal(h.store.listQueries({}).length, 0)
    const id = h.store.recordFetch({ kind: 'fetch', url: 'https://ex.test', status: 'ok' }, { url: 'https://ex.test', text: 'body', source: 'http' })
    assert.equal(h.store.pageForQuery(id)?.text, 'body')
  } finally { h.cleanup() }
})

test('C2: clearCache and deleteQuery keep counts exact and leave no partial rows', () => {
  const h = harness()
  try {
    const a = h.store.recordSearch({ kind: 'search', query: 'a', engine: 'e1', status: 'ok' }, sources(3), 'e1')
    h.store.recordFetch({ kind: 'fetch', url: 'https://ex.test', engine: 'e2', status: 'ok' }, { url: 'https://ex.test', text: 't' })
    assert.deepEqual(h.store.deleteQuery(a), { queries: 1, results: 3, pages: 0 })
    assert.deepEqual(h.store.clearCache({}), { queries: 1, results: 0, pages: 1 })
    assert.deepEqual(h.store.stats(), { ...h.store.stats(), queries: 0, results: 0, pages: 0 })
  } finally { h.cleanup() }
})

test('C4: after close() writes are no-ops with a diagnostic and reads miss, without throwing', () => {
  const messages: string[] = []
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-web-closed-'))
  const store = new Store(path.join(dir, 'store.db'), { onDiagnostic: m => messages.push(m) })
  try {
    const id = store.recordSearch({ kind: 'search', query: 'q', status: 'ok', cacheKey: 'k' }, sources(1), 'e1')
    store.close()
    assert.doesNotThrow(() => store.recordQuery({ kind: 'search', status: 'ok' }))
    assert.doesNotThrow(() => store.recordSearch({ kind: 'search', status: 'ok' }, sources(1), 'e1'))
    assert.doesNotThrow(() => store.recordFetch({ kind: 'fetch', status: 'ok' }, { url: 'https://ex.test' }))
    assert.doesNotThrow(() => store.savePage({ url: 'https://ex.test' }))
    assert.doesNotThrow(() => store.clearCache({}))
    assert.equal(store.deleteQuery(id), undefined)
    assert.equal(store.transaction(() => 42), 42)
    assert.equal(store.getCachedQuery('search', 'k', 60), undefined)
    assert.deepEqual(store.resultsForQuery(id), [])
    assert.equal(store.getPage('https://ex.test', 60), undefined)
    assert.deepEqual(store.listQueries({}), [])
    const diagnostics = store.diagnostics()
    assert.equal(diagnostics.closed, true)
    assert.ok(diagnostics.skippedWrites >= 5)
    assert.ok(messages.some(m => /skipped recordSearch/.test(m)))
    assert.doesNotThrow(() => store.close())
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
})

test('C4: an in-flight search and fetch still return their results when the store closes underneath them', async () => {
  const h = harness()
  const gate = deferred()
  h.engine('e1', async () => { await gate.promise; return { sources: sources(2) } })
  const fetchSvc = new FetchService(h.store, h.config as never, {} as never)
  ;(fetchSvc as any).fetchHttp = async (url: string) => { await gate.promise; return { url, text: 'x'.repeat(400), source: 'http', fromCache: false } }
  try {
    const search = h.router.search({ query: 'closing', engines: ['e1'], count: 5, fresh: false, multi: false, signal: undefined })
    const page = fetchSvc.fetchPage('https://ex.test/p', { mode: 'http', signal: undefined, maxChars: 10_000, fresh: false, persist: true })
    await tick()
    h.store.close()
    gate.resolve()
    assert.equal((await search).sources.length, 2)
    assert.equal((await page).text.length, 400)
  } finally { h.cleanup() }
})

// ---- C3: singleflight ----

test('C3: SingleFlight runs one unit of work per key and shares the result', async () => {
  const flights = new SingleFlight<{ n: number }>()
  const gate = deferred()
  let runs = 0
  const work = async () => { runs++; await gate.promise; return { n: runs } }
  const a = flights.do('k', work)
  const b = flights.do('k', work)
  const c = flights.do('other', work)
  gate.resolve()
  const [ra, rb, rc] = await Promise.all([a, b, c])
  assert.equal(runs, 2)
  assert.equal(ra, rb)
  assert.notEqual(ra, rc)
  assert.equal(flights.size, 0)
  await flights.do('k', work)
  assert.equal(runs, 3, 'a settled flight is not reused')
})

test('C3: an aborted waiter rejects alone; shared work is cancelled only when all waiters abort', async () => {
  const flights = new SingleFlight<string>()
  const gate = deferred()
  let sharedSignal: AbortSignal | undefined
  let runs = 0
  const work = (signal: AbortSignal) => { runs++; sharedSignal = signal; return gate.promise.then(() => 'done') }
  const ca = new AbortController()
  const cb = new AbortController()
  const a = flights.do('k', work, ca.signal)
  const b = flights.do('k', work, cb.signal)
  ca.abort(new Error('a-cancelled'))
  await assert.rejects(a, /a-cancelled/)
  assert.equal(sharedSignal?.aborted, false)
  gate.resolve()
  assert.equal(await b, 'done')
  assert.equal(runs, 1)

  const all = new SingleFlight<string>()
  const c1 = new AbortController()
  const c2 = new AbortController()
  const p1 = all.do('k', work, c1.signal)
  const p2 = all.do('k', work, c2.signal)
  c1.abort()
  assert.equal(sharedSignal?.aborted, false)
  c2.abort()
  assert.equal(sharedSignal?.aborted, true)
  await assert.rejects(p1)
  await assert.rejects(p2)
  assert.equal(all.size, 0, 'an abandoned flight is not joinable')
  await assert.rejects(all.do('k', work, AbortSignal.abort()), /abort/i)
})

test('C3: concurrent identical searches call the engine once and persist one record', async () => {
  const h = harness()
  const gate = deferred()
  let calls = 0
  h.engine('e1', async () => { calls++; await gate.promise; return { sources: sources(3) } })
  try {
    const req = { query: 'same thing', engines: ['e1'], count: 5, fresh: false, multi: false, signal: undefined }
    const a = h.router.search(req)
    const b = h.router.search({ ...req, query: '  Same   thing ' })
    await tick()
    gate.resolve()
    const [ra, rb] = await Promise.all([a, b])
    assert.equal(calls, 1)
    assert.deepEqual(ra, rb)
    assert.equal(ra.sources.length, 3)
    assert.equal(h.store.listQueries({ kind: 'search' }).length, 1)
  } finally { h.cleanup() }
})

test('C3: different counts and fresh requests are not merged', async () => {
  const h = harness()
  const gate = deferred()
  let calls = 0
  h.engine('e1', async () => { calls++; await gate.promise; return { sources: sources(8) } })
  try {
    const base = { query: 'counts', engines: ['e1'], multi: false, signal: undefined }
    const p = [
      h.router.search({ ...base, count: 3, fresh: false }),
      h.router.search({ ...base, count: 6, fresh: false }),
      h.router.search({ ...base, count: 6, fresh: true }),
    ]
    await tick()
    gate.resolve()
    const results = await Promise.all(p)
    assert.equal(calls, 3)
    assert.deepEqual(results.map(r => r.sources.length), [3, 6, 6])
  } finally { h.cleanup() }
})

test('C3: one search caller cancelling does not affect the other; both cancelling aborts the engine', async () => {
  const h = harness()
  const gate = deferred()
  let engineSignal: AbortSignal | undefined
  let calls = 0
  h.engine('e1', input => {
    calls++
    engineSignal = input.signal
    return new Promise((resolve, reject) => {
      input.signal?.addEventListener('abort', () => reject(input.signal.reason))
      gate.promise.then(() => resolve({ sources: sources(2) }))
    })
  })
  try {
    const ca = new AbortController()
    const cb = new AbortController()
    const req = { query: 'cancel me', engines: ['e1'], count: 5, fresh: false, multi: false }
    const a = h.router.search({ ...req, signal: ca.signal })
    const b = h.router.search({ ...req, signal: cb.signal })
    await tick()
    ca.abort()
    await assert.rejects(a, /abort/i)
    assert.equal(engineSignal?.aborted, false)
    gate.resolve()
    assert.equal((await b).sources.length, 2)
    assert.equal(calls, 1)

    // Both cancel: the engine sees the abort, and nobody cools it down.
    const gate2 = deferred()
    h.engine('e1', input => new Promise((_resolve, reject) => {
      engineSignal = input.signal
      input.signal?.addEventListener('abort', () => reject(input.signal.reason))
      void gate2.promise
    }))
    const c1 = new AbortController()
    const c2 = new AbortController()
    const req2 = { ...req, query: 'cancel both' }
    const p1 = h.router.search({ ...req2, signal: c1.signal })
    const p2 = h.router.search({ ...req2, signal: c2.signal })
    await tick()
    c1.abort()
    c2.abort()
    await assert.rejects(p1)
    await assert.rejects(p2)
    assert.equal(engineSignal?.aborted, true)
    await tick()
    const diag = await (h.router as any).backends.diagnosticsAsync()
    assert.equal(diag.find((d: { id: string }) => d.id === 'e1').state, 'ready')
  } finally { h.cleanup() }
})

test('C3: concurrent identical platform searches call the engine once', async () => {
  const h = harness()
  const gate = deferred()
  let calls = 0
  ;(h.router as any).platformEngineList = () => [{ id: 'fake-platform', label: 'Fake', available: () => true, search: async () => { calls++; await gate.promise; return { sources: sources(4) } } }]
  try {
    const a = h.router.platformSearch('fake', 'q', undefined, 5, {})
    const b = h.router.platformSearch('fake', 'q', undefined, 5, {})
    const other = h.router.platformSearch('fake', 'q', undefined, 2, {})
    await tick()
    gate.resolve()
    const [ra, rb, rc] = await Promise.all([a, b, other])
    assert.equal(calls, 2, 'same count merges, different count does not')
    assert.deepEqual(ra, rb)
    assert.equal(rc.sources.length, 2)
    assert.equal(h.store.listQueries({ kind: 'platform' }).length, 2)
  } finally { h.cleanup() }
})

test('C3: concurrent identical fetches hit the backend once and persist one snapshot', async () => {
  const h = harness()
  const gate = deferred()
  let calls = 0
  const fetchSvc = new FetchService(h.store, h.config as never, {} as never)
  ;(fetchSvc as any).fetchHttp = async (url: string) => { calls++; await gate.promise; return { url, text: 'body '.repeat(80), source: 'http', fromCache: false } }
  try {
    const opts = { mode: 'http' as const, signal: undefined, maxChars: 10_000, fresh: false, persist: true }
    const ca = new AbortController()
    const a = fetchSvc.fetchPage('https://ex.test/page', opts)
    const b = fetchSvc.fetchPage('https://ex.test/page', { ...opts, signal: ca.signal })
    await tick()
    ca.abort()
    await assert.rejects(b, /abort/i)
    gate.resolve()
    const result = await a
    assert.equal(calls, 1)
    assert.equal(result.source, 'http')
    assert.equal(h.store.listQueries({ kind: 'fetch' }).length, 1)
    assert.equal(h.store.stats().pages, 1)
  } finally { h.cleanup() }
})

// ---- C5 / C6: cooldown semantics ----

const cooldownState = async (reg: BackendRegistry<any, any>, id: string) => (await reg.diagnosticsAsync()).find(d => d.id === id)?.state

function registry(runs: Record<string, (input: any) => Promise<any>>) {
  const reg = new BackendRegistry<any, any>({ cooldownMs: 60_000 })
  for (const [id, run] of Object.entries(runs)) reg.register({ id, probe: async () => ({ available: true }), run })
  return reg
}

test('C5: ENGINE_EMPTY is an empty attempt that falls through without a cooldown', async () => {
  const reg = registry({
    ddg: async () => { throw new EngineError('DuckDuckGo returned no results', 'ENGINE_EMPTY', true) },
    bing: async () => ({ sources: [{ url: 'https://ex.test' }] }),
  })
  const selected = await reg.runSelected({}, { preferred: ['ddg', 'bing'] })
  assert.equal(selected.id, 'bing')
  assert.deepEqual(selected.attempts.map(a => a.id + ':' + a.outcome), ['ddg:empty', 'bing:ok'])
  assert.equal(await cooldownState(reg, 'ddg'), 'ready')
  // Next query still tries ddg (it is not skipped as cooling).
  const again = await reg.runSelected({}, { preferred: ['ddg', 'bing'] })
  assert.equal(again.attempts[0]?.detail, 'DuckDuckGo returned no results')
})

test('C5: only transient failures cool an engine down', async () => {
  const reg = registry({
    net: async () => { throw new EngineError('HTTP 503', 'ENGINE_ERROR', true) },
    plain: async () => { throw new Error('socket hang up') },
    config: async () => { throw new EngineError('needs a key', 'ENGINE_UNAVAILABLE', false) },
    empty: async () => { throw new EngineError('nothing', 'ENGINE_EMPTY', true) },
  })
  for (const id of ['net', 'plain', 'config', 'empty']) await assert.rejects(reg.runSelected({}, { preferred: [id] }))
  assert.equal(await cooldownState(reg, 'net'), 'cooldown')
  assert.equal(await cooldownState(reg, 'plain'), 'cooldown')
  assert.equal(await cooldownState(reg, 'config'), 'ready')
  assert.equal(await cooldownState(reg, 'empty'), 'ready')
})

test('C6: a cancelled caller rethrows immediately and never cools the engine down', async () => {
  let secondRan = false
  const controller = new AbortController()
  const reg = registry({
    slow: input => new Promise((_resolve, reject) => {
      input.signal.addEventListener('abort', () => reject(input.signal.reason))
    }),
    next: async () => { secondRan = true; return { sources: [] } },
  })
  const pending = reg.runSelected({ signal: controller.signal }, { preferred: ['slow', 'next'], signal: controller.signal })
  await tick()
  controller.abort(new Error('user cancelled'))
  await assert.rejects(pending, /user cancelled/)
  assert.equal(secondRan, false)
  assert.equal(await cooldownState(reg, 'slow'), 'ready')
  // Already-aborted callers do not even start an engine.
  await assert.rejects(reg.runSelected({}, { preferred: ['next'], signal: AbortSignal.abort() }))
  assert.equal(secondRan, false)
})

test('C6: a non-abort error thrown after the signal aborted is still not a cooldown', async () => {
  const controller = new AbortController()
  const reg = registry({ flaky: async () => { controller.abort(); throw new Error('fetch failed') } })
  await assert.rejects(reg.runSelected({}, { preferred: ['flaky'], signal: controller.signal }), /fetch failed/)
  assert.equal(await cooldownState(reg, 'flaky'), 'ready')
})

test('C5/C6 through the router: empty results and cancellation leave diagnostics out of cooldown', async () => {
  const h = harness()
  h.engine('e1', async () => { throw new EngineError('no results', 'ENGINE_EMPTY', true) })
  h.engine('e2', async () => ({ sources: sources(1) }))
  try {
    const result = await h.router.search({ query: 'empty then ok', count: 3, fresh: true, multi: false, signal: undefined })
    assert.equal(result.engine, 'e2')
    assert.deepEqual(result.enginesTried, ['e1', 'e2'])
    const diag = await (h.router as any).backends.diagnosticsAsync()
    assert.equal(diag.find((d: { id: string }) => d.id === 'e1').state, 'ready')
  } finally { h.cleanup() }
})

// ---- C7: multi goes through the registry ----

test('C7: multi runs every engine through the registry (cooldown, attempts) and keeps the RRF order', async () => {
  const h = harness({ parallel: true })
  let e1Calls = 0
  let e3Calls = 0
  h.engine('e1', async () => { e1Calls++; return { sources: [{ url: 'https://ex.test/x', snippet: 's' }, { url: 'https://ex.test/y', snippet: 's' }] } })
  h.engine('e2', async () => { throw new EngineError('HTTP 503', 'ENGINE_ERROR', true) })
  h.engine('e3', async () => { e3Calls++; return { sources: [{ url: 'https://ex.test/y', snippet: 's' }, { url: 'https://ex.test/z', snippet: 's' }] } })
  try {
    const req = { query: 'multi', engines: ['e1', 'e2', 'e3'], count: 5, fresh: true, multi: true, signal: undefined }
    const result = await h.router.search(req)
    assert.equal(result.engine, 'multi(e1+e2+e3)')
    assert.deepEqual(result.sources.map(s => s.url), ['https://ex.test/y', 'https://ex.test/x', 'https://ex.test/z'])
    const states = Object.fromEntries((await (h.router as any).backends.diagnosticsAsync()).map((d: { id: string; state: string }) => [d.id, d.state]))
    assert.equal(states.e2, 'cooldown')
    assert.equal(states.e1, 'ready')
    await h.router.search({ ...req, query: 'multi again' })
    assert.deepEqual([e1Calls, e3Calls], [2, 2])
    const failing = h.entries.get('e2')!
    let e2Calls = 0
    h.engine('e2', async () => { e2Calls++; return failing.run({}) })
    await h.router.search({ ...req, query: 'multi third' })
    assert.equal(e2Calls, 0, 'a cooling engine is skipped in multi mode')
  } finally { h.cleanup() }
})

test('C7: multi with only empty and unavailable engines returns an empty result with a note and cools nothing', async () => {
  const h = harness({ parallel: true })
  h.entries.set('e1', { id: 'e1', probe: async () => ({ available: false, reason: 'down' }), run: async () => { throw new Error('unreachable') } })
  h.engine('e2', async () => { throw new EngineError('no results', 'ENGINE_EMPTY', true) })
  try {
    const result = await h.router.search({ query: 'nothing', engines: ['e1', 'e2'], count: 5, fresh: true, multi: true, signal: undefined })
    assert.deepEqual(result.sources, [])
    assert.equal(result.engine, 'multi(e1+e2)')
    assert.match(result.fallbackNote!, /all engines returned no results or were unavailable/)
    assert.match(result.fallbackNote!, /skipped: e1 \(down\)/)
    assert.equal(h.store.listQueries({ kind: 'search' }).length, 0, 'not persisted')
    const diag = await (h.router as any).backends.diagnosticsAsync()
    assert.equal(diag.find((d: { id: string }) => d.id === 'e2').state, 'ready')
  } finally { h.cleanup() }
})

test('C7: all engines unavailable (single and multi) is empty with a note; one runtime failure still throws', async () => {
  const h = harness({ parallel: true })
  for (const id of ['e1', 'e2']) h.entries.set(id, { id, probe: async () => ({ available: false, reason: id + ' off' }), run: async () => { throw new Error('unreachable') } })
  try {
    for (const multi of [true, false]) {
      const result = await h.router.search({ query: 'offline ' + multi, engines: ['e1', 'e2'], count: 5, fresh: true, multi, signal: undefined })
      assert.deepEqual(result.sources, [])
      assert.match(result.fallbackNote!, /skipped: e1 \(e1 off\), e2 \(e2 off\)/)
    }
    h.engine('e3', async () => { throw new EngineError('HTTP 503', 'ENGINE_ERROR', true) })
    await assert.rejects(h.router.search({ query: 'one fails', engines: ['e1', 'e3'], count: 5, fresh: true, multi: true, signal: undefined }), /all engines failed: e1: .*e1 off.*; e3: .*HTTP 503/)
    h.engine('e4', async () => { throw new EngineError('HTTP 502', 'ENGINE_ERROR', true) })
    await assert.rejects(h.router.search({ query: 'one fails single', engines: ['e1', 'e4'], count: 5, fresh: true, multi: false, signal: undefined }), /no backend succeeded/)
  } finally { h.cleanup() }
})

test('C7: cancelling a multi search rethrows the abort and cools nothing', async () => {
  const h = harness({ parallel: true })
  const controller = new AbortController()
  for (const id of ['e1', 'e2']) h.engine(id, input => new Promise((_resolve, reject) => {
    input.signal?.addEventListener('abort', () => reject(input.signal.reason))
  }))
  try {
    const pending = h.router.search({ query: 'multi cancel', engines: ['e1', 'e2'], count: 5, fresh: true, multi: true, signal: controller.signal })
    await tick()
    controller.abort(new Error('stop'))
    await assert.rejects(pending, /stop/)
    const diag = await (h.router as any).backends.diagnosticsAsync()
    assert.deepEqual(diag.filter((d: { id: string }) => ['e1', 'e2'].includes(d.id)).map((d: { state: string }) => d.state), ['ready', 'ready'])
  } finally { h.cleanup() }
})

// ---- C8: one output shape ----

test('C8: live, SQLite-cache and memory results share one shape (snippet cap, count slicing)', async () => {
  const h = harness()
  const long = 'z'.repeat(900)
  h.engine('e1', async () => ({ sources: sources(6, long).map((s, i) => ({ ...s, ...i === 0 ? { publishedAt: '2026-01-01' } : {} })) }))
  try {
    const req = { query: 'shape', engines: ['e1'], count: 4, fresh: false, multi: false, signal: undefined }
    const live = await h.router.search(req)
    assert.equal(live.fromCache, false)
    assert.equal(live.sources.length, 4)
    assert.equal(live.sources[0]!.snippet, capText(long, 500))
    // Memory hit from the same router.
    const memory = await h.router.search(req)
    assert.equal(memory.fromCache, true)
    assert.deepEqual(memory.sources, live.sources)
    // SQLite hit from a fresh router (empty memory) on the same store.
    const router2 = new SearchRouter({ get: () => undefined } as never, h.config as never, h.store)
    const sqlite = await router2.search(req)
    assert.equal(sqlite.fromCache, true)
    assert.deepEqual(sqlite.sources, live.sources)
    assert.equal(sqlite.availableCount, 6)
    // Raw history keeps the uncapped snippet.
    const rows = h.store.resultsForQuery(h.store.listQueries({ kind: 'search' })[0]!.id)
    assert.equal(rows[0]!.snippet?.length, 900)
  } finally { h.cleanup() }
})

test('C8: platform search caps snippets and slices to count on live and cached paths', async () => {
  const h = harness()
  const long = 'p'.repeat(700)
  ;(h.router as any).platformEngineList = () => [{ id: 'fake', label: 'Fake', available: () => true, search: async () => ({ sources: sources(6, long) }) }]
  try {
    const live = await h.router.platformSearch('fake', 'q', undefined, 3, {})
    assert.equal(live.sources.length, 3)
    assert.equal(live.sources[0]!.snippet, capText(long, 500))
    const cached = await h.router.platformSearch('fake', 'q', undefined, 3, {})
    assert.equal(cached.fromCache, true)
    assert.deepEqual(cached.sources, live.sources)
  } finally { h.cleanup() }
})

// ---- C9: truncated ----

test('C9: searchAsProvider reports truncated only when sources were actually cut', async () => {
  const h = harness({ engines: ['e1'] })
  let count = 6
  h.engine('e1', async () => ({ sources: sources(count) }))
  try {
    const cut = await h.router.searchAsProvider({ query: 'many', maxResults: 3 } as never)
    assert.equal(cut.sources.length, 3)
    assert.equal(cut.truncated, true)
    // Same answer from the cache.
    const cached = await h.router.searchAsProvider({ query: 'many', maxResults: 3 } as never)
    assert.equal(cached.truncated, true)
    count = 2
    const whole = await h.router.searchAsProvider({ query: 'few', maxResults: 5 } as never)
    assert.equal(whole.sources.length, 2)
    assert.equal(whole.truncated, false)
    const exact = await h.router.searchAsProvider({ query: 'few', maxResults: 2 } as never)
    assert.equal(exact.truncated, false)
  } finally { h.cleanup() }
})

test('C9: fetch reports truncated when text hit maxChars, on live and cached paths', async () => {
  const h = harness()
  const fetchSvc = new FetchService(h.store, h.config as never, {} as never)
  ;(fetchSvc as any).fetchHttp = async (url: string, _opts: unknown, maxChars: number) => ({ url, text: capText('w '.repeat(5000), maxChars), source: 'http', fromCache: false })
  try {
    const opts = { mode: 'http' as const, signal: undefined, maxChars: 1_000, fresh: false, persist: true }
    const live = await fetchSvc.fetchPage('https://ex.test/long', opts)
    assert.equal(live.truncated, true)
    const cached = await new FetchService(h.store, h.config as never, {} as never).fetchPage('https://ex.test/long', opts)
    assert.equal(cached.fromCache, true)
    assert.equal(cached.truncated, true)
    ;(fetchSvc as any).fetchHttp = async (url: string) => ({ url, text: 'short page '.repeat(30), source: 'http', fromCache: false })
    const small = await fetchSvc.fetchPage('https://ex.test/short', opts)
    assert.equal(small.truncated, undefined)
  } finally { h.cleanup() }
})
