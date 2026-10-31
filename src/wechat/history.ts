/**
 * Client of the user's own whole-account history service, `tmwgsicp/wechat-download-api` (AGPL-3.0: a separate program the user
 * runs and logs in to; nothing of its code is used here, only its REST endpoints are called).
 *
 * VERIFICATION: contract-only. Read from its source (routes/search.py, routes/articles.py, routes/admin.py, utils/wechat_status.py at
 * 043c2f9), never run. Facts the client relies on:
 *  - the REST API has no client authentication; business failures are HTTP 200 with `{ success: false, error }`, so the HTTP status
 *    is not trusted;
 *  - `GET /api/public/searchbiz?query=` -> `data: { list: [{ fakeid, nickname, alias, service_type }], total }` (always the first 5);
 *  - `GET /api/public/articles?fakeid&begin&count<=100[&keyword]` -> `data: { articles: [{ aid, title, link, update_time,
 *    create_time, digest, author }], total, begin, count }`; `begin` / `count` index WeChat's publish batches, one batch can hold
 *    several articles, so the next `begin` is `begin + requested count`, not `begin + articles.length`;
 *  - an expired login is the string "微信登录已过期，请到管理面板重新扫码登录后再试" (searchbiz and articles), "服务器未登录…" (never logged in);
 *    the articles route swallows its own 401 and answers "服务器内部错误，请稍后重试" for a missing login; WeChat's frequency limit
 *    `ret=200013` is not handled by the service and shows up inside "获取文章列表失败: ret=200013, msg=freq control";
 *  - `GET /api/health` is liveness only; `GET /api/admin/status` says whether a login is stored and whether its 4-day clock ran out
 *    (`isExpired` is a local clock check, not a probe of WeChat).
 *
 * The configured address is typically loopback (`http://127.0.0.1:5000`): only that exact origin is exempt from the private-network
 * refusal of the safe HTTP path ({@link ../safe-http.isAllowedOrigin}); redirects are refused outright, and the pause between two
 * requests is at least `wechat.history.minIntervalMs` because the service itself does not throttle these routes.
 * @module web-search-pro/wechat/history
 */

import type { EngineDeps } from '../engines.ts'
import { EngineError } from '../engine-error.ts'
import { requestProvider } from '../providers/http.ts'
import { attachNotices, notice } from './notices.ts'
import { noteLayerFailure, noteLayerOk } from './health.ts'
import { createThrottle, type Throttle } from './sogou.ts'

export type HistoryFailure = 'unreachable' | 'login-expired' | 'rate-limited' | 'maybe-not-logged-in' | 'service-error' | 'bad-response'

/** A failure of the history service with its kind; the user-facing notices hang on it (see {@link attachNotices}). */
export class HistoryError extends Error {
  constructor(message: string, readonly kind: HistoryFailure) {
    super(message)
    this.name = 'HistoryError'
  }
}

export interface HistorySettings { baseUrl: string; minIntervalMs: number }

export interface HistoryAccount { fakeid: string; nickname: string; alias: string; serviceType: number }
export interface HistoryArticle { title: string; url: string; publishedAt?: string; digest?: string; author?: string; aid?: string }

const isRecord = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value)
const str = (value: unknown): string => (typeof value === 'string' ? value.trim() : typeof value === 'number' && Number.isFinite(value) ? String(value) : '')

/** The base URL without trailing slashes and its origin; undefined when it is not an http(s) URL without credentials. */
export function historyBase(baseUrl: string): { base: string; origin: string } | undefined {
  try {
    const u = new URL(baseUrl.trim())
    if ((u.protocol !== 'http:' && u.protocol !== 'https:') || u.username || u.password || u.search || u.hash) return undefined
    return { base: (u.origin + u.pathname).replace(/\/+$/, ''), origin: u.origin }
  } catch { return undefined }
}

