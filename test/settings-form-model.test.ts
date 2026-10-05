import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Config, resolveConfig } from '../src/config.ts'
import { configuredDecider } from '../src/pipeline/judge-status.ts'
import { BUILTIN_RUBRIC_IDS } from '../src/pipeline/rubrics-spec.ts'
import { resolveAllRubrics } from '../src/pipeline/rubrics.ts'
import { resolveProviders } from '../src/pipeline/judges/providers.ts'
import { BUDGET_SPECS, BUDGETED_SOURCES, DEFAULTS, FIELD_SPECS, KEYED_SOURCES, KEYED_SPECS, PATH_SPECS, rubricField, type SettingField } from '../src/client/form-specs.ts'
import { BASE, harness } from './settings-harness.ts'

// ── the form covers the whole schema ────────────────────────────────────────

interface SchemaNode { type: string; dict?: Record<string, SchemaNode>; inner?: SchemaNode; meta?: { role?: string } }

function leaves(node: SchemaNode, prefix: string, out: { path: string; node: SchemaNode }[]): void {
  if (node.type === 'object' && node.dict) { for (const [key, child] of Object.entries(node.dict)) leaves(child, prefix ? prefix + '.' + key : key, out); return }
  out.push({ path: prefix, node })
}

test('every leaf of the Config schema is a control, a derived control, or a secret that the card never shows', () => {
  const found: { path: string; node: SchemaNode }[] = []
  leaves(Config as unknown as SchemaNode, '', found)
  const top = new Set(FIELD_SPECS.map(spec => spec.field as string))
  const path = new Set(PATH_SPECS.map(spec => spec.field as string))
  const missing: string[] = []
  for (const { path: leaf, node } of found) {
    if (node.meta?.role === 'secret') continue // credentials go through the credentials remote, never through settings
    if (leaf.startsWith('playwright.')) { if (!top.has('playwright')) missing.push(leaf); continue }
    if (leaf === 'evidence.scorer' || leaf === 'evidence.jevMode') { if (!path.has('evidence.judge.mode')) missing.push(leaf); continue }
    if (leaf === 'keyedSources') {
      assert.deepEqual(Object.keys(node.inner!.dict!), ['apiKey', 'apiKeyEnv', 'baseUrl'])
      assert.equal(node.inner!.dict!.apiKey!.meta?.role, 'secret')
      continue
    }
    if (leaf === 'evidence.rubrics') continue
    if (leaf === 'sources.budget') {
      assert.deepEqual(Object.keys(node.inner!.dict!), ['total', 'daily'])
      assert.deepEqual(BUDGET_SPECS.map(spec => spec.field), BUDGETED_SOURCES.flatMap(id => [`sources.budget.${id}.total`, `sources.budget.${id}.daily`]))
      continue
    }
    if (!top.has(leaf) && !path.has(leaf)) missing.push(leaf)
  }
  assert.deepEqual(missing, [])
  // dict-valued controls that are not a single field: one pair per keyed source, one JSON entry per built-in rubric.
  assert.deepEqual(KEYED_SPECS.map(spec => spec.field), KEYED_SOURCES.flatMap(({ id }) => [`keyedSources.${id}.apiKeyEnv`, `keyedSources.${id}.baseUrl`]))
  assert.equal(KEYED_SOURCES.length, 7)
  const h = harness()
  for (const id of BUILTIN_RUBRIC_IDS) assert.ok(rubricField(id) in h.controller.snapshot().fields)
  h.controller.dispose()
})

