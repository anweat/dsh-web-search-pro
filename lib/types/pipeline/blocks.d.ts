/**
 * Block splitter: turns extracted page text into stable, addressable blocks
 * (dev-plan §4.3 S5: "按结构分块，保留标题层级"). Pure and dependency-free.
 *
 * Rules:
 * - Fenced code blocks and Markdown tables are atomic: never split, never
 *   merged across their boundary when that would exceed `maxChars`.
 * - Headings (Markdown `#`, setext, or — for the plain text that
 *   `extractText` emits, which carries no heading markers — a conservative
 *   heuristic) start a new section. The heading line is kept inside the first
 *   block of its section, and every block carries the heading path
 *   (`A > B`), so no text is ever dropped by a wrong heading guess.
 * - Consecutive paragraphs are packed up to `maxChars`; an oversized
 *   paragraph is cut at line, then sentence (CJK and Latin), then hard limits.
 * - Invariant: `block.text === text.slice(block.start, block.end)` (trimmed),
 *   and `blockId = 'b_' + sha1(url + ':' + start)`, so the same page text
 *   always yields the same ids.
 * @module web-search-pro/pipeline/blocks
 */
import type { Block, Need } from './types.ts';
export interface SplitOptions {
    /** Soft upper bound per block, in UTF-16 code units. Atomic units may exceed it. */
    maxChars?: number;
    /** Blocks are not closed for size before reaching this length. */
    minChars?: number;
    /** Guess headings in plain text. Markdown headings are always honored. */
    inferHeadings?: boolean;
}
/**
 * Split page text into blocks.
 * @param text - extracted page text (Markdown-ish or plain).
 * @param url - page URL; part of every blockId.
 */
export declare function splitBlocks(text: string, url: string, options?: SplitOptions): Block[];
/** Anything block-shaped the pre-ranker can look at: a heading path and a text. */
export interface RankableBlock {
    heading?: string;
    text: string;
}
/** The text S6 scores and the pre-ranker reads: heading path, newline, block text. */
export declare function blockScoringText(block: RankableBlock): string;
/**
 * Pre-rank blocks for one need: weighted lexical overlap of the need (x1.6) and
 * the query (x1.0) with heading + text, best first, ties in input order. This is
 * exactly the r1 experiment's S6 input selection, so judge caches from that
 * run stay valid.
 */
export declare function preRankBlocks<T extends RankableBlock>(need: Pick<Need, 'text'>, query: string, blocks: readonly T[], limit: number): {
    item: T;
    score: number;
}[];
