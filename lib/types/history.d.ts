import type { PageRecord, QueryRecord, Store } from './store.ts';
export interface HistorySource {
    url: string;
    title?: string;
    snippet?: string;
    publishedAt?: string;
}
export type HistoryReplay = {
    record: QueryRecord;
    sources: HistorySource[];
    page?: never;
} | {
    record: QueryRecord;
    page: PageRecord;
    sources?: never;
};
/** Resolve a history id according to its operation kind. */
export declare function replayHistory(store: Store, id: string): HistoryReplay;
/** Output cap of one expansion. */
export declare const EXPAND_MAX_CHARS = 4000;
export interface ExpandedBlock {
    blockId: string;
    position: 'before' | 'match' | 'after';
    text: string;
    /** The text was cut to fit the cap. */
    truncated?: boolean;
}
export interface ExpandedEvidence {
    evidenceId: string;
    url: string;
    title?: string;
    heading?: string;
    blocks: ExpandedBlock[];
    note?: string;
}
/**
 * Full text of a stored evidence block plus its neighbouring blocks (+-1) from
 * the stored page, capped at `EXPAND_MAX_CHARS` characters overall: the match
 * is kept whole (cut only when it alone exceeds the cap), the neighbours share
 * what is left (the tail of the previous block, the head of the next).
 */
export declare function expandEvidence(store: Store, evidenceId: string, maxChars?: number): ExpandedEvidence;
