/**
 * The coverage judge (dev-plan M9): "do these excerpts, by themselves, state the
 * answer to the need?" asked as one `noul` question per need over the `systemone`
 * protocol (Bocha Jev and compatible services), worded by the `cover.sufficient`
 * rubric. The answer is the probability of "yes" (the raw `noul` value); how it is
 * read (bands, thresholds) lives in ../coverage.ts, because a probability is only
 * meaningful against thresholds calibrated for one provider and one rubric.
 *
 * Transport, metering, retries and the request cap are the judge layer's own
 * (ModelClientBase); questions are chunked like S6's and a failed chunk only loses
 * its own needs. Nothing here falls back silently: the caller keeps the rule
 * coverage for every need without a verdict and says so.
 * @module web-search-pro/pipeline/judges/coverage
 */
import { type ResolvedRubric, type RubricRef } from '../rubrics.ts';
import { ModelClientBase, type ModelScorerOptions } from './model-scorer.ts';
import type { ScoreContext, ScoreTask, ScoreUsage } from './types.ts';
/** One need to judge: the evidence view is what the main model would read for it. */
export interface CoverageItem {
    needId: string;
    need: string;
    evidence: string;
}
export interface CoverageOutcome {
    /** needId -> probability that the excerpts suffice. Needs that got no answer are absent. */
    probs: Map<string, number>;
    usage: ScoreUsage;
    notes: string[];
}
export interface CoverageJudge {
    id: string;
    model: string;
    rubricRef: RubricRef;
    /** Provider / protocol / model that answers (absent for a judge built outside the provider layer). */
    provider: ModelClientBase['provider'];
    judge(task: Pick<ScoreTask, 'goal'>, items: readonly CoverageItem[], ctx?: ScoreContext): Promise<CoverageOutcome>;
}
export interface SystemOneCoverageOptions extends ModelScorerOptions {
    /** Question rubric (default: the built-in cover.sufficient). */
    rubric?: ResolvedRubric | undefined;
    /** `noul` shows two candidate answers; `plain` is the text as it is (local models). */
    tokenModel?: 'expanded' | 'plain' | undefined;
    maxQuestionsPerRequest?: number | undefined;
    requestTokenBudget?: number | undefined;
    /** The evidence view is cut to this many characters (default: the rubric's). */
    blockChars?: number | undefined;
    maxNeedChars?: number | undefined;
    maxStateChars?: number | undefined;
    maxBodyBytes?: number | undefined;
}
export declare class SystemOneCoverageJudge extends ModelClientBase implements CoverageJudge {
    readonly rubricRef: RubricRef;
    private readonly rubric;
    private readonly tokenModel;
    private readonly lim;
    constructor(options: SystemOneCoverageOptions);
    private taskText;
    /** Shared state: the short task description (billed again inside every question). */
    stateFor(task: Pick<ScoreTask, 'goal'>): string;
    private instructionsFor;
    private estimate;
    private buildQuestions;
    private chunk;
    judge(task: Pick<ScoreTask, 'goal'>, items: readonly CoverageItem[], ctx?: ScoreContext): Promise<CoverageOutcome>;
    /** Send one chunk; splits it when the service reports the token budget exceeded. Returns the number of unanswered questions. */
    private run;
}
