/**
 * DeepSeek Search and Fetch API (https://api-docs.deepseek.com/guides/search/, online since 2026-10-17): the "常用" (common) source of
 * this plugin. Contract: `POST {base}/search` and `POST {base}/fetch`, `Authorization: Bearer <DeepSeek API key>`, JSON; the base is
 * `https://api.deepseek.com/v1/tools`.
 *
 *  - Search request: `query` (1-128 characters, with the operators `site:` `-site:` `-term` `"phrase"` `lang:` `after:` `before:`),
 *    `count` (1-50, default 10), `ori_question` (optional, the caller's original question, at most 128), `localization` (not sent),
 *    `need_content` (default false: `content` stays empty, we never ask for it). Response: `results[]` of `rerank_score` (0-3),
 *    `title`, `url`, `snippet` (about 100-200 characters, for display), `summary` (about 600-800 characters, written for a model),
 *    `content`, `site_name`, `site_icon`, `date` (RFC 3339 or null), `authority` (0-4, -1 unknown). An empty array is "no results".
 *  - Fetch request `url` (at most 8192 characters, http/https, no credentials); response `title` and `content` (Markdown).
 *  - Errors are OpenAI-shaped `{ error: { message, type, param, code } }`: 400, 401, 402 (balance), 403 (Fetch refused by the security
 *    policy), 404 (Fetch could not get usable content), 408, 413, 429, 500, 504. Both APIs are read-only: 408 / 429 / 5xx are retried
 *    after a wait, every other 4xx is not.
 *  - Billing: $0.75 per 1,000 SUCCESSFUL requests, for each endpoint. Only a 200 that yields a result is billed (empty results, failures
 *    and timeouts are not), and `count` does not change the price. Calls made through DeepSeek Harness / Claude Code / Codex server-side
 *    tools are free until 2026-11-01 00:00 Beijing time; the docs do not say whether a plugin calling the API directly is inside that
 *    window, so this plugin treats every call as billed. Limits per account: Search 100 QPS, Fetch 25 QPS plus a per-domain limit.
 *
 * Field mapping: `summary` (else `snippet`) -> `snippet` (the long excerpt the evidence pipeline gates and scores on), `date` ->
 * `publishedAt`, `rerank_score` -> `rerankScore`, `authority` -> `authority` (source metadata; one small fusion signal, fusion.ts).
 * The host's own `deepseek-search-api` provider maps only snippet and date.
 * @module web-search-pro/providers/deepseek
 */
import { EngineError, type Engine, type EngineDeps, type EngineSource } from '../engines.ts';
import { type ProviderResponse } from './http.ts';
import type { ProviderAdapter, ProviderDescriptor } from './registry.ts';
export declare const DEEPSEEK_ROUTE_ID = "deepseek";
export declare const DEEPSEEK_LABEL = "DeepSeek Search";
export declare const DEEPSEEK_DEFAULT_BASE = "https://api.deepseek.com/v1/tools";
export declare const DEEPSEEK_SEARCH_PATH = "/search";
export declare const DEEPSEEK_FETCH_PATH = "/fetch";
export declare const DEEPSEEK_KEY_ENV = "DEEPSEEK_API_KEY";
/** Longest `query` / `ori_question` the API takes, in characters. */
export declare const DEEPSEEK_QUERY_CHARS = 128;
export declare const DEEPSEEK_MAX_COUNT = 50;
export declare const DEEPSEEK_DEFAULT_COUNT = 10;
/** The long excerpt kept per result (the API's `summary` is about 600-800 characters). */
export declare const DEEPSEEK_SNIPPET_CHARS = 1000;
/** Longest URL the Fetch API takes. */
export declare const DEEPSEEK_FETCH_URL_CHARS = 8192;
/** Usage-ledger provider names: requests counted, tokens n/a, price unknown to the plugin. */
export declare const DEEPSEEK_USAGE_SEARCH = "deepseek-search";
export declare const DEEPSEEK_USAGE_FETCH = "deepseek-fetch";
/** One try plus at most two retries of a 408 / 429 / 5xx answer. */
export declare const DEEPSEEK_MAX_ATTEMPTS = 3;
export declare const DEEPSEEK_RETRY_BASE_MS = 800;
/** A wait longer than this (a `Retry-After` of a minute) is not slept through: the failure carries it as the cooldown instead. */
export declare const DEEPSEEK_RETRY_WAIT_CAP_MS = 8000;
export interface FittedQuery {
    query: string;
    cut: boolean;
    from: number;
}
/**
 * The query as the API takes it: whitespace collapsed, at most 128 characters. A longer query keeps every operator token (a
 * `site:` restriction or an exclusion is what the caller asked for) and `OR` between site operators, and loses the tail of the free
 * text, at a word boundary when it has words and by character when it does not (Chinese). The caller says so in the result notes.
 */
