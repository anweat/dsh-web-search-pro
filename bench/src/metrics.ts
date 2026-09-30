/**
 * Pure metric functions for the judge report (dev-plan §6.3/§6.4).
 * @module bench/metrics
 */

/** Average ranks (1-based), ties share the mean rank. */
export function averageRanks(values: readonly number[]): number[] {
  const order = values.map((v, i) => ({ v, i })).sort((a, b) => a.v - b.v)
  const ranks = new Array<number>(values.length)
  for (let a = 0; a < order.length;) {
    let b = a
    while (b + 1 < order.length && order[b + 1]!.v === order[a]!.v) b++
    const rank = (a + b) / 2 + 1
    for (let k = a; k <= b; k++) ranks[order[k]!.i] = rank
    a = b + 1
  }
  return ranks
}

/** ROC-AUC via the Mann–Whitney statistic (ties count half). undefined without both classes. */
export function rocAuc(scores: readonly number[], positive: readonly boolean[]): number | undefined {
  const pos = positive.filter(Boolean).length
  const neg = positive.length - pos
  if (!pos || !neg) return undefined
  const ranks = averageRanks(scores)
  let rankSum = 0
  positive.forEach((p, i) => { if (p) rankSum += ranks[i]! })
  return (rankSum - pos * (pos + 1) / 2) / (pos * neg)
}

/**
 * Drop threshold on a calibration set: the highest t such that keeping
 * `score >= t` retains at least `minRecall` of the positives (drop if score < t).
 */
export function chooseDropThreshold(scores: readonly number[], positive: readonly boolean[], minRecall = 0.95): number | undefined {
  const posScores = scores.filter((_, i) => positive[i]).sort((a, b) => b - a)
  if (!posScores.length) return undefined
  const need = Math.ceil(minRecall * posScores.length - 1e-9)
  // The need-th highest positive score is the largest t that still keeps `need` positives.
  return posScores[Math.max(0, need - 1)]
}

export interface GateEval { recall: number | undefined; dropped: number | undefined; kept: number; n: number }

/** Apply `drop if score < t`: recall of positives and fraction of all items dropped. */
export function evalThreshold(scores: readonly number[], positive: readonly boolean[], t: number): GateEval {
  let pos = 0
  let posKept = 0
  let kept = 0
  scores.forEach((s, i) => {
    const keep = s >= t
    if (keep) kept++
    if (positive[i]) { pos++; if (keep) posKept++ }
  })
  return { recall: pos ? posKept / pos : undefined, dropped: scores.length ? 1 - kept / scores.length : undefined, kept, n: scores.length }
}

export function brier(probs: readonly number[], truth: readonly boolean[]): number | undefined {
  if (!probs.length) return undefined
  return probs.reduce((sum, p, i) => sum + (p - (truth[i] ? 1 : 0)) ** 2, 0) / probs.length
}

/** Expected calibration error with equal-width bins (default 10). */
export function ece(probs: readonly number[], truth: readonly boolean[], bins = 10): number | undefined {
  if (!probs.length) return undefined
  const count = new Array<number>(bins).fill(0)
  const conf = new Array<number>(bins).fill(0)
  const hit = new Array<number>(bins).fill(0)
  probs.forEach((p, i) => {
    const b = Math.min(bins - 1, Math.max(0, Math.floor(p * bins)))
    count[b]!++
    conf[b]! += p
    if (truth[i]) hit[b]!++
  })
  let total = 0
  for (let b = 0; b < bins; b++) if (count[b]) total += count[b]! * Math.abs(hit[b]! / count[b]! - conf[b]! / count[b]!)
  return total / probs.length
}

export function pearson(x: readonly number[], y: readonly number[]): number | undefined {
  const n = x.length
  if (n < 2) return undefined
  const mx = x.reduce((a, b) => a + b, 0) / n
  const my = y.reduce((a, b) => a + b, 0) / n
  let sxy = 0, sxx = 0, syy = 0
  for (let i = 0; i < n; i++) {
    sxy += (x[i]! - mx) * (y[i]! - my)
    sxx += (x[i]! - mx) ** 2
    syy += (y[i]! - my) ** 2
  }
  return sxx === 0 || syy === 0 ? undefined : sxy / Math.sqrt(sxx * syy)
}

/** Spearman rank correlation (Pearson on average ranks). */
export function spearman(x: readonly number[], y: readonly number[]): number | undefined {
  return pearson(averageRanks(x), averageRanks(y))
}

/**
 * nDCG@k with binary gains. Tied scores share the average gain of the positions
 * they span (no tie-break advantage). `totalRelevant` is the number of gold
 * items for the need, including any that are not in the ranked pool.
 */
export function ndcgAtK(items: readonly { score: number; relevant: boolean }[], totalRelevant: number, k = 5): number | undefined {
  if (totalRelevant <= 0) return undefined
  const sorted = [...items].sort((a, b) => b.score - a.score)
  let dcg = 0
  for (let a = 0; a < sorted.length && a < k;) {
    let b = a
    while (b + 1 < sorted.length && sorted[b + 1]!.score === sorted[a]!.score) b++
    const group = sorted.slice(a, b + 1)
    const avg = group.filter(x => x.relevant).length / group.length
    for (let pos = a; pos <= b && pos < k; pos++) dcg += avg / Math.log2(pos + 2)
    a = b + 1
  }
  let ideal = 0
  for (let pos = 0; pos < Math.min(k, totalRelevant); pos++) ideal += 1 / Math.log2(pos + 2)
  return dcg / ideal
}

/** Linear-interpolated percentile (p in 0..100). */
export function percentile(values: readonly number[], p: number): number | undefined {
  if (!values.length) return undefined
  const sorted = [...values].sort((a, b) => a - b)
  const pos = (p / 100) * (sorted.length - 1)
  const lo = Math.floor(pos)
  const hi = Math.ceil(pos)
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (pos - lo)
}

export const mean = (xs: readonly number[]): number | undefined => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : undefined)
