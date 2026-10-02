/**
 * S3/S4 rule gate (dev-plan §4.3): deterministic constraint checks plus a
 * lexical relevance gate over title + snippet. Ported from the r1 bench rule
 * judge; one implementation serves the runtime and the bench.
 *
 * Policy (keep recall first, plan §4.3 "unknown -> keep"):
 *  - a hard constraint drops a candidate only on a DEFINITE violation: a site /
 *    exclude_site host mismatch, an excluded term present, or a publication year
 *    before the time window taken from a structured date (publishedAt or a
 *    dated URL path). Everything else keeps the candidate: a must_term / entity
 *    missing from a SNIPPET says little about the page (measured on the r1 data:
 *    dropping on it cut positive recall from 94.6% to ~85%), so those are only
 *    recorded in `checks` until the full text is available (`fullText` option);
 *    absent version strings, language guesses and years merely mentioned in
 *    snippet text are likewise not grounds to drop;
 *  - relevance below the threshold drops it. The default is the drop threshold
 *    calibrated in experiment r1 (rule / gate.relevance.v1, calibration split,
 *    recall of label >= 2 held at 0.95). The threshold belongs to THIS lexical
 *    function: re-derive it with `bench/src/eval-gate.ts` when lexical.ts changes.
 *    Cross-lingual pairs (the needs and the candidate text are in different
 *    languages, e.g. Chinese needs against English titles) are scored with the
 *    M3a alignment of align.ts instead, on the same scale; same-language pairs
 *    keep the calibrated lexical-v1 function untouched;
 *  - soft constraints are recorded in `checks` but never drop;
 *  - floor ({@link applyFloor}): when the gate would leave fewer than `minKeep`
 *    candidates, the best fused ones that were dropped on relevance alone come
 *    back, flagged `lowConfidence`. A pack is never empty because of the
 *    relevance heuristic alone.
 * @module web-search-pro/pipeline/gate
 */
import { type QueryPart } from './lexical.ts';
import type { Candidate, Constraint, ConstraintCheck, GateVerdict, Satisfied, TaskSpec } from './types.ts';
/**
 * r1 rule / gate.relevance.v1 drop threshold (calibration-selected 0.12363952982150628,
 * rounded down to 4 places: rounding down can only keep more, never drop a
 * candidate the calibrated value would have kept).
 */
export declare const DEFAULT_RELEVANCE_THRESHOLD = 0.1236;
/** Constraint fields the checks need (a subset of `Constraint`, so bench task constraints fit too). */
export type ConstraintLike = Pick<Constraint, 'id' | 'kind' | 'value' | 'strength'>;
/** What a check sees of a candidate: title + snippet (+ url / date). */
export interface GateItem {
    url?: string;
    title?: string;
    /** Snippet or block text (without the title). */
    text: string;
    heading?: string;
    publishedAt?: string;
}
export interface ConstraintVerdict {
    satisfied: Satisfied;
    prob: number;
    /** time_window only: whether the decisive year came from a structured date (publishedAt / dated URL) rather than snippet text. */
    structuredDate?: boolean;
}
export declare function domainOf(value: string): string;
export declare function hostMatches(host: string, domain: string): boolean;
/**
 * Newest year evidenced by an explicit date: publishedAt, then date-shaped
 * strings in url/title/snippet. `structured` is true when the year comes from
 * publishedAt or from the URL (a dated path such as /2024/05/), false when it
 * only appears in snippet text, where it may merely mention another date.
 */
export declare function knownDate(item: GateItem, now?: Date): {
    year: number;
    structured: boolean;
} | undefined;
/** Newest year evidenced by an explicit date (see {@link knownDate}). */
export declare function knownYear(item: GateItem, now?: Date): number | undefined;
/** Rule verdict for one constraint on one candidate. Semantic kinds that rules cannot decide are `unknown`. */
export declare function checkConstraint(c: Pick<ConstraintLike, 'kind' | 'value'>, item: GateItem, now?: Date): ConstraintVerdict;
/**
 * Whether a `no` verdict is certain enough to drop on. Deterministic kinds
 * (site, exclude_site, exclude_term) always are; time_window only with a
 * structured date; must_term / entity only when `fullText` says the text
 * checked is the whole page (then: not a single term of it appears); language
 * guesses never are.
 */
