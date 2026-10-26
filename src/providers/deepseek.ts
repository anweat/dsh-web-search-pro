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

import { EngineError, type Engine, type EngineDeps, type EngineSource, type SearchOutcome } from '../engines.ts'
import { compileDeepSeek } from '../pipeline/compile.ts'
import { emptyResults, errorMessage, isHttpUrl, keyOf, missingKeyMessage, snippetOf, textOf } from './keyed.ts'
import { KEYED_SOURCE_ENVS } from './keyed-meta.ts'
import { parseRetryAfter, requestProvider, safeDetail, type ProviderResponse } from './http.ts'
import type { ProviderAdapter, ProviderDescriptor, Readiness } from './registry.ts'

export const DEEPSEEK_ROUTE_ID = 'deepseek'
export const DEEPSEEK_LABEL = 'DeepSeek Search'
export const DEEPSEEK_DEFAULT_BASE = 'https://api.deepseek.com/v1/tools'
export const DEEPSEEK_SEARCH_PATH = '/search'
export const DEEPSEEK_FETCH_PATH = '/fetch'
export const DEEPSEEK_KEY_ENV = 'DEEPSEEK_API_KEY'
/** Longest `query` / `ori_question` the API takes, in characters. */
export const DEEPSEEK_QUERY_CHARS = 128
export const DEEPSEEK_MAX_COUNT = 50
export const DEEPSEEK_DEFAULT_COUNT = 10
/** The long excerpt kept per result (the API's `summary` is about 600-800 characters). */
export const DEEPSEEK_SNIPPET_CHARS = 1_000
/** Longest URL the Fetch API takes. */
export const DEEPSEEK_FETCH_URL_CHARS = 8_192
/** Usage-ledger provider names: requests counted, tokens n/a, price unknown to the plugin. */
export const DEEPSEEK_USAGE_SEARCH = 'deepseek-search'
export const DEEPSEEK_USAGE_FETCH = 'deepseek-fetch'
/** One try plus at most two retries of a 408 / 429 / 5xx answer. */
export const DEEPSEEK_MAX_ATTEMPTS = 3
export const DEEPSEEK_RETRY_BASE_MS = 800
/** A wait longer than this (a `Retry-After` of a minute) is not slept through: the failure carries it as the cooldown instead. */
export const DEEPSEEK_RETRY_WAIT_CAP_MS = 8_000
const TIMEOUT_MS = 30_000

const codePoints = (text: string): number => [...text].length
const cutCodePoints = (text: string, max: number): string => [...text].slice(0, max).join('')

// ── query ───────────────────────────────────────────────────────────────────

/** Tokens the API reads as operators (kept whole when the query has to be cut): `site:`, `-site:`, `after:`, `before:`, `lang:`, `-term`. */
const OPERATOR = /^(?:-\S+|(?:site|after|before|lang):\S+)$/i

export interface FittedQuery { query: string; cut: boolean; from: number }

/**
 * The query as the API takes it: whitespace collapsed, at most 128 characters. A longer query keeps every operator token (a
 * `site:` restriction or an exclusion is what the caller asked for) and `OR` between site operators, and loses the tail of the free
 * text, at a word boundary when it has words and by character when it does not (Chinese). The caller says so in the result notes.
 */
export function fitQuery(raw: string): FittedQuery {
  const text = raw.replace(/\s+/g, ' ').trim()
  const from = codePoints(text)
  if (from <= DEEPSEEK_QUERY_CHARS) return { query: text, cut: false, from }
  const tokens = text.split(' ')
  const keep = tokens.map((t, i) => OPERATOR.test(t) || (t === 'OR' && (/^site:/i.test(tokens[i - 1] ?? '') || /^site:/i.test(tokens[i + 1] ?? ''))))
  const ops = tokens.filter((_, i) => keep[i])
  const free = tokens.filter((_, i) => !keep[i])
  const opsText = ops.join(' ')
  if (codePoints(opsText) >= DEEPSEEK_QUERY_CHARS) return { query: cutCodePoints(text, DEEPSEEK_QUERY_CHARS).trim(), cut: true, from }
  const room = DEEPSEEK_QUERY_CHARS - (ops.length ? codePoints(opsText) + 1 : 0)
  const kept: string[] = []
  let used = 0
  for (const token of free) {
    const need = codePoints(token) + (kept.length ? 1 : 0)
    if (used + need > room) break
    kept.push(token)
    used += need
  }
  let head = kept.join(' ')
  if (!head && free.length) head = cutCodePoints(free[0]!, room) // one long run without spaces (Chinese)
  return { query: [head, opsText].filter(Boolean).join(' ').trim(), cut: true, from }
}

