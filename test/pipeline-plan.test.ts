import test from 'node:test'
import assert from 'node:assert/strict'
import { inferProfile, planSources, PROFILE_PROVIDERS, profileScores, type ProviderStatus } from '../src/pipeline/plan.ts'
import { buildTaskSpec, parseConstraints, parseNeeds, parseProfile } from '../src/pipeline/task.ts'
import type { Profile, TaskSpec } from '../src/pipeline/types.ts'

const spec = (over: Partial<TaskSpec> = {}): TaskSpec => ({
  goal: 'goal', query: 'node:sqlite busy timeout', needs: [{ id: 'n1', text: 'goal', critical: true }], constraints: [], budget: {}, ...over,
})
const ids = (plan: ReturnType<typeof planSources>): string[] => plan.providers.map(p => p.id)
const CONFIGURED = ['ddg', 'bing', 'exa', 'seam', 'jina']
const allReady = (): ProviderStatus => ({ state: 'ready' })

test('plan: every profile maps to its provider table, general uses the configured engines', () => {
  for (const [profile, table] of Object.entries(PROFILE_PROVIDERS)) {
    assert.deepEqual(ids(planSources(spec({ profile: profile as Profile }), { configured: CONFIGURED, status: allReady })), table.slice(0, 4), profile)
  }
  // the plan holds at most 4 providers (the rest stays in `wanted` for the second round)
  assert.deepEqual(PROFILE_PROVIDERS.docs_code, ['ddg', 'bing', 'github'])
  assert.deepEqual(PROFILE_PROVIDERS.academic, ['arxiv', 'openalex', 'pubmed', 'semanticscholar', 'ddg'])
  assert.deepEqual(PROFILE_PROVIDERS.experience, ['ddg', 'bing', 'v2ex', 'hackernews', 'stackexchange'])
  assert.deepEqual(PROFILE_PROVIDERS.news_fact, ['ddg', 'bing'])
  assert.deepEqual(PROFILE_PROVIDERS.compare, ['ddg', 'bing', 'github'])
  const general = planSources(spec({ profile: 'general' }), { configured: CONFIGURED, status: allReady })
  assert.deepEqual(ids(general), ['ddg', 'bing', 'exa', 'seam'], 'capped at 4 providers')
  assert.deepEqual(general.skipped, [{ id: 'jina', reason: 'provider cap 4' }])
})

test('plan: explicit engines override the profile table and are not capped', () => {
  const plan = planSources(spec({ profile: 'docs_code' }), { engines: ['arxiv', 'bing', 'arxiv', 'ddg', 'exa', 'jina'], configured: CONFIGURED, status: allReady })
  assert.deepEqual(ids(plan), ['arxiv', 'bing', 'ddg', 'exa', 'jina'])
})

test('plan: unavailable, cooling-down and unknown providers are filtered with a note', () => {
  const status = (id: string): ProviderStatus | undefined => ({
    ddg: { state: 'cooldown' as const, reason: 'HTTP 429' }, bing: { state: 'ready' as const }, github: { state: 'unavailable' as const, reason: 'GitHub unavailable' },
  } as Record<string, ProviderStatus>)[id]
  const plan = planSources(spec({ profile: 'docs_code' }), { configured: CONFIGURED, status })
  assert.deepEqual(ids(plan), ['bing'])
  assert.deepEqual(plan.skipped.map(s => s.id), ['ddg', 'github'])
  assert.match(plan.notes.join('\n'), /skipped providers: ddg \[cooldown \(HTTP 429\)\], github \[unavailable \(GitHub unavailable\)\]/)
  const unknown = planSources(spec({ profile: 'general' }), { engines: ['nope'], configured: CONFIGURED, status })
  assert.deepEqual(unknown.providers, [])
  assert.deepEqual(unknown.skipped, [{ id: 'nope', reason: 'unknown provider' }])
  assert.match(unknown.notes.join('\n'), /no usable provider/)
})

test('plan: each provider gets its own compiled query (github keywords + fallbacks, ddg operators)', () => {
  const plan = planSources(spec({
    profile: 'docs_code', query: '如何在 node:sqlite 里设置 busy timeout 和 WAL 模式的最新做法',
    constraints: [{ id: 'c1', kind: 'exclude_term', value: 'better-sqlite3', strength: 'hard', origin: 'param' }, { id: 'c2', kind: 'entity', value: 'node:sqlite', strength: 'hard', origin: 'param' }],
  }), { configured: CONFIGURED, status: allReady })
  const by = Object.fromEntries(plan.providers.map(p => [p.id, p.compiled]))
  assert.match(by.ddg!.query, /-better-sqlite3$/)
  assert.deepEqual(by.ddg!.native, ['c1'])
  assert.ok(by.github!.query.split(' ').length <= 5)
  assert.ok(!by.github!.query.includes('如何'))
  assert.ok(by.github!.fallbacks?.length)
})