export declare function fitQuery(raw: string): FittedQuery;
/** `ori_question`: whitespace collapsed and cut to 128 characters; undefined when nothing remains or it adds nothing to the query. */
export declare function originalQuestion(raw: string | undefined, query: string): string | undefined;
export interface DeepSeekSearchBody {
    query: string;
    count: number;
    need_content: false;
    ori_question?: string;
}
export declare function deepseekSearchBody(query: string, count: number, question?: string): DeepSeekSearchBody;
/** Map `results[]`: summary (else snippet) as the excerpt, date -> publishedAt, rerank_score / authority as metadata. Rows without an http(s) URL are dropped. */
export declare function mapDeepSeekResults(results: readonly unknown[], count: number): EngineSource[];
/** Parse a 2xx Search body; an empty `results` array is ENGINE_EMPTY (the service works, nothing matched, and nothing was billed). */
export declare function parseDeepSeekSearch(json: unknown, count: number): EngineSource[];
/** Statuses the docs say to wait and retry: 408, 429 and 5xx. */
export declare const isRetryableStatus: (status: number) => boolean;
/**
 * The error message of an OpenAI-shaped body, safe to show: the key (should it ever be echoed) and credential-looking values are
 * redacted and the length is capped. The service's `request_id` (what DeepSeek support asks for) is returned apart, so a message can
 * end with it instead of burying the cause.
 */
export declare function errorParts(json: unknown, key: string | undefined): {
    text: string;
    id?: string;
};
/** {@link errorParts} as one string: `message (request_id …)`. */
export declare function detailOf(json: unknown, key: string | undefined): string;
/**
 * Status -> error contract for Search. 401 / 403 are `ENGINE_AUTH`; 402 is `ENGINE_QUOTA` with the balance wording (never retried,
 * no cooldown: waiting does not refill a balance); 429 is `ENGINE_RATE_LIMIT` carrying `Retry-After`; 408 is a retryable
 * `ENGINE_TIMEOUT`; 400 / 404 / 413 are bad requests (not retryable); 5xx is a retryable `ENGINE_ERROR`. Never contains the key.
 */
export declare function deepseekFailure(label: string, status: number, headers: Headers, json: unknown, key?: string): EngineError;
/** Abort-aware wait. */
export declare function defaultSleep(ms: number, signal?: AbortSignal): Promise<void>;
type Transport = Pick<EngineDeps, 'allowProxyFakeIp' | 'fetchImpl' | 'lookup' | 'sleep'>;
/** Wait before retry number `attempt` (1-based): the service's `Retry-After` when it gave one, else 0.8 s, 1.6 s. Undefined = not worth waiting (stop). */
export declare function retryWaitMs(res: Pick<ProviderResponse, 'headers'>, attempt: number): number | undefined;
/**
 * One POST with the documented retry policy: a 408 / 429 / 5xx answer is retried after a wait (at most {@link DEEPSEEK_MAX_ATTEMPTS}
 * tries in all, never longer than {@link DEEPSEEK_RETRY_WAIT_CAP_MS} per wait); every other answer is returned at once. Retries are
 * safe: both APIs are read-only and failed requests are not billed. Returns the final response (which may still be an error).
 */
export declare function postWithRetry(label: string, url: string, key: string, body: unknown, transport: Transport, signal: AbortSignal | undefined): Promise<ProviderResponse>;
export declare function deepseekEngine(deps: EngineDeps): Engine;
/** A Fetch API failure. `code` names what DeepSeek did; none of them describes the TARGET page's own HTTP status. */
export declare class DeepSeekFetchError extends Error {
    readonly code: 'DEEPSEEK_FETCH_DENIED' | 'DEEPSEEK_FETCH_NO_CONTENT' | 'DEEPSEEK_FETCH_AUTH' | 'DEEPSEEK_FETCH_QUOTA' | 'DEEPSEEK_FETCH_RATE_LIMIT' | 'DEEPSEEK_FETCH_ERROR';
    readonly retryable: boolean;
    constructor(message: string, code: 'DEEPSEEK_FETCH_DENIED' | 'DEEPSEEK_FETCH_NO_CONTENT' | 'DEEPSEEK_FETCH_AUTH' | 'DEEPSEEK_FETCH_QUOTA' | 'DEEPSEEK_FETCH_RATE_LIMIT' | 'DEEPSEEK_FETCH_ERROR', retryable?: boolean);
}
/**
 * Status -> error for Fetch. 403 and 404 are DeepSeek's own verdicts (security policy; no usable content), and the message opens by
 * saying so: it is not the target page's HTTP status. The request id comes last.
 */
export declare function deepseekFetchFailure(status: number, headers: Headers, json: unknown, key?: string): DeepSeekFetchError;
export interface DeepSeekFetchAccess extends Transport {
    apiKey: string;
    /** Endpoint base, default {@link DEEPSEEK_DEFAULT_BASE}. */
    baseUrl?: string;
    usage?: EngineDeps['usage'];
}
export interface DeepSeekPage {
    title?: string;
    text: string;
}
/** Read one page as Markdown through the Fetch API. Throws {@link DeepSeekFetchError} (or an EngineError for transport problems). */
export declare function deepseekFetchPage(url: string, access: DeepSeekFetchAccess, signal?: AbortSignal): Promise<DeepSeekPage>;
export declare const DEEPSEEK_DESCRIPTOR: ProviderDescriptor;
export declare const deepseekAdapter: ProviderAdapter;
export {};
