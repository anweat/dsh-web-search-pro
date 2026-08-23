/**
 * Minimal in-process LRU cache (Map + recency bump). Layered above SQLite:
 * hot searches/page fetches resolve in microseconds without touching the DB.
 * @module web-search-pro/memory-cache
 */
export interface LruEntry<T> {
    ts: number;
    value: T;
}
export declare class LruCache<T> {
    private readonly capacity;
    private readonly map;
    constructor(capacity: number);
    get(key: string, ttlMs: number): T | undefined;
    set(key: string, value: T): void;
    clear(): void;
    get size(): number;
}
