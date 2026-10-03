import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { SearchRouter } from '../src/router.ts'
import { resolveConfig } from '../src/config.ts'
import { Store } from '../src/store.ts'
import { createBuiltinRegistry, defaultProviderRegistry, type ProviderAdapter } from '../src/providers/index.ts'
import { KEYED_SOURCE_ENVS, KEYED_SOURCE_IDS } from '../src/providers/keyed.ts'
import { compileQuery } from '../src/pipeline/compile.ts'
import { planSources, DEFAULT_MAX_PROMOTED, type ProviderStatus } from '../src/pipeline/plan.ts'
import { runPipeline, type PipelineDeps, type ProviderCall, type ProviderOutcome } from '../src/pipeline/run.ts'
import { recommendSources, renderRecommendation } from '../src/catalog/recommend.ts'
import { loadCatalog } from '../src/catalog/load.ts'
import type { TaskSpec } from '../src/pipeline/types.ts'

const spec = (over: Partial<TaskSpec> = {}): TaskSpec => ({ goal: 'goal', query: 'query', needs: [{ id: 'n1', text: 'goal', critical: true }], constraints: [], budget: {}, ...over })
const EN = { goal: 'Find how Postgres logical replication slots work', query: 'postgres logical replication slot lag' }
const ZH = { goal: '了解国内大模型备案的最新要求', query: '大模型备案 最新要求 2026' }
const CONFIGURED = ['ddg', 'bing', 'exa', 'seam', 'jina']
const ids = (plan: ReturnType<typeof planSources>): string[] => plan.providers.map(p => p.id)
const descriptors = (r = defaultProviderRegistry) => r.list({ operation: 'search' }).map(a => a.descriptor)

/** Everything is ready, except exa (MCP fallback only) and the keyed sources named in `keys`, which are the ones WITH a key. */
const statusWith = (keys: string[]) => (id: string): ProviderStatus => {
  if (id === 'exa' || id === 'bocha') return keys.includes(id) ? { state: 'ready', credential: 'configured' } : { state: 'unavailable', credential: 'missing', reason: 'no key' }
  if (KEYED_SOURCE_IDS.includes(id)) return keys.includes(id) ? { state: 'ready', credential: 'configured' } : { state: 'unavailable', credential: 'missing', reason: 'no key' }
  return { state: 'ready', credential: 'not_required' }
}
/** The registry's own compilers, as the pipeline service wires them. */
const compiler = (task: TaskSpec, id: string, now: Date) => defaultProviderRegistry.resolve(id)?.compile?.(task, now) ?? compileQuery(task, id, now)
const plan = (task: object, keys: string[], over: object = {}) => planSources(spec(task), { configured: CONFIGURED, status: statusWith(keys), descriptors: descriptors(), compiler, ...over })

test('promotion: a keyed English source is planned ahead of the web table for English tasks only once it has a key', () => {
  const none = ids(plan({ ...EN, profile: 'general' }, []))
  assert.ok(!none.some(id => KEYED_SOURCE_IDS.includes(id)), 'a keyed source without a key is never planned: ' + none)
  assert.deepEqual(none.slice(0, 2), ['ddg', 'bing'], 'no key: the table as before')
  const withTavily = plan({ ...EN, profile: 'general' }, ['tavily'])
  assert.deepEqual(ids(withTavily).slice(0, 2), ['tavily', 'ddg'])
  assert.match(withTavily.notes.join('\n'), /language en: preferred tavily/)
  // priority: below Exa when Exa has a key, first when it has none
  assert.deepEqual(ids(plan({ ...EN, profile: 'general' }, ['exa', 'tavily'])).slice(0, 2), ['exa', 'tavily'], 'exa (10) before tavily (20)')
  assert.equal(ids(plan({ ...EN, profile: 'general' }, ['brave', 'tavily']))[0], 'tavily', 'tavily 20 before brave 30')
  // never for the wrong language or a profile the source does not serve
  for (const key of ['tavily', 'brave', 'linkup', 'serper']) {
    assert.ok(!ids(plan({ ...ZH, profile: 'general' }, [key])).includes(key), key + ' is not promoted for a Chinese task')
    assert.ok(!ids(plan({ ...EN, profile: 'academic' }, [key])).includes(key), key + ' does not serve academic')
  }
  // explicit engines and autoProviders: false switch promotion off
  assert.deepEqual(ids(plan({ ...EN, profile: 'general' }, ['tavily'], { engines: ['ddg'] })), ['ddg'])
  assert.ok(!ids(plan({ ...EN, profile: 'general' }, ['tavily'], { autoProviders: false })).includes('tavily'))
})

