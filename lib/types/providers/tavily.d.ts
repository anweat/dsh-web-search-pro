/**
 * Tavily Search (keyed, English / general research). Contract sources: the official API reference
 * https://docs.tavily.com/documentation/api-reference/endpoint/search (fetched 2026-10-03) and the MIT reference
 * provider `crayonlu/dsh-web-search-tavily` (src/provider.js).
 *
 * `POST https://api.tavily.com/search`, `Authorization: Bearer <key>`, JSON body: `query`, `search_depth` (basic),
 * `max_results` (0-20), `topic`, `include_domains` (<= 300), `exclude_domains` (<= 150), `start_date` / `end_date`
 * (YYYY-MM-DD), `include_published_date`, `include_answer`, `include_raw_content`. 200: `results[]` of
 * `{ title, url, content, score, published_date? }`. Errors (`{ detail: { error } }`): 400, 401, 422, 429 (+ Retry-After),
 * 432 plan limit, 433 pay-as-you-go limit, 500.
 *
 * Only the ranked `results[]` are used: `include_answer` is never requested and `answer` is never read (a generated
 * answer is not a source). Left out because the documentation does not settle them: `country` / `language` (the
 * `country` enum is long and `language` needs `filter_by_language`), `include_usage` (credits are not money), `auto_parameters`.
 * @module web-search-pro/providers/tavily
 */
import type { WebSearchSource } from '@deepseek-ai/dsh-web';
import { EngineError } from '../engines.ts';
export declare const TAVILY_ROUTE_ID = "tavily";
export declare const TAVILY_URL_BASE = "https://api.tavily.com";
export declare const TAVILY_PATH = "/search";
export declare const TAVILY_MAX_RESULTS = 20;
export declare const TAVILY_MAX_INCLUDE = 300;
export declare const TAVILY_MAX_EXCLUDE = 150;
export interface TavilyBody {
    query: string;
    search_depth: 'basic';
    max_results: number;
    topic: 'general';
    include_answer: false;
    include_raw_content: false;
    include_published_date: true;
    include_domains?: string[];
    exclude_domains?: string[];
    start_date?: string;
}
export declare function tavilyBody(query: string, count: number, options?: {
    sites?: {
        include?: string[];
        exclude?: string[];
    };
    since?: string;
}): TavilyBody;
export declare function mapTavily(results: readonly unknown[], count: number): WebSearchSource[];
export declare function parseTavily(json: unknown, count: number): WebSearchSource[];
/** 432 / 433 are Tavily's plan and pay-as-you-go limits: quota, not retryable. Everything else follows the shared mapping. */
export declare function tavilyFailure(status: number, headers: Headers, json: unknown): EngineError;
export declare const TAVILY_DESCRIPTOR: import("./registry.ts").ProviderDescriptor;
export declare const tavilyAdapter: import("./registry.ts").ProviderAdapter;
