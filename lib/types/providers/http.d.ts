/**
 * Shared HTTP for the anonymous API adapters (dev-plan M7b): one SSRF-safe request path (DNS-checked public
 * hosts, redirects re-checked, bounded body, `allowProxyFakeIp` honoured — util.ts `httpGet`), a polite
 * User-Agent, JSON parsing, and the error mapping every adapter shares:
 *
 *  - 401 / 403  -> ENGINE_AUTH, not retryable: a wait does not help, so no cooldown;
 *  - 402        -> ENGINE_QUOTA, not retryable (the service says the free quota is used up);
 *  - 429        -> ENGINE_RATE_LIMIT, retryable, cooldown = Retry-After when sent;
 *  - 400 / 404 / 422 -> ENGINE_ERROR, not retryable (a bad request, not an unhealthy service);
 *  - other 4xx / 5xx / network -> ENGINE_ERROR, retryable; timeouts ENGINE_TIMEOUT;
 *  - an empty result list is ENGINE_EMPTY (the service works), never a failure.
 * Error messages never echo response bodies except through `safeDetail`, which redacts credential-looking values.
 * @module web-search-pro/providers/http
 */
import { EngineError, type EngineDeps } from '../engines.ts';
import { parseRetryAfter } from './bocha.ts';
export { parseRetryAfter };
/** Polite, descriptive User-Agent with a project URL as contact (Wikimedia / OpenAlex etiquette). */
export declare const PROVIDER_USER_AGENT = "dsh-web-search-pro/0.1 (+https://github.com/anweat/dsh-web-search-pro; polite API client)";
export interface ProviderResponse {
    status: number;
    ok: boolean;
    headers: Headers;
    /** Parsed JSON body; undefined when the body is not JSON. */
    json: unknown;
    /** Raw body. Adapters must not copy it into errors or logs (use `safeDetail`). */
    text: string;
}
export interface ProviderRequest {
    deps: EngineDeps;
    signal?: AbortSignal | undefined;
    headers?: Record<string, string>;
    method?: 'GET' | 'POST';
    body?: string;
    userAgent?: string;
    timeoutMs?: number;
    /** `error` = a redirect is a failure (keyed APIs: never forward a key to another origin). Default follows with re-checks. */
    redirect?: 'follow' | 'error';
}
/** One request through the safe HTTP path; transport problems become coded EngineErrors, HTTP statuses are returned to the caller. */
export declare function requestProvider(label: string, url: string, req: ProviderRequest): Promise<ProviderResponse>;
/** Text from a response that is safe to show: credential-looking values removed, one line, capped. */
export declare function safeDetail(text: unknown, max?: number): string;
/** Seconds-valued headers (`X-RateLimit-Reset`) as milliseconds. */
export declare function secondsHeaderMs(value: string | null | undefined): number | undefined;
/** The shared status -> EngineError mapping. `detail` must already be safe (see `safeDetail`). */
export declare function statusFailure(label: string, status: number, headers: Headers, detail?: string): EngineError;
/** Count one request of an anonymous API in the usage ledger (requests only: tokens n/a, no price). Best effort. */
export declare function recordRequest(deps: EngineDeps, provider: string): void;
/** `YYYY-MM-DD` of an ISO timestamp. */
export declare const isoDay: (iso: string) => string;
/** Short per-provider block state: while a service said "wait" or "quota used up", do not ask again (module-level: engines are created per call). */
export declare class Blocker {
    private readonly now;
    private until;
    private code;
    private message;
    constructor(now?: () => number);
    block(ms: number, code: 'ENGINE_RATE_LIMIT' | 'ENGINE_QUOTA', message: string): void;
    /** Throws when a block is active. A quota block is not retryable (no cooldown); a wait carries the remaining time. */
    check(label: string): void;
    reset(): void;
}
