import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { validateCatalog, COST_TIERS as CATALOG_TIERS } from '../src/catalog/schema.ts'
import { loadCatalog, CATALOG_URL } from '../src/catalog/load.ts'
import { recommendSources, renderRecommendation } from '../src/catalog/recommend.ts'
import { createBuiltinRegistry, COST_TIERS, costTierOf, routeIdOf } from '../src/providers/index.ts'
import { resolveConfig } from '../src/config.ts'
import type { ProviderStatus } from '../src/pipeline/plan.ts'

const registry = createBuiltinRegistry()
const catalog = loadCatalog()
const raw = (): any => JSON.parse(fs.readFileSync(CATALOG_URL, 'utf8'))

/** The tier of every built-in provider (route id). `free-quota` rows cite the pricing page in the descriptor / catalog `cost` note. */
const EXPECTED: Record<string, string> = {
  seam: 'anonymous', exa: 'anonymous', ddg: 'anonymous', bing: 'anonymous', github: 'anonymous', bilibili: 'anonymous', v2ex: 'anonymous', youtube: 'anonymous', arxiv: 'anonymous', pubmed: 'anonymous',
  'github-issues': 'anonymous', rss: 'anonymous', wikipedia: 'anonymous', hackernews: 'anonymous', stackexchange: 'anonymous', openalex: 'anonymous', semanticscholar: 'anonymous', anysearch: 'anonymous', searxng: 'anonymous',
  jina: 'free-quota', 'github-code': 'free-quota', tavily: 'free-quota', brave: 'free-quota', linkup: 'free-quota', serper: 'free-quota', 'baidu-qianfan': 'free-quota',
  xiaohongshu: 'free-quota', twitter: 'free-quota', reddit: 'free-quota', instagram: 'free-quota', facebook: 'free-quota', zhihu: 'free-quota', weibo: 'free-quota', douban: 'free-quota', tieba: 'free-quota', douyin: 'free-quota', kuaishou: 'free-quota',
  bocha: 'paid', metaso: 'paid', zhipu: 'paid',
}

test('cost tiers: every built-in provider states its tier explicitly and the table matches the plan', () => {
  assert.deepEqual([...COST_TIERS], ['anonymous', 'free-quota', 'paid'])
  assert.deepEqual([...CATALOG_TIERS], [...COST_TIERS], 'registry and catalog use the same words')
  const routes = registry.searchIds()
  for (const a of registry.list({ operation: 'search' })) {
    const route = routeIdOf(a.descriptor)
    assert.ok(COST_TIERS.includes(a.descriptor.costTier!), route + ' sets costTier')
    assert.equal(costTierOf(a.descriptor), EXPECTED[route], route)
  }
  assert.deepEqual(routes.filter(r => !(r in EXPECTED)), [], 'every built-in provider is in the tier table')
})

test('cost tiers: without an explicit tier it is derived from the cost model (free = anonymous, anything else paid)', () => {
  assert.equal(costTierOf({ costModel: { kind: 'free' } }), 'anonymous')
  assert.equal(costTierOf({ costModel: { kind: 'metered' } }), 'paid')
  assert.equal(costTierOf({ costModel: { kind: 'unknown' } }), 'paid')
  assert.equal(costTierOf({ costModel: { kind: 'metered' }, costTier: 'free-quota' }), 'free-quota')
})

test('cost tiers: Exa reports the tier of the route that would run (keyless MCP: anonymous, API key: free-quota); nothing else changes tier', async () => {
  const config = resolveConfig({ enableCliBackends: true } as never)
  const probe = async (id: string, deps: object, cli?: Map<string, boolean>) => registry.resolve(id)!.probeLocal({ deps: { enableCli: true, opencliEnabled: false, agentReachEnabled: false, allowProxyFakeIp: false, skipSeam: false, ...deps }, config, cli })
  const keyless = await probe('exa', {}, new Map([['mcporter', true]]))
  assert.deepEqual([keyless.costTier, keyless.keyless, keyless.credential], ['anonymous', true, 'missing'])
  const keyed = await probe('exa', { exaApiKey: 'k' })
  assert.deepEqual([keyed.costTier, keyed.keyless, keyed.credential], ['free-quota', undefined, 'configured'])
  assert.equal((await probe('exa', {}, new Map([['mcporter', false]]))).keyless, undefined, 'mcporter known missing: no keyless route')
  assert.equal((await probe('exa', { enableCli: false })).keyless, undefined, 'CLI backends off: no keyless route')
  assert.equal((await probe('ddg', {})).costTier, undefined, 'single-route providers use the descriptor tier')
})

