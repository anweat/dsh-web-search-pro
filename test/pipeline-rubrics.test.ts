import test from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import { resolveConfig } from '../src/config.ts'
import {
  BUILTIN_RUBRIC_IDS, buildRubric, builtinRubric, renderTemplate, resolveAllRubrics, resolveRubric, rubricProblems, variablesOf,
} from '../src/pipeline/rubrics.ts'
import { HybridScorer, JevScorer, type JevCache, type JevProbe, type ScoreJob } from '../src/pipeline/score.ts'

const GOAL = '了解 Node.js 22 中 node:sqlite 的  DatabaseSync\n构造参数里 timeout 选项 ' + '很长的目标描述'.repeat(40)
const LONG_BLOCK = 'x$&y {need} {candidate} ' + '内容'.repeat(900)
const JOBS: ScoreJob[] = [
  { need: { id: 'n1', text: '  DatabaseSync   构造参数中的 timeout 选项\n是什么 {task} $1 ', critical: true }, blocks: [
    { blockId: 'b1', url: 'https://nodejs.org/api/sqlite.html', heading: 'new DatabaseSync(path[, options])', text: 'timeout <number> The busy timeout in milliseconds. $& $1 {need}' },
    { blockId: 'b2', url: 'https://x.test/', text: LONG_BLOCK },
  ] },
  { need: { id: 'n2', text: 'PRAGMA busy_timeout', critical: false }, blocks: [{ blockId: 'b3', url: 'https://x.test/', text: 'English only block about PRAGMA.' }] },
]
const TASK = { goal: GOAL, query: 'q', needs: [], constraints: [] }

interface Run { bodies: string[]; scorer: JevScorer; out: Awaited<ReturnType<JevScorer['score']>> }
/** Score `jobs` against a stub service that answers every question with `score`; returns the request bodies. */
async function run(extra: Record<string, unknown> = {}, jobs = JOBS, score = 2): Promise<Run> {
  const bodies: string[] = []
  const fetchImpl = (async (_url: string, init: { body: string }) => {
    bodies.push(init.body)
    const questions = Object.keys(JSON.parse(init.body).questions)
    return new Response(JSON.stringify({ answers: Object.fromEntries(questions.map(k => [k, { score }])), usage: {} }), { status: 200 })
  }) as unknown as typeof fetch
  const scorer = new JevScorer({ apiKey: 'k', sleep: async () => {}, fetchImpl, ...extra })
  const out = await scorer.score(TASK, jobs)
  return { bodies, scorer, out }
}

test('defaults reproduce the pre-rubric request bodies byte for byte', async () => {
  // The sha256 was taken from the request bodies the scorer produced BEFORE rubrics existed (HEAD edc06d1), for this exact input
  // (long goal, odd whitespace, `$&` / `{need}` inside need and block text, a block cut at 1200 characters).
  const { bodies } = await run()
  assert.equal(crypto.createHash('sha256').update(JSON.stringify(bodies)).digest('hex'), 'fd35ae6dd2ad0cb7fcbfe693e56ad23aa3591d2328cec900ae14e60502f3daf0')

  // And a small body written out by hand.
  const { bodies: small } = await run({}, [{ need: { id: 'n1', text: '如何设置 busy timeout', critical: true }, blocks: [{ blockId: 'b', url: 'https://x.test/', heading: 'H', text: 'PRAGMA busy_timeout = 5000;' }] }])
  assert.equal(small[0], '{"model":"bocha-jev-v1","state":"搜索任务：' + GOAL.trim().replace(/\s+/g, ' ').slice(0, 199) + '…","questions":{"q0":{"type":"score","instructions":"下面的文本块对该需求的支撑程度如何？\\n需求：如何设置 busy timeout\\n文本块：H\\nPRAGMA busy_timeout = 5000;","criteria":["无关或只有同名词","同主题但不回答","部分回答","直接回答且含可定位证据"]}}}')
})

test('built-in registry: ids, versions, variables whitelist, and a stable key', () => {
  assert.deepEqual(BUILTIN_RUBRIC_IDS, ['score.support', 'gate.relevance', 'gate.constraint'])
  for (const id of BUILTIN_RUBRIC_IDS) {
    const r = builtinRubric(id)
    assert.equal(r.version, 'v1')
    assert.equal(r.overridden, false)
    assert.equal(r.key, id + '@v1#' + r.hash)
    assert.match(r.hash, /^[0-9a-f]{12}$/)
    assert.ok(variablesOf(r.instructions).every(v => r.allowed.includes(v as never)))
    assert.ok(r.required.every(v => r.instructions.includes('{' + v + '}')))
    assert.ok(r.maxStateChars > 0 && r.maxCandidateChars > 0)
  }
  const support = builtinRubric('score.support')
  assert.equal(support.kind, 'score')
  assert.equal(support.criteria!.length, 4)
  assert.equal(builtinRubric('gate.relevance').kind, 'noul')
  assert.equal(builtinRubric('score.support').hash, builtinRubric('score.support').hash)
  assert.throws(() => builtinRubric('nope'), /unknown rubric/)
})

