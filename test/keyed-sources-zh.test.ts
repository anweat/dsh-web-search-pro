import test from 'node:test'
import assert from 'node:assert/strict'
import { defaultProviderRegistry } from '../src/providers/index.ts'
import { KEYED_SOURCE_ENVS } from '../src/providers/keyed.ts'
import { metasoAdapter, metasoBody, parseMetaso, metasoFailure } from '../src/providers/metaso.ts'
import { zhipuAdapter, zhipuBody, zhipuRecency, parseZhipu, zhipuFailure } from '../src/providers/zhipu.ts'
import { baiduAdapter, baiduBody, limitUnits, parseBaidu, baiduFailure } from '../src/providers/baidu-qianfan.ts'
import type { Constraint } from '../src/pipeline/types.ts'
import { fixture, fails, harness, reply, assertNoKey } from './keyed-harness.ts'

const NOW = new Date('2026-10-02T00:00:00Z')
const hard = (id: string, kind: Constraint['kind'], value: string, strength: Constraint['strength'] = 'hard'): Constraint => ({ id, kind, value, strength, origin: 'param' })
const task = (constraints: Constraint[], query = '大模型备案 最新要求') => ({ goal: query, query, needs: [{ id: 'n1', text: query, critical: true }], constraints })

// ── Metaso ───────────────────────────────────────────────────────────────────

test('metaso (constructed fixture): webpages[] mapped, both date keys read, duplicate and link-less entries dropped', () => {
  const fx = fixture('metaso-search.json')
  assert.equal(fx.live, false)
  assert.match(fx._comment, /NOT a live capture/)
  const sources = parseMetaso(fx.body, 10)
  assert.deepEqual(sources.map(s => s.url), ['https://www.cac.gov.cn/example/beian-guide', 'https://zhuanlan.example.test/p/1'])
  assert.equal(sources[0]!.title, '生成式人工智能服务备案指南')
  assert.equal(sources[0]!.snippet, '介绍生成式人工智能服务上线前的备案材料和流程。')
  assert.equal(sources[0]!.publishedAt, '2026年03月18日', 'the service date text is kept as it is')
  assert.equal(sources[1]!.publishedAt, '2026-05-02', 'displayDate is read too')
  assert.equal(parseMetaso(fx.body, 1).length, 1)
  assert.throws(() => parseMetaso({ webpages: [] }, 5), (e: any) => e.code === 'ENGINE_EMPTY')
  assert.throws(() => parseMetaso({ message: 'x' }, 5), (e: any) => e.code === 'ENGINE_ERROR')
})

test('metaso request: POST /api/v1/search, Bearer key, webpage scope, no summary / generated content requested', async () => {
  const { engine, calls, usage, key } = harness('metaso', d => metasoAdapter.create(d, {} as never), () => reply(200, fixture('metaso-search.json').body))
  const out = await engine.search('大模型备案', 50)
  assert.equal(out.sources.length, 2)
  assert.equal(calls[0]!.url, 'https://metaso.cn/api/v1/search')
  assert.equal(calls[0]!.headers.authorization, 'Bearer ' + key)
  assert.deepEqual(calls[0]!.body, { q: '大模型备案', scope: 'webpage', includeSummary: false, size: 20 })
  assert.deepEqual(usage, [{ provider: 'metaso', protocol: 'search', requests: 1, note: 'tokens n/a, price unknown' }])
  assert.equal(metasoBody('x', 0).size, 1)
  assert.deepEqual(metasoAdapter.compile!(task([hard('c1', 'site', 'gov.cn'), hard('c2', 'time_window', '2025')]), NOW).native, [], 'no documented filter: everything is verified locally')
})

test('metaso errors: auth not retryable, balance wording is quota, 429 honours Retry-After, request errors not retryable', () => {
  const f = (status: number, body: unknown = {}, h: Record<string, string> = {}) => metasoFailure(status, new Headers(h), body)
  assert.deepEqual([f(401).code, f(401).retryable, f(403, { message: 'invalid key' }).retryable], ['ENGINE_AUTH', false, false])
  const quota = f(403, { message: '账户余额不足，请充值' })
  assert.deepEqual([quota.code, quota.retryable], ['ENGINE_QUOTA', false])
  const rate = f(429, { message: 'too many requests' }, { 'retry-after': '4' })
  assert.deepEqual([rate.code, rate.retryable, rate.retryAfterMs], ['ENGINE_RATE_LIMIT', true, 4000])
  assert.deepEqual([f(400).code, f(400).retryable, f(500).retryable], ['ENGINE_ERROR', false, true])
})

