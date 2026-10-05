/**
 * Enhanced page fetch pipeline (agent-reach Jina reader + userscript-style
 * extraction + playwright fallback), with page snapshot persistence.
 * @module web-search-pro/fetch
 */
import type { Store } from './store.ts';
import type { ResolvedConfig } from './config.ts';
import type { BrowserService } from './browser-service.ts';
import { type BrowserGetter } from './browser-access.ts';
import type { ExtractRule } from './extract.ts';
export type FetchMode = 'auto' | 'jina' | 'http' | 'playwright';
export interface FetchOptions {
    mode: FetchMode;
    signal: AbortSignal | undefined;
    /** Output cap in characters (clamped to 1000..500000). */
    maxChars: number;
    fresh: boolean;
    persist: boolean;
    /** Continue reading the page text from this character offset (served from the stored snapshot, no refetch). */
    offset?: number;
}
export interface FetchResult {
    url: string;
    title?: string;
    text: string;
    source: string;
    fromCache: boolean;
    statusCode?: number;
    usedRule?: string;
    /** True when the page is not usable content (navigation/JS/form shell, login wall, captcha, error page): see `pageClass`. */
    shellPage?: boolean;
    /** Why the page is not usable content; absent for content. */
    pageClass?: Exclude<PageClass, 'content'>;
    /** Every backend tried, in order, with its quality class (auto mode escalates on shell / js_shell / login_wall). */
    attempts?: FetchAttempt[];
    /** True when `text` stops before the end of the page (cut at maxChars, or the page exceeds the read cap). */
    truncated?: boolean;
    /** Character offset to pass as `offset` to read on; absent when nothing more can be read. */
    nextOffset?: number;
    /** Length of the whole page text; absent when the page was cut at the read cap and the true length is unknown. */
    totalChars?: number;
}
/** Pages are read and stored up to this many characters even when the caller wants less, so `offset` can continue from the snapshot. */
export declare const FETCH_STORE_CHARS = 100000;
/** Largest page text read from a backend. */
export declare const FETCH_HARD_MAX_CHARS = 500000;
/** True when `text` ends with capText()'s truncation marker. */
export declare function isTruncatedText(text: string): boolean;
/**
 * The window `[offset, offset + maxChars)` of a whole stored page result: `text` is that slice, with the
 * truncation marker and `truncated` / `nextOffset` / `totalChars` set only when something lies beyond it.
 */
export declare function sliceFetchResult(full: FetchResult, offset: number, maxChars: number): FetchResult;
/**
 * Heuristic: a "shell" page looks like text but is really navigation — search
 * forms, "look elsewhere" pointers, JS-only stubs. Signals: very little prose,
 * a high link-to-text ratio, or explicit form/redirect phrasing. Returning true
 * lets the tool tell the model to fetch one of the pointed-at URLs instead of
 * re-fetching the same kind of page in a loop (P1-3).
 */
export declare function detectShellPage(text: string): boolean;
/** What one fetch attempt produced: usable content, or why it is not. */
export type PageClass = 'content' | 'shell' | 'login_wall' | 'captcha' | 'js_shell' | 'error';
/** One backend attempt of a fetch, in order (recorded in the result and in the stored fetch detail). */
export interface FetchAttempt {
    source: 'jina' | 'http' | 'playwright';
    class: PageClass;
    chars?: number;
    detail?: string;
}
/**
 * Classify what a backend returned. Never judges by length alone: a short page is a
 * shell only when it also carries shell/login/captcha/JS-required phrasing or is link-dense
 * (so a one-line factual answer stays `content`, M0 C10). `jsHint` is the caller's evidence
 * from the raw HTML (a `<noscript>` block with almost no extracted text).
 */
export declare function classifyPage(text: string, meta?: {
    statusCode?: number;
    jsHint?: boolean;
}): PageClass;
/** Validate and normalize a URL for fetching. */
export declare function normalizeUrl(raw: string): string;
/** All rules: user (DB) first, then built-ins; user rules win on ties. */
export declare function mergedRules(store: Store): ExtractRule[];
export declare class FetchService {
    private readonly store;
    private readonly config;
    private readonly memory;
    /** In-flight de-duplication of identical non-fresh fetches (C3). */
    private readonly flights;
    private readonly getBrowser;
    constructor(store: Store, config: ResolvedConfig | (() => ResolvedConfig), browser?: BrowserService | BrowserGetter);
    private cfg;
    /** True when the optional browser can render right now (enabled in config and the service has render()). */
    private canRender;
    fetchPage(url: string, opts: FetchOptions): Promise<FetchResult>;
    /** Fetch (or serve from cache) the WHOLE page text up to `readCap`; callers slice their window out of it. */
    private runFetch;
    private fetchJina;
    private fetchHttp;
    private fetchPlaywright;
}