test('renderTemplate fills variables in one pass and keeps inserted text literal', () => {
  assert.equal(renderTemplate('a {need} b {candidate}', { need: '{candidate}', candidate: '$& $1' }), 'a {candidate} b $& $1')
  assert.equal(renderTemplate('{need} {candidate}', { need: 'n' }), 'n {candidate}')
})

test('a valid override replaces the wording and is recorded: id, version, hash, overridden', async () => {
  const instructions = '文本块是否直接给出了需求的答案，而不只是提到该主题？\n需求：{need}\n文本块：{candidate}'
  const { rubric, diagnostics } = resolveRubric('score.support', { 'score.support': { version: 'v2', instructions } })
  assert.deepEqual(diagnostics, [])
  assert.equal(rubric.version, 'v2')
  assert.equal(rubric.overridden, true)
  assert.notEqual(rubric.hash, builtinRubric('score.support').hash)
  assert.deepEqual(rubric.criteria, builtinRubric('score.support').criteria, 'untouched fields keep the built-in values')

  const probes: JevProbe[] = []
  const { bodies, scorer } = await run({ rubric, cache: { get: () => undefined, set: (p: JevProbe) => { probes.push(p) } } satisfies JevCache }, [JOBS[1]!])
  assert.equal(JSON.parse(bodies[0]!).questions.q0.instructions, '文本块是否直接给出了需求的答案，而不只是提到该主题？\n需求：PRAGMA busy_timeout\n文本块：English only block about PRAGMA.')
  assert.equal(scorer.rubricRef.key, rubric.key)
  assert.deepEqual({ ...scorer.rubricRef, key: undefined }, { id: 'score.support', version: 'v2', overridden: true, hash: rubric.hash, key: undefined })
  assert.equal(probes[0]!.rubric, rubric.key, 'the cache sees the rubric key')
  assert.equal(new HybridScorer({ jev: scorer }).rubricRef!.version, 'v2')
})

test('cache keys: a probe of another rubric version never matches an answer cached under the old one', async () => {
  const store = new Map<string, number>()
  const cache: JevCache = { get: p => (store.has(p.rubric + '|' + p.need + '|' + p.candidate) ? { grade: store.get(p.rubric + '|' + p.need + '|' + p.candidate)! } : undefined), set: (p, a) => { store.set(p.rubric + '|' + p.need + '|' + p.candidate, a.grade) } }
  const asked = async (extra: Record<string, unknown>): Promise<number> => (await run({ cache, ...extra }, [JOBS[1]!], 1)).bodies.length
  assert.equal(await asked({}), 1)
  assert.equal(await asked({}), 0, 'same rubric: answered from the cache')
  assert.equal(await asked({ rubric: resolveRubric('score.support', { 'score.support': { version: 'v2', instructions: '问题 {need} {candidate}' } }).rubric }), 1, 'new rubric version: asked again')
  assert.equal(await asked({ rubric: buildRubric('score.support', { version: 'v1b' }).rubric }), 1, 'same text, only the version label differs: still another key')
})

test('override length caps and criteria drive the question; other level counts are rescaled to 0..3', async () => {
  const { rubric, diagnostics } = resolveRubric('score.support', { 'score.support': { version: 'v3', criteria: ['不支持', '支持'], maxCandidateChars: 100, maxStateChars: 30 } })
  assert.deepEqual(diagnostics, [])
  const { bodies, scorer } = await run({ rubric }, [JOBS[0]!], 1)
  const body = JSON.parse(bodies[0]!)
  assert.equal(body.state, '搜索任务：' + GOAL.trim().replace(/\s+/g, ' ').slice(0, 29) + '…')
  assert.deepEqual(body.questions.q0.criteria, ['不支持', '支持'])
  assert.equal(body.questions.q1.instructions.split('文本块：')[1].length, 100, 'candidate cut to 100 characters (99 + ellipsis)')
  // a 2-level answer of 0.5 is half way up the scale: 1.5 on the pipeline's 0..3 grades; the top level is 3
  assert.equal(scorer['rubricRef'].version, 'v3')
  assert.equal((await run({ rubric }, [JOBS[1]!], 0.5)).out.grades.get('n2')!.get('b3')!.grade, 1.5)
  assert.equal((await run({ rubric }, [JOBS[1]!], 1)).out.grades.get('n2')!.get('b3')!.grade, 3)
  assert.equal((await run({}, [JOBS[1]!], 1.25)).out.grades.get('n2')!.get('b3')!.grade, 1.25, 'the 4-level default is not rescaled')
})