export declare function isDefiniteViolation(c: Pick<ConstraintLike, 'kind'>, verdict: ConstraintVerdict, fullText?: boolean): boolean;
/** Structured task text the lexical relevance reads. */
export interface RelevanceContext {
    goal: string;
    query: string;
    /** Text of the need(s) the question is about. */
    needs: readonly string[];
    constraints: readonly ConstraintLike[];
}
export declare function relevanceContextOf(task: Pick<TaskSpec, 'goal' | 'query' | 'needs' | 'constraints'>): RelevanceContext;
/** Weighted query parts of the relevance: query, goal, needs and (optionally) entity / must_term values. */
export declare function relevancePartsOf(ctx: RelevanceContext, withConstraints: boolean): QueryPart[];
/** Weighted lexical overlap of query / goal / needs (and optionally entity + must_term values) with the item, 0..1. */
export declare function lexicalRelevance(ctx: RelevanceContext, item: GateItem, withConstraints: boolean): number;
/** The needs are in one language and the item text in another (see align.ts `detectLang`): the pairs the lexical rule cannot score. */
export declare function isCrossLingual(ctx: RelevanceContext, item: GateItem): boolean;
/**
 * Relevance the gate compares with its threshold. Same-language pairs: exactly
 * {@link lexicalRelevance} (query + goal + needs, no constraint terms). Cross-lingual pairs
 * (dev-plan M3a applied to S4): the aligned score of align.ts over the needs, with the Latin / identifier terms of the
 * query, goal and entity / must_term values joined in (so Chinese needs inherit the English terms of
 * the query) and the Han terms of a Latin item no longer dominating the denominator.
 */
export declare function gateRelevance(ctx: RelevanceContext, item: GateItem): {
    relevance: number;
    aligned: boolean;
};
export interface GateOptions {
    /** Relevance drop threshold; defaults to the r1-calibrated {@link DEFAULT_RELEVANCE_THRESHOLD}. */
    relevanceThreshold?: number;
    /** Apply hard-constraint drops (default true). */
    hardConstraints?: boolean;
    /** The item text is the whole page, not a snippet: must_term / entity with zero overlap then count as violated. */
    fullText?: boolean;
    /** Clock for year plausibility in date checks. */
    now?: Date;
}
export interface GateResult {
    checks: ConstraintCheck[];
    gate: GateVerdict;
}
export declare function gateItemOf(c: Pick<Candidate, 'url' | 'title' | 'snippet' | 'publishedAt'>): GateItem;
/** Run every constraint check and the relevance gate for one candidate. Never mutates. */
export declare function gateItem(task: Pick<TaskSpec, 'goal' | 'query' | 'needs' | 'constraints'>, item: GateItem, options?: GateOptions): GateResult;
/** Annotate candidates with `checks` and `gate`. Returns new objects; dropped candidates stay in the list (see {@link keptCandidates}). */
export declare function gateCandidates(task: Pick<TaskSpec, 'goal' | 'query' | 'needs' | 'constraints'>, candidates: readonly Candidate[], options?: GateOptions): Candidate[];
export declare function keptCandidates(candidates: readonly Candidate[]): Candidate[];
/** Candidates the gate must keep when it would otherwise leave fewer (default). */
export declare const DEFAULT_MIN_KEEP = 3;
export interface FloorResult {
    /** Survivors of the gate (fused order), then the floor's low-confidence additions (fused order). */
    kept: Candidate[];
    /** How many candidates the floor added back. */
    added: number;
}
/**
 * Floor for S4 (dev-plan §3.1, real-host run: a cross-lingual task had all 20 candidates dropped). `candidates`
 * are gated and in fused order, best first. When fewer than `minKeep` survive and more exist, the best-fused
 * ones dropped on RELEVANCE ALONE are kept up to `minKeep`, with `gate.lowConfidence = true` (and `keep` true, so
 * every later stage treats them as kept). A candidate with a definite hard-constraint violation (`reason: 'constraint'`)
 * is never brought back.
 */
export declare function applyFloor(candidates: readonly Candidate[], minKeep?: number): FloorResult;
