/**
 * Bocha web search (https://open.bochaai.com): a Chinese-strong, key-based search API.
 *
 * Contract sources: the MIT reference provider `bocha-ai/dsh-web-search-bocha` (src/provider.ts, src/types.ts, README) for the
 * request body, `data.webPages.value[]` mapping and error envelope, and the documented request fields `include` / `exclude`
 * (domains separated by `|` or `,`, at most 100). VERIFIED LIVE on 2026-10-04 with a funded search key, 4 requests:
 * `https://api.bocha.cn` (the reference plugin's host, used by default) answered 200 `{ code: 200, log_id, msg: null,
 * data: { _type: "SearchResponse", queryContext, webPages: { webSearchUrl, totalEstimatedMatches, value: [...], someResultsRemoved },
 * images, videos } }` (`code` is the NUMBER 200; each page has id, name, url, displayUrl, snippet (about 100 characters), summary
 * (long, only with `summary: true`), siteName, siteIcon, datePublished, dateLastCrawled); `include` kept only results of the listed
 * domains (subdomains included), `exclude` dropped the listed ones, `freshness: "YYYY-MM-DD..YYYY-MM-DD"` kept every publication date
 * inside the range; `https://api.bochaai.com` accepts the same key with the same response (test/fixtures/bocha-web-search.json,
 * bocha-filters.json are sanitized captures). The earlier live call (2026-10-02, a Jev key) answered 403 with `code` as a STRING
 * (test/fixtures/bocha-quota-403.json): the account had no balance then, so error envelopes may carry either type.
 *
 * `POST {base}/v1/web-search`, `Authorization: Bearer <key>`, body
 * `{ query, freshness?, summary?, count?, include?, exclude? }`.
 * @module web-search-pro/providers/bocha
 */

import type { WebSearchSource } from '@deepseek-ai/dsh-web'
import { EngineError, type Engine, type EngineDeps, type EngineSearchOptions, type SearchOutcome } from '../engines.ts'
import { readBoundedBody, assertSafePublicUrl } from '../safe-http.ts'
import { compileBocha } from '../pipeline/compile.ts'
import type { ProviderAdapter, ProviderDescriptor, Readiness } from './registry.ts'

export const BOCHA_ROUTE_ID = 'bocha'
/** The reference plugin's host, verified live; `https://api.bochaai.com` serves the same API and accepts the same key (`bochaBaseUrl` can point there). */
export const BOCHA_DEFAULT_BASE_URL = 'https://api.bocha.cn'
export const BOCHA_PATH = '/v1/web-search'
/** Credentials ref / environment variable of the search key. */
export const BOCHA_KEY_ENV = 'BOCHA_SEARCH_API_KEY'
/** Bocha documents one account key for Jev and search: the Jev name is the documented fallback. */
export const BOCHA_FALLBACK_KEY_ENV = 'BOCHA_JEV_API_KEY'
/** Provider name of the usage ledger rows (requests counted, tokens n/a, price unknown). */
export const BOCHA_USAGE_PROVIDER = 'bocha-search'
export const BOCHA_MAX_COUNT = 50
export const BOCHA_MAX_SITES = 100
const BOCHA_TIMEOUT_MS = 30_000
const MAX_BODY_BYTES = 4 * 1024 * 1024
/** Bocha summaries are long and make good gate / scoring text; the tool output shaper cuts them again for display. */
const SNIPPET_CHARS = 1_000

/** Request body of `POST /v1/web-search` (optional fields are omitted when unset). */
export interface BochaRequestBody {
  query: string
  count: number
  summary: boolean
  freshness?: string
  include?: string
  exclude?: string
}

/** One entry of `webPages.value[]`. */
export interface BochaWebPage {
  name?: string | null
  url?: string | null
  snippet?: string | null
  summary?: string | null
  siteName?: string | null
  datePublished?: string | null
  dateLastCrawled?: string | null
}

const text = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined
  const t = value.trim()
  return t ? t : undefined
}

const HOSTNAME = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i

/** Domains as Bocha's `include` / `exclude` take them: valid hostnames only, deduplicated, at most 100, `|`-joined. */
export function joinSites(sites: readonly string[] | undefined): string | undefined {
  const clean = [...new Set((sites ?? []).map(s => s.trim().toLowerCase()).filter(s => HOSTNAME.test(s)))].slice(0, BOCHA_MAX_SITES)
  return clean.length ? clean.join('|') : undefined
}

export function bochaRequestBody(query: string, count: number, summary: boolean, native: EngineSearchOptions['bocha'] | undefined): BochaRequestBody {
  const include = joinSites(native?.include)
  const exclude = joinSites(native?.exclude)
  return {
    query,
    count: Math.min(Math.max(Math.floor(count), 1), BOCHA_MAX_COUNT),
    summary,
    ...native?.freshness ? { freshness: native.freshness } : {},
    ...include ? { include } : {},
    ...exclude ? { exclude } : {},
  }
}

