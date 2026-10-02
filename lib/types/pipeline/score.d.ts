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
import { type CorpusBlock } from './corpus.ts';
import { JudgeError } from './judges/errors.ts';
import { SystemOneScorer, type SystemOneScorerOptions } from './judges/protocols/systemone.ts';
import { JEV_KEY_REF, JEV_MODEL, JEV_URL } from './judges/providers.ts';
import { estimateJevTokens, JEV_QUESTION_OVERHEAD_TOKENS } from './judges/tokens.ts';
import type { JudgeAnswerCache, JudgeCachedAnswer, JudgeProbe, ProviderRecord, ScoreBlock, ScoreContext, ScoreJob, ScoreOutcome, ScoreTask, ScoreUsage, Scorer } from './judges/types.ts';
export type { ScoreBlock, ScoreContext, ScoreJob, ScoreOutcome, ScoreTask, ScoreUsage, Scorer };
export type { CorpusBlock };
/** Relevance -> grade buckets: [0,T1) 0, [T1,T2) 1, [T2,T3) 2, >=T3 3 (bench rule judge, r1). */
export declare const GRADE_THRESHOLDS: readonly [0.12, 0.3, 0.55];
export declare function bucketGrade(relevance: number): 0 | 1 | 2 | 3;
/**
 * With page statistics the overlap is IDF-weighted and code-discounted, so it
 * runs lower than the plain overlap the thresholds above were calibrated on.
 * The grade edges are scaled by this factor then (fitted on the 60-task
 * offline eval: gold pairs graded >= 2 stay at 52% vs 54% without statistics
 * while the share of gold among all pairs graded >= 2 rises from 15.7% to 17.6%).
 */
export declare const STATS_THRESHOLD_SCALE = 0.6;
export interface RuleScorerOptions {
    /** Cross-lingual / identifier alignment (default true). `false` = the M2 lexical-v1 relevance, kept for comparison. */
    align?: boolean;
}
export declare class RuleScorer implements Scorer {
    readonly id = "rule";
    readonly model: string;
    private readonly align;
    constructor(options?: RuleScorerOptions);
    score(task: ScoreTask, jobs: readonly ScoreJob[], ctx?: ScoreContext): Promise<ScoreOutcome>;
}
export declare const isDiscussionUrl: (url: string) => boolean;
/**
 * docs_code only (dev-plan M3b): an issue / PR / discussion block never counts
 * above grade 2 for a need that asks for the documentation / official API, as
 * long as at least one scored block comes from another kind of page (a
 * proposal for an option is not evidence that the docs have it). Returns the
 * number of grades lowered; the outcome is changed in place.
 */
export declare function capDiscussionGrades(profile: string, jobs: readonly ScoreJob[], outcome: ScoreOutcome): number;
export interface HybridScorerOptions {
    /** The paid scorer that re-scores the selected pairs. */
    jev: Scorer;
    rule?: Scorer;
    /** Also re-score pairs whose rule grade is 1 (relevance in [T1, T2)), after the language-mismatch pairs. Default false. */
    borderline?: boolean;
    /** Cap on the (need, block) questions handed to `jev` (round-robin over needs, best rule relevance first). Default 64. */
    maxQuestions?: number;
}
/**
 * Rule scorer for everything, Jev for the pairs where the rule scorer is
 * structurally weak: need and block written in different languages (both
 * detected, see `detectLang`), plus optionally the rule-borderline pairs
 * (grade 1). Jev answers replace the rule grades; unanswered questions and
 * any Jev failure keep the rule grades (the outcome then says so in `notes`).
 */
export declare class HybridScorer implements Scorer {
    readonly id = "hybrid";
    readonly model: string;
    readonly rubricRef: Scorer['rubricRef'];
    /** The provider behind the re-scored pairs. */
    readonly provider: ProviderRecord | undefined;
    private readonly jev;
    private readonly rule;
    private readonly borderline;
    private readonly maxQuestions;
    constructor(options: HybridScorerOptions);
    /** Pairs to re-score, ordered by priority (mismatch first), capped round-robin over the needs. */
    select(jobs: readonly ScoreJob[], rule: ScoreOutcome): ScoreJob[];
    score(task: ScoreTask, jobs: readonly ScoreJob[], ctx?: ScoreContext): Promise<ScoreOutcome>;
}
export { estimateJevTokens, JEV_KEY_REF, JEV_MODEL, JEV_QUESTION_OVERHEAD_TOKENS, JEV_URL };
/** The Jev errors are the judge layer's errors. */
export { JudgeError as JevError };
export declare const JEV_STATE_PREFIX: string;
export declare const JEV_INSTRUCTIONS: string;
export declare const JEV_CRITERIA: readonly string[];
export type JevProbe = JudgeProbe;
export type JevCachedAnswer = JudgeCachedAnswer;
/** Optional answer cache (the offline eval plugs the r1 judge cache in here). */
export type JevCache = JudgeAnswerCache;
export interface JevScorerOptions extends Omit<SystemOneScorerOptions, 'id' | 'label' | 'model' | 'url' | 'apiKey'> {
    apiKey: string;
    /** Full endpoint (default: the hosted Jev). */
    url?: string;
    model?: string;
}
/**
 * The hosted Bocha Jev: the `systemone` protocol with the Jev defaults, kept as its own class for
 * callers (the bench, tests) that build it directly. The plugin builds its scorer from the configured
 * provider (judges/providers.ts); with the default provider the requests are byte for byte these.
 */
export declare class JevScorer extends SystemOneScorer {
    constructor(options: JevScorerOptions);
}
