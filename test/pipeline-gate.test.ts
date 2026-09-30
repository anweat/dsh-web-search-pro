import test from 'node:test'
import assert from 'node:assert/strict'
import { candidateIdOf } from '../src/pipeline/candidates.ts'
import {
  checkConstraint, DEFAULT_RELEVANCE_THRESHOLD, gateCandidates, gateItem, isDefiniteViolation, keptCandidates, knownDate, lexicalRelevance,
  relevanceContextOf,
} from '../src/pipeline/gate.ts'
import { hanRatio, termsOf, weightedOverlap } from '../src/pipeline/lexical.ts'
import type { Candidate, Constraint, TaskSpec } from '../src/pipeline/types.ts'

const NOW = new Date('2026-10-01T00:00:00Z')

const task = (overrides: Partial<TaskSpec> & Pick<TaskSpec, 'query' | 'constraints'>): TaskSpec => ({
  goal: overrides.goal ?? overrides.query,
  needs: overrides.needs ?? [{ id: 'n1', text: overrides.query, critical: true }],
  budget: {}, ...overrides,
})
const constraint = (id: string, kind: Constraint['kind'], value: string, strength: Constraint['strength'] = 'hard'): Constraint => ({ id, kind, value, strength, origin: 'param' })
const candidate = (url: string, title: string, snippet: string, publishedAt?: string): Candidate => ({
  candidateId: candidateIdOf(url), canonicalUrl: url, url, title, snippet, ...publishedAt ? { publishedAt } : {}, contributions: [{ providerId: 'ddg', rank: 1, query: 'q' }],
})

test('lexical: CJK bigrams and Latin tokens, stop characters ignored', () => {
  const t = termsOf('如何配置 node:sqlite 的 busy timeout')
  assert.ok(t.has('配置') && !t.has('如何'))
  assert.ok(t.has('node:sqlite') && t.has('sqlite') && t.has('busy') && t.has('timeout'))
  assert.ok(weightedOverlap([{ text: '数据库 连接池', weight: 1 }], '连接池的数据库配置') > 0.8)
  assert.ok(Math.abs(hanRatio('中文 text') - 1 / 3) < 1e-9 && hanRatio('plain') === 0)
})

test('the default relevance threshold is the r1 calibration value (rounded down)', () => {
  assert.equal(DEFAULT_RELEVANCE_THRESHOLD, 0.1236)
  assert.ok(DEFAULT_RELEVANCE_THRESHOLD <= 0.12363952982150628)
})

test('gate: relevance below the threshold drops, Chinese and English', () => {
  const zh = task({ query: 'pnpm-workspace.yaml catalog catalogs 协议 用法 示例', goal: '查 pnpm workspace 中 catalog 协议的配置方法和示例', constraints: [] })
  const good = candidate('https://pnpm.io/zh/catalogs', 'Catalogs | pnpm', 'pnpm catalog 协议：在 pnpm-workspace.yaml 中用 catalog 字段集中声明依赖版本，示例如下')
  const bad = candidate('https://example.com/weather', '天气', '今天天气不错，适合出门散步和拍照')
  const [g, b] = gateCandidates(zh, [good, bad], { now: NOW })
  assert.equal(g!.gate!.keep, true)
  assert.equal(b!.gate!.keep, false)
  assert.equal(b!.gate!.reason, 'relevance')
  assert.ok(b!.gate!.relevance < DEFAULT_RELEVANCE_THRESHOLD && g!.gate!.relevance > 0.3)
  assert.deepEqual(keptCandidates([g!, b!]).map(c => c.url), [good.url])

  const en = task({ query: 'node:sqlite DatabaseSync busy timeout', constraints: [] })
  assert.equal(gateItem(en, { title: 'DatabaseSync busy timeout option', text: 'node:sqlite' }).gate.keep, true)
  assert.equal(gateItem(en, { title: 'Cooking pasta', text: 'Boil water and add salt.' }).gate.keep, false)
  // the custom threshold is honoured
  assert.equal(gateItem(en, { title: 'Cooking pasta', text: 'Boil water and add salt.' }, { relevanceThreshold: 0 }).gate.keep, true)
})

test('gate: inputs are not mutated and every constraint is checked', () => {
  const spec = task({ query: 'Playwright Python async page.route abort', constraints: [constraint('c1', 'exclude_term', 'Selenium'), constraint('c2', 'must_term', 'route', 'soft')] })
  const c = candidate('https://playwright.dev/python/docs/network', 'Network | Playwright Python', 'page.route aborts requests in async Python')
  const [out] = gateCandidates(spec, [c])
  assert.equal(c.gate, undefined)
  assert.deepEqual(out!.checks!.map(x => [x.constraintId, x.satisfied]), [['c1', 'yes'], ['c2', 'yes']])
})

