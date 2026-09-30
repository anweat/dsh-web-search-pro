import test from 'node:test'
import assert from 'node:assert/strict'
import { computeCoverage, DEFAULT_SELECT_OPTIONS, excerptOf, selectEvidence, sentenceRanges } from '../src/pipeline/select.ts'
import type { BlockGrade, Need, ScoredBlock } from '../src/pipeline/types.ts'

const needs: Need[] = [{ id: 'n1', text: 'busy timeout', critical: true }, { id: 'n2', text: 'WAL mode', critical: true }, { id: 'n3', text: 'extra trivia', critical: false }]
let counter = 0
function sb(url: string, text: string, grades: Record<string, number>, over: { hash?: string; heading?: string; title?: string } = {}): ScoredBlock {
  const id = 'b' + ++counter
  return {
    candidateId: 'c_' + url, url, title: over.title ?? url, providers: ['ddg'],
    block: { blockId: id, text, start: 0, end: text.length, hash: over.hash ?? 'h' + id, ...over.heading ? { heading: over.heading } : {} },
    grades: new Map(Object.entries(grades).map(([k, v]): [string, BlockGrade] => [k, { grade: v, rank: v }])),
  }
}
const pad = (prefix: string, n: number): string => prefix + ' ' + ('word '.repeat(n)).trim() + '.'
const task = { query: 'sqlite busy timeout wal', needs }

test('sentenceRanges splits CJK and Latin sentences and lines but not decimals or versions', () => {
  const text = '版本 3.5 发布了。它不支持旧接口！Use v1.2.3 now. Really?\nnext line'
  const parts = sentenceRanges(text).map(r => text.slice(r.start, r.end))
  assert.deepEqual(parts, ['版本 3.5 发布了。', '它不支持旧接口！', 'Use v1.2.3 now.', 'Really?', 'next line'])
})

test('excerpt: short blocks are kept whole, long ones become the most relevant run of sentences', () => {
  assert.equal(excerptOf('  short text. ', [{ text: 'x', weight: 1 }], 600), 'short text.')
  const filler = Array.from({ length: 12 }, (_, i) => 'Filler sentence number ' + i + ' says nothing useful here.').join(' ')
  const key = 'Set PRAGMA busy_timeout = 5000 so the busy timeout is 5 seconds, not 0.'
  const text = filler + ' ' + key + ' ' + filler
  const out = excerptOf(text, [{ text: 'busy timeout pragma', weight: 1.6 }], 300)
  assert.ok(out.length <= 302)
  assert.ok(out.includes(key), 'the relevant sentence survives intact')
  assert.ok(out.startsWith('…') && out.endsWith('…'))
  // the cut never lands inside a sentence
  for (const piece of out.replace(/^…|…$/g, '').split(/(?<=\.)\s+/)) assert.ok(/\.$/.test(piece), piece)
})

test('excerpt: a single over-long sentence is cut at a boundary, not inside a number or after a negation', () => {
  const parts = [{ text: 'range limit', weight: 1 }]
  // whitespace boundary before the number run that would not fit
  assert.equal(excerptOf('x'.repeat(40) + ' version 12345678 is required for this feature to work at all in every configuration we tested', [{ text: 'version', weight: 1 }], 57), 'x'.repeat(40) + ' version…')
  assert.equal(excerptOf('The value between 1000 and 5000 is the allowed range, and more is not allowed at all times ok', parts, 50), 'The value between 1000 and 5000 is the allowed…')
  // a clause boundary is preferred over the last space
  const clause = 'The limit applies to every connection opened by the process, and it is configured through the pragma interface which accepts values'
  assert.equal(excerptOf(clause, parts, 100), 'The limit applies to every connection opened by the process,…')
  // the cut never leaves a dangling negation
  const negOut = excerptOf('word '.repeat(9) + 'does not apply to attached databases unless the flag is set explicitly by the caller', [{ text: 'flag', weight: 1 }], 55)
  assert.ok(!/\b(not|no)…$/.test(negOut), negOut)
  const cjk = '因为配置项默认关闭所以不会生效，除非显式设置为开启状态并且重启服务进程后才能让新的超时设置真正作用于所有连接'
  assert.equal(excerptOf(cjk, [{ text: '超时', weight: 1 }], 40), '因为配置项默认关闭所以不会生效，除非显式设置为开启状态并且重启服务进程后才能让…')
  const cjkNeg = '这个参数设置之后会立刻对全部连接生效但是如果你没有重启服务进程那么新的超时设置就不会真正作用于现有连接'
  assert.ok(!/(不|没)…$/.test(excerptOf(cjkNeg, [{ text: '超时', weight: 1 }], 28)))
})

test('select: greedy fill stays within the character budget and the item cap', () => {
  const blocks = Array.from({ length: 30 }, (_, i) => sb('https://site' + i + '.test/p', pad('Busy timeout note ' + i, 40) + ' uniq' + i, { n1: 2.5, n2: 2, n3: 0 }))
  const res = selectEvidence(task, blocks, { charBudget: 1000 })
  assert.ok(res.usedChars <= 1000)
  assert.equal(res.usedChars, res.selected.reduce((s, x) => s + x.excerpt.length, 0))
  assert.ok(res.selected.length >= 3 && res.selected.length < 8)
  const capped = selectEvidence(task, blocks, { charBudget: 100_000, maxItems: 4 })
  assert.equal(capped.selected.length, 4)
  assert.deepEqual(selectEvidence(task, blocks, { charBudget: 10 }).selected, [], 'nothing fits a tiny budget')
})

