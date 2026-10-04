import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { ProviderRegistry, createBuiltinRegistry, defaultProviderRegistry, routeIdOf, SEARCH_ENGINE_IDS, type ProviderAdapter } from '../src/providers/index.ts'
import { EngineError, type Engine } from '../src/engines.ts'
import { planSources, taskLanguage, PROFILE_PROVIDERS, type ProviderStatus } from '../src/pipeline/plan.ts'
import { KEYED_SOURCE_IDS } from '../src/providers/keyed.ts'
import { runPipeline, type PipelineDeps, type ProviderCall, type ProviderOutcome } from '../src/pipeline/run.ts'
import { SearchRouter } from '../src/router.ts'
import { resolveConfig } from '../src/config.ts'
import { Store } from '../src/store.ts'
import { registerTools } from '../src/tools.ts'
import { findAction } from '../src/actions/registry.ts'
import { checkOutput } from '../src/actions/schema.ts'
import { callAction, renderResult } from './call-helper.ts'
import type { Profile, TaskSpec } from '../src/pipeline/types.ts'

const spec = (over: Partial<TaskSpec> = {}): TaskSpec => ({
  goal: 'goal', query: 'query', needs: [{ id: 'n1', text: 'goal', critical: true }], constraints: [], budget: {}, ...over,
})
const EN = { goal: 'Find how Postgres logical replication slots work', query: 'postgres logical replication slot lag' }
const ZH = { goal: '了解国内大模型备案的最新要求', query: '大模型备案 最新要求 2026' }
const CONFIGURED = ['ddg', 'bing', 'exa', 'seam', 'jina']
const ids = (plan: ReturnType<typeof planSources>): string[] => plan.providers.map(p => p.id)
const descriptors = (r: ProviderRegistry = defaultProviderRegistry) => r.list({ operation: 'search' }).map(a => a.descriptor)
/** Everything is ready except the keyed sources (dev-plan M7c), which have no key in these plan tests (the promotion with a key is in keyed-promotion.test.ts). */
const ready = (id?: string): ProviderStatus => id !== undefined && KEYED_SOURCE_IDS.includes(id) ? { state: 'unavailable', credential: 'missing', reason: 'no key' } : { state: 'ready', credential: 'configured' }

function dummy(id: string, over: Partial<ProviderAdapter['descriptor']> = {}, engine?: Partial<Engine>): ProviderAdapter {
  const descriptor = {
    id, aliases: [id.split(':')[1]!], label: 'Dummy ' + id, adapterVersion: '1', contractVersion: 1 as const, operations: ['search' as const],
    taskProfiles: ['general', 'news_fact'], languages: ['en'], regions: ['global'], resultKinds: ['web'], requirements: [], supportedFilters: [], costModel: { kind: 'free' as const }, priority: 5, ...over,
  }
  return {
    descriptor,
    probeLocal: () => ({ available: true, credential: 'configured' as const }),
    create: () => ({ id: descriptor.aliases[0]!, label: descriptor.label, available: () => true, search: async () => ({ sources: [{ url: 'https://dummy.test/' + descriptor.aliases[0], title: 'D', snippet: 's' }] }), ...engine }),
  }
}

// ── registry ─────────────────────────────────────────────────────────────────

test('registry: built-ins carry namespaced ids with the legacy short ids as aliases; both spellings resolve to one route id', () => {
  const r = createBuiltinRegistry()
  assert.deepEqual(r.searchIds(), ['seam', 'exa', 'ddg', 'bing', 'jina', 'github', 'bilibili', 'v2ex', 'youtube', 'arxiv', 'pubmed', 'github-code', 'github-issues', 'xiaohongshu', 'twitter', 'reddit', 'instagram', 'facebook', 'rss', 'zhihu', 'weibo', 'douban', 'tieba', 'douyin', 'kuaishou', 'bocha', 'wikipedia', 'hackernews', 'stackexchange', 'openalex', 'semanticscholar', 'anysearch', 'searxng', 'tavily', 'brave', 'linkup', 'serper', 'metaso', 'zhipu', 'baidu-qianfan'])
  assert.deepEqual([...SEARCH_ENGINE_IDS], r.searchIds())
  assert.equal(r.resolve('builtin:ddg'), r.resolve('ddg'))
  assert.equal(r.routeId('builtin:bocha'), 'bocha')
  assert.equal(r.routeId('bocha'), 'bocha')
  assert.equal(r.routeId('nope'), undefined)
  assert.deepEqual(r.normalize(['builtin:exa', 'ddg', 'exa', 'zzz', 'zzz']), { ids: ['exa', 'ddg'], unknown: ['zzz'] })
  for (const a of r.list()) {
    const d = a.descriptor
    assert.match(d.id, /^(builtin|platform):/)
    assert.deepEqual(d.operations, ['search'])
    assert.equal(routeIdOf(d), d.aliases[0])
    assert.ok(d.languages.length && d.taskProfiles.length && d.regions.length && d.resultKinds.length, d.id)
  }
})