test('promotion: Chinese keyed sources serve Chinese tasks below Bocha; English keyed sources are not offered for them', () => {
  const onlyMetaso = plan({ ...ZH, profile: 'general' }, ['metaso'])
  assert.deepEqual(ids(onlyMetaso).slice(0, 2), ['metaso', 'ddg'], 'no Bocha key: Metaso leads')
  assert.deepEqual(ids(plan({ ...ZH, profile: 'general' }, ['bocha', 'metaso'])).slice(0, 2), ['bocha', 'metaso'], 'Bocha (10) then Metaso (20)')
  assert.deepEqual(ids(plan({ ...ZH, profile: 'news_fact' }, ['zhipu', 'baidu-qianfan'])).slice(0, 2), ['zhipu', 'baidu-qianfan'], 'zhipu 30 before baidu 40')
  assert.ok(!ids(plan({ ...EN, profile: 'general' }, ['metaso', 'zhipu', 'baidu-qianfan'])).some(id => ['metaso', 'zhipu', 'baidu-qianfan'].includes(id)), 'not for English tasks')
  assert.ok(!ids(plan({ ...ZH, profile: 'academic' }, ['metaso'])).includes('metaso'))
})

test('promotion: at most two sources are promoted, so round 1 keeps a free engine and never exceeds three; the surplus waits for round 2', () => {
  assert.equal(DEFAULT_MAX_PROMOTED, 2)
  const all = plan({ ...EN, profile: 'general' }, ['exa', 'tavily', 'brave', 'linkup', 'serper'])
  assert.deepEqual(ids(all).slice(0, 3), ['exa', 'tavily', 'ddg'], 'two promoted and one free fallback: exa, tavily, ddg')
  assert.match(all.notes.join('\n'), /also ready for a second round: brave, linkup, serper/)
  assert.ok(['brave', 'linkup', 'serper'].every(id => all.wanted.includes(id)), 'the surplus is still wanted for round 2')
  const zh = plan({ ...ZH, profile: 'general' }, ['bocha', 'metaso', 'zhipu', 'baidu-qianfan'])
  assert.deepEqual(ids(zh).slice(0, 3), ['bocha', 'metaso', 'ddg'])
  assert.ok(['zhipu', 'baidu-qianfan'].every(id => zh.wanted.includes(id)))
  assert.equal(plan({ ...EN, profile: 'general' }, ['tavily', 'brave', 'linkup'], { maxPromoted: 3 }).providers[2]!.id, 'linkup', 'configurable')
})

test('promotion: sources of one index family count once — Serper (google) does not stack with another Google wrapper, and a hard filter it cannot enforce is reported', () => {
  const registry = createBuiltinRegistry()
  const wrapper = registry.list().find(a => a.descriptor.id === 'builtin:serper')!
  const google2: ProviderAdapter = { ...wrapper, descriptor: { ...wrapper.descriptor, id: 'vendor:serpapi', aliases: ['serpapi'], label: 'SerpApi', priority: 25 } }
  registry.register(google2)
  const p = plan({ ...EN, profile: 'general' }, ['serper', 'serpapi'], { descriptors: descriptors(registry), status: (id: string) => id === 'serpapi' ? { state: 'ready' as const, credential: 'configured' as const } : statusWith(['serper'])(id) })
  assert.deepEqual(ids(p).slice(0, 2), ['serpapi', 'ddg'], 'one google source in round 1')
  assert.match(p.notes.join('\n'), /also ready for a second round: serper/)
  const t = plan({ ...EN, profile: 'general', constraints: [{ id: 'c1', kind: 'time_window', value: 'past 30 days', strength: 'hard', origin: 'param' }] }, ['serper'], { now: new Date('2026-10-02T00:00:00Z') })
  assert.match(t.notes.join('\n'), /serper does not enforce hard time_window natively: verified locally/)
  assert.ok(t.providers.find(x => x.id === 'serper')!.compiled.local.includes('c1'))
  const tav = plan({ ...EN, profile: 'general', constraints: [{ id: 'c1', kind: 'site', value: 'postgresql.org', strength: 'hard', origin: 'param' }] }, ['tavily'], { now: new Date('2026-10-02T00:00:00Z') })
  assert.deepEqual(tav.providers[0]!.compiled.options, { sites: { include: ['postgresql.org'] } })
})

