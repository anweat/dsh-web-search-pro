import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { registerHooks } from 'node:module'
import { validateCatalog, type CatalogEntry, type SourceCatalog } from '../src/catalog/schema.ts'
import { loadCatalog, parseCatalog, CATALOG_URL } from '../src/catalog/load.ts'
import { recommendSources, renderRecommendation, MAX_RECOMMENDATIONS, RECOMMEND_INSTRUCTION, type RecommendContext } from '../src/catalog/recommend.ts'
import { defaultProviderRegistry } from '../src/providers/index.ts'
import { PLATFORM_IDS } from '../src/providers/index.ts'
import type { ProviderStatus } from '../src/pipeline/plan.ts'
import { findAction } from '../src/actions/registry.ts'
import { checkOutput } from '../src/actions/schema.ts'
import { callAction, callEnvelope, renderResult } from './call-helper.ts'

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === '@deepseek-ai/dsh-tools') return { url: 'data:text/javascript,export const defineTool = value => value', shortCircuit: true }
    return nextResolve(specifier, context)
  },
})
const { registerTools } = await import('../src/tools.ts')
const { resolveConfig } = await import('../src/config.ts')

const catalog = loadCatalog()
const byId = (id: string): CatalogEntry => catalog.entries.find(e => e.id === id)!
const raw = (): any => JSON.parse(fs.readFileSync(CATALOG_URL, 'utf8'))

// ── schema ───────────────────────────────────────────────────────────────────

test('catalog: the shipped file validates, ids are unique, and it ships in the package', () => {
  assert.equal(validateCatalog(raw()).ok, true)
  assert.equal(catalog.version, 1)
  assert.equal(new Set(catalog.entries.map(e => e.id)).size, catalog.entries.length)
  const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
  assert.ok(pkg.files.includes('catalog'), 'package.json files includes catalog')
  assert.equal(parseCatalog(fs.readFileSync(CATALOG_URL, 'utf8')).entries.length, catalog.entries.length)
})

test('catalog: covers the built-in engines and platforms, the anonymous and paid sources, CLI tools and OpenCLI counter-examples', () => {
  for (const id of ['seam', 'exa', 'ddg', 'bing', 'jina', 'github', 'bilibili', 'youtube', 'v2ex', 'arxiv', 'pubmed', 'bocha', 'twitter', 'xiaohongshu', 'reddit', 'rss',
    'wikipedia', 'hackernews', 'stackexchange', 'openalex', 'semanticscholar', 'parallel-mcp', 'anysearch', 'searxng',
    'tavily', 'brave', 'linkup', 'serper', 'metaso', 'zhipu', 'baidu-qianfan', 'parallel', 'wx-search-cli', 'omnireach']) assert.ok(byId(id), id)
  for (const kind of ['api', 'cli', 'mcp', 'browser'] as const) assert.ok(catalog.entries.some(e => e.kind === kind), kind)
  for (const auth of ['anonymous', 'key', 'login'] as const) assert.ok(catalog.entries.some(e => e.auth === auth), auth)
  assert.equal(byId('serper').sourceFamily, 'google', 'SERP wrappers are not independent of Google')
  // OpenCLI is modelled per site and command: a site without a keyword `search` command says so.
  for (const id of ['opencli-douyin', 'opencli-xiaoyuzhou', 'opencli-toutiao', 'opencli-v2ex', 'opencli-quark']) {
    const e = byId(id)
    assert.ok(!e.operations.includes('search'), id + ' has no search operation')
    assert.ok(e.notFor.length > 0, id + ' states a counter-example')
  }
  assert.match(byId('opencli-douyin').notFor.join(' '), /no `search` command/)
  assert.ok(byId('opencli-zhihu').operations.includes('search'))
  assert.ok(byId('xiaohongshu').requires?.browser, 'needs the browser plugin')
  assert.equal(byId('xiaohongshu').auth, 'login')
})

