/**
 * Plugin configuration (schemastery) and the resolved runtime shape.
 * @module web-search-pro/config
 */
import z from '@deepseek-ai/schemastery';
/** A user-defined custom platform: search URL template + result selectors + optional login cookie. */
export interface CustomPlatformSpec {
    name: string;
    /** Search-page URL template; `{query}` is replaced with the URL-encoded query. */
    url: string;
    item: string;
    title: string;
    link: string;
    text?: string;
    /** Optional raw Cookie header (`a=b; c=d`); cookies are applied to the URL's domain. */
    cookie?: string;
}
export interface Config {
    /** SQLite database path; defaults to $DSH_HOME/data/web-search-pro/store.db */
    dbPath?: string;
    /** Cache freshness window in seconds. */
    ttlSeconds: number;
    /** In-process LRU entry cap (hot queries resolve without touching SQLite). */
    memoryCacheEntries: number;
    /** Reciprocal Rank Fusion constant for multi-engine merging. */
    rrfConstant: number;
    /** Max recency bonus added to a source's fusion score (0..1). */
    freshnessBoost: number;
    /** Days over which the recency bonus decays to zero. */
    freshnessDays: number;
    /** Max authority-domain bonus added to a source's fusion score (0..1). */
    authorityBoost: number;
    /** Extra authority domains (beyond the built-in .edu/.gov/.org and the curated list). */
    authorityDomains: string[];
    /** Default cap on returned sources per search. */
    searchMaxResults: number;
    /** Cooperative per-call timeout budget in ms. */
    timeoutMs: number;
    /** Ordered engine list for web_search_pro. */
    engines: string[];
    /** Query all requested engines in parallel and merge. */
    parallelEngines: boolean;
    /** Exa API key (falls back to $EXA_API_KEY / credentials ref). */
    exaApiKey?: string;
    /** Credential/env reference for the Exa key; defaults to EXA_API_KEY. */
    exaApiKeyEnv?: string;
    /** Jina AI API key (falls back to $JINA_API_KEY / credentials ref). */
    jinaApiKey?: string;
    /** Credential/env reference for the Jina key; defaults to JINA_API_KEY. */
    jinaApiKeyEnv?: string;
    /** Allow CLI backends (gh / bili / yt-dlp / opencli / agent-reach). */
    enableCliBackends: boolean;
    /** Allow opencli browser-session backends. */
    opencliEnabled: boolean;
    /** Allow agent-reach backends. */
    agentReachEnabled: boolean;
    /** Provider id registered into ctx.web for the built-in web_search tool. */
    providerId: string;
    /** Register the ctx.web provider (set DSH_WEB_SEARCH_PROVIDER to use it). */
    registerProvider: boolean;
    /** Per-platform search-page selector overrides (item/title/link/text). Overrides built-in specs. */
    platformRules?: Record<string, {
        item: string;
        title: string;
        link: string;
        text?: string;
    }>;
    /** User-defined custom platform search: url template + selectors + optional cookie. */
    customPlatforms?: Record<string, CustomPlatformSpec>;
    /** Snapshot options. The browser runtime itself (channel/headless/storageStatePath) is provided by the dsh-browser plugin via the `browser` service. */
    playwright: {
        /** Gate the playwright fallback backend in web_fetch_pro. */
        enabled: boolean;
        /** Directory for web_snapshot artifacts; defaults to <dbDir>/snapshots. */
        snapshotDir?: string;
    };
    verbose: boolean;
}
export declare const Config: z<Config>;
export interface ResolvedConfig extends Config {
    dbPath: string;
    exaApiKey?: string;
    exaApiKeyEnv: string;
    jinaApiKey?: string;
    jinaApiKeyEnv: string;
    playwright: Required<Pick<Config['playwright'], 'enabled' | 'snapshotDir'>>;
}
/** Default database path under the harness home. */
export declare function defaultDbPath(): string;
/** Resolve a fully-defaulted config from user input. */
export declare function resolveConfig(config: Config): ResolvedConfig;
