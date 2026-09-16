/**
 * Enhanced page fetch pipeline (agent-reach Jina reader + userscript-style
 * extraction + playwright fallback), with page snapshot persistence.
 * @module web-search-pro/fetch
 */
import type { Store } from './store.ts';
import type { ResolvedConfig } from './config.ts';
import type { BrowserService } from './browser-service.ts';
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
    /** True when the page is a navigation/JS/form shell with no extractable data. */
    shellPage?: boolean;
}
/**
 * Heuristic: a "shell" page looks like text but is really navigation — search
 * forms, "look elsewhere" pointers, JS-only stubs. Signals: very little prose,
 * a high link-to-text ratio, or explicit form/redirect phrasing. Returning true
 * lets the tool tell the model to fetch one of the pointed-at URLs instead of
 * re-fetching the same kind of page in a loop (P1-3).
 */
export declare function detectShellPage(text: string): boolean;
/** Validate and normalize a URL for fetching. */
export declare function normalizeUrl(raw: string): string;
/** All rules: user (DB) first, then built-ins; user rules win on ties. */
export declare function mergedRules(store: Store): ExtractRule[];
export declare class FetchService {
    private readonly store;
    private readonly config;
    private readonly browser;
    private readonly memory;
    constructor(store: Store, config: ResolvedConfig | (() => ResolvedConfig), browser: BrowserService);
    private cfg;
    fetchPage(url: string, opts: FetchOptions): Promise<FetchResult>;
    private fetchJina;
    private fetchHttp;
    private fetchPlaywright;
}
