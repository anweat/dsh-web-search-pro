/**
 * Shared helpers for the dsh-web-search-pro plugin (published bundle).
 * Dependencies (js-yaml, node-html-parser) are normal npm imports; playwright
 * resolves from the global npm root or config playwright.modulePath.
 * @module dsh-web-search-pro/util
 */
import { type ResolvePublicUrlOptions } from './safe-http.ts';
/** js-yaml parser (npm dep). */
export declare const jsYaml: {
    load(input: string): unknown;
};
/**
 * Parse an HTML document into a queryable DOM.
 *
 * Deliberately NOT jsdom: jsdom depends on whatwg-url -> tr46, whose
 * `require('punycode/')` cannot be routed by the Host's CJS resolution
 * router (the router derives search paths from `createRequire().resolve.paths`,
 * which reports builtin-shadowed names as unresolvable; observed on dsh
 * 0.1.7-rc.2), so a plugin importing jsdom can fail to load. node-html-parser has a
 * tiny dependency tree (entities + css-select) with no such require.
 *
 * The returned object mimics the small slice of the DOM API the extractor
 * uses: `document.querySelector(All)`, `document.body`, `document.title`,
 * `nodeType`, `tagName`, `childNodes`, `textContent`, `getAttribute`, `remove`.
 * @param html - raw HTML source.
 * @returns a document-like root node.
 */
export declare function parseDocument(html: string): {
    title: string;
    body: any;
    querySelector(sel: string): any;
    querySelectorAll(sel: string): any[];
};
/** Resolve the playwright module: explicit config path first, then the global npm root. */
export declare function resolvePlaywright(modulePath?: string): any;
/** npm root -g, computed once. */
export declare function globalNpmRoot(): string;
export declare function uid(): string;
export declare function sha1(input: string): string;
/** Normalize a query for cache keys: collapse whitespace, lowercase. */
export declare function normQuery(query: string): string;
export declare function userAgent(): string;
export interface HttpResult {
    status: number;
    ok: boolean;
    text: string;
    finalUrl: string;
    contentType?: string;
    /** Response headers of the final answer (Retry-After and rate-limit headers for API clients). */
    headers?: Headers;
}
/**
 * One HTTP request (GET by default) with UA spoofing, cooperative timeout,
 * and abort forwarding. Supports method/body for API POSTs.
 */
export declare function httpGet(url: string, opts?: {
    headers?: Record<string, string>;
    signal: AbortSignal | undefined;
    timeoutMs?: number;
    redirect?: 'follow' | 'error';
    method?: string;
    body?: string;
    maxBytes?: number;
    allowProxyFakeIp?: boolean; /** Test seams: replace the global fetch and the DNS lookup. */
    fetchImpl?: typeof fetch;
    lookup?: ResolvePublicUrlOptions['lookup'];
}): Promise<HttpResult>;
/** Decode bytes honoring charset; UTF-8 first with GBK fallback on garbage. */
export declare function decodeText(buf: Buffer, contentType?: string): string;
/** Decode common HTML entities in a string. */
export declare function htmlDecode(input: string): string;
/** Strip HTML tags (used for titles / snippets inside already-scoped strings). */
export declare function stripTags(input: string): string;
export interface CliResult {
    code: number;
    stdout: string;
    stderr: string;
    timedOut: boolean;
}
/**
 * Run an external CLI (opencli / bili / yt-dlp / agent-reach / npm).
 * cross-spawn resolves Windows cmd wrappers without interpolating argv into a
 * shell command line, preserving argument boundaries and metacharacters.
 */
export declare function runCli(bin: string, args: string[], opts?: {
    timeoutMs?: number;
    signal: AbortSignal | undefined;
    env?: Record<string, string>;
    cwd?: string;
    maxOutput?: number;
    outputEncoding?: string;
}): Promise<CliResult>;
/** Extract the first URL from a DuckDuckGo / Google style redirect parameter. */
export declare function decodeRedirectUrl(href: string): string;
/** Cap a string to maxChars while keeping whole lines near the boundary. */
export declare function capText(text: string, maxChars: number): string;
/** Max snippet length returned to callers, whichever path produced the sources. */
export declare const SNIPPET_MAX_CHARS = 500;
/**
 * Single output shaping for search sources (live, SQLite hit, platform):
 * slice to `count`, cap snippets, drop empty optional fields.
 */
export declare function shapeSources(sources: readonly {
    url: string;
    title?: string | null;
    snippet?: string | null;
    publishedAt?: string | null;
    lowConfidence?: boolean;
}[], count: number): {
    url: string;
    title?: string;
    snippet?: string;
    publishedAt?: string;
    lowConfidence?: true;
}[];