test('pipeline: round 1 queries at most three providers even with every key configured, keyed ones first', async () => {
  const calls: ProviderCall[] = []
  const status = statusWith(['exa', 'tavily', 'brave', 'linkup', 'serper', 'bocha', 'metaso'])
  const deps: PipelineDeps = {
    providerStatus: async list => new Map(list.map(id => [id, status(id)])),
    searchProvider: async (call): Promise<ProviderOutcome> => { calls.push(call); return { state: 'ok', sources: [{ url: 'https://a.test/' + call.id, title: call.id, snippet: 'postgres logical replication slot lag explained' }] } },
    fetchPage: async () => undefined,
    scorers: {},
    configuredEngines: CONFIGURED,
    descriptors: descriptors(),
    fusion: { k: 60, freshnessBoost: 0, freshnessDays: 30, authorityBoost: 0, authorityDomains: [] },
  }
  const { pack } = await runPipeline(spec({ ...EN, profile: 'general' }), deps, { maxRounds: 2 })
  const round1 = calls.slice(0, 3).map(c => c.id)
  assert.deepEqual(round1, ['exa', 'tavily', 'ddg'].sort((a, b) => round1.indexOf(a) - round1.indexOf(b)), 'the first three queries: ' + round1)
  assert.deepEqual([...pack.enginesTried].slice(0, 2), ['exa', 'tavily'])
  assert.ok(!calls.slice(0, 3).some(c => ['brave', 'linkup', 'serper'].includes(c.id)), 'the surplus is not queried in round 1')
})

