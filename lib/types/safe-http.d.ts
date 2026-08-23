export interface ResolvePublicUrlOptions {
    /** Trust Clash/TUN fake-IP DNS ranges. Literal fake-IP URLs remain blocked. */
    allowProxyFakeIp?: boolean;
    /** Test seam; production callers use node:dns/promises lookup. */
    lookup?: (hostname: string) => Promise<{
        address: string;
        family?: number;
    }[]>;
}
export declare function assertSafePublicUrl(raw: string | URL): URL;
export declare function assertResolvedPublicUrl(raw: string | URL, options?: ResolvePublicUrlOptions): Promise<URL>;
export declare function readBoundedBody(response: Response, maxBytes: number): Promise<Buffer>;
export declare function stripSensitiveHeadersForRedirect(headers: Record<string, string>, from: URL, to: URL): Record<string, string>;
