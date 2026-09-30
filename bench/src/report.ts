/**
 * Report for a judge run: metrics per judge × rubric, per language and overall
 * (dev-plan §6.3/§6.4). Writes report.md (Chinese) and report.json next to the
 * run's results.jsonl.
 *
 *   node --experimental-transform-types bench/src/report.ts --run <runId|dir> [--min-recall 0.95]
 * @module bench/report
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { numberFlag, parseFlags } from './cli.ts'
import { CANDIDATES_DIR, LABELS_DIR, readLabel, readSnapshotFile, RUNS_DIR } from './data.ts'
import { canonicalUrl } from './harvest-lib.ts'
import {
  brier, chooseDropThreshold, ece, evalThreshold, mean, ndcgAtK, percentile, rocAuc, spearman,
} from './metrics.ts'
import type { ResultRow } from './run-judges.ts'
import { assignSplits, loadTasks } from './tasks.ts'
import type { BenchTask, CandidateSnapshot, Label, Satisfied, Split } from './types.ts'

export const SLICES = ['all', 'zh', 'en', 'mixed'] as const
export type Slice = typeof SLICES[number]

// ── ground truth from labels + snapshots ────────────────────────────────────

export interface TaskTruth {
  rel: Map<string, number>
  checks: Map<string, Satisfied>
  nav: Map<string, boolean>
  /** needId -> gold blockIds. */
  gold: Map<string, Set<string>>
  goldUrls: Set<string>
  blockUrl: Map<string, string>
}

export function buildTruth(label: Label, snapshot: CandidateSnapshot | undefined): TaskTruth {
  const t: TaskTruth = { rel: new Map(), checks: new Map(), nav: new Map(), gold: new Map(), goldUrls: new Set(), blockUrl: new Map() }
  for (const c of label.candidates) {
    const key = canonicalUrl(c.url)
    t.rel.set(key, c.relevance)
    t.nav.set(key, c.navPage === true)
    for (const k of c.constraintChecks) t.checks.set(key + '|' + k.constraintId, k.satisfied)
  }
  for (const g of label.gold) {
    t.gold.set(g.needId, new Set(g.evidence.map(e => e.blockId)))
    for (const e of g.evidence) t.goldUrls.add(canonicalUrl(e.url))
  }
  for (const page of snapshot?.pages ?? []) for (const b of page.blocks) t.blockUrl.set(b.blockId, canonicalUrl(page.url))
  return t
}

export interface ReportInput {
  runId: string
  rows: ResultRow[]
  tasks: BenchTask[]
  splits: ReadonlyMap<string, Split>
  truth: ReadonlyMap<string, TaskTruth>
  labelers: string[]
  minRecall?: number
}

// ── result types ────────────────────────────────────────────────────────────

export interface GateSliceMetrics { n: number; positives: number; auc: number | undefined; auc1?: number | undefined; brier: number | undefined; ece: number | undefined }
export interface GateTestMetrics { n: number; recall2: number | undefined; recall1: number | undefined; dropped: number | undefined; goldRecall: number | undefined; goldN: number }
export interface GateReport {
  judge: string
  rubricId: string
  rubricVersion: string
  tasks: number
  calibrationTasks: number
  testTasks: number
  /** Drop threshold picked on calibration (recall of label>=2 >= minRecall); undefined for non-relevance rubrics. */
  threshold?: number
  calibrationDropped?: number
  slices: Record<string, GateSliceMetrics>
  test: Record<string, GateTestMetrics>
}
export interface ScoreReport {
  judge: string
  rubricId: string
  tasks: number
  spearman: Record<string, { rho: number | undefined; n: number }>
  ndcg5: Record<string, { mean: number | undefined; needs: number }>
  ndcg5Common: { mean: number | undefined; needs: number }
  /** confusion[roundedGrade][labelRelevance] */
  confusion: number[][]
}
export interface CostReport {
  judge: string
  rows: number
  errors: number
  cachedRows: number
  truncatedRows: number
  requests: number
  inputTokens: number
  outputTokens: number
  avgBatch: number | undefined
  latencyP50: number | undefined
  latencyP95: number | undefined
}
export interface ProfileReport { judge: string; n: number; accuracy: Record<string, { acc: number | undefined; n: number }> }
export interface ReportJson {
  runId: string
  generatedAt: string
  minRecall: number
  labelers: string[]
  tasks: { total: number; calibration: number; test: number }
  coverage: Record<string, number>
  gate: GateReport[]
  gateCommon: Record<string, { tasks: number; auc: Record<string, number | undefined> }>
  score: ScoreReport[]
  profile: ProfileReport[]
  cost: CostReport[]
}

