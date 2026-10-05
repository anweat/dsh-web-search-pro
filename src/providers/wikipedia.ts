/**
 * Wikipedia (MediaWiki Action API `list=search`), anonymous. Contract source: https://www.mediawiki.org/wiki/API:Search
 * (`srsearch`, `srlimit`, `srnamespace`, `srprop`; `query.search[]` with `title`, `pageid`, `snippet`, `timestamp`;
 * the snippet carries `<span class="searchmatch">` markup; failures answer `{ error: { code, info } }`).
 *
 * The edition follows the task language (`zh.wikipedia.org` for Chinese, `en.wikipedia.org` otherwise). A reference
 * source for definitions and stable facts, not a replacement for web search.
 * @module web-search-pro/providers/wikipedia
 */

import type { WebSearchSource } from '@deepseek-ai/dsh-web'
import { EngineError, type Engine, type EngineDeps, type SearchOutcome } from '../engines.ts'
import { detectLang } from '../pipeline/align.ts'
import { compileKeywords } from '../pipeline/compile.ts'
import { stripTags } from '../util.ts'
import { recordRequest, requestProvider, safeDetail, statusFailure } from './http.ts'
import type { ProviderAdapter, ProviderDescriptor } from './registry.ts'

export const WIKIPEDIA_ROUTE_ID = 'wikipedia'
export const WIKIPEDIA_USAGE_PROVIDER = 'wikipedia'
const SNIPPET_CHARS = 400

export interface WikipediaHit { title?: string; pageid?: number; snippet?: string; timestamp?: string; wordcount?: number }

/** `zh` or `en` edition: the explicit option, else the query's own language. */
export function wikipediaLang(query: string, lang?: 'zh' | 'en'): 'zh' | 'en' {
  return lang ?? (detectLang(query) === 'zh' ? 'zh' : 'en')
}

export function wikipediaUrl(lang: 'zh' | 'en', count: number, query: string): string {
  const params = new URLSearchParams({
    action: 'query', list: 'search', format: 'json', formatversion: '2', utf8: '1',
    srsearch: query, srlimit: String(Math.min(Math.max(Math.floor(count), 1), 50)), srnamespace: '0', srprop: 'snippet|timestamp',
  })
  return 'https://' + lang + '.wikipedia.org/w/api.php?' + params.toString()
}

export function articleUrl(lang: 'zh' | 'en', title: string): string {
  return 'https://' + lang + '.wikipedia.org/wiki/' + encodeURIComponent(title.replace(/ /g, '_')).replace(/%3A/gi, ':').replace(/%2F/gi, '/')
}

/** `query.search[]` -> sources; snippet HTML stripped (the searchmatch spans, entities). Entries without a title are dropped. */
export function mapWikipedia(hits: readonly WikipediaHit[], lang: 'zh' | 'en', count: number): WebSearchSource[] {
  const sources: WebSearchSource[] = []
  for (const hit of hits) {
    const title = typeof hit?.title === 'string' ? hit.title.trim() : ''
    if (!title) continue
    // The match highlight is an inline span: drop it without a space (a space would split Chinese words).
    const snippet = typeof hit.snippet === 'string' ? stripTags(hit.snippet.replace(/<\/?span[^>]*>/gi, '')) : ''
    sources.push({
      url: articleUrl(lang, title), title,
      ...snippet ? { snippet: snippet.length > SNIPPET_CHARS ? snippet.slice(0, SNIPPET_CHARS) + '…' : snippet } : {},
      ...typeof hit.timestamp === 'string' && hit.timestamp ? { publishedAt: hit.timestamp } : {},
    })
    if (sources.length >= count) break
  }
  return sources
}

/** Parse a 2xx body: an `error` object throws (rate-limit codes are retryable), no hits is ENGINE_EMPTY. */
export function parseWikipedia(body: unknown, lang: 'zh' | 'en', count: number): WebSearchSource[] {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) throw new EngineError('Wikipedia returned an unprocessable response body', 'ENGINE_ERROR', true)
  const b = body as { error?: { code?: unknown; info?: unknown }; query?: { search?: unknown } }
  if (b.error) {
    const code = typeof b.error.code === 'string' ? b.error.code : 'unknown'
    const retryable = /ratelimit|maxlag|readonly|internal/i.test(code)
    throw new EngineError('Wikipedia API error ' + code + (typeof b.error.info === 'string' ? ': ' + safeDetail(b.error.info) : ''), code.toLowerCase().includes('ratelimit') ? 'ENGINE_RATE_LIMIT' : 'ENGINE_ERROR', retryable)
  }
  const search = b.query?.search
  if (!Array.isArray(search)) throw new EngineError('Wikipedia returned an unprocessable response body', 'ENGINE_ERROR', true)
  const sources = mapWikipedia(search as WikipediaHit[], lang, count)
  if (!sources.length) throw new EngineError('Wikipedia returned no results', 'ENGINE_EMPTY', true)
  return sources
}

export function wikipediaEngine(deps: EngineDeps): Engine {
  return {
    id: WIKIPEDIA_ROUTE_ID,
    label: 'Wikipedia',
    available: () => true,
    async search(query, count, signal, options): Promise<SearchOutcome> {
      const lang = wikipediaLang(query, options?.lang)
      const res = await requestProvider('Wikipedia', wikipediaUrl(lang, count, query), { deps, signal })
      if (!res.ok) throw statusFailure('Wikipedia', res.status, res.headers, safeDetail(typeof res.json === 'object' && res.json !== null ? (res.json as { error?: { info?: unknown } }).error?.info : undefined))
      recordRequest(deps, WIKIPEDIA_USAGE_PROVIDER)
      if (res.json === undefined) throw new EngineError('Wikipedia returned invalid JSON', 'ENGINE_ERROR', true)
      return { sources: parseWikipedia(res.json, lang, count) }
    },
  }
}

export const WIKIPEDIA_DESCRIPTOR: ProviderDescriptor = {
  id: 'builtin:wikipedia',
  aliases: [WIKIPEDIA_ROUTE_ID],
  label: 'Wikipedia',
  adapterVersion: '1',
  contractVersion: 1,
  operations: ['search'],
  taskProfiles: ['general', 'news_fact', 'compare'],
  languages: ['zh', 'en'],
  regions: ['global'],
  // `reference`, not `web`: a supplementary entry that S1 never promotes ahead of web search.
  resultKinds: ['reference'],
  sourceFamily: 'wikipedia',
  requirements: [],
  supportedFilters: [],
  costModel: { kind: 'free', note: 'anonymous MediaWiki API; requests counted in the usage ledger' },
  costTier: 'anonymous',
  priority: 80,
  verification: { live: true, note: 'live 2026-10-02: en and zh editions, fixtures test/fixtures/wikipedia-{en,zh}-search.json' },
}

export const wikipediaAdapter: ProviderAdapter = {
  descriptor: WIKIPEDIA_DESCRIPTOR,
  probeLocal: () => ({ available: true, installation: 'not_required', credential: 'not_required' }),
  create: deps => wikipediaEngine(deps),
  compile: (task, now) => compileKeywords(task, WIKIPEDIA_ROUTE_ID, now, { terms: 4, lang: true }),
}
