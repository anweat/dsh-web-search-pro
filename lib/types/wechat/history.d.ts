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
import type { EngineDeps } from '../engines.ts';
import { type Throttle } from './sogou.ts';
export type HistoryFailure = 'unreachable' | 'login-expired' | 'rate-limited' | 'maybe-not-logged-in' | 'service-error' | 'bad-response';
/** A failure of the history service with its kind; the user-facing notices hang on it (see {@link attachNotices}). */
export declare class HistoryError extends Error {
    readonly kind: HistoryFailure;
    constructor(message: string, kind: HistoryFailure);
}
export interface HistorySettings {
    baseUrl: string;
    minIntervalMs: number;
}
export interface HistoryAccount {
    fakeid: string;
    nickname: string;
    alias: string;
    serviceType: number;
}
export interface HistoryArticle {
    title: string;
    url: string;
    publishedAt?: string;
    digest?: string;
    author?: string;
    aid?: string;
}
/** The base URL without trailing slashes and its origin; undefined when it is not an http(s) URL without credentials. */
export declare function historyBase(baseUrl: string): {
    base: string;
    origin: string;
} | undefined;
/** Forget the throttles (tests). */
export declare function resetHistoryThrottles(): void;
/** The failure a `success: false` error text of the service stands for (the strings are the service's own, see the module header). */
export declare function classifyHistoryError(text: string, what: string): HistoryError;
export interface HistoryClient {
    readonly baseUrl: string;
    searchAccounts(query: string, signal?: AbortSignal): Promise<{
        accounts: HistoryAccount[];
        total: number;
    }>;
    listArticles(input: {
        fakeid: string;
        begin: number;
        count: number;
        keyword?: string;
    }, signal?: AbortSignal): Promise<{
        articles: HistoryArticle[];
        total?: number;
    }>;
    /** `GET /api/health` (liveness) and `GET /api/admin/status` (stored login), bare objects. */
    health(signal?: AbortSignal): Promise<Record<string, unknown>>;
    loginStatus(signal?: AbortSignal): Promise<Record<string, unknown>>;
}
export interface HistorySeams {
    throttle?: Throttle;
}
/** The client for a configured service; throws when `baseUrl` is not usable (callers check {@link historyBase} first for a friendlier message). */
export declare function createHistoryClient(deps: Pick<EngineDeps, 'allowProxyFakeIp' | 'fetchImpl' | 'lookup'>, settings: HistorySettings, seams?: HistorySeams): HistoryClient;
