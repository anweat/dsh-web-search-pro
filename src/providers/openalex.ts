/**
 * OpenAlex works search (academic), anonymous. Contract source: https://help.openalex.org/ (llms.txt index):
 * `GET https://api.openalex.org/works?search=…&per_page=…&select=…` (`select` takes root-level fields only),
 * `filter=from_publication_date:YYYY-MM-DD`, abstracts as `abstract_inverted_index` ({word: [positions]}),
 * 400 for a bad request, 429 when the daily budget or 100 requests/second is exceeded; every response has
 * `X-RateLimit-Remaining` / `X-RateLimit-Reset` (seconds until midnight UTC). Keyless use draws a small budget;
 * a free key (`OPENALEX_API_KEY`, sent as a bearer token, never in the URL) raises it tenfold.
 *
 * The documentation no longer describes a `mailto` polite pool: the configured contact address (`openalexMailto`)
 * is put in the User-Agent instead, which is plain etiquette and never breaks a request.
 * @module web-search-pro/providers/openalex
 */

import type { WebSearchSource } from '@deepseek-ai/dsh-web'
import { EngineError, type Engine, type EngineDeps, type SearchOutcome } from '../engines.ts'
import { compileSince } from '../pipeline/compile.ts'
import { Blocker, isoDay, PROVIDER_USER_AGENT, recordRequest, requestProvider, safeDetail, secondsHeaderMs, statusFailure } from './http.ts'
import type { ProviderAdapter, ProviderDescriptor } from './registry.ts'

export const OPENALEX_ROUTE_ID = 'openalex'
export const OPENALEX_USAGE_PROVIDER = 'openalex'
export const OPENALEX_KEY_ENV = 'OPENALEX_API_KEY'
const SNIPPET_CHARS = 500
export const openAlexBlock = new Blocker()

export interface OpenAlexWork {
  id?: string
  doi?: string | null
  display_name?: string | null
  title?: string | null
  publication_year?: number | null
  publication_date?: string | null
  cited_by_count?: number | null
  type?: string | null
  abstract_inverted_index?: Record<string, number[]> | null
  primary_location?: { landing_page_url?: string | null; source?: { display_name?: string | null } | null } | null
}

const SELECT = 'id,doi,display_name,publication_year,publication_date,cited_by_count,type,abstract_inverted_index,primary_location'

export function openAlexUrl(query: string, count: number, since?: string): string {
  const params = new URLSearchParams({ search: query, per_page: String(Math.min(Math.max(Math.floor(count), 1), 100)), select: SELECT })
  if (since) params.set('filter', 'from_publication_date:' + isoDay(since))
  return 'https://api.openalex.org/works?' + params.toString()
}

/** Rebuild the abstract text from the inverted index (`{word: [positions]}`); empty when absent or malformed. */
export function reconstructAbstract(index: Record<string, number[]> | null | undefined): string {
  if (!index || typeof index !== 'object') return ''
  const words: string[] = []
  for (const [word, positions] of Object.entries(index)) {
    if (!Array.isArray(positions)) continue
    for (const p of positions) if (Number.isInteger(p) && p >= 0 && p < 100_000) words[p] = word
  }
  return words.filter(w => w !== undefined).join(' ').trim()
}