const throttles = new Map<string, Throttle>()
/** The process-wide throttle of one service origin. */
function throttleOf(origin: string): Throttle {
  let t = throttles.get(origin)
  if (!t) { t = createThrottle(); throttles.set(origin, t) }
  return t
}
/** Forget the throttles (tests). */
export function resetHistoryThrottles(): void { throttles.clear() }

const LOGIN = /登录已(?:过期|失效)|未登录|重新扫码|请先.{0,8}扫码登录|invalid session|invalid csrf/i
const FREQ = /ret=200013|200013|频繁|freq/i

/** The failure a `success: false` error text of the service stands for (the strings are the service's own, see the module header). */
export function classifyHistoryError(text: string, what: string): HistoryError {
  const reason = text.replace(/\s+/g, ' ').trim().slice(0, 240)
  if (FREQ.test(text)) return attachNotices(new HistoryError('WeChat rate-limited your account back end (' + reason + '): stop for a while', 'rate-limited'), [notice('wechat.rate-limited', notice('wechat.rate-limited').message + '（服务返回：' + reason + '）')])
  if (LOGIN.test(text)) return attachNotices(new HistoryError('the history service is not logged in to WeChat, or the login expired (' + reason + ')', 'login-expired'), [notice('wechat.login-expired')])
  if (/服务器内部错误/.test(text)) return new HistoryError('the history service answered "' + reason + '" to ' + what + ': on this route that usually means it is NOT LOGGED IN (the service swallows its own 401 into this text). Run wechat.status with probe=true to check the login; if it is logged in, look at the service\'s own log', 'maybe-not-logged-in')
  return new HistoryError('the history service reported: ' + (reason || 'an error without a text'), 'service-error')
}

export interface HistoryClient {
  readonly baseUrl: string
  searchAccounts(query: string, signal?: AbortSignal): Promise<{ accounts: HistoryAccount[]; total: number }>
  listArticles(input: { fakeid: string; begin: number; count: number; keyword?: string }, signal?: AbortSignal): Promise<{ articles: HistoryArticle[]; total?: number }>
  /** `GET /api/health` (liveness) and `GET /api/admin/status` (stored login), bare objects. */
  health(signal?: AbortSignal): Promise<Record<string, unknown>>
  loginStatus(signal?: AbortSignal): Promise<Record<string, unknown>>
}

export interface HistorySeams { throttle?: Throttle }

