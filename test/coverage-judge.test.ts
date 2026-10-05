import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { applyVerdicts, bandOf, evidenceView, resolveThresholds, thresholdsProblems, verdictsOf, CALIBRATED_THRESHOLDS } from '../src/pipeline/coverage.ts'
import { BudgetExceededError } from '../src/pipeline/judges/errors.ts'
import { createCoverageJudge, createModelScorer, PRESETS } from '../src/pipeline/judges/providers.ts'
import type { JudgeAnswerCache, JudgeProbe } from '../src/pipeline/judges/types.ts'
import { resolveBudget, UsageLedger } from '../src/pipeline/ledger.ts'
import { buildRubric, builtinRubric, resolveRubric } from '../src/pipeline/rubrics.ts'
import type { SelectedBlock } from '../src/pipeline/select.ts'
import type { BlockGrade, Need, ScoredBlock } from '../src/pipeline/types.ts'
import { Store } from '../src/store.ts'

const JEV = PRESETS['bocha-jev']!
const GOAL = '了解 node:sqlite 的 DatabaseSync 构造参数'

/** A stub Jev that answers every noul question with `probs[i]` (default 0.9) and records the bodies. */
function stub(probs: number[] = [], usage: Record<string, number> | undefined = { input_tokens: 400, output_tokens: 3 }) {
  const bodies: { model: string; state: string; questions: Record<string, { type: string; instructions: string; criteria?: unknown }> }[] = []
  const fetchImpl = (async (_url: string, init: { body: string }) => {
    const body = JSON.parse(init.body)
    bodies.push(body)
    const keys = Object.keys(body.questions)
    return new Response(JSON.stringify({ answers: Object.fromEntries(keys.map((k, i) => [k, { noul: probs[i] ?? 0.9 }])), ...usage ? { usage } : {} }), { status: 200 })
  }) as unknown as typeof fetch
  return { fetchImpl, bodies }
}

const item = (needId: string, need: string, evidence: string) => ({ needId, need, evidence })

// ── the rubric ──────────────────────────────────────────────────────────────

test('cover.sufficient v1: a noul rubric in zh with {need} {candidate} and the sufficiency wording', () => {
  const r = builtinRubric('cover.sufficient')
  assert.deepEqual([r.id, r.version, r.kind, r.lang, r.overridden], ['cover.sufficient', 'v1', 'noul', 'zh', false])
  assert.deepEqual([...r.required], ['need', 'candidate'])
  assert.equal(r.criteria, undefined)
  assert.equal(r.maxCandidateChars, 2400)
  assert.match(r.instructions, /本身/)
  assert.match(r.instructions, /只提到相同主题/)
  assert.match(r.instructions, /明确说“有”或明确说“没有”都算足够/)
  assert.match(r.instructions, /\{need\}/)
  assert.match(r.instructions, /\{candidate\}/)
  assert.equal(r.key, 'cover.sufficient@v1#' + r.hash)
})

