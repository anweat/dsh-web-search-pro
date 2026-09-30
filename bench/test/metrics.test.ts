import test from 'node:test'
import assert from 'node:assert/strict'
import {
  averageRanks, brier, chooseDropThreshold, ece, evalThreshold, ndcgAtK, percentile, rocAuc, spearman,
} from '../src/metrics.ts'

const close = (a: number | undefined, b: number, eps = 1e-4): void => assert.ok(a !== undefined && Math.abs(a - b) < eps, a + ' != ' + b)

test('averageRanks: ties share the mean rank', () => {
  assert.deepEqual(averageRanks([10, 20, 20, 30]), [1, 2.5, 2.5, 4])
})

test('rocAuc: hand-computed fixture, ties and degenerate classes', () => {
  close(rocAuc([0.9, 0.8, 0.7, 0.6, 0.5], [true, true, false, true, false]), 5 / 6)
  close(rocAuc([0.5, 0.5, 0.5, 0.5], [true, false, true, false]), 0.5)
  close(rocAuc([0.1, 0.9], [true, false]), 0)
  assert.equal(rocAuc([0.1, 0.2], [true, true]), undefined)
})

test('chooseDropThreshold: highest t keeping >= 95% of positives', () => {
  const scores = [0.9, 0.8, 0.6, 0.4, 0.7, 0.1]
  const pos = [true, true, true, true, false, false]
  assert.equal(chooseDropThreshold(scores, pos, 0.75), 0.6)
  assert.equal(chooseDropThreshold(scores, pos, 0.95), 0.4)
  assert.equal(chooseDropThreshold(scores, pos, 0.25), 0.9)
  // 20 positives, 0.95 recall -> must keep 19 -> the 19th highest score.
  const s = Array.from({ length: 20 }, (_, i) => (i + 1) / 20)
  assert.equal(chooseDropThreshold(s, s.map(() => true), 0.95), 0.1)
  assert.equal(chooseDropThreshold([0.5], [false]), undefined)
})

test('evalThreshold: drop if prob < t', () => {
  const r = evalThreshold([0.9, 0.5, 0.3, 0.1], [true, true, true, false], 0.3)
  assert.equal(r.recall, 1)
  assert.equal(r.kept, 3)
  assert.equal(r.dropped, 0.25)
  const r2 = evalThreshold([0.9, 0.5, 0.3, 0.1], [true, true, true, false], 0.6)
  close(r2.recall, 1 / 3)
  assert.equal(r2.dropped, 0.75)
})

test('brier and ECE on small fixtures', () => {
  close(brier([1, 0, 0.5], [true, false, true]), 0.25 / 3)
  // bin [0.1,0.2): 2 items, conf 0.1, acc 0.5 -> 0.4*2; bin [0.9,1]: 2 items, conf 0.9, acc 1 -> 0.1*2
  close(ece([0.1, 0.1, 0.9, 0.9], [false, true, true, true]), 0.25)
  close(ece([1, 1], [true, true]), 0)
  assert.equal(ece([], []), undefined)
})

test('spearman: perfect, inverse, ties and constant input', () => {
  close(spearman([1, 2, 3, 4], [10, 20, 30, 40]), 1)
  close(spearman([1, 2, 3, 4], [1, 3, 2, 4]), 0.8)
  close(spearman([1, 2, 3], [3, 2, 1]), -1)
  close(spearman([1, 1, 2], [1, 2, 3]), 1.5 / Math.sqrt(3))
  assert.equal(spearman([1, 1, 1], [1, 2, 3]), undefined)
})

test('ndcgAtK: ranking, ties, relevant items missing from the pool', () => {
  const ideal2 = 1 + 1 / Math.log2(3)
  close(ndcgAtK([
    { score: 5, relevant: true }, { score: 4, relevant: false }, { score: 3, relevant: true },
    { score: 2, relevant: false }, { score: 1, relevant: false },
  ], 2), 1.5 / ideal2)
  // Two tied items, one relevant: average gain 0.5 at positions 1 and 2.
  close(ndcgAtK([{ score: 1, relevant: true }, { score: 1, relevant: false }], 1), 0.5 * (1 + 1 / Math.log2(3)))
  // Gold block not in the pool still counts in the ideal.
  close(ndcgAtK([{ score: 3, relevant: true }, { score: 1, relevant: false }], 2), 1 / ideal2)
  assert.equal(ndcgAtK([{ score: 1, relevant: false }], 0), undefined)
  // k cut-off: relevant item ranked 6th does not count.
  const items = Array.from({ length: 6 }, (_, i) => ({ score: 10 - i, relevant: i === 5 }))
  assert.equal(ndcgAtK(items, 1, 5), 0)
})

test('percentile: linear interpolation', () => {
  assert.equal(percentile([1, 2, 3, 4, 5], 50), 3)
  close(percentile([1, 2, 3, 4, 5], 95), 4.8)
  assert.equal(percentile([], 50), undefined)
})