test('catalog: provider / platform links resolve to what this plugin implements; unverified stays unverified', () => {
  const routes = new Set(defaultProviderRegistry.searchIds())
  const platforms = new Set<string>(PLATFORM_IDS)
  for (const e of catalog.entries) {
    if (e.provider) assert.ok(routes.has(e.provider), e.id + ' provider ' + e.provider)
    if (e.platform) assert.ok(platforms.has(e.platform), e.id + ' platform ' + e.platform)
    if (e.verification.status === 'verified') assert.ok(e.verification.date || e.verification.note, e.id + ' verified needs evidence')
  }
  // Every provider this plugin registers has a catalog entry (the catalog is how it is explained).
  for (const route of routes) assert.ok(catalog.entries.some(e => e.provider === route), 'catalog entry for provider ' + route)
  assert.equal(byId('bocha').verification.status, 'unverified', 'only a 403 was ever recorded live')
  assert.ok(catalog.entries.filter(e => e.verification.status === 'unverified').length > 0)
  for (const e of catalog.entries) assert.ok(!/(?:sk|key)-[a-z0-9]{12,}/i.test(JSON.stringify(e)), e.id + ' holds no secret-looking value')
})

test('catalog schema rejects malformed files: unknown fields, bad enums, duplicates, key without keyEnv, verified without evidence', () => {
  const base = (): SourceCatalog => structuredClone(raw())
  const bad = (mutate: (c: any) => void): string[] => { const c: any = base(); mutate(c); const r = validateCatalog(c); assert.equal(r.ok, false); return r.errors }
  assert.match(bad(c => { c.entries[0].extra = 1 }).join('\n'), /extra is not a catalog field/)
  assert.match(bad(c => { c.entries[0].kind = 'sdk' }).join('\n'), /kind must be/)
  assert.match(bad(c => { c.entries[1].id = c.entries[0].id }).join('\n'), /duplicate id/)
  assert.match(bad(c => { delete c.entries.find((e: any) => e.id === 'exa').keyEnv }).join('\n'), /keyEnv is required when auth is key/)
  assert.match(bad(c => { c.entries[0].verification = { status: 'verified' } }).join('\n'), /verified needs a date or a note/)
  assert.match(bad(c => { c.entries[0].profiles = ['nonsense'] }).join('\n'), /unknown value "nonsense"/)
  assert.match(bad(c => { c.entries[0].languages = ['fr'] }).join('\n'), /unknown value "fr"/)
  assert.match(bad(c => { c.version = 2 }).join('\n'), /version must be 1/)
  assert.match(bad(c => { c.entries[0].install = 'x'.repeat(400) }).join('\n'), /install must be a short/)
  assert.match(bad(c => { c.entries.find((e: any) => e.kind === 'browser').requires = {} }).join('\n'), /requires\.browser must be true/)
  assert.match(bad(c => { c.entries[0].verification.date = '02/10/2026' }).join('\n'), /YYYY-MM-DD/)
  assert.equal(validateCatalog(null).ok, false)
  assert.equal(validateCatalog({ version: 1, updated: '2026-10-02', entries: [] }).ok, false)
  assert.throws(() => parseCatalog('{'), /not valid JSON/)
  assert.throws(() => parseCatalog('{"version":1}'), /source catalog is invalid/)
})

// ── recommendations ──────────────────────────────────────────────────────────

const READY: ProviderStatus = { state: 'ready', credential: 'not_required' }
const providersOf = (over: Record<string, ProviderStatus> = {}): Map<string, ProviderStatus> => new Map(Object.entries({
  ddg: READY, bing: READY, github: READY, arxiv: READY, pubmed: READY, v2ex: READY, seam: READY,
  exa: { state: 'ready', credential: 'missing' }, jina: { state: 'unavailable', credential: 'missing', reason: 'Jina AI unavailable' },
  bocha: { state: 'unavailable', credential: 'missing', reason: 'no Bocha key' }, bilibili: { state: 'unavailable', reason: 'bili executable not found' }, youtube: { state: 'unavailable', reason: 'yt-dlp executable not found' },
  // Platforms (dev-plan M8b): the registry probe reports the missing dsh-browser; with the browser present they are runnable.
  ...Object.fromEntries(['xiaohongshu', 'reddit', 'instagram', 'facebook', 'zhihu', 'weibo', 'douban', 'tieba', 'douyin', 'kuaishou'].map(id => [id, { state: 'unavailable', reason: 'platform ' + id + ' requires the optional dsh-browser plugin' } as ProviderStatus])),
  twitter: { state: 'unavailable', reason: 'twitter command not found' }, rss: READY, 'github-code': { state: 'unavailable', credential: 'missing', reason: 'GitHub code search requires authentication' }, 'github-issues': READY,
  ...over,
}))
const ctx = (over: Partial<RecommendContext> = {}): RecommendContext => ({ catalog, providers: providersOf(), cli: new Map([['bili', false], ['yt-dlp', false], ['twitter', false]]), browser: false, hasEnv: () => false, hasConfig: () => false, ...over })
const ZH = { task: '了解国内大模型备案的最新要求', query: '大模型备案 最新要求 2026' }
const EN = { task: 'Find how Postgres logical replication slots work', query: 'postgres logical replication slot lag' }