test('registry: validation accepts aliases and full ids, and an unknown id gets a clear error listing the available ones', () => {
  const r = createBuiltinRegistry()
  assert.deepEqual(r.validate(['builtin:ddg', 'bocha', 'ddg']), ['ddg', 'bocha'])
  assert.throws(() => r.validate(['ddg', 'nope', 'other']), /unknown engine: nope, other \(available: seam, exa, ddg, bing, jina, github, bilibili, v2ex, youtube, arxiv, pubmed, github-code, github-issues, xiaohongshu, twitter, reddit, instagram, facebook, rss, zhihu, weibo, douban, tieba, douyin, kuaishou, bocha, wikipedia, hackernews, stackexchange, openalex, semanticscholar, anysearch, searxng, tavily, brave, linkup, serper, metaso, zhipu, baidu-qianfan\)/)
  assert.throws(() => r.validate(['  ']), /unknown engine/)
})

test('registry: a duplicate id or a taken alias throws; register returns an unregister that frees the names and is idempotent', () => {
  const r = createBuiltinRegistry()
  assert.throws(() => r.register(dummy('builtin:ddg')), /duplicate provider id: builtin:ddg/)
  assert.throws(() => r.register(dummy('vendor:other', { aliases: ['ddg'] })), /"ddg" is already used by builtin:ddg/)
  assert.throws(() => r.register(dummy('vendor:x', { aliases: ['same', 'same'] })), /duplicate alias|already used/)
  assert.throws(() => r.register(dummy('Bad Id')), /invalid provider id/)
  assert.throws(() => r.register(dummy('vendor:y', { aliases: ['a b'] })), /invalid provider alias/)
  assert.equal(r.searchIds().length, 40, 'failed registrations left nothing behind')

  const before = r.revision
  const off = r.register(dummy('vendor:acme'))
  assert.ok(r.revision > before)
  assert.equal(r.routeId('vendor:acme'), 'acme')
  assert.equal(r.routeId('acme'), 'acme')
  assert.equal(r.searchIds().at(-1), 'acme')
  assert.throws(() => r.register(dummy('vendor:acme')), /duplicate provider id/)
  off()
  off()
  assert.equal(r.resolve('acme'), undefined)
  assert.equal(r.resolve('vendor:acme'), undefined)
  assert.doesNotThrow(() => r.register(dummy('vendor:acme')), 'the id is free again')
  let notified = 0
  const stop = r.onChange(() => { notified++ })
  const off2 = r.register(dummy('vendor:beta'))
  off2()
  stop()
  r.register(dummy('vendor:gamma'))
  assert.equal(notified, 2)
})

test('descriptors state their needs as data: key env names, optional CLI fallback, filters, family, cost; unknown families stay undefined', () => {
  const r = createBuiltinRegistry()
  const d = (id: string) => r.resolve(id)!.descriptor
  assert.deepEqual(d('bocha').requirements, [{ kind: 'key', id: 'bocha-key', env: ['BOCHA_SEARCH_API_KEY', 'BOCHA_JEV_API_KEY'], note: 'a search key; the Jev key of the same account is the documented fallback' }])
  assert.deepEqual([d('bocha').languages, d('bocha').regions, d('bocha').supportedFilters, d('bocha').costModel.kind], [['zh'], ['cn'], ['site', 'exclude_site', 'time_window'], 'metered'])
  assert.equal(d('bocha').verification?.live, true, 'verified live 2026-10-04')
  assert.deepEqual([d('exa').languages, d('exa').supportedFilters], [['en'], ['site', 'exclude_site', 'time_window', 'category']])
  assert.ok(d('exa').requirements.some(q => q.kind === 'cli' && q.id === 'mcporter' && q.optional))
  assert.equal(d('ddg').sourceFamily, undefined, 'unknown is never read as independent')
  assert.equal(d('github').resultKinds[0], 'code')
})