/** `ori_question`: whitespace collapsed and cut to 128 characters; undefined when nothing remains or it adds nothing to the query. */
export function originalQuestion(raw: string | undefined, query: string): string | undefined {
  const text = (raw ?? '').replace(/\s+/g, ' ').trim()
  if (!text || text.toLowerCase() === query.replace(/\s+/g, ' ').trim().toLowerCase()) return undefined
  return cutCodePoints(text, DEEPSEEK_QUERY_CHARS).trim() || undefined
}

export interface DeepSeekSearchBody {
  query: string
  count: number
  need_content: false
  ori_question?: string
}

export function deepseekSearchBody(query: string, count: number, question?: string): DeepSeekSearchBody {
  return {
    query,
    count: Math.min(Math.max(Math.floor(count) || DEEPSEEK_DEFAULT_COUNT, 1), DEEPSEEK_MAX_COUNT),
    need_content: false,
    ...question ? { ori_question: question } : {},
  }
}

// ── response ────────────────────────────────────────────────────────────────

/** The `summary` is Markdown and often opens with the page title as an H1; that line repeats the title field, so it is dropped. */
function withoutTitleHeading(summary: unknown, title: string | undefined): unknown {
  if (typeof summary !== 'string' || !title) return summary
  const m = /^\s*#\s+([^\n]*)\n+/.exec(summary)
  return m && m[1]!.trim() === title ? summary.slice(m[0].length) : summary
}

/** Map `results[]`: summary (else snippet) as the excerpt, date -> publishedAt, rerank_score / authority as metadata. Rows without an http(s) URL are dropped. */
export function mapDeepSeekResults(results: readonly unknown[], count: number): EngineSource[] {
  const sources: EngineSource[] = []
  for (const r of results) {
    const row = (r ?? {}) as Record<string, unknown>
    if (!isHttpUrl(row.url)) continue
    const title = textOf(row.title)
    const snippet = snippetOf(withoutTitleHeading(row.summary, title)) ?? snippetOf(row.snippet)
    const publishedAt = textOf(row.date) // RFC 3339 or null
    const rerank = typeof row.rerank_score === 'number' && Number.isFinite(row.rerank_score) ? Math.min(Math.max(row.rerank_score, 0), 3) : undefined
    // `authority` is 0-4, -1 when unknown (unknown = absent: it must not read as the lowest grade).
    const authority = typeof row.authority === 'number' && Number.isFinite(row.authority) && row.authority >= 0 ? Math.min(Math.round(row.authority), 4) : undefined
    sources.push({
      url: row.url.trim(),
      ...title ? { title } : {},
      ...snippet ? { snippet } : {},
      ...publishedAt ? { publishedAt } : {},
      ...rerank !== undefined ? { rerankScore: rerank } : {},
      ...authority !== undefined ? { authority } : {},
    })
    if (sources.length >= count) break
  }
  return sources
}

/** Parse a 2xx Search body; an empty `results` array is ENGINE_EMPTY (the service works, nothing matched, and nothing was billed). */
export function parseDeepSeekSearch(json: unknown, count: number): EngineSource[] {
  if (json === null || typeof json !== 'object' || Array.isArray(json) || !Array.isArray((json as { results?: unknown }).results)) {
    throw new EngineError('DeepSeek Search returned an unprocessable response body', 'ENGINE_ERROR', true)
  }
  const sources = mapDeepSeekResults((json as { results: unknown[] }).results, count)
  if (!sources.length) throw emptyResults(DEEPSEEK_LABEL)
  return sources
}

