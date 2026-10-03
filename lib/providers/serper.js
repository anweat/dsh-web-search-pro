/**
 * Serper (keyed; Google SERP wrapper, `sourceFamily: google`). Contract sources: the request shape and response keys
 * are not published as a public API reference (serper.dev is a product page plus a dashboard playground), so they are
 * taken from MIT reference code that calls the service: LangChain's `GoogleSerperAPIWrapper`
 * (langchain-ai/langchain-community, utilities/google_serper.py) and the `searchsuite` package used by the MIT DSH
 * plugin `yugasun/dsh-plugins` (providers/serper.js), checked 2026-10-03.
 *
 * `POST https://google.serper.dev/search`, header `X-API-KEY: <key>`, JSON body `{ q, num (<= 100), gl?, hl?, tbs? }`.
 * 200: `organic[]` of `{ title, link, snippet, date?, position }`; only `organic` is used (`answerBox` / `knowledgeGraph` are not sources).
 * Site / exclude constraints go in `q` as Google operators (`site:`, `-site:`, `-term`) because the results are Google's.
 *
 * Because every result is Google's, `sourceFamily` is `google`: Serper is never independent corroboration of another Google
 * based source. Ambiguous / left out: the error envelope and its credit exhaustion status are not documented (the shared
 * mapping applies; a message that says "credits" is treated as quota); `gl` / `hl` values for Chinese are not confirmed so
 * they are not sent; `tbs` (Google's date filter string) is not documented by Serper, so a time window stays local.
 * @module web-search-pro/providers/serper
 */
import { EngineError } from "../engines.js";
import { compileKeyed } from "../pipeline/compile.js";
import { clamp, emptyResults, errorMessage, expectObject, isHttpUrl, keyedAdapter, keyedDescriptor, keyedFailure, snippetOf, textOf } from "./keyed.js";
export const SERPER_ROUTE_ID = 'serper';
export const SERPER_BASE = 'https://google.serper.dev';
export const SERPER_PATH = '/search';
export const SERPER_MAX_RESULTS = 100;
export function serperBody(query, count) {
    return { q: query, num: clamp(count, 1, SERPER_MAX_RESULTS) };
}
/** Serper dates are free text (`Sep 13, 2025`, `3 days ago`): only a parseable absolute date is kept. */
function absoluteDate(value) {
    const t = textOf(value);
    if (!t || /ago/i.test(t))
        return undefined;
    const ms = Date.parse(t);
    if (!Number.isFinite(ms))
        return undefined;
    // Serper prints a calendar date without a zone: keep the printed day (read back in the same local zone), not a UTC-shifted one.
    const d = new Date(ms);
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
export function mapSerper(organic, count) {
    const sources = [];
    for (const r of organic) {
        const row = (r ?? {});
        if (!isHttpUrl(row.link))
            continue;
        const title = textOf(row.title);
        const snippet = snippetOf(row.snippet);
        const publishedAt = absoluteDate(row.date);
        sources.push({ url: row.link.trim(), ...title ? { title } : {}, ...snippet ? { snippet } : {}, ...publishedAt ? { publishedAt } : {} });
        if (sources.length >= count)
            break;
    }
    return sources;
}
export function parseSerper(json, count) {
    const body = expectObject('Serper', json);
    if (body.organic === undefined)
        throw emptyResults('Serper');
    if (!Array.isArray(body.organic))
        throw new EngineError('Serper returned an unprocessable response body', 'ENGINE_ERROR', true);
    const sources = mapSerper(body.organic, count);
    if (!sources.length)
        throw emptyResults('Serper');
    return sources;
}
export function serperFailure(status, headers, json) {
    const detail = errorMessage(json);
    // A 400 whose message says the credits are gone is quota (Serper's own wording is not documented).
    if (status === 400 && /credit|balance|quota/i.test(detail))
        return keyedFailure('Serper', status, headers, detail, true);
    return keyedFailure('Serper', status, headers, detail);
}
export const SERPER_DESCRIPTOR = keyedDescriptor({
    route: SERPER_ROUTE_ID,
    label: 'Serper (Google SERP)',
    // Google is strong in both languages, but S1 promotes only for English (the Chinese keyed sources lead Chinese tasks); chosen explicitly or recommended otherwise.
    languages: ['en'],
    regions: ['global'],
    sourceFamily: 'google',
    supportedFilters: ['site', 'exclude_site', 'exclude_term'],
    priority: 60,
    costNote: 'metered in credits per request from a Serper plan; the plugin counts requests (provider serper), the price is unknown to it',
    verificationNote: 'no public API reference: contract from MIT reference code (LangChain, searchsuite); never called live (no key)',
});
export const serperAdapter = keyedAdapter(SERPER_DESCRIPTOR, {
    defaultBase: SERPER_BASE,
    path: SERPER_PATH,
    request: (query, count) => ({
        method: 'POST',
        body: serperBody(query, count),
        headers: key => ({ 'x-api-key': key, accept: 'application/json' }),
    }),
    failure: res => serperFailure(res.status, res.headers, res.json),
    parse: parseSerper,
}, (task, now) => compileKeyed(task, SERPER_ROUTE_ID, now, { operators: true }));
//# sourceMappingURL=serper.js.map