test('the defaults the card shows are the defaults of the schema', () => {
  const resolved = resolveConfig({} as never)
  assert.equal(resolved.evidence.autoProviders, DEFAULTS.evidence.autoProviders)
  assert.equal(resolved.evidence.maxRounds, DEFAULTS.evidence.maxRounds)
  assert.equal(resolved.evidence.maxQueries, DEFAULTS.evidence.maxQueries)
  assert.equal(resolved.evidence.hybridBorderline, DEFAULTS.evidence.hybridBorderline)
  assert.equal(resolved.evidence.maxJevQuestions, DEFAULTS.evidence.maxJevQuestions)
  assert.equal(resolved.evidence.scorer, DEFAULTS.evidence.scorer)
  assert.equal(resolved.evidence.jevMode, DEFAULTS.evidence.jevMode)
  assert.equal(resolved.provider.evidence, DEFAULTS.provider.evidence)
  assert.equal(resolved.provider.deadlineMs, DEFAULTS.provider.deadlineMs)
  assert.equal(resolved.toolSurface, DEFAULTS.toolSurface)
  assert.equal(resolved.bochaApiKeyEnv, DEFAULTS.bochaApiKeyEnv)
  assert.equal(resolved.bochaBaseUrl, DEFAULTS.bochaBaseUrl)
  assert.equal(resolved.bochaSummary, DEFAULTS.bochaSummary)
})

// ── round trips: load -> edit -> save -> the payload is what the schema and the server read ──────────────────────

interface Case { field: SettingField; before: string; text: string; root?: 'evidence' | 'provider' | 'keyedSources'; payload: unknown }

const CASES: Case[] = [
  { field: 'evidence.autoProviders', before: 'true', text: 'false', root: 'evidence', payload: { autoProviders: false } },
  { field: 'evidence.maxRounds', before: '2', text: '3', root: 'evidence', payload: { maxRounds: 3 } },
  { field: 'evidence.maxQueries', before: '4', text: '6', root: 'evidence', payload: { maxQueries: 6 } },
  { field: 'evidence.hybridBorderline', before: 'false', text: 'true', root: 'evidence', payload: { hybridBorderline: true } },
  { field: 'evidence.maxJevQuestions', before: '64', text: '24', root: 'evidence', payload: { maxJevQuestions: 24 } },
  { field: 'evidence.judge.provider', before: '', text: 'laya-local', root: 'evidence', payload: { judge: { provider: 'laya-local' } } },
  { field: 'evidence.judge.allowLlm', before: 'false', text: 'true', root: 'evidence', payload: { judge: { allowLlm: true } } },
  { field: 'evidence.coverage.mode', before: 'off', text: 'shadow', root: 'evidence', payload: { coverage: { mode: 'shadow' } } },
  { field: 'evidence.coverage.provider', before: '', text: 'bocha-jev', root: 'evidence', payload: { coverage: { provider: 'bocha-jev' } } },
  { field: 'evidence.budget.perSearchInputTokens', before: '60000', text: '30000', root: 'evidence', payload: { budget: { perSearchInputTokens: 30_000 } } },
  { field: 'evidence.budget.dailyInputTokens', before: '1000000', text: '500000', root: 'evidence', payload: { budget: { dailyInputTokens: 500_000 } } },
  { field: 'evidence.budget.timezone', before: '', text: 'Asia/Shanghai', root: 'evidence', payload: { budget: { timezone: 'Asia/Shanghai' } } },
  { field: 'evidence.budget.providers', before: '', text: '{"bocha-jev":{"dailyInputTokens":200000}}', root: 'evidence', payload: { budget: { providers: { 'bocha-jev': { dailyInputTokens: 200_000 } } } } },
  {
    field: 'evidence.judge.providers', before: '',
    text: '{"my-jev":{"protocol":"systemone","baseUrl":"https://jev.example.com","model":"m1","keyRef":"MY_JEV_KEY"}}',
    root: 'evidence', payload: { judge: { providers: { 'my-jev': { protocol: 'systemone', baseUrl: 'https://jev.example.com', model: 'm1', keyRef: 'MY_JEV_KEY' } } } },
  },
  { field: 'provider.evidence', before: 'auto', text: 'off', root: 'provider', payload: { evidence: 'off' } },
  { field: 'provider.deadlineMs', before: '25000', text: '5000', root: 'provider', payload: { deadlineMs: 5000 } },
  { field: 'keyedSources.tavily.apiKeyEnv', before: '', text: 'MY_TAVILY', root: 'keyedSources', payload: { tavily: { apiKeyEnv: 'MY_TAVILY' } } },
  { field: 'keyedSources.baidu-qianfan.baseUrl', before: '', text: 'https://qianfan.example.com', root: 'keyedSources', payload: { 'baidu-qianfan': { baseUrl: 'https://qianfan.example.com' } } },
  { field: 'toolSurface', before: 'indexed', text: 'flat', payload: 'flat' },
  { field: 'bochaApiKeyEnv', before: '', text: 'MY_BOCHA', payload: 'MY_BOCHA' },
  { field: 'bochaBaseUrl', before: '', text: 'https://api.bocha.cn', payload: 'https://api.bocha.cn' },
  { field: 'bochaSummary', before: 'true', text: 'false', payload: false },
  { field: 'searxngUrl', before: '', text: 'http://127.0.0.1:8080', payload: 'http://127.0.0.1:8080' },
  { field: 'openalexMailto', before: '', text: 'me@example.com', payload: 'me@example.com' },
  { field: 'allowProxyFakeIp', before: 'false', text: 'true', payload: true },
  { field: 'timeoutMs', before: '30000', text: '45000', payload: 45_000 },
]

