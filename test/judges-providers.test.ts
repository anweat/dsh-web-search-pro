import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { registerHooks } from 'node:module'
import { resolveConfig } from '../src/config.ts'
import { judgeStatus } from '../src/pipeline/judge-status.ts'
import { DEFAULT_PROVIDER_ID, endpointOf, PRESETS, providerProblems, resolveProviders, selectProvider, unusableReason } from '../src/pipeline/judges/providers.ts'
import { Store } from '../src/store.ts'
import { findAction } from '../src/actions/registry.ts'
import { callAction, renderResult } from './call-helper.ts'

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === '@deepseek-ai/dsh-tools') return { url: 'data:text/javascript,export const defineTool = value => value', shortCircuit: true }
    return nextResolve(specifier, context)
  },
})
const { registerTools } = await import('../src/tools.ts')

const live = <T>(value: T) => ({ get: () => value })
const base = { protocol: 'systemone', baseUrl: 'https://jev.example.test', model: 'm' }
const problems = (p: Record<string, unknown>): string => providerProblems({ ...base, ...p }).join('|')

test('presets: the default is the hosted Bocha Jev with its original endpoint, model and key ref', () => {
  assert.equal(DEFAULT_PROVIDER_ID, 'bocha-jev')
  assert.deepEqual(Object.keys(PRESETS), ['bocha-jev', 'typesafe-jev', 'laya-local', 'jina-rerank', 'cohere-rerank'])
  const jev = PRESETS['bocha-jev']!
  assert.deepEqual([jev.protocol, jev.baseUrl, jev.model, jev.keyRef, jev.limits, jev.calibration, jev.extraBody], ['systemone', 'https://jev.bocha.cn', 'bocha-jev-v1', 'BOCHA_JEV_API_KEY', undefined, undefined, undefined])
  assert.equal(endpointOf(jev), 'https://jev.bocha.cn/v1/systemone')
  assert.equal(endpointOf(PRESETS['jina-rerank']!), 'https://api.jina.ai/v1/rerank')
  assert.equal(endpointOf(PRESETS['cohere-rerank']!), 'https://api.cohere.com/v2/rerank')
  assert.equal(endpointOf(PRESETS['laya-local']!), 'http://127.0.0.1:8765/v1/systemone')
  for (const p of Object.values(PRESETS)) assert.deepEqual(providerProblems(p as never), [], p.id)
  assert.equal(PRESETS['bocha-jev']!.unverified, undefined)
  for (const id of ['typesafe-jev', 'jina-rerank', 'cohere-rerank']) assert.equal(PRESETS[id]!.unverified, true, id)
  assert.equal(PRESETS['laya-local']!.keyRef, undefined)
})

test('provider validation: each rule reports what to fix', () => {
  assert.equal(problems({}), '')
  assert.match(problems({ protocol: 'grpc' }), /protocol must be one of systemone, rerank, llm/)
  assert.match(problems({ model: '' }), /model must be a non-empty string/)
  assert.match(problems({ baseUrl: 'jev.example.test' }), /is not a URL/)
  assert.match(problems({ baseUrl: 'http://jev.example.test' }), /must be https/)
  assert.equal(problems({ baseUrl: 'http://localhost:8080' }), '')
  assert.equal(problems({ baseUrl: 'http://127.0.0.1:8765' }), '')
  assert.match(problems({ baseUrl: 'https://user:pw@jev.example.test' }), /must not carry credentials/)
  assert.match(problems({ baseUrl: 'https://jev.example.test/?key=1' }), /query or fragment/)
  assert.match(problems({ keyRef: 'has space' }), /keyRef must be a credentials ref/)
  assert.equal(problems({ keyRef: 'MY_KEY' }), '')
  assert.match(problems({ path: 'no-slash' }), /path must look like/)
  assert.match(problems({ tokenModel: 'huge' }), /tokenModel must be expanded or plain/)
  assert.match(problems({ rubricId: 'nope' }), /rubricId must be a known rubric/)
  assert.match(problems({ rubricId: 'gate.relevance' }), /not a score rubric/)
  assert.match(problems({ protocol: 'rerank', rubricId: 'score.support' }), /does not apply to the rerank protocol/)
  assert.equal(problems({ rubricId: 'score.support' }), '')
  assert.match(problems({ limits: { maxQuestionsPerRequest: 0 } }), /limits\.maxQuestionsPerRequest must be a positive integer/)
  assert.match(problems({ limits: { bogus: 1 } }), /unknown limit "bogus"/)
  assert.match(problems({ limits: [] }), /limits must be an object/)
  assert.match(problems({ calibration: { version: 'v1', points: [[0, 0]] } }), /calibration.points needs 2-32/)
  assert.match(problems({ extraBody: { model: 'x' } }), /extraBody must not set "model"/)
  assert.match(problems({ extraBody: [] }), /extraBody must be an object/)
  assert.match(problems({ price: { currency: 'USD' } }), /price must be/)
  assert.equal(problems({ price: { inputPerMTokens: 1, currency: 'USD' } }), '')
})

