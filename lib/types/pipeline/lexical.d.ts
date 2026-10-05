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
/** `context`: background that weighs in but cannot make a block distinctive on its own (the task goal). */
export interface QueryPart {
    text: string;
    weight: number;
    context?: boolean;
}
/** Merged query terms: the best `intrinsic weight * part weight` per term. */
export declare function mergedTerms(parts: readonly QueryPart[]): Map<string, number>;
/** Weighted fraction of query terms present in `doc` (0..1). Term weight = part weight * intrinsic weight. */
export declare function weightedOverlap(parts: readonly QueryPart[], doc: string): number;
/** Document frequencies over the blocks of one page (or of all pages read), as the S6 rule scorer sees them. */
export interface PageTermStats {
    /** Number of blocks. */
    n: number;
    /** Blocks containing a `termsOf` term (Han bigram or lexical-v1 word). */
    dfLexical(term: string): number;
    /** Blocks containing a `latinTermsOf` term (identifier-aware, see align.ts). */
    dfLatin(term: string): number;
}
/** Floor of the IDF factor: a term present in every block still counts this much of its weight. */
export declare const IDF_FLOOR = 0.2;
/** A matched term is distinctive when its normalised IDF (0..1, as used for the weight) reaches this: at most about 14% of the blocks of a 117-block page, 25% of 12. */
export declare const DISTINCT_IDF = 0.45;
/** Share of a rare term's weight that still counts when the term only occurs inside code (samples), not in prose. */
export declare const CODE_ONLY_CREDIT = 0.5;
/** ...and of a term that nearly every block has (an identifier every code sample repeats says nothing about the section). */
export declare const CODE_COMMON_CREDIT = 0.1;
/** Normalised IDF (0..1) of a term found in `df` of `n` blocks, the BM25-style log used by the pre-rank. */
export declare function idfNorm(df: number, n: number): number;
/** Credit of a term found only in code: CODE_COMMON_CREDIT when every block has it, rising to CODE_ONLY_CREDIT as it gets rarer. */
export declare function codeCredit(df: number, n: number): number;
/** IDF factor in [IDF_FLOOR, 1] for a term found in `df` of `n` blocks; a term no block contains (`df` = 0) keeps its full weight (it can only ever be a miss). */
export declare function idfFactor(df: number, n: number): number;
/** A term that occurs on the page, but in few of its blocks: matching it says something about WHICH block answers. */
export declare function isDistinctive(df: number, n: number): boolean;
/**
 * Split block text into prose and code: fenced code blocks plus unfenced
 * lines that look like code (keyword-led, `//` comments, shell prompts, or a
 * line ending in `;` / `{` / `}`). Inline `code` spans inside prose stay prose.
 */
export declare function splitProseCode(text: string): {
    prose: string;
    code: string;
};
export interface StatsOverlap {
    relevance: number;
    /** A matched term occurs in a minority of the blocks. */
    distinctiveHit: boolean;
    /** The task has at least one such term on this page (so a block that matches none of them is not just "everything is common"). */
    distinctiveAvailable: boolean;
}
/**
 * `weightedOverlap` with page statistics: every term's weight is scaled by its
 * IDF factor (terms no block contains keep their weight), and a term found only
 * in code counts {@link CODE_ONLY_CREDIT} of its weight.
 */
export declare function statsOverlap(parts: readonly QueryPart[], doc: string, stats: PageTermStats): StatsOverlap;
export declare function hostOf(url: string | undefined): string | undefined;
/** Share of Han characters among letters/ideographs: a cheap zh/en detector. */
export declare function hanRatio(text: string): number;
