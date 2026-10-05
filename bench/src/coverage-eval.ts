/**
 * Metrics, threshold calibration and report tables of the S8 coverage judge
 * (dev-plan M9). Pure functions over per-need records, so the same verdicts
 * (raw probabilities, recorded once) can be read at any thresholds without a
 * further request.
 *
 * Truth is labelled as in the rest of the pack evaluation: a need is truly
 * covered iff a gold block for that need is in the pack. The judge only ever
 * downgrades needs the rules claimed covered, so the pack's content (and the
 * plain "need hit") cannot change offline; what changes is which claims stand:
 *   precision      - claimed needs that are truly covered / claimed needs;
 *   claim recall   - truly covered claimed needs / needs with gold (falls with false weak);
 *   false weak     - truly covered claimed needs the judge called weak / truly covered claimed needs;
 *   wrong removed  - false claims (no gold in the pack) the judge called weak / false claims;
 *   no-gold flagged- needs without any gold that the pack lists as gaps (rule gaps + weak ones).
 * @module bench/coverage-eval
 */

import { bandOf, type CoverageThresholds } from '../../src/pipeline/coverage.ts'

export type CoverageArm = 'rule' | 'hybridB'

export interface CoverageNeed {
  needId: string
  /** The rules claim the need covered. */
  claimed: boolean
  /** A gold block for the need is in the pack (the need is truly covered). */
  hit: boolean
  /** The need has gold evidence in the snapshot at all. */
  hasGold: boolean
  /** The judge's raw probability (claimed needs it answered). */
  prob?: number
}

export interface CoverageRun {
  needs: CoverageNeed[]
  /** Needs the judge was asked about, and those it answered. */
  asked: number
  answered: number
  /** HTTP requests made now / an empty cache would need; cache hits and misses of the questions. */
  requests: number
  cold: number
  cacheHits: number
  misses: number
  inputTokens: number
}

export interface CoverageMetrics {
  tasks: number
  needs: number
  needsWithGold: number
  /** Needs with a gold block in the pack (the plain need hit, unchanged by the judge). */
  hitNeeds: number
  claimed: number
  claimedHit: number
  /** Claims the judge downgraded (weak), split by truth. */
  weakTotal: number
  falseWeak: number
  wrongRemoved: number
  uncertain: number
  noGold: number
  noGoldFlagged: number
  precision: number | undefined
  claimRecall: number | undefined
  needHit: number | undefined
  falseWeakRate: number | undefined
  wrongRemovedRate: number | undefined
  noGoldFlaggedRate: number | undefined
}

const ratio = (a: number, b: number): number | undefined => (b > 0 ? a / b : undefined)

/** Metrics over `runs` with the judge read at `t` (absent = no judge: the rule coverage as it is). */
export function coverageMetrics(runs: readonly CoverageRun[], t?: CoverageThresholds): CoverageMetrics {
  const m = { tasks: runs.length, needs: 0, needsWithGold: 0, hitNeeds: 0, claimed: 0, claimedHit: 0, weakTotal: 0, falseWeak: 0, wrongRemoved: 0, uncertain: 0, noGold: 0, noGoldFlagged: 0 }
  let claimedTrue = 0
  let claimedWrong = 0
  for (const run of runs) {
    for (const n of run.needs) {
      m.needs++
      if (n.hasGold) m.needsWithGold++
      if (n.hit) m.hitNeeds++
      const band = t && n.claimed && n.prob !== undefined ? bandOf(n.prob, t) : undefined
      const stands = n.claimed && band !== 'weak'
      if (n.claimed) { if (n.hit) claimedTrue++; else claimedWrong++ }
      if (band === 'weak') { m.weakTotal++; if (n.hit) m.falseWeak++; else m.wrongRemoved++ }
      if (band === 'uncertain') m.uncertain++
      if (stands) { m.claimed++; if (n.hit) m.claimedHit++ }
      if (!n.hasGold) { m.noGold++; if (!stands) m.noGoldFlagged++ }
    }
  }
  return {
    ...m,
    precision: ratio(m.claimedHit, m.claimed), claimRecall: ratio(m.claimedHit, m.needsWithGold), needHit: ratio(m.hitNeeds, m.needsWithGold),
    falseWeakRate: ratio(m.falseWeak, claimedTrue), wrongRemovedRate: ratio(m.wrongRemoved, claimedWrong), noGoldFlaggedRate: ratio(m.noGoldFlagged, m.noGold),
  }
}

