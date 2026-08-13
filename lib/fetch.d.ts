/**
 * Enhanced page fetch pipeline (agent-reach Jina reader + userscript-style
 * extraction + playwright fallback), with page snapshot persistence.
 * @module web-search-pro/fetch
 */
import type { Store } from './store.ts';
import type { ResolvedConfig } from './config.ts';
import type { PlaywrightManager } from './playwright.ts';
import type { ExtractRule } from './extract.ts';
export type FetchMode = 'auto' | 'jina' | 'http' | 'playwright';
export interface FetchOptions {
    mode: FetchMode;
    signal: AbortSignal | undefined;
    maxChars: number;
    fresh: boolean;
    persist: boolean;
}
export interface FetchResult {
    url: string;
    title?: string;
    text: string;
    source: string;
    fromCache: boolean;
    statusCode?: number;
    usedRule?: string;
}
/** Validate and normalize a URL for fetching. */
export declare function normalizeUrl(raw: string): string;
/** All rules: user (DB) first, then built-ins; user rules win on ties. */
export declare function mergedRules(store: Store): ExtractRule[];
export declare class FetchService {
    private readonly store;
    private readonly config;
    private readonly pw;
    private readonly memory;
    constructor(store: Store, config: ResolvedConfig | (() => ResolvedConfig), pw: PlaywrightManager);
    private cfg;
    fetchPage(url: string, opts: FetchOptions): Promise<FetchResult>;
    private fetchJina;
    private fetchHttp;
    private fetchPlaywright;
}
