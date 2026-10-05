/**
 * Zhipu (智谱) Web Search API (keyed, Chinese). Only the raw `search_result` of the standalone search endpoint is used: GLM
 * generated answers (the chat-completions `web_search` tool) are a different product and are never mixed in. Contract sources:
 * the official guide https://docs.bigmodel.cn/cn/guide/tools/web-search, the API reference
 * https://docs.bigmodel.cn/api-reference/工具-api/网络搜索 (request fields, example, `search_result` fields, error 1701-1703) and the
 * error-code page https://docs.bigmodel.cn/cn/faq/api-code (fetched 2026-10-03).
 *
 * `POST https://open.bigmodel.cn/api/paas/v4/web_search`, `Authorization: Bearer <key>`, JSON `{ search_query (<= 70 characters),
 * search_engine (search_std | search_pro | search_pro_sogou | search_pro_quark; search_std is the cheapest), search_intent (false),
 * count (1-50), search_domain_filter (one domain), search_recency_filter (oneDay | oneWeek | oneMonth | oneYear | noLimit),
 * content_size (medium | high) }`. 200: `search_result[]` of `{ title, content, link, media, icon, refer, publish_date }`.
 * Errors `{ error: { code, message } }`: 1000-1003 auth, 1113 overdue, 1302 rate, 1308-1310 quota windows, 1701 search concurrency,
 * 1702 no search service, 1703 invalid search answer.
 *
 * Ambiguous / left out: HTTP statuses of the search-specific codes 1701-1703 are not documented, so the business code decides;
 * `search_domain_filter` takes ONE domain (a single hard `site` is native, more stay local; there is no exclude field);
 * the recency filter is native only for an exact day / week / month / year window (a wider bucket is sent as a recall hint and
 * the constraint is still verified locally); `search_intent`, `request_id`, `user_id` are not used; the pro / sogou / quark engines
 * (other prices) are not selectable.
 * @module web-search-pro/providers/zhipu
 */

import type { WebSearchSource } from '@deepseek-ai/dsh-web'
import { EngineError } from '../engines.ts'
import { compileKeyed, hardWindows } from '../pipeline/compile.ts'
import { clamp, emptyResults, errorCode, errorMessage, expectObject, isHttpUrl, keyedAdapter, keyedDescriptor, keyedFailure, limitQuery, snippetOf, textOf } from './keyed.ts'

export const ZHIPU_ROUTE_ID = 'zhipu'
export const ZHIPU_BASE = 'https://open.bigmodel.cn'
export const ZHIPU_PATH = '/api/paas/v4/web_search'
export const ZHIPU_MAX_COUNT = 50
export const ZHIPU_QUERY_CHARS = 70

export type ZhipuRecency = 'oneDay' | 'oneWeek' | 'oneMonth' | 'oneYear'
const BUCKETS: readonly [ZhipuRecency, number][] = [['oneDay', 1], ['oneWeek', 7], ['oneMonth', 30], ['oneYear', 365]]
const DAY = 86_400_000
const SLACK = 0.05

/** The smallest recency bucket that covers a window starting at `since`; undefined beyond a year. */
export function zhipuRecency(since: string, now: number = Date.now()): ZhipuRecency | undefined {
  const days = (now - Date.parse(since)) / DAY
  if (!Number.isFinite(days) || days < 0) return undefined
  return BUCKETS.find(([, n]) => days <= n + SLACK)?.[0]
}

/** The window is exactly one of the buckets (a translation, so it counts as native). */
export function zhipuExactRecency(since: string, now: number): boolean {
  const days = (now - Date.parse(since)) / DAY
  return BUCKETS.some(([, n]) => Math.abs(days - n) <= SLACK)
}

export interface ZhipuBody {
  search_query: string
  search_engine: 'search_std'
  search_intent: false
  count: number
  content_size: 'medium'
  search_domain_filter?: string
  search_recency_filter?: ZhipuRecency
}

export function zhipuBody(query: string, count: number, options?: { sites?: { include?: string[] }; since?: string }, now: number = Date.now()): ZhipuBody {
  const domain = options?.sites?.include?.[0]
  const recency = options?.since ? zhipuRecency(options.since, now) : undefined
  return {
    search_query: limitQuery(query, ZHIPU_QUERY_CHARS),
    search_engine: 'search_std',
    search_intent: false,
    count: clamp(count, 1, ZHIPU_MAX_COUNT),
    content_size: 'medium',
    ...domain ? { search_domain_filter: domain } : {},
    ...recency ? { search_recency_filter: recency } : {},
  }
}