/** The client for a configured service; throws when `baseUrl` is not usable (callers check {@link historyBase} first for a friendlier message). */
export function createHistoryClient(deps: Pick<EngineDeps, 'allowProxyFakeIp' | 'fetchImpl' | 'lookup'>, settings: HistorySettings, seams: HistorySeams = {}): HistoryClient {
  const parsed = historyBase(settings.baseUrl)
  if (!parsed) throw new Error('wechat.history.baseUrl is not an http(s) URL')
  const { base, origin } = parsed
  const throttle = seams.throttle ?? throttleOf(origin)

  async function get(path: string, params: Record<string, string | undefined>, what: string, signal: AbortSignal | undefined): Promise<{ status: number; json: unknown; text: string }> {
    const q = new URLSearchParams()
    for (const [k, v] of Object.entries(params)) if (v !== undefined) q.set(k, v)
    const url = base + path + (q.size ? '?' + q.toString() : '')
    await throttle.wait(settings.minIntervalMs, signal)
    try {
      const res = await requestProvider('wechat-download-api', url, { deps, signal, redirect: 'error', allowOrigin: origin, timeoutMs: 30_000 })
      return { status: res.status, json: res.json, text: res.text }
    } catch (error) {
      if (signal?.aborted) throw error
      const why = error instanceof EngineError ? error.message : error instanceof Error ? error.message : String(error)
      throw new HistoryError('cannot reach your wechat-download-api at ' + origin + ' (' + why.slice(0, 160) + '): the service has to be running and wechat.history.baseUrl has to point at it (the plugin never starts it)', 'unreachable')
    }
  }

  /** A route that answers the `{ success, data, error }` envelope. */
  async function envelope(path: string, params: Record<string, string | undefined>, what: string, signal: AbortSignal | undefined): Promise<unknown> {
    try {
      const res = await get(path, params, what, signal)
      if (res.status === 404) throw new HistoryError('the service at ' + origin + ' answered HTTP 404 to ' + what + ': this does not look like wechat-download-api (check the address, the port and any path prefix)', 'bad-response')
      if (!isRecord(res.json)) {
        throw new HistoryError('the service at ' + origin + ' answered something that is not JSON to ' + what + ' (HTTP ' + res.status + '): is this wechat-download-api?', res.status >= 500 ? 'service-error' : 'bad-response')
      }
      if (res.json.success === false) throw classifyHistoryError(str(res.json.error), what)
      if (res.json.success !== true) {
        const detail = str(res.json.detail) || str(res.json.error)
        throw new HistoryError('the service answered without a success flag to ' + what + ' (HTTP ' + res.status + (detail ? ': ' + detail.slice(0, 120) : '') + '): is this wechat-download-api?', 'bad-response')
      }
      noteLayerOk('history')
      return res.json.data
    } catch (error) {
      if (!signal?.aborted) noteLayerFailure('history', error)
      throw error
    }
  }

  async function bare(path: string, what: string, signal: AbortSignal | undefined): Promise<Record<string, unknown>> {
    try {
      const res = await get(path, {}, what, signal)
      if (!isRecord(res.json)) throw new HistoryError('the service at ' + origin + ' answered something that is not JSON to ' + what + ' (HTTP ' + res.status + '): is this wechat-download-api?', 'bad-response')
      return res.json
    } catch (error) {
      if (!signal?.aborted) noteLayerFailure('history', error)
      throw error
    }
  }

  return {
    baseUrl: base,
    async searchAccounts(query, signal) {
      const data = await envelope('/api/public/searchbiz', { query }, 'the account search', signal)
      const list = isRecord(data) && Array.isArray(data.list) ? data.list : []
      const accounts: HistoryAccount[] = []
      for (const item of list) {
        if (!isRecord(item) || !str(item.fakeid)) continue
        accounts.push({ fakeid: str(item.fakeid), nickname: str(item.nickname), alias: str(item.alias), serviceType: Number.isFinite(Number(item.service_type)) ? Number(item.service_type) : -1 })
      }
      const total = isRecord(data) && Number.isFinite(Number(data.total)) ? Number(data.total) : accounts.length
      return { accounts, total }
    },
    async listArticles(input, signal) {
      const data = await envelope('/api/public/articles', { fakeid: input.fakeid, begin: String(input.begin), count: String(input.count), ...input.keyword ? { keyword: input.keyword } : {} }, 'the article list', signal)
      const list = isRecord(data) && Array.isArray(data.articles) ? data.articles : []
      const articles: HistoryArticle[] = []
      for (const item of list) {
        if (!isRecord(item)) continue
        const link = str(item.link)
        const title = str(item.title)
        if (!link || !title) continue
        const when = Number(item.update_time ?? item.create_time)
        const digest = str(item.digest)
        const author = str(item.author)
        const aid = str(item.aid)
        articles.push({
          title, url: link.replace(/^http:\/\/mp\.weixin\.qq\.com/i, 'https://mp.weixin.qq.com'),
          ...Number.isFinite(when) && when > 0 ? { publishedAt: new Date(when * 1000).toISOString() } : {},
          ...digest ? { digest } : {}, ...author ? { author } : {}, ...aid ? { aid } : {},
        })
      }
      const total = isRecord(data) && data.total !== undefined && Number.isFinite(Number(data.total)) ? Number(data.total) : undefined
      return { articles, ...total !== undefined ? { total } : {} }
    },
    health: signal => bare('/api/health', 'the health check', signal),
    loginStatus: signal => bare('/api/admin/status', 'the login status', signal),
  }
}