for (const item of CASES) {
  test(`round trip: ${item.field} loads, edits and saves the schema's own shape`, async () => {
    const { scope, controller } = harness()
    assert.equal(controller.snapshot().fields[item.field].text, item.before)
    controller.edit(item.field, item.text)
    assert.equal(controller.snapshot().invalid, false, controller.snapshot().fields[item.field].message)
    assert.equal(controller.snapshot().dirty, true)
    await controller.save()
    assert.equal(controller.snapshot().failed, false)
    assert.equal(controller.snapshot().dirty, false)

    const key = item.root ?? item.field
    assert.deepEqual(scope.writes, [`set:${key}`])
    assert.deepEqual(scope.user[key], item.payload)
    // The payload is something the schema takes, and the server reads back exactly what was meant.
    const parsed = (Config as unknown as (value: unknown) => unknown)({ [key]: item.payload })
    assert.ok(parsed)

    // Reload from the stored layer: the control shows the typed value, marked as overridden.
    const again = harness(BASE, { [key]: item.payload })
    assert.equal(again.controller.snapshot().fields[item.field].text, item.text.startsWith('{') ? JSON.stringify(JSON.parse(item.text), null, 2) : item.text)
    assert.equal(again.controller.snapshot().fields[item.field].overridden, true)
    again.controller.dispose()
    controller.dispose()
  })
}

test('a thresholds pair is two controls that save one object, and half a pair cannot be saved', async () => {
  const { scope, controller } = harness()
  controller.edit('evidence.coverage.thresholds.weak', '0.1')
  assert.equal(controller.snapshot().invalid, true)
  assert.match(controller.snapshot().fields['evidence.coverage.thresholds.covered'].message ?? '', /thresholds\.covered must be a number in 0\.\.1/)
  await controller.save()
  assert.deepEqual(scope.writes, [])

  controller.edit('evidence.coverage.thresholds.covered', '0.4')
  assert.equal(controller.snapshot().invalid, false)
  await controller.save()
  assert.deepEqual(scope.user.evidence, { coverage: { thresholds: { weak: 0.1, covered: 0.4 } } })
  const parsed = resolveConfig((Config as unknown as (value: unknown) => never)({ evidence: scope.user.evidence }))
  assert.deepEqual(parsed.evidence.coverage, { thresholds: { weak: 0.1, covered: 0.4 } })

  controller.edit('evidence.coverage.thresholds.weak', '0.9')
  assert.equal(controller.snapshot().invalid, true)
  assert.match(controller.snapshot().fields['evidence.coverage.thresholds.weak'].message ?? '', /weak must not exceed/)
  controller.dispose()
})

// ── legacy scorer / jevMode <-> judge.mode ──────────────────────────────────

