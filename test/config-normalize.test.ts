import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Config, resolveConfig } from '../src/config.ts'
import { resolveCoverageSettings } from '../src/pipeline/coverage.ts'
import { resolveProviders } from '../src/pipeline/judges/providers.ts'
import { resolveAllRubrics } from '../src/pipeline/rubrics.ts'

const GOOD = { protocol: 'systemone', baseUrl: 'https://jev.example.com', model: 'm1', keyRef: 'MY_JEV_KEY' }
const parse = (value: unknown) => resolveConfig((Config as unknown as (input: unknown) => never)(value))

test('rubric overrides written through the real schema parse reach the validator without fillers', () => {
  // schemastery fills the empty containers it was not given (criteria: [], calibration: { points: [] }, price: {}, thresholds: {});
  // resolveConfig takes them out, so the entries the card writes are applied by the server.
  const parsed = (Config as unknown as (value: unknown) => never)({
    evidence: {
      rubrics: { 'gate.relevance': { version: 'v2', instructions: 'Is {candidate} about {need}?' } },
      judge: { providers: { mine: GOOD } },
      coverage: { mode: 'shadow' },
    },
  })
  const evidence = resolveConfig(parsed).evidence
  assert.deepEqual(resolveAllRubrics(evidence.rubrics).diagnostics, [])
  assert.equal(resolveAllRubrics(evidence.rubrics).rubrics.find(r => r.id === 'gate.relevance')!.version, 'v2')
  assert.deepEqual(resolveProviders(evidence.judge).diagnostics, [])
  assert.deepEqual(evidence.coverage, { mode: 'shadow' })
  assert.deepEqual(evidence.judge!.providers!.mine, GOOD)
})


test('the schema fillers are removed only where the schema puts them, never inside user data', () => {
  const ev = parse({
    evidence: {
      judge: { providers: { mine: { ...GOOD, extraBody: { stop: [], nested: {} }, limits: { blockChars: 500 } }, local: { protocol: 'systemone', baseUrl: 'http://127.0.0.1:8765', model: 'x', calibration: { version: 'v1', points: [[0, 0], [1, 3]] } } } },
      budget: { dailyInputTokens: 10 },
    },
  }).evidence
  assert.deepEqual(ev.judge!.providers!.mine, { ...GOOD, extraBody: { stop: [], nested: {} }, limits: { blockChars: 500 } })
  assert.deepEqual(ev.judge!.providers!.local!.calibration, { version: 'v1', points: [[0, 0], [1, 3]] })
  assert.deepEqual(resolveProviders(ev.judge).diagnostics, [])
  assert.equal(ev.budget!.dailyInputTokens, 10)
  // Nothing configured: no diagnostics from the empty containers.
  const none = parse({}).evidence
  assert.deepEqual(resolveCoverageSettings(none.coverage), { settings: { mode: 'off' }, diagnostics: [] })
  assert.deepEqual(resolveProviders(none.judge).diagnostics, [])
})