test('cover.sufficient can be overridden under a new version; the hash changes and {task} is allowed, unknown variables are rejected', () => {
  const ok = buildRubric('cover.sufficient', { version: 'v2', instructions: '摘录能回答吗？{need}\n{candidate}' })
  assert.ok(ok.rubric)
  assert.equal(ok.rubric!.overridden, true)
  assert.notEqual(ok.rubric!.hash, builtinRubric('cover.sufficient').hash)
  assert.deepEqual(buildRubric('cover.sufficient', { version: 'v2', instructions: '{need} {candidate} {constraint}' }).problems!.map(p => p.replace(/\s*\(.*$/, '')), ['variable {constraint} is not available in cover.sufficient'])
  assert.match(buildRubric('cover.sufficient', { version: 'v2', instructions: 'no variables' }).problems!.join('|'), /must contain \{need\}/)
  assert.match(buildRubric('cover.sufficient', { version: 'v2', criteria: ['a', 'b'] }).problems!.join('|'), /criteria only apply to score rubrics/)
  assert.match(resolveRubric('cover.sufficient', { 'cover.sufficient': { version: 'v1', instructions: 'changed {need} {candidate}' } }).diagnostics.join('|'), /changed content needs a new version/)
})

// ── the judge ───────────────────────────────────────────────────────────────

test('the request: one noul question per need with the rubric wording, the evidence view as candidate, the task state, no criteria', async () => {
  const { fetchImpl, bodies } = stub([0.8, 0.2])
  const judge = createCoverageJudge(JEV, { apiKey: 'k', fetchImpl, sleep: async () => {} })
  const out = await judge.judge({ goal: GOAL }, [item('n1', 'timeout 选项是什么 {task} $&', '[1] nodejs.org\ntimeout <number> The busy timeout'), item('n2', 'PRAGMA 能否代替', '[1] x.test\nunrelated')])
  assert.equal(bodies.length, 1)
  const body = bodies[0]!
  assert.equal(body.model, 'bocha-jev-v1')
  assert.equal(body.state, '搜索任务：' + GOAL)
  assert.deepEqual(Object.keys(body.questions), ['q0', 'q1'])
  assert.deepEqual(Object.keys(body.questions.q0!), ['type', 'instructions'])
  assert.equal(body.questions.q0!.type, 'noul')
  assert.equal(body.questions.q0!.instructions, builtinRubric('cover.sufficient').instructions.replace('{need}', () => 'timeout 选项是什么 {task} $&').replace('{candidate}', () => '[1] nodejs.org\ntimeout <number> The busy timeout'))
  assert.deepEqual([...out.probs], [['n1', 0.8], ['n2', 0.2]])
  assert.deepEqual([out.usage.requests, out.usage.questions, out.usage.inputTokens, out.usage.outputTokens], [1, 2, 400, 3])
  assert.equal(judge.rubricRef.id, 'cover.sufficient')
  assert.deepEqual(judge.provider, { id: 'bocha-jev', protocol: 'systemone', model: 'bocha-jev-v1' })
})

test('the evidence view is cut to the rubric cap and the need to 200 characters; answers outside 0..1 count as unanswered', async () => {
  const { fetchImpl, bodies } = stub([1.5])
  const judge = createCoverageJudge(JEV, { apiKey: 'k', fetchImpl, sleep: async () => {} })
  await assert.rejects(judge.judge({ goal: GOAL }, [item('n1', '需'.repeat(500), '证'.repeat(5000))]), /answered only 0 of 1/)
  const q = bodies[0]!.questions.q0!.instructions
  assert.ok(q.includes('需'.repeat(199) + '…'))
  assert.ok(q.includes('证'.repeat(2399) + '…'))
  assert.ok(!q.includes('证'.repeat(2400)))
})

test('answers are cached per question (rubric key and provider are part of the probe) and a rerun costs nothing', async () => {
  const store = new Map<string, number>()
  const probes: JudgeProbe[] = []
  const cache: JudgeAnswerCache = { get: p => { probes.push(p); const v = store.get(JSON.stringify(p)); return v === undefined ? undefined : { grade: v } }, set: (p, a) => { store.set(JSON.stringify(p), a.grade) } }
  const { fetchImpl, bodies } = stub([0.7])
  const judge = createCoverageJudge(JEV, { apiKey: 'k', fetchImpl, sleep: async () => {}, cache })
  const items = [item('n1', '需求', '摘录')]
  assert.equal((await judge.judge({ goal: GOAL }, items)).usage.requests, 1)
  const again = await judge.judge({ goal: GOAL }, items)
  assert.deepEqual([again.usage.requests, again.usage.cacheHits, [...again.probs]], [0, 1, [['n1', 0.7]]])
  assert.equal(bodies.length, 1)
  assert.equal(probes[0]!.rubric, judge.rubricRef.key)
  assert.equal(probes[0]!.provider, 'bocha-jev|systemone|bocha-jev-v1')
  assert.equal(probes[0]!.candidate, '摘录')
})

test('a ledger cap refuses the request: the judge throws the budget error (the pipeline keeps rule coverage), and the ledger books it', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wsp-cover-'))
  const db = new Store(path.join(dir, 'store.db'))
  try {
    const ledger = new UsageLedger(db, resolveBudget({ perSearchInputTokens: 50 }).caps)
    const { fetchImpl, bodies } = stub()
    const judge = createCoverageJudge(JEV, { apiKey: 'k', fetchImpl, sleep: async () => {}, meter: ledger.forSearch('s1').meterFor(JEV) })
    await assert.rejects(judge.judge({ goal: GOAL }, [item('n1', '需求', '摘录')]), (e: unknown) => e instanceof BudgetExceededError)
    assert.equal(bodies.length, 0)
    // With room, the same judge is metered like any model call: the settled usage is the service's own.
    const roomy = new UsageLedger(db, resolveBudget({}).caps)
    const metered = createCoverageJudge(JEV, { apiKey: 'k', fetchImpl: stub([0.6]).fetchImpl, sleep: async () => {}, meter: roomy.forSearch('s2').meterFor(JEV) })
    await metered.judge({ goal: GOAL }, [item('n1', '需求', '摘录')])
    const today = roomy.today()
    assert.deepEqual([today.totals.requests, today.totals.inputTokens, today.totals.outputTokens], [1, 400, 3])
  } finally { db.close(); fs.rmSync(dir, { recursive: true, force: true }) }
})