test('probeLocal makes no network request and reports the dimensions', async () => {
  const realFetch = globalThis.fetch
  let requests = 0
  globalThis.fetch = (async () => { requests++; throw new Error('network is off') }) as typeof fetch
  try {
    const r = createBuiltinRegistry()
    const config = resolveConfig({ enableCliBackends: true } as never)
    const deps = (over: object = {}) => ({ enableCli: true, opencliEnabled: false, agentReachEnabled: false, allowProxyFakeIp: false, skipSeam: false, ...over })
    const probe = async (id: string, over: object = {}, cli?: Map<string, boolean>) => r.resolve(id)!.probeLocal({ deps: deps(over), config, cli })
    assert.deepEqual(await probe('bocha'), { available: false, installation: 'not_required', credential: 'missing', reason: 'no Bocha key (set $BOCHA_SEARCH_API_KEY or $BOCHA_JEV_API_KEY, or bochaApiKey)', diagnosticCode: 'credential_missing' })
    assert.deepEqual(await probe('bocha', { bochaApiKey: 'k' }), { available: true, installation: 'not_required', credential: 'configured' })
    assert.deepEqual(await probe('exa', { exaApiKey: 'k' }), { available: true, installation: 'not_required', credential: 'configured', costTier: 'free-quota' })
    const viaCli = await probe('exa', {}, new Map([['mcporter', true]]))
    assert.deepEqual([viaCli.available, viaCli.credential, viaCli.installation], [true, 'missing', 'detected'])
    const noCli = await probe('exa', {}, new Map([['mcporter', false]]))
    assert.deepEqual([noCli.credential, noCli.installation, noCli.diagnosticCode], ['missing', 'missing', 'cli_missing'])
    assert.equal((await probe('ddg')).available, true)
    assert.deepEqual([(await probe('bilibili', {}, new Map([['bili', false]]))).installation, (await probe('seam')).available], ['missing', false])
    assert.equal(requests, 0)
  } finally { globalThis.fetch = realFetch }
})

// ── S1 plan: language and profile ────────────────────────────────────────────

