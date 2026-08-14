/**
 * Search orchestration: engine ordering/fallback (agent-reach style routing),
 * optional parallel multi-engine merging, SQLite caching, and persistence.
 * @module web-search-pro/router
 */
import type { Context } from '@deepseek-ai/cordis';
import type { WebSearchRequest, WebSearchResult } from '@deepseek-ai/dsh-web';
import type { Store } from './store.ts';
import type { ResolvedConfig } from './config.ts';
import { LruCache } from './memory-cache.ts';
import type { BrowserService } from './browser-service.ts';
export interface RouterSearchOptions {
    query: string;
    /** Engine ids to try, in order. Defaults to config.engines. */
    engines?: string[];
    count: number;
    /** Bypass the fresh-cache lookup. */
    fresh: boolean;
    /** Run all requested engines in parallel and merge results. */
    multi: boolean;
    signal: AbortSignal | undefined;
    /** True when called from the ctx.web provider (prevents seam recursion). */
    skipSeam?: boolean;
}
export interface RouterSearchResult {
    content?: string;
    sources: {
        url: string;
        title?: string;
        snippet?: string;
        publishedAt?: string;
    }[];
    engine: string;
    enginesTried: string[];
    fromCache: boolean;
}
export declare class SearchRouter {
    private readonly ctx;
    private readonly config;
    private readonly store;
    private readonly dynamic;
    private readonly browser?;
    private readonly memory;
    constructor(ctx: Context, config: ResolvedConfig, store: Store, dynamic?: () => ResolvedConfig, browser?: BrowserService | undefined, memory?: LruCache<RouterSearchResult>);
    /** Resolve a key through credentials first, then process env. */
    private resolveKey;
    private deps;
    /** Sync key check for available() (no credential resolution — env/literal only). */
    private depsSync;
    /** Whether any configured engine is currently usable. */
    anyEngineAvailable(): boolean;
    private build;
    private buildSync;
    /** Run a full search with caching + persistence. */
    search(opts: RouterSearchOptions): Promise<RouterSearchResult>;
    /** Platform search (web_platform_search tool) with the same cache+persist flow. */
    platformSearch(platform: string, query: string, url: string | undefined, count: number, opts: {
        signal?: AbortSignal;
        fresh?: boolean;
    }): Promise<RouterSearchResult>;
    /**
     * ctx.web provider adapter: route the seam request through this router.
     * Returns a WebSearchResult-shaped value for the built-in web_search tool.
     */
    searchAsProvider(request: WebSearchRequest, signal?: AbortSignal): Promise<WebSearchResult>;
}
