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
import { nodeToText } from "../extract.js";
import { parseDocument } from "../util.js";
import { notice } from "./notices.js";
export const WECHAT_ARTICLE_HOST = 'mp.weixin.qq.com';
export const WECHAT_REFERER = 'https://mp.weixin.qq.com/';
/** The UA that gets the full article page (a desktop UA gets the same HTML but is verified more often). */
export const WECHAT_MOBILE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148';
function parsed(url) {
    try {
        return new URL(url);
    }
    catch {
        return undefined;
    }
}
/** An article URL on mp.weixin.qq.com (any query). */
export function isWechatArticleUrl(url) {
    const u = parsed(url);
    return !!u && u.hostname.toLowerCase() === WECHAT_ARTICLE_HOST && (u.pathname === '/s' || u.pathname.startsWith('/s/'));
}
/** A search-result link that carries its signature (`signature=` in the query): readable for a while, then it expires. */
export function isSignedWechatUrl(url) {
    const u = parsed(url);
    return !!u && isWechatArticleUrl(url) && u.searchParams.has('signature');
}
/** The page chrome a reader (Jina, a browser) keeps from a WeChat page without an article: like / share buttons, no prose. */
const READER_CHROME = /轻点两下取消(?:赞|在看)|Video Mini Program Like|Share Comment Favorite|听过/g;
/**
 * Whether text another reader (Jina, the browser) made of a WeChat article URL is that page's chrome and not an article: the
 * "Parameter error" page, or the like / share buttons with almost no prose (measured 2026-11-01 on Jina).
 */
export function isWechatReaderJunk(text) {
    if (/Parameter error|参数错误/.test(text.slice(0, 2000)))
        return true;
    if (!text.match(READER_CHROME))
        return false;
    // Roughly characters of prose: ideographs count one each, Latin letters a fifth (about a word).
    const rest = text.replace(READER_CHROME, '');
    const prose = (rest.match(/[\u4e00-\u9fff]/g)?.length ?? 0) + (rest.match(/[A-Za-z]/g)?.length ?? 0) / 5;
    return prose < 80;
}
export const MARK_CAPTCHA = '【微信·验证页】';
export const MARK_SHELL = '【微信·空壳页】';
export const MARK_ERROR = '【微信·不可读】';
/** The page class a stored text implies, by its marker line (used when a cached copy is read back); undefined = not one of ours. */
export function classifyWechatMarker(text) {
    const head = text.trimStart().slice(0, 12);
    return head.startsWith(MARK_CAPTCHA) ? 'captcha' : head.startsWith(MARK_SHELL) ? 'shell' : head.startsWith(MARK_ERROR) ? 'error' : undefined;
}
const CAPTCHA_URL = /\/mp\/wappoc_appmsgcaptcha|\/mp\/(?:wappoc_)?appmsg_?(?:verify|captcha)/i;
const CAPTCHA_PAGE = /TCaptcha\.js|secitptpage|环境异常|完成验证|去验证/;
const GONE = [
    { re: /该内容已被发布者删除|内容已被(?:发布者)?删除/, reason: '该内容已被发布者删除' },
    { re: /因违规无法查看|被投诉并经审核|违反.{0,12}规定.{0,12}无法/, reason: '此内容因违规无法查看' },
    { re: /(?:公众号|帐号|账号)已迁移/, reason: '该公众号已迁移，文章不在这个地址了' },
    // Measured 2026-11-01: an article link with a made-up mid answers "Parameter error"; an expired signed link says so.
    { re: /Parameter error|参数错误/, reason: '链接参数无效（mid / idx / sn 不完整或不存在）' },
    { re: /链接已过期|访问链接已失效/, reason: '签名链接已过期，请重新搜索拿新的链接' },
    { re: /已停止访问|被(?:封禁|屏蔽)|无法查看|不存在/, reason: '微信提示此内容无法查看' },
];
const squeeze = (s) => s.replace(/\s+/g, ' ').trim();
/** Publish time as `2024-01-25 20:53` in UTC+8, the way the WeChat page shows it. */
export function formatWechatTime(unixSeconds) {
    return new Date((unixSeconds + 8 * 3600) * 1000).toISOString().slice(0, 16).replace('T', ' ');
}
function visibleText(html) {
    return squeeze(html.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' '));
}
/**
 * Read a mp.weixin.qq.com page. `finalUrl` is where the request ended (after redirects): a redirect to the captcha path is
 * as telling as the page. Classification: `#js_content` present = an article; else a page naming the verification (环境异常 /
 * 完成验证 / 去验证 / TCaptcha) = captcha; a page naming a removal (已被发布者删除 / 违规无法查看 / 已迁移) = error with the
 * reason; anything else = shell.
 */
