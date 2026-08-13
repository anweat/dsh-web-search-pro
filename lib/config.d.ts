/**
 * Plugin configuration (schemastery) and the resolved runtime shape.
 * @module web-search-pro/config
 */
import z from '@deepseek-ai/schemastery';
export interface Config {
    /** SQLite database path; defaults to $DSH_HOME/data/web-search-pro/store.db */
    dbPath?: string;
    /** Cache freshness window in seconds. */
    ttlSeconds: number;
    /** In-process LRU entry cap (hot queries resolve without touching SQLite). */
    memoryCacheEntries: number;
    /** Reciprocal Rank Fusion constant for multi-engine merging. */
    rrfConstant: number;
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
    /** Playwright rendering options. */
    playwright: {
        enabled: boolean;
        headless: boolean;
        /** 'chromium' | 'msedge' */
        channel: string;
        /** Path to a Playwright storageState JSON (persisted login state). */
        storageStatePath?: string;
        /** Explicit playwright module path (defaults to global npm root). */
        modulePath?: string;
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
    playwright: Required<Pick<Config['playwright'], 'enabled' | 'headless' | 'channel' | 'snapshotDir'>> & {
        storageStatePath?: string;
        modulePath?: string;
    };
}
/** Default database path under the harness home. */
export declare function defaultDbPath(): string;
/** Resolve a fully-defaulted config from user input. */
export declare function resolveConfig(config: Config): ResolvedConfig;
