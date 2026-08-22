export interface BackendProbe {
    available: boolean;
    reason?: string;
}
export interface Backend<I, O> {
    id: string;
    probe(): BackendProbe;
    run(input: I): Promise<O>;
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
    runSelected(input: I, options: {
        preferred: readonly string[];
        override?: string;
    }): Promise<{
        id: string;
        value: O;
    }>;
    diagnostics(): BackendDiagnostic[];
}
