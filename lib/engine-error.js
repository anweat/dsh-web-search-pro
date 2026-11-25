/**
 * The error every search engine and CLI adapter throws. Leaf module (no imports), so both engines.ts and the CLI adapter
 * layer can extend it without an import cycle.
 * @module web-search-pro/engine-error
 */
export class EngineError extends Error {
    code;
    retryable;
    retryAfterMs;
    outcome;
    /**
     * `retryAfterMs`: the service's own wait hint (Retry-After); the router uses it as the cooldown.
     * `outcome`: the state of the search page that led to this error, when a `searchPage` verdict did.
     */
    constructor(message, code, retryable = true, retryAfterMs, outcome) {
        super(message);
        this.code = code;
        this.retryable = retryable;
        this.retryAfterMs = retryAfterMs;
        this.outcome = outcome;
        this.name = 'EngineError';
    }
}
/**
 * What a failure tells the caller: its message, plus the remedy (`hint`, e.g. a CliAdapterError's login hint) when it has
 * one the message does not already contain. The one place a failure becomes text for a backend attempt or a chain note.
 */
export function describeFailure(error) {
    const message = error instanceof Error ? error.message : String(error);
    const hint = error?.hint;
    return typeof hint === 'string' && hint.trim() && !message.includes(hint) ? message + '（' + hint + '）' : message;
}
//# sourceMappingURL=engine-error.js.map