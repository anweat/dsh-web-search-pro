import test from 'node:test'
import assert from 'node:assert/strict'
import { loadTasks } from '../bench/src/tasks.ts'
import { toTaskSpec } from '../bench/src/types.ts'
import { compileQueries, compileQuery, githubKeywordQuery, GITHUB_MAX_TERMS, parseTimeWindow } from '../src/pipeline/compile.ts'
import type { Constraint, TaskSpec } from '../src/pipeline/types.ts'

const NOW = new Date('2026-10-01T00:00:00Z')
const tasks = new Map(loadTasks().map(t => [t.id, toTaskSpec(t)]))
const spec = (id: string): TaskSpec => tasks.get(id)!

test('ddg / bing: hard exclude_site and exclude_term become operators, soft constraints stay local', () => {
  // dc-08: exclude_site csdn.net (hard), exclude_term PostgreSQL (soft)
  const dc08 = compileQuery(spec('dc-08'), 'ddg', NOW)
  assert.equal(dc08.query, spec('dc-08').query + ' -site:csdn.net')
  assert.deepEqual(dc08.native, ['c4'])
  assert.deepEqual(dc08.local, ['c1', 'c2', 'c3'])
  // dc-07: exclude_term Selenium (hard) -> -Selenium; Puppeteer is soft -> not pushed down
  const dc07 = compileQuery(spec('dc-07'), 'bing', NOW)
  assert.equal(dc07.query, spec('dc-07').query + ' -Selenium')
  assert.deepEqual(dc07.native, ['c3'])
  assert.ok(dc07.local.includes('c4') && dc07.local.includes('c1'))
  // ex-05: site news.ycombinator.com (hard)
  assert.equal(compileQuery(spec('ex-05'), 'ddg', NOW).query, 'Playwright vs Puppeteer production scraping experience flaky hacker news site:news.ycombinator.com')
  // ex-10: soft site + soft exclude_term: nothing pushed down except hard Vue 2
  const ex10 = compileQuery(spec('ex-10'), 'ddg', NOW)
  assert.ok(ex10.query.endsWith(' -"Vue 2"'), ex10.query)
  assert.deepEqual(ex10.native, ['c3'])
})

test('ddg / bing: operators already spelled in the query are not duplicated; only the first hard site is native', () => {
  const base: TaskSpec = {
    goal: 'g', query: 'site:v2ex.com sqlite wal -csdn', needs: [], budget: {},
    constraints: [
      { id: 'c1', kind: 'site', value: 'v2ex.com', strength: 'hard', origin: 'query_syntax' },
      { id: 'c2', kind: 'site', value: 'reddit.com', strength: 'hard', origin: 'param' },
    ],
  }
  const compiled = compileQuery(base, 'ddg', NOW)
  assert.equal(compiled.query, 'site:v2ex.com sqlite wal -csdn')
  assert.deepEqual(compiled.native, ['c1'])
  assert.deepEqual(compiled.local, ['c2'])
})

test('exa: includeDomains / excludeDomains / startPublishedDate from hard constraints', () => {
  // nf-01: hard time_window "2025 年以后"
  const nf01 = compileQuery(spec('nf-01'), 'exa', NOW)
  assert.equal(nf01.query, spec('nf-01').query)
  assert.deepEqual(nf01.options, { exa: { startPublishedDate: '2025-01-01T00:00:00.000Z' } })
  assert.deepEqual(nf01.native, ['c3'])
  assert.deepEqual(nf01.local, ['c1', 'c2'])
  assert.deepEqual(compileQuery(spec('ex-05'), 'exa', NOW).options, { exa: { includeDomains: ['news.ycombinator.com'] } })
  assert.deepEqual(compileQuery(spec('dc-08'), 'exa', NOW).options, { exa: { excludeDomains: ['csdn.net'] } })
  // dc-06: soft time window stays local, no options at all
  const dc06 = compileQuery(spec('dc-06'), 'exa', NOW)
  assert.equal(dc06.options, undefined)
  assert.deepEqual(dc06.native, [])
})

