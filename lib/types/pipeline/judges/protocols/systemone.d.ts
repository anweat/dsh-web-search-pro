/**
 * `systemone` protocol: the Jev-compatible decision API (`POST /v1/systemone`):
 * a shared `state` plus up to 32 `questions` (type noul | score | choice, free-text
 * `instructions`, `criteria`), answered per question (`noul` probability, `score` grade
 * expectation, `choice` label + probabilities) with `usage.input_tokens`. Spoken by the
 * hosted Bocha Jev, other Jev deployments (TypeSafe) and the local Laya sidecar.
 *
 * S6 asks `score` questions, one per (need, block), worded by the `score.support`
 * rubric. Requests are chunked to the service limits and to a conservative
 * expanded-token budget per REQUEST (experiment r1 saw 422 token_budget_exceeded at
 * 33k tokens in one 12-question request: the limit acts on the request total); every
 * question's state and block text are trimmed, retries are bounded, and the API key only
 * ever goes into the Authorization header.
 * @module web-search-pro/pipeline/judges/protocols/systemone
 */
import { type ResolvedRubric, type RubricRef } from '../../rubrics.ts';
import { ModelScorerBase, type ModelScorerOptions } from '../model-scorer.ts';
import type { ScoreContext, ScoreJob, ScoreOutcome, ScoreTask } from '../types.ts';
export declare const SYSTEMONE_PATH = "/v1/systemone";
export type SystemOneKind = 'noul' | 'score' | 'choice';
/** Candidate options one question presents: noul 2, score = number of levels, choice = number of options. */
export declare function candidatesFor(q: {
    kind: SystemOneKind;
    criteria?: readonly string[] | undefined;
    options?: Readonly<Record<string, string>> | undefined;
}): number;
/** Split items into request-sized groups: question count, candidate total and body size bounds. */
export declare function chunkItems<T>(items: readonly T[], q: {
    kind: SystemOneKind;
    criteria?: readonly string[] | undefined;
    options?: Readonly<Record<string, string>> | undefined;
}, size: (item: T) => number, limits: {
    maxQuestions: number;
    maxCandidates: number;
    maxBodyBytes: number;
    baseBytes: number;
}): T[][];
/** One question object of the request body. */
export declare function encodeQuestion(kind: SystemOneKind, instructions: string, criteria?: readonly string[] | Readonly<Record<string, string>>): Record<string, unknown>;
/** The request body: `model`, `state`, `questions`, then the provider's extra fields. */
export declare function encodeRequest(model: string, state: string, questions: Record<string, unknown>, extraBody?: Record<string, unknown>): string;
export type DecodedAnswer = {
    kind: 'noul';
    prob: number;
} | {
    kind: 'score';
    grade: number;
    probabilities?: Record<string, number>;
} | {
    kind: 'choice';
    choice: string;
    prob: number | undefined;
    probabilities: Record<string, number>;
} | {
    error: string;
};
export declare function decodeAnswer(kind: SystemOneKind, answer: any): DecodedAnswer;
export declare const usageOfSystemOne: (json: any) => {
    input?: number | undefined;
    output?: number | undefined;
};
export interface SystemOneScorerOptions extends ModelScorerOptions {
    /** Question rubric (default: the built-in score.support). Its length caps are the defaults of `maxStateChars` / `blockChars`. */
    rubric?: ResolvedRubric | undefined;
    /** `expanded`: Jev bills each question once per level (default); `plain`: the text as it is (local models). */
    tokenModel?: 'expanded' | 'plain' | undefined;
    /** Service limit: questions per request. */
    maxQuestionsPerRequest?: number | undefined;
    /** Estimated input tokens per request (the hosted limit is 32768 for the request total; r1 failed at 33k). */
    requestTokenBudget?: number | undefined;
    /** Candidate (heading + block) is cut to this many characters. */
    blockChars?: number | undefined;
    maxNeedChars?: number | undefined;
    maxStateChars?: number | undefined;
    maxBodyBytes?: number | undefined;
}
export declare class SystemOneScorer extends ModelScorerBase {
    readonly rubricRef: RubricRef;
    private readonly rubric;
    private readonly tokenModel;
    private readonly lim;
    constructor(options: SystemOneScorerOptions);
    /** The task description as `{task}` renders it. */
    private taskText;
    /** Grade as the pipeline reads it: criteria with another level count than the built-in 4 are rescaled onto 0..3, then calibrated. */
    private normalized;
    /** Shared state: a short task description only (it is billed again inside every question). */
    stateFor(task: Pick<ScoreTask, 'goal'>): string;
    private instructionsFor;
    private estimate;
    private buildQuestions;
    /** Greedy request chunks bounded by question count, estimated tokens and body bytes. */
    private chunk;
    score(task: ScoreTask, jobs: readonly ScoreJob[], ctx?: ScoreContext): Promise<ScoreOutcome>;
    /** Send one chunk; splits it when the service reports the token budget exceeded. Returns the number of unanswered questions. */
    private run;
}
