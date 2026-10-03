/**
 * Metaso (秘塔) search API (keyed, Chinese). First scope: `webpage` only; the `/reader` endpoint (page text as markdown) is
 * left for later. Contract sources: the official playground / docs entry https://metaso.cn/search-api/playground is a
 * script-rendered page that could not be read from here, so the contract comes from two MIT DSH / MCP reference
 * implementations that agree on it: `TZHR-invest/dsh-plugins` packages/dsh-web-search-metaso (index.js) and
 * `HundunOnline/mcp-metaso` (server.py), checked 2026-10-03.
 *
 * `POST https://metaso.cn/api/v1/search`, `Authorization: Bearer <key>`, JSON `{ q, scope: "webpage", includeSummary, size }`.
 * 200: `webpages[]` of `{ title, link, snippet, summary?, date | displayDate }` (`summary` only appears when `includeSummary`
 * is asked for; it is not requested here, so the raw `snippet` is used). Metaso also answers questions and returns generated
 * summaries; none of that is requested or read.
 *
 * Ambiguous / left out: the two references disagree on the `size` ceiling (100 vs 20) and on whether it is sent as a number or
 * a string, so the adapter asks for at most 20 and sends a number; the date key is `date` in one and `displayDate` in the other
 * (both are read); the error envelope and quota semantics are not documented anywhere readable (the shared status mapping
 * applies, and a message that says balance / quota is `ENGINE_QUOTA`); no filter (site / time / language) is documented, so
 * every constraint is verified locally; other scopes (document, scholar, image, video, podcast) and `/reader` are not implemented.
 * @module web-search-pro/providers/metaso
 */

import type { WebSearchSource } from '@deepseek-ai/dsh-web'
import { EngineError } from '../engines.ts'
import { compileKeyed } from '../pipeline/compile.ts'
import { clamp, emptyResults, errorMessage, expectObject, isHttpUrl, keyedAdapter, keyedDescriptor, keyedFailure, snippetOf, textOf } from './keyed.ts'

export const METASO_ROUTE_ID = 'metaso'
export const METASO_BASE = 'https://metaso.cn'
export const METASO_PATH = '/api/v1/search'
export const METASO_MAX_SIZE = 20

export interface MetasoBody { q: string; scope: 'webpage'; includeSummary: false; size: number }

export function metasoBody(query: string, count: number): MetasoBody {
  return { q: query, scope: 'webpage', includeSummary: false, size: clamp(count, 1, METASO_MAX_SIZE) }
}

export function mapMetaso(pages: readonly unknown[], count: number): WebSearchSource[] {
  const sources: WebSearchSource[] = []
  const seen = new Set<string>()
  for (const p of pages) {
    const row = (p ?? {}) as Record<string, unknown>
    if (!isHttpUrl(row.link)) continue
    const url = row.link.trim()
    if (seen.has(url)) continue
    seen.add(url)
    const title = textOf(row.title)
    const snippet = snippetOf(row.summary) ?? snippetOf(row.snippet)
    const publishedAt = textOf(row.date) ?? textOf(row.displayDate)
    sources.push({ url, ...title ? { title } : {}, ...snippet ? { snippet } : {}, ...publishedAt ? { publishedAt } : {} })
    if (sources.length >= count) break
  }
  return sources
}

export function parseMetaso(json: unknown, count: number): WebSearchSource[] {
  const body = expectObject('Metaso', json)
  if (!Array.isArray(body.webpages)) throw new EngineError('Metaso returned an unprocessable response body', 'ENGINE_ERROR', true)
  const sources = mapMetaso(body.webpages, count)
  if (!sources.length) throw emptyResults('Metaso')
  return sources
}

export function metasoFailure(status: number, headers: Headers, json: unknown): EngineError {
  return keyedFailure('Metaso', status, headers, errorMessage(json))
}

export const METASO_DESCRIPTOR = keyedDescriptor({
  route: METASO_ROUTE_ID,
  label: 'Metaso (秘塔)',
  languages: ['zh'],
  regions: ['cn'],
  supportedFilters: [],
  priority: 20,
  costNote: 'metered per request from a Metaso API plan; the plugin counts requests (provider metaso), the price is unknown to it',
  verificationNote: 'official docs page not readable (script-rendered): contract from two MIT references (TZHR-invest dsh-web-search-metaso, HundunOnline mcp-metaso); webpage scope only; never called live (no key)',
})

export const metasoAdapter = keyedAdapter(METASO_DESCRIPTOR, {
  defaultBase: METASO_BASE,
  path: METASO_PATH,
  request: (query, count) => ({
    method: 'POST',
    body: metasoBody(query, count),
    headers: key => ({ authorization: 'Bearer ' + key, accept: 'application/json' }),
  }),
  failure: res => metasoFailure(res.status, res.headers, res.json),
  parse: parseMetaso,
}, (task, now) => compileKeyed(task, METASO_ROUTE_ID, now, {}))
