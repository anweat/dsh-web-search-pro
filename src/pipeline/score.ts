/**
 * S6 evidence scoring (dev-plan §4.3, §4.4): (need, block) pairs get a support
 * grade 0..3 (score.support.v1: 0 unrelated, 1 same topic only, 2 partly
 * answers, 3 answers directly with locatable evidence).
 *
 *  - RuleScorer: lexical relevance bucketed like the bench rule judge, with
 *    cross-lingual / identifier alignment (align.ts, dev-plan M3a).
 *  - HybridScorer: the rule scorer grades everything; Jev re-scores only the
 *    pairs the rule scorer is structurally weak on (need and block in different
 *    languages, optionally rule-borderline ones); any Jev failure keeps the
 *    rule grades.
 *  - JevScorer: hosted Bocha Jev `score` questions in Chinese (experiment r1:
 *    nDCG@5 0.565 vs 0.378 for the rule scorer). Questions are chunked to the
 *    service limits and to a conservative expanded-token budget per REQUEST
 *    (r1 saw 422 token_budget_exceeded at 33k tokens in one 12-question
 *    request: the limit acts on the request total), every question's state and
 *    block text are trimmed, retries are bounded, and the API key only ever
 *    goes into the Authorization header.
 *
 * The plan's Judge interface (evaluate(state, question, items)) is adapted to
 * what S6 actually needs: one call scores every need's blocks of a run.
 * @module web-search-pro/pipeline/score
 */

import { alignedScore, languagesDiffer } from './align.ts'
import { blockScoringText } from './blocks.ts'
import { CorpusStats, type CorpusBlock } from './corpus.ts'
import { relevancePartsOf } from './gate.ts'
import { JudgeError } from './judges/errors.ts'
import { SystemOneScorer, type SystemOneScorerOptions } from './judges/protocols/systemone.ts'
import { JEV_KEY_REF, JEV_MODEL, JEV_URL } from './judges/providers.ts'
import { estimateJevTokens, JEV_QUESTION_OVERHEAD_TOKENS } from './judges/tokens.ts'
import type { JudgeAnswerCache, JudgeCachedAnswer, JudgeProbe, ProviderRecord, ScoreBlock, ScoreContext, ScoreJob, ScoreOutcome, ScoreTask, ScoreUsage, Scorer } from './judges/types.ts'
import { statsOverlap, weightedOverlap } from './lexical.ts'
import { builtinRubric, type ResolvedRubric } from './rubrics.ts'
import type { BlockGrade } from './types.ts'

export type { ScoreBlock, ScoreContext, ScoreJob, ScoreOutcome, ScoreTask, ScoreUsage, Scorer }
export type { CorpusBlock }

// ── rule scorer ─────────────────────────────────────────────────────────────

/** Relevance -> grade buckets: [0,T1) 0, [T1,T2) 1, [T2,T3) 2, >=T3 3 (bench rule judge, r1). */
export const GRADE_THRESHOLDS = [0.12, 0.3, 0.55] as const

export function bucketGrade(relevance: number): 0 | 1 | 2 | 3 {
  if (relevance < GRADE_THRESHOLDS[0]) return 0
  if (relevance < GRADE_THRESHOLDS[1]) return 1
  if (relevance < GRADE_THRESHOLDS[2]) return 2
  return 3
}

/**
 * With page statistics the overlap is IDF-weighted and code-discounted, so it
 * runs lower than the plain overlap the thresholds above were calibrated on.
 * The grade edges are scaled by this factor then (fitted on the 60-task
 * offline eval: gold pairs graded >= 2 stay at 52% vs 54% without statistics
 * while the share of gold among all pairs graded >= 2 rises from 15.7% to 17.6%).
 */
export const STATS_THRESHOLD_SCALE = 0.6

export interface RuleScorerOptions {
  /** Cross-lingual / identifier alignment (default true). `false` = the M2 lexical-v1 relevance, kept for comparison. */
  align?: boolean
}

export class RuleScorer implements Scorer {
  readonly id = 'rule'
  readonly model: string
  private readonly align: boolean

  constructor(options: RuleScorerOptions = {}) {
    this.align = options.align ?? true
    this.model = this.align ? 'lexical-v2-aligned' : 'lexical-v1'
  }

