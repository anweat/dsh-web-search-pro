import test from 'node:test'
import assert from 'node:assert/strict'
import { loadRubrics, renderQuestion, bindCandidate, validateRubric } from '../src/judges/rubrics.ts'
import { termsOf, weightedOverlap } from '../../src/pipeline/lexical.ts'
import { bucketGrade, checkConstraint, knownYear, RuleJudge } from '../src/judges/rule.ts'
import type { JudgeContext, JudgeItem } from '../src/judges/types.ts'

const rubrics = loadRubrics()
const rule = new RuleJudge()

const zhCtx: JudgeContext = {
  goal: '查 pnpm workspace 中 catalog 协议的配置方法和示例',
  query: 'pnpm-workspace.yaml catalog catalogs 协议 用法 示例',
  needs: ['catalog 在 pnpm-workspace.yaml 中的写法'],
  constraints: [
    { id: 'c1', kind: 'entity', value: 'pnpm', strength: 'hard' },
    { id: 'c2', kind: 'exclude_site', value: 'csdn.net', strength: 'hard' },
  ],
}
const enCtx: JudgeContext = {
  goal: 'Find how to set a busy timeout when using Node.js built-in node:sqlite DatabaseSync',
  query: 'node:sqlite DatabaseSync busy timeout',
  needs: ['How to configure a busy timeout for DatabaseSync'],
  constraints: [{ id: 'c1', kind: 'entity', value: 'node:sqlite', strength: 'hard' }],
}

const q = (id: string, ctx: JudgeContext, vars = {}) => renderQuestion(rubrics.get(id)!, vars, ctx)

test('rubrics: all bundled files validate and carry the required set', () => {
  for (const id of ['gate.single.v1', 'gate.relevance.v1', 'gate.constraint.v1', 'gate.nav.v1', 'score.support.v1', 'profile.choice.v1']) {
    assert.ok(rubrics.has(id), id)
    assert.equal(rubrics.get(id)!.lang, 'zh')
  }
  assert.equal(rubrics.get('score.support.v1')!.criteria!.length, 4)
  assert.equal(Object.keys(rubrics.get('profile.choice.v1')!.options!).length, 6)
  assert.equal(rubrics.get('gate.single.v1')!.kind, 'noul')
})

test('rubrics: variable whitelist and candidate binding', () => {
  assert.ok(validateRubric({ id: 'x.v1', version: 'v1', lang: 'zh', kind: 'noul', description: 'd', instructions: '{evil} {candidate}' }).some(e => e.includes('{evil}')))
  const question = q('gate.relevance.v1', enCtx, { need: '需求 A' })
  assert.match(question.instructions, /需求：需求 A/)
  assert.ok(question.instructions.includes('{candidate}'))
  const bound = bindCandidate(question.instructions, 'price $& and $1')
  assert.ok(bound.endsWith('price $& and $1'))
})

test('lexical: Chinese bigrams and Latin tokens', () => {
  const t = termsOf('如何配置 node:sqlite 的 busy timeout')
  assert.ok(t.has('配置'))
  assert.ok(!t.has('如何'))
  assert.ok(t.has('node:sqlite') && t.has('sqlite') && t.has('busy') && t.has('timeout'))
  assert.ok(weightedOverlap([{ text: '数据库 连接池', weight: 1 }], '连接池的数据库配置') > 0.8)
  assert.equal(weightedOverlap([{ text: '', weight: 1 }], 'abc'), 0)
})

test('rule judge: Chinese relevance orders relevant above irrelevant and is deterministic', async () => {
  const items: JudgeItem[] = [
    { id: 'good', text: 'pnpm catalog 协议：在 pnpm-workspace.yaml 中用 catalog 字段集中声明依赖版本，示例如下', meta: { url: 'https://pnpm.io/zh/catalogs', title: 'Catalogs | pnpm' } },
    { id: 'bad', text: '今天天气不错，适合出门散步和拍照', meta: { url: 'https://example.com/weather', title: '天气' } },
    { id: 'csdn', text: 'pnpm catalog 协议：在 pnpm-workspace.yaml 中用 catalog 字段集中声明依赖版本', meta: { url: 'https://blog.csdn.net/x/1', title: 'pnpm catalog' } },
  ]
  const a = await rule.evaluate('', q('gate.single.v1', zhCtx), items)
  const b = await rule.evaluate('', q('gate.single.v1', zhCtx), items)
  assert.deepEqual(a, b)
  assert.ok(a[0]!.prob! > 0.4, String(a[0]!.prob))
  assert.ok(a[1]!.prob! < 0.1, String(a[1]!.prob))
  // the exclude_site violation cuts the score of an otherwise identical text
  assert.ok(a[2]!.prob! < a[0]!.prob! * 0.5)
  const rel = await rule.evaluate('', q('gate.relevance.v1', zhCtx), items)
  assert.ok(rel[0]!.prob! > rel[1]!.prob!)
  assert.equal(a[0]!.judge, 'rule')
  assert.equal(a[0]!.rubricVersion, 'v1')
})

