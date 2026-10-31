/**
 * WeChat 合集 (album) listing without a login: `GET https://mp.weixin.qq.com/mp/appmsgalbum?__biz&action=getalbum&album_id&count&f=json`
 * answers `{ base_resp: { ret }, getalbum_resp: { article_list, base_info, continue_flag } }` to an anonymous request.
 *
 * Measured live 2026-11-01 (anonymous, 2 requests, mobile UA + `Referer: https://mp.weixin.qq.com/`, a public album taken from RSSHub's
 * documentation): HTTP 200 `application/json`, `ret: 0`; the first page carries `base_info` (title, nickname, `article_count` as a
 * string); articles are NEWEST FIRST by default (`pos_num` counts down, `is_reverse: "1"`); a follow-up page with
 * `begin_msgid` / `begin_itemidx` of the last article continues right after it and carries only `{ is_first_screen: "0" }` as
 * `base_info`; `continue_flag` is the STRING "1" while more follow. Every field of an article is a string and its `url` is
 * `http://` with a `#rd` tail (test/fixtures/wechat/album-page1.json, album-page2.json are trimmed captures with placeholders).
 * Documented but not seen live: `article_list` is a single object (not an array) when exactly one article is returned;
 * the codes of `ret != 0`.
 *
 * Cursor: opaque to the caller, `base64url(JSON {m: msgid, i: itemidx})` of the last article of the page.
 * @module web-search-pro/wechat/album
 */

import { EngineError } from '../engine-error.ts'
import { requestProvider, safeDetail } from '../providers/http.ts'
import type { EngineDeps } from '../engines.ts'
import { WECHAT_MOBILE_UA, WECHAT_REFERER } from './article.ts'
import { createThrottle, type Throttle } from './sogou.ts'
import { noteLayerFailure, noteLayerOk } from './health.ts'

export const ALBUM_ENDPOINT = 'https://mp.weixin.qq.com/mp/appmsgalbum'
export const ALBUM_MAX_COUNT = 20
export const ALBUM_DEFAULT_COUNT = 10
/** Pause between two album requests of this process (anonymous, but WeChat verifies bursts). */
export const ALBUM_MIN_INTERVAL_MS = 1000

let albumThrottle = createThrottle()

/** Replace (tests) or reset the process-wide pause between album requests. */
export function resetAlbumThrottle(throttle: Throttle = createThrottle()): void { albumThrottle = throttle }

export interface AlbumRef { biz: string; albumId: string }

const BIZ = /^[A-Za-z0-9+/=_-]{4,64}$/
const ALBUM_ID = /^\d{5,25}$/

/** The account id and album id of an album page URL (`https://mp.weixin.qq.com/mp/appmsgalbum?__biz=..&action=getalbum&album_id=..#wechat_redirect`). */
export function parseAlbumUrl(url: string): AlbumRef | undefined {
  let u: URL
  try { u = new URL(url.trim()) } catch { return undefined }
  if ((u.protocol !== 'https:' && u.protocol !== 'http:') || u.hostname.toLowerCase() !== 'mp.weixin.qq.com') return undefined
  const biz = u.searchParams.get('__biz') ?? ''
  const albumId = u.searchParams.get('album_id') ?? ''
  return BIZ.test(biz) && ALBUM_ID.test(albumId) ? { biz, albumId } : undefined
}

/** Validated `biz` + `albumId` parameters. */
export function albumRefOf(biz: string, albumId: string): AlbumRef | undefined {
  return BIZ.test(biz) && ALBUM_ID.test(albumId) ? { biz, albumId } : undefined
}

export function encodeAlbumCursor(msgid: string, itemidx: string): string {
  return Buffer.from(JSON.stringify({ m: msgid, i: itemidx }), 'utf8').toString('base64url')
}

export function decodeAlbumCursor(cursor: string): { msgid: string; itemidx: string } | undefined {
  try {
    const value = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as { m?: unknown; i?: unknown }
    return typeof value.m === 'string' && typeof value.i === 'string' && /^\d{1,20}$/.test(value.m) && /^\d{1,6}$/.test(value.i) ? { msgid: value.m, itemidx: value.i } : undefined
  } catch { return undefined }
}

export interface AlbumArticle { title: string; url: string; publishedAt?: string; msgid: string; itemidx: string }

export interface AlbumPage {
  /** First page only. */
  title?: string
  nickname?: string
  totalArticles?: number
  articles: AlbumArticle[]
  nextCursor?: string
}

const isRecord = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value)
const str = (value: unknown): string => (typeof value === 'string' ? value.trim() : typeof value === 'number' && Number.isFinite(value) ? String(value) : '')