test('gate: hard exclude_site / exclude_term / site drop on a definite violation; soft ones only record', () => {
  const spec = task({
    query: 'SQLite WAL wal_autocheckpoint 默认值 PRAGMA',
    constraints: [constraint('c1', 'entity', 'SQLite'), constraint('c2', 'exclude_site', 'csdn.net'), constraint('c3', 'exclude_term', 'PostgreSQL', 'soft')],
  })
  const csdn = candidate('https://blog.csdn.net/x/article/1', 'SQLite WAL wal_autocheckpoint 默认值', 'PRAGMA wal_autocheckpoint 默认 1000 页')
  const mentions = candidate('https://sqlite.org/pragma.html', 'PRAGMA wal_autocheckpoint', 'SQLite WAL 默认值 1000；PostgreSQL 的 WAL 不同')
  const [a, b] = gateCandidates(spec, [csdn, mentions], { now: NOW })
  assert.equal(a!.gate!.keep, false)
  assert.deepEqual([a!.gate!.reason, a!.gate!.violated], ['constraint', ['c2']])
  assert.equal(b!.gate!.keep, true, 'a soft exclude_term never drops')
  assert.equal(b!.checks!.find(c => c.constraintId === 'c3')!.satisfied, 'no')

  const siteTask = task({ query: 'Playwright vs Puppeteer production scraping hacker news', constraints: [constraint('c1', 'site', 'news.ycombinator.com')] })
  const [hn, other] = gateCandidates(siteTask, [
    candidate('https://news.ycombinator.com/item?id=1', 'Playwright vs Puppeteer', 'production scraping experience'),
    candidate('https://blog.example.com/pw', 'Playwright vs Puppeteer', 'production scraping experience'),
  ])
  assert.equal(hn!.gate!.keep, true)
  assert.equal(other!.gate!.keep, false)
  assert.equal(gateCandidates(siteTask, [candidate('https://blog.example.com/pw', 'Playwright vs Puppeteer', 'production scraping')], { hardConstraints: false })[0]!.gate!.keep, true)
})

test('gate: must_term / entity missing from a snippet do not drop (unknown -> keep); full text can', () => {
  const spec = task({ query: 'TypeScript erasableSyntaxOnly flag', constraints: [constraint('c1', 'must_term', 'erasableSyntaxOnly')] })
  const item = { url: 'https://example.com/a', title: 'TypeScript flag disallowed syntax', text: 'enums and namespaces are not erasable' }
  assert.equal(gateItem(spec, item).gate.keep, true)
  assert.equal(gateItem(spec, item).checks[0]!.satisfied, 'no')
  assert.equal(isDefiniteViolation({ kind: 'must_term' }, { satisfied: 'no', prob: 0 }), false)
  assert.equal(gateItem(spec, item, { fullText: true }).gate.reason, 'constraint')
})

test('gate: time_window drops on a structured date only, never on a year merely mentioned in text', () => {
  const spec = task({ query: 'Node.js 最新 LTS 版本 发布计划', constraints: [constraint('c1', 'time_window', '2025 年以后')] })
  const old = gateItem(spec, { url: 'https://example.com/n', title: 'Node.js LTS 版本 发布计划', text: 'Node.js 最新 LTS', publishedAt: '2023-05-01' }, { now: NOW })
  assert.equal(old.gate.keep, false)
  assert.equal(old.gate.reason, 'constraint')
  const dated = gateItem(spec, { url: 'https://example.com/2022/05/node', title: 'Node.js LTS 版本 发布计划', text: 'Node.js 最新 LTS' }, { now: NOW })
  assert.equal(dated.gate.keep, false, 'a dated URL path is structured')
  const mention = gateItem(spec, { url: 'https://example.com/n', title: 'Node.js LTS 版本 发布计划', text: 'Node.js 最新 LTS；V3 于 2024年12月 发布' }, { now: NOW })
  assert.equal(mention.checks[0]!.satisfied, 'no', 'the rule still records the doubt')
  assert.equal(mention.gate.keep, true, 'but a snippet mention is not grounds to drop')
  assert.equal(gateItem(spec, { url: 'https://example.com/n', title: 'Node.js LTS 版本', text: 'Node.js 最新 LTS 发布计划' }, { now: NOW }).gate.keep, true, 'unknown date keeps')
  const fresh = gateItem(spec, { url: 'https://example.com/n', title: 'Node.js LTS 版本 发布计划', text: 'Node.js 最新 LTS', publishedAt: '2026-01-02' }, { now: NOW })
  assert.equal(fresh.gate.keep, true)
  assert.deepEqual(knownDate({ text: '', publishedAt: '2026-01-02' }, NOW), { year: 2026, structured: true })
  assert.deepEqual(knownDate({ text: 'released 2024-05-01' }, NOW), { year: 2024, structured: false })
  assert.equal(knownDate({ text: 'in 2031-01-01' }, NOW), undefined, 'implausible future years are ignored')
})

test('checkConstraint: version strings and language stay unknown rather than violated', () => {
  assert.equal(checkConstraint({ kind: 'version', value: 'React 19' }, { title: 'React 19 useOptimistic', text: '' }).satisfied, 'yes')
  assert.equal(checkConstraint({ kind: 'version', value: 'React 19' }, { title: 'React 18 guide', text: '' }).satisfied, 'unknown')
  assert.equal(checkConstraint({ kind: 'region', value: 'CN' }, { text: 'anything' }).satisfied, 'unknown')
  assert.equal(checkConstraint({ kind: 'language', value: 'zh' }, { title: 'A plain English article title', text: 'with an English snippet that is long enough' }).satisfied, 'no')
  assert.equal(isDefiniteViolation({ kind: 'language' }, { satisfied: 'no', prob: 0.1 }), false)
  const ctx = relevanceContextOf(task({ query: 'a b', goal: 'g', constraints: [constraint('c1', 'entity', 'Zed')] }))
  assert.ok(lexicalRelevance(ctx, { title: 'Zed', text: '' }, true) > lexicalRelevance(ctx, { title: 'Zed', text: '' }, false))
})