test('recommend: never more than three suggestions, with the "don\'t fan out" instruction, for any profile and language', () => {
  assert.equal(MAX_RECOMMENDATIONS, 3)
  for (const profile of ['docs_code', 'news_fact', 'academic', 'experience', 'compare', 'general'] as const) {
    for (const language of ['zh', 'en', undefined] as const) {
      const r = recommendSources({ profile, ...language ? { language } : {} }, ctx())
      assert.ok(r.picks.length <= 3, profile + '/' + language)
      assert.equal(r.instruction, RECOMMEND_INSTRUCTION)
      assert.match(r.instruction, /do not call all sources in parallel/)
    }
  }
  assert.equal(recommendSources(EN, ctx({ limit: 99 })).picks.length <= 3, true, 'limit cannot exceed the cap')
  assert.equal(recommendSources(EN, ctx({ limit: 1 })).picks.length, 1)
})

test('recommend: ready sources come before sources that need setup or exist only in the catalog', () => {
  const r = recommendSources({ ...ZH, profile: 'news_fact' }, ctx())
  const order = r.picks.map(p => p.status)
  const rank = { ready: 0, limited: 1, needs_setup: 2, catalog_only: 3 } as const
  assert.deepEqual(order, [...order].sort((a, b) => rank[a] - rank[b]), 'sorted by readiness: ' + order.join(','))
  assert.equal(r.picks[0]!.status, 'ready')
  assert.equal(r.picks[0]!.id, 'ddg', 'the curated keyless web engine leads')
  // a reference or vertical source supplements a general web engine, it does not lead
  const docs = recommendSources({ ...EN, profile: 'docs_code' }, ctx({ providers: providersOf({ stackexchange: READY, wikipedia: READY }) }))
  assert.equal(docs.picks[0]!.id, 'ddg')
  assert.ok(docs.picks.some(p => p.id === 'stackexchange'))
})

test('recommend: catalog-only and not-ready entries are never executable and say what is missing and how to set it up', () => {
  const r = recommendSources({ ...ZH, profile: 'news_fact' }, ctx())
  const bocha = r.picks.find(p => p.id === 'bocha')!
  assert.ok(bocha, 'Chinese web search with a missing key is suggested as a setup step')
  assert.equal(bocha.executable, false)
  assert.equal(bocha.status, 'needs_setup')
  assert.deepEqual(bocha.missing, ['key: set BOCHA_SEARCH_API_KEY or BOCHA_JEV_API_KEY'])
  assert.match(bocha.setup!, /open\.bochaai\.com/)
  // an entry with no adapter at all
  const none = recommendSources({ platform: 'wx-search-cli' }, ctx()).picks[0]!
  assert.equal(none.status, 'catalog_only')
  assert.equal(none.executable, false)
  assert.ok(none.missing!.some(m => /adapter not implemented/.test(m)))
  assert.ok(none.missing!.some(m => /cli: wx-search/.test(m)))
  // whatever the readiness, executable <=> ready | limited
  for (const profile of ['docs_code', 'news_fact', 'academic', 'experience', 'compare', 'general'] as const) {
    for (const p of recommendSources({ profile, language: 'zh' }, ctx()).picks.concat(recommendSources({ profile, language: 'en' }, ctx()).picks)) {
      assert.equal(p.executable, p.status === 'ready' || p.status === 'limited', p.id)
      if (!p.executable) assert.ok(p.missing?.length && p.setup, p.id + ' explains what to do')
    }
  }
  // an unregistered adapter stays catalog-only even though the entry names a provider
  const gone = recommendSources({ ...EN, profile: 'experience' }, ctx({ providers: providersOf() })).picks
  assert.ok(gone.every(p => p.status !== 'ready' || ['ddg', 'bing', 'v2ex', 'seam', 'github-issues'].includes(p.id) || p.use.startsWith('web_search_pro engines=')))
  const missingAdapter = recommendSources({ platform: 'wikipedia' }, ctx({ providers: new Map() })).picks[0]!
  assert.equal(missingAdapter.executable, false, 'no registered adapter, no execution')
})

