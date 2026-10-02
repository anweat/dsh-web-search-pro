/**
 * Semantic Scholar Graph API paper search (academic), anonymous. Contract source: https://api.semanticscholar.org/api-docs/
 * (`GET /graph/v1/paper/search`: `query`, `fields`, `limit`, `offset`, `year` as `YYYY-` / `YYYY-YYYY`; response
 * `{ total, offset, next, data: [...] }`; `x-api-key` raises the limits; unauthenticated requests share a pool and
 * answer 429 when it is busy, which is NOT a quota problem of this client: it is retried later, never cached as failure).
 * @module web-search-pro/providers/semanticscholar
 */
import { EngineError } from "../engines.js";
import { compileKeywords } from "../pipeline/compile.js";
import { recordRequest, requestProvider, safeDetail, statusFailure } from "./http.js";
export const SEMANTICSCHOLAR_ROUTE_ID = 'semanticscholar';
export const SEMANTICSCHOLAR_USAGE_PROVIDER = 'semanticscholar';
export const SEMANTICSCHOLAR_KEY_ENV = 'SEMANTIC_SCHOLAR_API_KEY';
const SNIPPET_CHARS = 500;
/** A busy shared pool is a short wait, not a long one. */
const DEFAULT_WAIT_MS = 15_000;
const FIELDS = 'title,url,abstract,year,venue,publicationDate,citationCount';
export function semanticScholarUrl(query, count, since) {
    const params = new URLSearchParams({ query, fields: FIELDS, limit: String(Math.min(Math.max(Math.floor(count), 1), 100)) });
    if (since && Number.isFinite(Date.parse(since)))
        params.set('year', new Date(since).getUTCFullYear() + '-');
    return 'https://api.semanticscholar.org/graph/v1/paper/search?' + params.toString();
}
/** Papers -> sources: the Semantic Scholar page URL (built from `paperId` when `url` is absent), venue / year / citations plus the abstract. */
export function mapSemanticScholar(papers, count) {
    const sources = [];
    for (const p of papers) {
        const title = typeof p?.title === 'string' ? p.title.trim() : '';
        const url = typeof p?.url === 'string' && /^https?:\/\//i.test(p.url) ? p.url : typeof p?.paperId === 'string' && p.paperId ? 'https://www.semanticscholar.org/paper/' + encodeURIComponent(p.paperId) : undefined;
        if (!url || !title)
            continue;
        const meta = [typeof p.venue === 'string' && p.venue ? p.venue : undefined, typeof p.year === 'number' ? String(p.year) : undefined, typeof p.citationCount === 'number' ? 'cited by ' + p.citationCount : undefined].filter(Boolean).join(', ');
        const abstract = typeof p.abstract === 'string' ? p.abstract.replace(/\s+/g, ' ').trim() : '';
        const snippet = [meta, abstract].filter(Boolean).join(' — ');
        const publishedAt = typeof p.publicationDate === 'string' && p.publicationDate ? p.publicationDate : typeof p.year === 'number' ? String(p.year) : undefined;
        sources.push({ url, title, ...snippet ? { snippet: snippet.length > SNIPPET_CHARS ? snippet.slice(0, SNIPPET_CHARS) + '…' : snippet } : {}, ...publishedAt ? { publishedAt } : {} });
        if (sources.length >= count)
            break;
    }
    return sources;
}
export function parseSemanticScholar(body, count) {
    if (body === null || typeof body !== 'object' || Array.isArray(body))
        throw new EngineError('Semantic Scholar returned an unprocessable response body', 'ENGINE_ERROR', true);
    const data = body.data;
    // A query without matches answers `{ total: 0, offset: 0 }` (no `data`): empty, not an error.
    if (data === undefined && typeof body.total === 'number')
        throw new EngineError('Semantic Scholar returned no results', 'ENGINE_EMPTY', true);
    if (!Array.isArray(data))
        throw new EngineError('Semantic Scholar returned an unprocessable response body', 'ENGINE_ERROR', true);
    const sources = mapSemanticScholar(data, count);
    if (!sources.length)
        throw new EngineError('Semantic Scholar returned no results', 'ENGINE_EMPTY', true);
    return sources;
}
export function semanticScholarFailure(status, headers, body) {
    const detail = safeDetail(body !== null && typeof body === 'object' ? body.message ?? body.error : undefined);
    const err = statusFailure('Semantic Scholar', status, headers, detail);
    return status === 429 && err.retryAfterMs === undefined ? new EngineError(err.message + '; shared anonymous pool busy (a free ' + SEMANTICSCHOLAR_KEY_ENV + ' is more reliable)', err.code, true, DEFAULT_WAIT_MS) : err;
}
export function semanticScholarEngine(deps) {
    return {
        id: SEMANTICSCHOLAR_ROUTE_ID,
        label: 'Semantic Scholar',
        available: () => true,
        async search(query, count, signal, options) {
            const res = await requestProvider('Semantic Scholar', semanticScholarUrl(query, count, options?.since), {
                deps, signal, ...deps.semanticScholarApiKey ? { headers: { 'x-api-key': deps.semanticScholarApiKey } } : {},
            });
            if (!res.ok)
                throw semanticScholarFailure(res.status, res.headers, res.json);
            recordRequest(deps, SEMANTICSCHOLAR_USAGE_PROVIDER);
            if (res.json === undefined)
                throw new EngineError('Semantic Scholar returned invalid JSON', 'ENGINE_ERROR', true);
            return { sources: parseSemanticScholar(res.json, count) };
        },
    };
}
export const SEMANTICSCHOLAR_DESCRIPTOR = {
    id: 'builtin:semanticscholar',
    aliases: [SEMANTICSCHOLAR_ROUTE_ID],
    label: 'Semantic Scholar',
    adapterVersion: '1',
    contractVersion: 1,
    operations: ['search'],
    taskProfiles: ['academic'],
    languages: ['en'],
    regions: ['global'],
    resultKinds: ['paper'],
    sourceFamily: 'semanticscholar',
    requirements: [{ kind: 'key', id: 'semanticscholar-key', env: [SEMANTICSCHOLAR_KEY_ENV], optional: true, note: 'optional: unauthenticated requests share a busy pool and often get 429' }],
    supportedFilters: ['time_window'],
    costModel: { kind: 'free', note: 'anonymous shared rate limit; requests counted in the usage ledger' },
    priority: 85,
    verification: { live: false, note: 'live 2026-10-02: both anonymous requests answered 429 (shared pool busy; fixture semanticscholar-429.json); the success mapping follows the API docs and is not verified live' },
};
export const semanticScholarAdapter = {
    descriptor: SEMANTICSCHOLAR_DESCRIPTOR,
    probeLocal: ({ deps }) => ({ available: true, installation: 'not_required', credential: (deps.semanticScholarApiKey?.length ?? 0) > 0 ? 'configured' : 'not_required' }),
    create: deps => semanticScholarEngine(deps),
    compile: (task, now) => compileKeywords(task, SEMANTICSCHOLAR_ROUTE_ID, now, { terms: 8, since: true, yearOnly: true }),
};
//# sourceMappingURL=semanticscholar.js.map