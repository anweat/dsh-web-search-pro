import test from 'node:test'
import assert from 'node:assert/strict'
import { planSources, PROFILE_PROVIDERS, type ProviderStatus } from '../src/pipeline/plan.ts'
import { createBuiltinRegistry, routeIdOf } from '../src/providers/index.ts'
import { recommendSources, type RecommendContext } from '../src/catalog/recommend.ts'
import { loadCatalog } from '../src/catalog/load.ts'
import type { Profile, TaskSpec } from '../src/pipeline/types.ts'

const spec = (over: Partial<TaskSpec> = {}): TaskSpec => ({
  goal: 'goal', query: 'rust async runtime', needs: [{ id: 'n1', text: 'goal', critical: true }], constraints: [], budget: {}, ...over,
})
const site = (value: string, strength: 'hard' | 'soft' = 'hard') => ({ id: 'c1', kind: 'site' as const, value, strength, origin: 'param' as const })
const registry = createBuiltinRegistry()
const descriptors = registry.list({ operation: 'search' }).map(a => a.descriptor)
const PLATFORMS = descriptors.filter(d => d.kind === 'platform').map(routeIdOf)
const CONFIGURED = ['ddg', 'bing', 'exa', 'seam', 'jina']
// Everything is ready except the keyed web sources (no key in these plan tests), so the free engines make the plan.
const KEYED = ['exa', 'bocha', 'jina', 'tavily', 'brave', 'linkup', 'serper', 'metaso', 'zhipu', 'baidu-qianfan']
const ready = (id?: string): ProviderStatus => (id !== undefined && KEYED.includes(id) ? { state: 'unavailable', credential: 'missing', reason: 'no key' } : { state: 'ready', credential: 'configured' })
const ids = (plan: ReturnType<typeof planSources>): string[] => plan.providers.map(p => p.id)
const base = { configured: CONFIGURED, descriptors, status: ready }

test('plan: platforms are never planned on their own, for any profile or language', () => {
  const NEW_PLATFORMS = PLATFORMS.filter(id => !Object.values(PROFILE_PROVIDERS).flat().includes(id))
  assert.ok(NEW_PLATFORMS.includes('zhihu') && NEW_PLATFORMS.includes('twitter') && NEW_PLATFORMS.includes('xiaohongshu'))
  for (const profile of ['docs_code', 'news_fact', 'academic', 'experience', 'compare', 'general'] as Profile[]) {
    for (const query of ['rust async runtime', '小红书 知乎 微博 口碑 怎么样', 'twitter reddit instagram reviews']) {
      const plan = planSources(spec({ profile, query, goal: query }), base)
      assert.deepEqual(plan.providers.filter(p => NEW_PLATFORMS.includes(p.id)), [], profile + ' / ' + query)
      assert.deepEqual(plan.wanted.filter(id => NEW_PLATFORMS.includes(id)), [], 'not even held for round 2: ' + profile)
    }
  }
})

test('plan: a hard site constraint on a platform domain puts the ready platform first and keeps ONE web engine as fallback', () => {
  const plan = planSources(spec({ profile: 'experience', constraints: [site('zhihu.com')] }), base)
  assert.deepEqual(ids(plan), ['zhihu', 'ddg'])
  assert.match(plan.notes.join('\n'), /site zhihu\.com: platform zhihu first, ddg kept as the web fallback; held for a second round: bing, /)
  assert.ok(plan.wanted.includes('bing') && plan.wanted.includes('v2ex'), 'the rest waits for round 2')
  // The URL form, a subdomain and www all name the platform.
  for (const value of ['https://www.zhihu.com/question/1', 'zhuanlan.zhihu.com', 'site:zhihu.com']) {
    assert.deepEqual(ids(planSources(spec({ profile: 'general', constraints: [site(value)] }), base)), ['zhihu', 'ddg'], value)
  }
  // The fallback engine compiles the site operator; the platform gets the plain query.
  const compiled = Object.fromEntries(plan.providers.map(p => [p.id, p.compiled.query]))
  assert.equal(compiled.zhihu, 'rust async runtime')
  assert.equal(compiled.ddg, 'rust async runtime site:zhihu.com')
  // twitter has two domains; github (a table member) is moved to the front too.
  assert.deepEqual(ids(planSources(spec({ profile: 'news_fact', constraints: [site('x.com')] }), base)), ['twitter', 'ddg'])
  assert.deepEqual(ids(planSources(spec({ profile: 'docs_code', constraints: [site('github.com')] }), base)).slice(0, 2), ['github', 'ddg'])
})

