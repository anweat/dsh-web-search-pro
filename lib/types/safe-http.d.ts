export interface ResolvePublicUrlOptions {
    /** Trust Clash/TUN fake-IP DNS ranges. Literal fake-IP URLs remain blocked. */
    allowProxyFakeIp?: boolean;
    /** Test seam; production callers use node:dns/promises lookup. */
    lookup?: (hostname: string) => Promise<{
        address: string;
        family?: number;
    }[]>;
    /**
     * One exact origin (`http://127.0.0.1:5000`) that skips the private-network checks: the address the user typed into a setting
     * for a service of their own. Nothing else is relaxed: the scheme and credential rules apply, any other URL (a redirect
     * included) is judged as usual, and the origin must match exactly (scheme, host, port).
     */
    allowOrigin?: string;
}
/** Whether `url` is on the one origin the caller was explicitly allowed to reach (an invalid allowance matches nothing). */
export declare function isAllowedOrigin(url: URL, allowOrigin: string | undefined): boolean;
export declare function assertSafePublicUrl(raw: string | URL, allowOrigin?: string): URL;
export declare function assertResolvedPublicUrl(raw: string | URL, options?: ResolvePublicUrlOptions): Promise<URL>;
export declare function readBoundedBody(response: Response, maxBytes: number): Promise<Buffer>;
export declare function stripSensitiveHeadersForRedirect(headers: Record<string, string>, from: URL, to: URL): Record<string, string>;
