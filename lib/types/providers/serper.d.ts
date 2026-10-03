/**
 * Serper (keyed; Google SERP wrapper, `sourceFamily: google`). Contract sources: the request shape and response keys
 * are not published as a public API reference (serper.dev is a product page plus a dashboard playground), so they are
 * taken from MIT reference code that calls the service: LangChain's `GoogleSerperAPIWrapper`
 * (langchain-ai/langchain-community, utilities/google_serper.py) and the `searchsuite` package used by the MIT DSH
 * plugin `yugasun/dsh-plugins` (providers/serper.js), checked 2026-10-03.
 *
 * `POST https://google.serper.dev/search`, header `X-API-KEY: <key>`, JSON body `{ q, num (<= 100), gl?, hl?, tbs? }`.
 * 200: `organic[]` of `{ title, link, snippet, date?, position }`; only `organic` is used (`answerBox` / `knowledgeGraph` are not sources).
 * Site / exclude constraints go in `q` as Google operators (`site:`, `-site:`, `-term`) because the results are Google's.
 *
 * Because every result is Google's, `sourceFamily` is `google`: Serper is never independent corroboration of another Google
 * based source. Ambiguous / left out: the error envelope and its credit exhaustion status are not documented (the shared
 * mapping applies; a message that says "credits" is treated as quota); `gl` / `hl` values for Chinese are not confirmed so
 * they are not sent; `tbs` (Google's date filter string) is not documented by Serper, so a time window stays local.
 * @module web-search-pro/providers/serper
 */
import type { WebSearchSource } from '@deepseek-ai/dsh-web';
import { EngineError } from '../engines.ts';
export declare const SERPER_ROUTE_ID = "serper";
export declare const SERPER_BASE = "https://google.serper.dev";
export declare const SERPER_PATH = "/search";
export declare const SERPER_MAX_RESULTS = 100;
export declare function serperBody(query: string, count: number): {
    q: string;
    num: number;
};
export declare function mapSerper(organic: readonly unknown[], count: number): WebSearchSource[];
export declare function parseSerper(json: unknown, count: number): WebSearchSource[];
export declare function serperFailure(status: number, headers: Headers, json: unknown): EngineError;
export declare const SERPER_DESCRIPTOR: import("./registry.ts").ProviderDescriptor;
export declare const serperAdapter: import("./registry.ts").ProviderAdapter;