test('plan: Chinese tasks prefer Bocha, English tasks prefer Exa, ddg stays the fallback; each only when ready with a key', () => {
  const plan = (task: Partial<TaskSpec>, over: object = {}) => planSources(spec(task), { configured: CONFIGURED, status: ready, descriptors: descriptors(), ...over })
  assert.equal(taskLanguage(spec(ZH)), 'zh')
  assert.equal(taskLanguage(spec(EN)), 'en')
  assert.equal(taskLanguage(spec({ goal: '12345', query: '!!' })), undefined)

  const zh = plan({ ...ZH, profile: 'general' })
  assert.deepEqual(ids(zh), ['bocha', 'ddg'])
  assert.equal(zh.language, 'zh')
  assert.match(zh.notes.join('\n'), /language zh: preferred bocha; fallback web engines limited to ddg \(held for a second round: bing, exa, seam, jina\)/)
  assert.deepEqual(zh.wanted, ['bocha', 'ddg', 'bing', 'exa', 'seam', 'jina', 'wikipedia'], 'the follow-up round can still use the held engines, and the supplement (Wikipedia) comes last')

  const en = plan({ ...EN, profile: 'general' })
  assert.deepEqual(ids(en), ['exa', 'ddg'])
  assert.equal(en.language, 'en')

  // per profile
  const by = (profile: Profile, t = EN) => ids(plan({ ...t, profile }))
  assert.deepEqual(by('news_fact'), ['exa', 'ddg'])
  assert.deepEqual(by('news_fact', ZH as never), ['bocha', 'ddg'])
  assert.deepEqual(by('experience'), ['exa', 'ddg', 'hackernews', 'stackexchange'], 'English experience: V2EX (Chinese community) gives way to the English community sources')
  assert.deepEqual(by('experience', ZH as never), ['bocha', 'ddg', 'v2ex', 'hackernews'], 'Chinese experience: V2EX first, the English community sources last')
  assert.match(plan({ ...EN, profile: 'experience' }).notes.join('\n'), /language en: v2ex ordered last \(community source in another language\)/)
  assert.deepEqual(plan({ ...EN, profile: 'docs_code' }).wanted.slice(-1), ['stackexchange'], 'Stack Overflow is a docs_code supplement: second-round candidate, not in the plan')
  assert.ok(!ids(plan({ ...EN, profile: 'docs_code' })).includes('stackexchange'))
  assert.equal(plan({ ...EN, profile: 'news_fact' }).wanted.at(-1), 'wikipedia', 'Wikipedia supplements news_fact, it does not replace web search')
  assert.deepEqual(by('news_fact'), ['exa', 'ddg'], 'and is not in round 1')
  assert.equal(plan({ ...EN, profile: 'docs_code' }, { engines: ['ddg'] }).wanted.includes('stackexchange'), false, 'explicit engines: no supplements')
  assert.equal(plan({ ...EN, profile: 'docs_code' }, { autoProviders: false }).wanted.includes('stackexchange'), false, 'autoProviders off: no supplements')
  assert.deepEqual(by('docs_code'), ['exa', 'ddg', 'github'])
  assert.deepEqual(by('docs_code', ZH as never), ['bocha', 'ddg', 'github'])
  assert.deepEqual(by('compare'), ['exa', 'ddg', 'github'])
  assert.deepEqual(by('academic'), PROFILE_PROVIDERS.academic.slice(0, 4), 'academic keeps its own sources: neither Exa nor Bocha serves that profile')
  assert.deepEqual(by('academic', ZH as never), PROFILE_PROVIDERS.academic.slice(0, 4))

  // not ready / no key / switched off / explicit engines: the tables as before
  const status = (id: string): ProviderStatus => id === 'bocha' ? { state: 'unavailable', reason: 'no key' } : ready(id)
  assert.deepEqual(ids(plan({ ...ZH, profile: 'general' }, { status })), ['ddg', 'bing', 'exa', 'seam'])
  const mcporterOnly = (id: string): ProviderStatus => id === 'exa' ? { state: 'ready', credential: 'missing' } : ready(id)
  assert.deepEqual(ids(plan({ ...EN, profile: 'general' }, { status: mcporterOnly })), ['ddg', 'bing', 'exa', 'seam'], 'exa through the MCP fallback is not promoted')
  assert.deepEqual(ids(plan({ ...EN, profile: 'general' }, { autoProviders: false })), ['ddg', 'bing', 'exa', 'seam'])
  assert.deepEqual(ids(plan({ ...EN, profile: 'general' }, { engines: ['bing'] })), ['bing'])
  assert.deepEqual(ids(plan({ ...EN, profile: 'general' }, { descriptors: undefined })), ['ddg', 'bing', 'exa', 'seam'])
  // a cooling-down or unavailable fallback takes no slot: the next ready engine fills it
  const ddgDown = (id: string): ProviderStatus => id === 'ddg' ? { state: 'cooldown', reason: 'HTTP 429' } : ready(id)
  assert.deepEqual(ids(plan({ ...ZH, profile: 'general' }, { status: ddgDown })), ['bocha', 'bing'])
  assert.deepEqual(ids(plan({ ...ZH, profile: 'general' }, { webFallbacks: 2 })), ['bocha', 'ddg', 'bing'])
})

test('plan: a hard filter the promoted provider does not enforce natively is reported, and compilation carries the native options', () => {
  const t = spec({ ...ZH, profile: 'general', constraints: [
    { id: 'c1', kind: 'site', value: 'gov.cn', strength: 'hard', origin: 'param' },
    { id: 'c2', kind: 'exclude_term', value: '广告', strength: 'hard', origin: 'param' },
  ] })
  const plan = planSources(t, { configured: CONFIGURED, status: ready, descriptors: descriptors(), now: new Date('2026-10-02T00:00:00Z') })
  assert.match(plan.notes.join('\n'), /bocha does not enforce hard exclude_term natively: verified locally/)
  const bocha = plan.providers.find(p => p.id === 'bocha')!
  assert.deepEqual(bocha.compiled.options, { bocha: { include: ['gov.cn'] } })
  assert.deepEqual([bocha.compiled.native, bocha.compiled.local], [['c1'], ['c2']])
})

