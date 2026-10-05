/**
 * HTTP transport shared by every judge protocol: bounded retries (429 / 503 /
 * 529 / network), a hard request cap, deadline and abort handling, the API key
 * only in the Authorization header, and usage metering (reserve before each
 * attempt, settle after). Behaviour is that of the original Jev client.
 * @module web-search-pro/pipeline/judges/http
 */
import { JudgeError } from "./errors.js";
const RETRY_STATUSES = new Set([429, 503, 529]);
const MAX_RETRY_WAIT_MS = 10_000;
export const sleepMs = (ms) => new Promise(resolve => setTimeout(resolve, ms));
export function parseRetryAfter(value, now = Date.now()) {
    if (!value)
        return undefined;
    const seconds = Number(value);
    if (Number.isFinite(seconds))
        return Math.max(0, seconds * 1000);
    const date = Date.parse(value);
    return Number.isFinite(date) ? Math.max(0, date - now) : undefined;
}
const finite = (n) => (typeof n === 'number' && Number.isFinite(n) ? n : undefined);
export class JudgeHttp {
    opt;
    /** HTTP attempts made so far (retries and splits included). */
    requests = 0;
    constructor(opt) {
        this.opt = opt;
    }
    /** Input tokens the meter would still let this scorer reserve (Infinity without a meter). */
    headroom() { return this.opt.meter?.headroom() ?? Infinity; }
    /** POST `body` with bounded retries; 401 / 403 are fatal, other statuses fail the request. */
    async post(body, ctx, post) {
        const { opt } = this;
        for (let attempt = 0;; attempt++) {
            if (opt.requestCap !== undefined && this.requests >= opt.requestCap)
                throw opt.capError?.(opt.requestCap) ?? new JudgeError(opt.label + ' request cap reached (' + opt.requestCap + ')', undefined, true);
            if (ctx.deadline !== undefined && Date.now() >= ctx.deadline)
                throw new JudgeError(opt.label + ' skipped: deadline reached');
            if (ctx.signal?.aborted)
                throw ctx.signal.reason ?? new DOMException('This operation was aborted', 'AbortError');
            const ticket = opt.meter?.reserve({ inputTokens: post.estimatedInputTokens });
            this.requests++;
            const started = Date.now();
            const signal = ctx.signal ? AbortSignal.any([ctx.signal, AbortSignal.timeout(opt.timeoutMs)]) : AbortSignal.timeout(opt.timeoutMs);
            let res;
            try {
                res = await opt.fetchImpl(opt.url, {
                    method: 'POST',
                    headers: { 'content-type': 'application/json', ...opt.apiKey ? { authorization: 'Bearer ' + opt.apiKey } : {}, ...opt.headers },
                    body,
                    signal,
                });
            }
            catch (error) {
                ticket?.unknown();
                if (ctx.signal?.aborted)
                    throw error;
                if (attempt < opt.maxRetries) {
                    await this.wait(1_000 * 2 ** attempt, ctx);
                    continue;
                }
                throw new JudgeError(opt.label + ' network error: ' + error.message);
            }
            if (res.ok) {
                let json;
                try {
                    json = await res.json();
                }
                catch (error) {
                    ticket?.unknown();
                    throw new JudgeError(opt.label + ' returned an unreadable body: ' + error.message);
                }
                const reported = post.usageOf(json);
                const input = finite(reported.input);
                const output = finite(reported.output);
                const settled = ticket?.settle({ inputTokens: input, outputTokens: output });
                const latencyMs = Date.now() - started;
                return settled
                    ? { json, ...settled, latencyMs }
                    : { json, inputTokens: input ?? 0, outputTokens: output ?? 0, estimated: false, latencyMs };
            }
            ticket?.refused();
            const text = (await res.text().catch(() => '')).slice(0, 300);
            if (RETRY_STATUSES.has(res.status) && attempt < opt.maxRetries) {
                await this.wait(parseRetryAfter(res.headers.get('retry-after')) ?? 1_000 * 2 ** attempt, ctx);
                continue;
            }
            throw new JudgeError(opt.label + ' HTTP ' + res.status + ' ' + text, res.status, res.status === 401 || res.status === 403);
        }
    }
    async wait(ms, ctx) {
        const wait = Math.min(ms, this.opt.maxRetryWaitMs ?? MAX_RETRY_WAIT_MS);
        if (ctx.deadline !== undefined && Date.now() + wait >= ctx.deadline)
            throw new JudgeError(this.opt.label + ' retry would pass the deadline');
        await this.opt.sleep(wait);
    }
}
//# sourceMappingURL=http.js.map