/** Map `webPages.value[]` entries to sources: summary preferred over the short snippet; entries without an http(s) URL dropped. */
export function mapBochaPages(pages: readonly BochaWebPage[], count: number): WebSearchSource[] {
  const sources: WebSearchSource[] = []
  for (const page of pages) {
    const url = text(page?.url)
    if (!url || !/^https?:\/\//i.test(url)) continue
    const title = text(page.name)
    const snippet = text(page.summary) ?? text(page.snippet)
    const publishedAt = text(page.datePublished)
    sources.push({
      url,
      ...title ? { title } : {},
      ...snippet ? { snippet: snippet.length > SNIPPET_CHARS ? snippet.slice(0, SNIPPET_CHARS) + '…' : snippet } : {},
      ...publishedAt ? { publishedAt } : {},
    })
    if (sources.length >= count) break
  }
  return sources
}

/** `Retry-After` as milliseconds (delta-seconds or an HTTP date); undefined when absent or unusable. */
export function parseRetryAfter(value: string | null | undefined, now = Date.now()): number | undefined {
  const raw = value?.trim()
  if (!raw) return undefined
  if (/^\d+(?:\.\d+)?$/.test(raw)) return Math.round(Number(raw) * 1000)
  const at = Date.parse(raw)
  return Number.isFinite(at) ? Math.max(at - now, 0) : undefined
}

/** The error envelope's message with its `log_id` (a request id Bocha support can look up). Never contains the key. */
function providerMessage(body: unknown): string | undefined {
  if (body === null || typeof body !== 'object') return undefined
  const b = body as Record<string, unknown>
  const message = text(b.msg) ?? text(b.message)
  const logId = text(b.log_id)
  return message ? (logId ? message + ' (log_id: ' + logId + ')' : message) : undefined
}

const QUOTA_WORDS = /money|quota|balance|insufficient|余额|额度|欠费|套餐/i

/**
 * Map a failed answer to the engine error contract. 401 / 403: not retryable and no cooldown (a wait does not help):
 * `ENGINE_AUTH`, or `ENGINE_QUOTA` when the service says the account has no balance or package (the live 403 does).
 * 429: `ENGINE_RATE_LIMIT`, retryable, carrying Retry-After as the cooldown. 5xx and anything else: retryable `ENGINE_ERROR`.
 */
export function bochaFailure(status: number, body: unknown, retryAfter?: string | null): EngineError {
  const detail = providerMessage(body)
  if (status === 401 || status === 403) {
    if (detail && QUOTA_WORDS.test(detail)) return new EngineError('Bocha: ' + detail + ' (HTTP ' + status + '; the key was recognised but the account has no search balance or package)', 'ENGINE_QUOTA', false)
    return new EngineError('Bocha rejected the API key (HTTP ' + status + (detail ? ': ' + detail : '') + ')', 'ENGINE_AUTH', false)
  }
  if (status === 429) {
    const wait = parseRetryAfter(retryAfter)
    return new EngineError('Bocha rate limit (HTTP 429' + (detail ? ': ' + detail : '') + (wait !== undefined ? '; retry after ' + Math.ceil(wait / 1000) + 's' : '') + ')', 'ENGINE_RATE_LIMIT', true, wait)
  }
  if (status === 400 || status === 422) return new EngineError('Bocha rejected the request (HTTP ' + status + (detail ? ': ' + detail : '') + ')', 'ENGINE_ERROR', false)
  return new EngineError('Bocha API error (HTTP ' + status + (detail ? ': ' + detail : '') + ')', 'ENGINE_ERROR', true)
}

/** Parse a 2xx body: provider-declared failures inside the envelope throw, an empty list is ENGINE_EMPTY. */
export function parseBochaResponse(body: unknown, count: number): WebSearchSource[] {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) throw new EngineError('Bocha returned an unprocessable response body', 'ENGINE_ERROR', true)
  const envelope = body as { code?: unknown; data?: unknown; webPages?: unknown }
  // `code` is a number in the reference and a string in the live error answer: compare numerically.
  if (envelope.code !== undefined && envelope.code !== null && Number(envelope.code) !== 200) {
    throw bochaFailure(Number.isFinite(Number(envelope.code)) ? Number(envelope.code) : 500, body)
  }
  const data = envelope.data && typeof envelope.data === 'object' ? envelope.data as { webPages?: unknown } : envelope
  const webPages = (data as { webPages?: { value?: unknown } | null }).webPages
  const value = webPages?.value ?? []
  if (!Array.isArray(value)) throw new EngineError('Bocha returned an unprocessable response body', 'ENGINE_ERROR', true)
  const sources = mapBochaPages(value as BochaWebPage[], count)
  if (!sources.length) throw new EngineError('Bocha returned no results', 'ENGINE_EMPTY', true)
  return sources
}

