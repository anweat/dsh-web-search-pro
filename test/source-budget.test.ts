import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createBuiltinRegistry, type ProviderAdapter } from '../src/providers/index.ts'
import { EngineError, type EngineDeps } from '../src/engines.ts'
import { SearchRouter } from '../src/router.ts'
import { resolveConfig } from '../src/config.ts'
import { UsageLedger, resolveBudget, usageProviderOf } from '../src/pipeline/ledger.ts'
import { resolveSources } from '../src/pipeline/sources-spec.ts'
import { BOCHA_USAGE_PROVIDER } from '../src/providers/bocha.ts'
import { Store } from '../src/store.ts'
import { registerTools } from '../src/tools.ts'
import { findAction } from '../src/actions/registry.ts'
import { checkOutput } from '../src/actions/schema.ts'
import { callAction, renderResult } from './call-helper.ts'

/**
 * Request budgets (dev-plan M11a): `sources.budget.<id>: { total?, daily? }`, optional and unset by default. Counted in the
 * usage ledger (persistent, reserved atomically before the request), a used-up source is skipped with a note, never an error.
 */

let seq = 0
const tmp = (): { dir: string; db: string; cleanup: () => void } => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wsp-budget-'))
  return { dir, db: path.join(dir, 'store-' + ++seq + '.db'), cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) }
}

interface Behaviour { records?: boolean; fail?: EngineError; empty?: boolean }
function source(name: string, behaviour: Behaviour = { records: true }): ProviderAdapter {
  return {
    descriptor: { id: 'vendor:' + name, aliases: [name], label: name, adapterVersion: '1', contractVersion: 1, operations: ['search'], taskProfiles: ['general'], languages: ['en'], regions: ['global'], resultKinds: ['web'], requirements: [], supportedFilters: [], costModel: { kind: 'metered' }, costTier: 'paid' },
    probeLocal: () => ({ available: true, credential: 'configured' }),
    create: (deps: EngineDeps) => ({
      id: name, label: name, available: () => true,
      async search() {
        if (behaviour.fail) throw behaviour.fail
        if (behaviour.records) deps.usage?.record({ provider: name, protocol: 'search', requests: 1, note: 'booked by the adapter' })
        if (behaviour.empty) throw new EngineError(name + ' returned no results', 'ENGINE_EMPTY', true)
        return { sources: [{ url: 'https://' + name + '.test/', title: name, snippet: 'snippet of ' + name }] }
      },
    }),
  }
}

function harness(db: string, sources: object, adapters: ProviderAdapter[], engines = ['alpha', 'beta']) {
  const registry = createBuiltinRegistry()
  for (const a of adapters) registry.register(a)
  const config = resolveConfig({ dbPath: db, engines, enableCliBackends: false, opencliEnabled: false, agentReachEnabled: false, sources } as never)
  const store = new Store(config.dbPath)
  const router = new SearchRouter({ get: () => undefined } as never, config, store, undefined, undefined, undefined, registry)
  return { config, store, router, registry, search: (query: string, over: object = {}) => router.search({ query, count: 3, fresh: true, multi: false, signal: undefined, ...over }) }
}

// ── settings ─────────────────────────────────────────────────────────────────

test('sources.budget: no budget by default; entries are validated and bad ones dropped with a reason', () => {
  assert.deepEqual(resolveConfig({} as never).sources.budget, {})
  const r = resolveSources({ budget: { bocha: { total: 1000, daily: 50 }, tavily: { daily: 20.9 }, brave: { total: -1 }, serper: 'x' as never, nope: { total: 5 }, linkup: {} } }, id => id !== 'nope')
  assert.deepEqual(r.budget, { bocha: { total: 1000, daily: 50 }, tavily: { daily: 20 } })
  assert.equal(r.diagnostics.length, 3)
  assert.match(r.diagnostics.join('\n'), /sources\.budget\.brave\.total ignored: must be a number >= 0/)
  assert.match(r.diagnostics.join('\n'), /sources\.budget\.serper ignored: not an object/)
  assert.match(r.diagnostics.join('\n'), /sources\.budget\.nope ignored: not a registered source/)
  assert.equal(resolveConfig({ sources: { budget: { bocha: { total: 1000, daily: 50 } } } } as never).sources.budget.bocha!.total, 1000)
})

test('the ledger name of a source: Bocha books its rows as bocha-search, every other source under its route id', () => {
  assert.equal(usageProviderOf('bocha'), BOCHA_USAGE_PROVIDER)
  assert.equal(usageProviderOf('tavily'), 'tavily')
})

// ── the ledger: atomic reservation, persistence ──────────────────────────────

