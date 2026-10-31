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
import { EngineError } from "../engine-error.js";
import { requestProvider, safeDetail } from "../providers/http.js";
import { attachNotices, notice } from "./notices.js";
import { WSA_DEFAULT_BASE_URL } from "./settings.js";
export const WSA_USAGE_PROVIDER = 'tencent-wsa';
export const WSA_PATH = '/SearchPro';
export const WSA_SITE = 'mp.weixin.qq.com';
export const WSA_CNT_STEPS = [10, 20, 30, 40, 50];
/** Most UTF-8 bytes of `Query` (third-party documentation; the official page does not state it). */
export const WSA_QUERY_BYTES = 1500;
const TIMEOUT_MS = 20_000;
const DAY_MS = 86_400_000;
/** Per-edition price text, CNY per 1000 calls (Tencent's billing page). */
export const WSA_PRICE = { lite: '极速版 14 元/千次', standard: '标准版 20 元/千次', flagship: '旗舰版 26 元/千次' };
// ── request ─────────────────────────────────────────────────────────────────
/** The `Cnt` for a wanted count: the next of 10/20/30/40/50 (the API takes no other value), at most 50. */
export function wsaCnt(count) {
    const wanted = Number.isFinite(count) ? Math.max(Math.ceil(count), 1) : 10;
    return WSA_CNT_STEPS.find(step => step >= wanted) ?? 50;
}
/** `Query` cut at {@link WSA_QUERY_BYTES} UTF-8 bytes without splitting a character. */
export function wsaQuery(query) {
    const text = query.replace(/\s+/g, ' ').trim();
    if (Buffer.byteLength(text, 'utf8') <= WSA_QUERY_BYTES)
        return text;
    let out = '';
    for (const ch of text) {
        if (Buffer.byteLength(out + ch, 'utf8') > WSA_QUERY_BYTES)
            break;
        out += ch;
    }
    return out.trim();
}
const ymd = (ms) => new Date(ms).toISOString().slice(0, 10);
/**
 * `Freshness` for a publication-date lower bound: `d<N>` (N 1-30) when the bound is within 30 days, else the inclusive
 * range `YYYY-MM-DD,YYYY-MM-DD` (UTC dates; the API takes dates from 1970 up to today). Undefined for a bound that is
 * missing, unparseable or in the future.
 */