test('recommend: a registered provider is ready only with its readiness; a missing key makes it limited, a cooldown makes it not executable', () => {
  const exa = (providers: Map<string, ProviderStatus>): any => recommendSources({ ...EN, platform: 'exa' }, ctx({ providers })).picks.find(p => p.id === 'exa')
  assert.equal(exa(providersOf()).status, 'limited')
  assert.deepEqual(exa(providersOf()).missing, ['key: set EXA_API_KEY'])
  assert.equal(exa(providersOf({ exa: { state: 'ready', credential: 'configured' } })).status, 'ready')
  const cooling = recommendSources({ platform: 'ddg' }, ctx({ providers: providersOf({ ddg: { state: 'cooldown', reason: 'HTTP 429' } }) })).picks[0]!
  assert.equal(cooling.executable, false)
  assert.match(cooling.missing![0]!, /cooling down: HTTP 429/)
})

test('recommend: Chinese and English tasks get different sources', () => {
  const zh = recommendSources({ ...ZH, profile: 'general' }, ctx())
  const en = recommendSources({ ...EN, profile: 'general' }, ctx())
  assert.equal(zh.language, 'zh')
  assert.equal(en.language, 'en')
  const ids = (r: typeof zh): string[] => r.picks.map(p => p.id)
  assert.ok(ids(zh).includes('bocha'), 'zh: ' + ids(zh))
  assert.ok(!ids(zh).includes('exa'), 'an English-only web engine is not suggested for a Chinese task')
  assert.ok(ids(en).includes('exa') || ids(en).includes('ddg'), 'en: ' + ids(en))
  assert.ok(!ids(en).includes('bocha'), 'a Chinese-only web engine is not suggested for an English task')
  assert.ok(ids(en).some(id => ['exa', 'ddg', 'bing'].includes(id)))
  // community experience: V2EX for Chinese, vertical English sources are not required to exist yet
  const zhExp = recommendSources({ task: '想了解 Rust 在国内的实际使用口碑', profile: 'experience' }, ctx())
  assert.ok(zhExp.picks.some(p => p.id === 'v2ex'), 'zh experience: ' + zhExp.picks.map(p => p.id))
  // academic: paper indexes lead, whatever the language
  const acad = recommendSources({ task: 'survey of diffusion models', profile: 'academic' }, ctx())
  assert.equal(acad.picks[0]!.id, 'arxiv', 'a paper index leads academic tasks, not a web engine')
  assert.ok(acad.picks.some(p => p.id === 'arxiv') && acad.picks.every(p => p.status === 'ready' || p.status === 'limited'), 'paper indexes lead: ' + acad.picks.map(p => p.id))
})

test('recommend: profile is inferred from the task when absent, an explicit profile wins; at most one general web engine and one source per family', () => {
  const inferred = recommendSources({ task: 'compare Redis vs Memcached', query: 'redis versus memcached difference' }, ctx())
  assert.equal(inferred.profile, 'compare')
  assert.equal(inferred.profileInferred, true)
  assert.equal(recommendSources({ task: 'compare Redis vs Memcached', profile: 'docs_code' }, ctx()).profile, 'docs_code')
  assert.equal(recommendSources({ task: 'compare Redis vs Memcached', profile: 'docs_code' }, ctx()).profileInferred, false)
  for (const r of [recommendSources(ZH, ctx()), recommendSources(EN, ctx()), recommendSources({ ...EN, profile: 'docs_code' }, ctx())]) {
    const families = r.picks.map(p => p.sourceFamily).filter(Boolean)
    assert.equal(new Set(families).size, families.length, 'no two picks share an index family')
  }
  const docs = recommendSources({ ...EN, profile: 'docs_code' }, ctx())
  assert.ok(docs.picks.filter(p => ['exa', 'ddg', 'bing', 'seam', 'jina'].includes(p.id)).length <= 1, 'web engines are not stacked: ' + docs.picks.map(p => p.id))
  assert.ok(docs.picks.some(p => p.id === 'github'), 'a code index joins the one web engine')
})