test('ledger: a reservation past the total or the daily cap is refused; counters persist across a restart and an open reservation still counts', () => {
  const t = tmp()
  try {
    const caps = resolveBudget(undefined).caps
    let store = new Store(t.db)
    let now = Date.parse('2026-10-04T10:00:00Z')
    let ledger = new UsageLedger(store, caps, () => now)
    const take = (budget: { total?: number; daily?: number }) => ledger.reserveRequest('bocha', budget)
    const a = take({ total: 3, daily: 2 })
    const b = take({ total: 3, daily: 2 })
    assert.ok(!('refused' in a) && !('refused' in b))
    assert.deepEqual(take({ total: 3, daily: 2 }), { refused: 'request budget used up (today 2/2)' })
    if (!('refused' in a)) a.settle(1)
    if (!('refused' in b)) b.release('did not reach the service')
    assert.deepEqual(ledger.requestBudget('bocha', { total: 3, daily: 2 }).daily, { limit: 2, used: 1, remaining: 1 })
    // restart: a new store and ledger read the same counters
    store.close()
    store = new Store(t.db)
    ledger = new UsageLedger(store, caps, () => now)
    assert.equal(ledger.requestBudget('bocha', { total: 3 }).total!.used, 1, 'persisted')
    const c = ledger.reserveRequest('bocha', { total: 3, daily: 2 })
    assert.ok(!('refused' in c))
    // an open reservation (a crash before settling) keeps counting
    store.close()
    store = new Store(t.db)
    ledger = new UsageLedger(store, caps, () => now)
    assert.equal(ledger.requestBudget('bocha', { total: 3 }).total!.used, 2)
    // next day: the daily cap resets, the total does not
    now = Date.parse('2026-10-05T10:00:00Z')
    const day2 = ledger.requestBudget('bocha', { total: 3, daily: 2 })
    assert.deepEqual([day2.total!.used, day2.daily!.used, day2.exhausted], [2, 0, false])
    const d = ledger.reserveRequest('bocha', { total: 3, daily: 2 })
    assert.ok(!('refused' in d))
    assert.deepEqual(ledger.reserveRequest('bocha', { total: 3, daily: 2 }), { refused: 'request budget used up (total 3/3)' })
    const spent = ledger.requestBudget('bocha', { total: 3, daily: 2 })
    assert.equal(spent.exhausted, true)
    assert.match(spent.reason!, /request budget used up \(total 3\/3\)/)
    store.close()
  } finally { t.cleanup() }
})

test('ledger: two stores on one file cannot both spend the last request', () => {
  const t = tmp()
  try {
    const caps = resolveBudget(undefined).caps
    const one = new Store(t.db)
    const two = new Store(t.db)
    const a = new UsageLedger(one, caps)
    const b = new UsageLedger(two, caps)
    const results = [a.reserveRequest('tavily', { total: 1 }), b.reserveRequest('tavily', { total: 1 })]
    assert.equal(results.filter(r => 'refused' in r).length, 1)
    one.close()
    two.close()
  } finally { t.cleanup() }
})

// ── the router: skip with a note, fall back, count once ──────────────────────

test('router: a used-up source is skipped and the next engine answers; the skip is reported, not thrown', async () => {
  const t = tmp()
  const h = harness(t.db, { budget: { alpha: { total: 2 } } }, [source('alpha'), source('beta')])
  try {
    assert.equal((await h.search('q1')).engine, 'alpha')
    assert.equal((await h.search('q2')).engine, 'alpha')
    const third = await h.search('q3')
    assert.equal(third.engine, 'beta', 'falls back to the next configured engine')
    assert.match(third.fallbackNote ?? '', /skipped: alpha: request budget used up \(total 2\/2\)/)
    // the status the planner reads
    const statuses = await h.router.providerStatuses(['alpha', 'beta'])
    assert.deepEqual([statuses.get('alpha')!.state, statuses.get('alpha')!.budgetExhausted], ['unavailable', true])
    assert.match(statuses.get('alpha')!.reason!, /request budget used up/)
    assert.equal(statuses.get('beta')!.budgetExhausted, undefined)
    // asking for it by name when it is the only engine is an empty result that says why, not an error
    const named = await h.search('q4', { engines: ['alpha'] })
    assert.deepEqual(named.sources, [])
    assert.match(named.fallbackNote ?? '', /skipped: alpha \(request budget used up \(total 2\/2\)\)/)
    // the evidence pipeline's per-provider call: a skip with the reason, never an error
    const call = await h.router.runProvider({ id: 'alpha', query: 'q5', count: 3, signal: new AbortController().signal })
    assert.equal(call.state, 'skipped')
    assert.match((call as { reason: string }).reason, /request budget used up \(total 2\/2\)/)
  } finally { h.store.close(); t.cleanup() }
})

test('router: the budget survives a restart (new store, new router on the same file)', async () => {
  const t = tmp()
  const first = harness(t.db, { budget: { alpha: { total: 1 } } }, [source('alpha'), source('beta')])
  try {
    assert.equal((await first.search('q1')).engine, 'alpha')
    first.store.close()
    const second = harness(t.db, { budget: { alpha: { total: 1 } } }, [source('alpha'), source('beta')])
    try {
      assert.equal((await second.search('q2')).engine, 'beta')
      assert.equal(second.router.requestBudgetOf('alpha')!.exhausted, true)
    } finally { second.store.close() }
  } finally { t.cleanup() }
})

