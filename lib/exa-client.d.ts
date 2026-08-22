export type ExaSearchType = 'instant' | 'fast' | 'auto' | 'deep-lite' | 'deep' | 'deep-reasoning';
export interface ExaSearchRequest {
    query: string;
    numResults?: number;
    type?: ExaSearchType;
    includeDomains?: string[];
    excludeDomains?: string[];
    startPublishedDate?: string;
    endPublishedDate?: string;
    category?: string;
    userLocation?: string;
    moderation?: boolean;
}
export interface ExaResult {
    url: string;
    title?: string;
    text?: string;
    publishedDate?: string;
    highlights?: string[];
}
export declare class ExaClient {
    private readonly apiKey;
    private readonly fetchImpl;
    constructor(options: {
        apiKey: string;
        fetch?: typeof fetch;
    });
    toString(): string;
    private post;
    search(request: ExaSearchRequest, signal?: AbortSignal): Promise<ExaResult[]>;
    contents(urls: string[], signal?: AbortSignal): Promise<ExaResult[]>;
}
