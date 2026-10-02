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
import { type ResolvedRubric, type RubricRef } from './rubrics.ts';
import type { BlockGrade, Need, TaskSpec } from './types.ts';
export type ScoreTask = Pick<TaskSpec, 'goal' | 'query' | 'needs' | 'constraints'>;
export interface ScoreBlock {
    blockId: string;
    url: string;
    heading?: string;
    text: string;
}
export interface ScoreJob {
    need: Need;
    blocks: ScoreBlock[];
}
export interface ScoreContext {
    signal?: AbortSignal | undefined;
    /** Epoch ms after which no new request may start (the run's overall deadline). */
    deadline?: number | undefined;
    /** Every block of the pages read (the rule scorer takes term statistics from it, dev-plan M3b); absent = no statistics. */
    corpus?: readonly CorpusBlock[] | undefined;
}
export interface ScoreUsage {
    requests: number;
    questions: number;
    cacheHits: number;
    inputTokens: number;
    outputTokens: number;
}
export interface ScoreOutcome {
    /** needId -> blockId -> grade. Questions that got no answer are absent. */
    grades: Map<string, Map<string, BlockGrade>>;
    usage?: ScoreUsage;
    /** Non-fatal problems (unanswered questions, ...). */
    notes?: string[];
}
export interface Scorer {
    id: string;
    model: string;
    /** The judge rubric behind the grades (Jev-based scorers); recorded with their results. */
    rubricRef?: RubricRef | undefined;
    score(task: ScoreTask, jobs: readonly ScoreJob[], ctx?: ScoreContext): Promise<ScoreOutcome>;
}
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
    readonly rubricRef: RubricRef | undefined;
    private readonly jev;
    private readonly rule;
    private readonly borderline;
    private readonly maxQuestions;
    constructor(options: HybridScorerOptions);
    /** Pairs to re-score, ordered by priority (mismatch first), capped round-robin over the needs. */
    select(jobs: readonly ScoreJob[], rule: ScoreOutcome): ScoreJob[];
    score(task: ScoreTask, jobs: readonly ScoreJob[], ctx?: ScoreContext): Promise<ScoreOutcome>;
}
export declare const JEV_URL = "https://jev.bocha.cn/v1/systemone";
export declare const JEV_MODEL = "bocha-jev-v1";
/** Credentials ref / environment variable holding the Bocha Jev key. */
export declare const JEV_KEY_REF = "BOCHA_JEV_API_KEY";
export declare const JEV_STATE_PREFIX: string;
export declare const JEV_INSTRUCTIONS: string;
export declare const JEV_CRITERIA: readonly string[];
/**
 * Conservative estimate of the EXPANDED input tokens Jev bills for a `score`
 * question's text. Jev expands each question once per level (4 for score), so
 * the cost is about four times the plain token count: a regression over the
 * 122 r1 requests gave 3.8 per Han character, 0.97 per other character and
 * 706 per question. The constants here (5 / 1.3 / 950) sit above the fit and
 * above the worst r1 request (nf-07, 33,331 counted tokens against an estimate
 * of 38,052), so an estimate within budget never meets the 32,768 limit. A
 * generic "chars / 1.5" would be far too low for CJK-heavy text.
 */
export declare function estimateJevTokens(text: string): number;
/** Fixed expanded-token overhead of one `score` question (the level descriptions; r1 fit: 706). */
export declare const JEV_QUESTION_OVERHEAD_TOKENS = 950;
export interface JevProbe {
    state: string;
    need: string;
    /** Full candidate text (heading + block), before trimming. */
    candidate: string;
    /** Trimmed task description (what `{task}` renders to). */
    task?: string;
    /** `id@version#hash` of the rubric that worded the question: a cache must key on it. */
    rubric?: string;
}
export interface JevCachedAnswer {
    grade: number;
    probabilities?: Record<string, number>;
}
/** Optional answer cache (the offline eval plugs the r1 judge cache in here). */
export interface JevCache {
    get(probe: JevProbe): JevCachedAnswer | undefined;
    set(probe: JevProbe, answer: JevCachedAnswer): void;
}
export interface JevScorerOptions {
    apiKey: string;
    /** Question rubric (default: the built-in score.support). Its length caps are the defaults of `maxStateChars` / `blockChars`. */
    rubric?: ResolvedRubric;
    url?: string;
    model?: string;
    fetchImpl?: typeof fetch;
    sleep?: (ms: number) => Promise<void>;
    /** Service limit: questions per request. */
    maxQuestionsPerRequest?: number;
    /** Estimated expanded tokens per request (the hosted limit is 32768 for the request total; r1 failed at 33k). */
    requestTokenBudget?: number;
    /** Candidate (heading + block) is cut to this many characters. */
    blockChars?: number;
    maxNeedChars?: number;
    maxStateChars?: number;
    maxBodyBytes?: number;
    /** Retries per request for 429 / 503 / 529 / network errors. */
    maxRetries?: number;
    timeoutMs?: number;
    /** Hard cap on HTTP attempts of this scorer (retries and splits included). */
    requestCap?: number;
    cache?: JevCache;
}
export declare class JevError extends Error {
    readonly status?: number | undefined;
    readonly fatal: boolean;
    constructor(message: string, status?: number | undefined, fatal?: boolean);
}
export declare class JevScorer implements Scorer {
    readonly id = "jev";
    readonly model: string;
    /** HTTP attempts made so far (retries and splits included). */
    requests: number;
    readonly rubricRef: RubricRef;
    private readonly rubric;
    private readonly cfg;
    private readonly apiKey;
    constructor(options: JevScorerOptions);
    /** The task description as `{task}` renders it. */
    private taskText;
    /** Grade as the pipeline reads it: criteria with another level count than the built-in 4 are rescaled onto 0..3. */
    private normalized;
    /** Shared state: a short task description only (it is billed again inside every question). */
    stateFor(task: Pick<ScoreTask, 'goal'>): string;
    private instructionsFor;
    private buildQuestions;
    /** Greedy request chunks bounded by question count, estimated tokens and body bytes. */
    private chunk;
    score(task: ScoreTask, jobs: readonly ScoreJob[], ctx?: ScoreContext): Promise<ScoreOutcome>;
    /** Send one chunk; splits it when the service reports the token budget exceeded. Returns the number of unanswered questions. */
    private run;
    /** POST with bounded retries (429 / 503 / 529 / network); 401 is fatal, other statuses fail the request. */
    private post;
    private wait;
}