export function mapZhipu(results: readonly unknown[], count: number): WebSearchSource[] {
  const sources: WebSearchSource[] = []
  for (const r of results) {
    const row = (r ?? {}) as Record<string, unknown>
    if (!isHttpUrl(row.link)) continue
    const title = textOf(row.title)
    const snippet = snippetOf(row.content)
    const publishedAt = textOf(row.publish_date)
    sources.push({ url: row.link.trim(), ...title ? { title } : {}, ...snippet ? { snippet } : {}, ...publishedAt ? { publishedAt } : {} })
    if (sources.length >= count) break
  }
  return sources
}

/** Failure by the business code (the HTTP status of these is not always documented), else by status. */
export function zhipuFailure(status: number, headers: Headers, json: unknown): EngineError {
  const code = errorCode(json)
  const detail = errorMessage(json)
  const tail = code ? ' [code ' + code + ']' : ''
  if (/^100[0-5]$/.test(code)) return new EngineError('Zhipu rejected the API key (HTTP ' + status + tail + (detail ? ': ' + detail : '') + ')', 'ENGINE_AUTH', false)
  if (['1113', '1308', '1309', '1310'].includes(code)) return new EngineError('Zhipu: ' + (detail || 'no balance or quota') + tail + ' (the account has no balance or quota for this API)', 'ENGINE_QUOTA', false)
  if (['1302', '1303', '1305', '1701'].includes(code)) {
    const wait = Number(headers.get('retry-after'))
    return new EngineError('Zhipu rate limit' + tail + (detail ? ': ' + detail : ''), 'ENGINE_RATE_LIMIT', true, Number.isFinite(wait) && headers.get('retry-after') ? Math.round(wait * 1000) : undefined)
  }
  if (['1210', '1261', '1301'].includes(code)) return new EngineError('Zhipu rejected the request' + tail + (detail ? ': ' + detail : ''), 'ENGINE_ERROR', false)
  if (['1702', '1703'].includes(code)) return new EngineError('Zhipu search service error' + tail + (detail ? ': ' + detail : ''), 'ENGINE_ERROR', true)
  return keyedFailure('Zhipu', status, headers, detail)
}

export function parseZhipu(json: unknown, count: number, headers: Headers = new Headers()): WebSearchSource[] {
  const body = expectObject('Zhipu', json)
  // An error envelope can arrive with a 2xx status.
  if (body.error && typeof body.error === 'object' && body.search_result === undefined) throw zhipuFailure(200, headers, json)
  if (!Array.isArray(body.search_result)) throw new EngineError('Zhipu returned an unprocessable response body', 'ENGINE_ERROR', true)
  const sources = mapZhipu(body.search_result, count)
  if (!sources.length) throw emptyResults('Zhipu')
  return sources
}

export const ZHIPU_DESCRIPTOR = keyedDescriptor({
  route: ZHIPU_ROUTE_ID,
  label: 'Zhipu (智谱) Web Search',
  languages: ['zh'],
  regions: ['cn'],
  supportedFilters: ['site', 'time_window'],
  priority: 30,
  costTier: 'paid',
  costNote: 'metered per request, no free allowance stated (search_std 0.01 CNY, search_pro 0.03 CNY per https://docs.bigmodel.cn/cn/guide/tools/web-search, read 2026-10-04); the plugin counts requests (provider zhipu), the price is unknown to it',
  verificationNote: 'contract from the official guide, API reference and error-code page; never called live (no key); raw search_result only',
})

export const zhipuAdapter = keyedAdapter(ZHIPU_DESCRIPTOR, {
  defaultBase: ZHIPU_BASE,
  path: ZHIPU_PATH,
  request: (query, count, options) => ({
    method: 'POST',
    body: zhipuBody(query, count, options),
    headers: key => ({ authorization: 'Bearer ' + key, accept: 'application/json' }),
  }),
  failure: res => zhipuFailure(res.status, res.headers, res.json),
  parse: (json, count) => parseZhipu(json, count),
}, (task, now) => {
  // One domain only, and a recency bucket: native when the window IS a bucket, otherwise a hint with the constraint kept local.
  const base = compileKeyed(task, ZHIPU_ROUTE_ID, now, { include: 1 })
  const windows = hardWindows(task, now)
  if (!windows.length) return base
  const since = windows[0]!.start
  if (!zhipuRecency(since, now.getTime())) return base
  const exact = zhipuExactRecency(since, now.getTime())
  const native = exact ? [...base.native, ...windows.map(x => x.c.id)] : base.native
  const done = new Set(native)
  return { ...base, options: { ...base.options, since }, native, local: task.constraints.map(c => c.id).filter(id => !done.has(id)) }
})
