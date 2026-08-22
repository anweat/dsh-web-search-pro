/**
 * SQLite persistence for web-search-pro (node:sqlite, zero dependencies).
 * Stores search queries + results, fetched page snapshots, and user-extended
 * extraction rules (userscript-style). All methods are synchronous; writes are
 * small and batched per call.
 * @module web-search-pro/store
 */
export type QueryKind = 'search' | 'fetch' | 'platform' | 'snapshot';
export interface QueryRecord {
    id: string;
    kind: QueryKind;
    query?: string;
    engine?: string;
    platform?: string;
    url?: string;
    status: string;
    ts: string;
    detail?: string;
    cacheKey?: string;
}
export interface SourceRow {
    id: string;
    queryId: string;
    rank: number;
    url: string;
    title?: string;
    snippet?: string;
    published?: string;
    engine?: string;
    extra?: string;
}
export interface PageRecord {
    id: string;
    url: string;
    title?: string;
    text?: string;
    htmlPath?: string;
    screenshotPath?: string;
    status?: number;
    fetchedAt: string;
    source?: string;
}
export interface RuleRecord {
    hostname: string;
    content: string;
    remove?: string;
    createdAt: string;
    updatedAt: string;
}
export declare class Store {
    readonly dbPath: string;
    private db;
    constructor(dbPath: string);
    close(): void;
    /** Record one operation (search / fetch / platform / snapshot). Returns its id. */
    recordQuery(input: Omit<QueryRecord, 'id' | 'ts'> & {
        id?: string;
    }): string;
    /** Look up a fresh cached search by (engine, normalized query). */
    getCachedSearch(engine: string, normQuery: string, ttlSeconds: number): {
        id: string;
        detail?: string;
    } | undefined;
    /** Look up a fresh cached operation by kind and its complete input fingerprint. */
    getCachedQuery(kind: QueryKind, cacheKey: string, ttlSeconds: number): {
        id: string;
        detail?: string;
    } | undefined;
    recordResults(queryId: string, sources: {
        url: string;
        title?: string;
        snippet?: string;
        publishedAt?: string;
        extra?: string;
    }[], engine: string): void;
    resultsForQuery(queryId: string): SourceRow[];
    /** Fresh page snapshot by URL, or undefined. */
    getPage(url: string, ttlSeconds: number): PageRecord | undefined;
    savePage(input: Omit<PageRecord, 'id' | 'fetchedAt'>): void;
    listQueries(opts: {
        kind?: QueryKind;
        query?: string;
        engine?: string;
        platform?: string;
        limit?: number;
    }): QueryRecord[];
    clearCache(opts: {
        olderThanDays?: number;
        engine?: string;
    }): {
        queries: number;
        results: number;
        pages: number;
    };
    private removeQuery;
    /** Delete one query and its results; returns whether it existed. */
    deleteQuery(id: string): boolean;
    /** Most-used engines, desc. */
    topEngines(limit?: number): {
        engine: string;
        count: number;
    }[];
    /** Most-frequent queries, desc. */
    topQueries(limit?: number): {
        query: string;
        count: number;
    }[];
    /** Per-kind record counts. */
    kindCounts(): {
        kind: string;
        count: number;
    }[];
    stats(): {
        dbSizeBytes: number;
        queries: number;
        results: number;
        pages: number;
        rules: number;
    };
    listRules(): RuleRecord[];
    upsertRule(hostname: string, content: string, remove?: string): void;
    removeRule(hostname: string): boolean;
}
