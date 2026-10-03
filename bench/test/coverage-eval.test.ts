import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { splitBlocks } from '../../src/pipeline/blocks.ts'
import { calibrateThresholds, coverageMetrics, renderCoverageSection, type CoverageNeed, type CoverageRun } from '../src/coverage-eval.ts'
import { coverageArm, coverageRunOf, coverJudgeCache, goldPairs, type EvalOptions, type LoadedTask } from '../src/eval-pack.ts'
import type { BenchTask, CandidateSnapshot, Label, PageSnapshot } from '../src/types.ts'

const need = (needId: string, claimed: boolean, hit: boolean, prob?: number, hasGold = hit): CoverageNeed => ({ needId, claimed, hit, hasGold, ...prob !== undefined ? { prob } : {} })
const run = (...needs: CoverageNeed[]): CoverageRun => ({ needs, asked: needs.filter(n => n.claimed).length, answered: needs.filter(n => n.prob !== undefined).length, requests: 0, cold: 0, cacheHits: 0, misses: 0, inputTokens: 0 })

test('metrics: without thresholds the rule coverage stands; with them weak claims are removed and counted by truth', () => {
  const runs = [
    run(need('a', true, true, 0.9), need('b', true, false, 0.1), need('c', true, true, 0.2), need('d', false, false, undefined, false)),
    run(need('e', true, false, 0.5, false), need('f', false, true, undefined, true)),
  ]
  const plain = coverageMetrics(runs)
  assert.deepEqual([plain.claimed, plain.claimedHit, plain.precision, plain.needsWithGold, plain.hitNeeds, plain.needHit, plain.claimRecall], [4, 2, 0.5, 3, 3, 1, 2 / 3])
  assert.deepEqual([plain.noGold, plain.noGoldFlagged, plain.weakTotal], [3, 1, 0], 'd is a gap already; b and e are false claims')
  const m = coverageMetrics(runs, { weak: 0.3, covered: 0.7 })
  assert.deepEqual([m.claimed, m.claimedHit, m.precision, m.claimRecall, m.needHit], [2, 1, 0.5, 1 / 3, 1])
  assert.deepEqual([m.weakTotal, m.falseWeak, m.wrongRemoved, m.uncertain], [2, 1, 1, 1])
  assert.deepEqual([m.falseWeakRate, m.wrongRemovedRate], [0.5, 1 / 2])
  assert.equal(m.noGoldFlagged, 2, 'b was removed and d is a gap; e (no gold) stays a claim')
  // A claimed need the judge did not answer keeps the rule coverage.
  const unanswered = coverageMetrics([run(need('x', true, false))], { weak: 0.9, covered: 0.95 })
  assert.deepEqual([unanswered.claimed, unanswered.weakTotal], [1, 0])
})

test('calibration: the cut removes the most false claims while at most 5% of the true ones are lost; covered is where precision reaches 85%', () => {
  // 40 true claims with high probabilities (one outlier at 0.15), 12 false ones spread low to mid.
  const trues = Array.from({ length: 40 }, (_, i) => need('t' + i, true, true, i === 0 ? 0.15 : 0.8 + (i % 10) / 100))
  const falses = [0.02, 0.03, 0.05, 0.08, 0.1, 0.12, 0.14, 0.4, 0.5, 0.6, 0.85, 0.9].map((p, i) => need('f' + i, true, false, p))
  const fit = calibrateThresholds([run(...trues, ...falses)])!
  // Losing the 0.15 outlier is 1/40 = 2.5% of the true claims (<= 5%); the cut goes halfway between 0.6 and 0.8, removing the ten false claims below it.
  assert.equal(fit.thresholds.weak, 0.7)
  assert.equal(fit.at.falseWeak, 1)
  assert.equal(fit.at.wrongRemoved, 10)
  assert.ok(fit.thresholds.covered >= fit.thresholds.weak)
  assert.equal(fit.claimedAnswered, 52)
  const atFit = coverageMetrics([run(...trues, ...falses)], fit.thresholds)
  assert.ok(atFit.precision! > coverageMetrics([run(...trues, ...falses)]).precision!)
  assert.ok(atFit.falseWeakRate! <= 0.05)
  // Nothing answered: nothing to fit.
  assert.equal(calibrateThresholds([run(need('x', true, true))]), undefined)
})

test('calibration never loses more than the allowed share: when every cut loses too many true claims the judge removes nothing', () => {
  const needs = [need('a', true, true, 0.1), need('b', true, true, 0.2), need('c', true, false, 0.3), need('d', true, true, 0.9)]
  const fit = calibrateThresholds([run(...needs)], { maxFalseWeak: 0.05 })!
  assert.equal(fit.thresholds.weak, 0)
  assert.equal(fit.at.weakTotal, 0)
})

// ── the arm over a snapshot, with a mocked judge ────────────────────────────

const PAGE_A = '# Busy timeout\n\nIn node:sqlite you set the busy timeout with PRAGMA busy_timeout = 5000 on the DatabaseSync connection. The busy timeout makes a blocked writer wait instead of failing at once.\n\n# Unrelated\n\nThe cooking section explains how to bake bread with flour and water in a hot oven for an hour.'
const page = (url: string, text: string): PageSnapshot => ({ url, fetchedAt: 'x', status: 'ok', source: 'http', text, from: [], blocks: splitBlocks(text, url) })