test('catalog tiers: every entry has a valid tier, the schema rejects a missing or unknown one, and provider-linked entries agree with the registry', () => {
  const entries = catalog.entries
  assert.ok(entries.every(e => (COST_TIERS as readonly string[]).includes(e.costTier)))
  for (const tier of COST_TIERS) assert.ok(entries.some(e => e.costTier === tier), 'some entry is ' + tier)
  for (const e of entries) {
    if (!e.provider) continue
    const d = registry.resolve(e.provider)!.descriptor
    assert.equal(e.costTier, costTierOf(d), e.id + ' tier = descriptor tier')
  }
  // keyed sources whose tier is a verdict from a pricing page cite it
  for (const e of entries.filter(x => x.auth === 'key' && x.costTier !== 'anonymous')) assert.match(e.cost, /^(free-quota|paid):/, e.id + ' cost note says which verdict it is')
  for (const e of entries.filter(x => x.auth === 'key' && x.costTier === 'free-quota')) assert.match(e.cost, /https?:\/\/|docs\.|2026-/, e.id + ' cites its pricing page')
  const bad = (mutate: (c: any) => void): string => { const c = raw(); mutate(c); const r = validateCatalog(c); assert.equal(r.ok, false); return r.errors.join('\n') }
  assert.match(bad(c => { delete c.entries[0].costTier }), /costTier must be one of anonymous\|free-quota\|paid/)
  assert.match(bad(c => { c.entries[0].costTier = 'free' }), /costTier must be one of/)
})

const READY: ProviderStatus = { state: 'ready', credential: 'not_required' }
const providers = (over: Record<string, ProviderStatus> = {}): Map<string, ProviderStatus> => new Map(Object.entries({
  ddg: READY, bing: READY, seam: READY, exa: { state: 'ready', credential: 'missing', keyless: true, costTier: 'anonymous' },
  jina: { state: 'unavailable', credential: 'missing', reason: 'no key' }, bocha: { state: 'unavailable', credential: 'missing', reason: 'no key' },
  tavily: { state: 'unavailable', credential: 'missing', reason: 'no key' }, zhipu: { state: 'unavailable', credential: 'missing', reason: 'no key' }, metaso: { state: 'unavailable', credential: 'missing', reason: 'no key' },
  baidu: { state: 'unavailable', credential: 'missing', reason: 'no key' }, 'baidu-qianfan': { state: 'unavailable', credential: 'missing', reason: 'no key' }, ...over,
}))
const ctx = (over: object = {}) => ({ catalog, providers: providers(), cli: new Map<string, boolean>(), browser: false, hasEnv: () => false, hasConfig: () => false, ...over })

test('recommend: Exa over its keyless route is ready and anonymous; among sources still to set up the free ones come first and paid ones last, each with its tier', () => {
  const en = recommendSources({ task: 'how does postgres vacuum work', language: 'en', profile: 'general' }, ctx())
  const exa = en.picks.find(p => p.id === 'exa')!
  assert.equal(exa.status, 'ready')
  assert.equal(exa.costTier, 'anonymous')
  assert.equal(exa.missing, undefined, 'the keyless route needs nothing')
  const zh = recommendSources({ task: '了解国内大模型备案的最新要求', language: 'zh', profile: 'news_fact' }, ctx({ limit: 3 }))
  const setup = zh.picks.filter(p => p.status === 'needs_setup')
  const order = { anonymous: 0, 'free-quota': 1, paid: 2 } as const
  assert.deepEqual(setup.map(p => order[p.costTier]), setup.map(p => order[p.costTier]).sort(), 'setup suggestions sorted free before paid')
  // with all the Chinese keyed sources unconfigured the only ones offered carry their tier in the text
  const wide = recommendSources({ task: '了解国内大模型备案的最新要求', language: 'zh', profile: 'news_fact' }, ctx())
  assert.match(renderRecommendation(wide), /\[ddg\] ready, anonymous/)
  // a CONFIGURED paid source is the user's choice: it is ready and keeps its fit rank
  const configured = recommendSources({ task: '了解国内大模型备案的最新要求', language: 'zh', profile: 'news_fact' }, ctx({ providers: providers({ bocha: { state: 'ready', credential: 'configured' } }) }))
  const bocha = configured.picks.find(p => p.id === 'bocha')!
  assert.equal(bocha.status, 'ready')
  assert.equal(bocha.costTier, 'paid')
})

test('recommend honours the user\'s sources.priority (ready sources lead in the listed order) and sources.disabled (never recommended)', () => {
  const en = { task: 'how does postgres vacuum work', language: 'en' as const, profile: 'general' as const }
  const all = providers({ tavily: { state: 'ready', credential: 'configured' } })
  const ids = (r: ReturnType<typeof recommendSources>): string[] => r.picks.map(p => p.id)
  assert.equal(ids(recommendSources(en, ctx({ providers: all })))[0], 'tavily', 'a source the user configured a key for leads the keyless ones, as in the plan')
  assert.equal(ids(recommendSources(en, ctx()))[0], 'exa', 'nothing configured: the keyless Exa leads English')
  const ranked = recommendSources(en, ctx({ providers: all, priority: ['bing'] }))
  assert.equal(ranked.picks[0]!.id, 'bing', 'the user\'s ranking leads')
  const disabled = recommendSources(en, ctx({ providers: all, disabled: ['exa', 'ddg'] }))
  assert.ok(!ids(disabled).includes('exa') && !ids(disabled).includes('ddg'))
  // a priority entry that cannot run now does not jump the queue
  const notReady = recommendSources(en, ctx({ priority: ['jina'] }))
  assert.notEqual(notReady.picks[0]!.id, 'jina')
})
