import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createBuiltinRegistry, type ProviderAdapter } from '../src/providers/index.ts'
import { planSources, type PlanOptions, type ProviderStatus } from '../src/pipeline/plan.ts'
import { runPipeline, type PipelineDeps, type ProviderCall, type ProviderOutcome } from '../src/pipeline/run.ts'
import { resolveSources } from '../src/pipeline/sources-spec.ts'
import { SearchRouter } from '../src/router.ts'
import { resolveConfig, resolveSourcePolicy } from '../src/config.ts'
import { Store } from '../src/store.ts'
import type { Profile, TaskSpec } from '../src/pipeline/types.ts'

/**
 * Source policy (dev-plan M11a). Order of precedence: explicit `engines`, then `sources.priority`, then configured keyed sources
 * (promoted for their language and profile), then the anonymous / free defaults. `sources.disabled` removes; `sourcePolicy`
 * `anonymous-only` never uses a source that needs a key, account or login.
 */

const registry = createBuiltinRegistry()
const descriptors = registry.list({ operation: 'search' }).map(a => a.descriptor)
const spec = (over: Partial<TaskSpec> = {}): TaskSpec => ({ goal: 'goal', query: 'query', needs: [{ id: 'n1', text: 'goal', critical: true }], constraints: [], budget: {}, ...over })
const EN = { goal: 'Find how Postgres logical replication slots work', query: 'postgres logical replication slot lag' }
const ZH = { goal: '了解国内大模型备案的最新要求', query: '大模型备案 最新要求 2026' }
const CONFIGURED = ['ddg', 'bing', 'exa', 'seam', 'jina']
const KEYED = ['bocha', 'jina', 'tavily', 'brave', 'linkup', 'serper', 'metaso', 'zhipu', 'baidu-qianfan']

/** Nothing configured: Exa over its keyless MCP route is runnable, keyed sources have no key, ctx.web is absent. */
const NOTHING = (id: string): ProviderStatus =>
  id === 'exa' ? { state: 'ready', credential: 'missing', keyless: true, costTier: 'anonymous' }
    : KEYED.includes(id) ? { state: 'unavailable', credential: 'missing', reason: 'no key' }
      : id === 'seam' ? { state: 'unavailable', reason: 'no ctx.web' }
        : { state: 'ready', credential: 'not_required' }

/** `NOTHING` plus keys for some sources. */
const withKeys = (...keyed: string[]) => (id: string): ProviderStatus => {
  if (keyed.includes(id)) return { state: 'ready', credential: 'configured', costTier: id === 'exa' ? 'free-quota' : undefined as never }
  return NOTHING(id)
}

const plan = (task: Partial<TaskSpec>, over: Partial<PlanOptions> = {}) => planSources(spec(task), { configured: CONFIGURED, status: NOTHING, descriptors, ...over })
const ids = (p: ReturnType<typeof planSources>): string[] => p.providers.map(x => x.id)
/** Round 1 runs at most three of them (evidence.maxQueries 4 keeps one query for a second round). */
const round1 = (p: ReturnType<typeof planSources>): string[] => ids(p).slice(0, 3)

// ── defaults: nothing configured ─────────────────────────────────────────────

test('nothing configured: English leads with Exa over its keyless route, then DuckDuckGo; Chinese uses DuckDuckGo and Bing; verticals are unchanged', () => {
  const en = plan({ ...EN, profile: 'general' })
  assert.deepEqual(ids(en), ['exa', 'ddg'])
  assert.match(en.notes.join('\n'), /language en: preferred exa/)
  assert.deepEqual(ids(plan({ ...EN, profile: 'docs_code' })), ['exa', 'ddg', 'github'])
  assert.deepEqual(ids(plan({ ...EN, profile: 'news_fact' })), ['exa', 'ddg'])
  const zh = plan({ ...ZH, profile: 'general' })
  assert.deepEqual(ids(zh), ['ddg', 'bing'], 'Exa is strong in English only: it waits for a second round; keyed sources without a key take no slot')
  assert.ok(zh.wanted.includes('exa'), 'and stays a second-round candidate')
  assert.match(zh.notes.join('\n'), /exa held for a second round \(strong in another language\)/)
  assert.deepEqual(ids(plan({ ...ZH, profile: 'docs_code' })), ['ddg', 'bing', 'github'])
  assert.deepEqual(round1(plan({ ...EN, profile: 'academic' })), ['arxiv', 'openalex', 'pubmed'])
  assert.deepEqual(round1(plan({ ...ZH, profile: 'experience' })), ['ddg', 'bing', 'v2ex'])
  assert.deepEqual(round1(plan({ ...EN, profile: 'experience' })), ['exa', 'ddg', 'hackernews'])
})