export function wsaFreshness(since, now) {
    if (!since)
        return undefined;
    const start = Date.parse(since);
    if (!Number.isFinite(start) || start >= now || start < 0)
        return undefined;
    const days = Math.ceil((now - start) / DAY_MS);
    return days <= 30 ? 'd' + Math.max(days, 1) : ymd(start) + ',' + ymd(now);
}
/** The JSON body of a search: `lite` sends neither `Mode` nor `Cnt` (the edition does not support them). */
export function wsaBody(query, count, settings, options, now) {
    const fresh = wsaFreshness(options?.since, now);
    return {
        Query: wsaQuery(query), Site: WSA_SITE,
        ...settings.edition === 'lite' ? {} : { Cnt: wsaCnt(count), Mode: settings.mode },
        ...fresh ? { Freshness: fresh } : {},
    };
}
// ── response ────────────────────────────────────────────────────────────────
const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = (value) => (typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '');
/** A page date as UTC ISO 8601: a string with a zone as it is, a zone-less `YYYY-MM-DD[ HH:mm[:ss]]` as China time (+08:00), a unix number in seconds or ms. */
export function wsaDate(value) {
    if (typeof value === 'number' && Number.isFinite(value) && value > 0)
        return new Date(value < 1e11 ? value * 1000 : value).toISOString();
    const raw = text(value);
    if (!raw)
        return undefined;
    if (/^\d{9,13}$/.test(raw))
        return wsaDate(Number(raw));
    const plain = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?$/.exec(raw);
    const ms = plain ? Date.parse(`${plain[1]}-${plain[2]}-${plain[3]}T${plain[4] ?? '00'}:${plain[5] ?? '00'}:${plain[6] ?? '00'}+08:00`) : Date.parse(raw);
    return Number.isFinite(ms) ? new Date(ms).toISOString() : undefined;
}
/** `Response.Pages` (an array of JSON strings, each parsed again; objects are taken as they are) as search results. Unparseable or link-less entries are skipped and counted. */
export function parseWsaPages(pages) {
    const sources = [];
    let skipped = 0;
    const seen = new Set();
    for (const entry of Array.isArray(pages) ? pages : []) {
        let page = entry;
        if (typeof entry === 'string') {
            try {
                page = JSON.parse(entry);
            }
            catch {
                skipped++;
                continue;
            }
        }
        if (!isRecord(page)) {
            skipped++;
            continue;
        }
        const url = text(page.url);
        if (!/^https?:\/\//i.test(url) || seen.has(url)) {
            skipped++;
            continue;
        }
        seen.add(url);
        const title = text(page.title);
        // `passage` is the summary every edition returns; `content` (not on lite) is the longer dynamic summary.
        const snippet = text(page.passage) || text(page.content).slice(0, 400);
        const publishedAt = wsaDate(page.date);
        sources.push({ url, ...title ? { title } : {}, ...snippet ? { snippet } : {}, ...publishedAt ? { publishedAt } : {} });
    }
    return { sources, skipped };
}
/** The error of an answer: Tencent's `Response.Error.{Code,Message}`, or a top-level `{Code, Message}` (the shape the key-route page documents), or `{Error: {...}}`. */
export function wsaErrorOf(json) {
    if (!isRecord(json))
        return undefined;
    const response = isRecord(json.Response) ? json.Response : undefined;
    const candidates = [response?.Error, json.Error, json];
    for (const c of candidates) {
        if (isRecord(c) && typeof c.Code === 'string' && c.Code)
            return { code: c.Code, message: text(c.Message) };
    }
    return undefined;
}
/** Remove the key (and anything shaped like a long token) from text that may be shown. */
function scrub(value, key) {
    const cut = key && key.length >= 4 ? value.split(key).join('[redacted]') : value;
    return safeDetail(cut);
}
const SETUP = /^(?:ResourceNotFound|UnauthorizedOperation|AuthFailure)/;
/**
 * The EngineError for a Tencent error code (docs: ResourceNotFound = service not activated, UnauthorizedOperation / AuthFailure.* =
 * the key or the permission, ResourceUnavailable = the account is in arrears, RequestLimitExceeded* = rate limit). Setup problems
 * and arrears carry the `wechat.wsa-setup` action notice. The message never contains the key.
 */