test('only the systemone protocol can serve the coverage judge, and a keyed provider needs its key', () => {
  assert.throws(() => createCoverageJudge({ ...PRESETS['jina-rerank']!, calibration: { version: 'v1', points: [[0, 0], [1, 3]] } }, { apiKey: 'k' }), /needs the systemone protocol/)
  assert.throws(() => createCoverageJudge(JEV, {}), /needs BOCHA_JEV_API_KEY/)
  assert.doesNotThrow(() => createCoverageJudge(PRESETS['laya-local']!, {}))
  // The scorer and the coverage judge share the transport but are separate classes.
  assert.ok(createModelScorer(JEV, { apiKey: 'k' }).score)
  assert.equal((createCoverageJudge(JEV, { apiKey: 'k' }) as unknown as { score?: unknown }).score, undefined)
})

// ── bands and thresholds ────────────────────────────────────────────────────

test('bands: below weak is weak, from covered up is covered, between is uncertain', () => {
  const t = { weak: 0.3, covered: 0.7 }
  assert.deepEqual([0, 0.299, 0.3, 0.5, 0.699, 0.7, 1].map(p => bandOf(p, t)), ['weak', 'weak', 'uncertain', 'uncertain', 'uncertain', 'covered', 'covered'])
  assert.deepEqual([0.5, 0.5].map(p => bandOf(p, { weak: 0.5, covered: 0.5 })), ['covered', 'covered'])
})

test('thresholds are validated; without configured or shipped ones the judge says what is missing instead of guessing', () => {
  assert.deepEqual(thresholdsProblems({ weak: 0.2, covered: 0.6 }), [])
  assert.match(thresholdsProblems({ weak: 0.7, covered: 0.2 }).join('|'), /weak must not exceed/)
  assert.match(thresholdsProblems({ weak: -1, covered: 2 }).join('|'), /thresholds.weak must be a number in 0..1.*thresholds.covered must be a number in 0..1/)
  assert.match(thresholdsProblems({ weak: 0.1, covered: 0.2, extra: 1 }).join('|'), /unknown threshold "extra"/)
  assert.match(thresholdsProblems('x').join('|'), /must be an object/)
  const r = builtinRubric('cover.sufficient')
  assert.deepEqual(resolveThresholds({ thresholds: { weak: 0.2, covered: 0.6 } }, 'my-jev', r), { thresholds: { weak: 0.2, covered: 0.6 }, source: 'configured' })
  assert.match(resolveThresholds({ thresholds: { weak: 0.9, covered: 0.1 } }, 'bocha-jev', r).reason!, /ignored: thresholds.weak must not exceed/)
  assert.deepEqual(CALIBRATED_THRESHOLDS['bocha-jev|cover.sufficient@v1'], { weak: 0.0512, covered: 0.313 })
  assert.deepEqual(resolveThresholds({}, 'bocha-jev', r), { thresholds: CALIBRATED_THRESHOLDS['bocha-jev|cover.sufficient@v1']!, source: 'calibrated' })
  assert.match(resolveThresholds({}, 'bocha-jev', { id: 'cover.sufficient', version: 'v2' }).reason!, /no calibrated thresholds for bocha-jev\|cover.sufficient@v2/)
  assert.match(resolveThresholds({}, 'other', r).reason!, /no calibrated thresholds for other\|cover.sufficient@v1.*set evidence.coverage.thresholds/)
})

// ── the evidence view and verdicts ──────────────────────────────────────────

const grades = (entries: [string, number][]): ReadonlyMap<string, BlockGrade> => new Map(entries.map(([id, grade]) => [id, { grade, rank: grade }]))
function selected(url: string, title: string, excerpt: string, g: [string, number][], heading?: string): SelectedBlock {
  const block: ScoredBlock = { candidateId: 'c', url, title, providers: ['ddg'], block: { blockId: 'b_' + excerpt.length, text: excerpt, start: 0, end: excerpt.length, hash: 'h', ...heading ? { heading } : {} }, grades: grades(g) }
  return { block, excerpt, needIds: g.filter(([, x]) => x >= 1).map(([id]) => id), grade: Math.max(...g.map(([, x]) => x)), reason: 'greedy' }
}

