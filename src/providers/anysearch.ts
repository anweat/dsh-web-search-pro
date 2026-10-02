/**
 * AnySearch web search, anonymous tier. Contract source: https://anysearch.com/docs/api-endpoints/v1-search and
 * /docs/auth: `POST https://api.anysearch.com/v1/search` with JSON `{ query, max_results (1-10), zone: cn|intl,
 * language, tag?, params?, format? }`; success `{ code: 0, message, request_id, data: { results: [{ title, url,
 * snippet?, content? }], metadata } }`; no Authorization header = anonymous, limited per client IP and by a daily
 * free quota; an invalid key is never silently downgraded to anonymous (401 / 403).
 *
 * CREDENTIAL SAFETY. When an anonymous caller exceeds the daily quota the service answers HTTP 402 whose
 * `message` carries an auto-generated username, password and api_key. That body is never read into an error,
 * log, ledger row or output: a 402 becomes the standard `quota_exhausted` (ENGINE_QUOTA, not retryable) and the
 * adapter stops asking for a while (each further anonymous 402 may register yet another account). Any other
 * error text goes through `safeDetail`, which also redacts credential-looking values.
 * @module web-search-pro/providers/anysearch
 */

import type { WebSearchSource } from '@deepseek-ai/dsh-web'
import { EngineError, type Engine, type EngineDeps, type SearchOutcome } from '../engines.ts'
import { detectLang } from '../pipeline/align.ts'
import { compileSince } from '../pipeline/compile.ts'
import { Blocker, recordRequest, requestProvider, safeDetail, statusFailure } from './http.ts'
import type { ProviderAdapter, ProviderDescriptor } from './registry.ts'

export const ANYSEARCH_ROUTE_ID = 'anysearch'
export const ANYSEARCH_USAGE_PROVIDER = 'anysearch'
export const ANYSEARCH_KEY_ENV = 'ANYSEARCH_API_KEY'
export const ANYSEARCH_URL = 'https://api.anysearch.com/v1/search'
export const ANYSEARCH_MAX_RESULTS = 10
const SNIPPET_CHARS = 500
/** After a quota 402 do not ask again for this long (anonymous 402s may mint accounts). */
export const ANYSEARCH_QUOTA_BLOCK_MS = 60 * 60 * 1000
export const anySearchBlock = new Blocker()

export interface AnySearchResult { title?: string | null; url?: string | null; snippet?: string | null; content?: string | null }

export interface AnySearchBody { query: string; max_results: number; zone: 'cn' | 'intl'; language: string }

export function anySearchBody(query: string, count: number, lang?: 'zh' | 'en'): AnySearchBody {
  const l = lang ?? (detectLang(query) === 'zh' ? 'zh' : 'en')
  return { query, max_results: Math.min(Math.max(Math.floor(count), 1), ANYSEARCH_MAX_RESULTS), zone: l === 'zh' ? 'cn' : 'intl', language: l === 'zh' ? 'zh-CN' : 'en' }
}

export function mapAnySearch(results: readonly AnySearchResult[], count: number): WebSearchSource[] {
  const sources: WebSearchSource[] = []
  for (const r of results) {
    const url = typeof r?.url === 'string' ? r.url.trim() : ''
    if (!/^https?:\/\//i.test(url)) continue
    const title = typeof r.title === 'string' ? r.title.trim() : ''
    const text = (typeof r.snippet === 'string' && r.snippet.trim() ? r.snippet : typeof r.content === 'string' ? r.content : '').replace(/\s+/g, ' ').trim()
    sources.push({ url, ...title ? { title } : {}, ...text ? { snippet: text.length > SNIPPET_CHARS ? text.slice(0, SNIPPET_CHARS) + '…' : text } : {} })
    if (sources.length >= count) break
  }
  return sources
}

/** Parse a 2xx envelope: a non-zero `code` is a failure, no results is ENGINE_EMPTY. */
export function parseAnySearch(body: unknown, count: number): WebSearchSource[] {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) throw new EngineError('AnySearch returned an unprocessable response body', 'ENGINE_ERROR', true)
  const b = body as { code?: unknown; data?: { results?: unknown } }
  if (b.code !== undefined && Number(b.code) !== 0) throw new EngineError('AnySearch reported an error (code ' + safeDetail(String(b.code), 20) + ')', 'ENGINE_ERROR', true)
  const results = b.data?.results
  if (!Array.isArray(results)) throw new EngineError('AnySearch returned an unprocessable response body', 'ENGINE_ERROR', true)
  const sources = mapAnySearch(results as AnySearchResult[], count)
  if (!sources.length) throw new EngineError('AnySearch returned no results', 'ENGINE_EMPTY', true)
  return sources
}

