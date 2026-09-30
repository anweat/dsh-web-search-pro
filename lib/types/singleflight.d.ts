/**
 * In-flight de-duplication: concurrent callers with the same key share one
 * unit of work. Each caller keeps its own abort semantics — an aborted waiter
 * rejects with its own reason but the shared work is only cancelled once every
 * waiter has aborted.
 * @module web-search-pro/singleflight
 */
export declare class SingleFlight<T> {
    private readonly flights;
    /** Number of distinct keys currently in flight. */
    get size(): number;
    /**
     * Run `work` once per key; concurrent callers join the running flight.
     * `work` receives the SHARED signal (aborted only when all waiters abort).
     */
    do(key: string, work: (signal: AbortSignal) => Promise<T>, signal?: AbortSignal): Promise<T>;
    private start;
    private wait;
}