test('invalid overrides are rejected with a diagnostic and the built-in is used', () => {
  const builtinKey = builtinRubric('score.support').key
  const bad = (override: unknown, expected: RegExp, id = 'score.support'): void => {
    const r = resolveRubric(id, { [id]: override })
    assert.equal(r.rubric.key, builtinRubric(id).key, 'built-in used for ' + JSON.stringify(override))
    assert.equal(r.rubric.overridden, false)
    assert.match(r.diagnostics.join('|'), expected)
    assert.match(r.diagnostics[0]!, new RegExp('^' + id.replace('.', '\\.') + ': override ignored'))
  }
  const ok = '{need} {candidate}'
  bad({ version: 'v2', instructions: '{need} {candidate} {nope}' }, /unknown variable \{nope\}/)
  bad({ version: 'v2', instructions: '{need} {candidate} {constraint}' }, /\{constraint\} is not available in score\.support/)
  bad({ version: 'v2', instructions: '{need}' }, /must contain \{candidate\}/)
  bad({ version: 'v2', instructions: '{candidate}' }, /must contain \{need\}/)
  bad({ version: 'v2', instructions: '   ' }, /non-empty/)
  bad({ version: 'v2', instructions: ok + 'x'.repeat(2000) }, /longer than 2000/)
  bad({ instructions: ok }, /version must be a label/)
  bad({ version: 'bad label', instructions: ok }, /version must be a label/)
  bad({ version: 'v1', instructions: ok }, /changed content needs a new version/)
  bad({ version: 'v2', criteria: ['only one'] }, /criteria needs 2-10 levels/)
  bad({ version: 'v2', criteria: Array.from({ length: 11 }, (_, i) => 'l' + i) }, /criteria needs 2-10 levels/)
  bad({ version: 'v2', criteria: ['a', ''] }, /each criterion/)
  bad({ version: 'v2', criteria: 'a,b' }, /criteria needs/)
  bad({ version: 'v2', maxStateChars: 5 }, /maxStateChars must be an integer in 20\.\.2000/)
  bad({ version: 'v2', maxCandidateChars: 99999 }, /maxCandidateChars must be an integer in 100\.\.8000/)
  bad({ version: 'v2', maxCandidateChars: 150.5 }, /maxCandidateChars/)
  bad({ version: 'v2', extra: 1 }, /unknown field "extra"/)
  bad('nope', /not an object/)
  bad({ version: 'v2', criteria: ['a', 'b'] }, /criteria only apply to score rubrics/, 'gate.relevance')
  bad({ version: 'v2', instructions: '{need} {candidate}' }, /must contain \{constraint\}/, 'gate.constraint')
  assert.equal(resolveRubric('score.support', { 'score.support': { version: 'v2', criteria: Array.from({ length: 10 }, (_, i) => 'l' + i) } }).diagnostics.length, 0, '10 levels are allowed')
  assert.equal(resolveRubric('score.support', { 'score.support': { version: 'v2', criteria: ['a', 'b'] } }).diagnostics.length, 0, '2 levels are allowed')
  assert.notEqual(builtinKey, '')
  assert.deepEqual(rubricProblems(builtinRubric('score.support'), { version: 'v9' }), [])
})

test('resolveAllRubrics: reports unknown ids, keeps the valid overrides, and absent overrides cost nothing', () => {
  const none = resolveAllRubrics(undefined)
  assert.deepEqual(none.diagnostics, [])
  assert.ok(none.rubrics.every(r => !r.overridden))
  const mixed = resolveAllRubrics({ 'score.support': { version: 'v2', instructions: '{need}|{candidate}' }, 'gate.constraint': { version: 'v2', instructions: '{nope}' }, 'unknown.rubric': { version: 'v1' } })
  assert.deepEqual(mixed.rubrics.map(r => r.version), ['v2', 'v1', 'v1'])
  assert.equal(mixed.diagnostics.length, 4, 'gate.constraint: unknown variable, missing {constraint}, missing {candidate}; plus the unknown id')
})

test('config: evidence.rubrics is optional, unwrapped when volatile, and absent from the default shape', () => {
  assert.equal('rubrics' in resolveConfig({} as never).evidence, false)
  const rubrics = { 'score.support': { version: 'v2', instructions: '{need} {candidate}' } }
  const live = (value: unknown) => ({ get: () => value })
  assert.deepEqual(resolveConfig({ evidence: { rubrics: live(rubrics) } } as never).evidence.rubrics, rubrics)
  assert.deepEqual(resolveConfig({ evidence: { rubrics } } as never).evidence.rubrics, rubrics)
})