test('the evidence view: only excerpts mapped to the need, highest grade first, numbered with title, host and heading', () => {
  const sel = [
    selected('https://a.test/x', 'Page A', 'low grade excerpt', [['n1', 1]]),
    selected('https://b.test/y', 'Page B', 'high grade excerpt', [['n1', 3]], 'API > Options'),
    selected('https://c.test/z', 'Page C', 'other need only', [['n2', 3]]),
  ]
  assert.equal(evidenceView('n1', sel), '[1] Page B — b.test\n§ API > Options\nhigh grade excerpt\n\n[2] Page A — a.test\nlow grade excerpt')
  assert.equal(evidenceView('n2', sel), '[1] Page C — c.test\nother need only')
  assert.equal(evidenceView('n3', sel), '')
})

test('the evidence view respects the budget: whole excerpts first, the next one shortened when 200+ characters remain, else dropped', () => {
  const sel = [selected('https://a.test/', 'A', 'a'.repeat(600), [['n1', 3]]), selected('https://b.test/', 'B', 'b'.repeat(600), [['n1', 2]]), selected('https://c.test/', 'C', 'c'.repeat(600), [['n1', 2]])]
  const full = evidenceView('n1', sel, 2400)
  assert.ok(full.length <= 2400 && full.includes('c'.repeat(600)))
  const cutView = evidenceView('n1', sel, 1000)
  assert.ok(cutView.length <= 1000)
  assert.ok(cutView.includes('a'.repeat(600)) && cutView.includes('b'.repeat(300)) && cutView.endsWith('…') && !cutView.includes('c'))
  const tight = evidenceView('n1', sel, 750)
  assert.ok(tight.length <= 750 && !tight.includes('b') && !tight.includes('…'))
  const single = evidenceView('n1', sel.slice(0, 1), 100)
  assert.ok(single.length <= 100 && single.endsWith('…'))
})

const NEEDS: Need[] = [{ id: 'n1', text: '第一', critical: true }, { id: 'n2', text: '第二', critical: false }, { id: 'n3', text: '第三', critical: true }]

test('verdicts: raw probabilities rounded, bands from the thresholds; weak ones leave covered and become weak_support gaps in need order', () => {
  const t = { weak: 0.3, covered: 0.7 }
  const verdicts = verdictsOf(new Map([['n1', 0.123456], ['n2', 0.9], ['n3', 0.5]]), t)
  assert.deepEqual(verdicts, [{ needId: 'n1', prob: 0.1235, band: 'weak' }, { needId: 'n2', prob: 0.9, band: 'covered' }, { needId: 'n3', prob: 0.5, band: 'uncertain' }])
  const out = applyVerdicts(NEEDS, { covered: ['n1', 'n2', 'n3'], gaps: [] }, verdicts)
  assert.deepEqual(out.covered, ['n2', 'n3'])
  assert.deepEqual(out.uncertain, ['n3'])
  assert.deepEqual(out.gaps, [{ needId: 'n1', text: '第一', critical: true, reason: 'weak_support', band: 'weak' }])
  // Existing rule gaps stay as they are, merged in need order; needs without a verdict keep the rule coverage.
  const ruleGap = { needId: 'n2', text: '第二', critical: false, reason: 'budget' as const, bestGrade: 2.4 }
  const mixed = applyVerdicts(NEEDS, { covered: ['n1', 'n3'], gaps: [ruleGap] }, [{ needId: 'n3', prob: 0.1, band: 'weak' }])
  assert.deepEqual(mixed.covered, ['n1'])
  assert.deepEqual(mixed.gaps.map(g => [g.needId, g.reason]), [['n2', 'budget'], ['n3', 'weak_support']])
  assert.deepEqual(mixed.uncertain, [])
})

test('a 422 token_budget_exceeded splits the request in halves (and halves a single long evidence once) instead of losing the needs', async () => {
  const bodies: number[] = []
  const fetchImpl = (async (_url: string, init: { body: string }) => {
    const body = JSON.parse(init.body)
    const keys = Object.keys(body.questions)
    bodies.push(keys.length)
    if (keys.length > 1 || body.questions.q0.instructions.length > 1500) return new Response(JSON.stringify({ error: 'token_budget_exceeded' }), { status: 422 })
    return new Response(JSON.stringify({ answers: { q0: { noul: 0.8 } }, usage: { input_tokens: 10, output_tokens: 0 } }), { status: 200 })
  }) as unknown as typeof fetch
  const judge = createCoverageJudge(JEV, { apiKey: 'k', fetchImpl, sleep: async () => {} })
  const out = await judge.judge({ goal: GOAL }, [item('n1', '一', 'a'.repeat(2000)), item('n2', '二', 'short'), item('n3', '三', 'short too')])
  assert.deepEqual([...out.probs.keys()].sort(), ['n1', 'n2', 'n3'])
  assert.ok(bodies.length > 3)
})
