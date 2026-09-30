/**
 * RuleJudge: deterministic lexical baseline (dev-plan §4.3 rule column).
 * Relevance = weighted term overlap of query / need / entity terms with the
 * candidate text; constraints that rules can decide (must/exclude term, site,
 * version string, known dates, language) are checked directly. The lexical and
 * constraint logic lives in src/pipeline/gate.ts (one implementation for the
 * runtime gate and this bench judge); this file keeps the bench-only parts
 * (grade buckets, navigation score, profile guess).
 * @module bench/judges/rule
 */

import {
  checkConstraint as srcCheckConstraint, knownYear as srcKnownYear, lexicalRelevance as srcLexicalRelevance,
  type ConstraintVerdict, type GateItem,
} from '../../../src/pipeline/gate.ts'
import { profileScores } from '../../../src/pipeline/plan.ts'
import type { TaskConstraint } from '../types.ts'
import type { Judge, JudgeContext, JudgeItem, JudgeQuestion, JudgeResult, Readiness } from './types.ts'

/** Relevance -> grade buckets: [0,T1) 0, [T1,T2) 1, [T2,T3) 2, >=T3 3. */
export const GRADE_THRESHOLDS = [0.12, 0.3, 0.55] as const

export function bucketGrade(relevance: number): 0 | 1 | 2 | 3 {
  if (relevance < GRADE_THRESHOLDS[0]) return 0
  if (relevance < GRADE_THRESHOLDS[1]) return 1
  if (relevance < GRADE_THRESHOLDS[2]) return 2
  return 3
}

export type { ConstraintVerdict }

/** Judge item -> the src gate's view of a candidate. */
export function gateItemOfJudge(item: JudgeItem): GateItem {
  return {
    text: item.text,
    ...item.meta?.url ? { url: item.meta.url } : {},
    ...item.meta?.title ? { title: item.meta.title } : {},
    ...item.meta?.heading ? { heading: item.meta.heading } : {},
    ...item.meta?.publishedAt ? { publishedAt: item.meta.publishedAt } : {},
  }
}

/** Newest year evidenced by an explicit date (implementation: src/pipeline/gate.ts). */
export function knownYear(item: JudgeItem): number | undefined {
  return srcKnownYear(gateItemOfJudge(item))
}

/** Rule verdict for one constraint on one candidate (implementation: src/pipeline/gate.ts). */
export function checkConstraint(c: TaskConstraint, item: JudgeItem): ConstraintVerdict {
  return srcCheckConstraint(c, gateItemOfJudge(item))
}

// ── relevance ───────────────────────────────────────────────────────────────

export function lexicalRelevance(ctx: JudgeContext, item: JudgeItem, withConstraints: boolean): number {
  return srcLexicalRelevance(ctx, gateItemOfJudge(item), withConstraints)
}

/** gate.single: relevance with constraint penalties (a violated hard constraint cuts the score). */
export function singleGateScore(ctx: JudgeContext, item: JudgeItem): number {
  let rel = lexicalRelevance(ctx, item, true)
  for (const c of ctx.constraints) {
    if (c.strength !== 'hard') continue
    const verdict = checkConstraint(c, item)
    if (verdict.satisfied === 'no') rel *= c.kind === 'must_term' || c.kind === 'entity' ? 0.6 : 0.3
  }
  return Math.min(1, rel)
}

// ── navigation pages ────────────────────────────────────────────────────────

const NAV_PATH = /\/(search|tags?|category|categories|archives?|topics?|list|lists|index|sitemap|explore|trending|latest|all)(?:\/|\.html?$|$|\?)/i
const NAV_TITLE = /(首页|目录|索引|搜索结果|站点地图|文章列表|全部文章|标签|分类|归档|search results|index of|sitemap|all posts|archive|home\s*page|^home\b)/i

export function navScore(item: JudgeItem): number {
  let score = 0
  const url = item.meta?.url
  if (url) {
    try {
      const u = new URL(url)
      if (u.pathname === '/' || u.pathname === '') score += 0.5
      if (NAV_PATH.test(u.pathname)) score += 0.4
      if (/[?&](q|s|query|search|keyword|page|p)=/i.test(u.search)) score += 0.4
    } catch { /* not a URL */ }
  }
  if (NAV_TITLE.test(item.meta?.title ?? '')) score += 0.4
  return Math.min(1, score)
}

// ── profile ─────────────────────────────────────────────────────────────────

// The keyword table and the score function live in src/pipeline/plan.ts (S1 uses them as its rule fallback).
export { profileScores }

// ── the judge ───────────────────────────────────────────────────────────────

export class RuleJudge implements Judge {
  readonly id = 'rule'
  readonly model = 'lexical-v1'

  async ready(): Promise<Readiness> {
    return { ready: true }
  }

  async evaluate(_state: string, q: JudgeQuestion, items: readonly JudgeItem[]): Promise<JudgeResult[]> {
    const ctx: JudgeContext = q.context ?? { goal: '', query: '', needs: [], constraints: [] }
    return items.map(item => this.one(q, ctx, item))
  }

  private one(q: JudgeQuestion, ctx: JudgeContext, item: JudgeItem): JudgeResult {
    const base = { id: item.id, judge: this.id, model: this.model, rubricId: q.rubricId, rubricVersion: q.rubricVersion, latencyMs: 0 }
    if (q.kind === 'score') {
      const grade = bucketGrade(lexicalRelevance(ctx, item, true))
      return { ...base, grade, decision: String(grade) }
    }
    if (q.kind === 'choice') {
      const probs = profileScores(item.text)
      const allowed = Object.keys(q.options ?? probs)
      const [choice, prob] = Object.entries(probs).filter(([k]) => allowed.includes(k)).sort((a, b) => b[1] - a[1])[0]!
      return { ...base, decision: choice, prob, probabilities: probs }
    }
    let prob: number
    if (q.rubricId.startsWith('gate.nav')) prob = navScore(item)
    else if (q.rubricId.startsWith('gate.constraint')) {
      prob = ctx.constraint ? checkConstraint(ctx.constraint, item).prob : 0.5
    } else if (q.rubricId.startsWith('gate.relevance')) prob = lexicalRelevance(ctx, item, false)
    else prob = singleGateScore(ctx, item)
    return { ...base, prob, decision: prob >= 0.5 ? 'true' : 'false' }
  }
}