  async score(task: ScoreTask, jobs: readonly ScoreJob[], ctx: ScoreContext = {}): Promise<ScoreOutcome> {
    const grades = new Map<string, Map<string, BlockGrade>>()
    const corpus = ctx.corpus?.length ? new CorpusStats(ctx.corpus) : undefined
    for (const job of jobs) {
      const relCtx = { goal: task.goal, query: task.query, needs: [job.need.text], constraints: task.constraints }
      const parts = relevancePartsOf(relCtx, true)
      const byBlock = new Map<string, BlockGrade>()
      for (const block of job.blocks) {
        const stats = corpus?.statsFor(block.url)
        const doc = blockScoringText(block)
        // Same-language pairs keep the calibrated lexical-v1 relevance (an offline sweep showed no gain from identifier splitting there).
        let relevance: number
        let distinctiveOk = true
        if (this.align && languagesDiffer(job.need.text, doc)) {
          const a = alignedScore({ goal: task.goal, query: task.query, need: job.need.text, constraints: task.constraints }, { ...block.heading ? { heading: block.heading } : {}, text: block.text }, stats)
          relevance = a.relevance
          distinctiveOk = !a.distinctiveAvailable || a.distinctiveHit
        } else if (stats) {
          const o = statsOverlap(parts, doc, stats)
          relevance = o.relevance
          distinctiveOk = !o.distinctiveAvailable || o.distinctiveHit
        } else {
          relevance = weightedOverlap(parts, doc)
        }
        if (stats) relevance = Math.min(relevance / STATS_THRESHOLD_SCALE, 1)
        let grade = bucketGrade(relevance)
        // Only terms that occur everywhere on the page matched: same topic at best, never an answer.
        if (grade >= 2 && !distinctiveOk) { grade = 1; relevance = Math.min(relevance, GRADE_THRESHOLDS[1] - 0.001) }
        byBlock.set(block.blockId, { grade, rank: relevance })
      }
      grades.set(job.need.id, byBlock)
    }
    return { grades }
  }
}

// ── source-type cap ─────────────────────────────────────────────────────────

/** Issue / pull request / discussion pages: discussion about the docs, not the docs. */
const DISCUSSION_URL = /^https?:\/\/(?:www\.)?github\.com\/[^/]+\/[^/]+\/(?:issues|pull|discussions)(?:\/|$)/i
/** A need that asks for the documented / official behaviour. */
const OFFICIAL_NEED = /官方|文档|documentation|\bdocs?\b|\bAPI\b|official/i

export const isDiscussionUrl = (url: string): boolean => DISCUSSION_URL.test(url)

/**
 * docs_code only (dev-plan M3b): an issue / PR / discussion block never counts
 * above grade 2 for a need that asks for the documentation / official API, as
 * long as at least one scored block comes from another kind of page (a
 * proposal for an option is not evidence that the docs have it). Returns the
 * number of grades lowered; the outcome is changed in place.
 */
export function capDiscussionGrades(profile: string, jobs: readonly ScoreJob[], outcome: ScoreOutcome): number {
  if (profile !== 'docs_code') return 0
  if (!jobs.some(job => job.blocks.some(b => !isDiscussionUrl(b.url)))) return 0
  let lowered = 0
  for (const job of jobs) {
    if (!OFFICIAL_NEED.test(job.need.text)) continue
    const byBlock = outcome.grades.get(job.need.id)
    for (const b of job.blocks) {
      const g = byBlock?.get(b.blockId)
      if (g && g.grade > 2 && isDiscussionUrl(b.url)) { byBlock!.set(b.blockId, { ...g, grade: 2 }); lowered++ }
    }
  }
  return lowered
}

// ── hybrid scorer ───────────────────────────────────────────────────────────

export interface HybridScorerOptions {
  /** The paid scorer that re-scores the selected pairs. */
  jev: Scorer
  rule?: Scorer
  /** Also re-score pairs whose rule grade is 1 (relevance in [T1, T2)), after the language-mismatch pairs. Default false. */
  borderline?: boolean
  /** Cap on the (need, block) questions handed to `jev` (round-robin over needs, best rule relevance first). Default 64. */
  maxQuestions?: number
}

/**
 * Rule scorer for everything, Jev for the pairs where the rule scorer is
 * structurally weak: need and block written in different languages (both
 * detected, see `detectLang`), plus optionally the rule-borderline pairs
 * (grade 1). Jev answers replace the rule grades; unanswered questions and
 * any Jev failure keep the rule grades (the outcome then says so in `notes`).
 */
export class HybridScorer implements Scorer {
  readonly id = 'hybrid'
  readonly model: string
  readonly rubricRef: Scorer['rubricRef']
  /** The provider behind the re-scored pairs. */
  readonly provider: ProviderRecord | undefined
  private readonly jev: Scorer
  private readonly rule: Scorer
  private readonly borderline: boolean
  private readonly maxQuestions: number

