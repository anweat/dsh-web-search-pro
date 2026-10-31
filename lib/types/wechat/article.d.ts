/**
 * WeChat official-account article pages (mp.weixin.qq.com/s): which URLs are signed, how to read one (body `#js_content`, title
 * `#activity-name`, account `#js_name`, publish time `var ct = "<unix>"`), and what a page that is not an article is.
 * Verified live 2026-11-01: a signed `s?src=11&timestamp=...&signature=...` link answers the full page with an iPhone UA and a
 * `Referer: https://mp.weixin.qq.com/`; the same article by its bare `__biz/mid/idx/sn` link is redirected (302) to
 * `/mp/wappoc_appmsgcaptcha` (a ~17 KB page that loads TCaptcha.js and has no text), the "environment abnormal, verify" wall.
 * Pages that are not articles carry a marker line (`【微信·验证页】`, `【微信·空壳页】`, `【微信·不可读】`) so a stored copy is
 * classified the same way later. Pure: no network.
 * @module web-search-pro/wechat/article
 */
import { type Notice } from './notices.ts';
export declare const WECHAT_ARTICLE_HOST = "mp.weixin.qq.com";
export declare const WECHAT_REFERER = "https://mp.weixin.qq.com/";
/** The UA that gets the full article page (a desktop UA gets the same HTML but is verified more often). */
export declare const WECHAT_MOBILE_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148";
/** An article URL on mp.weixin.qq.com (any query). */
export declare function isWechatArticleUrl(url: string): boolean;
/** A search-result link that carries its signature (`signature=` in the query): readable for a while, then it expires. */
export declare function isSignedWechatUrl(url: string): boolean;
export type WechatPageKind = 'content' | 'shell' | 'captcha' | 'error';
export interface WechatArticle {
    kind: WechatPageKind;
    /** Title (`#activity-name`, else og:title). */
    title?: string;
    account?: string;
    /** Publish time as UTC ISO 8601. */
    publishedAt?: string;
    /** The text a reader gets: `公众号：X · 发布：…` header and body for content, a marker line with the reason otherwise. */
    text: string;
    /** Why the page is not an article (error / captcha / shell). */
    reason?: string;
}
export declare const MARK_CAPTCHA = "\u3010\u5FAE\u4FE1\u00B7\u9A8C\u8BC1\u9875\u3011";
export declare const MARK_SHELL = "\u3010\u5FAE\u4FE1\u00B7\u7A7A\u58F3\u9875\u3011";
export declare const MARK_ERROR = "\u3010\u5FAE\u4FE1\u00B7\u4E0D\u53EF\u8BFB\u3011";
/** The page class a stored text implies, by its marker line (used when a cached copy is read back); undefined = not one of ours. */
export declare function classifyWechatMarker(text: string): Exclude<WechatPageKind, 'content'> | undefined;
/** Publish time as `2024-01-25 20:53` in UTC+8, the way the WeChat page shows it. */
export declare function formatWechatTime(unixSeconds: number): string;
/**
 * Read a mp.weixin.qq.com page. `finalUrl` is where the request ended (after redirects): a redirect to the captcha path is
 * as telling as the page. Classification: `#js_content` present = an article; else a page naming the verification (环境异常 /
 * 完成验证 / 去验证 / TCaptcha) = captcha; a page naming a removal (已被发布者删除 / 违规无法查看 / 已迁移) = error with the
 * reason; anything else = shell.
 */
export declare function parseWechatArticle(html: string, finalUrl?: string): WechatArticle;
/** `wechat.signed-url` when any result URL is a signed mp.weixin.qq.com link (what every WeChat leg returns, whichever one answered). */
export declare function searchResultNotices(urls: Iterable<string>): Notice[];
/**
 * The notices of a read: `wechat.copyright` when an article body came back, `wechat.signed-url` when it was read through a
 * signed link, `wechat.bare-url` when an unsigned link gave no body (shell or verification page). Pure of the text itself, so a
 * cached copy gets the same ones.
 */
export declare function readNotices(read: {
    requestedUrl: string;
    url: string;
    pageClass?: string;
}): Notice[];
