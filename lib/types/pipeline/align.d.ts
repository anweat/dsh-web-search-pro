/**
 * Cross-lingual term alignment for the S6 rule scorer (dev-plan M3a).
 *
 * Problem (M2c end-to-end run): the need "DatabaseSync 构造参数中的 timeout 选项"
 * against the English block "sqlite.DatabaseSyncOptions.timeout — timeout?:
 * number — The busy timeout in milliseconds" only got grade 1. Two structural
 * reasons, both fixed here without touching the calibrated gate lexicon
 * (`lexical.ts`):
 *
 *  1. Dilution. Every Han bigram of the need / query / goal counts in the
 *     denominator but can never appear in an English block, so a fully matching
 *     Latin half scores ~0.25. For a Latin block the Han terms are therefore
 *     left out, and the score is shrunk when the remaining Latin evidence is
 *     thin (one stray shared word must not reach grade 3).
 *  2. Identifier shape. `DatabaseSync` versus `DatabaseSyncOptions`,
 *     `busy_timeout` versus `busyTimeout` versus "busy timeout": Latin tokens
 *     are split on separators and on camelCase boundaries, matched in a
 *     separator-free normal form, and a need identifier that is the prefix /
 *     suffix of a longer block identifier earns partial credit.
 *
 * Latin terms come from the need, the query, the goal and entity / must_term
 * constraint values, so a Chinese need inherits the English terms the calling
 * model already put into the query.
 *
 * The RuleScorer applies this only to pairs whose need and block languages
 * differ (`languagesDiffer`); same-language pairs keep the calibrated lexical-v1
 * relevance: an offline sweep (bench/src/eval-pack.ts, 60 tasks) found no gain
 * from identifier splitting there (-1 need hit) while mismatch-only alignment
 * is neutral-to-positive on every metric.
 * @module web-search-pro/pipeline/align
 */
import type { ConstraintLike } from './gate.ts';
export type TextLang = 'zh' | 'latin' | 'none';
/**
 * zh vs latin by character ratio. A Han character carries about three times the
 * information of a Latin letter, so `zh` when Han share (weighted 3:1) of all
 * letters reaches 30%: a Chinese sentence with a few identifiers stays zh, an
 * English page with a Chinese title stays latin. `none`: no letters at all.
 */
export declare function detectLang(text: string): TextLang;
/** Both texts have a language and it differs: the pairs the lexical rule is structurally weak on. */
export declare function languagesDiffer(a: string, b: string): boolean;
/**
 * Latin terms of a text with intrinsic weights. A token yields its separator-free
 * lowercase form (`busy_timeout`, `busyTimeout` -> `busytimeout`), each
 * separator-delimited piece (x0.7) and each camelCase sub-word (x0.6).
 * Consecutive plain words stay separate terms, as in `termsOf`.
 */
export declare function latinTermsOf(text: string): Map<string, number>;
/** Credit for an identifier that only appears inside a longer one (`databasesync` in `databasesyncoptions`). */
export declare const CONTAINMENT_CREDIT = 0.7;
/** Weights of the parts of the aligned query (dev-plan M3a; the gate's relevance keeps its own). */
export declare const ALIGN_WEIGHTS: {
    readonly need: 1.6;
    readonly query: 1;
    readonly goal: 0.8;
    readonly hardConstraint: 1.2;
    readonly softConstraint: 1;
};
/** Below this much Latin term weight a Latin-only comparison is shrunk proportionally. */
export declare const ALIGN_MIN_LATIN_WEIGHT = 5;
/** Share of a Han term's weight that still counts in the denominator when the block is Latin (0 = dropped; offline sweep: 0 and 1 lose need hit, 0.15-0.5 are equal). */
export declare const ALIGN_HAN_KEPT = 0.3;
export interface AlignContext {
    goal: string;
    query: string;
    /** The need the block is scored against. */
    need: string;
    constraints: readonly ConstraintLike[];
}
export interface AlignItem {
    heading?: string | undefined;
    text: string;
}
/**
 * Weighted share (0..1) of the task's terms found in the block, with the
 * cross-lingual and identifier handling described in the module comment.
 * Same scale as `lexicalRelevance`, so `bucketGrade` thresholds still apply.
 */
export declare function alignedRelevance(ctx: AlignContext, item: AlignItem): number;