export function bochaEngine(deps: EngineDeps): Engine {
  const key = (): string | undefined => deps.bochaApiKey || undefined
  return {
    id: BOCHA_ROUTE_ID,
    label: 'Bocha (博查)',
    available: () => (key()?.length ?? 0) > 0,
    async search(query, count, signal, options): Promise<SearchOutcome> {
      const apiKey = key()
      if (!apiKey) throw new EngineError('Bocha unavailable: set bochaApiKey or $' + BOCHA_KEY_ENV + ' (or $' + BOCHA_FALLBACK_KEY_ENV + ')', 'ENGINE_UNAVAILABLE', false)
      let url: URL
      try { url = assertSafePublicUrl((deps.bochaBaseUrl ?? BOCHA_DEFAULT_BASE_URL).replace(/\/+$/, '') + BOCHA_PATH) } catch (error) {
        throw new EngineError('Bocha base URL rejected: ' + (error instanceof Error ? error.message : String(error)), 'ENGINE_UNAVAILABLE', false)
      }
      const body = bochaRequestBody(query, count, deps.bochaSummary ?? true, options?.bocha)
      const timeout = AbortSignal.timeout(BOCHA_TIMEOUT_MS)
      const stage = signal ? AbortSignal.any([signal, timeout]) : timeout
      let response: Response
      try {
        response = await (deps.fetchImpl ?? fetch)(url, {
          method: 'POST',
          redirect: 'error',
          signal: stage,
          headers: { 'authorization': 'Bearer ' + apiKey, 'content-type': 'application/json', 'accept': 'application/json' },
          body: JSON.stringify(body),
        })
      } catch (error) {
        if (signal?.aborted) throw error
        if (timeout.aborted) throw new EngineError('Bocha timed out', 'ENGINE_TIMEOUT', true)
        throw new EngineError('Bocha request failed: ' + (error instanceof Error ? error.message : String(error)), 'ENGINE_ERROR', true)
      }
      let raw: string
      try { raw = (await readBoundedBody(response, MAX_BODY_BYTES)).toString('utf8') } catch (error) {
        if (signal?.aborted) throw error
        if (timeout.aborted) throw new EngineError('Bocha timed out', 'ENGINE_TIMEOUT', true)
        throw new EngineError('Bocha response unreadable: ' + (error instanceof Error ? error.message : String(error)), 'ENGINE_ERROR', true)
      }
      let parsed: unknown
      try { parsed = JSON.parse(raw) } catch { parsed = undefined }
      if (!response.ok) throw bochaFailure(response.status, parsed, response.headers.get('retry-after'))
      // A 2xx answer is a billed request, whatever it holds.
      deps.usage?.record({ provider: BOCHA_USAGE_PROVIDER, protocol: 'search', requests: 1, note: 'tokens n/a, price unknown' })
      if (parsed === undefined) throw new EngineError('Bocha returned invalid JSON', 'ENGINE_ERROR', true)
      return { sources: parseBochaResponse(parsed, count) }
    },
  }
}

export const BOCHA_DESCRIPTOR: ProviderDescriptor = {
  id: 'builtin:bocha',
  aliases: [BOCHA_ROUTE_ID],
  label: 'Bocha (博查)',
  adapterVersion: '1',
  contractVersion: 1,
  operations: ['search'],
  taskProfiles: ['general', 'news_fact', 'experience', 'compare', 'docs_code'],
  languages: ['zh'],
  regions: ['cn'],
  resultKinds: ['web'],
  requirements: [{ kind: 'key', id: 'bocha-key', env: [BOCHA_KEY_ENV, BOCHA_FALLBACK_KEY_ENV], note: 'a search key; the Jev key of the same account is the documented fallback' }],
  supportedFilters: ['site', 'exclude_site', 'time_window'],
  costModel: { kind: 'metered', unit: 'request', note: 'billed per request from a Bocha balance or package; the plugin counts requests (provider bocha-search), the price is unknown to it' },
  costTier: 'paid',
  priority: 10,
  verification: { live: true, note: 'verified live 2026-10-04 (4 requests, https://api.bocha.cn): 200 success shape, include / exclude / freshness range honoured; https://api.bochaai.com accepts the same key' },
}

export const bochaAdapter: ProviderAdapter = {
  descriptor: BOCHA_DESCRIPTOR,
  probeLocal({ deps }): Readiness {
    const configured = (deps.bochaApiKey?.length ?? 0) > 0
    return configured
      ? { available: true, installation: 'not_required', credential: 'configured' }
      : { available: false, installation: 'not_required', credential: 'missing', reason: 'no Bocha key (set $' + BOCHA_KEY_ENV + ' or $' + BOCHA_FALLBACK_KEY_ENV + ', or bochaApiKey)', diagnosticCode: 'credential_missing' }
  },
  create: deps => bochaEngine(deps),
  compile: (task, now) => compileBocha(task, BOCHA_ROUTE_ID, now),
}
