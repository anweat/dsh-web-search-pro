/**
 * Bump when the search-result shape or parser changes so stale cached rows
 * (e.g. ddg results saved before the snippet-regex fix) stop being replayed.
 * Store.cleanupLegacyCacheKeys() purges rows whose key no longer matches this
 * version on startup.
 */
export declare const SEARCH_CACHE_VERSION = 4;
export interface SearchCacheInput {
    query: string;
    engines: readonly string[];
    count: number;
    multi: boolean;
    exa?: Record<string, unknown>;
}
export interface PlatformCacheInput {
    platform: string;
    query: string;
    url?: string;
    count: number;
    authProfile?: string;
    rulePack?: string;
}
export declare function createSearchCacheKey(input: SearchCacheInput): string;
/** True when a persisted cache key was minted with the current search version. */
export declare function isCurrentSearchCacheKey(key: string): boolean;
export declare function createPlatformCacheKey(input: PlatformCacheInput): string;
