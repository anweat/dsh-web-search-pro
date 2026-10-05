/**
 * Linkup Search (keyed, English / overseas). Contract sources: https://docs.linkup.so/pages/documentation/endpoints/search/reference
 * (the `/search` reference), https://docs.linkup.so/pages/documentation/platform/errors.md and
 * https://docs.linkup.so/pages/documentation/platform/rate-limits.md (fetched 2026-10-03). Not linkupapi.com.
 *
 * `POST https://api.linkup.so/v1/search`, `Authorization: Bearer <key>`, JSON body: `q`, `depth` (`flash` | `fast` |
 * `standard` | `deep`; `fast` is the documented recommended default), `outputType`, `maxResults`, `includeDomains`
 * (<= 100), `excludeDomains`, `fromDate` / `toDate` (YYYY-MM-DD), `includeImages`. ONLY `outputType: "searchResults"` is used:
 * ranked `results[]` of `{ type: "text", name, url, content, favicon }` (image entries are skipped). `sourcedAnswer` / `structured`
 * outputs are generated answers and are never requested or treated as sources.
 * Errors: `{ statusCode, error: { code, message, details[] } }` — 400, 401, 402 (x402 payment: the adapter only sends its key and never pays), 403,
 * 429 ("insufficient credit or excessive concurrent requests"), 500, 504. Rate limit: 10 queries per second per organisation.
 *
 * Ambiguous / left out: a 429 does not say in the status which of its two causes applies, so the message decides
 * (credit wording => `ENGINE_QUOTA` not retryable, otherwise a retryable rate limit); no Retry-After is documented;
 * the credit cost per depth is not documented.
 * @module web-search-pro/providers/linkup
 */
import type { WebSearchSource } from '@deepseek-ai/dsh-web';
import { EngineError } from '../engines.ts';
export declare const LINKUP_ROUTE_ID = "linkup";
export declare const LINKUP_BASE = "https://api.linkup.so";
export declare const LINKUP_PATH = "/v1/search";
export declare const LINKUP_MAX_INCLUDE = 100;
export declare const LINKUP_MAX_COUNT = 50;
export interface LinkupBody {
    q: string;
    depth: 'fast';
    outputType: 'searchResults';
    maxResults: number;
    includeImages: false;
    includeDomains?: string[];
    excludeDomains?: string[];
    fromDate?: string;
}
export declare function linkupBody(query: string, count: number, options?: {
    sites?: {
        include?: string[];
        exclude?: string[];
    };
    since?: string;
}): LinkupBody;
export declare function mapLinkup(results: readonly unknown[], count: number): WebSearchSource[];
export declare function parseLinkup(json: unknown, count: number): WebSearchSource[];
export declare function linkupFailure(status: number, headers: Headers, json: unknown): EngineError;
export declare const LINKUP_DESCRIPTOR: import("./registry.ts").ProviderDescriptor;
export declare const linkupAdapter: import("./registry.ts").ProviderAdapter;
