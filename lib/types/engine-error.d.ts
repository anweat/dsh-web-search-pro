/**
 * The error every search engine and CLI adapter throws. Leaf module (no imports), so both engines.ts and the CLI adapter
 * layer can extend it without an import cycle.
 * @module web-search-pro/engine-error
 */
export declare class EngineError extends Error {
    readonly code: string;
    readonly retryable: boolean;
    readonly retryAfterMs?: number | undefined;
    /** `retryAfterMs`: the service's own wait hint (Retry-After); the router uses it as the cooldown. */
    constructor(message: string, code: string, retryable?: boolean, retryAfterMs?: number | undefined);
}