/** Probability that a truly covered claim got a higher judge probability than a false one (0.5 = no signal); ties count half. */
export function claimAuc(runs: readonly CoverageRun[]): { auc: number | undefined; positives: number; negatives: number } {
  const answered = runs.flatMap(r => r.needs).filter(n => n.claimed && n.prob !== undefined)
  const pos = answered.filter(n => n.hit)
  const neg = answered.filter(n => !n.hit)
  if (!pos.length || !neg.length) return { auc: undefined, positives: pos.length, negatives: neg.length }
  let wins = 0
  for (const p of pos) for (const n of neg) wins += p.prob! > n.prob! ? 1 : p.prob! === n.prob! ? 0.5 : 0
  return { auc: wins / (pos.length * neg.length), positives: pos.length, negatives: neg.length }
}

// ── calibration (v1 calibration split only) ─────────────────────────────────

export interface Calibrated {
  thresholds: CoverageThresholds
  /** Needs of the calibration split the fit saw: claimed and answered, and how they split by truth. */
  claimedAnswered: number
  truePositives: number
  at: CoverageMetrics
}

/**
 * `weak`: the largest cut such that downgrading everything below it loses at most `maxFalseWeak` of the truly covered
 * claimed needs; among the cuts that satisfy it, the one that removes the most false claims (the cut is placed halfway
 * between two observed probabilities, not on one). `covered`: the smallest probability from which the precision of
 * the claims that stand reaches `coveredPrecision` (default 0.85), never below `weak`; when no cut gets there the
 * covered band starts at the highest probability seen, so everything else stays marked unsure.
 */
export function calibrateThresholds(runs: readonly CoverageRun[], opts: { maxFalseWeak?: number; coveredPrecision?: number } = {}): Calibrated | undefined {
  const maxFalseWeak = opts.maxFalseWeak ?? 0.05
  const coveredPrecision = opts.coveredPrecision ?? 0.85
  const answered = runs.flatMap(r => r.needs).filter(n => n.claimed && n.prob !== undefined)
  if (!answered.length) return undefined
  const probs = [...new Set(answered.map(n => n.prob!))].sort((a, b) => a - b)
  const trueClaims = answered.filter(n => n.hit).length
  // Cut candidates: 0 (nothing weak) and the midpoints between consecutive observed probabilities, plus just above the largest.
  const cuts = [0, ...probs.slice(0, -1).map((p, i) => (p + probs[i + 1]!) / 2), Math.min(probs[probs.length - 1]! + 1e-6, 1)]
  let weak = 0
  let bestRemoved = 0
  for (const cut of cuts) {
    const weakNeeds = answered.filter(n => n.prob! < cut)
    const falseWeak = weakNeeds.filter(n => n.hit).length
    const removed = weakNeeds.length - falseWeak
    if (trueClaims > 0 && falseWeak / trueClaims > maxFalseWeak) continue
    if (removed > bestRemoved || (removed === bestRemoved && cut > weak && removed > 0)) { bestRemoved = removed; weak = cut }
  }
  weak = Number(weak.toFixed(4))
  const standing = answered.filter(n => n.prob! >= weak)
  let covered = Math.max(probs[probs.length - 1]!, weak)
  for (const p of probs) {
    if (p < weak) continue
    const above = standing.filter(n => n.prob! >= p)
    if (above.length && above.filter(n => n.hit).length / above.length >= coveredPrecision) { covered = p; break }
  }
  covered = Number(Math.max(covered, weak).toFixed(4))
  const thresholds = { weak, covered }
  return { thresholds, claimedAnswered: answered.length, truePositives: trueClaims, at: coverageMetrics(runs, thresholds) }
}

// ── report ──────────────────────────────────────────────────────────────────

const pct = (n: number | undefined): string => (n === undefined || !Number.isFinite(n) ? '—' : (n * 100).toFixed(1) + '%')

export interface CoverageReportTask { taskId: string; lang: string; split: string; coverage?: Partial<Record<CoverageArm, CoverageRun>> }

const HEAD = ['组', '任务', '声称覆盖', '声称覆盖正确率', '声称覆盖召回', '需求命中（包内含金标）', '无金标需求标缺口', '误降级（真覆盖被判弱）', '去掉的错误声称', '不确定', '降级总数']
const ALIGN = ['---', '---:', '---:', '---:', '---:', '---:', '---:', '---:', '---:', '---:', '---:']

