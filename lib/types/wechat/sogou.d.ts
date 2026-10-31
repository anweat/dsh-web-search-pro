/**
 * The built-in Sogou WeChat leg: search `weixin.sogou.com/weixin?type=2`, parse the result list, and turn the `/link?url=...`
 * redirect pages into the signed `mp.weixin.qq.com/s?...signature=...` URLs a reader can fetch. No key, no login, no browser.
 *
 * Measured live 2026-11-01 (anonymous, 9 requests): the result list is `<li id="sogou_vr_<n>_box_<i>">` items (title in `h3 a`
 * with `<em><!--red_beg-->` highlights, summary `p.txt-info`, account `span.all-time-y2`, time `timeConvert('<unix>')`); a `/link`
 * page is a script that builds the target with `url += '<chunk>'` lines; and `/link` answers with the redirect to `/antispider/`
 * unless the request carries the `SNUID` cookie that a SEARCH response sets (the home page sets only SUID / ABTEST, so it is not
 * a warm-up). An old link resolves with the SNUID of any later search. Cookies live in an in-memory {@link CookieJar} and are
 * never written anywhere. Sogou punishes bursts, so every request waits for the process-wide {@link Throttle}, and an anti-spider
 * answer blocks the leg for a while ({@link Blocker}) and carries the `wechat.antispider` notice.
 * @module web-search-pro/wechat/sogou
 */
import type { Engine, EngineDeps, EngineSource } from '../engines.ts';
import { type Notice } from './notices.ts';
import { type WechatSettings } from './settings.ts';
export declare const SOGOU_ORIGIN = "https://weixin.sogou.com";
/** How long the leg stays closed after Sogou asked for a captcha. */
export declare const ANTISPIDER_BLOCK_MS = 120000;
/** A search session's cookies are reused for link resolution this long (a read.fetch of a link from the last search). */
export declare const SESSION_REUSE_MS: number;
/** The cookies of one Sogou session. Names and values only: attributes are ignored, nothing is persisted. */
export declare class CookieJar {
    private readonly cookies;
    absorb(headers: Headers | undefined): void;
    has(name: string): boolean;
    header(): string | undefined;
}
export interface SogouSession {
    jar: CookieJar;
    at: number;
}
/** The session of the last successful search while it is fresh (and carries SNUID), for resolving a link on its own. */
export declare function reusableSession(now?: number): SogouSession | undefined;
/** Forget the shared session (tests; also done when Sogou rejects it). */
export declare function dropSharedSession(): void;
export interface Throttle {
    /** Resolves when a request may go out: at least `minIntervalMs` after the previous one. Callers queue in order. */
    wait(minIntervalMs: number, signal?: AbortSignal): Promise<void>;
}
export declare function createThrottle(clock?: {
    now?: () => number;
    sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
}): Throttle;
/** Every Sogou request of this process goes through this one. */
export declare const sogouThrottle: Throttle;
/** Reset the anti-spider block (tests). */
export declare function resetSogouBlock(): void;
export interface SogouItem {
    title: string;
    summary: string;
    account: string;
    /** UTC ISO 8601, from `timeConvert('<unix>')`. */
    publishedAt?: string;
    /** Absolute `weixin.sogou.com/link?url=...` URL (entities decoded, spaces escaped). */
    link: string;
}
/** An href from the result page as a fetchable absolute Sogou URL. */
export declare function sogouLinkOf(href: string): string;
/** The result list of a `type=2` search page; [] when the page has none (layout changed, no hits, anti-spider). */
export declare function parseSogouResults(html: string): SogouItem[];
/** Sogou's captcha wall: the redirect to `/antispider/`, or its page. */
export declare function isAntispider(finalUrl: string, html: string): boolean;
/** The signed target of a `/link` page: the `url += '...'` chunks joined, with `@` removed. */
export declare function parseSogouLinkPage(html: string): string | undefined;
/** A `weixin.sogou.com/link?url=...` URL (what a search result links to; read.fetch resolves it). */
export declare function isSogouLink(url: string): boolean;
export interface SogouIo {
    allowProxyFakeIp: boolean;
    signal: AbortSignal | undefined;
    minIntervalMs: number;
    throttle: Throttle;
    fetchImpl?: typeof fetch;
    lookup?: EngineDeps['lookup'];
    now?: () => number;
}
/** The IO settings an engine or the fetch service derives from its deps. */
export declare function sogouIo(deps: Pick<EngineDeps, 'allowProxyFakeIp' | 'fetchImpl' | 'lookup'>, settings: {
    minIntervalMs: number;
}, signal: AbortSignal | undefined, seams?: {
    throttle?: Throttle;
    now?: () => number;
}): SogouIo;
/**
 * The signed `mp.weixin.qq.com` URL behind a sogou `/link` URL. A session without SNUID first runs one search (the cookie
 * only a search response sets); throws `ENGINE_RATE_LIMIT` with the antispider notice when Sogou refuses.
 */
export declare function resolveSogouLink(link: string, io: SogouIo, session?: SogouSession): Promise<string>;
export interface SogouSearchResult {
    sources: EngineSource[];
    notices: Notice[];
    notes: string[];
}
/**
 * One Sogou search: the result page, then the signed links of the first `resolveLinks` results (the rest keep their sogou
 * link, which read.fetch resolves later). An anti-spider answer while resolving keeps what was found and adds the notice.
 */
export declare function sogouSearch(query: string, count: number, io: SogouIo, opts: {
    resolveLinks: number;
}): Promise<SogouSearchResult>;
/** The `sogou` leg of the wechat chain. */
export declare function sogouEngine(deps: EngineDeps, settings?: WechatSettings['sogou'], seams?: {
    throttle?: Throttle;
    now?: () => number;
}): Engine;
