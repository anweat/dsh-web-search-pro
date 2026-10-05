/**
 * OpenAlex works search (academic), anonymous. Contract source: https://help.openalex.org/ (llms.txt index):
 * `GET https://api.openalex.org/works?search=…&per_page=…&select=…` (`select` takes root-level fields only),
 * `filter=from_publication_date:YYYY-MM-DD`, abstracts as `abstract_inverted_index` ({word: [positions]}),
 * 400 for a bad request, 429 when the daily budget or 100 requests/second is exceeded; every response has
 * `X-RateLimit-Remaining` / `X-RateLimit-Reset` (seconds until midnight UTC). Keyless use draws a small budget;
 * a free key (`OPENALEX_API_KEY`, sent as a bearer token, never in the URL) raises it tenfold.
 *
 * The documentation no longer describes a `mailto` polite pool: the configured contact address (`openalexMailto`)
 * is put in the User-Agent instead, which is plain etiquette and never breaks a request.
 * @module web-search-pro/providers/openalex
 */
import type { WebSearchSource } from '@deepseek-ai/dsh-web';
import { EngineError, type Engine, type EngineDeps } from '../engines.ts';
import { Blocker } from './http.ts';
import type { ProviderAdapter, ProviderDescriptor } from './registry.ts';
export declare const OPENALEX_ROUTE_ID = "openalex";
export declare const OPENALEX_USAGE_PROVIDER = "openalex";
export declare const OPENALEX_KEY_ENV = "OPENALEX_API_KEY";
export declare const openAlexBlock: Blocker;
export interface OpenAlexWork {
    id?: string;
    doi?: string | null;
    display_name?: string | null;
    title?: string | null;
    publication_year?: number | null;
    publication_date?: string | null;
    cited_by_count?: number | null;
    type?: string | null;
    abstract_inverted_index?: Record<string, number[]> | null;
    primary_location?: {
        landing_page_url?: string | null;
        source?: {
            display_name?: string | null;
        } | null;
    } | null;
}
export declare function openAlexUrl(query: string, count: number, since?: string): string;
/** Rebuild the abstract text from the inverted index (`{word: [positions]}`); empty when absent or malformed. */
export declare function reconstructAbstract(index: Record<string, number[]> | null | undefined): string;
/** Works -> sources: the DOI URL, else the landing page, else the OpenAlex id; snippet = venue, year, citations, abstract. */
export declare function mapOpenAlex(works: readonly OpenAlexWork[], count: number): WebSearchSource[];
export declare function parseOpenAlex(body: unknown, count: number): WebSearchSource[];
/** 429 with no budget left is the daily budget (not a burst): not retryable, remembered until the reset; otherwise the shared mapping. */
export declare function openAlexFailure(status: number, headers: Headers, body: unknown): EngineError;
export declare function openAlexEngine(deps: EngineDeps): Engine;
export declare const OPENALEX_DESCRIPTOR: ProviderDescriptor;
export declare const openAlexAdapter: ProviderAdapter;
