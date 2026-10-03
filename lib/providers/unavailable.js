/**
 * A source the caller named explicitly (a platform, or `engines` of platforms) that cannot run right now: missing
 * dsh-browser, login / CLI / token, disabled in settings, cooling down. A structured error rather than an empty result, so
 * the caller can tell the user what is missing instead of reading "no results" as "nothing exists". The action layer maps it
 * to CAPABILITY_UNAVAILABLE and adds the catalog's setup text for `source`.
 * @module web-search-pro/providers/unavailable
 */
export class SourceUnavailableError extends Error {
    code = 'SOURCE_UNAVAILABLE';
    /** Route id of the provider (`zhihu`). */
    source;
    /** What is missing or why it is unavailable, as the readiness probe reported it. */
    missing;
    constructor(message, source, missing = []) {
        super(message);
        this.name = 'SourceUnavailableError';
        this.source = source;
        this.missing = missing;
    }
}
//# sourceMappingURL=unavailable.js.map