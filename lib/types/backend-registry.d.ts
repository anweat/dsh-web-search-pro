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
/** Per-engine attempt record so callers can report *why* the router fell back. */
export interface BackendAttempt {
    id: string;
    outcome: 'ok' | 'low-quality' | 'error';
    detail?: string;
}
export interface Backend<I, O> {
    id: string;
    probe(): BackendProbe | Promise<BackendProbe>;
    run(input: I): Promise<O>;
    assess?(value: O): BackendRunResult;
}
export interface BackendDiagnostic {
    id: string;
    available: boolean;
    state: 'ready' | 'unavailable' | 'cooldown';
    reason?: string;
    lastError?: string;
    cooldownUntil?: string;
}
export declare class BackendRegistry<I, O> {
    private readonly options;
    private readonly entries;
    private readonly failures;
    constructor(options?: {
        cooldownMs?: number;
    });
    register(backend: Backend<I, O>): this;
    run(input: I, options: {
        preferred: readonly string[];
        override?: string;
    }): Promise<O>;
    /**
     * Try engines in order. A successful engine wins by default, but when its
     * `assess()` verdict is `lowQuality` and there are more engines to try, the
     * router keeps probing; a later *ok* engine replaces it. If no later engine
     * does better, the best low-quality result (first one) is still returned.
     */
    runSelected(input: I, options: {
        preferred: readonly string[];
        override?: string;
    }): Promise<{
        id: string;
        value: O;
        attempts: BackendAttempt[];
    }>;
    diagnostics(): BackendDiagnostic[];
    diagnosticsAsync(): Promise<BackendDiagnostic[]>;
}
