/**
 * Shared helpers for the dsh-web-search-pro plugin (published bundle).
 * Dependencies (js-yaml, node-html-parser) are normal npm imports; playwright
 * resolves from the global npm root or config playwright.modulePath.
 * @module dsh-web-search-pro/util
 */
/** js-yaml parser (npm dep). */
export declare const jsYaml: {
    load(input: string): unknown;
};
/**
 * Parse an HTML document into a queryable DOM.
 *
 * Deliberately NOT jsdom: jsdom depends on whatwg-url -> tr46, whose
 * `require('punycode/')` cannot be routed by dsh 0.1.7's CJS resolution
 * router (the router derives search paths from `createRequire().resolve.paths`,
 * which reports builtin-shadowed names as unresolvable), so any plugin
 * importing jsdom fails to load on dsh 0.1.7-rc.2. node-html-parser has a
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
    allowProxyFakeIp?: boolean;
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