test('custom providers: added by id, overriding a preset merges limits and extra body, invalid entries are dropped with a reason', () => {
  const { providers, diagnostics } = resolveProviders({ providers: {
    'my-jev': { ...base, keyRef: 'MY_KEY', limits: { maxQuestionsPerRequest: 8 } },
    'laya-local': { baseUrl: 'http://127.0.0.1:9000', limits: { blockChars: 300 }, extraBody: { max_len: 512, extra: true } },
    'jina-rerank': { calibration: { version: 'v1', points: [[0.1, 0], [0.9, 3]] } },
    'BAD ID': base,
    rule: base,
    'no-url': { protocol: 'systemone', model: 'm' },
    'string-entry': 'x',
    'bocha-jev': { baseUrl: 'http://insecure.example.test' },
    'typo': { ...base, baseurl: 'https://x.test' },
  } })
  assert.deepEqual([...providers.keys()], ['bocha-jev', 'typesafe-jev', 'laya-local', 'jina-rerank', 'cohere-rerank', 'my-jev'])
  assert.equal(providers.get('my-jev')!.limits!.maxQuestionsPerRequest, 8)
  const laya = providers.get('laya-local')!
  assert.equal(laya.baseUrl, 'http://127.0.0.1:9000')
  assert.deepEqual(laya.limits, { blockChars: 300 })
  assert.deepEqual(laya.extraBody, { max_len: 512, extra: true })
  assert.equal(laya.tokenModel, 'plain', 'untouched preset fields stay')
  assert.equal(providers.get('jina-rerank')!.calibration!.version, 'v1')
  assert.equal(providers.get('bocha-jev')!.baseUrl, 'https://jev.bocha.cn', 'an invalid override leaves the preset as shipped')
  const text = diagnostics.join('\n')
  assert.match(text, /providers\.BAD ID ignored: the id must be lowercase/)
  assert.match(text, /providers\.rule ignored: the id must be lowercase.*not rule \/ hybrid \/ none/)
  assert.match(text, /providers\.no-url ignored: baseUrl must be a URL string/)
  assert.match(text, /providers\.string-entry ignored: not an object/)
  assert.match(text, /providers\.bocha-jev ignored, the built-in preset is kept: baseUrl must be https/)
  assert.match(text, /providers\.typo ignored: unknown field "baseurl"/)
})

