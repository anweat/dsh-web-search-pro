export declare function assertSafePublicUrl(raw: string | URL): URL;
export declare function assertResolvedPublicUrl(raw: string | URL): Promise<URL>;
export declare function readBoundedBody(response: Response, maxBytes: number): Promise<Buffer>;
export declare function stripSensitiveHeadersForRedirect(headers: Record<string, string>, from: URL, to: URL): Record<string, string>;