const inSlice = (lang: string, slice: Slice): boolean => slice === 'all' || lang === slice

interface Sample { taskId: string; split: Split; lang: string; prob: number; rel?: number; truth?: boolean; goldCand?: boolean }

function gateSamples(rows: readonly ResultRow[], truth: ReadonlyMap<string, TaskTruth>, rubricId: string): Sample[] {
  const out: Sample[] = []
  for (const r of rows) {
    if (r.error || r.prob === undefined) continue
    const t = truth.get(r.taskId)
    if (!t) continue
    const key = canonicalUrl(r.itemId)
    const base = { taskId: r.taskId, split: r.split, lang: r.lang, prob: r.prob }
    if (rubricId.startsWith('gate.constraint')) {
      const v = t.checks.get(key + '|' + r.constraintId)
      if (v === 'yes' || v === 'no') out.push({ ...base, truth: v === 'yes' })
    } else if (rubricId.startsWith('gate.nav')) {
      if (t.nav.has(key)) out.push({ ...base, truth: t.nav.get(key)! })
    } else {
      const rel = t.rel.get(key)
      if (rel !== undefined) out.push({ ...base, rel, truth: rel >= 2, goldCand: t.goldUrls.has(key) })
    }
  }
  return out
}

function sliceMetrics(samples: readonly Sample[], isRel: boolean): GateSliceMetrics {
  const probs = samples.map(s => s.prob)
  const truth = samples.map(s => s.truth === true)
  return {
    n: samples.length,
    positives: truth.filter(Boolean).length,
    auc: rocAuc(probs, truth),
    ...(isRel ? { auc1: rocAuc(probs, samples.map(s => (s.rel ?? 0) >= 1)) } : {}),
    brier: brier(probs, truth),
    ece: ece(probs, truth),
  }
}

function testMetrics(samples: readonly Sample[], t: number): GateTestMetrics {
  const probs = samples.map(s => s.prob)
  const e2 = evalThreshold(probs, samples.map(s => (s.rel ?? 0) >= 2), t)
  const e1 = evalThreshold(probs, samples.map(s => (s.rel ?? 0) >= 1), t)
  const gold = samples.filter(s => s.goldCand)
  return {
    n: samples.length, recall2: e2.recall, recall1: e1.recall, dropped: e2.dropped,
    goldRecall: gold.length ? gold.filter(s => s.prob >= t).length / gold.length : undefined, goldN: gold.length,
  }
}