test('selecting a provider: the default, unknown ids, placeholders, uncalibrated rerankers and the llm gate', () => {
  const dflt = selectProvider()
  assert.equal(dflt.provider!.id, 'bocha-jev')
  assert.equal(selectProvider({ provider: 'laya-local' }).provider!.id, 'laya-local')
  assert.match(selectProvider({ provider: 'x' }).unusable!, /"x" is not defined \(known: bocha-jev, typesafe-jev/)
  assert.match(selectProvider({ provider: 'typesafe-jev' }).unusable!, /placeholder preset: set baseUrl and model/)
  // replacing only the url leaves the model a placeholder; replacing both makes it usable (still flagged unverified)
  assert.match(selectProvider({ provider: 'typesafe-jev', providers: { 'typesafe-jev': { baseUrl: 'https://tj.example.test' } } }).unusable!, /set model/)
  const tj = selectProvider({ provider: 'typesafe-jev', providers: { 'typesafe-jev': { baseUrl: 'https://tj.example.test', model: 'tj-1' } } })
  assert.equal(tj.provider!.baseUrl, 'https://tj.example.test')
  assert.equal(tj.provider!.unverified, true)
  assert.match(selectProvider({ provider: 'jina-rerank' }).unusable!, /calibration\.points/)
  assert.equal(selectProvider({ provider: 'jina-rerank', providers: { 'jina-rerank': { calibration: { version: 'v1', points: [[0, 0], [1, 3]] } } } }).provider!.id, 'jina-rerank')
  const llm = { l: { protocol: 'llm', baseUrl: 'https://llm.example.test/v1', model: 'm' } }
  assert.match(selectProvider({ provider: 'l', providers: llm }).unusable!, /allowLlm/)
  assert.equal(selectProvider({ provider: 'l', providers: llm, allowLlm: true }).provider!.id, 'l')
  assert.equal(unusableReason(PRESETS['bocha-jev']!), undefined)
})

test('config: judge and budget are optional, unwrap volatile values and leave the default evidence shape untouched', () => {
  assert.equal('judge' in resolveConfig({} as never).evidence, false)
  assert.equal('budget' in resolveConfig({} as never).evidence, false)
  const resolved = resolveConfig({ evidence: { judge: live({ provider: 'my', mode: 'hybrid', providers: { my: base } }), budget: live({ dailyInputTokens: 5 }) } } as never)
  assert.deepEqual(resolved.evidence.judge, { provider: 'my', mode: 'hybrid', providers: { my: base } })
  assert.deepEqual(resolved.evidence.budget, { dailyInputTokens: 5 })
})

// ── status ──────────────────────────────────────────────────────────────────

test('judgeStatus: provider usability, key presence, today\'s usage and caps; no secrets', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wsp-judge-status-'))
  const store = new Store(path.join(dir, 'store.db'))
  try {
    const fresh = await judgeStatus(resolveConfig({} as never).evidence, store, { hasSecret: async () => false })
    assert.deepEqual(fresh.provider, { id: 'bocha-jev', protocol: 'systemone', model: 'bocha-jev-v1', usable: true, keyConfigured: false })
    assert.deepEqual(fresh.providers, ['bocha-jev', 'typesafe-jev', 'laya-local', 'jina-rerank', 'cohere-rerank'])
    assert.deepEqual(fresh.usage!.caps, { perSearchInputTokens: 60_000, dailyInputTokens: 1_000_000 })
    assert.deepEqual([fresh.usage!.requests, fresh.usage!.inputTokens, fresh.usage!.estimated, fresh.usage!.amountKnown, fresh.usage!.byProvider], [0, 0, false, true, []])

    const { UsageLedger, resolveBudget } = await import('../src/pipeline/ledger.ts')
    // Same time zone as the status read below: "today" must mean the same day on both sides at any hour.
    const ledger = new UsageLedger(store, resolveBudget({ timezone: 'Asia/Tokyo' }).caps)
    ledger.forSearch().meterFor(PRESETS['bocha-jev']!).reserve({ inputTokens: 900 }).settle({ inputTokens: 700, outputTokens: 2 })
    ledger.forSearch().meterFor(PRESETS['laya-local']!).reserve({ inputTokens: 90 }).settle({})
    const cfg = resolveConfig({ evidence: { judge: { provider: 'jina-rerank' }, budget: { perSearchInputTokens: 123, timezone: 'Asia/Tokyo', providers: { x: { dailyInputTokens: -1 } } } } } as never).evidence
    const s = await judgeStatus(cfg, store, { now: () => Date.now() })
    assert.equal(s.provider.usable, false)
    assert.match(s.provider.reason!, /calibration\.points/)
    assert.equal(s.provider.unverified, true)
    assert.equal(s.provider.keyConfigured, undefined)
    assert.equal(s.usage!.timezone, 'Asia/Tokyo')
    assert.equal(s.usage!.caps.perSearchInputTokens, 123)
    assert.deepEqual([s.usage!.requests, s.usage!.inputTokens, s.usage!.outputTokens, s.usage!.estimated, s.usage!.amountKnown], [2, 790, 2, true, false])
    assert.deepEqual(s.usage!.byProvider.map(p => [p.provider, p.inputTokens, p.estimated]), [['bocha-jev', 700, false], ['laya-local', 90, true]])
    assert.match(s.diagnostics.join('|'), /budget\.providers\.x\.dailyInputTokens ignored/)
    assert.ok(!JSON.stringify(s).includes('sk-'))
  } finally { store.close(); fs.rmSync(dir, { recursive: true, force: true }) }
})

test('sources.status: the evidence section gains optional provider / providers / usage fields in the closed schema, and renders them', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wsp-judge-status-tool-'))
  const store = new Store(path.join(dir, 'store.db'))
  const definitions = new Map<string, any>()
  try {
    const config = resolveConfig({ dbPath: path.join(dir, 'store.db'), enableCliBackends: false, evidence: { judge: { provider: 'bocha-jev' }, budget: { dailyInputTokens: 5000 } } } as never)
    registerTools({
      ctx: { tools: { register: (d: any) => definitions.set(d.name, d) } } as any, config, dynamic: () => config, store,
      router: { backendDiagnostics: async () => [], resolveSecret: async (ref: string) => (ref === 'BOCHA_JEV_API_KEY' ? 'sk-hidden' : undefined) } as any, fetch: {} as any, browser: {} as any,
    })
    const def = findAction('sources.status')!
    const out = await callAction(definitions, 'sources.status')
    const ev = out.evidence
    assert.deepEqual(ev.provider, { id: 'bocha-jev', protocol: 'systemone', model: 'bocha-jev-v1', usable: true, keyConfigured: true })
    assert.equal(ev.usage.caps.dailyInputTokens, 5000)
    assert.equal(ev.usage.inputTokens, 0)
    assert.ok(!JSON.stringify(out).includes('sk-hidden'))
    // every returned key is declared by the closed schema
    const schema = def.output.properties.evidence as any
    for (const key of Object.keys(ev)) assert.ok(key in schema.properties, key)
    for (const key of Object.keys(ev.usage)) assert.ok(key in schema.properties.usage.properties, key)
    for (const key of Object.keys(ev.provider)) assert.ok(key in schema.properties.provider.properties, key)
    assert.equal(schema.properties.provider.required, undefined)
    const text = renderResult('sources.status', out)
    assert.match(text, /judge provider: bocha-jev \(systemone, bocha-jev-v1\)/)
    assert.match(text, /model usage \d{4}-\d{2}-\d{2}: 0 request\(s\), 0 input \/ 0 output tokens; caps: 60000\/search, 5000\/day input tokens/)
    assert.ok(!text.includes('sk-hidden'))
  } finally { store.close(); fs.rmSync(dir, { recursive: true, force: true }) }
})
