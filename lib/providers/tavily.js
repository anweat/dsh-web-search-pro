/**
 * Tavily Search (keyed, English / general research). Contract sources: the official API reference
 * https://docs.tavily.com/documentation/api-reference/endpoint/search (fetched 2026-10-03) and the MIT reference
 * provider `crayonlu/dsh-web-search-tavily` (src/provider.js).
 *
 * `POST https://api.tavily.com/search`, `Authorization: Bearer <key>`, JSON body: `query`, `search_depth` (basic),
 * `max_results` (0-20), `topic`, `include_domains` (<= 300), `exclude_domains` (<= 150), `start_date` / `end_date`
 * (YYYY-MM-DD), `include_published_date`, `include_answer`, `include_raw_content`. 200: `results[]` of
 * `{ title, url, content, score, published_date? }`. Errors (`{ detail: { error } }`): 400, 401, 422, 429 (+ Retry-After),
 * 432 plan limit, 433 pay-as-you-go limit, 500.
 *
 * Only the ranked `results[]` are used: `include_answer` is never requested and `answer` is never read (a generated
 * answer is not a source). Left out because the documentation does not settle them: `country` / `language` (the
 * `country` enum is long and `language` needs `filter_by_language`), `include_usage` (credits are not money), `auto_parameters`.
 * @module web-search-pro/providers/tavily
 */
import { EngineError } from "../engines.js";
import { compileKeyed } from "../pipeline/compile.js";
import { clamp, dayOf, emptyResults, errorMessage, expectObject, isHttpUrl, keyedAdapter, keyedDescriptor, keyedFailure, snippetOf, textOf } from "./keyed.js";
export const TAVILY_ROUTE_ID = 'tavily';
export const TAVILY_URL_BASE = 'https://api.tavily.com';
export const TAVILY_PATH = '/search';
export const TAVILY_MAX_RESULTS = 20;
export const TAVILY_MAX_INCLUDE = 300;
export const TAVILY_MAX_EXCLUDE = 150;
export function tavilyBody(query, count, options) {
    return {
        query,
        search_depth: 'basic',
        max_results: clamp(count, 1, TAVILY_MAX_RESULTS),
        topic: 'general',
        include_answer: false,
        include_raw_content: false,
        include_published_date: true,
        ...options?.sites?.include?.length ? { include_domains: options.sites.include.slice(0, TAVILY_MAX_INCLUDE) } : {},
        ...options?.sites?.exclude?.length ? { exclude_domains: options.sites.exclude.slice(0, TAVILY_MAX_EXCLUDE) } : {},
        ...options?.since ? { start_date: dayOf(options.since) } : {},
    };
}
export function mapTavily(results, count) {
    const sources = [];
    for (const r of results) {
        const row = (r ?? {});
        if (!isHttpUrl(row.url))
            continue;
        const title = textOf(row.title);
        const snippet = snippetOf(row.content);
        const publishedAt = textOf(row.published_date);
        sources.push({ url: row.url.trim(), ...title ? { title } : {}, ...snippet ? { snippet } : {}, ...publishedAt ? { publishedAt } : {} });
        if (sources.length >= count)
            break;
    }
    return sources;
}
export function parseTavily(json, count) {
    const body = expectObject('Tavily', json);
    if (!Array.isArray(body.results))
        throw new EngineError('Tavily returned an unprocessable response body', 'ENGINE_ERROR', true);
    const sources = mapTavily(body.results, count);
    if (!sources.length)
        throw emptyResults('Tavily');
    return sources;
}
/** 432 / 433 are Tavily's plan and pay-as-you-go limits: quota, not retryable. Everything else follows the shared mapping. */
export function tavilyFailure(status, headers, json) {
    const detail = errorMessage(json);
    if (status === 432 || status === 433) {
        return new EngineError('Tavily: ' + (detail || (status === 432 ? 'plan limit exceeded' : 'pay-as-you-go limit exceeded')) + ' (HTTP ' + status + '; the account has no quota for this API)', 'ENGINE_QUOTA', false);
    }
    return keyedFailure('Tavily', status, headers, detail);
}
export const TAVILY_DESCRIPTOR = keyedDescriptor({
    route: TAVILY_ROUTE_ID,
    label: 'Tavily',
    languages: ['en'],
    regions: ['global'],
    supportedFilters: ['site', 'exclude_site', 'time_window'],
    priority: 20,
    costTier: 'free-quota',
    costNote: 'billed in credits per request; free plan of 1,000 credits per month, no card (https://docs.tavily.com/documentation/api-credits, read 2026-10-04); the plugin counts requests (provider tavily), the price is unknown to it',
    verificationNote: 'contract from the official API reference and the MIT dsh-web-search-tavily provider; never called live (no key)',
});
export const tavilyAdapter = keyedAdapter(TAVILY_DESCRIPTOR, {
    defaultBase: TAVILY_URL_BASE,
    path: TAVILY_PATH,
    request: (query, count, options) => ({
        method: 'POST',
        body: tavilyBody(query, count, options),
        headers: key => ({ authorization: 'Bearer ' + key, accept: 'application/json' }),
    }),
    failure: res => tavilyFailure(res.status, res.headers, res.json),
    parse: parseTavily,
}, (task, now) => compileKeyed(task, TAVILY_ROUTE_ID, now, { include: TAVILY_MAX_INCLUDE, exclude: TAVILY_MAX_EXCLUDE, since: true }));
//# sourceMappingURL=tavily.js.map