// ── Zhipu ────────────────────────────────────────────────────────────────────

test('zhipu (constructed fixture): raw search_result only — search_intent text is never a source', () => {
  const fx = fixture('zhipu-web-search.json')
  assert.equal(fx.live, false)
  const sources = parseZhipu(fx.body, 10)
  assert.deepEqual(sources.map(s => s.url), ['https://www.example.test/beian', 'https://policy.example.test/read'])
  assert.equal(sources[0]!.snippet, '备案分为安全评估、材料提交与公示三个阶段。')
  assert.equal(sources[0]!.publishedAt, '2026-01-15')
  assert.ok(!('publishedAt' in sources[1]!))
  assert.ok(!JSON.stringify(sources).includes('GENERATED INTENT'))
  assert.throws(() => parseZhipu({ search_result: [] }, 5), (e: any) => e.code === 'ENGINE_EMPTY')
  assert.throws(() => parseZhipu({ id: 'x' }, 5), (e: any) => e.code === 'ENGINE_ERROR')
  // an error envelope that arrives with a 2xx status is a failure, not an empty result
  assert.throws(() => parseZhipu({ error: { code: '1113', message: '余额不足' } }, 5), (e: any) => e.code === 'ENGINE_QUOTA' && !e.retryable)
})

test('zhipu request: POST /api/paas/v4/web_search, Bearer key, search_std, query cut to 70 characters, one domain, recency bucket', async () => {
  const { engine, calls, key } = harness('zhipu', d => zhipuAdapter.create(d, {} as never), () => reply(200, fixture('zhipu-web-search.json').body))
  const longQuery = '大模型备案'.repeat(30)
  await engine.search(longQuery, 80, undefined, { sites: { include: ['gov.cn', 'cac.gov.cn'] }, since: new Date(Date.now() - 7 * 86_400_000).toISOString() })
  const c = calls[0]!
  assert.equal(c.url, 'https://open.bigmodel.cn/api/paas/v4/web_search')
  assert.equal(c.headers.authorization, 'Bearer ' + key)
  assert.equal([...c.body.search_query].length, 70)
  const { search_query: _q, ...rest } = c.body
  assert.deepEqual(rest, { search_engine: 'search_std', search_intent: false, count: 50, content_size: 'medium', search_domain_filter: 'gov.cn', search_recency_filter: 'oneWeek' })
  assert.deepEqual(Object.keys(zhipuBody('q', 5)).sort(), ['content_size', 'count', 'search_engine', 'search_intent', 'search_query'])
  const t = Date.parse('2026-10-02T00:00:00Z')
  assert.equal(zhipuRecency('2026-10-01T00:00:00Z', t), 'oneDay')
  assert.equal(zhipuRecency('2026-09-25T00:00:00Z', t), 'oneWeek')
  assert.equal(zhipuRecency('2026-09-20T00:00:00Z', t), 'oneMonth', '12 days: the covering bucket')
  assert.equal(zhipuRecency('2025-10-02T00:00:00Z', t), 'oneYear')
  assert.equal(zhipuRecency('2025-01-01T00:00:00Z', t), undefined, 'more than a year: no bucket')
})

test('zhipu errors by business code: 1000-1005 auth, 1113 / 1308-1310 quota (no cooldown), 1302 / 1701 rate limit, 1210 request error, 1702 retryable', () => {
  const f = (status: number, code: string, message = 'm', h: Record<string, string> = {}) => zhipuFailure(status, new Headers(h), { error: { code, message } })
  for (const code of ['1000', '1001', '1003']) assert.deepEqual([f(401, code).code, f(401, code).retryable], ['ENGINE_AUTH', false], code)
  for (const code of ['1113', '1308', '1309', '1310']) assert.deepEqual([f(429, code).code, f(429, code).retryable, f(429, code).retryAfterMs], ['ENGINE_QUOTA', false, undefined], code)
  for (const code of ['1302', '1701']) assert.deepEqual([f(429, code).code, f(429, code).retryable], ['ENGINE_RATE_LIMIT', true], code)
  assert.equal(f(429, '1302', 'm', { 'retry-after': '3' }).retryAfterMs, 3000)
  assert.deepEqual([f(400, '1210').code, f(400, '1210').retryable, f(400, '1301').retryable], ['ENGINE_ERROR', false, false])
  assert.deepEqual([f(500, '1702').code, f(500, '1702').retryable, f(500, '1703').retryable], ['ENGINE_ERROR', true, true])
  assert.deepEqual([zhipuFailure(401, new Headers(), {}).code, zhipuFailure(429, new Headers(), {}).code, zhipuFailure(500, new Headers(), {}).retryable], ['ENGINE_AUTH', 'ENGINE_RATE_LIMIT', true], 'no business code: the HTTP status decides')
})