export function parseWechatArticle(html, finalUrl = '') {
    const doc = parseDocument(html);
    const content = doc.querySelector('#js_content');
    if (!content) {
        if (CAPTCHA_URL.test(finalUrl) || CAPTCHA_PAGE.test(html)) {
            return { kind: 'captcha', reason: '微信要求完成人机验证（环境异常）', text: MARK_CAPTCHA + '微信要求先完成验证（环境异常 / 去验证），没有返回文章正文。无签名的裸链接最容易遇到；请改用搜索结果里的签名链接。' };
        }
        const text = visibleText(html.length > 300_000 ? html.slice(0, 300_000) : html);
        const gone = GONE.find(entry => entry.re.test(text));
        if (gone)
            return { kind: 'error', reason: gone.reason, text: MARK_ERROR + gone.reason + '。' };
        return { kind: 'shell', reason: 'no js_content', text: MARK_SHELL + '页面里没有文章正文（#js_content），多半是空壳页：链接没有签名、已过期，或被微信限制。请改用搜索结果里的签名链接。' };
    }
    const title = squeeze(doc.querySelector('#activity-name')?.textContent ?? '') || squeeze(doc.querySelector('meta[property="og:title"]')?.getAttribute?.('content') ?? '');
    const account = squeeze(doc.querySelector('#js_name')?.textContent ?? '') || /var nickname = htmlDecode\("([^"]*)"\)/.exec(html)?.[1]?.trim() || '';
    const ct = /var ct = "(\d{9,11})"/.exec(html)?.[1] ?? /\boriCreateTime = '(\d{9,11})'/.exec(html)?.[1];
    const published = ct ? new Date(Number(ct) * 1000).toISOString() : undefined;
    const body = nodeToText(content) || '（文章没有文字内容，可能只有图片或视频）';
    const header = [account && '公众号：' + account, ct && '发布：' + formatWechatTime(Number(ct)) + '（UTC+8）'].filter(Boolean).join(' · ');
    return {
        kind: 'content',
        ...title ? { title } : {},
        ...account ? { account } : {},
        ...published ? { publishedAt: published } : {},
        text: (header ? header + '\n\n' : '') + body,
    };
}
// ── notices implied by URLs ─────────────────────────────────────────────────
/** `wechat.signed-url` when any result URL is a signed mp.weixin.qq.com link (what every WeChat leg returns, whichever one answered). */
export function searchResultNotices(urls) {
    for (const url of urls)
        if (isSignedWechatUrl(url))
            return [notice('wechat.signed-url')];
    return [];
}
/**
 * The notices of a read: `wechat.copyright` when an article body came back, `wechat.signed-url` when it was read through a
 * signed link, `wechat.bare-url` when an unsigned link gave no body (shell or verification page). Pure of the text itself, so a
 * cached copy gets the same ones.
 */
export function readNotices(read) {
    if (!isWechatArticleUrl(read.requestedUrl) && !isWechatArticleUrl(read.url))
        return [];
    const out = [];
    if (!read.pageClass) {
        out.push(notice('wechat.copyright'));
        if (isSignedWechatUrl(read.requestedUrl) || isSignedWechatUrl(read.url))
            out.push(notice('wechat.signed-url'));
    }
    else if ((read.pageClass === 'shell' || read.pageClass === 'captcha') && !isSignedWechatUrl(read.requestedUrl)) {
        out.push(notice('wechat.bare-url'));
    }
    return out;
}
//# sourceMappingURL=article.js.map