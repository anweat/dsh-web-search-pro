/**
 * S7 budgeted selection and S8 coverage (dev-plan §4.3, design §6.4).
 *
 * S7 is deterministic: every block gets an excerpt (an intact run of sentences
 * of at most `maxExcerptChars`, chosen for the best need), then blocks are
 * picked in two phases under a total excerpt-character budget:
 *   A. reservation - each critical need that any block supports at grade >= 2
 *      gets its best block first (so a greedy fill cannot starve it);
 *   B. greedy by gain / cost, where a block's gain counts the needs it newly
 *      covers fully, corroboration of covered needs at a discount, and weak
 *      (grade 1) support only for still-uncovered needs; `maxPerUrl` blocks per
 *      URL, repeated hashes and near-duplicate texts are skipped, and further
 *      blocks of a URL already in the pack count less.
 * S8: a need is covered when a selected block has grade >= `coverGrade`; the
 * others become gaps with the reason. Grades are NOT comparable across scorers
 * (rule buckets vs Jev expectation), so all thresholds apply to one scorer's
 * output at a time.
 * @module web-search-pro/pipeline/select
 */
import { type QueryPart } from './lexical.ts';
import type { Gap, Need, ScoredBlock } from './types.ts';
export interface SelectOptions {
    /** Total characters of excerpts (default 6000). */
    charBudget: number;
    /** Excerpt length cap (default 600). */
    maxExcerptChars: number;
    /** Blocks from one URL (default 2). */
    maxPerUrl: number;
    /** Hard cap on evidence items (default 10). */
    maxItems: number;
    /** Lowest grade that can make a block eligible at all (default 1). */
    minGrade: number;
    /** Grade from which a block supports a need (default 2, the S8 threshold). */
    coverGrade: number;
    /** Per-item rendering overhead (title, URL, heading) counted in the efficiency denominator. */
    overheadChars: number;
}
export declare const DEFAULT_SELECT_OPTIONS: SelectOptions;
/** Ranges of sentences (and lines) of `text`, in order; whitespace between them is not part of any range. */
export declare function sentenceRanges(text: string): {
    start: number;
    end: number;
}[];
/**
 * Excerpt of a block text: the whole text when it fits, else the run of
 * consecutive sentences (<= `max` characters) with the most need overlap
 * (earliest on ties); an over-long single sentence is cut at a clause boundary.
 * `…` marks the side(s) that were cut.
 */
export declare function excerptOf(text: string, parts: readonly QueryPart[], max: number): string;
export interface SelectedBlock {
    block: ScoredBlock;
    excerpt: string;
    /** Needs supported at `minGrade` or better, best first. */
    needIds: string[];
    /** Best grade over the needs. */
    grade: number;
    reason: 'reserved' | 'greedy';
}
export interface SelectionResult {
    selected: SelectedBlock[];
    /** Excerpt characters in use. */
    usedChars: number;
}
type TaskLike = {
    query: string;
    needs: readonly Need[];
};
export declare function selectEvidence(task: TaskLike, blocks: readonly ScoredBlock[], options?: Partial<SelectOptions>): SelectionResult;
export interface CoverageInput {
    needs: readonly Need[];
    selected: readonly SelectedBlock[];
    /** Every scored block (to tell "nothing supports it" from "left out by the budget"). */
    scored: readonly ScoredBlock[];
    coverGrade?: number;
    /** Kept candidates and pages read, for the gap reason when there is nothing to score. */
    keptCandidates: number;
    pagesRead: number;
}
export interface Coverage {
    covered: string[];
    gaps: Gap[];
}
export declare function computeCoverage(input: CoverageInput): Coverage;
export {};