// ── errors and retry ────────────────────────────────────────────────────────

/** Statuses the docs say to wait and retry: 408, 429 and 5xx. */
export const isRetryableStatus = (status: number): boolean => status === 408 || status === 429 || status >= 500

/**
 * The error message of an OpenAI-shaped body, safe to show: the key (should it ever be echoed) and credential-looking values are
 * redacted and the length is capped. The service's `request_id` (what DeepSeek support asks for) is returned apart, so a message can
 * end with it instead of burying the cause.
 */
export function errorParts(json: unknown, key: string | undefined): { text: string; id?: string } {
  const raw = (json as { error?: { message?: unknown } } | null | undefined)?.error?.message
  if (typeof raw !== 'string' || !raw.trim()) {
    const message = errorMessage(json)
    return { text: key ? message.split(key).join('[redacted]') : message }
  }
  const id = /request_id:\s*([0-9a-f-]{8,64})/i.exec(raw)?.[1]
  const text = raw.replace(/\s*\(request_id:[^)]*\)/i, '')
  return { text: safeDetail(key ? text.split(key).join('[redacted]') : text), ...id ? { id } : {} }
}

/** {@link errorParts} as one string: `message (request_id …)`. */
export function detailOf(json: unknown, key: string | undefined): string {
  const { text, id } = errorParts(json, key)
  return text + (id ? ' (request_id ' + id + ')' : '')
}

/**
 * Status -> error contract for Search. 401 / 403 are `ENGINE_AUTH`; 402 is `ENGINE_QUOTA` with the balance wording (never retried,
 * no cooldown: waiting does not refill a balance); 429 is `ENGINE_RATE_LIMIT` carrying `Retry-After`; 408 is a retryable
 * `ENGINE_TIMEOUT`; 400 / 404 / 413 are bad requests (not retryable); 5xx is a retryable `ENGINE_ERROR`. Never contains the key.
 */
export function deepseekFailure(label: string, status: number, headers: Headers, json: unknown, key?: string): EngineError {
  const detail = detailOf(json, key)
  const tail = detail ? ': ' + detail : ''
  switch (status) {
    case 401: return new EngineError(label + ' rejected the API key (HTTP 401' + tail + '): check the key under ' + (KEYED_SOURCE_ENVS[DEEPSEEK_ROUTE_ID] ?? [DEEPSEEK_KEY_ENV]).join(' / '), 'ENGINE_AUTH', false)
    case 402: return new EngineError(label + ': the DeepSeek account balance is insufficient (HTTP 402, 余额不足' + tail + '). Top up the API balance at platform.deepseek.com and retry; only requests that return results are billed.', 'ENGINE_QUOTA', false)
    case 403: return new EngineError(label + ' refused the request (HTTP 403' + tail + ')', 'ENGINE_AUTH', false)
    case 408: return new EngineError(label + ' timed out reading the request (HTTP 408' + tail + ')', 'ENGINE_TIMEOUT', true)
    case 413: return new EngineError(label + ' rejected the request as too large (HTTP 413' + tail + ')', 'ENGINE_ERROR', false)
    case 429: {
      const wait = parseRetryAfter(headers.get('retry-after'))
      return new EngineError(label + ' rate limit (HTTP 429' + tail + (wait !== undefined ? '; retry after ' + Math.ceil(wait / 1000) + 's' : '') + ')', 'ENGINE_RATE_LIMIT', true, wait)
    }
    default:
      if (status === 400 || status === 404 || status === 422 || (status > 400 && status < 500)) return new EngineError(label + ' rejected the request (HTTP ' + status + tail + ')', 'ENGINE_ERROR', false)
      return new EngineError(label + ' API error (HTTP ' + status + tail + ')', 'ENGINE_ERROR', true)
  }
}

/** Abort-aware wait. */
export function defaultSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) { reject(signal.reason ?? new DOMException('This operation was aborted', 'AbortError')); return }
    const timer = setTimeout(() => { signal?.removeEventListener('abort', onAbort); resolve() }, ms)
    const onAbort = (): void => { clearTimeout(timer); reject(signal!.reason ?? new DOMException('This operation was aborted', 'AbortError')) }
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

