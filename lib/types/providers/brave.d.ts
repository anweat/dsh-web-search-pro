/**
 * Brave Search API (keyed, English / general; its own independent index). Contract sources: the official
 * documentation https://api-dashboard.search.brave.com/app/documentation/web-search/query and the API reference
 * https://api-dashboard.search.brave.com/api-reference/web/search/get, the rate-limit guide
 * https://api-dashboard.search.brave.com/documentation/guides/rate-limiting (all fetched 2026-10-03).
 *
 * `GET https://api.search.brave.com/res/v1/web/search?q=…`, header `X-Subscription-Token: <key>`. Parameters used:
 * `q`, `count` (1-20), `freshness` (`YYYY-MM-DDtoYYYY-MM-DD`), `result_filter=web`, `text_decorations=false`. `q` supports the operators
 * `"phrase"`, `-term` and `site:` (documented), which carry the site / exclude constraints. 200: `web.results[]` of
 * `{ title, url, description, page_age?, language?, extra_snippets? }`. Rate limits: response headers
 * `X-RateLimit-Limit|Policy|Remaining|Reset`, each a comma-separated pair (per-second window, then the monthly quota);
 * a 429 means a window is spent and "only successful requests are counted".
 *
 * Ambiguous / left out: the documented query limit differs between the API reference (600 characters, 75 words) and
 * other Brave material (400 / 50), so the query is cut to the smaller (400 / 50); the error BODY shape and the exact
 * 401 / 403 / 422 semantics are not documented on the pages read (the status mapping is the generic one);
 * `country`, `search_lang` (default `en`; the code for Chinese is not confirmed), `extra_snippets` (plan dependent),
 * `goggles`, `summary` are not sent.
 * @module web-search-pro/providers/brave
 */
import type { WebSearchSource } from '@deepseek-ai/dsh-web';
import { EngineError } from '../engines.ts';
export declare const BRAVE_ROUTE_ID = "brave";
export declare const BRAVE_BASE = "https://api.search.brave.com";
export declare const BRAVE_PATH = "/res/v1/web/search";
export declare const BRAVE_MAX_COUNT = 20;
export declare const BRAVE_QUERY_CHARS = 400;
export declare const BRAVE_QUERY_WORDS = 50;
/** Brave's date-range form of `freshness`: `YYYY-MM-DDtoYYYY-MM-DD`. */
export declare const braveFreshness: (since: string, now?: Date) => string;
export declare function braveParams(query: string, count: number, since: string | undefined, now?: Date): Record<string, string>;
export declare function mapBrave(results: readonly unknown[], count: number): WebSearchSource[];
export declare function parseBrave(json: unknown, count: number): WebSearchSource[];
/**
 * 429: when the second (monthly) `X-RateLimit-Remaining` value is 0 the plan quota is spent (`ENGINE_QUOTA`, no cooldown);
 * otherwise the per-second window is full and the first `X-RateLimit-Reset` value (seconds) is the cooldown. Retry-After wins when sent.
 */
export declare function braveFailure(status: number, headers: Headers, json: unknown): EngineError;
export declare const BRAVE_DESCRIPTOR: import("./registry.ts").ProviderDescriptor;
export declare const braveAdapter: import("./registry.ts").ProviderAdapter;