test('Exa without a key is promoted only while its keyless route can run (CLI backends on, mcporter not known missing)', () => {
  const noRoute = (id: string): ProviderStatus => id === 'exa' ? { state: 'unavailable', credential: 'missing', reason: 'mcporter executable not found' } : NOTHING(id)
  assert.deepEqual(ids(plan({ ...EN, profile: 'general' }, { status: noRoute })), ['ddg', 'bing'])
  const credentialOnly = (id: string): ProviderStatus => id === 'exa' ? { state: 'ready', credential: 'missing' } : NOTHING(id)
  assert.deepEqual(ids(plan({ ...EN, profile: 'general' }, { status: credentialOnly })), ['ddg', 'bing', 'exa'], 'ready without the keyless flag: not promoted, only in table order')
})

// ── configured sources ───────────────────────────────────────────────────────

test('a configured key promotes the source for its language and profile; nothing about it needs a paid-allowed list', () => {
  const zh = plan({ ...ZH, profile: 'general' }, { status: withKeys('bocha') })
  assert.deepEqual(ids(zh), ['bocha', 'ddg'])
  assert.deepEqual(ids(plan({ ...ZH, profile: 'docs_code' }, { status: withKeys('bocha') })), ['bocha', 'ddg', 'github'])
  assert.deepEqual(ids(plan({ ...EN, profile: 'general' }, { status: withKeys('bocha') })), ['exa', 'ddg'], 'a Chinese-only source never leads an English task')
  // a configured keyed source leads the keyless Exa; the surplus waits for round 2 (two promoted at most)
  const en = plan({ ...EN, profile: 'general' }, { status: withKeys('tavily') })
  assert.deepEqual(ids(en), ['tavily', 'exa', 'ddg'])
  const many = plan({ ...EN, profile: 'general' }, { status: withKeys('tavily', 'brave') })
  assert.deepEqual(ids(many), ['tavily', 'brave', 'ddg'])
  assert.ok(many.wanted.includes('exa'))
  // a configured Exa API key is the same Exa
  assert.deepEqual(ids(plan({ ...EN, profile: 'general' }, { status: withKeys('exa') })), ['exa', 'ddg'])
})

test('a budget-exhausted source is skipped with a note and the plan falls back to the free sources', () => {
  const used = (id: string): ProviderStatus => id === 'bocha' ? { state: 'unavailable', credential: 'configured', reason: 'request budget used up (1000/1000 total)', budgetExhausted: true } : NOTHING(id)
  const p = plan({ ...ZH, profile: 'general' }, { status: used })
  assert.deepEqual(ids(p), ['ddg', 'bing'])
  assert.match(p.notes.join('\n'), /bocha skipped: request budget used up \(1000\/1000 total\)/)
})

// ── sources.priority ─────────────────────────────────────────────────────────

test('sources.priority ranks listed ready sources first, in the listed order, when they fit the task', () => {
  assert.deepEqual(ids(plan({ ...EN, profile: 'general' }, { priority: ['bing'] })), ['bing', 'exa', 'ddg'])
  assert.deepEqual(ids(plan({ ...EN, profile: 'general' }, { priority: ['ddg', 'exa'] })), ['ddg', 'exa'])
  const p = plan({ ...EN, profile: 'general' }, { priority: ['ddg'] })
  assert.match(p.notes.join('\n'), /sources\.priority: ddg first/)
  // over the configured promotion: a configured Bocha is ranked behind a listed DuckDuckGo
  assert.deepEqual(ids(plan({ ...ZH, profile: 'general' }, { status: withKeys('bocha'), priority: ['ddg', 'bocha'] })), ['ddg', 'bocha'])
  // a listed source that does not fit the language or profile is left out, with a note; a listed source that is not ready is skipped with its reason
  const unfit = plan({ ...EN, profile: 'general' }, { status: withKeys('bocha'), priority: ['bocha', 'ddg'] })
  assert.deepEqual(ids(unfit), ['ddg', 'exa'])
  assert.match(unfit.notes.join('\n'), /sources\.priority: bocha not used for this task \(profile general, language en\)/)
  const notReady = plan({ ...ZH, profile: 'general' }, { priority: ['bocha', 'bing'] })
  assert.deepEqual(ids(notReady), ['bing', 'ddg'])
  assert.deepEqual(notReady.skipped.find(s => s.id === 'bocha'), { id: 'bocha', reason: 'unavailable (no key)' })
  // a ranking never adds a site source to a task that did not ask for one
  assert.ok(!ids(plan({ ...ZH, profile: 'general' }, { priority: ['zhihu'] })).includes('zhihu'))
})

