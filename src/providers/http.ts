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

import { EngineError, type EngineDeps } from '../engines.ts'
import { httpGet } from '../util.ts'
import { parseRetryAfter } from './bocha.ts'

export { parseRetryAfter }

/** Polite, descriptive User-Agent with a project URL as contact (Wikimedia / OpenAlex etiquette). */
export const PROVIDER_USER_AGENT = 'dsh-web-search-pro/0.1 (+https://github.com/anweat/dsh-web-search-pro; polite API client)'
const TIMEOUT_MS = 30_000
const MAX_BODY_BYTES = 4 * 1024 * 1024

export interface ProviderResponse {
  status: number
  ok: boolean
  headers: Headers
  /** Parsed JSON body; undefined when the body is not JSON. */
  json: unknown
  /** Raw body. Adapters must not copy it into errors or logs (use `safeDetail`). */
  text: string
}

export interface ProviderRequest {
  deps: EngineDeps
  signal?: AbortSignal | undefined
  headers?: Record<string, string>
  method?: 'GET' | 'POST'
  body?: string
  userAgent?: string
  timeoutMs?: number
}

/** Messages of errors thrown by the SSRF checks (util / safe-http): deterministic, so not worth a cooldown. */
const SSRF = /private or local network|public addresses|only public HTTP|URL is not valid|credentials are not allowed/i

/** One request through the safe HTTP path; transport problems become coded EngineErrors, HTTP statuses are returned to the caller. */
export async function requestProvider(label: string, url: string, req: ProviderRequest): Promise<ProviderResponse> {
  try {
    const res = await httpGet(url, {
      signal: req.signal,
      timeoutMs: req.timeoutMs ?? TIMEOUT_MS,
      maxBytes: MAX_BODY_BYTES,
      allowProxyFakeIp: req.deps.allowProxyFakeIp,
      ...req.method ? { method: req.method } : {},
      ...req.body !== undefined ? { body: req.body } : {},
      ...req.deps.fetchImpl ? { fetchImpl: req.deps.fetchImpl } : {},
      ...req.deps.lookup ? { lookup: req.deps.lookup } : {},
      headers: { 'user-agent': req.userAgent ?? PROVIDER_USER_AGENT, 'accept': 'application/json', 'accept-language': 'en;q=0.9, zh;q=0.8', ...req.headers },
    })
    let json: unknown
    try { json = JSON.parse(res.text) } catch { json = undefined }
    return { status: res.status, ok: res.ok, headers: res.headers ?? new Headers(), json, text: res.text }
  } catch (error) {
    if (req.signal?.aborted) throw error
    const message = error instanceof Error ? error.message : String(error)
    if (/timed out/i.test(message)) throw new EngineError(label + ' timed out', 'ENGINE_TIMEOUT', true)
    if (SSRF.test(message)) throw new EngineError(label + ' request refused: ' + safeDetail(message), 'ENGINE_UNAVAILABLE', false)
    throw new EngineError(label + ' request failed: ' + safeDetail(message), 'ENGINE_ERROR', true)
  }
}

const CREDENTIAL_PAIR = /\b(?:api[_-]?key|apikey|password|passwd|username|user|token|secret|authorization|bearer)\b\s*[=:]\s*\S+/gi
const LONG_TOKEN = /\b[A-Za-z0-9_\-]{28,}\b/g

/** Text from a response that is safe to show: credential-looking values removed, one line, capped. */
export function safeDetail(text: unknown, max = 160): string {
  if (typeof text !== 'string') return ''
  return text.replace(CREDENTIAL_PAIR, '[redacted]').replace(LONG_TOKEN, '[redacted]').replace(/\s+/g, ' ').trim().slice(0, max)
}

/** Seconds-valued headers (`X-RateLimit-Reset`) as milliseconds. */
export function secondsHeaderMs(value: string | null | undefined): number | undefined {
  if (!value || !/^\d+(?:\.\d+)?$/.test(value.trim())) return undefined
  return Math.round(Number(value) * 1000)
}

/** The shared status -> EngineError mapping. `detail` must already be safe (see `safeDetail`). */
export function statusFailure(label: string, status: number, headers: Headers, detail?: string): EngineError {
  const tail = detail ? ': ' + detail : ''
  if (status === 429) {
    const wait = parseRetryAfter(headers.get('retry-after'))
    return new EngineError(label + ' rate limit (HTTP 429' + tail + (wait !== undefined ? '; retry after ' + Math.ceil(wait / 1000) + 's' : '') + ')', 'ENGINE_RATE_LIMIT', true, wait)
  }
  if (status === 401 || status === 403) return new EngineError(label + ' rejected the request as unauthorised (HTTP ' + status + tail + ')', 'ENGINE_AUTH', false)
  if (status === 402) return new EngineError(label + ': quota_exhausted (HTTP 402)', 'ENGINE_QUOTA', false)
  if (status === 400 || status === 404 || status === 422) return new EngineError(label + ' rejected the request (HTTP ' + status + tail + ')', 'ENGINE_ERROR', false)
  return new EngineError(label + ' API error (HTTP ' + status + tail + ')', 'ENGINE_ERROR', true)
}

/** Count one request of an anonymous API in the usage ledger (requests only: tokens n/a, no price). Best effort. */
export function recordRequest(deps: EngineDeps, provider: string): void {
  try { deps.usage?.record({ provider, protocol: 'search', requests: 1, note: 'tokens n/a, free tier' }) } catch { /* the ledger is advisory */ }
}

/** `YYYY-MM-DD` of an ISO timestamp. */
export const isoDay = (iso: string): string => iso.slice(0, 10)

/** Short per-provider block state: while a service said "wait" or "quota used up", do not ask again (module-level: engines are created per call). */
export class Blocker {
  private until = 0
  private code: 'ENGINE_RATE_LIMIT' | 'ENGINE_QUOTA' = 'ENGINE_RATE_LIMIT'
  private message = ''
  constructor(private readonly now: () => number = Date.now) {}
  block(ms: number, code: 'ENGINE_RATE_LIMIT' | 'ENGINE_QUOTA', message: string): void {
    this.until = Math.max(this.until, this.now() + Math.max(ms, 0))
    this.code = code
    this.message = message
  }
  /** Throws when a block is active. A quota block is not retryable (no cooldown); a wait carries the remaining time. */
  check(label: string): void {
    const left = this.until - this.now()
    if (left <= 0) return
    if (this.code === 'ENGINE_QUOTA') throw new EngineError(label + ': ' + this.message + ' (not asking again for ' + Math.ceil(left / 1000) + 's)', 'ENGINE_QUOTA', false)
    throw new EngineError(label + ': ' + this.message + ' (waiting ' + Math.ceil(left / 1000) + 's)', 'ENGINE_RATE_LIMIT', true, left)
  }
  reset(): void { this.until = 0 }
}
