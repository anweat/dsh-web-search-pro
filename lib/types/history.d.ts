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