// ── sources.disabled ─────────────────────────────────────────────────────────

test('sources.disabled removes a source from the plan, the second-round candidates and the promotion', () => {
  const p = plan({ ...EN, profile: 'general' }, { disabled: ['exa'] })
  assert.deepEqual(ids(p), ['ddg', 'bing'])
  assert.ok(!p.wanted.includes('exa'))
  assert.match(p.notes.join('\n'), /not planned: exa \(sources\.disabled\)/)
  assert.deepEqual(ids(plan({ ...ZH, profile: 'general' }, { status: withKeys('bocha'), disabled: ['bocha'] })), ['ddg', 'bing'])
  assert.deepEqual(round1(plan({ ...EN, profile: 'academic' }, { disabled: ['arxiv'] })), ['openalex', 'pubmed', 'semanticscholar'])
  // disabled beats priority
  assert.deepEqual(ids(plan({ ...EN, profile: 'general' }, { disabled: ['bing'], priority: ['bing'] })), ['exa', 'ddg'])
})

// ── sourcePolicy ─────────────────────────────────────────────────────────────

test('anonymous-only never plans a source that needs a key, account or login, even a configured one', () => {
  const zh = plan({ ...ZH, profile: 'general' }, { status: withKeys('bocha'), policy: 'anonymous-only' })
  assert.deepEqual(ids(zh), ['ddg', 'bing'])
  assert.match(zh.notes.join('\n'), /not planned: jina \(sourcePolicy anonymous-only: free-quota\)/)
  assert.ok(!zh.wanted.includes('bocha'))
  // keyed English sources are out; Exa stays while it runs keylessly, and goes once an API key makes its route a keyed one
  assert.deepEqual(ids(plan({ ...EN, profile: 'general' }, { status: withKeys('tavily', 'brave'), policy: 'anonymous-only' })), ['exa', 'ddg'])
  assert.deepEqual(ids(plan({ ...EN, profile: 'general' }, { status: withKeys('exa'), policy: 'anonymous-only' })), ['ddg', 'bing'])
  // priority cannot bring a keyed source back
  assert.deepEqual(ids(plan({ ...ZH, profile: 'general' }, { status: withKeys('bocha'), policy: 'anonymous-only', priority: ['bocha'] })), ['ddg', 'bing'])
  // the default policy changes nothing
  assert.deepEqual(ids(plan({ ...ZH, profile: 'general' }, { status: withKeys('bocha'), policy: 'default' })), ['bocha', 'ddg'])
})

test('an explicit engines list wins over priority, disabled and the policy', () => {
  const explicit = plan({ ...ZH, profile: 'general' }, { engines: ['bocha', 'exa'], status: withKeys('bocha'), disabled: ['bocha'], priority: ['ddg'], policy: 'anonymous-only' })
  assert.deepEqual(ids(explicit), ['bocha', 'exa'])
  assert.ok(!explicit.notes.some(n => /not planned|sources\.priority/.test(n)))
})

test('the policy value and the preference lists are validated: an unknown policy is refused, bad entries are dropped with a reason', () => {
  assert.equal(resolveSourcePolicy(undefined), 'default')
  assert.equal(resolveSourcePolicy('anonymous-only'), 'anonymous-only')
  assert.throws(() => resolveSourcePolicy('allow-paid'), /evidence\.sourcePolicy must be one of: default, anonymous-only/)
  assert.equal(resolveConfig({ evidence: { sourcePolicy: 'anonymous-only' } } as never).evidence.sourcePolicy, 'anonymous-only')
  assert.equal(resolveConfig({} as never).evidence.sourcePolicy, 'default')
  assert.deepEqual(resolveConfig({} as never).sources, { priority: [], disabled: [], budget: {} }, 'nothing is capped, ranked or disabled by default')
  const r = resolveSources({ priority: ['exa', 'exa', 'x y', 7 as never, 'nope'], disabled: ['exa', 'bing'] }, id => id !== 'nope')
  assert.deepEqual([r.priority, r.disabled], [['exa'], ['exa', 'bing']])
  assert.equal(r.diagnostics.length, 4)
  assert.match(r.diagnostics.join('\n'), /"nope" is not a registered source/)
  assert.match(r.diagnostics.join('\n'), /"exa" is both prioritised and disabled: disabled wins/)
  assert.deepEqual(resolveSources({ priority: 'exa' as never }).priority, [])
})