type Transport = Pick<EngineDeps, 'allowProxyFakeIp' | 'fetchImpl' | 'lookup' | 'sleep'>

/** Wait before retry number `attempt` (1-based): the service's `Retry-After` when it gave one, else 0.8 s, 1.6 s. Undefined = not worth waiting (stop). */
export function retryWaitMs(res: Pick<ProviderResponse, 'headers'>, attempt: number): number | undefined {
  const hinted = parseRetryAfter(res.headers.get('retry-after'))
  const wait = hinted ?? DEEPSEEK_RETRY_BASE_MS * 2 ** (attempt - 1)
  return wait > DEEPSEEK_RETRY_WAIT_CAP_MS ? undefined : wait
}

/**
 * One POST with the documented retry policy: a 408 / 429 / 5xx answer is retried after a wait (at most {@link DEEPSEEK_MAX_ATTEMPTS}
 * tries in all, never longer than {@link DEEPSEEK_RETRY_WAIT_CAP_MS} per wait); every other answer is returned at once. Retries are
 * safe: both APIs are read-only and failed requests are not billed. Returns the final response (which may still be an error).
 */
export async function postWithRetry(label: string, url: string, key: string, body: unknown, transport: Transport, signal: AbortSignal | undefined): Promise<ProviderResponse> {
  const sleep = transport.sleep ?? defaultSleep
  for (let attempt = 1; ; attempt++) {
    const res = await requestProvider(label, url, {
      deps: transport, signal, method: 'POST', redirect: 'error', timeoutMs: TIMEOUT_MS,
      body: JSON.stringify(body),
      headers: { 'content-type': 'application/json', 'accept': 'application/json', 'authorization': 'Bearer ' + key },
    })
    if (res.ok || !isRetryableStatus(res.status) || attempt >= DEEPSEEK_MAX_ATTEMPTS) return res
    const wait = retryWaitMs(res, attempt)
    if (wait === undefined) return res
    await sleep(wait, signal)
  }
}

// ── search engine ───────────────────────────────────────────────────────────

const baseOf = (deps: Pick<EngineDeps, 'sourceBaseUrls'>): string => (deps.sourceBaseUrls?.[DEEPSEEK_ROUTE_ID] ?? DEEPSEEK_DEFAULT_BASE).replace(/\/+$/, '')

export function deepseekEngine(deps: EngineDeps): Engine {
  return {
    id: DEEPSEEK_ROUTE_ID,
    label: DEEPSEEK_LABEL,
    available: () => keyOf(deps, DEEPSEEK_ROUTE_ID) !== undefined,
    async search(query, count, signal, options): Promise<SearchOutcome> {
      const key = keyOf(deps, DEEPSEEK_ROUTE_ID)
      if (!key) throw new EngineError(missingKeyMessage(DEEPSEEK_LABEL, DEEPSEEK_ROUTE_ID), 'ENGINE_UNAVAILABLE', false)
      const fitted = fitQuery(query)
      if (!fitted.query) throw new EngineError(DEEPSEEK_LABEL + ' needs a non-empty query', 'ENGINE_ERROR', false)
      const body = deepseekSearchBody(fitted.query, count, originalQuestion(options?.originalQuestion, fitted.query))
      const res = await postWithRetry(DEEPSEEK_LABEL, baseOf(deps) + DEEPSEEK_SEARCH_PATH, key, body, deps, signal)
      if (!res.ok) throw deepseekFailure(DEEPSEEK_LABEL, res.status, res.headers, res.json, key)
      if (res.json === undefined) throw new EngineError(DEEPSEEK_LABEL + ' returned invalid JSON', 'ENGINE_ERROR', true)
      const sources = parseDeepSeekSearch(res.json, count) // an empty answer throws ENGINE_EMPTY here: it was not billed, so it is not booked
      // A 200 that yields results is a billed request.
      try { deps.usage?.record({ provider: DEEPSEEK_USAGE_SEARCH, protocol: 'search', requests: 1, note: 'tokens n/a, $0.75 per 1,000 successful requests' }) } catch { /* the ledger is advisory */ }
      const notes = fitted.cut ? ['deepseek: query cut from ' + fitted.from + ' to ' + codePoints(fitted.query) + ' characters (the API takes at most ' + DEEPSEEK_QUERY_CHARS + '); site:/-site:/after: operators were kept'] : []
      return { sources, ...notes.length ? { notes } : {} }
    },
  }
}

