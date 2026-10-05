/**
 * URL canonicalization for candidate merging (design §6.1, dev-plan M2a).
 *
 * The canonical form is a MERGE KEY, not a fetch target: two raw URLs with the
 * same canonical form are treated as the same document. The rules are
 * deliberately conservative. Content parameters (ids, versions, pagination,
 * queries), hash routes, scheme and `www.` are never normalised away, because
 * merging different documents loses evidence while missing a merge only
 * costs a duplicate.
 *
 *  - host lower-cased, trailing dot and default port dropped (WHATWG URL does the latter two);
 *  - fragment dropped, EXCEPT hash routes (`#/path`, `#!/path`), which address
 *    different content on single-page apps;
 *  - tracking parameters removed (documented lists below); all other
 *    parameters are kept and sorted by key (stable for repeated keys);
 *  - percent-escapes upper-cased, trailing slash dropped on non-root paths.
 * @module web-search-pro/pipeline/url
 */
/** Parameter-name prefixes that are tracking by construction. */
export declare const TRACKING_PARAM_PREFIXES: readonly string[];
/** Exact (case-insensitive) parameter names that are tracking or share-attribution only. */
export declare const TRACKING_PARAMS: ReadonlySet<string>;
/** Parameters that are tracking only on specific hosts (name set per host suffix). */
export declare const HOST_TRACKING_PARAMS: readonly {
    host: string;
    params: ReadonlySet<string>;
}[];
/**
 * Whether query parameter `name=value` on `host` is a tracking parameter.
 *
 * Two names are ambiguous and therefore conditional:
 *  - `ref` is tracking except on code forges or when the value looks like a git ref;
 *  - `from` is tracking only with a non-numeric value (`from=search`); a numeric
 *    `from` is an offset/pagination parameter and is kept.
 */
export declare function isTrackingParam(name: string, value: string, host: string): boolean;
/** `#/docs/x` and `#!/docs/x` are client-side routes, not anchors. */
export declare function isHashRoute(hash: string): boolean;
/**
 * Canonical merge key of a URL. Non-http(s) or unparsable input is returned
 * trimmed but otherwise unchanged, so callers can still use it as a key.
 */
export declare function canonicalizeUrl(raw: string): string;