export function buildReport(input: ReportInput): ReportJson {
  const { rows, truth, splits } = input
  const minRecall = input.minRecall ?? 0.95
  const judges = [...new Set(rows.map(r => r.judge))]
  const s4 = rows.filter(r => r.stage === 's4')
  const coverage: Record<string, number> = {}
  for (const j of judges) coverage[j] = new Set(rows.filter(r => r.judge === j && !r.error).map(r => r.taskId)).size

  // Gate
  const gate: GateReport[] = []
  const rubricIds = [...new Set(s4.map(r => r.rubricId))].sort()
  for (const judge of judges) {
    for (const rubricId of rubricIds) {
      const sub = s4.filter(r => r.judge === judge && r.rubricId === rubricId)
      if (!sub.length) continue
      const isRel = !rubricId.startsWith('gate.constraint') && !rubricId.startsWith('gate.nav')
      const samples = gateSamples(sub, truth, rubricId)
      if (!samples.length) continue
      const report: GateReport = {
        judge, rubricId, rubricVersion: sub[0]!.rubricVersion,
        tasks: new Set(samples.map(s => s.taskId)).size,
        calibrationTasks: new Set(samples.filter(s => s.split === 'calibration').map(s => s.taskId)).size,
        testTasks: new Set(samples.filter(s => s.split === 'test').map(s => s.taskId)).size,
        slices: {}, test: {},
      }
      for (const slice of SLICES) report.slices[slice] = sliceMetrics(samples.filter(s => inSlice(s.lang, slice)), isRel)
      if (isRel) {
        const cal = samples.filter(s => s.split === 'calibration')
        const t = chooseDropThreshold(cal.map(s => s.prob), cal.map(s => (s.rel ?? 0) >= 2), minRecall)
        if (t !== undefined) {
          report.threshold = t
          report.calibrationDropped = evalThreshold(cal.map(s => s.prob), cal.map(s => (s.rel ?? 0) >= 2), t).dropped
          const test = samples.filter(s => s.split === 'test')
          for (const slice of SLICES) report.test[slice] = testMetrics(test.filter(s => inSlice(s.lang, slice)), t)
        }
      }
      gate.push(report)
    }
  }

  // Gate on the tasks covered by every judge (fair comparison when a judge was capped).
  const gateCommon: ReportJson['gateCommon'] = {}
  for (const rubricId of rubricIds) {
    const perJudge = judges.map(j => ({ judge: j, samples: gateSamples(s4.filter(r => r.judge === j && r.rubricId === rubricId), truth, rubricId) })).filter(x => x.samples.length)
    if (perJudge.length < 2) continue
    let common = new Set(perJudge[0]!.samples.map(s => s.taskId))
    for (const p of perJudge) common = new Set([...common].filter(t => p.samples.some(s => s.taskId === t)))
    gateCommon[rubricId] = { tasks: common.size, auc: {} }
    for (const p of perJudge) {
      const sub = p.samples.filter(s => common.has(s.taskId))
      gateCommon[rubricId]!.auc[p.judge] = rocAuc(sub.map(s => s.prob), sub.map(s => s.truth === true))
    }
  }

  // Score (S6)
  const s6 = rows.filter(r => r.stage === 's6' && !r.error && r.grade !== undefined)
  const needKey = (r: ResultRow): string => r.taskId + '|' + r.needId
  const scoreJudges = [...new Set(s6.map(r => r.judge))]
  const needsByJudge = new Map(scoreJudges.map(j => [j, new Set(s6.filter(r => r.judge === j && (truth.get(r.taskId)?.gold.get(r.needId ?? '')?.size ?? 0) > 0).map(needKey))]))
  let commonNeeds: Set<string> | undefined
  for (const set of needsByJudge.values()) commonNeeds = commonNeeds ? new Set([...commonNeeds].filter(k => set.has(k))) : new Set(set)
  const score: ScoreReport[] = scoreJudges.map(judge => {
    const mine = s6.filter(r => r.judge === judge)
    const rep: ScoreReport = {
      judge, rubricId: mine[0]!.rubricId, tasks: new Set(mine.map(r => r.taskId)).size,
      spearman: {}, ndcg5: {}, ndcg5Common: { mean: undefined, needs: 0 },
      confusion: Array.from({ length: 4 }, () => new Array<number>(4).fill(0)),
    }
    const pairs = mine.map(r => ({ r, rel: truth.get(r.taskId)?.rel.get(truth.get(r.taskId)?.blockUrl.get(r.itemId) ?? '') })).filter(x => x.rel !== undefined)
    for (const { r, rel } of pairs) rep.confusion[Math.min(3, Math.max(0, Math.round(r.grade!)))]![rel!]!++
    const byNeed = new Map<string, ResultRow[]>()
    for (const r of mine) byNeed.set(needKey(r), [...byNeed.get(needKey(r)) ?? [], r])
    const ndcgOf = (r: ResultRow[]): number | undefined => {
      const gold = truth.get(r[0]!.taskId)?.gold.get(r[0]!.needId ?? '')
      return gold?.size ? ndcgAtK(r.map(x => ({ score: x.grade!, relevant: gold.has(x.itemId) })), gold.size, 5) : undefined
    }
    for (const slice of SLICES) {
      const p = pairs.filter(x => inSlice(x.r.lang, slice))
      rep.spearman[slice] = { rho: spearman(p.map(x => x.r.grade!), p.map(x => x.rel!)), n: p.length }
      const vals = [...byNeed.values()].filter(r => inSlice(r[0]!.lang, slice)).map(ndcgOf).filter((v): v is number => v !== undefined)
      rep.ndcg5[slice] = { mean: mean(vals), needs: vals.length }
    }
    const commonVals = [...byNeed].filter(([k]) => commonNeeds?.has(k)).map(([, r]) => ndcgOf(r)).filter((v): v is number => v !== undefined)
    rep.ndcg5Common = { mean: mean(commonVals), needs: commonVals.length }
    return rep
  })

  // Profile (S1)
  const profile: ProfileReport[] = []
  for (const judge of judges) {
    const mine = rows.filter(r => r.stage === 's1' && r.judge === judge && !r.error && r.decision)
    if (!mine.length) continue
    const acc: ProfileReport['accuracy'] = {}
    for (const slice of SLICES) {
      const p = mine.filter(r => inSlice(r.lang, slice))
      acc[slice] = { acc: p.length ? p.filter(r => r.decision === r.profile).length / p.length : undefined, n: p.length }
    }
    profile.push({ judge, n: mine.length, accuracy: acc })
  }

  // Cost / latency
  const cost: CostReport[] = judges.map(judge => {
    const mine = rows.filter(r => r.judge === judge)
    const fresh = new Map<string, ResultRow>()
    for (const r of mine) if (r.requestId && !r.cached) fresh.set(r.requestId, r)
    const usageRows = mine.filter(r => r.usage && !r.cached)
    return {
      judge, rows: mine.length, errors: mine.filter(r => r.error).length, cachedRows: mine.filter(r => r.cached).length, truncatedRows: mine.filter(r => r.truncated).length,
      requests: fresh.size,
      inputTokens: usageRows.reduce((a, r) => a + r.usage!.inputTokens, 0),
      outputTokens: usageRows.reduce((a, r) => a + r.usage!.outputTokens, 0),
      avgBatch: mean([...fresh.values()].map(r => r.batchSize ?? 1)),
      latencyP50: percentile([...fresh.values()].map(r => r.latencyMs), 50),
      latencyP95: percentile([...fresh.values()].map(r => r.latencyMs), 95),
    }
  })

  const labeledTasks = [...truth.keys()]
  return {
    runId: input.runId, generatedAt: new Date().toISOString(), minRecall, labelers: input.labelers,
    tasks: {
      total: labeledTasks.length,
      calibration: labeledTasks.filter(t => splits.get(t) === 'calibration').length,
      test: labeledTasks.filter(t => splits.get(t) === 'test').length,
    },
    coverage, gate, gateCommon, score, profile, cost,
  }
}

