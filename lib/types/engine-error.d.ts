/**
 * The error every search engine and CLI adapter throws. Leaf module (no imports), so both engines.ts and the CLI adapter
 * layer can extend it without an import cycle.
 * @module web-search-pro/engine-error
 */
/**
 * What a rendered search page turned out to be, as dsh-browser's `searchPage` reports it (docs/session-p0-contract.md). It rides
 * on the error as `outcome`, so a chain's notes and `sources.status` can say what happened beyond the error code.
 */
export type SearchPageOutcome = 'ok' | 'empty' | 'empty_unconfirmed' | 'needs_login' | 'captcha' | 'blocked' | 'rate_limited' | 'site_error' | 'network' | 'timeout' | 'contract_drift';
export declare class EngineError extends Error {
    readonly code: string;
    readonly retryable: boolean;
    readonly retryAfterMs?: number | undefined;
    readonly outcome?: SearchPageOutcome | undefined;
    /**
     * `retryAfterMs`: the service's own wait hint (Retry-After); the router uses it as the cooldown.
     * `outcome`: the state of the search page that led to this error, when a `searchPage` verdict did.
     */
    constructor(message: string, code: string, retryable?: boolean, retryAfterMs?: number | undefined, outcome?: SearchPageOutcome | undefined);
}
/**
 * What a failure tells the caller: its message, plus the remedy (`hint`, e.g. a CliAdapterError's login hint) when it has
 * one the message does not already contain. The one place a failure becomes text for a backend attempt or a chain note.
 */
export declare function describeFailure(error: unknown): string;
