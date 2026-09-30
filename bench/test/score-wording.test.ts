import test from 'node:test'
import assert from 'node:assert/strict'
import { loadRubrics } from '../src/judges/rubrics.ts'
import { stateFor } from '../src/run-judges.ts'
import { JEV_CRITERIA, JEV_INSTRUCTIONS, JEV_MODEL, JEV_STATE_PREFIX, JevScorer } from '../../src/pipeline/score.ts'
import { JEV_MODEL as BENCH_JEV_MODEL } from '../src/judges/jev.ts'

test('the runtime Jev scorer uses the wording of rubric score.support.v1 and the r1 state line', () => {
  const rubric = loadRubrics().get('score.support.v1')!
  assert.equal(JEV_INSTRUCTIONS, rubric.instructions)
  assert.deepEqual([...JEV_CRITERIA], rubric.criteria)
  assert.equal(JEV_MODEL, BENCH_JEV_MODEL)
  assert.equal(new JevScorer({ apiKey: 'k' }).stateFor({ goal: 'G' }), stateFor({ goal: 'G' }))
  assert.equal(JEV_STATE_PREFIX + 'G', stateFor({ goal: 'G' }))
})
