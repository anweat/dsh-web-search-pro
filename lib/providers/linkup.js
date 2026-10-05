/**
 * Linkup Search (keyed, English / overseas). Contract sources: https://docs.linkup.so/pages/documentation/endpoints/search/reference
 * (the `/search` reference), https://docs.linkup.so/pages/documentation/platform/errors.md and
 * https://docs.linkup.so/pages/documentation/platform/rate-limits.md (fetched 2026-10-03). Not linkupapi.com.
 *
 * `POST https://api.linkup.so/v1/search`, `Authorization: Bearer <key>`, JSON body: `q`, `depth` (`flash` | `fast` |
 * `standard` | `deep`; `fast` is the documented recommended default), `outputType`, `maxResults`, `includeDomains`
 * (<= 100), `excludeDomains`, `fromDate` / `toDate` (YYYY-MM-DD), `includeImages`. ONLY `outputType: "searchResults"` is used:
 * ranked `results[]` of `{ type: "text", name, url, content, favicon }` (image entries are skipped). `sourcedAnswer` / `structured`
 * outputs are generated answers and are never requested or treated as sources.
 * Errors: `{ statusCode, error: { code, message, details[] } }` — 400, 401, 402 (x402 payment: the adapter only sends its key and never pays), 403,
 * 429 ("insufficient credit or excessive concurrent requests"), 500, 504. Rate limit: 10 queries per second per organisation.
 *
 * Ambiguous / left out: a 429 does not say in the status which of its two causes applies, so the message decides
 * (credit wording => `ENGINE_QUOTA` not retryable, otherwise a retryable rate limit); no Retry-After is documented;
 * the credit cost per depth is not documented.
 * @module web-search-pro/providers/linkup
 */
import { EngineError } from "../engines.js";
import { compileKeyed } from "../pipeline/compile.js";
import { clamp, dayOf, emptyResults, errorMessage, expectObject, isHttpUrl, keyedAdapter, keyedDescriptor, keyedFailure, snippetOf, textOf } from "./keyed.js";
export const LINKUP_ROUTE_ID = 'linkup';
export const LINKUP_BASE = 'https://api.linkup.so';
export const LINKUP_PATH = '/v1/search';
export const LINKUP_MAX_INCLUDE = 100;
export const LINKUP_MAX_COUNT = 50;
export function linkupBody(query, count, options) {
    return {
        q: query,
        depth: 'fast',
        outputType: 'searchResults',
        maxResults: clamp(count, 1, LINKUP_MAX_COUNT),
        includeImages: false,
        ...options?.sites?.include?.length ? { includeDomains: options.sites.include.slice(0, LINKUP_MAX_INCLUDE) } : {},
        ...options?.sites?.exclude?.length ? { excludeDomains: options.sites.exclude } : {},
        ...options?.since ? { fromDate: dayOf(options.since) } : {},
    };
}
export function mapLinkup(results, count) {
    const sources = [];
    for (const r of results) {
        const row = (r ?? {});
        if ((row.type !== undefined && row.type !== 'text') || !isHttpUrl(row.url))
            continue;
        const title = textOf(row.name);
        const snippet = snippetOf(row.content);
        sources.push({ url: row.url.trim(), ...title ? { title } : {}, ...snippet ? { snippet } : {} });
        if (sources.length >= count)
            break;
    }
    return sources;
}
export function parseLinkup(json, count) {
    const body = expectObject('Linkup', json);
    if (!Array.isArray(body.results))
        throw new EngineError('Linkup returned an unprocessable response body', 'ENGINE_ERROR', true);
    const sources = mapLinkup(body.results, count);
    if (!sources.length)
        throw emptyResults('Linkup');
    return sources;
}
export function linkupFailure(status, headers, json) {
    return keyedFailure('Linkup', status, headers, errorMessage(json));
}
export const LINKUP_DESCRIPTOR = keyedDescriptor({
    route: LINKUP_ROUTE_ID,
    label: 'Linkup',
    languages: ['en'],
    regions: ['global'],
    supportedFilters: ['site', 'exclude_site', 'time_window'],
    priority: 40,
    costTier: 'free-quota',
    costNote: '$20 of credit for sign-ups with a professional email, topped up monthly for eligible accounts (https://docs.linkup.so/pages/documentation/development/pricing, read 2026-10-04); the plugin counts requests (provider linkup), the price is unknown to it',
    verificationNote: 'contract from the official /search reference and errors page; never called live (no key); only ranked searchResults are used',
});
export const linkupAdapter = keyedAdapter(LINKUP_DESCRIPTOR, {
    defaultBase: LINKUP_BASE,
    path: LINKUP_PATH,
    request: (query, count, options) => ({
        method: 'POST',
        body: linkupBody(query, count, options),
        headers: key => ({ authorization: 'Bearer ' + key, accept: 'application/json' }),
    }),
    failure: res => linkupFailure(res.status, res.headers, res.json),
    parse: parseLinkup,
}, (task, now) => compileKeyed(task, LINKUP_ROUTE_ID, now, { include: LINKUP_MAX_INCLUDE, exclude: LINKUP_MAX_INCLUDE, since: true }));
//# sourceMappingURL=linkup.js.map