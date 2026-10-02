import test from 'node:test'
import assert from 'node:assert/strict'
import { loadRubrics } from '../src/judges/rubrics.ts'
import { stateFor } from '../src/run-judges.ts'
import { builtinRubric } from '../../src/pipeline/rubrics.ts'
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

test('the built-in rubric registry (src/pipeline/rubrics.ts) is the wording of bench/rubrics/*.v1.json', () => {
  const bench = loadRubrics()
  for (const id of ['score.support', 'gate.relevance', 'gate.constraint']) {
    const built = builtinRubric(id)
    const file = bench.get(id + '.v1')!
    assert.equal(built.version, 'v1')
    assert.equal(built.kind, file.kind)
    assert.equal(built.instructions, file.instructions, id)
    assert.deepEqual(built.criteria === undefined ? undefined : [...built.criteria], file.criteria)
    assert.equal(built.description, file.description)
  }
})