test('plan: a missing profile is inferred by rule, ambiguity falls back to general', () => {
  assert.equal(inferProfile('Express 5 升级迁移 文档 版本 api'), 'docs_code')
  assert.equal(inferProfile('what is the latest news about the release'), 'news_fact')
  assert.equal(inferProfile('Rust vs Go compare'), 'compare')
  assert.equal(inferProfile('蓝牙耳机 推荐 踩坑 体验'), 'experience')
  assert.equal(inferProfile('a survey paper on diffusion'), 'academic')
  assert.equal(inferProfile('hello there'), 'general')
  assert.equal(inferProfile('docs vs news'), 'general', 'a tie is not a verdict')
  const plan = planSources(spec({ query: 'install the api docs', goal: 'install the api docs' }), { configured: CONFIGURED, status: allReady })
  assert.equal(plan.profile, 'docs_code')
  assert.equal(plan.profileInferred, true)
  assert.match(plan.notes[0]!, /profile inferred by rule: docs_code/)
  const given = planSources(spec({ profile: 'news_fact' }), { configured: CONFIGURED, status: allReady })
  assert.equal(given.profileInferred, false)
  const scores = profileScores('install the api docs')
  assert.ok(scores.docs_code! > scores.general!)
})

test('task: needs parse from ;-text, JSON strings and JSON objects; default to the goal; cap at six', () => {
  assert.deepEqual(parseNeeds('busy timeout; WAL 模式；  ', 'g').needs.map(n => [n.id, n.text, n.critical]), [['n1', 'busy timeout', true], ['n2', 'WAL 模式', true]])
  assert.deepEqual(parseNeeds('["a","b"]', 'g').needs.map(n => n.text), ['a', 'b'])
  assert.deepEqual(parseNeeds([{ text: 'x', critical: false }, 'y'], 'g').needs.map(n => n.critical), [false, true])
  assert.deepEqual(parseNeeds(undefined, 'the goal').needs, [{ id: 'n1', text: 'the goal', critical: true }])
  assert.deepEqual(parseNeeds('  ;  ', 'the goal').needs.map(n => n.text), ['the goal'])
  const many = parseNeeds('1;2;3;4;5;6;7;8', 'g')
  assert.equal(many.needs.length, 6)
  assert.equal(many.truncated, true)
  assert.throws(() => parseNeeds('[1]', 'g'), /string or \{text/)
  assert.throws(() => parseNeeds('[oops', 'g'), /not valid JSON/)
})

test('task: constraints validate kind/strength, default to soft and get param origin', () => {
  const list = parseConstraints('[{"kind":"site","value":" github.com ","strength":"hard"},{"kind":"version","value":"22"}]')
  assert.deepEqual(list, [
    { id: 'c1', kind: 'site', value: 'github.com', strength: 'hard', origin: 'param' },
    { id: 'c2', kind: 'version', value: '22', strength: 'soft', origin: 'param' },
  ])
  assert.deepEqual(parseConstraints(undefined), [])
  assert.deepEqual(parseConstraints(''), [])
  assert.throws(() => parseConstraints('[{"kind":"bogus","value":"x"}]'), /kind must be one of/)
  assert.throws(() => parseConstraints('[{"kind":"site","value":""}]'), /non-empty value/)
  assert.throws(() => parseConstraints('[{"kind":"site","value":"x","strength":"maybe"}]'), /hard or soft/)
  assert.throws(() => parseConstraints('{"kind":"site"}'), /JSON array/)
})

test('task: buildTaskSpec assembles goal, profile and budget', () => {
  const { spec: built, notes } = buildTaskSpec({ query: ' q ', task: 'find X', profile: 'Docs_Code', needs: 'a;b', budget: 4000 })
  assert.equal(built.goal, 'find X')
  assert.equal(built.query, 'q')
  assert.equal(built.profile, 'docs_code')
  assert.equal(built.needs.length, 2)
  assert.deepEqual(built.budget, { chars: 4000 })
  assert.deepEqual(notes, [])
  assert.equal(buildTaskSpec({ query: 'only query' }).spec.goal, 'only query')
  assert.equal(buildTaskSpec({ query: 'q' }).spec.profile, undefined)
  assert.throws(() => buildTaskSpec({ query: 'q', profile: 'nope' }), /profile must be one of/)
  assert.throws(() => buildTaskSpec({ query: 'q', budget: 10 }), /budget must be/)
  assert.throws(() => buildTaskSpec({ query: '  ' }), /non-empty/)
  assert.equal(parseProfile(' '), undefined)
  assert.match(buildTaskSpec({ query: 'q', needs: '1;2;3;4;5;6;7' }).notes[0]!, /first 6 needs/)
})