test('plan: a soft site, a broader domain, an explicit source list or a platform that is not ready change nothing', () => {
  const plain = ids(planSources(spec({ profile: 'experience' }), base))
  assert.deepEqual(ids(planSources(spec({ profile: 'experience', constraints: [site('zhihu.com', 'soft')] }), base)), plain, 'soft is a preference')
  assert.deepEqual(ids(planSources(spec({ profile: 'experience', constraints: [site('baidu.com')] }), base)), plain, 'baidu.com is broader than tieba.baidu.com')
  assert.deepEqual(ids(planSources(spec({ profile: 'experience', constraints: [site('example.com')] }), base)), plain)
  // Explicit engines win over the site rule.
  assert.deepEqual(ids(planSources(spec({ profile: 'experience', constraints: [site('zhihu.com')] }), { ...base, engines: ['bing'] })), ['bing'])
  // Not ready: the web engines plan stands, with the reason in the notes.
  const down = (id: string): ProviderStatus => id === 'zhihu' ? { state: 'unavailable', reason: 'platform zhihu requires the optional dsh-browser plugin' } : ready(id)
  const fallback = planSources(spec({ profile: 'experience', constraints: [site('zhihu.com')] }), { ...base, status: down })
  assert.deepEqual(ids(fallback), plain)
  assert.match(fallback.notes.join('\n'), /site zhihu\.com names platform zhihu but it is not ready \(unavailable: platform zhihu requires the optional dsh-browser plugin\): web engines used/)
  // Without descriptors (old callers) nothing about platforms is known and nothing changes.
  assert.deepEqual(ids(planSources(spec({ profile: 'experience', constraints: [site('zhihu.com')] }), { configured: CONFIGURED, status: ready })), ids(planSources(spec({ profile: 'experience' }), { configured: CONFIGURED, status: ready })))
})

test('plan: with a cooling platform the fallback is the plan', () => {
  const status = (id: string): ProviderStatus => id === 'weibo' ? { state: 'cooldown', reason: 'browser crashed' } : ready(id)
  const plan = planSources(spec({ profile: 'news_fact', constraints: [site('weibo.com')] }), { ...base, status })
  assert.deepEqual(ids(plan), PROFILE_PROVIDERS.news_fact.slice())
  assert.match(plan.notes.join('\n'), /weibo but it is not ready \(cooldown: browser crashed\)/)
})

// ── search.recommend ─────────────────────────────────────────────────────────

const catalog = loadCatalog()
const READY: ProviderStatus = { state: 'ready', credential: 'not_required' }
const rctx = (over: Partial<RecommendContext> = {}): RecommendContext => ({
  catalog,
  providers: new Map(Object.entries({ ddg: READY, bing: READY, v2ex: READY, hackernews: READY, stackexchange: READY, wikipedia: READY, seam: READY, xiaohongshu: READY, zhihu: READY, reddit: READY })),
  cli: new Map(), browser: true, hasEnv: () => false, hasConfig: () => false, ...over,
})

test('recommend: ready platforms are suggested for experience tasks, still at most three, with the platform call', () => {
  const zh = recommendSources({ task: '了解小红书和知乎上对这款手机的真实口碑', profile: 'experience', language: 'zh' }, rctx())
  assert.ok(zh.picks.length <= 3)
  const platform = zh.picks.filter(p => ['xiaohongshu', 'zhihu', 'reddit'].includes(p.id))
  assert.ok(platform.length >= 1, 'a login platform is among the picks: ' + zh.picks.map(p => p.id).join(','))
  for (const p of zh.picks.filter(p => p.id === 'v2ex')) assert.equal(p.use, 'search.run platform=v2ex')
  for (const p of platform) {
    assert.equal(p.status, 'limited', 'runnable, login not checked')
    assert.equal(p.executable, true)
    assert.ok(p.missing!.includes('logged-in session (not checked)'))
  }
  // Without the browser the same platforms are setup steps, never executable.
  const down = recommendSources({ task: '了解小红书和知乎上对这款手机的真实口碑', profile: 'experience', language: 'zh' }, rctx({
    browser: false,
    providers: new Map(Object.entries({ ddg: READY, bing: READY, v2ex: READY, xiaohongshu: { state: 'unavailable', reason: 'platform xiaohongshu requires the optional dsh-browser plugin' }, zhihu: { state: 'unavailable', reason: 'platform zhihu requires the optional dsh-browser plugin' } })) as RecommendContext['providers'],
  }))
  for (const p of down.picks.filter(p => p.id === 'zhihu' || p.id === 'xiaohongshu')) {
    assert.equal(p.executable, false)
    assert.ok(p.missing!.some(m => /dsh-browser plugin/.test(m)), p.id + ': ' + p.missing!.join(' | '))
  }
})