test('router: a request is counted once whether the adapter books it or not; a failure gives the reservation back; an empty answer counts', async () => {
  const t = tmp()
  const h = harness(t.db, { budget: { rec: { total: 50 }, quiet: { total: 50 }, broken: { total: 50 }, hollow: { total: 50 } } }, [
    source('rec', { records: true }), source('quiet', { records: false }), source('broken', { fail: new EngineError('HTTP 500', 'ENGINE_ERROR', true) }), source('hollow', { records: false, empty: true }),
  ], ['rec'])
  try {
    const used = (id: string): number => h.router.requestBudgetOf(id)!.total!.used
    await h.search('one', { engines: ['rec'] })
    assert.equal(used('rec'), 1, 'the adapter booked it and the router did not book a second one')
    await h.search('two', { engines: ['quiet'] })
    assert.equal(used('quiet'), 1, 'an adapter that books nothing is counted by the router')
    await assert.rejects(() => h.search('three', { engines: ['broken'] }), /HTTP 500/)
    assert.equal(used('broken'), 0, 'a failed request is not counted')
    assert.deepEqual((await h.search('four', { engines: ['hollow'] })).sources, [], 'empty is a result with a note, not an error')
    assert.equal(used('hollow'), 1, 'an empty answer is a served request')
    // the rows in the ledger: no leftover open reservations
    const rows = h.store.usageRows(new UsageLedger(h.store, resolveBudget(undefined).caps).day())
    assert.equal(rows.filter(r => r.status === 'reserved').length, 0)
  } finally { h.store.close(); t.cleanup() }
})

test('router: only a source with a budget is reserved; the others run untouched and book nothing extra', async () => {
  const t = tmp()
  const h = harness(t.db, { budget: { alpha: { total: 5 } } }, [source('alpha', { records: false }), source('beta', { records: false })])
  try {
    await h.search('q', { engines: ['beta'] })
    const rows = h.store.usageRows(new UsageLedger(h.store, resolveBudget(undefined).caps).day())
    assert.deepEqual(rows.filter(r => r.provider === 'beta'), [], 'beta has no budget: no row')
    assert.equal(h.router.requestBudgetOf('beta'), undefined)
  } finally { h.store.close(); t.cleanup() }
})

test('sources.budget accepts an alias or a full id; an unknown id is reported in sources.status notes and counted nowhere', async () => {
  const t = tmp()
  const h = harness(t.db, { budget: { 'vendor:alpha': { total: 1 }, ghost: { total: 1 } } }, [source('alpha'), source('beta')])
  try {
    assert.equal((await h.search('q1')).engine, 'alpha')
    assert.equal((await h.search('q2')).engine, 'beta', 'the full id resolved to the route id alpha')
    assert.match(h.router.sourceDiagnostics().join('\n'), /sources\.budget\.ghost ignored: not a registered source/)
  } finally { h.store.close(); t.cleanup() }
})

// ── sources.status ───────────────────────────────────────────────────────────

test('sources.status shows used and remaining requests of a capped source, the strategy line and problems in the settings', async () => {
  const t = tmp()
  const h = harness(t.db, { priority: ['alpha'], disabled: ['beta'], budget: { alpha: { total: 3, daily: 2 }, ghost: { total: 1 } } }, [source('alpha'), source('beta')])
  const definitions = new Map<string, any>()
  try {
    registerTools({ ctx: { tools: { register: (d: any) => definitions.set(d.name, d) } } as any, config: h.config, dynamic: () => h.config, store: h.store, router: h.router, fetch: {} as any, browser: {} as any })
    await h.search('q1', { engines: ['alpha'] })
    const def = findAction('sources.status')!
    const out = await callAction(definitions, 'sources.status')
    assert.deepEqual(checkOutput(def.output, out), [])
    const alpha = out.providers.find((p: any) => p.route === 'alpha')
    assert.deepEqual([alpha.budget.total, alpha.budget.daily, alpha.budget.exhausted], [{ limit: 3, used: 1, remaining: 2 }, { limit: 2, used: 1, remaining: 1 }, false])
    assert.equal(out.providers.find((p: any) => p.route === 'beta').budget, undefined)
    assert.deepEqual(out.sources, { policy: 'default', priority: ['alpha'], disabled: ['beta'] })
    assert.ok(out.notes.some((n: string) => /sources\.budget\.ghost ignored/.test(n)))
    const text = renderResult('sources.status', out)
    assert.match(text, /request budget alpha: total 1\/3 \(2 left\), today 1\/2 \(1 left\)\n/)
    assert.match(text, /source strategy: policy=default, priority: alpha, disabled: beta/)
    await h.search('q2', { engines: ['alpha'] })
    const spent = await h.search('q3', { engines: ['alpha'] })
    assert.deepEqual(spent.sources, [])
    assert.match(spent.fallbackNote ?? '', /request budget used up/)
    const after = renderResult('sources.status', await callAction(definitions, 'sources.status'))
    assert.match(after, /request budget alpha: total 2\/3 \(1 left\), today 2\/2 \(0 left\) — used up: skipped, the plan falls back to other sources/)
  } finally { h.store.close(); t.cleanup() }
})
