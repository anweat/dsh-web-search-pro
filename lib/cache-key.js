import crypto from 'node:crypto';
/**
 * Bump when the search-result shape or parser changes so stale cached rows
 * (e.g. ddg results saved before the snippet-regex fix) stop being replayed.
 * Store.cleanupLegacyCacheKeys() purges rows whose key no longer matches this
 * version on startup.
 */
export const SEARCH_CACHE_VERSION = 4;
function canonical(value) {
    if (Array.isArray(value))
        return value.map(canonical);
    if (value && typeof value === 'object') {
        return Object.fromEntries(Object.entries(value)
            .filter(([, v]) => v !== undefined)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([k, v]) => [k, canonical(v)]));
    }
    return value;
}
function fingerprint(kind, version, input) {
    return kind + ':v' + version + ':' + crypto.createHash('sha256').update(JSON.stringify(canonical(input))).digest('hex');
}
export function createSearchCacheKey(input) {
    const { count: _count, ...stable } = input;
    return fingerprint('search', SEARCH_CACHE_VERSION, { ...stable, query: input.query.trim().replace(/\s+/g, ' ').toLowerCase() });
}
/** True when a persisted cache key was minted with the current search version. */
export function isCurrentSearchCacheKey(key) {
    return key.startsWith('search:v' + SEARCH_CACHE_VERSION + ':');
}
export function createPlatformCacheKey(input) {
    const { count: _count, ...stable } = input;
    return fingerprint('platform', 1, { ...stable, query: input.query.trim().replace(/\s+/g, ' ').toLowerCase() });
}
//# sourceMappingURL=cache-key.js.map