export function wsaFailure(error, key) {
    const detail = scrub(error.message, key);
    const tail = ' [' + error.code + (detail ? ': ' + detail : '') + ']';
    const setup = (reason) => notice('wechat.wsa-setup', notice('wechat.wsa-setup').message + '（' + reason + '，腾讯云返回 ' + error.code + '）');
    if (error.code === 'ResourceNotFound')
        return attachNotices(new EngineError('Tencent WSA: the service is not activated for this account' + tail, 'ENGINE_AUTH', false), [setup('用户资源未开通；开通后需要等几分钟生效')]);
    if (SETUP.test(error.code))
        return attachNotices(new EngineError('Tencent WSA rejected the API key or the permission' + tail, 'ENGINE_AUTH', false), [setup('API Key 或权限不对')]);
    if (error.code === 'ResourceUnavailable')
        return attachNotices(new EngineError('Tencent WSA: the account has no usable resource, usually arrears' + tail, 'ENGINE_QUOTA', false), [setup('账户欠费或资源不可用')]);
    if (/^RequestLimitExceeded/.test(error.code))
        return new EngineError('Tencent WSA rate limit' + tail, 'ENGINE_RATE_LIMIT', true);
    if (/^(?:InvalidParameter|MissingParameter|UnknownParameter)/.test(error.code))
        return new EngineError('Tencent WSA rejected the request' + tail, 'ENGINE_ERROR', false);
    return new EngineError('Tencent WSA error' + tail, 'ENGINE_ERROR', true);
}
/** Today's `tencent-wsa` requests from the usage ledger (0 where there is none). */
export function wsaUsedToday(deps) {
    try {
        return Math.max(deps.usage?.today?.(WSA_USAGE_PROVIDER) ?? 0, 0);
    }
    catch {
        return 0;
    }
}
/** The `tencent-wsa` leg of the wechat chain. `key` is the resolved API key (deps.wechatWsaKey). */
export function wsaEngine(deps, settings, seams = {}) {
    const key = deps.wechatWsaKey;
    const now = seams.now ?? Date.now;
    return {
        id: 'tencent-wsa',
        backend: 'tencent-wsa',
        label: '元宝搜索 (Tencent WSA)',
        available: () => settings.enabled && !!key,
        unavailableReason: () => (!settings.enabled ? 'disabled in settings (wechat.wsa.enabled)' : !key ? 'no API key (set it in the settings card, a DSH credential named ' + settings.apiKeyEnv + ', or $' + settings.apiKeyEnv + ')' : undefined),
        async search(query, count, signal, options) {
            if (!settings.enabled || !key)
                throw new EngineError('Tencent WSA is not set up (wechat.wsa.enabled and an API key)', 'ENGINE_UNAVAILABLE', false);
            const used = wsaUsedToday(deps);
            if (used >= settings.dailyLimit) {
                throw attachNotices(new EngineError('Tencent WSA daily limit reached (' + used + '/' + settings.dailyLimit + ' requests today, wechat.wsa.dailyLimit)', 'ENGINE_BUDGET', false), [notice('wechat.wsa-limit', notice('wechat.wsa-limit').message + '（今日已用 ' + used + '/' + settings.dailyLimit + '）')]);
            }
            const base = (settings.baseUrl ?? WSA_DEFAULT_BASE_URL).replace(/\/+$/, '');
            const res = await requestProvider('Tencent WSA', base + WSA_PATH, {
                deps, signal, method: 'POST', redirect: 'error', timeoutMs: TIMEOUT_MS,
                body: JSON.stringify(wsaBody(query, count, settings, options, now())),
                headers: { 'content-type': 'application/json; charset=UTF-8', authorization: 'Bearer ' + key },
            }).catch((error) => {
                // The transport message can quote the URL or headers: keep it free of the key.
                if (error instanceof EngineError && key.length >= 4 && error.message.includes(key))
                    throw new EngineError(scrub(error.message, key), error.code, error.retryable, error.retryAfterMs);
                throw error;
            });
            const failure = wsaErrorOf(res.json);
            if (failure)
                throw wsaFailure(failure, key);
            if (res.status === 401 || res.status === 403)
                throw wsaFailure({ code: 'AuthFailure.HTTP' + res.status, message: '' }, key);
            if (res.status === 429)
                throw new EngineError('Tencent WSA rate limit (HTTP 429)', 'ENGINE_RATE_LIMIT', true);
            if (!res.ok)
                throw new EngineError('Tencent WSA API error (HTTP ' + res.status + ')', 'ENGINE_ERROR', res.status >= 500 || res.status === 408);
            const response = isRecord(res.json) && isRecord(res.json.Response) ? res.json.Response : undefined;
            if (!response)
                throw new EngineError('Tencent WSA answered without a Response envelope (HTTP ' + res.status + ')', 'ENGINE_ERROR', true);
            // The service answered: this request is counted (billed per call), whatever it found.
            try {
                deps.usage?.record({ provider: WSA_USAGE_PROVIDER, protocol: 'search', requests: 1, note: 'Tencent WSA ' + settings.edition + ', billed per call' });
            }
            catch { /* the ledger is advisory */ }
            const price = WSA_PRICE[settings.edition];
            const paid = notice('wechat.paid', notice('wechat.paid').message + '本次用的是' + price + '，今日已用 ' + (used + 1) + '/' + settings.dailyLimit + ' 次（每日上限 wechat.wsa.dailyLimit）。');
            const pages = parseWsaPages(response.Pages);
            const msg = text(response.Msg);
            if (!pages.sources.length) {
                throw attachNotices(new EngineError('Tencent WSA returned no results' + (msg ? ' (Msg: ' + scrub(msg, key) + ')' : '') + (pages.skipped ? '; ' + pages.skipped + ' unreadable page(s) skipped' : ''), 'ENGINE_EMPTY', false), [paid]);
            }
            const notes = [
                ...msg ? ['tencent-wsa: Msg: ' + scrub(msg, key)] : [],
                ...pages.skipped ? ['tencent-wsa: ' + pages.skipped + ' unreadable page(s) skipped'] : [],
            ];
            return { sources: pages.sources.slice(0, Math.max(count, 1)), via: 'tencent-wsa', backend: 'tencent-wsa', ...notes.length ? { notes } : {}, notices: [paid] };
        },
    };
}
//# sourceMappingURL=wsa.js.map