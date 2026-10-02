/**
 * HTTP transport shared by every judge protocol: bounded retries (429 / 503 /
 * 529 / network), a hard request cap, deadline and abort handling, the API key
 * only in the Authorization header, and usage metering (reserve before each
 * attempt, settle after). Behaviour is that of the original Jev client.
 * @module web-search-pro/pipeline/judges/http
 */
import type { UsageMeter } from './types.ts';
export declare const sleepMs: (ms: number) => Promise<void>;
export declare function parseRetryAfter(value: string | null, now?: number): number | undefined;
export interface HttpOptions {
    url: string;
    /** Bearer token; absent = no Authorization header (local servers). */
    apiKey?: string | undefined;
    /** Extra request headers (after content-type / authorization). */
    headers?: Record<string, string> | undefined;
    /** Name used in error messages (`Jev`, the provider id). */
    label: string;
    fetchImpl: typeof fetch;
    sleep: (ms: number) => Promise<void>;
    timeoutMs: number;
    maxRetries: number;
    /** Hard cap on HTTP attempts (retries and splits included). */
    requestCap?: number | undefined;
    meter?: UsageMeter | undefined;
    /** Longest wait between retries (default 10 s). */
    maxRetryWaitMs?: number | undefined;
    /** Error thrown when the request cap is reached (default: a fatal JudgeError). */
    capError?: ((cap: number) => Error) | undefined;
}
export interface HttpCallContext {
    signal?: AbortSignal | undefined;
    deadline?: number | undefined;
}
export interface PostOptions {
    /** Estimated input tokens of this request (reserved before the call). */
    estimatedInputTokens: number;
    /** Reads the actual token counts out of a successful response. */
    usageOf: (json: any) => {
        input?: number | undefined;
        output?: number | undefined;
    };
}
export interface PostResult {
    json: any;
    inputTokens: number;
    outputTokens: number;
    estimated: boolean; /** Wall time of the successful attempt. */
    latencyMs: number;
}
export declare class JudgeHttp {
    private readonly opt;
    /** HTTP attempts made so far (retries and splits included). */
    requests: number;
    constructor(opt: HttpOptions);
    /** Input tokens the meter would still let this scorer reserve (Infinity without a meter). */
    headroom(): number;
    /** POST `body` with bounded retries; 401 / 403 are fatal, other statuses fail the request. */
    post(body: string, ctx: HttpCallContext, post: PostOptions): Promise<PostResult>;
    private wait;
}
