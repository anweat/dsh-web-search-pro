/**
 * Bocha web search (https://open.bochaai.com): a Chinese-strong, key-based search API.
 *
 * Contract sources (nothing here is guessed): the MIT reference provider
 * `bocha-ai/dsh-web-search-bocha` (src/provider.ts, src/types.ts, README) for the request
 * body, `data.webPages.value[]` mapping and error envelope; the documented request fields
 * `include` / `exclude` (domains separated by `|` or `,`, at most 100) from Bocha's web-search
 * parameter docs; and ONE live call (2026-10-02) that returned HTTP 403
 * `{"message":"You do not have enough money or package quota","log_id":"...","code":"403"}`
 * (test/fixtures/bocha-quota-403.json): note `code` is a STRING there. A successful live
 * response has not been recorded, so the success mapping and the `include` / `exclude` / date-range
 * request fields are verified only against the reference and its docs (descriptor `verification.live = false`).
 *
 * `POST {base}/v1/web-search`, `Authorization: Bearer <key>`, body
 * `{ query, freshness?, summary?, count?, include?, exclude? }`.
 * @module web-search-pro/providers/bocha
 */
import type { WebSearchSource } from '@deepseek-ai/dsh-web';
import { EngineError, type Engine, type EngineDeps, type EngineSearchOptions } from '../engines.ts';
import type { ProviderAdapter, ProviderDescriptor } from './registry.ts';
export declare const BOCHA_ROUTE_ID = "bocha";
export declare const BOCHA_DEFAULT_BASE_URL = "https://api.bochaai.com";
export declare const BOCHA_PATH = "/v1/web-search";
/** Credentials ref / environment variable of the search key. */
export declare const BOCHA_KEY_ENV = "BOCHA_SEARCH_API_KEY";
/** Bocha documents one account key for Jev and search: the Jev name is the documented fallback. */
export declare const BOCHA_FALLBACK_KEY_ENV = "BOCHA_JEV_API_KEY";
/** Provider name of the usage ledger rows (requests counted, tokens n/a, price unknown). */
export declare const BOCHA_USAGE_PROVIDER = "bocha-search";
export declare const BOCHA_MAX_COUNT = 50;
export declare const BOCHA_MAX_SITES = 100;
/** Request body of `POST /v1/web-search` (optional fields are omitted when unset). */
export interface BochaRequestBody {
    query: string;
    count: number;
    summary: boolean;
    freshness?: string;
    include?: string;
    exclude?: string;
}
/** One entry of `webPages.value[]`. */
export interface BochaWebPage {
    name?: string | null;
    url?: string | null;
    snippet?: string | null;
    summary?: string | null;
    siteName?: string | null;
    datePublished?: string | null;
    dateLastCrawled?: string | null;
}
/** Domains as Bocha's `include` / `exclude` take them: valid hostnames only, deduplicated, at most 100, `|`-joined. */
export declare function joinSites(sites: readonly string[] | undefined): string | undefined;
export declare function bochaRequestBody(query: string, count: number, summary: boolean, native: EngineSearchOptions['bocha'] | undefined): BochaRequestBody;
/** Map `webPages.value[]` entries to sources: summary preferred over the short snippet; entries without an http(s) URL dropped. */
export declare function mapBochaPages(pages: readonly BochaWebPage[], count: number): WebSearchSource[];
/** `Retry-After` as milliseconds (delta-seconds or an HTTP date); undefined when absent or unusable. */
export declare function parseRetryAfter(value: string | null | undefined, now?: number): number | undefined;
/**
 * Map a failed answer to the engine error contract. 401 / 403: not retryable and no cooldown (a wait does not help):
 * `ENGINE_AUTH`, or `ENGINE_QUOTA` when the service says the account has no balance or package (the live 403 does).
 * 429: `ENGINE_RATE_LIMIT`, retryable, carrying Retry-After as the cooldown. 5xx and anything else: retryable `ENGINE_ERROR`.
 */
export declare function bochaFailure(status: number, body: unknown, retryAfter?: string | null): EngineError;
/** Parse a 2xx body: provider-declared failures inside the envelope throw, an empty list is ENGINE_EMPTY. */
export declare function parseBochaResponse(body: unknown, count: number): WebSearchSource[];
export declare function bochaEngine(deps: EngineDeps): Engine;
export declare const BOCHA_DESCRIPTOR: ProviderDescriptor;
export declare const bochaAdapter: ProviderAdapter;
