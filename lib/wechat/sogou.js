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
import { EngineError } from "../engine-error.js";
import { Blocker } from "../providers/http.js";
import { htmlDecode, httpGet } from "../util.js";
import { attachNotices, notice, uniqueNotices } from "./notices.js";
import { WECHAT_DEFAULTS } from "./settings.js";
export const SOGOU_ORIGIN = 'https://weixin.sogou.com';
const SEARCH_PATH = '/weixin';
const DESKTOP_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
/** How long the leg stays closed after Sogou asked for a captcha. */
export const ANTISPIDER_BLOCK_MS = 120_000;
/** A search session's cookies are reused for link resolution this long (a read.fetch of a link from the last search). */
export const SESSION_REUSE_MS = 15 * 60_000;
// ── cookies (memory only) ───────────────────────────────────────────────────
/** The cookies of one Sogou session. Names and values only: attributes are ignored, nothing is persisted. */
export class CookieJar {
    cookies = new Map();
    absorb(headers) {
        if (!headers)
            return;
        const lines = typeof headers.getSetCookie === 'function' ? headers.getSetCookie() : (headers.get('set-cookie') ?? '').split(/,(?=\s*[\w-]+=)/);
        for (const line of lines) {
            const pair = line.split(';')[0].trim();
            const eq = pair.indexOf('=');
            if (eq <= 0)
                continue;
            const name = pair.slice(0, eq).trim();
            const value = pair.slice(eq + 1).trim();
            if (!value || /;\s*max-age=0\b/i.test(line) || value === 'deleted')
                this.cookies.delete(name);
            else
                this.cookies.set(name, value);
        }
    }
    has(name) { return this.cookies.has(name); }
    header() {
        return this.cookies.size ? [...this.cookies].map(([k, v]) => k + '=' + v).join('; ') : undefined;
    }
}
let shared;
/** The session of the last successful search while it is fresh (and carries SNUID), for resolving a link on its own. */
export function reusableSession(now = Date.now()) {
    return shared && now - shared.at < SESSION_REUSE_MS && shared.jar.has('SNUID') ? shared : undefined;
}
/** Forget the shared session (tests; also done when Sogou rejects it). */
export function dropSharedSession() { shared = undefined; }
const realSleep = (ms, signal) => new Promise(resolve => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => { clearTimeout(timer); resolve(); }, { once: true });
});
export function createThrottle(clock = {}) {
    const now = clock.now ?? Date.now;
    const sleep = clock.sleep ?? realSleep;
    let tail = Promise.resolve();
    let last = Number.NEGATIVE_INFINITY;
    return {
        wait(minIntervalMs, signal) {
            const turn = tail.then(async () => {
                if (signal?.aborted)
                    throw signal.reason ?? new DOMException('This operation was aborted', 'AbortError');
                const gap = last + minIntervalMs - now();
                if (gap > 0)
                    await sleep(gap, signal);
                if (signal?.aborted)
                    throw signal.reason ?? new DOMException('This operation was aborted', 'AbortError');
                last = now();
            });
            tail = turn.catch(() => { });
            return turn;
        },
    };
}
/** Every Sogou request of this process goes through this one. */
export const sogouThrottle = createThrottle();
const block = new Blocker();
/** Reset the anti-spider block (tests). */
export function resetSogouBlock() { block.reset(); }
const text = (html) => htmlDecode(html.replace(/<!--[\s\S]*?-->/g, '').replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<[^>]*>/g, '')).replace(/\s+/g, ' ').trim();
/** An href from the result page as a fetchable absolute Sogou URL. */
export function sogouLinkOf(href) {
    const decoded = href.replace(/&amp;/g, '&').replace(/ /g, '%20');
    return decoded.startsWith('http') ? decoded : SOGOU_ORIGIN + (decoded.startsWith('/') ? '' : '/') + decoded;
}
/** The result list of a `type=2` search page; [] when the page has none (layout changed, no hits, anti-spider). */
export function parseSogouResults(html) {
    const items = [];
    for (const m of html.matchAll(/<li[^>]*\bid="sogou_vr_\d+_box_\d+"[^>]*>([\s\S]*?)<\/li>/g)) {
        const block = m[1];
        const head = /<h3[^>]*>\s*<a[^>]*\bhref="([^"]+)"[^>]*>([\s\S]*?)<\/a>/.exec(block);
        if (!head)
            continue;
        const title = text(head[2]);
        if (!title)
            continue;
        const summary = /<p[^>]*class="txt-info"[^>]*>([\s\S]*?)<\/p>/.exec(block)?.[1];
        const account = /<span[^>]*class="all-time-y2"[^>]*>([\s\S]*?)<\/span>/.exec(block)?.[1];
        const unix = /timeConvert\('(\d{9,11})'\)/.exec(block)?.[1];
        items.push({
            title,
            summary: summary ? text(summary) : '',
            account: account ? text(account) : '',
            ...unix ? { publishedAt: new Date(Number(unix) * 1000).toISOString() } : {},
            link: sogouLinkOf(head[1]),
        });
    }
    return items;
}
/** Sogou's captcha wall: the redirect to `/antispider/`, or its page. */
export function isAntispider(finalUrl, html) {
    return /\/antispider(?:[/?]|$)/i.test(finalUrl) || /请输入验证码|此验证码用于确认|antispider\.min\.js/.test(html.slice(0, 20_000));
}
/** The signed target of a `/link` page: the `url += '...'` chunks joined, with `@` removed. */
export function parseSogouLinkPage(html) {
    const joined = [...html.matchAll(/\burl \+= (['"])(.*?)\1/g)].map(m => m[2]).join('').replace(/@/g, '');
    if (/^https?:\/\/mp\.weixin\.qq\.com\//i.test(joined))
        return joined;
    const direct = /https?:\/\/mp\.weixin\.qq\.com\/s\?[^'"\s<>]+/.exec(html)?.[0];
    return direct?.replace(/@/g, '');
}
/** A `weixin.sogou.com/link?url=...` URL (what a search result links to; read.fetch resolves it). */
export function isSogouLink(url) {
    try {
        const u = new URL(url);
        return u.hostname.toLowerCase() === 'weixin.sogou.com' && u.pathname === '/link' && u.searchParams.has('url');
    }
    catch {
        return false;
    }
}
/** The IO settings an engine or the fetch service derives from its deps. */
export function sogouIo(deps, settings, signal, seams = {}) {
    return {
        allowProxyFakeIp: deps.allowProxyFakeIp, signal, minIntervalMs: settings.minIntervalMs, throttle: seams.throttle ?? sogouThrottle,
        ...deps.fetchImpl ? { fetchImpl: deps.fetchImpl } : {}, ...deps.lookup ? { lookup: deps.lookup } : {}, ...seams.now ? { now: seams.now } : {},
    };
}
function antispiderError() {
    const n = notice('wechat.antispider');
    return attachNotices(new EngineError('Sogou anti-spider (captcha) answered instead of the page: lower the request rate, change the egress IP or try later', 'ENGINE_RATE_LIMIT', true, ANTISPIDER_BLOCK_MS), [n]);
}
async function sogouGet(url, referer, io, session) {
    try {
        block.check('Sogou WeChat');
    }
    catch (error) {
        throw attachNotices(error, [notice('wechat.antispider')]);
    }
    await io.throttle.wait(io.minIntervalMs, io.signal);
    const cookie = session.jar.header();
    const res = await httpGet(url, {
        headers: { 'user-agent': DESKTOP_UA, referer, ...cookie ? { cookie } : {} },
        signal: io.signal, timeoutMs: 25_000, maxBytes: 2 * 1024 * 1024, allowProxyFakeIp: io.allowProxyFakeIp,
        ...io.fetchImpl ? { fetchImpl: io.fetchImpl } : {}, ...io.lookup ? { lookup: io.lookup } : {},
    });
    session.jar.absorb(res.headers);
    if (isAntispider(res.finalUrl, res.text)) {
        block.block(ANTISPIDER_BLOCK_MS, 'ENGINE_RATE_LIMIT', 'Sogou anti-spider (captcha) was shown a moment ago');
        if (shared === session)
            shared = undefined;
        throw antispiderError();
    }
    if (res.status === 429)
        throw new EngineError('Sogou answered HTTP 429', 'ENGINE_RATE_LIMIT', true);
    if (!res.ok)
        throw new EngineError('Sogou answered HTTP ' + res.status, 'ENGINE_ERROR', true);
    return res.text;
}
/** `query=` of a sogou link (the search it came from), decoded; the warm-up of a lone link searches for it. */
function queryOfLink(link) {
    try {
        return new URL(link).searchParams.get('query')?.trim() || '公众号';
    }
    catch {
        return '公众号';
    }
}
async function warmUp(link, io, session) {
    const url = SOGOU_ORIGIN + SEARCH_PATH + '?type=2&query=' + encodeURIComponent(queryOfLink(link)) + '&page=1';
    await sogouGet(url, SOGOU_ORIGIN + '/', io, session);
}
/**
 * The signed `mp.weixin.qq.com` URL behind a sogou `/link` URL. A session without SNUID first runs one search (the cookie
 * only a search response sets); throws `ENGINE_RATE_LIMIT` with the antispider notice when Sogou refuses.
 */
export async function resolveSogouLink(link, io, session) {
    const now = io.now ?? Date.now;
    const s = session ?? reusableSession(now()) ?? { jar: new CookieJar(), at: now() };
    if (!s.jar.has('SNUID'))
        await warmUp(link, io, s);
    const html = await sogouGet(link, SOGOU_ORIGIN + SEARCH_PATH + '?type=2', io, s);
    const signed = parseSogouLinkPage(html);
    if (!signed)
        throw new EngineError('the Sogou link page named no mp.weixin.qq.com target', 'ENGINE_ERROR', true);
    if (!session && s.jar.has('SNUID')) {
        s.at = now();
        shared = s;
    }
    return signed;
}
/**
 * One Sogou search: the result page, then the signed links of the first `resolveLinks` results (the rest keep their sogou
 * link, which read.fetch resolves later). An anti-spider answer while resolving keeps what was found and adds the notice.
 */
export async function sogouSearch(query, count, io, opts) {
    const now = io.now ?? Date.now;
    const session = { jar: new CookieJar(), at: now() };
    const html = await sogouGet(SOGOU_ORIGIN + SEARCH_PATH + '?type=2&query=' + encodeURIComponent(query) + '&page=1', SOGOU_ORIGIN + '/', io, session);
    const items = parseSogouResults(html).slice(0, Math.max(count, 1));
    if (!items.length)
        throw new EngineError('Sogou WeChat returned no parseable results', 'ENGINE_EMPTY', false);
    if (session.jar.has('SNUID'))
        shared = session;
    const notices = [];
    const notes = [];
    const urls = items.map(item => item.link);
    let resolved = 0;
    for (let i = 0; i < Math.min(opts.resolveLinks, items.length); i++) {
        try {
            urls[i] = await resolveSogouLink(items[i].link, io, session);
            resolved++;
        }
        catch (error) {
            if (io.signal?.aborted)
                throw error;
            const antispider = error.code === 'ENGINE_RATE_LIMIT';
            if (antispider)
                notices.push(notice('wechat.antispider'));
            notes.push('sogou: link ' + (i + 1) + ' not resolved (' + (error instanceof Error ? error.message : String(error)).slice(0, 120) + ')' + (antispider ? '; stopped resolving' : ''));
            if (antispider)
                break;
        }
    }
    if (items.length > resolved)
        notes.push('sogou: ' + resolved + ' of ' + items.length + ' links resolved to signed mp.weixin.qq.com URLs; the others keep the weixin.sogou.com link, which read.fetch resolves');
    return {
        sources: items.map((item, i) => ({
            url: urls[i], title: item.title,
            ...item.summary || item.account ? { snippet: (item.account ? item.account + ' · ' : '') + item.summary } : {},
            ...item.publishedAt ? { publishedAt: item.publishedAt } : {},
        })),
        notices: uniqueNotices(notices),
        notes,
    };
}
/** The `sogou` leg of the wechat chain. */
export function sogouEngine(deps, settings = WECHAT_DEFAULTS.sogou, seams = {}) {
    return {
        id: 'sogou',
        backend: 'sogou',
        label: 'Sogou WeChat (built-in)',
        available: () => settings.enabled,
        unavailableReason: () => (settings.enabled ? undefined : 'disabled in settings (wechat.sogou.enabled)'),
        async search(query, count, signal) {
            if (!settings.enabled)
                throw new EngineError('the built-in Sogou leg is disabled in settings (wechat.sogou.enabled)', 'ENGINE_UNAVAILABLE', false);
            const out = await sogouSearch(query, count, sogouIo(deps, settings, signal, seams), { resolveLinks: settings.resolveLinks });
            return { sources: out.sources, via: 'sogou', backend: 'sogou', ...out.notes.length ? { notes: out.notes } : {}, ...out.notices.length ? { notices: out.notices } : {} };
        },
    };
}
//# sourceMappingURL=sogou.js.map