test('recommend: platform hint narrows to that source; login-based and browser-based sources need the browser plugin', () => {
  const xhs = recommendSources({ task: '小红书 上的口碑', platform: 'xiaohongshu' }, ctx())
  assert.deepEqual(xhs.picks.map(p => p.id), ['xiaohongshu'])
  assert.equal(xhs.picks[0]!.status, 'needs_setup')
  assert.ok(xhs.picks[0]!.missing!.includes('dsh-browser plugin'))
  assert.equal(xhs.picks[0]!.use, 'search.run platform=xiaohongshu')
  const withBrowser = recommendSources({ platform: 'xiaohongshu' }, ctx({ browser: true, providers: providersOf({ xiaohongshu: READY }) })).picks[0]!
  assert.equal(withBrowser.status, 'limited', 'runnable, but the login cannot be checked')
  assert.equal(withBrowser.executable, true)
  const tw = recommendSources({ platform: 'twitter' }, ctx({ cli: new Map([['twitter', true]]), hasEnv: n => n === 'TWITTER_AUTH_TOKEN', providers: providersOf({ twitter: { state: 'unavailable', reason: 'TWITTER_CT0 is not set' } }) })).picks[0]!
  assert.deepEqual(tw.missing, ['credentials: set TWITTER_CT0'])
  const unknown = recommendSources({ ...EN, platform: 'nonesuch' }, ctx())
  assert.ok(unknown.picks.length > 0)
  assert.match(unknown.notes.join(' '), /no catalog entry for "nonesuch"/)
  // OpenCLI counter-example: reachable by hint, but it says what it cannot do
  const dy = recommendSources({ platform: 'opencli-douyin' }, ctx({ browser: true })).picks[0]!
  assert.equal(dy.executable, false)
  assert.match(dy.notFor!, /no `search` command/)
})

test('recommend: nothing fitting yields a note, and a result renders as short text with the instruction', () => {
  const none = recommendSources({ profile: 'academic', language: 'zh' }, ctx({ catalog: { ...catalog, entries: [] } as SourceCatalog }))
  assert.deepEqual(none.picks, [])
  assert.match(none.notes.join(' '), /no catalog source fits/)
  const text = renderRecommendation(recommendSources({ ...ZH, profile: 'news_fact' }, ctx()))
  assert.match(text, /^Recommended sources for profile news_fact, language zh:/)
  assert.match(text, /use: search.run engines=ddg/)
  assert.match(text, /missing: key: set BOCHA_SEARCH_API_KEY/)
  assert.ok(text.endsWith(RECOMMEND_INSTRUCTION))
  assert.ok(text.length < 2200, 'recommendation text stays small: ' + text.length)
})

// ── the tool action ──────────────────────────────────────────────────────────

test('search.recommend returns the recommendation from registry readiness; unknown profiles and languages are rejected', async () => {
  const config = resolveConfig({ dbPath: '/tmp/unused.db' } as never)
  const defs = new Map<string, any>()
  const router = {
    providerStatuses: async (ids: string[]) => new Map(ids.filter(id => providersOf().has(id)).map(id => [id, providersOf().get(id)!])),
    resolveSecret: async (name: string) => (name === 'BOCHA_SEARCH_API_KEY' ? 'k' : undefined),
  }
  registerTools({ ctx: { tools: { register: (d: any) => defs.set(d.name, d) } } as any, config, dynamic: () => config, store: {} as any, router: router as any, fetch: {} as any })
  const action = findAction('search.recommend')!
  assert.ok(action.params.task && action.params.profile && action.params.query && action.params.language && action.params.platform, 'recommend inputs are documented parameters')
  const out = await callAction(defs, 'search.recommend', { task: ZH.task, query: ZH.query, profile: 'news_fact' })
  assert.ok(out.picks.length <= 3)
  assert.equal(out.language, 'zh')
  // the key resolves through the credentials / environment resolver: bocha is then looked at as configured (but its probe still decides)
  assert.match(renderResult('search.recommend', out), /Recommended sources for profile news_fact/)
  assert.equal(out.engines, undefined, 'recommend carries no engine diagnostics')
  assert.deepEqual(checkOutput(action.output, out), [], 'the result fits its closed output schema')
  await assert.rejects(() => callAction(defs, 'search.recommend', { profile: 'weird' }), /profile must be one of/)
  await assert.rejects(() => callAction(defs, 'search.recommend', { language: 'fr' }), /language must be zh or en/)
  const bad = await callEnvelope(defs, 'search.recommend', { profile: 'weird' })
  assert.equal(bad.error.code, 'INVALID_ARGS')
  assert.match(bad.error.schema, /^search\.recommend\(/)
})