test('parseTimeWindow: year lower bounds and relative spans; unknown text stays local', () => {
  assert.equal(parseTimeWindow('2025 年以后', NOW), '2025-01-01T00:00:00.000Z')
  assert.equal(parseTimeWindow('since 2024', NOW), '2024-01-01T00:00:00.000Z')
  assert.equal(parseTimeWindow('最近一周', NOW), '2026-09-24T00:00:00.000Z')
  assert.equal(parseTimeWindow('past 30 days', NOW), '2026-09-01T00:00:00.000Z')
  assert.equal(parseTimeWindow('最近两个月', NOW), '2026-08-02T00:00:00.000Z')
  assert.equal(parseTimeWindow('recent', NOW), undefined)
})

test('github: keyword queries replace the natural-language query (<= 5 terms, no qualifiers, no Chinese filler)', () => {
  assert.equal(githubKeywordQuery(spec('dc-01')), 'node sqlite busy timeout databasesync', 'node:sqlite must not reach GitHub as a qualifier')
  assert.equal(githubKeywordQuery(spec('dc-03')), 'pnpm catalog pnpm-workspace.yaml catalogs')
  assert.equal(githubKeywordQuery(spec('cp-03')), 'meilisearch typesense elasticsearch 中文分词 jieba', 'Chinese entity names survive, single-character filler is not stripped from them')
  assert.equal(githubKeywordQuery(spec('cp-01')), 'bun node.js')
  assert.equal(githubKeywordQuery(spec('dc-02')), 'python free-threaded gil python3.13t')
  for (const t of loadTasks().filter(t => t.profile === 'docs_code' || t.profile === 'compare')) {
    const q = githubKeywordQuery(toTaskSpec(t))
    const words = q.split(' ')
    assert.ok(q.length > 0 && words.length <= GITHUB_MAX_TERMS, t.id + ': ' + q)
    assert.ok(!q.includes(':'), t.id + ' leaks a qualifier: ' + q)
    assert.ok(!/[的了吗如何怎么]/.test(q) || /中文分词/.test(q), t.id + ' keeps filler: ' + q)
  }
  const github = compileQuery(spec('dc-01'), 'github', NOW)
  assert.equal(github.query, 'node sqlite busy timeout databasesync')
  assert.deepEqual(github.native, [])
  assert.equal(github.local.length, spec('dc-01').constraints.length)
  assert.equal(compileQuery(spec('dc-01'), 'github-issues', NOW).query, github.query)
  // A rare token can empty an AND search: broader variants keep the leading (most salient) terms.
  assert.deepEqual(github.fallbacks, ['node sqlite busy', 'node sqlite'])
  assert.equal(compileQuery(spec('cp-01'), 'github', NOW).fallbacks, undefined, 'two terms: nothing broader to try')
  assert.equal(compileQuery(spec('dc-01'), 'ddg', NOW).fallbacks, undefined)
})

test('github: Chinese query terms are used only when constraints and Latin tokens yield too little', () => {
  const t: TaskSpec = { goal: 'g', query: '如何使用 企业微信 机器人 推送 消息', needs: [], constraints: [], budget: {} }
  assert.equal(githubKeywordQuery(t), '企业微信 机器人 推送 消息')
  assert.equal(githubKeywordQuery({ ...t, query: '如何 使用', constraints: [] }), '如何 使用', 'nothing salient left: fall back to the raw query')
})

test('other providers get the plain query and every constraint is local; all 60 bench tasks compile', () => {
  const plain = compileQuery(spec('ex-05'), 'v2ex', NOW)
  assert.equal(plain.query, spec('ex-05').query)
  assert.deepEqual(plain.native, [])
  assert.deepEqual(plain.local, spec('ex-05').constraints.map((c: Constraint) => c.id))
  for (const [id, t] of tasks) {
    for (const c of compileQueries(t, ['ddg', 'bing', 'exa', 'github', 'arxiv'], NOW)) {
      assert.ok(c.query.trim().length > 0, id + ' ' + c.providerId)
      // native and local partition the constraints
      assert.deepEqual([...c.native, ...c.local].sort(), t.constraints.map(x => x.id).sort(), id + ' ' + c.providerId)
    }
  }
  assert.equal(tasks.size, 60)
})
