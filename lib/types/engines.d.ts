/**
 * Search engine backends for web-search-pro. Each engine is a plain object
 * with { id, label, available(), search(query, count, signal) }. Routing,
 * caching, and persistence live in router.ts.
 * @module web-search-pro/engines
 */
import type { WebSearchSource, WebRuntime } from '@deepseek-ai/dsh-web';
import { runCli } from './util.ts';
import type { BrowserService } from './browser-service.ts';
import { type BrowserMethod } from './browser-access.ts';
import type { CustomPlatformSpec } from './config.ts';
import { type ExaSearchRequest } from './exa-client.ts';
export interface SearchOutcome {
    /** Provider-generated answer/summary text, when any. */
    content?: string;
    sources: WebSearchSource[];
}
export interface Engine {
    id: string;
    label: string;
    /** Cheap local availability check; must not do network I/O. */
    available(): boolean;
    /** Browser-service method this engine depends on (dsh-browser is optional). */
    needsBrowser?: BrowserMethod;
    search(query: string, count: number, signal?: AbortSignal, options?: EngineSearchOptions): Promise<SearchOutcome>;
}
export interface EngineSearchOptions {
    exa?: Omit<ExaSearchRequest, 'query' | 'numResults'>;
    /** Bocha native request fields compiled from hard constraints (pipeline/compile.ts). */
    bocha?: {
        freshness?: string;
        include?: string[];
        exclude?: string[];
    };
    /** Lower bound of the publication date (ISO 8601), compiled from a hard time_window; the engine maps it to its native filter. */
    since?: string;
    /** Domain lists compiled from hard site / exclude_site constraints (keyed sources that take them as request fields). */
    sites?: {
        include?: string[];
        exclude?: string[];
    };
    /** Task language (`zh` / `en`) for engines with per-language editions or zones (Wikipedia, AnySearch); absent = detect from the query. */
    lang?: 'zh' | 'en';
    browser?: {
        authProfile?: string;
        rulePack?: string;
    };
}
export declare class EngineError extends Error {
    readonly code: string;
    readonly retryable: boolean;
    readonly retryAfterMs?: number | undefined;
    /** `retryAfterMs`: the service's own wait hint (Retry-After); the router uses it as the cooldown. */
    constructor(message: string, code: string, retryable?: boolean, retryAfterMs?: number | undefined);
}
/** One metered request of a non-model provider (Bocha search): counted in the usage ledger, tokens n/a, price unknown. */
export interface UsageRecorder {
    record(entry: {
        provider: string;
        protocol: string;
        requests: number;
        note?: string;
    }): void;
}
export interface EngineDeps {
    web?: WebRuntime;
    exaApiKey?: string;
    jinaApiKey?: string;
    /** Bocha web-search key (config bochaApiKey / credentials ref / $BOCHA_SEARCH_API_KEY, then the Jev key of the same account). */
    bochaApiKey?: string;
    /** Bocha endpoint base, default https://api.bochaai.com. */
    bochaBaseUrl?: string;
    /** Ask Bocha for its longer per-page summary (default true). */
    bochaSummary?: boolean;
    /** Records requests of metered non-model providers in the usage ledger (best effort, never throws). */
    usage?: UsageRecorder;
    /** Test seam: replaces the global fetch of API clients that accept one. */
    fetchImpl?: typeof fetch;
    /** Test seam: replaces the DNS lookup of the SSRF check. */
    lookup?: (hostname: string) => Promise<{
        address: string;
        family?: number;
    }[]>;
    /** API keys of the keyed sources by route id (`tavily`, `brave`, ...): config literal -> credentials ref -> environment (router). */
    sourceKeys?: Readonly<Record<string, string>>;
    /** Base URL overrides of the keyed sources by route id (settings `keyedSources.<id>.baseUrl`). */
    sourceBaseUrls?: Readonly<Record<string, string>>;
    /** Self-hosted SearXNG instance (settings `searxngUrl`); no default public instance exists. */
    searxngUrl?: string;
    /** Contact address appended to the User-Agent of OpenAlex requests (settings `openalexMailto`). */
    openalexMailto?: string;
    /** Optional free keys of the anonymous APIs (credentials / environment); they raise limits, nothing needs them. */
    openalexApiKey?: string;
    semanticScholarApiKey?: string;
    anysearchApiKey?: string;
    /** GitHub API token (config githubToken / $GITHUB_TOKEN / $GH_TOKEN). */
    githubToken?: string;
    enableCli: boolean;
    opencliEnabled: boolean;
    agentReachEnabled: boolean;
    allowProxyFakeIp: boolean;
    /** Browser service (dsh-browser, optional) for Playwright platform search + bundled opencli; resolved per call. */
    browser?: BrowserService;
    /** Per-platform selector overrides (settings.yaml `platformRules`). */
    platformRules?: Record<string, {
        item: string;
        title: string;
        link: string;
        text?: string;
    }>;
    /** User-defined custom platforms (settings.yaml `customPlatforms`). */
    customPlatforms?: Record<string, CustomPlatformSpec>;
    /** True when this call originates from the ctx.web provider (avoid seam recursion). */
    skipSeam: boolean;
}
export declare function seamEngine(deps: EngineDeps): Engine;
/** Parse mcporter's human-readable Exa response into the router's native source shape. */
export declare function parseMcporterExaSearch(output: string, count: number): WebSearchSource[];
export declare function exaEngine(deps: EngineDeps): Engine;
/**
 * Parse DDG html.duckduckgo.com result HTML into sources.
 *
 * Two passes on purpose: a single regex combining the result anchor with an
 * *optional* snippet group behind a lazy bridge silently never captures
 * snippets (the optional group backtracks to an empty match before the lazy
 * bridge is allowed to expand). Slicing each block first, then extracting the
 * snippet inside the block, avoids that trap entirely.
 */
