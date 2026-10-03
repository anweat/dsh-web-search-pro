/**
 * Shared plumbing of the keyed ("reserved interface") search sources (dev-plan M7c): Tavily, Brave, Linkup, Serper,
 * Metaso, Zhipu, Baidu Qianfan. Each is a descriptor + adapter in its own file; this module holds what they share:
 *
 *  - the key table: route id -> default environment variable names (the router resolves
 *    config literal `keyedSources.<id>.apiKey` -> credentials ref -> environment into `deps.sourceKeys`);
 *  - one request path (SSRF-safe `requestProvider`, redirects refused so a key never reaches another origin, request
 *    counted in the usage ledger with tokens n/a and no price);
 *  - the common status -> EngineError mapping, consistent with Bocha: 401 / 403 and 402 are not retryable (so no
 *    cooldown), `ENGINE_QUOTA` when the service says the account has no credit or quota, 429 is `ENGINE_RATE_LIMIT`
 *    carrying Retry-After, request errors (400 / 404 / 422) are not retryable, 5xx and the rest are retryable;
 *  - error messages that never contain the key or an unredacted response body (`safeDetail`).
 * A source without a key reports `credential: missing` and is not executable.
 * NO live call has been made to any of these services (no keys): every contract here comes from the documents cited
 * at the top of each adapter and is marked `verification.live = false`.
 * @module web-search-pro/providers/keyed
 */
import type { WebSearchSource } from '@deepseek-ai/dsh-web';
import { EngineError, type Engine, type EngineDeps, type EngineSearchOptions } from '../engines.ts';
import type { CompiledQuery } from '../pipeline/compile.ts';
import type { TaskSpec } from '../pipeline/types.ts';
import { type ProviderResponse } from './http.ts';
import type { ProviderAdapter, ProviderDescriptor } from './registry.ts';
/** Default environment variable names of each keyed source's API key, first one preferred (route id -> names). */
export declare const KEYED_SOURCE_ENVS: Readonly<Record<string, readonly string[]>>;
export declare const KEYED_SOURCE_IDS: readonly string[];
export declare const KEYED_TIMEOUT_MS = 30000;
export declare const SNIPPET_CHARS = 1000;
/** Words that say "the account has no credit / quota / balance" (as opposed to "slow down"). */
export declare const QUOTA_WORDS: RegExp;
/** First usable message of the error envelopes seen across these APIs (`detail.error`, `error.message`, `message`, `msg`, `errMsg`). */
export declare function errorMessage(json: unknown): string;
/** Business error code of an envelope (`error.code`, `code`), as a string; empty when absent. */
export declare function errorCode(json: unknown): string;
/**
 * The shared HTTP-status mapping. `detail` is already safe. A 401 / 403 / 429 whose message says "no credit / quota"
 * is `ENGINE_QUOTA` (not retryable, no cooldown: a wait does not refill a balance); 402 is always quota (payment
 * required: the adapter only ever sends its key, it never pays).
 */
export declare function keyedFailure(label: string, status: number, headers: Headers, detail: string, quota?: boolean): EngineError;
/** `text` trimmed and cut at `SNIPPET_CHARS`; undefined when blank. */
export declare function snippetOf(value: unknown, max?: number): string | undefined;
export declare const textOf: (value: unknown) => string | undefined;
export declare const isHttpUrl: (value: unknown) => value is string;
/** `n` clamped to `[min, max]` as an integer. */
export declare const clamp: (n: number, min: number, max: number) => number;
/** Cut `text` to at most `chars` characters and `words` whitespace-separated words (query limits). */
export declare function limitQuery(text: string, chars: number, words?: number): string;
/** `YYYY-MM-DD` of an ISO timestamp or a Date. */
export declare const dayOf: (iso: string | Date) => string;
export interface KeyedRequest {
    method: 'GET' | 'POST';
    /** GET: the query string parameters (undefined values skipped). */
    params?: Record<string, string | undefined>;
    /** POST: the JSON body. */
    body?: unknown;
    /** Headers carrying the key (and any fixed headers the API wants). */
    headers: (key: string) => Record<string, string>;
}
export interface KeyedSpec {
    /** Route id (`tavily`): also the key of `deps.sourceKeys` and the usage-ledger provider name. */
    route: string;
    label: string;
    defaultBase: string;
    path: string;
    request(query: string, count: number, options: EngineSearchOptions | undefined): KeyedRequest;
    /** Map a non-2xx answer (body already parsed when it was JSON). */
    failure(res: ProviderResponse): EngineError;
    /** Parse a 2xx body: throw `ENGINE_EMPTY` / provider-declared failures. */
    parse(json: unknown, count: number): WebSearchSource[];
}
/** The key of a keyed source in `deps`, undefined when not configured. */
export declare const keyOf: (deps: EngineDeps, route: string) => string | undefined;
export declare function missingKeyMessage(label: string, route: string): string;
export declare function keyedEngine(spec: KeyedSpec, deps: EngineDeps): Engine;
/** Descriptor for a keyed source: web results, search only, metered per request, a key requirement, not verified live. */
export declare function keyedDescriptor(d: Pick<ProviderDescriptor, 'label' | 'languages' | 'regions' | 'supportedFilters'> & Partial<ProviderDescriptor> & {
    route: string;
    costNote: string;
    verificationNote: string;
}): ProviderDescriptor;
export declare function keyedAdapter(descriptor: ProviderDescriptor, spec: Omit<KeyedSpec, 'route' | 'label'>, compile: (task: Pick<TaskSpec, 'goal' | 'query' | 'needs' | 'constraints'>, now: Date) => CompiledQuery): ProviderAdapter;
/** Fail a 2xx body that is not an object. */
export declare function expectObject(label: string, json: unknown): Record<string, unknown>;
export declare function emptyResults(label: string): EngineError;
