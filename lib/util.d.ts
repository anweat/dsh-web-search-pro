/**
 * Shared helpers for the dsh-web-search-pro plugin (published bundle).
 * Dependencies (js-yaml, jsdom) are normal npm imports; playwright resolves
 * from the global npm root or config playwright.modulePath.
 * @module dsh-web-search-pro/util
 */
/** js-yaml parser (npm dep). */
export declare const jsYaml: {
    load(input: string): unknown;
};
/** jsdom constructor (npm dep) for HTML parsing in extraction rules. */
export declare const jsdom: {
    new (html: string, options?: Record<string, unknown>): {
        window: {
            document: any;
        };
    };
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
 * Run an external CLI (opencli / gh / bili / yt-dlp / agent-reach / npm).
 * Windows cmd wrappers are handled via ComSpec.
 */
export declare function runCli(bin: string, args: string[], opts?: {
    timeoutMs?: number;
    signal: AbortSignal | undefined;
    env?: Record<string, string>;
    cwd?: string;
    maxOutput?: number;
}): Promise<CliResult>;
/** Extract the first URL from a DuckDuckGo / Google style redirect parameter. */
export declare function decodeRedirectUrl(href: string): string;
/** Cap a string to maxChars while keeping whole lines near the boundary. */
export declare function capText(text: string, maxChars: number): string;
