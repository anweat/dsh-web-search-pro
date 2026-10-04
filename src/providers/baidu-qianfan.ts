/**
 * Baidu Qianfan (百度千帆) AI Search — the plain web-search endpoint (keyed, Chinese): ranked `references[]` only, never
 * the chat-completions (`/v2/ai_search/chat/completions`) generated answer. Contract sources: the official page
 * https://ai.baidu.com/ai-doc/AppBuilder/pmaxd1hvy (endpoint, header table, request fields, `references[]` fields, error
 * shape, free quota; fetched 2026-10-03), the Qianfan v2 API conventions at https://cloud.baidu.com/doc/qianfan-api/s/3m7of64lb
 * (`Authorization: Bearer bce-v3/ALTAK-…`), and the MIT reference SDK `searchsuite` (providers/baidu.js) used by the MIT DSH plugin
 * `yugasun/dsh-plugins`.
 *
 * `POST https://qianfan.baidubce.com/v2/ai_search/web_search`, JSON `{ messages: [{ role: "user", content }], search_source:
 * "baidu_search_v2", resource_type_filter: [{ type: "web", top_k (<= 50) }], search_filter?: { match: { site: [<= 20 domains] },
 * range: { page_time: { gte: "YYYY-MM-DD" } } }, block_websites?: [domains] }`. 200: `references[]` of `{ id, title, url, content
 * (<= 2000 characters), date, type, website, ... }`; errors `{ code, message, request_id }` (216003 = authentication error, 400, 500).
 * Free quota 100 calls per day, up to 100000 per account per day.
 *
 * AMBIGUITY (the page contradicts itself): its header TABLE lists both `Authorization: Bearer <AppBuilder API Key>` and
 * `X-Appbuilder-Authorization: Bearer <AppBuilder API Key>`, its curl example sends only `X-Appbuilder-Authorization`, the newer
 * Qianfan v2 pages and the reference SDK send `Authorization`. Until a live call settles it the adapter sends BOTH headers with
 * the same bearer value (each one is listed by the official table). Other left out / unconfirmed: the query length limit (the
 * reference SDK cuts at 72 units, a CJK character counting 2: followed here), the `block_websites` size limit (capped at 20 like
 * the include list, the rest stays local), quota and QPS error codes (only 216003 is documented: quota is recognised by message
 * wording, a rate limit by HTTP 429), `edition`, `search_recency_filter` and `safe_search` are not used.
 * @module web-search-pro/providers/baidu-qianfan
 */

import type { WebSearchSource } from '@deepseek-ai/dsh-web'
import { EngineError } from '../engines.ts'
import { compileKeyed } from '../pipeline/compile.ts'
import { clamp, dayOf, emptyResults, errorCode, errorMessage, expectObject, isHttpUrl, keyedAdapter, keyedDescriptor, keyedFailure, snippetOf, textOf } from './keyed.ts'

export const BAIDU_ROUTE_ID = 'baidu-qianfan'
export const BAIDU_BASE = 'https://qianfan.baidubce.com'
export const BAIDU_PATH = '/v2/ai_search/web_search'
export const BAIDU_MAX_TOP_K = 50
export const BAIDU_MAX_SITES = 20
/** The reference SDK cuts the query at 72 units (a character outside ASCII counts 2). */
export const BAIDU_QUERY_UNITS = 72

/** Cut `text` to at most `units` units, a non-ASCII character counting 2. */
export function limitUnits(text: string, units: number): string {
  let used = 0
  let out = ''
  for (const ch of text.replace(/\s+/g, ' ').trim()) {
    const w = (ch.codePointAt(0) ?? 0) > 127 ? 2 : 1
    if (used + w > units) break
    used += w
    out += ch
  }
  return out.trim()
}

export interface BaiduBody {
  messages: { role: 'user'; content: string }[]
  search_source: 'baidu_search_v2'
  resource_type_filter: { type: 'web'; top_k: number }[]
  search_filter?: { match?: { site: string[] }; range?: { page_time: { gte: string } } }
  block_websites?: string[]
}