// ── fetch ───────────────────────────────────────────────────────────────────

/** A Fetch API failure. `code` names what DeepSeek did; none of them describes the TARGET page's own HTTP status. */
export class DeepSeekFetchError extends Error {
  constructor(message: string, readonly code: 'DEEPSEEK_FETCH_DENIED' | 'DEEPSEEK_FETCH_NO_CONTENT' | 'DEEPSEEK_FETCH_AUTH' | 'DEEPSEEK_FETCH_QUOTA' | 'DEEPSEEK_FETCH_RATE_LIMIT' | 'DEEPSEEK_FETCH_ERROR', readonly retryable = false) {
    super(message)
    this.name = 'DeepSeekFetchError'
  }
}

/**
 * Status -> error for Fetch. 403 and 404 are DeepSeek's own verdicts (security policy; no usable content), and the message opens by
 * saying so: it is not the target page's HTTP status. The request id comes last.
 */
export function deepseekFetchFailure(status: number, headers: Headers, json: unknown, key?: string): DeepSeekFetchError {
  const { text, id } = errorParts(json, key)
  const tail = text ? ': ' + text : ''
  const ref = id ? ' [request_id ' + id + ']' : ''
  switch (status) {
    case 403: return new DeepSeekFetchError('DeepSeek Fetch refused this URL under its security policy (DeepSeek\'s decision, not the target page\'s HTTP status; HTTP 403' + tail + ')' + ref, 'DEEPSEEK_FETCH_DENIED')
    case 404: return new DeepSeekFetchError('DeepSeek Fetch got no usable content (DeepSeek\'s result, not the target page\'s HTTP status; HTTP 404' + tail + '). The URL may be unavailable, blocked, erroring, of an unsupported type or without extractable text.' + ref, 'DEEPSEEK_FETCH_NO_CONTENT')
    case 401: return new DeepSeekFetchError('DeepSeek Fetch rejected the API key (HTTP 401' + tail + ')' + ref, 'DEEPSEEK_FETCH_AUTH')
    case 402: return new DeepSeekFetchError('DeepSeek Fetch: the account balance is insufficient (HTTP 402, 余额不足' + tail + '). Top up the API balance at platform.deepseek.com.' + ref, 'DEEPSEEK_FETCH_QUOTA')
    case 429: {
      const wait = parseRetryAfter(headers.get('retry-after'))
      return new DeepSeekFetchError('DeepSeek Fetch rate limit (HTTP 429' + tail + (wait !== undefined ? '; retry after ' + Math.ceil(wait / 1000) + 's' : '') + ')' + ref, 'DEEPSEEK_FETCH_RATE_LIMIT', true)
    }
    default: return new DeepSeekFetchError('DeepSeek Fetch error (HTTP ' + status + tail + ')' + ref, 'DEEPSEEK_FETCH_ERROR', isRetryableStatus(status))
  }
}

export interface DeepSeekFetchAccess extends Transport {
  apiKey: string
  /** Endpoint base, default {@link DEEPSEEK_DEFAULT_BASE}. */
  baseUrl?: string
  usage?: EngineDeps['usage']
}

export interface DeepSeekPage { title?: string; text: string }