test('rule judge: English relevance and bucketed grades', async () => {
  const items: JudgeItem[] = [
    { id: 'good', text: 'DatabaseSync options.timeout: the busy timeout in milliseconds. node:sqlite configure busy timeout', meta: { heading: 'DatabaseSync' } },
    { id: 'near', text: 'SQLite PRAGMA busy_timeout sets how long to wait when the database is locked', meta: {} },
    { id: 'bad', text: 'Recipe for sourdough bread with rye flour', meta: {} },
  ]
  const res = await rule.evaluate('', q('score.support.v1', enCtx, { need: enCtx.needs[0] }), items)
  assert.equal(res[0]!.grade, 3)
  assert.ok(res[1]!.grade! <= 2)
  assert.equal(res[2]!.grade, 0)
  assert.equal(bucketGrade(0), 0)
  assert.equal(bucketGrade(0.2), 1)
  assert.equal(bucketGrade(0.4), 2)
  assert.equal(bucketGrade(0.9), 3)
})

test('rule constraint checks: site / exclude_site / exclude_term / must_term / version / language', () => {
  const item = (text: string, meta: Record<string, string> = {}): JudgeItem => ({ id: 'i', text, meta })
  const c = (kind: string, value: string) => ({ id: 'c', kind, value, strength: 'hard' }) as never
  assert.equal(checkConstraint(c('site', 'github.com'), item('x', { url: 'https://github.com/a/b' })).satisfied, 'yes')
  assert.equal(checkConstraint(c('site', 'github.com'), item('x', { url: 'https://gist.github.com/a' })).satisfied, 'yes')
  assert.equal(checkConstraint(c('site', 'github.com'), item('x', { url: 'https://notgithub.com/a' })).satisfied, 'no')
  assert.equal(checkConstraint(c('exclude_site', 'csdn.net'), item('x', { url: 'https://blog.csdn.net/a' })).satisfied, 'no')
  assert.equal(checkConstraint(c('exclude_site', 'csdn.net'), item('x', { url: 'https://pnpm.io/' })).satisfied, 'yes')
  assert.equal(checkConstraint(c('site', 'github.com'), item('x')).satisfied, 'unknown')
  assert.equal(checkConstraint(c('exclude_term', '广告'), item('这是一则广告')).satisfied, 'no')
  assert.equal(checkConstraint(c('must_term', 'busy timeout'), item('set the busy timeout option')).satisfied, 'yes')
  assert.equal(checkConstraint(c('must_term', 'busy timeout'), item('completely unrelated text here')).satisfied, 'no')
  assert.equal(checkConstraint(c('version', 'Node.js >=22'), item('Added in v22.5.0, node 22')).satisfied, 'yes')
  assert.equal(checkConstraint(c('version', 'Python 3.13'), item('Python 3.130 notes')).satisfied, 'unknown')
  assert.equal(checkConstraint(c('language', 'zh'), item('这是一段足够长的中文说明文字内容')).satisfied, 'yes')
  assert.equal(checkConstraint(c('language', 'zh'), item('This is a long enough English sentence here')).satisfied, 'no')
  assert.equal(checkConstraint(c('region', 'CN'), item('x')).satisfied, 'unknown')
})

test('rule constraint checks: time_window only with a known date', () => {
  const c = { id: 'c', kind: 'time_window', value: '2024 年以后', strength: 'hard' } as never
  assert.equal(checkConstraint(c, { id: 'i', text: 'x', meta: { publishedAt: '2025-03-01' } }).satisfied, 'yes')
  assert.equal(checkConstraint(c, { id: 'i', text: 'x', meta: { publishedAt: 'Tue, 02 Jan 2018 10:00:00 GMT' } }).satisfied, 'no')
  assert.equal(checkConstraint(c, { id: 'i', text: 'x', meta: { url: 'https://a.com/2019/05/post' } }).satisfied, 'no')
  assert.equal(checkConstraint(c, { id: 'i', text: 'no dates at all', meta: {} }).satisfied, 'unknown')
  assert.equal(knownYear({ id: 'i', text: 'posted 2023年7月 here' }), 2023)
})

test('rule judge: nav and profile rubrics', async () => {
  const nav = await rule.evaluate('', q('gate.nav.v1', enCtx), [
    { id: 'home', text: 'Welcome', meta: { url: 'https://example.com/', title: 'Home' } },
    { id: 'search', text: 'results', meta: { url: 'https://example.com/search?q=foo', title: 'Search results for foo' } },
    { id: 'post', text: 'article body', meta: { url: 'https://example.com/blog/how-to-x', title: 'How to X' } },
  ])
  assert.ok(nav[0]!.prob! >= 0.5 && nav[1]!.prob! >= 0.8 && nav[2]!.prob! === 0)
  const prof = await rule.evaluate('', renderQuestion(rubrics.get('profile.choice.v1')!, {}), [
    { id: 't1', text: '对比 Bun 和 Node.js 的区别，哪个更适合选型' },
    { id: 't2', text: 'arxiv 论文综述：大模型推理研究' },
    { id: 't3', text: '今天吃什么' },
  ])
  assert.equal(prof[0]!.decision, 'compare')
  assert.equal(prof[1]!.decision, 'academic')
  assert.equal(prof[2]!.decision, 'general')
})

test('rule judge: constraint rubric uses the question constraint', async () => {
  const ctx: JudgeContext = { ...enCtx, constraint: { id: 'c9', kind: 'exclude_term', value: 'sqlite3', strength: 'hard' } }
  const res = await rule.evaluate('', q('gate.constraint.v1', ctx, { constraint: 'x' }), [
    { id: 'a', text: 'using the sqlite3 package' }, { id: 'b', text: 'using node:sqlite' },
  ])
  assert.equal(res[0]!.prob, 0)
  assert.ok(res[1]!.prob! > 0.8)
})
