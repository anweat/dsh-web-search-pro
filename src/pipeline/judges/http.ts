/**
 * HTTP transport shared by every judge protocol: bounded retries (429 / 503 /
 * 529 / network), a hard request cap, deadline and abort handling, the API key
 * only in the Authorization header, and usage metering (reserve before each
 * attempt, settle after). Behaviour is that of the original Jev client.
 * @module web-search-pro/pipeline/judges/http
 */

import { JudgeError } from './errors.ts'
import type { UsageMeter } from './types.ts'

const RETRY_STATUSES = new Set([429, 503, 529])
const MAX_RETRY_WAIT_MS = 10_000

export const sleepMs = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms))

export function parseRetryAfter(value: string | null, now = Date.now()): number | undefined {
  if (!value) return undefined
  const seconds = Number(value)
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000)
  const date = Date.parse(value)
  return Number.isFinite(date) ? Math.max(0, date - now) : undefined
}

export interface HttpOptions {
  url: string
  /** Bearer token; absent = no Authorization header (local servers). */
  apiKey?: string | undefined
  /** Extra request headers (after content-type / authorization). */
  headers?: Record<string, string> | undefined
  /** Name used in error messages (`Jev`, the provider id). */
  label: string
  fetchImpl: typeof fetch
  sleep: (ms: number) => Promise<void>
  timeoutMs: number
  maxRetries: number
  /** Hard cap on HTTP attempts (retries and splits included). */
  requestCap?: number | undefined
  meter?: UsageMeter | undefined
  /** Longest wait between retries (default 10 s). */
  maxRetryWaitMs?: number | undefined
  /** Error thrown when the request cap is reached (default: a fatal JudgeError). */
  capError?: ((cap: number) => Error) | undefined
}

export interface HttpCallContext { signal?: AbortSignal | undefined; deadline?: number | undefined }

export interface PostOptions {
  /** Estimated input tokens of this request (reserved before the call). */
  estimatedInputTokens: number
  /** Reads the actual token counts out of a successful response. */
  usageOf: (json: any) => { input?: number | undefined; output?: number | undefined }
}

export interface PostResult { json: any; inputTokens: number; outputTokens: number; estimated: boolean; /** Wall time of the successful attempt. */ latencyMs: number }

const finite = (n: unknown): number | undefined => (typeof n === 'number' && Number.isFinite(n) ? n : undefined)

export class JudgeHttp {
  /** HTTP attempts made so far (retries and splits included). */
  requests = 0
  constructor(private readonly opt: HttpOptions) {}

  /** Input tokens the meter would still let this scorer reserve (Infinity without a meter). */
  headroom(): number { return this.opt.meter?.headroom() ?? Infinity }

  /** POST `body` with bounded retries; 401 / 403 are fatal, other statuses fail the request. */
  async post(body: string, ctx: HttpCallContext, post: PostOptions): Promise<PostResult> {
    const { opt } = this
    for (let attempt = 0; ; attempt++) {
      if (opt.requestCap !== undefined && this.requests >= opt.requestCap) throw opt.capError?.(opt.requestCap) ?? new JudgeError(opt.label + ' request cap reached (' + opt.requestCap + ')', undefined, true)
      if (ctx.deadline !== undefined && Date.now() >= ctx.deadline) throw new JudgeError(opt.label + ' skipped: deadline reached')
      if (ctx.signal?.aborted) throw ctx.signal.reason ?? new DOMException('This operation was aborted', 'AbortError')
      const ticket = opt.meter?.reserve({ inputTokens: post.estimatedInputTokens })
      this.requests++
      const started = Date.now()
      const signal = ctx.signal ? AbortSignal.any([ctx.signal, AbortSignal.timeout(opt.timeoutMs)]) : AbortSignal.timeout(opt.timeoutMs)
      let res: Response
      try {
        res = await opt.fetchImpl(opt.url, {
          method: 'POST',
          headers: { 'content-type': 'application/json', ...opt.apiKey ? { authorization: 'Bearer ' + opt.apiKey } : {}, ...opt.headers },
          body,
          signal,
        })
      } catch (error) {
        ticket?.unknown()
        if (ctx.signal?.aborted) throw error
        if (attempt < opt.maxRetries) { await this.wait(1_000 * 2 ** attempt, ctx); continue }
        throw new JudgeError(opt.label + ' network error: ' + (error as Error).message)
      }
      if (res.ok) {
        let json: any
        try {
          json = await res.json()
        } catch (error) {
          ticket?.unknown()
          throw new JudgeError(opt.label + ' returned an unreadable body: ' + (error as Error).message)
        }
        const reported = post.usageOf(json)
        const input = finite(reported.input)
        const output = finite(reported.output)
        const settled = ticket?.settle({ inputTokens: input, outputTokens: output })
        const latencyMs = Date.now() - started
        return settled
          ? { json, ...settled, latencyMs }
          : { json, inputTokens: input ?? 0, outputTokens: output ?? 0, estimated: false, latencyMs }
      }
      ticket?.refused()
      const text = (await res.text().catch(() => '')).slice(0, 300)
      if (RETRY_STATUSES.has(res.status) && attempt < opt.maxRetries) {
        await this.wait(parseRetryAfter(res.headers.get('retry-after')) ?? 1_000 * 2 ** attempt, ctx)
        continue
      }
      throw new JudgeError(opt.label + ' HTTP ' + res.status + ' ' + text, res.status, res.status === 401 || res.status === 403)
    }
  }

  private async wait(ms: number, ctx: HttpCallContext): Promise<void> {
    const wait = Math.min(ms, this.opt.maxRetryWaitMs ?? MAX_RETRY_WAIT_MS)
    if (ctx.deadline !== undefined && Date.now() + wait >= ctx.deadline) throw new JudgeError(this.opt.label + ' retry would pass the deadline')
    await this.opt.sleep(wait)
  }
}