/** Read one page as Markdown through the Fetch API. Throws {@link DeepSeekFetchError} (or an EngineError for transport problems). */
export async function deepseekFetchPage(url: string, access: DeepSeekFetchAccess, signal?: AbortSignal): Promise<DeepSeekPage> {
  if (url.length > DEEPSEEK_FETCH_URL_CHARS) throw new DeepSeekFetchError('DeepSeek Fetch takes URLs of at most ' + DEEPSEEK_FETCH_URL_CHARS + ' characters', 'DEEPSEEK_FETCH_ERROR')
  const base = (access.baseUrl ?? DEEPSEEK_DEFAULT_BASE).replace(/\/+$/, '')
  const res = await postWithRetry('DeepSeek Fetch', base + DEEPSEEK_FETCH_PATH, access.apiKey, { url }, access, signal)
  if (!res.ok) throw deepseekFetchFailure(res.status, res.headers, res.json, access.apiKey)
  const json = res.json as { title?: unknown; content?: unknown } | undefined
  if (!json || typeof json !== 'object' || typeof json.content !== 'string') throw new DeepSeekFetchError('DeepSeek Fetch returned an unprocessable response body', 'DEEPSEEK_FETCH_ERROR', true)
  if (!json.content.trim()) throw new DeepSeekFetchError('DeepSeek Fetch returned no content (not billed)', 'DEEPSEEK_FETCH_NO_CONTENT')
  try { access.usage?.record({ provider: DEEPSEEK_USAGE_FETCH, protocol: 'fetch', requests: 1, note: 'tokens n/a, $0.75 per 1,000 successful requests' }) } catch { /* the ledger is advisory */ }
  const title = textOf(json.title)
  return { ...title ? { title: safeDetail(title, 300) } : {}, text: json.content }
}

// ── descriptor and adapter ──────────────────────────────────────────────────

export const DEEPSEEK_DESCRIPTOR: ProviderDescriptor = {
  id: 'builtin:' + DEEPSEEK_ROUTE_ID,
  aliases: [DEEPSEEK_ROUTE_ID],
  label: DEEPSEEK_LABEL,
  adapterVersion: '1',
  contractVersion: 1,
  operations: ['search'],
  taskProfiles: ['general', 'news_fact', 'experience', 'compare', 'docs_code'],
  languages: ['zh', 'en'],
  regions: ['global', 'cn'],
  resultKinds: ['web'],
  requirements: [{ kind: 'key', id: 'deepseek-key', env: [...KEYED_SOURCE_ENVS[DEEPSEEK_ROUTE_ID] ?? [DEEPSEEK_KEY_ENV]], note: 'the DeepSeek API key (platform.deepseek.com)' }],
  supportedFilters: ['site', 'exclude_site', 'exclude_term', 'time_window'],
  costModel: { kind: 'metered', unit: 'request', note: '$0.75 per 1,000 successful requests (Search and Fetch each; empty results and failures are not billed, count does not change the price). Server-side calls through DeepSeek Harness / Claude Code / Codex are free until 2026-11-01 00:00 Beijing time; the docs do not say a plugin calling the API directly is inside that window, so treat it as billed. https://api-docs.deepseek.com/guides/search/ (read 2026-10-26)' },
  costTier: 'paid',
  priority: 5,
  common: true,
  verification: { live: true, note: 'verified live 2026-10-26 (8 Search + 4 Fetch requests, api.deepseek.com/v1/tools): result shape with summary / rerank_score / authority / date, site: / -site: / after: operators, the 128-character limit (HTTP 400), 401 and 404 error bodies, Fetch Markdown; the 403 Fetch refusal and the 408 / 429 / 5xx retries come from the documentation only' },
}

export const deepseekAdapter: ProviderAdapter = {
  descriptor: DEEPSEEK_DESCRIPTOR,
  probeLocal({ deps }): Readiness {
    return keyOf(deps, DEEPSEEK_ROUTE_ID)
      ? { available: true, installation: 'not_required', credential: 'configured' }
      : { available: false, installation: 'not_required', credential: 'missing', reason: 'no DeepSeek API key (set $' + (KEYED_SOURCE_ENVS[DEEPSEEK_ROUTE_ID] ?? [DEEPSEEK_KEY_ENV]).join(' or $') + ', a DSH credentials ref, or the settings key field)', diagnosticCode: 'credential_missing' }
  },
  create: deps => deepseekEngine(deps),
  compile: (task, now) => compileDeepSeek(task, DEEPSEEK_ROUTE_ID, now),
}
