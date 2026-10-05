import test from 'node:test'
import assert from 'node:assert/strict'
import { selectEvidence, computeCoverage, type SelectedBlock } from '../src/pipeline/select.ts'
import type { ScoredBlock } from '../src/pipeline/types.ts'

const task = { query: 'alpha beta gamma', needs: ['alpha', 'beta', 'gamma'].map((text, i) => ({ id: 'n' + i, text, critical: true })) }
const block = (id: string, text: string, grades: Record<string, number>, title = 'Doc'): ScoredBlock => ({
  candidateId: id, url: 'https://docs.test/', title, providers: ['ddg'],
  block: { blockId: id, hash: id, text, start: 0, end: text.length },
  grades: new Map(Object.entries(grades).map(([need, grade]) => [need, { grade, rank: grade }])),
})
// A deliberately simple injected counter: the selector must obey the supplied
// complete-output cost, even when metadata dominates or costs are non-additive.
const count = (items: readonly SelectedBlock[]): number => 10 + items.reduce((n, s) => n + s.excerpt.length + (s.block.title?.length ?? 0), 0)

test('token budget counts fixed output and metadata, while preserving the character ceiling', () => {
  const a = block('a', 'alpha.', { n0: 3 }, 'x'.repeat(100))
  const b = block('b', 'beta.', { n1: 3 })
  const selected = selectEvidence(task, [a, b], { tokenBudget: { maxTokens: 50, countTokens: count } })
  assert.deepEqual(selected.selected.map(s => s.block.block.blockId), ['b'])
  assert.equal(selected.usedTokens, count(selected.selected))
  assert.ok(selected.usedTokens! <= 50)
  assert.equal(selectEvidence(task, [b], { charBudget: 1, tokenBudget: { maxTokens: 50, countTokens: count } }).selected.length, 0)
})

test('token budget evaluates the entire proposal rather than adding individual token estimates', () => {
  const a = block('a', 'alpha.', { n0: 3 })
  const b = block('b', 'beta.', { n1: 3 })
  const whole = (items: readonly SelectedBlock[]): number => items.length === 2 ? 101 : 10 + items.length * 20
  const result = selectEvidence(task, [a, b], { tokenBudget: { maxTokens: 100, countTokens: whole } })
  assert.equal(result.selected.length, 1)
  assert.equal(result.usedTokens, 30)
})

test('greedy efficiency uses marginal output tokens and the legacy result omits token accounting', () => {
  const optional = { ...task, needs: task.needs.map(n => ({ ...n, critical: false })) }
  const a = block('a', 'alpha.', { n0: 3 }, 'x'.repeat(40))
  const b = block('b', 'beta has a longer excerpt.', { n1: 3 })
  const result = selectEvidence(optional, [a, b], { maxItems: 1, tokenBudget: { maxTokens: 100, countTokens: count } })
  assert.equal(result.selected[0]!.block, b)
  assert.ok(!('usedTokens' in selectEvidence(task, [a])))
})

test('original-block diversity cap allows two windows without admitting an extra original block', () => {
  const text = 'alpha is enabled. ' + 'Unrelated filler details remain here. '.repeat(15) + 'beta is disabled.'
  const both = block('both', text, { n0: 3, n1: 3 })
  const other = block('other', 'gamma is enabled.', { n2: 3 })
  const result = selectEvidence(task, [both, other], { maxExcerptChars: 60, maxPerUrl: 1, perUrlUnit: 'block', maxWindowsPerBlock: 2 })
  assert.equal(result.selected.length, 2)
  assert.ok(result.selected.every(s => s.block === both))
  const coverage = computeCoverage({ needs: task.needs, selected: result.selected, scored: [both, other], keptCandidates: 2, pagesRead: 1 })
  assert.deepEqual(coverage.covered, ['n0', 'n1'])
  assert.equal(coverage.gaps[0]!.needId, 'n2')
  assert.equal(selectEvidence(task, [both], { maxExcerptChars: 60, maxPerUrl: 1, perUrlUnit: 'block', maxWindowsPerBlock: 1 }).selected.length, 1)
})

test('token budgets fail explicitly on impossible overhead and invalid counters', () => {
  assert.throws(() => selectEvidence(task, [], { tokenBudget: { maxTokens: 9, countTokens: count } }), /fixed rendered-output overhead/)
  for (const maxTokens of [NaN, -1, 1.5, Infinity]) assert.throws(() => selectEvidence(task, [], { tokenBudget: { maxTokens, countTokens: count } }), /safe integer/)
  for (const value of [NaN, -1, 1.5, Infinity]) assert.throws(() => selectEvidence(task, [], { tokenBudget: { maxTokens: 100, countTokens: () => value } }), /counter/)
  assert.throws(() => selectEvidence(task, [], { perUrlUnit: 'block', maxWindowsPerBlock: 0 }), /positive safe integer/)
})

test('need-first anchoring preserves a Chinese condition displaced by the global query', () => {
  const task = { query: '重启条件 超时默认值', needs: [{ id: 'n0', text: '重启条件', critical: true }, { id: 'n1', text: '超时默认值', critical: true }] }
  const text = '仅在重启服务之后新的超时设置才会生效。' + 'Unrelated configuration details are described here. '.repeat(20) + '超时默认值为 3000 毫秒。'
  const both = block('both', text, { n0: 3, n1: 3 })
  const legacy = selectEvidence(task, [both])
  assert.ok(!legacy.selected.some(s => s.excerpt.includes('仅在重启服务之后新的超时设置才会生效。')))
  const result = selectEvidence(task, [both], { anchorNeedFirst: true })
  assert.ok(result.selected.some(s => s.needIds.includes('n0') && s.excerpt.includes('仅在重启服务之后新的超时设置才会生效。')))
  assert.ok(result.selected.some(s => s.needIds.includes('n1') && s.excerpt.includes('超时默认值为 3000 毫秒。')))
})

test('reservation budgets count the actual reservation metadata supplied to the renderer', () => {
  const a = block('a', 'alpha.', { n0: 3 })
  const counter = (items: readonly SelectedBlock[]): number => 10 + items.reduce((n, s) => n + (s.reason === 'reserved' ? 100 : 5), 0)
  const result = selectEvidence(task, [a], { tokenBudget: { maxTokens: 50, countTokens: counter } })
  assert.equal(result.selected[0]!.reason, 'greedy')
  assert.equal(result.usedTokens, 15)
})