test('plan: a dummy English provider registered by descriptor + adapter alone is chosen for an English task, not a Chinese one, and respects readiness', () => {
  const registry = createBuiltinRegistry()
  const off = registry.register(dummy('vendor:nova', { priority: 5 }))
  const plan = (task: Partial<TaskSpec>, over: object = {}) => planSources(spec({ profile: 'general', ...task }), { configured: CONFIGURED, status: ready, descriptors: descriptors(registry), ...over })
  assert.deepEqual(ids(plan(EN)), ['nova', 'exa', 'ddg'], 'priority orders the promoted providers: the dummy (5) before exa (10)')
  assert.deepEqual(ids(plan(ZH)), ['bocha', 'ddg'], 'a Chinese task is untouched by an English-only provider')
  assert.deepEqual(ids(plan(EN, { status: (id: string) => id === 'nova' ? { state: 'unavailable' as const } : ready(id) })), ['exa', 'ddg'])
  assert.deepEqual(ids(plan({ ...EN, profile: 'academic' })), PROFILE_PROVIDERS.academic.slice(0, 4), 'its taskProfiles do not include academic')
  assert.equal(ids(plan({ ...EN, profile: 'news_fact' }))[0], 'nova')
  assert.equal(ids(plan({ ...EN, profile: 'docs_code' }))[0], 'exa', 'the dummy does not serve docs_code')
  // the adapter's own compile hook is used when the caller wires the registry's compiler
  const custom = registry.register({ ...dummy('vendor:fancy', { priority: 1 }), compile: (t, now) => ({ providerId: 'fancy', query: t.query + ' (fancy)', native: [], local: t.constraints.map(c => c.id) }) })
  const p = plan(EN, { descriptors: descriptors(registry), compiler: (task: TaskSpec, id: string, now: Date) => registry.resolve(id)?.compile?.(task, now) ?? { providerId: id, query: task.query, native: [], local: [] } })
  assert.equal(p.providers[0]!.id, 'fancy')
  assert.equal(p.providers[0]!.compiled.query, EN.query + ' (fancy)')
  custom()
  off()
  assert.deepEqual(ids(plan(EN, { descriptors: descriptors(registry) })), ['exa', 'ddg'], 'after unregister it is gone')
})

test('pipeline: S1 searches the promoted provider first, and the follow-up round can use the held fallbacks', async () => {
  const registry = createBuiltinRegistry()
  registry.register(dummy('vendor:nova'))
  const calls: ProviderCall[] = []
  const deps: PipelineDeps = {
    providerStatus: async idsList => new Map(idsList.map(id => [id, ready(id)])),
    searchProvider: async (call): Promise<ProviderOutcome> => { calls.push(call); return { state: 'ok', sources: [{ url: 'https://a.test/' + call.id, title: call.id, snippet: 'postgres logical replication slot lag explained' }] } },
    fetchPage: async () => undefined,
    scorers: {},
    configuredEngines: CONFIGURED,
    descriptors: descriptors(registry),
    fusion: { k: 60, freshnessBoost: 0, freshnessDays: 30, authorityBoost: 0, authorityDomains: [] },
  }
  const { pack } = await runPipeline(spec({ ...EN, profile: 'general' }), deps, { maxRounds: 1 })
  assert.deepEqual(calls.map(c => c.id).sort(), ['ddg', 'exa', 'nova'])
  assert.deepEqual(pack.enginesTried.slice(0, 1), ['nova'])
  assert.match(pack.notes.join('\n'), /language en: preferred nova, exa/)
})

// ── router: registry-driven backends, aliases, report ────────────────────────

function routerHarness(registry: ProviderRegistry, over: Record<string, unknown> = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wsp-providers-'))
  const config = resolveConfig({ dbPath: path.join(dir, 'store.db'), engines: ['acme'], enableCliBackends: false, opencliEnabled: false, agentReachEnabled: false, ...over } as never)
  const store = new Store(config.dbPath)
  const router = new SearchRouter({ get: () => undefined } as never, config, store, undefined, undefined, undefined, registry)
  return { dir, config, store, router, cleanup: () => { store.close(); fs.rmSync(dir, { recursive: true, force: true }) } }
}