export function baiduBody(query: string, count: number, options?: { sites?: { include?: string[]; exclude?: string[] }; since?: string }): BaiduBody {
  const include = options?.sites?.include?.slice(0, BAIDU_MAX_SITES)
  const exclude = options?.sites?.exclude?.slice(0, BAIDU_MAX_SITES)
  const filter = {
    ...include?.length ? { match: { site: include } } : {},
    ...options?.since ? { range: { page_time: { gte: dayOf(options.since) } } } : {},
  }
  return {
    messages: [{ role: 'user', content: limitUnits(query, BAIDU_QUERY_UNITS) }],
    search_source: 'baidu_search_v2',
    resource_type_filter: [{ type: 'web', top_k: clamp(count, 1, BAIDU_MAX_TOP_K) }],
    ...Object.keys(filter).length ? { search_filter: filter } : {},
    ...exclude?.length ? { block_websites: exclude } : {},
  }
}

export function mapBaidu(references: readonly unknown[], count: number): WebSearchSource[] {
  const sources: WebSearchSource[] = []
  for (const r of references) {
    const row = (r ?? {}) as Record<string, unknown>
    if ((row.type !== undefined && row.type !== 'web') || !isHttpUrl(row.url)) continue
    const title = textOf(row.title)
    const snippet = snippetOf(row.content) ?? snippetOf(row.snippet)
    const publishedAt = textOf(row.date)
    sources.push({ url: row.url.trim(), ...title ? { title } : {}, ...snippet ? { snippet } : {}, ...publishedAt ? { publishedAt } : {} })
    if (sources.length >= count) break
  }
  return sources
}

/** 216003 is the documented authentication error code; other failures follow the HTTP status and the message wording. */
export function baiduFailure(status: number, headers: Headers, json: unknown): EngineError {
  const code = errorCode(json)
  const detail = errorMessage(json)
  if (code === '216003') return new EngineError('Baidu Qianfan rejected the API key (code 216003' + (detail ? ': ' + detail : '') + '; check which header the account expects)', 'ENGINE_AUTH', false)
  return keyedFailure('Baidu Qianfan', status, headers, detail)
}

export function parseBaidu(json: unknown, count: number, headers: Headers = new Headers()): WebSearchSource[] {
  const body = expectObject('Baidu Qianfan', json)
  // An error envelope ({ code, message }) can arrive with a 2xx status.
  if (body.references === undefined && errorCode(body) && Number(errorCode(body)) !== 0) throw baiduFailure(200, headers, json)
  if (body.references === undefined) throw emptyResults('Baidu Qianfan')
  if (!Array.isArray(body.references)) throw new EngineError('Baidu Qianfan returned an unprocessable response body', 'ENGINE_ERROR', true)
  const sources = mapBaidu(body.references, count)
  if (!sources.length) throw emptyResults('Baidu Qianfan')
  return sources
}

export const BAIDU_DESCRIPTOR = keyedDescriptor({
  route: BAIDU_ROUTE_ID,
  label: 'Baidu Qianfan (百度千帆) AI search',
  languages: ['zh'],
  regions: ['cn'],
  sourceFamily: 'baidu',
  supportedFilters: ['site', 'exclude_site', 'time_window'],
  priority: 40,
  costTier: 'free-quota',
  costNote: 'free quota of 100 calls per day, then paid post-payment (https://ai.baidu.com/ai-doc/AppBuilder/pmaxd1hvy); the plugin counts requests (provider baidu-qianfan), the price is unknown to it',
  verificationNote: 'contract from the official page (header names contradict each other: both are sent), v2 conventions and the MIT searchsuite SDK; never called live (no key)',
})

export const baiduAdapter = keyedAdapter(BAIDU_DESCRIPTOR, {
  defaultBase: BAIDU_BASE,
  path: BAIDU_PATH,
  request: (query, count, options) => ({
    method: 'POST',
    body: baiduBody(query, count, options),
    // The official table lists both header names; the curl example uses the second, the v2 SDK the first.
    headers: key => ({ 'authorization': 'Bearer ' + key, 'x-appbuilder-authorization': 'Bearer ' + key, 'accept': 'application/json' }),
  }),
  failure: res => baiduFailure(res.status, res.headers, res.json),
  parse: (json, count) => parseBaidu(json, count),
}, (task, now) => compileKeyed(task, BAIDU_ROUTE_ID, now, { include: BAIDU_MAX_SITES, exclude: BAIDU_MAX_SITES, since: true }))