// ── markdown ────────────────────────────────────────────────────────────────

const f = (n: number | undefined, d = 3): string => (n === undefined || !Number.isFinite(n) ? '—' : n.toFixed(d))
const pct = (n: number | undefined): string => (n === undefined ? '—' : (n * 100).toFixed(1) + '%')
const table = (head: string[], body: string[][]): string =>
  ['| ' + head.join(' | ') + ' |', '|' + head.map(() => '---').join('|') + '|', ...body.map(r => '| ' + r.join(' | ') + ' |')].join('\n')

export function renderMarkdown(r: ReportJson): string {
  const out: string[] = []
  out.push('# 判定器对照实验报告：' + r.runId, '')
  out.push('> **注意：标注为 LLM 初稿，未经人工复核**（标注者：' + (r.labelers.join('、') || '未知') + '）。所有指标都是对该初稿的一致性，不是对真值的一致性；DeepSeek 判定器与标注者同源，存在泄漏，仅作参考。', '')
  out.push('- 生成时间：' + r.generatedAt)
  out.push('- 已标注任务：' + r.tasks.total + '（calibration ' + r.tasks.calibration + '，test ' + r.tasks.test + '）')
  out.push('- 各判定器覆盖任务数：' + Object.entries(r.coverage).map(([j, n]) => j + ' ' + n).join('，'))
  out.push('- Gate 正例：标注相关度 ≥ 2（另报 ≥ 1）；drop 阈值在 calibration 上选取，使正例召回 ≥ ' + r.minRecall + '（prob < 阈值则丢弃），在 test 上评估。', '')

  const relGate = r.gate.filter(g => g.threshold !== undefined || /gate\.(single|relevance)/.test(g.rubricId))
  out.push('## 1. S4 Gate：区分度与校准（全部已标注任务）', '')
  for (const rubricId of [...new Set(r.gate.map(g => g.rubricId))]) {
    const isRel = /gate\.(single|relevance)/.test(rubricId)
    out.push('### ' + rubricId, '')
    const head = isRel
      ? ['判定器', '范围', 'n', '正例', 'AUC(≥2)', 'AUC(≥1)', 'Brier', 'ECE']
      : ['判定器', '范围', 'n', '正例', 'AUC', 'Brier', 'ECE']
    const body: string[][] = []
    for (const g of r.gate.filter(x => x.rubricId === rubricId)) {
      for (const slice of SLICES) {
        const m = g.slices[slice]!
        if (!m.n) continue
        body.push(isRel
          ? [g.judge, slice, String(m.n), String(m.positives), f(m.auc), f(m.auc1), f(m.brier), f(m.ece)]
          : [g.judge, slice, String(m.n), String(m.positives), f(m.auc), f(m.brier), f(m.ece)])
      }
    }
    out.push(table(head, body), '')
    const common = r.gateCommon[rubricId]
    if (common) out.push('公共任务子集（所有判定器都覆盖的 ' + common.tasks + ' 个任务）AUC：' + Object.entries(common.auc).map(([j, a]) => j + ' ' + f(a)).join('，'), '')
  }

  out.push('## 2. S4 Gate：drop 阈值（calibration 选取 → test 评估）', '')
  const thr = relGate.filter(g => g.threshold !== undefined)
  if (!thr.length) out.push('（没有足够的 calibration 正例来选阈值）', '')
  else {
    const body: string[][] = []
    for (const g of thr) {
      for (const slice of SLICES) {
        const t = g.test[slice]
        if (!t?.n) continue
        body.push([g.judge, g.rubricId, slice === 'all' ? f(g.threshold, 4) : '', slice, String(t.n), pct(t.recall2), pct(t.recall1), pct(t.dropped), pct(t.goldRecall) + ' (' + t.goldN + ')'])
      }
    }
    out.push(table(['判定器', 'rubric', '阈值', '范围(test)', 'n', '正例召回(≥2)', '正例召回(≥1)', '丢弃比例', '含金标准块候选召回(n)'], body), '')
    out.push('通过门槛（§6.4）：金标准证据保留率 ≥ 0.95，且读取/评分候选数减少 ≥ 40%（即丢弃比例 ≥ 40%）。', '')
  }

  out.push('## 3. S6 评分（score.support.v1）', '')
  if (!r.score.length) out.push('（本次运行没有 S6 结果）', '')
  else {
    out.push(table(['判定器', '任务数', ...SLICES.map(s => 'Spearman ' + s), ...SLICES.map(s => 'nDCG@5 ' + s), 'nDCG@5 公共需求'],
      r.score.map(s => [s.judge, String(s.tasks),
        ...SLICES.map(sl => f(s.spearman[sl]?.rho) + ' (n=' + (s.spearman[sl]?.n ?? 0) + ')'),
        ...SLICES.map(sl => f(s.ndcg5[sl]?.mean) + ' (' + (s.ndcg5[sl]?.needs ?? 0) + ')'),
        f(s.ndcg5Common.mean) + ' (' + s.ndcg5Common.needs + ')'])), '')
    out.push('Spearman 用块所在页面的候选相关度标注作为参照；nDCG@5 用金标准块（括号内为有金标准的 need 数），理想排序按全部金标准块计算，同分按平均增益处理。', '')
    for (const s of r.score) {
      out.push('混淆矩阵 ' + s.judge + '（行：四舍五入后的 grade，列：标注相关度 0–3）', '')
      out.push(table(['grade\\标注', '0', '1', '2', '3'], s.confusion.map((row, i) => [String(i), ...row.map(String)])), '')
    }
  }

  if (r.profile.length) {
    out.push('## 4. Profile 选择（profile.choice.v1）', '')
    out.push(table(['判定器', 'n', ...SLICES.map(s => '准确率 ' + s)], r.profile.map(p => [p.judge, String(p.n), ...SLICES.map(s => pct(p.accuracy[s]?.acc))])), '')
  }

  out.push('## 5. 成本与延迟', '')
  out.push(table(['判定器', '结果行', '失败行', '缓存命中行', '被截断行', '请求数', '输入 token', '输出 token', '平均批量', '延迟 p50 ms', '延迟 p95 ms'],
    r.cost.map(c => [c.judge, String(c.rows), String(c.errors), String(c.cachedRows), String(c.truncatedRows), String(c.requests), String(c.inputTokens), String(c.outputTokens), f(c.avgBatch, 1), f(c.latencyP50, 0), f(c.latencyP95, 0)])), '')
  out.push('请求数、token 与延迟只统计本次实际发出的请求（缓存命中不计）；规则判定器不发请求。延迟为整次请求的墙钟时间。', '')
  return out.join('\n')
}

