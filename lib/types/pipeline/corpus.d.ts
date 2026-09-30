/**
 * Page-level term statistics for the S6 rule scorer (dev-plan M3b).
 *
 * Problem (real host, after M3a): on the node:sqlite page `DatabaseSync` sits in
 * the code sample of nearly every section, so a section about serialize() or
 * loadExtension() matched "DatabaseSync ... timeout" on that identifier (plus
 * `node:sqlite`) alone and graded 2, while the section that documents the
 * `timeout` constructor option was crowded out. Terms are therefore weighed by
 * how few blocks of the page contain them (IDF, floor 0.2, the M2c pre-rank
 * idea), and a grade of 2 or more needs at least one distinctive matched term.
 *
 * Statistics come from the blocks of one URL when it has enough of them, else
 * from all blocks read; with fewer than {@link STATS_MIN_BLOCKS} blocks there is
 * nothing to count and the scorer keeps its un-weighted behaviour.
 * @module web-search-pro/pipeline/corpus
 */
import { type RankableBlock } from './blocks.ts';
import { type PageTermStats } from './lexical.ts';
export interface CorpusBlock extends RankableBlock {
    url: string;
}
/** Fewer blocks than this: no statistics. */
export declare const STATS_MIN_BLOCKS = 8;
/** A URL with at least this many blocks gets its own statistics. */
export declare const STATS_PAGE_MIN_BLOCKS = 12;
export declare class CorpusStats {
    private readonly blocks;
    private readonly byUrl;
    private readonly tables;
    private all;
    readonly size: number;
    constructor(blocks: readonly CorpusBlock[]);
    /** Statistics to weigh a block of `url` with, or undefined when the corpus is too small. */
    statsFor(url: string): PageTermStats | undefined;
}