/**
 * Failure mapping. 402 is handled WITHOUT touching the body (it may hold generated credentials): `quota_exhausted`.
 * For other statuses only a redacted `message` is shown.
 */
export function anySearchFailure(status: number, headers: Headers, body: unknown): EngineError {
  if (status === 402) {
    anySearchBlock.block(ANYSEARCH_QUOTA_BLOCK_MS, 'ENGINE_QUOTA', 'quota_exhausted')
    return new EngineError('AnySearch: quota_exhausted (the anonymous daily free quota is used up; set ' + ANYSEARCH_KEY_ENV + ' to continue)', 'ENGINE_QUOTA', false)
  }
  const detail = safeDetail(body !== null && typeof body === 'object' ? (body as { message?: unknown }).message : undefined)
  return statusFailure('AnySearch', status, headers, detail)
}

export function anySearchEngine(deps: EngineDeps): Engine {
  return {
    id: ANYSEARCH_ROUTE_ID,
    label: 'AnySearch',
    available: () => true,
    async search(query, count, signal, options): Promise<SearchOutcome> {
      anySearchBlock.check('AnySearch')
      const res = await requestProvider('AnySearch', ANYSEARCH_URL, {
        deps, signal, method: 'POST', body: JSON.stringify(anySearchBody(query, count, options?.lang)),
        headers: { 'content-type': 'application/json', ...deps.anysearchApiKey ? { authorization: 'Bearer ' + deps.anysearchApiKey } : {} },
      })
      if (!res.ok) throw anySearchFailure(res.status, res.headers, res.json)
      recordRequest(deps, ANYSEARCH_USAGE_PROVIDER)
      if (res.json === undefined) throw new EngineError('AnySearch returned invalid JSON', 'ENGINE_ERROR', true)
      return { sources: parseAnySearch(res.json, count) }
    },
  }
}

export const ANYSEARCH_DESCRIPTOR: ProviderDescriptor = {
  id: 'builtin:anysearch',
  aliases: [ANYSEARCH_ROUTE_ID],
  label: 'AnySearch',
  adapterVersion: '1',
  contractVersion: 1,
  operations: ['search'],
  taskProfiles: ['general', 'news_fact', 'experience', 'compare', 'docs_code'],
  // Language-agnostic on purpose: S1 never promotes it ahead of Bocha / Exa / the free engines; it is chosen explicitly or recommended.
  languages: ['*'],
  regions: ['global', 'cn'],
  resultKinds: ['web'],
  requirements: [{ kind: 'key', id: 'anysearch-key', env: [ANYSEARCH_KEY_ENV], optional: true, note: 'optional: the anonymous tier is limited per IP and per day; an invalid key is not downgraded to anonymous' }],
  supportedFilters: [],
  costModel: { kind: 'free', unit: 'request', note: 'anonymous daily free quota per IP, then a paid key; requests counted in the usage ledger' },
  priority: 90,
  verification: { live: true, note: 'live 2026-10-02: 1 anonymous request answered 200 (fixture test/fixtures/anysearch-search.json); the 402 quota path was never triggered live and is covered by a synthetic test' },
}

export const anySearchAdapter: ProviderAdapter = {
  descriptor: ANYSEARCH_DESCRIPTOR,
  probeLocal: ({ deps }) => ({ available: true, installation: 'not_required', credential: (deps.anysearchApiKey?.length ?? 0) > 0 ? 'configured' : 'not_required' }),
  create: deps => anySearchEngine(deps),
  compile: (task, now) => compileSince(task, ANYSEARCH_ROUTE_ID, now, { lang: true }),
}