test('judge mode keeps the legacy scorer / jevMode pair in step, and either reading means the same', async () => {
  const decide = (user: unknown) => configuredDecider(resolveConfig((Config as unknown as (value: unknown) => never)({ evidence: user })).evidence)

  const { scope, controller } = harness()
  controller.edit('evidence.judge.mode', 'control')
  await controller.save()
  assert.deepEqual(scope.user.evidence, { judge: { mode: 'control' }, jevMode: 'control', scorer: 'jev' })
  assert.equal(decide(scope.user.evidence).decides, 'model')
  // A reader that only knows the legacy pair gets the same answer.
  const legacy = { jevMode: 'control', scorer: 'jev' }
  assert.equal(decide(legacy).decides, 'model')

  controller.edit('evidence.judge.mode', 'shadow')
  await controller.save()
  assert.deepEqual(scope.user.evidence, { judge: { mode: 'shadow' }, jevMode: 'shadow', scorer: 'rule' })
  assert.equal(decide(scope.user.evidence).decides, 'rule')

  controller.edit('evidence.judge.mode', 'hybrid')
  await controller.save()
  assert.deepEqual(scope.user.evidence, { judge: { mode: 'hybrid' }, jevMode: 'hybrid', scorer: 'rule' })
  assert.equal(decide(scope.user.evidence).decides, 'hybrid')

  controller.edit('evidence.judge.mode', 'off')
  await controller.save()
  assert.deepEqual(scope.user.evidence, { judge: { mode: 'off' }, jevMode: 'off', scorer: 'rule' })

  controller.resetField('evidence.judge.mode')
  await controller.save()
  assert.equal(Object.hasOwn(scope.user, 'evidence'), false, 'resetting the mode removes all three keys and the emptied evidence object')
  controller.dispose()
})

test('a legacy-only settings file shows its mode, and editing it leaves no stale scorer behind', async () => {
  const { scope, controller } = harness(BASE, { evidence: { jevMode: 'control', scorer: 'jev', maxRounds: 3 } })
  const field = controller.snapshot().fields['evidence.judge.mode']
  assert.equal(field.text, 'control')
  assert.equal(field.overridden, true)
  controller.edit('evidence.judge.mode', 'hybrid')
  await controller.save()
  assert.deepEqual(scope.user.evidence, { judge: { mode: 'hybrid' }, jevMode: 'hybrid', scorer: 'rule', maxRounds: 3 })
  controller.dispose()
})

// ── roots keep what the card does not edit ──────────────────────────────────

test('saving one option writes its root once and carries the siblings the card does not know', async () => {
  const user = {
    evidence: { maxRounds: 3, somethingNew: { keep: true } },
    keyedSources: { tavily: { apiKey: 'literal-from-yaml', apiKeyEnv: 'T1' }, brave: { baseUrl: 'https://brave.example.com' } },
  }
  const { scope, controller } = harness(BASE, user)
  controller.edit('evidence.maxQueries', '5')
  controller.edit('keyedSources.tavily.baseUrl', 'https://tavily.example.com')
  await controller.save()
  assert.deepEqual(scope.writes.sort(), ['set:evidence', 'set:keyedSources'])
  assert.deepEqual(scope.user.evidence, { maxRounds: 3, somethingNew: { keep: true }, maxQueries: 5 })
  assert.deepEqual(scope.user.keyedSources, {
    tavily: { apiKey: 'literal-from-yaml', apiKeyEnv: 'T1', baseUrl: 'https://tavily.example.com' },
    brave: { baseUrl: 'https://brave.example.com' },
  })
  // The literal key is never a control and never shown.
  for (const field of Object.values(controller.snapshot().fields)) assert.doesNotMatch(field.text, /literal-from-yaml/)
  controller.dispose()
})

