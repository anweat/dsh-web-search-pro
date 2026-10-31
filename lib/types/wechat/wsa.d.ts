/**
 * 元宝搜索 (Tencent Cloud WSA, `SearchPro`) as the paid `tencent-wsa` leg of the wechat chain: the same search API restricted to
 * `Site = mp.weixin.qq.com`. It goes through the service API KEY route (no TC3 signing): `POST {base}/SearchPro` with
 * `Authorization: Bearer <key>` and a JSON body; the answer is the usual Tencent envelope `{ Response: { Pages: [<JSON string>],
 * Msg?, Error? } }`, and every page is a JSON document of its own.
 *
 * VERIFICATION: docs-only. Written from Tencent's published documentation and SDK (product/1806: 服务 API KEY 方式, SearchPro
 * 121811, error codes), never against the live service: there was no key and nothing here ever calls it with one. The unknown
 * parts are tolerated rather than guessed: the date format of a page, whether a page carries `pics` or `images`, and whether an
 * error sits in `Response.Error` or at the top level (the key-route page only documents `Code`).
 *
 * Money: a request is billed per call (failed calls are not), so the leg counts every answered request in the usage ledger
 * (`tencent-wsa`) and refuses once `wechat.wsa.dailyLimit` is reached; the key never reaches an error message, a log line or a
 * notice.
 * @module web-search-pro/wechat/wsa
 */
import { EngineError } from '../engine-error.ts';
import type { Engine, EngineDeps, EngineSearchOptions, EngineSource } from '../engines.ts';
import { type WechatSettings } from './settings.ts';
export declare const WSA_USAGE_PROVIDER = "tencent-wsa";
export declare const WSA_PATH = "/SearchPro";
export declare const WSA_SITE = "mp.weixin.qq.com";
export declare const WSA_CNT_STEPS: readonly [10, 20, 30, 40, 50];
/** Most UTF-8 bytes of `Query` (third-party documentation; the official page does not state it). */
export declare const WSA_QUERY_BYTES = 1500;
/** Per-edition price text, CNY per 1000 calls (Tencent's billing page). */
export declare const WSA_PRICE: Readonly<Record<WechatSettings['wsa']['edition'], string>>;
type WsaSettings = WechatSettings['wsa'];
/** The `Cnt` for a wanted count: the next of 10/20/30/40/50 (the API takes no other value), at most 50. */
export declare function wsaCnt(count: number): number;
/** `Query` cut at {@link WSA_QUERY_BYTES} UTF-8 bytes without splitting a character. */
export declare function wsaQuery(query: string): string;
/**
 * `Freshness` for a publication-date lower bound: `d<N>` (N 1-30) when the bound is within 30 days, else the inclusive
 * range `YYYY-MM-DD,YYYY-MM-DD` (UTC dates; the API takes dates from 1970 up to today). Undefined for a bound that is
 * missing, unparseable or in the future.
 */
export declare function wsaFreshness(since: string | undefined, now: number): string | undefined;
export interface WsaBody {
    Query: string;
    Site: string;
    Cnt?: number;
    Mode?: number;
    Freshness?: string;
}
/** The JSON body of a search: `lite` sends neither `Mode` nor `Cnt` (the edition does not support them). */
export declare function wsaBody(query: string, count: number, settings: Pick<WsaSettings, 'edition' | 'mode'>, options: Pick<EngineSearchOptions, 'since'> | undefined, now: number): WsaBody;
/** A page date as UTC ISO 8601: a string with a zone as it is, a zone-less `YYYY-MM-DD[ HH:mm[:ss]]` as China time (+08:00), a unix number in seconds or ms. */
export declare function wsaDate(value: unknown): string | undefined;
export interface WsaPages {
    sources: EngineSource[];
    skipped: number;
}
/** `Response.Pages` (an array of JSON strings, each parsed again; objects are taken as they are) as search results. Unparseable or link-less entries are skipped and counted. */
export declare function parseWsaPages(pages: unknown): WsaPages;
export interface WsaError {
    code: string;
    message: string;
}
/** The error of an answer: Tencent's `Response.Error.{Code,Message}`, or a top-level `{Code, Message}` (the shape the key-route page documents), or `{Error: {...}}`. */
export declare function wsaErrorOf(json: unknown): WsaError | undefined;
/**
 * The EngineError for a Tencent error code (docs: ResourceNotFound = service not activated, UnauthorizedOperation / AuthFailure.* =
 * the key or the permission, ResourceUnavailable = the account is in arrears, RequestLimitExceeded* = rate limit). Setup problems
 * and arrears carry the `wechat.wsa-setup` action notice. The message never contains the key.
 */
export declare function wsaFailure(error: WsaError, key?: string): EngineError;
export interface WsaSeams {
    now?: () => number;
}
/** Today's `tencent-wsa` requests from the usage ledger (0 where there is none). */
export declare function wsaUsedToday(deps: Pick<EngineDeps, 'usage'>): number;
/** The `tencent-wsa` leg of the wechat chain. `key` is the resolved API key (deps.wechatWsaKey). */
export declare function wsaEngine(deps: EngineDeps, settings: WsaSettings, seams?: WsaSeams): Engine;
export {};
