import test from 'node:test'
import assert from 'node:assert/strict'
import { alignedRelevance, detectLang, languagesDiffer, latinTermsOf } from '../src/pipeline/align.ts'
import { bucketGrade, RuleScorer, type ScoreJob, type ScoreTask } from '../src/pipeline/score.ts'

// The M2c end-to-end run: Chinese need, English Bun reference block.
const REAL_NEED = 'DatabaseSync 构造参数中的 timeout 选项'
const REAL_QUERY = 'node:sqlite DatabaseSync busy timeout 设置'
const REAL_BLOCK = { blockId: 'opt', url: 'https://bun.test/docs/sqlite', heading: 'sqlite.DatabaseSyncOptions', text: 'sqlite.DatabaseSyncOptions.timeout — timeout?: number — The busy timeout in milliseconds. Default: 0.' }
const task = (over: Partial<ScoreTask> = {}): ScoreTask => ({
  goal: '了解 node:sqlite 里 DatabaseSync 如何设置 busy timeout', query: REAL_QUERY,
  needs: [{ id: 'n1', text: REAL_NEED, critical: true }], constraints: [], ...over,
})
const job = (t: ScoreTask, blocks: typeof REAL_BLOCK[]): ScoreJob => ({ need: t.needs[0]!, blocks })
const gradeOf = async (t: ScoreTask, block: typeof REAL_BLOCK, scorer = new RuleScorer()) => (await scorer.score(t, [job(t, [block])])).grades.get('n1')!.get(block.blockId)!

test('detectLang: zh vs latin by character ratio, identifiers do not turn a Chinese sentence Latin', () => {
  assert.equal(detectLang('如何设置 busy timeout'), 'zh')
  assert.equal(detectLang(REAL_NEED), 'zh')
  assert.equal(detectLang('The busy timeout in milliseconds, see DatabaseSyncOptions.timeout'), 'latin')
  assert.equal(detectLang('English page with a short 中文 title and a lot more English text following it afterwards'), 'latin')
  assert.equal(detectLang('这个选项用于设置超时时间，单位是毫秒。'), 'zh')
  assert.equal(detectLang('1234 -- 56.7'), 'none')
  assert.equal(detectLang(''), 'none')
  assert.equal(languagesDiffer(REAL_NEED, REAL_BLOCK.text), true)
  assert.equal(languagesDiffer('busy timeout option', REAL_BLOCK.text), false)
  assert.equal(languagesDiffer('12345', REAL_BLOCK.text), false, 'an undetectable side never counts as a mismatch')
})

test('latinTermsOf: identifiers split on separators and camelCase, normal form ignores separators', () => {
  const terms = latinTermsOf('DatabaseSyncOptions.timeout busy_timeout node:sqlite')
  for (const t of ['databasesyncoptions', 'databasesyncoptionstimeout', 'timeout', 'busytimeout', 'busy', 'database', 'sync', 'options', 'node', 'sqlite', 'nodesqlite']) assert.ok(terms.has(t), t)
  assert.ok(latinTermsOf('busyTimeout').has('busytimeout'))
  assert.ok(latinTermsOf('busyTimeout').has('timeout'))
  assert.ok(!latinTermsOf('the use of a').size, 'stop words carry nothing')
  assert.ok(latinTermsOf('HTTPServer').has('server') && latinTermsOf('HTTPServer').has('http'))
})

test('real example: the English DatabaseSyncOptions.timeout block now answers the Chinese need (grade >= 2; lexical-v1 gave 1)', async () => {
  const t = task()
  const v1 = await gradeOf(t, REAL_BLOCK, new RuleScorer({ align: false }))
  const v2 = await gradeOf(t, REAL_BLOCK)
  assert.equal(v1.grade, 1, 'the structural miss this milestone fixes')
  assert.ok(v2.grade >= 2, 'relevance ' + v2.rank)
  assert.ok(v2.rank! > v1.rank!)
})

