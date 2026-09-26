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
    /** Legacy raw Cookie header; prefer a domain-scoped dsh-browser AuthProfile. */
    cookie?: string;
}
export interface BrowserBinding {
    /** Named dsh-browser auth profile. */
    authProfile?: string;
    /** Named dsh-browser enhancement rule pack. */
    rulePack?: string;
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
    /** Trust Clash/TUN fake-IP DNS ranges while retaining all other SSRF checks. */
    allowProxyFakeIp: boolean;
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
    /** GitHub API token for the REST search engines (falls back to $GITHUB_TOKEN / $GH_TOKEN / credentials ref). */
    githubToken?: string;
    /** Credential/env reference for the GitHub token; defaults to GITHUB_TOKEN. */
    githubTokenEnv?: string;
    /** Allow CLI backends (bili / yt-dlp / opencli / agent-reach). */
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
    /** Per-platform binding to domain-scoped dsh-browser auth/rule profiles. */
    browserBindings?: Record<string, BrowserBinding>;
    /** Snapshot options. The browser runtime itself (channel/headless/storageStatePath) is provided by the dsh-browser plugin via the `browser` service. */
    playwright: {
        /** Gate the playwright fallback backend in web_fetch_pro. */
        enabled: boolean;
        /** Directory for web_snapshot artifacts; defaults to <dbDir>/snapshots. */
        snapshotDir?: string;
    };
    verbose: boolean;
}
export declare const Config: z<Schemastery.ObjectS<NoInfer<{
    dbPath: z<string, string, "plain">;
    ttlSeconds: z<number, number, "volatile-defined">;
    memoryCacheEntries: z<number, number, "defined">;
    rrfConstant: z<number, number, "volatile-defined">;
    freshnessBoost: z<number, number, "volatile-defined">;
    freshnessDays: z<number, number, "volatile-defined">;
    authorityBoost: z<number, number, "volatile-defined">;
    authorityDomains: z<NoInfer<string[]>, NoInfer<string[]>, "volatile-defined">;
    searchMaxResults: z<number, number, "volatile-defined">;
    timeoutMs: z<number, number, "defined">;
    allowProxyFakeIp: z<boolean, boolean, "volatile-defined">;
    engines: z<NoInfer<string[]>, NoInfer<string[]>, "volatile-defined">;
    parallelEngines: z<boolean, boolean, "volatile-defined">;
    exaApiKey: z<string, string, "volatile">;
    exaApiKeyEnv: z<string, string, "volatile-defined">;
    jinaApiKey: z<string, string, "volatile">;
    jinaApiKeyEnv: z<string, string, "volatile-defined">;
    githubToken: z<string, string, "volatile">;
    githubTokenEnv: z<string, string, "volatile-defined">;
    enableCliBackends: z<boolean, boolean, "volatile-defined">;
    opencliEnabled: z<boolean, boolean, "volatile-defined">;
    agentReachEnabled: z<boolean, boolean, "volatile-defined">;
    providerId: z<string, string, "defined">;
    registerProvider: z<boolean, boolean, "defined">;
    platformRules: z<NoInfer<import("@deepseek-ai/cosmokit").Dict<{
        item?: string | null | undefined;
        title?: string | null | undefined;
        link?: string | null | undefined;
        text?: string | null | undefined;
    } & import("@deepseek-ai/cosmokit").Dict, string>>, NoInfer<import("@deepseek-ai/cosmokit").Dict<Schemastery.ObjectT<NoInfer<{
        item: z<string, string, "plain">;
        title: z<string, string, "plain">;
        link: z<string, string, "plain">;
        text: z<string, string, "plain">;
    }>>, string>>, "volatile">;
    customPlatforms: z<NoInfer<import("@deepseek-ai/cosmokit").Dict<{
        name?: string | null | undefined;
        url?: string | null | undefined;
        item?: string | null | undefined;
        title?: string | null | undefined;
        link?: string | null | undefined;
        text?: string | null | undefined;
        cookie?: string | null | undefined;
    } & import("@deepseek-ai/cosmokit").Dict, string>>, NoInfer<import("@deepseek-ai/cosmokit").Dict<Schemastery.ObjectT<NoInfer<{
        name: z<string, string, "plain">;
        url: z<string, string, "plain">;
        item: z<string, string, "plain">;
        title: z<string, string, "plain">;
        link: z<string, string, "plain">;
        text: z<string, string, "plain">;
        cookie: z<string, string, "plain">;
    }>>, string>>, "volatile">;
    browserBindings: z<NoInfer<import("@deepseek-ai/cosmokit").Dict<{
        authProfile?: string | null | undefined;
        rulePack?: string | null | undefined;
    } & import("@deepseek-ai/cosmokit").Dict, string>>, NoInfer<import("@deepseek-ai/cosmokit").Dict<Schemastery.ObjectT<NoInfer<{
        authProfile: z<string, string, "plain">;
        rulePack: z<string, string, "plain">;
    }>>, string>>, "volatile">;
    playwright: z<Schemastery.ObjectS<NoInfer<{
        enabled: z<boolean, boolean, "volatile-defined">;
        snapshotDir: z<string, string, "plain">;
    }>>, Schemastery.ObjectT<NoInfer<{
        enabled: z<boolean, boolean, "volatile-defined">;
        snapshotDir: z<string, string, "plain">;
    }>>, "plain">;
    verbose: z<boolean, boolean, "defined">;
}>>, Schemastery.ObjectT<NoInfer<{
    dbPath: z<string, string, "plain">;
    ttlSeconds: z<number, number, "volatile-defined">;
    memoryCacheEntries: z<number, number, "defined">;
    rrfConstant: z<number, number, "volatile-defined">;
    freshnessBoost: z<number, number, "volatile-defined">;
    freshnessDays: z<number, number, "volatile-defined">;
    authorityBoost: z<number, number, "volatile-defined">;
    authorityDomains: z<NoInfer<string[]>, NoInfer<string[]>, "volatile-defined">;
    searchMaxResults: z<number, number, "volatile-defined">;
    timeoutMs: z<number, number, "defined">;
    allowProxyFakeIp: z<boolean, boolean, "volatile-defined">;
    engines: z<NoInfer<string[]>, NoInfer<string[]>, "volatile-defined">;
    parallelEngines: z<boolean, boolean, "volatile-defined">;
    exaApiKey: z<string, string, "volatile">;
    exaApiKeyEnv: z<string, string, "volatile-defined">;
    jinaApiKey: z<string, string, "volatile">;
    jinaApiKeyEnv: z<string, string, "volatile-defined">;
    githubToken: z<string, string, "volatile">;
    githubTokenEnv: z<string, string, "volatile-defined">;
    enableCliBackends: z<boolean, boolean, "volatile-defined">;
    opencliEnabled: z<boolean, boolean, "volatile-defined">;
    agentReachEnabled: z<boolean, boolean, "volatile-defined">;
    providerId: z<string, string, "defined">;
    registerProvider: z<boolean, boolean, "defined">;
    platformRules: z<NoInfer<import("@deepseek-ai/cosmokit").Dict<{
        item?: string | null | undefined;
        title?: string | null | undefined;
        link?: string | null | undefined;
        text?: string | null | undefined;
    } & import("@deepseek-ai/cosmokit").Dict, string>>, NoInfer<import("@deepseek-ai/cosmokit").Dict<Schemastery.ObjectT<NoInfer<{
        item: z<string, string, "plain">;
        title: z<string, string, "plain">;
        link: z<string, string, "plain">;
        text: z<string, string, "plain">;
    }>>, string>>, "volatile">;
    customPlatforms: z<NoInfer<import("@deepseek-ai/cosmokit").Dict<{
        name?: string | null | undefined;
        url?: string | null | undefined;
        item?: string | null | undefined;
        title?: string | null | undefined;
        link?: string | null | undefined;
        text?: string | null | undefined;
        cookie?: string | null | undefined;
    } & import("@deepseek-ai/cosmokit").Dict, string>>, NoInfer<import("@deepseek-ai/cosmokit").Dict<Schemastery.ObjectT<NoInfer<{
        name: z<string, string, "plain">;
        url: z<string, string, "plain">;
        item: z<string, string, "plain">;
        title: z<string, string, "plain">;
        link: z<string, string, "plain">;
        text: z<string, string, "plain">;
        cookie: z<string, string, "plain">;
    }>>, string>>, "volatile">;
    browserBindings: z<NoInfer<import("@deepseek-ai/cosmokit").Dict<{
        authProfile?: string | null | undefined;
        rulePack?: string | null | undefined;
    } & import("@deepseek-ai/cosmokit").Dict, string>>, NoInfer<import("@deepseek-ai/cosmokit").Dict<Schemastery.ObjectT<NoInfer<{
        authProfile: z<string, string, "plain">;
        rulePack: z<string, string, "plain">;
    }>>, string>>, "volatile">;
    playwright: z<Schemastery.ObjectS<NoInfer<{
        enabled: z<boolean, boolean, "volatile-defined">;
        snapshotDir: z<string, string, "plain">;
    }>>, Schemastery.ObjectT<NoInfer<{
        enabled: z<boolean, boolean, "volatile-defined">;
        snapshotDir: z<string, string, "plain">;
    }>>, "plain">;
    verbose: z<boolean, boolean, "defined">;
}>>, "plain">;
export interface ResolvedConfig extends Config {
    dbPath: string;
    exaApiKey?: string;
    exaApiKeyEnv: string;
    jinaApiKey?: string;
    jinaApiKeyEnv: string;
    githubTokenEnv: string;
    playwright: Required<Pick<Config['playwright'], 'enabled' | 'snapshotDir'>>;
}
/** Default database path under the harness home. */
export declare function defaultDbPath(): string;
/** Resolve a fully-defaulted config from user input. Unwraps volatile fields (schemastery `Volatile<T>`) into plain values so consumers never see the wrapper. */
export declare function resolveConfig(config: Config): ResolvedConfig;
