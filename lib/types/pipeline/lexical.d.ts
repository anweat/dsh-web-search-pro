/**
 * Lexical helpers shared by the S3/S4 rule gate, query compilation, the bench
 * rule judge, the block pre-ranker and the labeler: Chinese via character
 * bigrams, Latin via lowercase word tokens. Ported from bench/judges/lexical
 * (the r1 experiment); thresholds calibrated on it only hold while this
 * tokenisation stays unchanged, so edit with `bench/src/eval-gate.ts` at hand.
 * @module web-search-pro/pipeline/lexical
 */
/** Chinese function characters; bigrams containing them carry no topical signal. */
export declare const HAN_STOP: Set<string>;
export declare const LATIN_STOP: Set<string>;
export interface Term {
    term: string;
    weight: number;
}
/** Distinct terms of a text with intrinsic weights (longer / digit-bearing terms weigh more). */
export declare function termsOf(text: string): Map<string, number>;
export interface QueryPart {
    text: string;
    weight: number;
}
/** Weighted fraction of query terms present in `doc` (0..1). Term weight = part weight * intrinsic weight. */
export declare function weightedOverlap(parts: readonly QueryPart[], doc: string): number;
export declare function hostOf(url: string | undefined): string | undefined;
/** Share of Han characters among letters/ideographs: a cheap zh/en detector. */
export declare function hanRatio(text: string): number;