/** Works -> sources: the DOI URL, else the landing page, else the OpenAlex id; snippet = venue, year, citations, abstract. */
export function mapOpenAlex(works: readonly OpenAlexWork[], count: number): WebSearchSource[] {
  const sources: WebSearchSource[] = []
  for (const w of works) {
    const title = (typeof w?.display_name === 'string' ? w.display_name : typeof w?.title === 'string' ? w.title : '').trim()
    const candidates = [w?.doi, w?.primary_location?.landing_page_url, w?.id]
    const url = candidates.find((u): u is string => typeof u === 'string' && /^https?:\/\//i.test(u))
    if (!url || !title) continue
    const venue = w.primary_location?.source?.display_name
    const meta = [typeof venue === 'string' && venue ? venue : undefined, typeof w.publication_year === 'number' ? String(w.publication_year) : undefined, typeof w.cited_by_count === 'number' ? 'cited by ' + w.cited_by_count : undefined].filter(Boolean).join(', ')
    const abstract = reconstructAbstract(w.abstract_inverted_index)
    const snippet = [meta, abstract].filter(Boolean).join(' — ')
    sources.push({
      url, title,
      ...snippet ? { snippet: snippet.length > SNIPPET_CHARS ? snippet.slice(0, SNIPPET_CHARS) + '…' : snippet } : {},
      ...typeof w.publication_date === 'string' && w.publication_date ? { publishedAt: w.publication_date } : {},
    })
    if (sources.length >= count) break
  }
  return sources
}

export function parseOpenAlex(body: unknown, count: number): WebSearchSource[] {
  if (body === null || typeof body !== 'object' || Array.isArray(body) || !Array.isArray((body as { results?: unknown }).results)) throw new EngineError('OpenAlex returned an unprocessable response body', 'ENGINE_ERROR', true)
  const sources = mapOpenAlex((body as { results: OpenAlexWork[] }).results, count)
  if (!sources.length) throw new EngineError('OpenAlex returned no results', 'ENGINE_EMPTY', true)
  return sources
}

/** 429 with no budget left is the daily budget (not a burst): not retryable, remembered until the reset; otherwise the shared mapping. */
export function openAlexFailure(status: number, headers: Headers, body: unknown): EngineError {
  const detail = safeDetail(body !== null && typeof body === 'object' ? (body as { message?: unknown; error?: unknown }).message ?? (body as { error?: unknown }).error : undefined)
  if (status === 429 && headers.get('x-ratelimit-remaining') === '0') {
    const reset = secondsHeaderMs(headers.get('x-ratelimit-reset')) ?? 3_600_000
    openAlexBlock.block(reset, 'ENGINE_QUOTA', 'daily budget used up (a free OPENALEX_API_KEY raises it tenfold)')
    return new EngineError('OpenAlex quota exhausted: daily budget used up; resets in ' + Math.ceil(reset / 60_000) + ' min (a free ' + OPENALEX_KEY_ENV + ' raises it tenfold)', 'ENGINE_QUOTA', false)
  }
  const err = statusFailure('OpenAlex', status, headers, detail)
  if (status === 429 && err.retryAfterMs === undefined) return new EngineError(err.message, err.code, true, secondsHeaderMs(headers.get('x-ratelimit-reset')) ? Math.min(secondsHeaderMs(headers.get('x-ratelimit-reset'))!, 60_000) : undefined)
  return err
}

export function openAlexEngine(deps: EngineDeps): Engine {
  return {
    id: OPENALEX_ROUTE_ID,
    label: 'OpenAlex',
    available: () => true,
    async search(query, count, signal, options): Promise<SearchOutcome> {
      openAlexBlock.check('OpenAlex')
      const contact = deps.openalexMailto?.trim()
      const res = await requestProvider('OpenAlex', openAlexUrl(query, count, options?.since), {
        deps, signal,
        ...contact ? { userAgent: PROVIDER_USER_AGENT.replace('; polite', '; mailto:' + contact + '; polite') } : {},
        ...deps.openalexApiKey ? { headers: { authorization: 'Bearer ' + deps.openalexApiKey } } : {},
      })
      if (!res.ok) throw openAlexFailure(res.status, res.headers, res.json)
      recordRequest(deps, OPENALEX_USAGE_PROVIDER)
      if (res.json === undefined) throw new EngineError('OpenAlex returned invalid JSON', 'ENGINE_ERROR', true)
      return { sources: parseOpenAlex(res.json, count) }
    },
  }
}

export const OPENALEX_DESCRIPTOR: ProviderDescriptor = {
  id: 'builtin:openalex',
  aliases: [OPENALEX_ROUTE_ID],
  label: 'OpenAlex',
  adapterVersion: '1',
  contractVersion: 1,
  operations: ['search'],
  taskProfiles: ['academic'],
  languages: ['en'],
  regions: ['global'],
  resultKinds: ['paper'],
  sourceFamily: 'openalex',
  requirements: [{ kind: 'key', id: 'openalex-key', env: [OPENALEX_KEY_ENV], optional: true, note: 'optional: a free key raises the daily budget tenfold' }],
  supportedFilters: ['time_window'],
  costModel: { kind: 'free', unit: 'request', note: 'keyless budget is small (a search call costs $0.001 against it); a free key gives ten times more; requests counted in the usage ledger' },
  costTier: 'anonymous',
  priority: 80,
  verification: { live: true, note: 'live 2026-10-02: 2 requests (plain and from_publication_date), fixture test/fixtures/openalex-works.json' },
}

export const openAlexAdapter: ProviderAdapter = {
  descriptor: OPENALEX_DESCRIPTOR,
  probeLocal: ({ deps }) => ({ available: true, installation: 'not_required', credential: (deps.openalexApiKey?.length ?? 0) > 0 ? 'configured' : 'not_required' }),
  create: deps => openAlexEngine(deps),
  compile: (task, now) => compileSince(task, OPENALEX_ROUTE_ID, now, { since: true }),
}