// ── CLI ─────────────────────────────────────────────────────────────────────

export function loadRows(file: string): ResultRow[] {
  return fs.readFileSync(file, 'utf8').split('\n').filter(l => l.trim()).map(l => JSON.parse(l) as ResultRow)
}

async function main(): Promise<number> {
  const flags = parseFlags(process.argv.slice(2), { values: ['run', 'min-recall', 'labels-dir', 'candidates-dir'], booleans: [] })
  if (typeof flags.run !== 'string') throw new Error('--run <runId|dir> is required')
  const dir = fs.existsSync(flags.run) ? path.resolve(flags.run) : path.join(RUNS_DIR, flags.run)
  const rows = loadRows(path.join(dir, 'results.jsonl'))
  const labelsDir = typeof flags['labels-dir'] === 'string' ? path.resolve(flags['labels-dir']) : LABELS_DIR
  const candidatesDir = typeof flags['candidates-dir'] === 'string' ? path.resolve(flags['candidates-dir']) : CANDIDATES_DIR
  const tasks = loadTasks()
  const splits = assignSplits(tasks)
  const truth = new Map<string, TaskTruth>()
  const labelers = new Set<string>()
  for (const id of new Set(rows.map(r => r.taskId))) {
    const label = readLabel(labelsDir, id)
    if (!label) continue
    truth.set(id, buildTruth(label, readSnapshotFile(candidatesDir, id)))
    labelers.add(label.labeler.id + (label.labeler.effort ? '/' + label.labeler.effort : '') + (label.labeler.reviewed ? '（已复核）' : '（未复核）'))
  }
  const report = buildReport({ runId: path.basename(dir), rows, tasks, splits, truth, labelers: [...labelers], minRecall: numberFlag(flags, 'min-recall', 0.95) })
  fs.writeFileSync(path.join(dir, 'report.json'), JSON.stringify(report, null, 2) + '\n')
  fs.writeFileSync(path.join(dir, 'report.md'), renderMarkdown(report) + '\n')
  console.log('wrote ' + path.join(dir, 'report.md') + ' and report.json')
  return 0
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().then(code => process.exit(code), error => { console.error((error as Error).message); process.exit(1) })
}