test('select: every critical need with a grade>=2 block is reserved before greedy filling', () => {
  // Many cheap, high-grade blocks for n1 would fill a small budget; the only n2 block is long and lower graded.
  const cheap = Array.from({ length: 8 }, (_, i) => sb('https://n1-' + i + '.test/', 'busy timeout ' + i + ' short.', { n1: 3 }))
  const n2 = sb('https://wal.test/', pad('WAL mode enables concurrent readers', 60), { n2: 2 })
  const res = selectEvidence(task, [...cheap, n2], { charBudget: 500, maxItems: 10 })
  assert.ok(res.selected.some(s => s.block === n2), 'the n2 block is in')
  assert.equal(res.selected.find(s => s.block === n2)!.reason, 'reserved')
  assert.equal(res.selected[0]!.reason, 'reserved')
  // A non-critical need is not reserved for: n3 only gets what greedy decides.
  const n3 = sb('https://trivia.test/', pad('Extra trivia', 40), { n3: 3 })
  const again = selectEvidence(task, [...cheap, n3], { charBudget: 100 })
  assert.ok(!again.selected.some(s => s.block === n3) || again.selected.find(s => s.block === n3)!.reason === 'greedy')
})

test('select: no reservation without a grade>=2 block; a weak block only serves a still-uncovered need', () => {
  const weak = sb('https://weak.test/', 'busy timeout mentioned in passing.', { n1: 1.4 })
  const res = selectEvidence(task, [weak])
  assert.equal(res.selected.length, 1)
  assert.equal(res.selected[0]!.reason, 'greedy')
  const strong = sb('https://strong.test/', 'Busy timeout is set by PRAGMA busy_timeout.', { n1: 3 })
  const both = selectEvidence(task, [weak, strong])
  assert.deepEqual(both.selected.map(s => s.block), [strong], 'once n1 is covered the weak block adds nothing')
  assert.deepEqual(selectEvidence(task, [sb('https://zero.test/', 'nothing', { n1: 0.4, n2: 0 })]).selected, [], 'below minGrade is never eligible')
})

test('select: at most four blocks per URL by default, duplicates by hash or near-identical text are skipped', () => {
  const same = Array.from({ length: 5 }, (_, i) => sb('https://one.test/doc', 'Distinct busy timeout paragraph number ' + i + ' ' + 'unique' + i.toString().repeat(3) + ' about pragma values.', { n1: 3 }))
  assert.equal(selectEvidence(task, same).selected.length, 4)
  assert.equal(selectEvidence(task, same, { maxPerUrl: 2 }).selected.length, 2)
  const a = sb('https://a.test/', 'Identical repost of the busy timeout paragraph.', { n1: 3 }, { hash: 'same' })
  const b = sb('https://b.test/', 'Identical repost of the busy timeout paragraph.', { n1: 3 }, { hash: 'same' })
  assert.equal(selectEvidence(task, [a, b]).selected.length, 1, 'same hash')
  const c = sb('https://c.test/', 'The busy timeout paragraph is an identical repost of it.', { n1: 3 })
  const d = sb('https://d.test/', 'Identical repost of the busy timeout paragraph, reposted.', { n1: 3 })
  assert.equal(selectEvidence(task, [c, d]).selected.length, 1, 'near-identical text')
})

test('select: a block supporting several needs lists them best first and covers both', () => {
  const both = sb('https://both.test/', 'PRAGMA busy_timeout and journal_mode=WAL go together.', { n1: 2.4, n2: 3 })
  const res = selectEvidence(task, [both])
  assert.deepEqual(res.selected[0]!.needIds, ['n2', 'n1'])
  assert.equal(res.selected[0]!.grade, 3)
})

test('coverage: covered needs need a selected block of grade>=2; gaps say why', () => {
  const strong = sb('https://s.test/', 'busy timeout answer', { n1: 3, n2: 1.2, n3: 0 })
  const left = sb('https://l.test/', 'wal answer left out by budget', { n2: 2.6 })
  const opts = { needs, scored: [strong, left], keptCandidates: 4, pagesRead: 2 }
  const selected = selectEvidence(task, [strong]).selected
  const cov = computeCoverage({ ...opts, selected })
  assert.deepEqual(cov.covered, ['n1'])
  assert.deepEqual(cov.gaps.map(g => [g.needId, g.reason, g.critical]), [['n2', 'budget', true], ['n3', 'weak_support', false]])
  assert.equal(cov.gaps[0]!.bestGrade, 2.6)
  assert.deepEqual(computeCoverage({ needs, selected: [], scored: [], keptCandidates: 0, pagesRead: 0 }).gaps.map(g => g.reason), ['no_candidates', 'no_candidates', 'no_candidates'])
  assert.deepEqual(computeCoverage({ needs, selected: [], scored: [], keptCandidates: 3, pagesRead: 0 }).gaps.map(g => g.reason), ['no_page_content', 'no_page_content', 'no_page_content'])
  assert.equal(computeCoverage({ needs, selected: [], scored: [], keptCandidates: 3, pagesRead: 0 }).gaps[0]!.bestGrade, undefined)
  assert.equal(DEFAULT_SELECT_OPTIONS.coverGrade, 2)
})
