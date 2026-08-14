/**
 * Search engine backends for web-search-pro. Each engine is a plain object
 * with { id, label, available(), search(query, count, signal) }. Routing,
 * caching, and persistence live in router.ts.
 * @module web-search-pro/engines
 */
import type { WebSearchSource, WebRuntime } from '@deepseek-ai/dsh-web';
import type { BrowserService } from './browser-service.ts';
import type { CustomPlatformSpec } from './config.ts';
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
    search(query: string, count: number, signal?: AbortSignal): Promise<SearchOutcome>;
}
export declare class EngineError extends Error {
    readonly code: string;
    readonly retryable: boolean;
    constructor(message: string, code: string, retryable?: boolean);
}
export interface EngineDeps {
    web?: WebRuntime;
    exaApiKey?: string;
    jinaApiKey?: string;
    enableCli: boolean;
    opencliEnabled: boolean;
    agentReachEnabled: boolean;
    /** Browser service (dsh-browser) for Playwright platform search + bundled opencli. */
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
export declare function exaEngine(deps: EngineDeps): Engine;
export declare function ddgEngine(): Engine;
export declare function bingEngine(): Engine;
/** Parse RSS/Atom XML into sources (used by bing engine and rss platform). */
export declare function parseRss(xml: string, count?: number): WebSearchSource[];
export declare function jinaSearchEngine(deps: EngineDeps): Engine;
export declare function githubEngine(deps: EngineDeps): Engine;
export declare function githubCodeEngine(deps: EngineDeps): Engine;
export declare function githubIssuesEngine(deps: EngineDeps): Engine;
export declare function bilibiliEngine(deps: EngineDeps): Engine;
export declare function v2exEngine(): Engine;
export declare function youtubeEngine(deps: EngineDeps): Engine;
export declare function opencliEngine(platform: string, deps: EngineDeps): Engine;
export declare function agentReachEngine(platform: string, deps: EngineDeps): Engine;
export declare function arxivEngine(): Engine;
export declare function pubmedEngine(): Engine;
export declare function customPlatformEngine(id: string, spec: CustomPlatformSpec, deps: EngineDeps): Engine;
export declare function playwrightPlatformEngine(platform: string, deps: EngineDeps): Engine;
export declare function rssEngine(url: string): Engine;
/** Build the ordered engine list for a platform search. */
export declare function platformEngines(platform: string, deps: EngineDeps): Engine[];
export declare const SEARCH_ENGINE_IDS: readonly ["seam", "exa", "ddg", "bing", "jina", "github", "bilibili", "v2ex", "youtube", "arxiv", "pubmed"];
export declare const PLATFORM_IDS: readonly ["github", "github-code", "github-issues", "bilibili", "youtube", "v2ex", "xiaohongshu", "twitter", "reddit", "instagram", "facebook", "rss", "zhihu", "weibo", "douban", "tieba", "douyin", "kuaishou", "arxiv", "pubmed"];