// ── pipeline and router wiring ───────────────────────────────────────────────

test('pipeline: round 1 follows the deps.sources preferences (priority order, disabled, anonymous-only)', async () => {
  const run = async (sources: PipelineDeps['sources'], status = NOTHING) => {
    const calls: ProviderCall[] = []
    const deps: PipelineDeps = {
      providerStatus: async list => new Map(list.map(id => [id, status(id)])),
      searchProvider: async (call): Promise<ProviderOutcome> => { calls.push(call); return { state: 'ok', sources: [{ url: 'https://a.test/' + call.id, title: call.id, snippet: 'postgres logical replication slot lag explained' }] } },
      fetchPage: async () => undefined, scorers: {}, configuredEngines: CONFIGURED, descriptors,
      ...sources ? { sources } : {},
      fusion: { k: 60, freshnessBoost: 0, freshnessDays: 30, authorityBoost: 0, authorityDomains: [] },
    }
    const { pack } = await runPipeline(spec({ ...EN, profile: 'general' }), deps, { maxRounds: 1 })
    return { called: calls.map(c => c.id).sort(), tried: pack.enginesTried, notes: pack.notes.join('\n') }
  }
  assert.deepEqual((await run(undefined)).tried, ['exa', 'ddg'])
  assert.deepEqual((await run({ priority: ['bing'] })).tried, ['bing', 'exa', 'ddg'])
  assert.deepEqual((await run({ disabled: ['exa'] })).called, ['bing', 'ddg'])
  const keyed = await run({ policy: 'anonymous-only' }, withKeys('tavily'))
  assert.deepEqual(keyed.called, ['ddg', 'exa'])
  assert.ok(!keyed.called.includes('tavily'))
})

function dummy(id: string): ProviderAdapter {
  const name = id.split(':')[1]!
  return {
    descriptor: { id, aliases: [name], label: 'Dummy ' + name, adapterVersion: '1', contractVersion: 1, operations: ['search'], taskProfiles: ['general'], languages: ['en'], regions: ['global'], resultKinds: ['web'], requirements: [], supportedFilters: [], costModel: { kind: 'free' }, costTier: 'anonymous' },
    probeLocal: () => ({ available: true, credential: 'not_required' }),
    create: () => ({ id: name, label: name, available: () => true, search: async () => ({ sources: [{ url: 'https://dummy.test/' + name, title: name, snippet: 'snippet of ' + name }] }) }),
  }
}

test('the configured engines list honours sources.disabled and sources.priority; an explicit engines list is left alone', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wsp-policy-'))
  try {
    const run = async (sources: object, engines?: string[]) => {
      const r = createBuiltinRegistry()
      r.register(dummy('vendor:alpha'))
      r.register(dummy('vendor:beta'))
      const config = resolveConfig({ dbPath: path.join(dir, 'store-' + Math.random() + '.db'), engines: ['alpha', 'beta'], enableCliBackends: false, opencliEnabled: false, agentReachEnabled: false, sources } as never)
      const store = new Store(config.dbPath)
      try {
        const router = new SearchRouter({ get: () => undefined } as never, config, store, undefined, undefined, undefined, r)
        return await router.search({ query: 'q ' + JSON.stringify(sources), ...engines ? { engines } : {}, count: 3, fresh: true, multi: false, signal: undefined })
      } finally { store.close() }
    }
    assert.equal((await run({})).engine, 'alpha')
    assert.equal((await run({ priority: ['beta'] })).engine, 'beta')
    assert.equal((await run({ disabled: ['alpha'] })).engine, 'beta')
    assert.equal((await run({ disabled: ['alpha'] }, ['alpha'])).engine, 'alpha', 'explicit engines win')
    await assert.rejects(() => run({ disabled: ['alpha', 'beta'] }), /every configured engine is disabled/)
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
})