test('router: keys from the environment make a keyed source ready and plannable; without them it reports credential missing', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wsp-keyed-plan-'))
  const names = Object.values(KEYED_SOURCE_ENVS).flat()
  const saved = Object.fromEntries(names.map(n => [n, process.env[n]]))
  for (const n of names) delete process.env[n]
  const store = new Store(path.join(dir, 'store.db'))
  try {
    const cfg = resolveConfig({ dbPath: path.join(dir, 'store.db'), enableCliBackends: false, opencliEnabled: false, agentReachEnabled: false } as never)
    const router = new SearchRouter({ get: () => undefined } as never, cfg, store)
    const off = await router.providerStatuses([...KEYED_SOURCE_IDS])
    for (const id of KEYED_SOURCE_IDS) assert.deepEqual([off.get(id)?.state, off.get(id)?.credential], ['unavailable', 'missing'], id)
    assert.deepEqual(ids(planSources(spec({ ...EN, profile: 'general' }), { configured: CONFIGURED, status: id => off.get(id), descriptors: descriptors() })).filter(id => KEYED_SOURCE_IDS.includes(id)), [])

    process.env.TAVILY_API_KEY = 'env-tavily-key'
    process.env.QIANFAN_API_KEY = 'env-qianfan-key'
    process.env.BAIDU_API_KEY = ''
    const on = await router.providerStatuses([...KEYED_SOURCE_IDS, 'ddg', 'bing', 'exa'])
    assert.deepEqual([on.get('tavily')?.state, on.get('tavily')?.credential], ['ready', 'configured'])
    assert.equal(on.get('brave')?.state, 'unavailable')
    const en = planSources(spec({ ...EN, profile: 'general' }), { configured: CONFIGURED, status: id => on.get(id), descriptors: descriptors() })
    assert.equal(ids(en)[0], 'tavily')
    const zh = planSources(spec({ ...ZH, profile: 'general' }), { configured: CONFIGURED, status: id => on.get(id), descriptors: descriptors() })
    assert.equal(ids(zh)[0], 'baidu-qianfan', 'QIANFAN_API_KEY')
    delete process.env.QIANFAN_API_KEY
    process.env.BAIDU_API_KEY = 'env-baidu-fallback'
    assert.equal((await router.providerStatuses(['baidu-qianfan'])).get('baidu-qianfan')?.state, 'ready', 'the second documented name works too')
  } finally {
    for (const [n, v] of Object.entries(saved)) { if (v === undefined) delete process.env[n]; else process.env[n] = v }
    store.close()
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

// ── recommendations ──────────────────────────────────────────────────────────

const catalog = loadCatalog()
const READY: ProviderStatus = { state: 'ready', credential: 'not_required' }
const providers = (keys: string[] = []): Map<string, ProviderStatus> => new Map([
  ['ddg', READY], ['bing', READY], ['github', READY], ['wikipedia', READY], ['stackexchange', READY], ['seam', READY],
  ['exa', { state: 'ready', credential: 'missing' } as ProviderStatus], ['bocha', { state: 'unavailable', credential: 'missing', reason: 'no Bocha key' } as ProviderStatus],
  ...KEYED_SOURCE_IDS.map(id => [id, keys.includes(id) ? { state: 'ready', credential: 'configured' } : { state: 'unavailable', credential: 'missing', reason: 'no key' }] as [string, ProviderStatus]),
])
const ctx = (keys: string[] = [], over: object = {}) => ({ catalog, providers: providers(keys), cli: new Map<string, boolean>(), browser: false, hasEnv: () => false, hasConfig: () => false, ...over })

test('recommend: a keyed source without a key is a setup step — never executable — and shows the variable and how to configure it', () => {
  for (const [task, wantsOneOf] of [[EN, ['tavily', 'brave', 'linkup', 'serper']], [ZH, ['metaso', 'zhipu', 'baidu-qianfan', 'bocha']]] as const) {
    const r = recommendSources({ ...task, profile: 'general' }, ctx())
    assert.ok(r.picks.length <= 3)
    const keyed = r.picks.filter(p => KEYED_SOURCE_IDS.includes(p.id) || p.id === 'bocha')
    assert.ok(keyed.some(p => wantsOneOf.includes(p.id as never)), 'a keyed upgrade is suggested: ' + r.picks.map(p => p.id))
    for (const p of keyed) {
      assert.equal(p.executable, false, p.id)
      assert.equal(p.status, 'needs_setup', p.id)
      assert.match(p.missing![0]!, /^key: set [A-Z_]+/)
      assert.match(p.setup!, /Inactive until a key is set|open\.bochaai\.com/)
    }
    assert.equal(r.picks[0]!.status, 'ready', 'a ready keyless engine still leads')
  }
  const text = renderRecommendation(recommendSources({ ...EN, profile: 'general' }, ctx()))
  assert.match(text, /missing: key: set (TAVILY_API_KEY|BRAVE_API_KEY|LINKUP_API_KEY|SERPER_API_KEY)/)
  assert.match(text, /unverified/, 'the unverified status is shown')
})

test('recommend: with a key the keyed source is ready and executable (still marked unverified); a Google wrapper does not share a pick with another google source', () => {
  const r = recommendSources({ ...EN, profile: 'general' }, ctx(['tavily']))
  const tavily = r.picks.find(p => p.id === 'tavily')!
  assert.deepEqual([tavily.status, tavily.executable, tavily.verified], ['ready', true, false])
  assert.equal(tavily.use, 'web_search_pro engines=tavily')
  assert.equal(r.picks[0]!.id, 'tavily', 'a ready web engine leads')
  const serper = recommendSources({ platform: 'serper' }, ctx(['serper'])).picks[0]!
  assert.equal(serper.sourceFamily, 'google')
  for (const keys of [[], ['serper'], ['tavily', 'brave', 'linkup', 'serper']]) {
    for (const t of [EN, ZH]) {
      const families = recommendSources({ ...t, profile: 'general' }, ctx(keys)).picks.map(p => p.sourceFamily).filter(Boolean)
      assert.equal(new Set(families).size, families.length, 'one source per family: ' + families)
    }
  }
})
