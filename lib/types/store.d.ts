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
    queryId?: string;
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
export interface EvidenceBlockRow {
    evidenceId: string;
    runId: string;
    url: string;
    blockId: string;
    heading?: string;
    text: string;
    hash?: string;
    grade?: number;
    scorer?: string;
    /** `id@version#hash` of the judge rubric when a Jev-based scorer graded the block. */
    rubric?: string;
    /** `provider|protocol|model[|calibration]` of the model judge that graded the block (dev-plan M5). */
    judge?: string;
}
/** One model call (or reservation) of the usage ledger (design §9). */
export interface UsageRow {
    id: string;
    ts: string;
    /** Calendar day (YYYY-MM-DD) in the configured budget time zone at reservation time. */
    day: string;
    searchId?: string;
    provider: string;
    protocol: string;
    model?: string;
    /** reserved: estimate held while the call runs (counts against the caps); settled: final; released: refused or failed without billing. */
    status: 'reserved' | 'settled' | 'released';
    requests: number;
    inputTokens: number;
    outputTokens: number;
    /** Some token figures are the plugin's estimate (the service reported none, or the call outcome is unknown). */
    estimated: boolean;
    /** Money spent in `currency`; null = price unknown (never 0). */
    amount: number | null;
    currency?: string;
    note?: string;
}
export interface UsageTotals {
    requests: number;
    inputTokens: number;
    outputTokens: number;
    estimated: boolean;
    calls: number;
    amount: number | null;
    currency?: string;
}
export interface EvidenceRunRow {
    id: string;
    queryId?: string;
    taskJson: string;
    packJson: string;
    createdAt: string;
}
/** Persistence health counters; never throws, safe to read after close. */
export interface StoreDiagnostics {
    closed: boolean;
    /** Writes that threw (e.g. SQLITE_BUSY after the busy timeout). */
    writeFailures: number;
    /** Writes silently skipped because the store was already closed. */
    skippedWrites: number;
    lastError?: string;
    lastErrorAt?: string;
}
export interface StoreOptions {
    currentSearchCacheKeyPrefix?: string;
    /** SQLite busy timeout; concurrent writers wait this long instead of failing at once. */
    busyTimeoutMs?: number;
    /** Receives one line per persistence failure / skipped write. */
    onDiagnostic?: (message: string) => void;
}
export declare class Store {
    readonly dbPath: string;
    private db;
    private closed;
    private txDepth;
    private writeFailures;
    private skippedWrites;
    private lastError;
    private readonly onDiagnostic;
    constructor(dbPath: string, opts?: StoreOptions);
    close(): void;
    get isClosed(): boolean;
    diagnostics(): StoreDiagnostics;
    private note;
    /** Write guard: after close() writes are no-ops (counted) instead of throwing for in-flight requests. */
    private write;
    /** Read guard: after close() reads return a cache miss. */
    private read;
    /**
     * Run best-effort persistence: a failure (SQLITE_BUSY past the timeout, disk
     * full, ...) is logged and counted but never propagates, so a search/fetch
     * that already has its result still returns it.
     */
    bestEffort<T>(op: string, fn: () => T): T | undefined;
    /**
     * Run `fn` atomically: BEGIN IMMEDIATE / COMMIT, ROLLBACK when it throws.
     * Nested calls become savepoints, so an inner failure rolls back only its own
     * writes. After close() `fn` still runs but its writes are no-ops.
     */
    transaction<T>(fn: () => T): T;
    /** Record one operation (search / fetch / platform / snapshot). Returns its id. */
    recordQuery(input: Omit<QueryRecord, 'id' | 'ts'> & {
        id?: string;
    }): string;
    /** Atomically record a search-like query and its result rows (all or nothing). */
    recordSearch(input: Omit<QueryRecord, 'id' | 'ts'> & {
        id?: string;
    }, sources: {
        url: string;
        title?: string;
        snippet?: string;
        publishedAt?: string;
        extra?: string;
    }[], engine: string): string;
    /** Atomically record a fetch/snapshot query and its page row (all or nothing). */
    recordFetch(input: Omit<QueryRecord, 'id' | 'ts'> & {
        id?: string;
    }, page: Omit<PageRecord, 'id' | 'fetchedAt' | 'queryId'>): string;
    /**
     * Atomically record an evidence-pipeline run: its history query + fused
     * result rows, the run (task + pack JSON) and the selected blocks' full text
     * (all or nothing). Returns the history query id.
     */
    recordEvidenceRun(input: {
        query: Omit<QueryRecord, 'id' | 'ts'> & {
            id?: string;
        };
        sources: {
            url: string;
            title?: string;
            snippet?: string;
            publishedAt?: string;
            extra?: string;
        }[];
        engine: string;
        run: {
            id: string;
            taskJson: string;
            packJson: string;
        };
        blocks: readonly Omit<EvidenceBlockRow, 'runId'>[];
    }): string;
    /**
     * Reserve `inputTokens` for a model call, atomically across processes sharing this file
     * (BEGIN IMMEDIATE): refused when today's reserved + settled input tokens, over all providers or
     * for this provider, plus the request would pass a daily cap. Reserved rows count until settled,
     * so a crash between reserve and settle never frees the tokens. A closed or failing store refuses.
     */
    reserveUsage(input: {
        id: string;
        ts: string;
        day: string;
        searchId?: string;
        provider: string;
        protocol: string;
        model?: string;
        inputTokens: number;
        dailyCap?: number;
        providerDailyCap?: number;
    }): {
        ok: true;
    } | {
        ok: false;
        scope: 'daily' | 'provider-daily' | 'unavailable';
        used: number;
        cap: number;
    };
    /**
     * Requests booked for a request-counted provider (protocol `search`): over all time and on `day`. A settled row counts its
     * `requests`, an open reservation counts one (a crash never frees it), a released row none.
     */
    requestCounts(provider: string, day: string): {
        total: number;
        today: number;
    };
    /**
     * Reserve ONE request of a request-capped source, atomically across processes sharing this file (BEGIN IMMEDIATE), like
     * {@link reserveUsage} does for tokens: refused when the all-time `total` or today's `daily` cap would be passed. A closed or
     * failing store refuses.
     */
    reserveRequest(input: {
        id: string;
        ts: string;
        day: string;
        searchId?: string;
        provider: string;
        protocol: string;
        total?: number;
        daily?: number;
    }): {
        ok: true;
    } | {
        ok: false;
        scope: 'total' | 'daily' | 'unavailable';
        used: number;
        cap: number;
    };
    /** Close a reservation: final tokens (actual, or the estimate flagged `estimated`) and amount (null = unknown price). */
    settleUsage(id: string, final: {
        status: 'settled' | 'released';
        requests: number;
        inputTokens: number;
        outputTokens: number;
        estimated: boolean;
        amount: number | null;
        currency?: string;
        note?: string;
    }): void;
    /** Ledger rows of one day, oldest first (optionally one provider). */
    usageRows(day: string, provider?: string): UsageRow[];
    /** Per-provider totals of one day over reserved and settled rows (released rows only add their request). */
    usageByProvider(day: string): (UsageTotals & {
        provider: string;
        protocol: string;
    })[];
    evidenceBlock(evidenceId: string): EvidenceBlockRow | undefined;
    evidenceRun(runId: string): EvidenceRunRow | undefined;
    /** Newest stored page text for a URL, regardless of age (evidence expansion reads around a block). */
    latestPage(url: string): PageRecord | undefined;
    /** Look up a fresh cached operation by kind and its complete input fingerprint. */
    getCachedQuery(kind: QueryKind, cacheKey: string, ttlSeconds: number): {
        id: string;
        detail?: string;
    } | undefined;
    private getCachedQueryRow;
    recordResults(queryId: string, sources: {
        url: string;
        title?: string;
        snippet?: string;
        publishedAt?: string;
        extra?: string;
    }[], engine: string): void;
    resultsForQuery(queryId: string): SourceRow[];
    queryById(id: string): QueryRecord | undefined;
    /** Fresh page snapshot by URL and, when requested, its exact backend source. */
    getPage(url: string, ttlSeconds: number, source?: string): PageRecord | undefined;
    private getPageRow;
    savePage(input: Omit<PageRecord, 'id' | 'fetchedAt'>): void;
    /** Exact persisted fetch/snapshot for a history query; legacy rows fall back by URL. */
    pageForQuery(queryId: string): PageRecord | undefined;
    private pageForQueryRow;
    listQueries(opts: {
        kind?: QueryKind;
        query?: string;
        engine?: string;
        platform?: string;
        limit?: number;
    }): QueryRecord[];
    private listQueriesRows;
    clearCache(opts: {
        olderThanDays?: number;
        engine?: string;
    }): {
        queries: number;
        results: number;
        pages: number;
    };
    private clearCacheRows;
    /**
     * Purge search rows minted with an older cache-key version (e.g. ddg results
     * saved before the snippet-regex fix). Called once at startup so stale
     * titles-only rows are never replayed from the persistent cache.
     */
    cleanupLegacySearchCache(currentPrefix: string): {
        queries: number;
        results: number;
    };
    private cleanupLegacyRows;
    /** Delete evidence runs matching `predicate` (over evidence_runs) and their blocks. */
    private deleteEvidenceWhere;
    private removeQuery;
    /** Delete one query and its linked rows; returns exact counts when it existed. */
    deleteQuery(id: string): {
        queries: number;
        results: number;
        pages: number;
    } | undefined;
    private deleteQueryRows;
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
    private statsRows;
    listRules(): RuleRecord[];
    upsertRule(hostname: string, content: string, remove?: string): void;
    removeRule(hostname: string): boolean;
}
