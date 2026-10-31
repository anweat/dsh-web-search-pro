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
import type { EngineDeps } from '../engines.ts';
import { type Throttle } from './sogou.ts';
export declare const ALBUM_ENDPOINT = "https://mp.weixin.qq.com/mp/appmsgalbum";
export declare const ALBUM_MAX_COUNT = 20;
export declare const ALBUM_DEFAULT_COUNT = 10;
/** Pause between two album requests of this process (anonymous, but WeChat verifies bursts). */
export declare const ALBUM_MIN_INTERVAL_MS = 1000;
/** Replace (tests) or reset the process-wide pause between album requests. */
export declare function resetAlbumThrottle(throttle?: Throttle): void;
export interface AlbumRef {
    biz: string;
    albumId: string;
}
/** The account id and album id of an album page URL (`https://mp.weixin.qq.com/mp/appmsgalbum?__biz=..&action=getalbum&album_id=..#wechat_redirect`). */
export declare function parseAlbumUrl(url: string): AlbumRef | undefined;
/** Validated `biz` + `albumId` parameters. */
export declare function albumRefOf(biz: string, albumId: string): AlbumRef | undefined;
export declare function encodeAlbumCursor(msgid: string, itemidx: string): string;
export declare function decodeAlbumCursor(cursor: string): {
    msgid: string;
    itemidx: string;
} | undefined;
export interface AlbumArticle {
    title: string;
    url: string;
    publishedAt?: string;
    msgid: string;
    itemidx: string;
}
export interface AlbumPage {
    /** First page only. */
    title?: string;
    nickname?: string;
    totalArticles?: number;
    articles: AlbumArticle[];
    nextCursor?: string;
}
/** `http://` to `https://` (mp.weixin.qq.com answers both; a reader should use https). */
export declare const httpsUrl: (url: string) => string;
/** An album answer (parsed JSON) as a page; throws EngineError when `base_resp.ret` is not 0 or the shape is not an album. */
export declare function parseAlbum(json: unknown): AlbumPage;
export interface AlbumIo {
    deps: Pick<EngineDeps, 'allowProxyFakeIp' | 'fetchImpl' | 'lookup'>;
    signal: AbortSignal | undefined;
    throttle?: Throttle;
}
/** The request URL of one album page. */
export declare function albumUrl(ref: AlbumRef, count: number, cursor?: {
    msgid: string;
    itemidx: string;
}): string;
/** One anonymous album page. Failures are EngineErrors with words the model can pass on. */
export declare function fetchAlbum(ref: AlbumRef, count: number, cursor: {
    msgid: string;
    itemidx: string;
} | undefined, io: AlbumIo): Promise<AlbumPage>;