test('router: a registered adapter becomes searchable, reportable and schedulable by its alias or full id; unregistering stops it', async () => {
  const registry = createBuiltinRegistry()
  const h = routerHarness(registry)
  try {
    const off = registry.register(dummy('vendor:acme'))
    for (const engines of [['acme'], ['vendor:acme']]) {
      const r = await h.router.search({ query: 'hello ' + engines[0], engines, count: 3, fresh: true, multi: false, signal: undefined })
      assert.equal(r.engine, 'acme', 'history and output use the route id')
      assert.equal(r.sources[0]!.url, 'https://dummy.test/acme')
    }
    const statuses = await h.router.providerStatuses(['vendor:acme', 'ddg', 'zzz'])
    assert.deepEqual([...statuses.keys()].sort(), ['ddg', 'vendor:acme'])
    assert.deepEqual(statuses.get('vendor:acme'), { state: 'ready', credential: 'configured', costTier: 'anonymous' })
    assert.equal((await h.router.runProvider({ id: 'vendor:acme', query: 'q', count: 3, signal: new AbortController().signal })).state, 'ok')

    const report = await h.router.providerReport()
    const acme = report.find(p => p.id === 'vendor:acme')!
    assert.deepEqual([acme.route, acme.aliases, acme.languages, acme.unverified], ['acme', ['acme'], ['en'], true])
    assert.equal(acme.readiness.health, 'ready', 'a real call succeeded in this process')
    assert.ok(acme.readiness.lastRemoteSuccess)

    off()
    assert.deepEqual([...(await h.router.providerStatuses(['acme'])).keys()], [])
    assert.ok(!(await h.router.providerReport()).some(p => p.id === 'vendor:acme'))
    const gone = await h.router.runProvider({ id: 'acme', query: 'q', count: 3, signal: new AbortController().signal })
    assert.notEqual(gone.state, 'ok')
  } finally { h.cleanup() }
})

test('router: an adapter that fails with a coded error shows health error / cooldown; auth failures mark the credential rejected', async () => {
  const registry = createBuiltinRegistry()
  registry.register(dummy('vendor:acme', {}, { search: async () => { throw new EngineError('key rejected', 'ENGINE_AUTH', false) } }))
  registry.register(dummy('vendor:busy', {}, { search: async () => { throw new EngineError('slow down', 'ENGINE_RATE_LIMIT', true, 60_000) } }))
  const h = routerHarness(registry)
  try {
    await h.router.runProvider({ id: 'acme', query: 'q', count: 3, signal: new AbortController().signal })
    await h.router.runProvider({ id: 'busy', query: 'q', count: 3, signal: new AbortController().signal })
    const report = await h.router.providerReport()
    const acme = report.find(p => p.route === 'acme')!.readiness
    assert.deepEqual([acme.health, acme.credential, acme.lastError], ['error', 'rejected', 'key rejected'])
    const busy = report.find(p => p.route === 'busy')!.readiness
    assert.equal(busy.health, 'cooldown')
    assert.ok(Date.parse(busy.cooldownUntil!) - Date.now() > 50_000, 'the service\'s Retry-After is the cooldown')
    const status = (await h.router.providerStatuses(['acme', 'busy']))
    assert.equal(status.get('busy')!.state, 'cooldown')
    assert.equal(status.get('acme')!.state, 'ready', 'a rejected key does not cool the provider down')
  } finally { h.cleanup() }
})

// ── sources.status ───────────────────────────────────────────────────────

