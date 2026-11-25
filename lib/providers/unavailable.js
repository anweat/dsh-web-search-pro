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
/**
 * A platform that ran and failed (login wall, captcha, drift, block, network, timeout). Unlike {@link SourceUnavailableError}
 * it did not fail its local readiness check: the search itself went wrong, and the message carries the reason and the remedy.
 * The action layer keeps ACTION_FAILED and tells the model not to repeat the same platform search.
 */
export class PlatformFailedError extends Error {
    /** Route id(s) of the platform(s) that failed. */
    platforms;
    constructor(message, platforms) {
        super(message);
        this.name = 'PlatformFailedError';
        this.platforms = platforms;
    }
}
//# sourceMappingURL=unavailable.js.map