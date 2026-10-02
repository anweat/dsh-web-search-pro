/**
 * AnySearch web search, anonymous tier. Contract source: https://anysearch.com/docs/api-endpoints/v1-search and
 * /docs/auth: `POST https://api.anysearch.com/v1/search` with JSON `{ query, max_results (1-10), zone: cn|intl,
 * language, tag?, params?, format? }`; success `{ code: 0, message, request_id, data: { results: [{ title, url,
 * snippet?, content? }], metadata } }`; no Authorization header = anonymous, limited per client IP and by a daily
 * free quota; an invalid key is never silently downgraded to anonymous (401 / 403).
 *
 * CREDENTIAL SAFETY. When an anonymous caller exceeds the daily quota the service answers HTTP 402 whose
 * `message` carries an auto-generated username, password and api_key. That body is never read into an error,
 * log, ledger row or output: a 402 becomes the standard `quota_exhausted` (ENGINE_QUOTA, not retryable) and the
 * adapter stops asking for a while (each further anonymous 402 may register yet another account). Any other
 * error text goes through `safeDetail`, which also redacts credential-looking values.
 * @module web-search-pro/providers/anysearch
 */
import type { WebSearchSource } from '@deepseek-ai/dsh-web';
import { EngineError, type Engine, type EngineDeps } from '../engines.ts';
import { Blocker } from './http.ts';
import type { ProviderAdapter, ProviderDescriptor } from './registry.ts';
export declare const ANYSEARCH_ROUTE_ID = "anysearch";
export declare const ANYSEARCH_USAGE_PROVIDER = "anysearch";
export declare const ANYSEARCH_KEY_ENV = "ANYSEARCH_API_KEY";
export declare const ANYSEARCH_URL = "https://api.anysearch.com/v1/search";
export declare const ANYSEARCH_MAX_RESULTS = 10;
/** After a quota 402 do not ask again for this long (anonymous 402s may mint accounts). */
export declare const ANYSEARCH_QUOTA_BLOCK_MS: number;
export declare const anySearchBlock: Blocker;
export interface AnySearchResult {
    title?: string | null;
    url?: string | null;
    snippet?: string | null;
    content?: string | null;
}
export interface AnySearchBody {
    query: string;
    max_results: number;
    zone: 'cn' | 'intl';
    language: string;
}
export declare function anySearchBody(query: string, count: number, lang?: 'zh' | 'en'): AnySearchBody;
export declare function mapAnySearch(results: readonly AnySearchResult[], count: number): WebSearchSource[];
/** Parse a 2xx envelope: a non-zero `code` is a failure, no results is ENGINE_EMPTY. */
export declare function parseAnySearch(body: unknown, count: number): WebSearchSource[];
/**
 * Failure mapping. 402 is handled WITHOUT touching the body (it may hold generated credentials): `quota_exhausted`.
 * For other statuses only a redacted `message` is shown.
 */
export declare function anySearchFailure(status: number, headers: Headers, body: unknown): EngineError;
export declare function anySearchEngine(deps: EngineDeps): Engine;
export declare const ANYSEARCH_DESCRIPTOR: ProviderDescriptor;
export declare const anySearchAdapter: ProviderAdapter;