test('sources.status: lists registry providers with readiness dimensions (optional fields) and shows the EFFECTIVE judge mode', async () => {
  const saved = { s: process.env.BOCHA_SEARCH_API_KEY, j: process.env.BOCHA_JEV_API_KEY }
  delete process.env.BOCHA_SEARCH_API_KEY
  process.env.BOCHA_JEV_API_KEY = 'jev-secret-value'
  const registry = createBuiltinRegistry()
  const h = routerHarness(registry, { evidence: { jevMode: 'hybrid', scorer: 'rule' }, engines: ['ddg'] })
  const definitions = new Map<string, any>()
  try {
    registerTools({ ctx: { tools: { register: (d: any) => definitions.set(d.name, d) } } as any, config: h.config, dynamic: () => h.config, store: h.store, router: h.router, fetch: {} as any, browser: {} as any })
    const def = findAction('sources.status')!
    const out = await callAction(definitions, 'sources.status')
    assert.deepEqual(checkOutput(def.output, out), [], 'the result fits its closed output schema')
    const bocha = out.providers.find((p: any) => p.id === 'builtin:bocha')
    assert.deepEqual([bocha.route, bocha.aliases, bocha.languages, bocha.unverified, bocha.sourceFamily], ['bocha', ['bocha'], ['zh'], undefined, undefined])
    assert.deepEqual(bocha.requirements[0].env, ['BOCHA_SEARCH_API_KEY', 'BOCHA_JEV_API_KEY'])
    assert.deepEqual([bocha.readiness.available, bocha.readiness.credential, bocha.readiness.health], [true, 'configured', 'unknown'])
    assert.ok(typeof bocha.readiness.lastLocalCheck === 'string' && bocha.readiness.lastRemoteSuccess === undefined, 'nothing was called, so nothing is claimed verified')
    const exa = out.providers.find((p: any) => p.route === 'exa')
    assert.equal(exa.readiness.credential, 'missing')
    assert.equal(out.providers.length, registry.searchIds().length)
    assert.equal(out.engines.length, registry.searchIds().length, 'the existing engines list is unchanged')
    assert.ok(!JSON.stringify(out).includes('jev-secret-value'), 'no key value anywhere')

    // closed schema: every key of every provider is declared
    const schema = def.output.properties.providers!.items as any
    for (const p of out.providers) {
      for (const key of Object.keys(p)) assert.ok(key in schema.properties, key)
      for (const key of Object.keys(p.readiness)) assert.ok(key in schema.properties.readiness.properties, key)
      for (const q of p.requirements) for (const key of Object.keys(q)) assert.ok(key in schema.properties.requirements.items.properties, key)
    }
    const text = renderResult('sources.status', out)
    assert.match(text, /provider bocha \(builtin:bocha\): installation=not_required credential=configured health=unknown · zh · general\/news_fact\/experience\/compare\/docs_code · paid(?! · \[not verified live)/)
    assert.match(text, /provider exa \(builtin:exa\): installation=\w+ credential=missing/)
    // the evidence section shows the effective mode, not "scorer rule"
    assert.equal(out.evidence.mode, 'hybrid')
    assert.match(text, /evidence: judge mode=hybrid, decides=hybrid/)
    assert.ok(!/evidence: scorer=rule/.test(text))
    assert.deepEqual([out.evidence.scorer, out.evidence.jevMode], ['rule', 'hybrid'], 'the legacy raw fields stay in the data')
  } finally {
    if (saved.s === undefined) delete process.env.BOCHA_SEARCH_API_KEY; else process.env.BOCHA_SEARCH_API_KEY = saved.s
    if (saved.j === undefined) delete process.env.BOCHA_JEV_API_KEY; else process.env.BOCHA_JEV_API_KEY = saved.j
    h.cleanup()
  }
})

test('sources.status: judge mode display covers off / shadow / control with and without scorer=jev, and a missing key falls back to rule', async () => {
  const { configuredDecider, judgeStatus } = await import('../src/pipeline/judge-status.ts')
  const cfg = (evidence: object) => resolveConfig({ evidence } as never).evidence
  assert.deepEqual(configuredDecider(cfg({})), { mode: 'off', decides: 'rule' })
  assert.equal(configuredDecider(cfg({ jevMode: 'shadow' })).decides, 'rule')
  assert.equal(configuredDecider(cfg({ jevMode: 'control' })).decides, 'rule')
  assert.match(configuredDecider(cfg({ jevMode: 'control' })).note!, /needs scorer=jev/)
  assert.equal(configuredDecider(cfg({ jevMode: 'control', scorer: 'jev' })).decides, 'model')
  assert.equal(configuredDecider(cfg({ judge: { mode: 'control' } })).decides, 'model', 'the neutral judge.mode is one explicit switch')
  assert.equal(configuredDecider(cfg({ judge: { mode: 'hybrid' }, jevMode: 'off' })).mode, 'hybrid', 'judge.mode wins over the legacy key')
  assert.match(configuredDecider(cfg({ jevMode: 'hybrid', hybridBorderline: true })).note!, /language-mismatched and borderline/)
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wsp-judge-mode-'))
  const store = new Store(path.join(dir, 'store.db'))
  try {
    const noKey = await judgeStatus(cfg({ jevMode: 'hybrid' }), store, { hasSecret: async () => false })
    assert.deepEqual([noKey.mode, noKey.decides], ['hybrid', 'rule'])
    assert.match(noKey.modeNote!, /the rule scorer decides: key not found for BOCHA_JEV_API_KEY/)
    const withKey = await judgeStatus(cfg({ jevMode: 'hybrid' }), store, { hasSecret: async () => true })
    assert.deepEqual([withKey.mode, withKey.decides], ['hybrid', 'hybrid'])
  } finally { store.close(); fs.rmSync(dir, { recursive: true, force: true }) }
})