/** `http://` to `https://` (mp.weixin.qq.com answers both; a reader should use https). */
export const httpsUrl = (url: string): string => url.replace(/^http:\/\//i, 'https://')

/** An album answer (parsed JSON) as a page; throws EngineError when `base_resp.ret` is not 0 or the shape is not an album. */
export function parseAlbum(json: unknown): AlbumPage {
  if (!isRecord(json)) throw new EngineError('the album answer is not a JSON object', 'ENGINE_ERROR', true)
  const ret = isRecord(json.base_resp) ? Number(json.base_resp.ret) : NaN
  if (!Number.isFinite(ret)) throw new EngineError('the album answer has no base_resp.ret', 'ENGINE_ERROR', true)
  if (ret !== 0) throw new EngineError('WeChat refused the album request (base_resp.ret=' + ret + '): the album id or account id may be wrong, or the album was removed', 'ENGINE_ERROR', false)
  const album = isRecord(json.getalbum_resp) ? json.getalbum_resp : undefined
  if (!album) throw new EngineError('the album answer has no getalbum_resp', 'ENGINE_ERROR', true)
  // One article comes as a bare object, none as nothing at all.
  const raw = Array.isArray(album.article_list) ? album.article_list : isRecord(album.article_list) ? [album.article_list] : []
  const articles: AlbumArticle[] = []
  for (const item of raw) {
    if (!isRecord(item)) continue
    const url = str(item.url)
    const title = str(item.title)
    if (!url || !title) continue
    const created = Number(str(item.create_time))
    articles.push({
      title, url: httpsUrl(url), msgid: str(item.msgid), itemidx: str(item.itemidx),
      ...Number.isFinite(created) && created > 0 ? { publishedAt: new Date(created * 1000).toISOString() } : {},
    })
  }
  const info = isRecord(album.base_info) ? album.base_info : undefined
  const title = str(info?.title) || str(isRecord(album.album_resp_info) ? album.album_resp_info.title : undefined)
  const nickname = str(info?.nickname)
  const total = Number(str(info?.article_count))
  const more = str(album.continue_flag) !== '0' && str(album.continue_flag) !== ''
  const last = articles.at(-1)
  return {
    ...title ? { title } : {}, ...nickname ? { nickname } : {}, ...Number.isFinite(total) && info?.article_count !== undefined ? { totalArticles: total } : {},
    articles,
    ...more && last?.msgid && last.itemidx ? { nextCursor: encodeAlbumCursor(last.msgid, last.itemidx) } : {},
  }
}

export interface AlbumIo {
  deps: Pick<EngineDeps, 'allowProxyFakeIp' | 'fetchImpl' | 'lookup'>
  signal: AbortSignal | undefined
  throttle?: Throttle
}

/** The request URL of one album page. */
export function albumUrl(ref: AlbumRef, count: number, cursor?: { msgid: string; itemidx: string }): string {
  const q = new URLSearchParams({ __biz: ref.biz, action: 'getalbum', album_id: ref.albumId, count: String(count), f: 'json' })
  if (cursor) { q.set('begin_msgid', cursor.msgid); q.set('begin_itemidx', cursor.itemidx) }
  return ALBUM_ENDPOINT + '?' + q.toString()
}

/** One anonymous album page. Failures are EngineErrors with words the model can pass on. */
export async function fetchAlbum(ref: AlbumRef, count: number, cursor: { msgid: string; itemidx: string } | undefined, io: AlbumIo): Promise<AlbumPage> {
  const n = Math.min(Math.max(Math.trunc(count) || ALBUM_DEFAULT_COUNT, 1), ALBUM_MAX_COUNT)
  try {
    await (io.throttle ?? albumThrottle).wait(ALBUM_MIN_INTERVAL_MS, io.signal)
    const res = await requestProvider('WeChat album', albumUrl(ref, n, cursor), {
      deps: io.deps, signal: io.signal, userAgent: WECHAT_MOBILE_UA, timeoutMs: 20_000,
      headers: { referer: WECHAT_REFERER, accept: 'application/json, text/plain, */*' },
    })
    if (res.status === 429 || res.status === 403) throw new EngineError('WeChat answered HTTP ' + res.status + ' to the album request: wait a while before asking again', 'ENGINE_RATE_LIMIT', true)
    if (!res.ok) throw new EngineError('WeChat answered HTTP ' + res.status + ' to the album request', 'ENGINE_ERROR', res.status >= 500)
    if (res.json === undefined) throw new EngineError('WeChat answered a page that is not JSON to the album request (a verification wall?): ' + safeDetail(res.text, 80), 'ENGINE_ERROR', true)
    const page = parseAlbum(res.json)
    noteLayerOk('album')
    return page
  } catch (error) {
    if (!io.signal?.aborted) noteLayerFailure('album', error)
    throw error
  }
}
