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
export declare function createPlatformCacheKey(input: PlatformCacheInput): string;
