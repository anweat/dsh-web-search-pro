/**
 * `rerank` protocol: the query-documents relevance API of Jina, Cohere and the
 * local bge / Qwen reranker servers that copy them:
 *
 *   POST {model, query, documents: [text...], top_n}
 *   ->   {results: [{index, relevance_score}, ...], usage?: {total_tokens}}
 *
 * S6 sends one request per need: the need text is the query, the blocks of that
 * need are the documents. A relevance score is NOT a grade (its scale differs per
 * model, per language and sometimes per request), so a calibration (monotone
 * piecewise-linear map onto 0..3, see calibration.ts) is mandatory: without one the
 * scorer cannot be built, and raw scores are never thresholded or mixed.
 * @module web-search-pro/pipeline/judges/protocols/rerank
 */
import { ModelScorerBase, type ModelScorerOptions } from '../model-scorer.ts';
import type { ScoreContext, ScoreJob, ScoreOutcome, ScoreTask } from '../types.ts';
export declare const RERANK_PATH = "/rerank";
export declare function encodeRerankRequest(model: string, query: string, documents: readonly string[], extraBody?: Record<string, unknown>): string;
/** `index -> raw relevance score` of the answered documents; malformed, out-of-range and duplicate rows are dropped. */
export declare function decodeRerankResults(json: any, documentCount: number): Map<number, number>;
/** Jina: `usage.total_tokens`; Cohere v2: `meta.tokens.input_tokens`; OpenAI-style servers: `usage.prompt_tokens`. Search units (Cohere billing) are not tokens. */
export declare const usageOfRerank: (json: any) => {
    input?: number | undefined;
    output?: number | undefined;
};
export interface RerankScorerOptions extends ModelScorerOptions {
    maxDocumentsPerRequest?: number | undefined;
    requestTokenBudget?: number | undefined;
    blockChars?: number | undefined;
    maxNeedChars?: number | undefined;
}
export declare class RerankScorer extends ModelScorerBase {
    readonly rubricRef: undefined;
    private readonly lim;
    constructor(options: RerankScorerOptions);
    score(_task: ScoreTask, jobs: readonly ScoreJob[], ctx?: ScoreContext): Promise<ScoreOutcome>;
    /** One request; returns the number of documents without a usable score. */
    private run;
}
