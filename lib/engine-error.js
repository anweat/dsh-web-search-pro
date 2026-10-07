/**
 * The error every search engine and CLI adapter throws. Leaf module (no imports), so both engines.ts and the CLI adapter
 * layer can extend it without an import cycle.
 * @module web-search-pro/engine-error
 */
export class EngineError extends Error {
    code;
    retryable;
    retryAfterMs;
    /** `retryAfterMs`: the service's own wait hint (Retry-After); the router uses it as the cooldown. */
    constructor(message, code, retryable = true, retryAfterMs) {
        super(message);
        this.code = code;
        this.retryable = retryable;
        this.retryAfterMs = retryAfterMs;
        this.name = 'EngineError';
    }
}
//# sourceMappingURL=engine-error.js.map