function fixture(): LoadedTask {
  const task: BenchTask = {
    id: 'dc-98', profile: 'docs_code', lang: 'en', goal: 'Set the busy timeout in node:sqlite', query: 'node:sqlite busy timeout',
    needs: [{ id: 'n1', text: 'how to set busy timeout in node:sqlite', critical: true }, { id: 'n2', text: 'quantum gravity lattice theory', critical: false }],
    constraints: [], traps: ['x'], notes: 'n',
  }
  const pageA = page('https://docs.test/a', PAGE_A)
  const snapshot: CandidateSnapshot = {
    version: 1, taskId: task.id, harvestedAt: 'h',
    engineRuns: [{ engine: 'ddg', query: task.query, status: 'ok', ms: 1, results: [{ rank: 1, url: 'https://docs.test/a', title: 'Busy docs', snippet: 'node:sqlite busy timeout' }] }],
    pages: [pageA],
  }
  const gold = pageA.blocks.find(b => b.text.includes('PRAGMA busy_timeout'))!
  const label: Label = {
    version: 1, taskId: task.id, snapshotHarvestedAt: 'h', labeler: { kind: 'llm', id: 't' }, labeledAt: 'now', candidates: [],
    gold: [{ needId: 'n1', evidence: [{ url: 'https://docs.test/a', blockId: gold.blockId, hash: gold.hash }] }, { needId: 'n2', evidence: [] }],
  }
  return { task, split: 'calibration', snapshot, label }
}

test('a coverage arm records raw verdicts in shadow mode, caches them per question, and a rerun costs no request', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wsp-cover-bench-'))
  try {
    const item = fixture()
    const opts: EvalOptions = { select: {}, fetchTopK: 4, blocksPerNeed: 12, allowJev: 0, jev: false, jevRoot: root, coverage: true }
    const bodies: any[] = []
    const fetchImpl = (async (_url: string, init: { body: string }) => {
      const body = JSON.parse(init.body)
      bodies.push(body)
      const keys = Object.keys(body.questions)
      return new Response(JSON.stringify({ answers: Object.fromEntries(keys.map((k, i) => [k, { noul: i === 0 ? 0.93 : 0.4 }])), usage: { input_tokens: 321, output_tokens: 1 } }))
    }) as unknown as typeof fetch
    const first = await coverageArm(item, opts, 4, 'k', 'rule', { fetchImpl })
    assert.equal(first.requests, 1)
    assert.ok(bodies[0].questions.q0.type === 'noul')
    const stats = first.result.pack.stats.coverage!
    assert.equal(stats.mode, 'shadow')
    assert.ok(stats.asked >= 1)
    const pairs = goldPairs(item.label)
    const recorded = coverageRunOf(item.label, pairs, first.result, { requests: first.requests, cold: 1, cacheHits: first.cache.hits, misses: first.cache.misses })
    const n1 = recorded.needs.find(n => n.needId === 'n1')!
    assert.deepEqual([n1.claimed, n1.hit, n1.hasGold, n1.prob], [true, true, true, 0.93])
    const n2 = recorded.needs.find(n => n.needId === 'n2')!
    assert.deepEqual([n2.hasGold, n2.hit], [false, false])
    assert.deepEqual([recorded.asked, recorded.answered, recorded.inputTokens], [stats.asked, stats.asked, 321])
    // Rerun from the cache only: same verdicts, no request, and the pack coverage is untouched by the judge.
    const again = await coverageArm(item, opts, 0, undefined, 'rule')
    assert.equal(again.requests, 0)
    assert.equal(again.cache.misses, 0)
    assert.deepEqual(again.result.pack.stats.coverage!.verdicts, stats.verdicts)
    assert.deepEqual(again.result.pack.coveredNeeds, first.result.pack.coveredNeeds)
    // The answers live in their own cache directory, away from the Jev score cache.
    assert.ok(fs.existsSync(path.join(root, 'jev-cover')))
    assert.ok(!fs.existsSync(path.join(root, 'jev')))
    assert.equal(coverJudgeCache(root).hits, 0)
  } finally { fs.rmSync(root, { recursive: true, force: true }) }
})

test('the coverage section lists the rule coverage and the judged coverage per group and language, or only the rule row without thresholds', () => {
  const tasks = [
    { taskId: 'a', lang: 'zh', split: 'calibration', coverage: { rule: run(need('a', true, true, 0.9), need('b', true, false, 0.1)) } },
    { taskId: 'b', lang: 'en', split: 'test', coverage: { rule: run(need('c', true, true, 0.8), need('d', true, false, 0.2)) } },
  ]
  const withT = renderCoverageSection(tasks, { weak: 0.5, covered: 0.7 }, ['阈值说明']).join('\n')
  assert.match(withT, /## 10\. M9/)
  assert.match(withT, /\| 全部 · 规则覆盖 \| 2 \| 4 \| 50\.0% \|/)
  assert.match(withT, /\| 全部 · \+ 覆盖判定 \| 2 \| 2 \| 100\.0% \| 100\.0% \| 100\.0% \|/)
  assert.match(withT, /\| zh · \+ 覆盖判定 \|/)
  assert.match(withT, /\| test · \+ 覆盖判定 \|/)
  assert.match(withT, /阈值说明/)
  const without = renderCoverageSection(tasks, undefined).join('\n')
  assert.ok(!without.includes('+ 覆盖判定'))
  assert.match(without, /未给出/)
})
