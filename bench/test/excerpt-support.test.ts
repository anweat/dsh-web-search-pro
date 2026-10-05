import test from 'node:test'
import assert from 'node:assert/strict'
import { evaluateExcerptSupport, normalizeSupportText } from '../src/excerpt-support.ts'
import type { EvidenceItem } from '../../src/pipeline/types.ts'
const item = (excerpt: string): EvidenceItem => ({ evidenceId: 'e', blockId: 'b', url: 'https://docs.test', excerpt, needIds: ['n'], grade: 3, source: 'ddg' })

test('excerpt support preserves values, negation and complete conditions while stripping markup', () => {
  assert.equal(normalizeSupportText('Default: `false`.\nIf [true](https://docs.test), it is not enabled.'), 'Default: false. If true, it is not enabled.')
  const requirement = [{ needId: 'n', alternatives: [['not supported unless explicitly enabled.']] }]
  const partial = { evidence: [item('This is not supported unless…')], coveredNeeds: ['n'] }
  assert.deepEqual(evaluateExcerptSupport(partial, requirement), [{ needId: 'n', supported: false, claimed: true, falseCovered: true }])
})

test('excerpt support ignores full-block IDs and metadata and does not mix incomplete alternatives', () => {
  const evidence = [{ ...item('alpha = true. beta = false.'), heading: 'gamma = 10.' }]
  const requirements = [
    { needId: 'n', alternatives: [['alpha = true.', 'beta = true.'], ['alpha = false.', 'beta = false.']] },
    { needId: 'm', alternatives: [['gamma = 10.']] },
  ]
  assert.ok(evaluateExcerptSupport({ evidence, coveredNeeds: ['n', 'm'] }, requirements).every(row => row.falseCovered))
})

test('support and declared coverage remain separate; empty requirements do not pass vacuously', () => {
  const result = evaluateExcerptSupport({ evidence: [item('alpha = true.')], coveredNeeds: [] }, [
    { needId: 'n', alternatives: [['alpha = true.']] }, { needId: 'm', alternatives: [[]] },
  ])
  assert.deepEqual(result.map(row => [row.supported, row.claimed, row.falseCovered]), [[true, false, false], [false, false, false]])
})