// ── Baidu Qianfan ────────────────────────────────────────────────────────────

test('baidu-qianfan (constructed fixture): web references only — video entries and link-less ones dropped', () => {
  const fx = fixture('baidu-qianfan-web-search.json')
  assert.equal(fx.live, false)
  const sources = parseBaidu(fx.body, 10)
  assert.deepEqual(sources.map(s => s.url), ['https://cloud.baidu.com/product/wenxinworkshop', 'https://ai.baidu.com/ai-doc/AppBuilder/pmaxd1hvy'])
  assert.equal(sources[0]!.snippet, '百度智能云千帆大模型平台，提供模型服务与工具。')
  assert.equal(sources[0]!.publishedAt, '2025-11-04 10:00:00')
  assert.ok(!('publishedAt' in sources[1]!), 'a blank date is omitted')
  assert.throws(() => parseBaidu({ request_id: 'x', references: [] }, 5), (e: any) => e.code === 'ENGINE_EMPTY')
  assert.throws(() => parseBaidu({ references: 'x' }, 5), (e: any) => e.code === 'ENGINE_ERROR')
  assert.throws(() => parseBaidu({ code: 216003, message: 'Authentication error', request_id: 'r' }, 5), (e: any) => e.code === 'ENGINE_AUTH' && !e.retryable, 'an error envelope with a 2xx status')
})

test('baidu-qianfan request: web_search body with messages / baidu_search_v2 / top_k; BOTH documented auth headers carry the key; filters; query cut to 72 units', async () => {
  const { engine, calls, key } = harness('baidu-qianfan', d => baiduAdapter.create(d, {} as never), () => reply(200, fixture('baidu-qianfan-web-search.json').body))
  await engine.search('百度千帆平台', 80, undefined, { sites: { include: ['baidu.com'], exclude: ['example.com'] }, since: '2025-11-01T00:00:00.000Z' })
  const c = calls[0]!
  assert.equal(c.url, 'https://qianfan.baidubce.com/v2/ai_search/web_search')
  assert.equal(c.headers.authorization, 'Bearer ' + key, 'the v2 convention')
  assert.equal(c.headers['x-appbuilder-authorization'], 'Bearer ' + key, 'the header of the official curl example')
  assert.deepEqual(c.body, {
    messages: [{ role: 'user', content: '百度千帆平台' }],
    search_source: 'baidu_search_v2',
    resource_type_filter: [{ type: 'web', top_k: 50 }],
    search_filter: { match: { site: ['baidu.com'] }, range: { page_time: { gte: '2025-11-01' } } },
    block_websites: ['example.com'],
  })
  assert.ok(!c.url.includes(key), 'the key is never in the URL')
  assert.equal(limitUnits('百度'.repeat(60), 72), '百度'.repeat(18), 'a CJK character counts 2: 36 characters')
  assert.equal(limitUnits('a'.repeat(100), 72).length, 72)
  assert.ok(!('search_filter' in baiduBody('q', 5)) && !('block_websites' in baiduBody('q', 5)))
  assert.equal(baiduBody('q', 5, { sites: { include: Array.from({ length: 30 }, (_, i) => 'd' + i + '.test') } }).search_filter!.match!.site.length, 20, 'at most 20 domains')
})

test('baidu-qianfan errors: 216003 auth, quota wording, 429 rate limit with Retry-After, 400 request error, 500 retryable; body text is redacted', () => {
  const f = (status: number, body: unknown = {}, h: Record<string, string> = {}) => baiduFailure(status, new Headers(h), body)
  const auth = f(401, { code: 216003, message: 'Authentication error, Bearer abcdefghijklmnopqrstuvwxyz012345 invalid', request_id: 'r' })
  assert.deepEqual([auth.code, auth.retryable], ['ENGINE_AUTH', false])
  assert.ok(!auth.message.includes('abcdefghijklmnopqrstuvwxyz'), 'a credential-looking value in the message is redacted')
  assert.match(auth.message, /both|header/, 'the ambiguity is surfaced')
  assert.equal(f(403, { code: 1, message: '免费额度已用完，请充值' }).code, 'ENGINE_QUOTA')
  const rate = f(429, { code: 18, message: 'qps request limit reached' }, { 'retry-after': '2' })
  assert.deepEqual([rate.code, rate.retryable, rate.retryAfterMs], ['ENGINE_RATE_LIMIT', true, 2000])
  assert.deepEqual([f(400, { code: 400, message: 'bad' }).code, f(400).retryable, f(500).retryable, f(501).retryable], ['ENGINE_ERROR', false, true, true])
})