function row(label: string, runs: readonly CoverageRun[], t?: CoverageThresholds): string[] {
  const m = coverageMetrics(runs, t)
  return [label, String(m.tasks), String(m.claimed), pct(m.precision), pct(m.claimRecall), pct(m.needHit), pct(m.noGoldFlaggedRate),
    t ? m.falseWeak + ' / ' + (m.claimedHit + m.falseWeak) + ' (' + pct(m.falseWeakRate) + ')' : '—',
    t ? m.wrongRemoved + ' / ' + (m.claimed - m.claimedHit + m.wrongRemoved) + ' (' + pct(m.wrongRemovedRate) + ')' : '—',
    t ? String(m.uncertain) : '—', t ? String(m.weakTotal) : '—']
}

const table = (rows: string[][]): string => [HEAD, ALIGN, ...rows].map(r => '| ' + r.join(' | ') + ' |').join('\n')

/** Weak cuts of the sensitivity table (report only: nothing is tuned on it). */
export const SENSITIVITY_CUTS: readonly number[] = [0.02, 0.05, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6]

export const ARM_LABEL: Record<CoverageArm, string> = { rule: '(b′) 规则 + 对齐', hybridB: '(d′) 混合 + 边界对' }

/** Markdown of the coverage judge section: one table per arm and group (all / split / language), rule coverage versus judged coverage at `t`. */
export function renderCoverageSection(tasks: readonly CoverageReportTask[], t: CoverageThresholds | undefined, notes: readonly string[] = []): string[] {
  const out: string[] = ['## 10. M9：覆盖判定（S8 “证据是否足以回答需求”）', '']
  out.push('指标按需求计：真覆盖 = 包内有该需求的金标块；判定只对规则声称覆盖的需求提问，弱判定把它降为缺口（`weak_support`）。**需求命中（包内含金标）由构造不变**（判定不改变包内内容；线上弱判定会触发有界第二轮，离线无法重放），代价体现在“声称覆盖召回”和“误降级”上。阈值 ' + (t ? '`weak<' + t.weak + '` 弱，`>=' + t.covered + '` 覆盖，之间为不确定（仍算覆盖，加提示）' : '未给出，只列无判定的规则覆盖') + '。', '')
  for (const line of notes) out.push(line)
  if (notes.length) out.push('')
  const arms = (['rule', 'hybridB'] as const).filter(arm => tasks.some(x => x.coverage?.[arm]))
  for (const arm of arms) {
    const have = tasks.filter(x => x.coverage?.[arm])
    const runs = (xs: readonly CoverageReportTask[]): CoverageRun[] => xs.map(x => x.coverage![arm]!)
    out.push('### ' + ARM_LABEL[arm], '')
    const groups: [string, CoverageReportTask[]][] = [['全部', have.slice()]]
    for (const split of ['calibration', 'test', 'heldout']) { const xs = have.filter(x => x.split === split); if (xs.length) groups.push([split, xs]) }
    const rows: string[][] = []
    for (const [label, xs] of groups) {
      rows.push(row(label + ' · 规则覆盖', runs(xs)))
      if (t) rows.push(row(label + ' · + 覆盖判定', runs(xs), t))
    }
    out.push(table(rows), '')
    out.push('按语言：', '')
    const langRows: string[][] = []
    for (const lang of [...new Set(have.map(x => x.lang))].sort()) {
      const xs = have.filter(x => x.lang === lang)
      langRows.push(row(lang + ' · 规则覆盖', runs(xs)))
      if (t) langRows.push(row(lang + ' · + 覆盖判定', runs(xs), t))
    }
    out.push(table(langRows), '')
    const sens: string[][] = []
    for (const [label, xs] of groups) {
      const a = claimAuc(runs(xs))
      sens.push([label + ' · AUC ' + (a.auc === undefined ? '—' : a.auc.toFixed(3)) + '（真 ' + a.positives + ' / 假 ' + a.negatives + '）', '', '', '', '', '', '', '', '', '', ''])
      for (const cut of SENSITIVITY_CUTS) sens.push(row(label + ' · weak<' + cut, runs(xs), { weak: cut, covered: Math.max(cut, t?.covered ?? cut) }))
    }
    out.push('阈值敏感性（只报告，不据此调参；`covered` 取阈值值或与 weak 相同，不影响降级）：', '', table(sens), '')
    const all = runs(have)
    const sum = (f: (r: CoverageRun) => number): number => all.reduce((n, r) => n + f(r), 0)
    out.push('提问 ' + sum(r => r.asked) + ' 个（回答 ' + sum(r => r.answered) + '，缓存命中 ' + sum(r => r.cacheHits) + '），冷缓存请求 ' + sum(r => r.cold) + '，本次实际请求 ' + sum(r => r.requests) + '，输入 token ' + sum(r => r.inputTokens) + '。', '')
  }
  return out
}
