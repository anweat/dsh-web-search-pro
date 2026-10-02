/**
 * Stack Exchange (Stack Overflow) question search, anonymous. Contract source: https://api.stackexchange.com/docs
 * (`/2.3/search/advanced`: `q`, `site`, `order`, `sort`, `pagesize`, `fromdate`, `filter`; the response wrapper
 * `items`, `has_more`, `quota_max`, `quota_remaining`, `backoff`; failures `error_id` / `error_name` / `error_message`;
 * every response is gzip-compressed, which the HTTP client decodes).
 *
 * Throttling (https://api.stackexchange.com/docs/throttle): a `backoff` field means "do not call this method again
 * for that many seconds" — honoured here before the next request; an exhausted anonymous quota answers a
 * `throttle_violation` that names the wait in its message. Both are remembered per process (engines are created per call).
 * @module web-search-pro/providers/stackexchange
 */
import type { WebSearchSource } from '@deepseek-ai/dsh-web';
import { EngineError, type Engine, type EngineDeps } from '../engines.ts';
import { Blocker } from './http.ts';
import type { ProviderAdapter, ProviderDescriptor } from './registry.ts';
export declare const STACKEXCHANGE_ROUTE_ID = "stackexchange";
export declare const STACKEXCHANGE_USAGE_PROVIDER = "stackexchange";
export declare const STACKEXCHANGE_SITE = "stackoverflow";
/** One process-wide block state: `backoff` and quota messages apply to every later call. */
export declare const stackExchangeBlock: Blocker;
export interface StackExchangeItem {
    title?: string;
    link?: string;
    body?: string;
    score?: number;
    answer_count?: number;
    is_answered?: boolean;
    accepted_answer_id?: number;
    tags?: string[];
    creation_date?: number;
    last_activity_date?: number;
    question_id?: number;
}
export interface StackExchangeWrapper {
    items?: StackExchangeItem[];
    has_more?: boolean;
    quota_max?: number;
    quota_remaining?: number;
    backoff?: number;
    error_id?: number;
    error_name?: string;
    error_message?: string;
}
export declare function stackExchangeUrl(query: string, count: number, since?: string): string;
/** Items -> sources: HTML-decoded title, the question text (tags, answers, score first) as the snippet. */
export declare function mapStackExchange(items: readonly StackExchangeItem[], count: number): WebSearchSource[];
/** Seconds named by a throttle message ("more requests available in 74268 seconds"). */
export declare function throttleSeconds(message: string | undefined): number | undefined;
/** An error wrapper (HTTP 400 / 502 with `error_id`) as the engine error contract; throttle violations are remembered. */
export declare function stackExchangeFailure(status: number, headers: Headers, body: unknown): EngineError;
/** Parse a 2xx wrapper: a `backoff` is stored for the next call, no items is ENGINE_EMPTY. */
export declare function parseStackExchange(body: unknown, count: number): WebSearchSource[];
export declare function stackExchangeEngine(deps: EngineDeps): Engine;
export declare const STACKEXCHANGE_DESCRIPTOR: ProviderDescriptor;
export declare const stackExchangeAdapter: ProviderAdapter;