// ── shared behaviour ─────────────────────────────────────────────────────────

test('Chinese keyed sources: redirects refused, no key = not available and not executable, descriptors below Bocha (priority > 10)', async () => {
  for (const [route, adapter] of [['metaso', metasoAdapter], ['zhipu', zhipuAdapter], ['baidu-qianfan', baiduAdapter]] as const) {
    const seen: string[] = []
    const h = harness(route, d => adapter.create(d, {} as never), call => { seen.push(call.url); return new Response('', { status: 307, headers: { location: 'https://evil.example.test/' } }) })
    assertNoKey(await fails(h.engine.search('q', 3)), h.key)
    assert.equal(seen.length, 1, route + ': a redirect is never followed')

    const none = harness(route, d => adapter.create(d, {} as never), () => reply(200, {}), null)
    assert.equal(none.engine.available(), false)
    const e = await fails(none.engine.search('q', 3))
    assert.deepEqual([e.code, e.retryable], ['ENGINE_UNAVAILABLE', false])
    assert.match(e.message, new RegExp(KEYED_SOURCE_ENVS[route]![0]!))
    assert.equal(none.calls.length, 0)
    const env = { deps: { enableCli: false, opencliEnabled: false, agentReachEnabled: false, allowProxyFakeIp: false, skipSeam: false }, config: {} as never }
    const missing = await adapter.probeLocal(env)
    assert.deepEqual([missing.available, missing.credential, missing.diagnosticCode], [false, 'missing', 'credential_missing'])
    assert.deepEqual((await adapter.probeLocal({ ...env, deps: { ...env.deps, sourceKeys: { [route]: 'k' } } })).credential, 'configured')

    const d = defaultProviderRegistry.resolve(route)!.descriptor
    assert.deepEqual(d.languages, ['zh'])
    assert.ok(d.resultKinds.includes('web') && d.verification?.live === false && d.costModel.kind === 'metered')
    assert.ok((d.priority ?? 100) > 10, 'below Bocha')
  }
  assert.deepEqual(defaultProviderRegistry.resolve('baidu-qianfan')!.descriptor.requirements[0]!.env, ['QIANFAN_API_KEY', 'BAIDU_API_KEY'])
  assert.equal(defaultProviderRegistry.resolve('baidu-qianfan')!.descriptor.sourceFamily, 'baidu')
})

test('compile: Baidu takes site / exclude / date natively; Zhipu one domain and an exact recency window natively, a wider bucket only as a hint', () => {
  const c = [hard('c1', 'site', 'gov.cn'), hard('c2', 'exclude_site', 'example.com'), hard('c3', 'time_window', '2025 年以后'), hard('c4', 'must_term', '备案'), hard('c5', 'site', 'cac.gov.cn')]
  const b = baiduAdapter.compile!(task(c), NOW)
  assert.deepEqual(b.options, { sites: { include: ['gov.cn', 'cac.gov.cn'], exclude: ['example.com'] }, since: '2025-01-01T00:00:00.000Z' })
  assert.deepEqual([...b.native].sort(), ['c1', 'c2', 'c3', 'c5'])
  assert.deepEqual(b.local, ['c4'])
  // Zhipu: first domain only, the second site stays local; "2025 年以后" is more than a year back: no bucket at all
  const z = zhipuAdapter.compile!(task(c), NOW)
  assert.deepEqual(z.options, { sites: { include: ['gov.cn'] } })
  assert.deepEqual(z.native, ['c1'])
  assert.deepEqual(z.local, ['c2', 'c3', 'c4', 'c5'])
  const week = zhipuAdapter.compile!(task([hard('w', 'time_window', '最近一周')]), NOW)
  assert.equal(week.options?.since, '2026-09-25T00:00:00.000Z')
  assert.deepEqual([week.native, week.local], [['w'], []], 'exactly a week: native')
  const ten = zhipuAdapter.compile!(task([hard('t', 'time_window', '最近10天')]), NOW)
  assert.equal(ten.options?.since, '2026-09-22T00:00:00.000Z', 'sent as a hint (the month bucket covers it)')
  assert.deepEqual([ten.native, ten.local], [[], ['t']], 'but not native: still verified locally')
  assert.equal(zhipuAdapter.compile!(task([hard('w', 'time_window', '最近一周', 'soft')]), NOW).options, undefined)
})
