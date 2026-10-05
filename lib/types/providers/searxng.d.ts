/**
 * SearXNG meta-search, ONLY when the user sets `searxngUrl` (no public instance is built in: most disable the JSON
 * format or rate-limit it). Contract source: https://docs.searxng.org/dev/search_api.html — `GET {base}/search?q=…&format=json`
 * (`language`, `pageno`, `time_range`, `categories`); `format=json` must be enabled under `search.formats`, otherwise the
 * instance answers 403; results in `results[]` with `url`, `title`, `content`, `engine`, `publishedDate`.
 *
 * The URL is the user's own configuration (never model input), so a private or loopback address — the normal home of
 * a self-hosted instance — is allowed here, unlike the public-only HTTP path of the other sources. Still enforced:
 * http(s) only, no credentials in the URL, no redirects, bounded body, timeout.
 * @module web-search-pro/providers/searxng
 */
import type { WebSearchSource } from '@deepseek-ai/dsh-web';
import { type Engine, type EngineDeps } from '../engines.ts';
import type { ProviderAdapter, ProviderDescriptor } from './registry.ts';
export declare const SEARXNG_ROUTE_ID = "searxng";
export declare const SEARXNG_USAGE_PROVIDER = "searxng";
export interface SearxngResult {
    url?: string | null;
    title?: string | null;
    content?: string | null;
    engine?: string;
    publishedDate?: string | null;
}
/** The configured base URL as a clean http(s) URL without credentials, trailing slash or query; throws a readable error otherwise. */
export declare function searxngBase(raw: string | undefined): URL;
export declare function searxngUrl(base: URL, query: string, lang?: 'zh' | 'en'): string;
export declare function mapSearxng(results: readonly SearxngResult[], count: number): WebSearchSource[];
export declare function parseSearxng(body: unknown, count: number): WebSearchSource[];
export declare function searxngEngine(deps: EngineDeps): Engine;
export declare const SEARXNG_DESCRIPTOR: ProviderDescriptor;
export declare const searxngAdapter: ProviderAdapter;
