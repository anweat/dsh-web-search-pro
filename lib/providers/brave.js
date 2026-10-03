/**
 * Brave Search API (keyed, English / general; its own independent index). Contract sources: the official
 * documentation https://api-dashboard.search.brave.com/app/documentation/web-search/query and the API reference
 * https://api-dashboard.search.brave.com/api-reference/web/search/get, the rate-limit guide
 * https://api-dashboard.search.brave.com/documentation/guides/rate-limiting (all fetched 2026-10-03).
 *
 * `GET https://api.search.brave.com/res/v1/web/search?q=…`, header `X-Subscription-Token: <key>`. Parameters used:
 * `q`, `count` (1-20), `freshness` (`YYYY-MM-DDtoYYYY-MM-DD`), `result_filter=web`, `text_decorations=false`. `q` supports the operators
 * `"phrase"`, `-term` and `site:` (documented), which carry the site / exclude constraints. 200: `web.results[]` of
 * `{ title, url, description, page_age?, language?, extra_snippets? }`. Rate limits: response headers
 * `X-RateLimit-Limit|Policy|Remaining|Reset`, each a comma-separated pair (per-second window, then the monthly quota);
 * a 429 means a window is spent and "only successful requests are counted".
 *
 * Ambiguous / left out: the documented query limit differs between the API reference (600 characters, 75 words) and
 * other Brave material (400 / 50), so the query is cut to the smaller (400 / 50); the error BODY shape and the exact
 * 401 / 403 / 422 semantics are not documented on the pages read (the status mapping is the generic one);
 * `country`, `search_lang` (default `en`; the code for Chinese is not confirmed), `extra_snippets` (plan dependent),
 * `goggles`, `summary` are not sent.
 * @module web-search-pro/providers/brave
 */
import { EngineError } from "../engines.js";
import { compileKeyed } from "../pipeline/compile.js";
import { clamp, dayOf, emptyResults, errorMessage, expectObject, isHttpUrl, keyedAdapter, keyedDescriptor, keyedFailure, limitQuery, snippetOf, textOf } from "./keyed.js";
export const BRAVE_ROUTE_ID = 'brave';
export const BRAVE_BASE = 'https://api.search.brave.com';
export const BRAVE_PATH = '/res/v1/web/search';
export const BRAVE_MAX_COUNT = 20;
export const BRAVE_QUERY_CHARS = 400;
export const BRAVE_QUERY_WORDS = 50;
/** Brave's date-range form of `freshness`: `YYYY-MM-DDtoYYYY-MM-DD`. */
export const braveFreshness = (since, now = new Date()) => dayOf(since) + 'to' + dayOf(now);
export function braveParams(query, count, since, now = new Date()) {
    return {
        q: limitQuery(query, BRAVE_QUERY_CHARS, BRAVE_QUERY_WORDS),
        count: String(clamp(count, 1, BRAVE_MAX_COUNT)),
        result_filter: 'web',
        text_decorations: 'false',
        ...since ? { freshness: braveFreshness(since, now) } : {},
    };
}
const TAGS = /<[^>]+>/g;
const ENTITIES = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#x27;': "'", '&#39;': "'", '&nbsp;': ' ' };
/** Plain text of a description even if decorations were applied (`<strong>`) or entities escaped. */
const plain = (value) => typeof value === 'string' ? snippetOf(value.replace(TAGS, '').replace(/&(?:amp|lt|gt|quot|nbsp|#x27|#39);/g, m => ENTITIES[m] ?? m)) : undefined;
export function mapBrave(results, count) {
    const sources = [];
    for (const r of results) {
        const row = (r ?? {});
        if (!isHttpUrl(row.url))
            continue;
        const title = plain(row.title);
        const snippet = plain(row.description);
        const publishedAt = textOf(row.page_age);
        sources.push({ url: row.url.trim(), ...title ? { title } : {}, ...snippet ? { snippet } : {}, ...publishedAt ? { publishedAt } : {} });
        if (sources.length >= count)
            break;
    }
    return sources;
}
export function parseBrave(json, count) {
    const body = expectObject('Brave', json);
    const web = body.web;
    const results = web && typeof web === 'object' ? web.results : undefined;
    if (results === undefined) {
        if (web === undefined)
            throw emptyResults('Brave'); // no `web` section at all: nothing matched
        throw new EngineError('Brave returned an unprocessable response body', 'ENGINE_ERROR', true);
    }
    if (!Array.isArray(results))
        throw new EngineError('Brave returned an unprocessable response body', 'ENGINE_ERROR', true);
    const sources = mapBrave(results, count);
    if (!sources.length)
        throw emptyResults('Brave');
    return sources;
}
const firstNumber = (value) => {
    const n = Number(value?.split(',')[0]?.trim());
    return value && Number.isFinite(n) ? n : undefined;
};
const secondNumber = (value) => {
    const n = Number(value?.split(',')[1]?.trim());
    return value?.includes(',') && Number.isFinite(n) ? n : undefined;
};
/**
 * 429: when the second (monthly) `X-RateLimit-Remaining` value is 0 the plan quota is spent (`ENGINE_QUOTA`, no cooldown);
 * otherwise the per-second window is full and the first `X-RateLimit-Reset` value (seconds) is the cooldown. Retry-After wins when sent.
 */
export function braveFailure(status, headers, json) {
    const detail = errorMessage(json);
    if (status === 429) {
        if (secondNumber(headers.get('x-ratelimit-remaining')) === 0) {
            return new EngineError('Brave: the plan quota is used up (HTTP 429, X-RateLimit-Remaining 0 for the monthly window)', 'ENGINE_QUOTA', false);
        }
        const retry = headers.get('retry-after') ? undefined : firstNumber(headers.get('x-ratelimit-reset'));
        if (retry !== undefined) {
            const wait = Math.round(retry * 1000);
            return new EngineError('Brave rate limit (HTTP 429; retry after ' + Math.ceil(wait / 1000) + 's)', 'ENGINE_RATE_LIMIT', true, wait);
        }
    }
    return keyedFailure('Brave', status, headers, detail);
}
export const BRAVE_DESCRIPTOR = keyedDescriptor({
    route: BRAVE_ROUTE_ID,
    label: 'Brave Search',
    languages: ['en'],
    regions: ['global'],
    sourceFamily: 'brave',
    supportedFilters: ['site', 'exclude_site', 'exclude_term', 'time_window'],
    priority: 30,
    costNote: 'metered per successful request from a Brave Search API plan (per-second and monthly limits); the plugin counts requests (provider brave), the price is unknown to it',
    verificationNote: 'contract from the official documentation and API reference; error body shape undocumented; never called live (no key)',
});
export const braveAdapter = keyedAdapter(BRAVE_DESCRIPTOR, {
    defaultBase: BRAVE_BASE,
    path: BRAVE_PATH,
    request: (query, count, options) => ({
        method: 'GET',
        params: braveParams(query, count, options?.since),
        headers: key => ({ 'x-subscription-token': key, accept: 'application/json' }),
    }),
    failure: res => braveFailure(res.status, res.headers, res.json),
    parse: parseBrave,
}, (task, now) => compileKeyed(task, BRAVE_ROUTE_ID, now, { operators: true, since: true }));
//# sourceMappingURL=brave.js.map