export declare function parseDdgHtml(html: string, count?: number): WebSearchSource[];
export declare function ddgEngine(allowProxyFakeIp?: boolean): Engine;
export declare function bingEngine(allowProxyFakeIp?: boolean): Engine;
/** Parse RSS/Atom XML into sources (used by bing engine and rss platform). */
export declare function parseRss(xml: string, count?: number): WebSearchSource[];
export declare function jinaSearchEngine(deps: EngineDeps): Engine;
export declare function githubEngine(deps: EngineDeps): Engine;
export declare function githubCodeEngine(deps: EngineDeps): Engine;
export declare function githubIssuesEngine(deps: EngineDeps): Engine;
export declare function bilibiliEngine(deps: EngineDeps): Engine;
/** Exact argv contract supported by public-clis/bilibili-cli v0.6.2+. */
export declare function biliSearchArgs(query: string, count: number): string[];
/** Parse and validate bili-cli's versioned JSON envelope. */
export declare function parseBilibiliSearchOutput(output: string): WebSearchSource[];
export declare function v2exEngine(allowProxyFakeIp?: boolean): Engine;
export declare function youtubeEngine(deps: EngineDeps, cli?: typeof runCli): Engine;
export declare function opencliEngine(platform: string, deps: EngineDeps): Engine;
export declare function agentReachEngine(platform: string, deps: EngineDeps): Engine;
export declare function arxivEngine(allowProxyFakeIp?: boolean): Engine;
export declare function pubmedEngine(allowProxyFakeIp?: boolean): Engine;
export declare function customPlatformEngine(id: string, spec: CustomPlatformSpec, deps: EngineDeps): Engine;
export declare function playwrightPlatformEngine(platform: string, deps: EngineDeps): Engine;
export declare function rssEngine(url: string, allowProxyFakeIp?: boolean): Engine;
/** Build the ordered engine list for a platform search. */
export declare function platformEngines(platform: string, deps: EngineDeps): Engine[];
export declare const PLATFORM_IDS: readonly ["github", "github-code", "github-issues", "bilibili", "youtube", "v2ex", "xiaohongshu", "twitter", "reddit", "instagram", "facebook", "rss", "zhihu", "weibo", "douban", "tieba", "douyin", "kuaishou", "arxiv", "pubmed"];
/** Whether web_platform_search may route this built-in or configured custom id. */
export declare function isPlatformSupported(platform: string, customPlatforms?: Record<string, CustomPlatformSpec>): boolean;