  constructor(options: HybridScorerOptions) {
    this.jev = options.jev
    this.rubricRef = options.jev.rubricRef
    this.provider = options.jev.provider
    this.rule = options.rule ?? new RuleScorer()
    this.borderline = options.borderline ?? false
    this.maxQuestions = Math.max(options.maxQuestions ?? 64, 0)
    this.model = 'rule+' + this.jev.id + (this.borderline ? '+borderline' : '')
  }

  /** Pairs to re-score, ordered by priority (mismatch first), capped round-robin over the needs. */
  select(jobs: readonly ScoreJob[], rule: ScoreOutcome): ScoreJob[] {
    const rows = jobs.map(job => {
      const byBlock = rule.grades.get(job.need.id)
      const mismatch: { block: ScoreBlock; rank: number }[] = []
      const border: { block: ScoreBlock; rank: number }[] = []
      for (const block of job.blocks) {
        const g = byBlock?.get(block.blockId)
        const rank = g?.rank ?? 0
        if (languagesDiffer(job.need.text, blockScoringText(block))) mismatch.push({ block, rank })
        else if (this.borderline && g?.grade === 1) border.push({ block, rank })
      }
      const byRank = (a: { rank: number }, b: { rank: number }): number => b.rank - a.rank
      return { need: job.need, queue: [...mismatch.sort(byRank), ...border.sort(byRank)].map(x => x.block) }
    })
    const take = rows.map(() => 0)
    let left = this.maxQuestions
    for (let round = 0; left > 0; round++) {
      let progressed = false
      rows.forEach((row, i) => { if (left > 0 && round < row.queue.length) { take[i]!++; left--; progressed = true } })
      if (!progressed) break
    }
    return rows.map((row, i) => ({ need: row.need, blocks: row.queue.slice(0, take[i]) })).filter(job => job.blocks.length)
  }

  async score(task: ScoreTask, jobs: readonly ScoreJob[], ctx: ScoreContext = {}): Promise<ScoreOutcome> {
    const base = await this.rule.score(task, jobs, ctx)
    const grades = new Map([...base.grades].map(([needId, byBlock]) => [needId, new Map(byBlock)]))
    const notes: string[] = []
    const picked = this.select(jobs, base)
    if (!picked.length) return { grades, notes }
    try {
      const out = await this.jev.score(task, picked, ctx)
      for (const [needId, byBlock] of out.grades) for (const [blockId, g] of byBlock) grades.get(needId)?.set(blockId, { grade: g.grade, rank: g.grade / 3 })
      if (out.notes?.length) notes.push(...out.notes)
      return { grades, ...out.usage ? { usage: out.usage } : {}, notes }
    } catch (error) {
      if (ctx.signal?.aborted) throw error
      notes.push('Jev re-scoring failed, kept the rule grades: ' + (error instanceof Error ? error.message : String(error)))
      return { grades, notes }
    }
  }
}

// ── Jev scorer ──────────────────────────────────────────────────────────────

export { estimateJevTokens, JEV_KEY_REF, JEV_MODEL, JEV_QUESTION_OVERHEAD_TOKENS, JEV_URL }
/** The Jev errors are the judge layer's errors. */
export { JudgeError as JevError }

/**
 * Built-in wording of the `score.support` rubric (rubrics.ts; a bench test pins it to
 * bench/rubrics/score.support.v1.json). The scorer itself uses the active rubric, which
 * `evidence.rubrics` may override.
 */
const SUPPORT_V1 = builtinRubric('score.support')
export const JEV_STATE_PREFIX = SUPPORT_V1.state!.replace('{task}', '')
export const JEV_INSTRUCTIONS = SUPPORT_V1.instructions
export const JEV_CRITERIA: readonly string[] = SUPPORT_V1.criteria!

export type JevProbe = JudgeProbe
export type JevCachedAnswer = JudgeCachedAnswer
/** Optional answer cache (the offline eval plugs the r1 judge cache in here). */
export type JevCache = JudgeAnswerCache

export interface JevScorerOptions extends Omit<SystemOneScorerOptions, 'id' | 'label' | 'model' | 'url' | 'apiKey'> {
  apiKey: string
  /** Full endpoint (default: the hosted Jev). */
  url?: string
  model?: string
}

/**
 * The hosted Bocha Jev: the `systemone` protocol with the Jev defaults, kept as its own class for
 * callers (the bench, tests) that build it directly. The plugin builds its scorer from the configured
 * provider (judges/providers.ts); with the default provider the requests are byte for byte these.
 */
export class JevScorer extends SystemOneScorer {
  constructor(options: JevScorerOptions) {
    if (!options.apiKey) throw new Error('JevScorer needs an API key')
    const { url, model, ...rest } = options
    super({ id: 'jev', label: 'Jev', model: model ?? JEV_MODEL, url: url ?? JEV_URL, ...rest })
  }
}