test('resetting removes the option, prunes what it leaves empty, and unsets an emptied root', async () => {
  const { scope, controller } = harness(BASE, { evidence: { coverage: { mode: 'shadow', provider: 'bocha-jev' } }, provider: { deadlineMs: 4000 } })
  controller.resetField('evidence.coverage.mode')
  controller.resetField('provider.deadlineMs')
  await controller.save()
  assert.deepEqual(scope.user.evidence, { coverage: { provider: 'bocha-jev' } })
  assert.equal(Object.hasOwn(scope.user, 'provider'), false)
  assert.deepEqual(scope.writes.sort(), ['set:evidence', 'unset:provider'])

  controller.resetField('evidence.coverage.provider')
  await controller.save()
  assert.equal(Object.hasOwn(scope.user, 'evidence'), false)
  controller.dispose()
})

test('an unchanged draft is not a change, and a failed Host write keeps the path drafts retryable', async () => {
  const { scope, controller } = harness()
  controller.edit('evidence.maxRounds', '3')
  controller.edit('evidence.maxRounds', '2')
  assert.equal(controller.snapshot().dirty, false)

  scope.set = async () => { throw new Error('host write rejected') }
  controller.edit('evidence.maxRounds', '3')
  await controller.save()
  assert.equal(controller.snapshot().failed, true)
  assert.equal(controller.snapshot().dirty, true)
  assert.equal(controller.snapshot().fields['evidence.maxRounds'].text, '3')
  controller.dispose()
})

test('values outside what a control accepts block the save', async () => {
  const { scope, controller } = harness()
  for (const [field, text] of [
    ['evidence.maxRounds', '0'], ['evidence.maxRounds', '1.5'], ['provider.evidence', 'maybe'], ['provider.deadlineMs', '50'],
    ['toolSurface', 'wide'], ['bochaBaseUrl', 'not a url'], ['bochaBaseUrl', 'https://user:pw@api.example.com'],
    ['bochaApiKeyEnv', 'has space'], ['keyedSources.tavily.apiKeyEnv', 'tvly sk 123'], ['openalexMailto', 'nobody'],
    ['evidence.judge.mode', 'always'], ['evidence.coverage.mode', 'hybrid'], ['evidence.budget.perSearchInputTokens', '-1'],
  ] as [SettingField, string][]) {
    controller.edit(field, text)
    assert.equal(controller.snapshot().fields[field].invalid, true, `${field} = ${text}`)
    assert.equal(controller.snapshot().invalid, true)
    controller.discard()
  }
  controller.edit('evidence.maxRounds', '0')
  await controller.save()
  assert.deepEqual(scope.writes, [])
  controller.dispose()
})

// ── credentials ─────────────────────────────────────────────────────────────

test('Bocha and keyed sources get write-only credentials that follow their saved reference', async () => {
  const { scope, credentialValues, described, controller } = harness(BASE, { keyedSources: { tavily: { apiKeyEnv: 'TAVILY_CUSTOM' } } })
  const refs = new Set(described.flat())
  for (const ref of ['EXA_API_KEY', 'JINA_API_KEY', 'GITHUB_TOKEN', 'BOCHA_SEARCH_API_KEY', 'BRAVE_API_KEY', 'LINKUP_API_KEY', 'SERPER_API_KEY', 'METASO_API_KEY', 'ZHIPU_API_KEY', 'QIANFAN_API_KEY', 'TAVILY_CUSTOM']) assert.ok(refs.has(ref), ref)
  assert.ok(!refs.has('TAVILY_API_KEY'), 'a saved reference replaces the default one')

  controller.editCredential('keyed:brave', 'brave-secret-for-test')
  controller.edit('bochaApiKeyEnv', 'BOCHA_OWN')
  controller.editCredential('bocha', 'bocha-secret-for-test')
  await controller.save()
  assert.equal(credentialValues.get('BRAVE_API_KEY'), 'brave-secret-for-test')
  assert.equal(credentialValues.get('BOCHA_OWN'), 'bocha-secret-for-test')
  assert.equal(controller.snapshot().credentials['keyed:brave'].configured, true)
  assert.equal(controller.snapshot().credentials['keyed:brave'].text, '')
  assert.equal(JSON.stringify(scope.user).includes('secret-for-test'), false, 'no key value reaches the settings')
  controller.dispose()
})