test('alignment works from the need alone and from hard constraint values when the query carries no Latin terms', async () => {
  const bare = task({ query: '构造参数 选项 设置', goal: '了解构造参数中的选项' })
  const needOnly = await gradeOf(bare, REAL_BLOCK)
  assert.ok(needOnly.grade >= 2, 'need identifiers DatabaseSync + timeout are enough: ' + needOnly.rank)
  const weak = task({ query: '选项 设置', goal: '了解选项', needs: [{ id: 'n1', text: '选项 超时', critical: true }] })
  const none = await gradeOf(weak, REAL_BLOCK)
  assert.ok(none.grade <= 1, 'no Latin term anywhere: nothing to align')
  const withConstraint = task({ query: '选项 设置', goal: '了解选项', needs: [{ id: 'n1', text: '选项 超时', critical: true }], constraints: [{ id: 'c1', kind: 'must_term', value: 'timeout', strength: 'hard', origin: 'param' }, { id: 'c2', kind: 'entity', value: 'DatabaseSyncOptions', strength: 'hard', origin: 'param' }] })
  const lifted = await gradeOf(withConstraint, REAL_BLOCK)
  assert.ok(lifted.rank! > none.rank!, 'hard entity / must_term values join the Latin terms')
})

test('identifier credit: exact piece matches and prefix containment, but a lone shared generic word stays low', async () => {
  const exact = alignedRelevance({ goal: '', query: '', need: '设置 options.timeout', constraints: [] }, { text: 'sqlite.DatabaseSyncOptions.timeout controls waiting' })
  const miss = alignedRelevance({ goal: '', query: '', need: '设置 options.timeout', constraints: [] }, { text: 'sqlite controls waiting' })
  assert.ok(exact > miss)
  const contained = alignedRelevance({ goal: '', query: '', need: '构造 DatabaseSync', constraints: [] }, { text: 'new DatabaseSyncOptions(path)' })
  const absent = alignedRelevance({ goal: '', query: '', need: '构造 DatabaseSync', constraints: [] }, { text: 'new Connection(path)' })
  assert.ok(contained > absent, 'DatabaseSync inside DatabaseSyncOptions earns partial credit')
  // one generic word must not reach grade 2 (shrink when Latin weight is thin)
  const t = task({ query: '超时时间 设置', goal: '超时设置', needs: [{ id: 'n1', text: '配置超时 timeout', critical: true }] })
  const lone = await gradeOf(t, { blockId: 'x', url: 'u', text: 'Today we talk about cooking and the timeout for the eggs on the stove.' })
  assert.ok(lone.grade <= 1, 'relevance ' + lone.rank)
})

test('an unrelated English block stays low against the Chinese need', async () => {
  const t = task()
  for (const text of ['Bun implements a fast package manager and a bundler. Install dependencies with bun install.', 'The weather is nice today and we will walk in the park.']) {
    const g = await gradeOf(t, { blockId: 'u', url: 'u', text })
    assert.ok(g.grade <= 1, text + ' -> ' + g.rank)
  }
})

test('same-language pairs keep the lexical-v1 relevance exactly', async () => {
  const en = task({ needs: [{ id: 'n1', text: 'how to set busy timeout in DatabaseSync', critical: true }], query: 'node:sqlite busy timeout', goal: 'set busy timeout' })
  for (const block of [REAL_BLOCK, { blockId: 'p', url: 'u', text: 'Use PRAGMA busy_timeout = 5000 on the DatabaseSync connection to set the busy timeout.' }]) {
    assert.deepEqual(await gradeOf(en, block), await gradeOf(en, block, new RuleScorer({ align: false })))
  }
  const zh = task({ query: '设置 超时', needs: [{ id: 'n1', text: '如何设置超时时间', critical: true }] })
  const zhBlock = { blockId: 'z', url: 'u', text: '可以通过 timeout 参数设置超时时间，单位是毫秒。' }
  assert.deepEqual(await gradeOf(zh, zhBlock), await gradeOf(zh, zhBlock, new RuleScorer({ align: false })))
  assert.equal(bucketGrade((await gradeOf(zh, zhBlock)).rank!), (await gradeOf(zh, zhBlock)).grade)
})

test('RuleScorer model names distinguish the aligned scorer from lexical-v1', () => {
  assert.equal(new RuleScorer().model, 'lexical-v2-aligned')
  assert.equal(new RuleScorer({ align: false }).model, 'lexical-v1')
})
