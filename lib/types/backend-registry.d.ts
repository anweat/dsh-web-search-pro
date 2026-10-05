export interface BackendProbe {
    available: boolean;
    reason?: string;
}
/** Quality verdict for a successful run: ok, low-quality (usable but thin), or error. */
export interface BackendRunResult {
    ok: boolean;
    lowQuality?: boolean;
    detail?: string;
}
/**
 * Per-engine attempt record so callers can report *why* the router fell back.
 * `skipped` = never ran: unknown, cooling down or failed its availability probe (not a runtime error).
 */
export interface BackendAttempt {
    id: string;
    outcome: 'ok' | 'low-quality' | 'empty' | 'skipped' | 'error';
    detail?: string;
}
export interface Backend<I, O> {
    id: string;
    probe(): BackendProbe | Promise<BackendProbe>;
    run(input: I): Promise<O>;
    assess?(value: O): BackendRunResult;
}
/**
 * Thrown when no backend produced a usable result. Carries the per-engine
 * attempts so callers can tell "every engine answered with nothing" (all
 * `empty`) from real failures (any `error`).
 */
export declare class NoBackendError extends Error {
    readonly attempts: readonly BackendAttempt[];
    constructor(message: string, attempts: readonly BackendAttempt[]);
}
/** True when engines were tried and every one of them answered with a legitimate empty result. */
export declare function allAttemptsEmpty(attempts: readonly BackendAttempt[]): boolean;
/**
 * True when no engine failed at runtime: every attempt was an empty answer or
 * a skip (unavailable / cooldown / unknown). Such a search has nothing to
 * report but no error either (dev-plan M2b decision).
 */
export declare function allAttemptsBenign(attempts: readonly BackendAttempt[]): boolean;
export interface BackendDiagnostic {
    id: string;
    available: boolean;
    state: 'ready' | 'unavailable' | 'cooldown';
    reason?: string;
    lastError?: string;
    cooldownUntil?: string;
}
export interface RunSelectedOptions {
    preferred: readonly string[];
    override?: string;
    /** Caller's cancellation signal: an abort is rethrown at once and never cools an engine down. */
    signal?: AbortSignal;
}
export declare class BackendRegistry<I, O> {
    private readonly options;
    private readonly entries;
    private readonly failures;
    constructor(options?: {
        cooldownMs?: number;
    });
    register(backend: Backend<I, O>): this;
    has(id: string): boolean;
    /** Remove a backend (and its cooldown). Returns whether it existed. */
    unregister(id: string): boolean;
    run(input: I, options: RunSelectedOptions): Promise<O>;
    /**
     * Try engines in order. A successful engine wins by default, but when its
     * `assess()` verdict is `lowQuality` and there are more engines to try, the
     * router keeps probing; a later *ok* engine replaces it. If no later engine
     * does better, the best low-quality result (first one) is still returned.
     */
    runSelected(input: I, options: RunSelectedOptions): Promise<{
        id: string;
        value: O;
        attempts: BackendAttempt[];
    }>;
    diagnostics(): BackendDiagnostic[];
    diagnosticsAsync(): Promise<BackendDiagnostic[]>;
}
