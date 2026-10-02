/**
 * Stack Exchange (Stack Overflow) question search, anonymous. Contract source: https://api.stackexchange.com/docs
 * (`/2.3/search/advanced`: `q`, `site`, `order`, `sort`, `pagesize`, `fromdate`, `filter`; the response wrapper
 * `items`, `has_more`, `quota_max`, `quota_remaining`, `backoff`; failures `error_id` / `error_name` / `error_message`;
 * every response is gzip-compressed, which the HTTP client decodes).
 *
 * Throttling (https://api.stackexchange.com/docs/throttle): a `backoff` field means "do not call this method again
 * for that many seconds" — honoured here before the next request; an exhausted anonymous quota answers a
 * `throttle_violation` that names the wait in its message. Both are remembered per process (engines are created per call).
 * @module web-search-pro/providers/stackexchange
 */
import { EngineError } from "../engines.js";
import { compileKeywords } from "../pipeline/compile.js";
import { stripTags } from "../util.js";
import { Blocker, recordRequest, requestProvider, safeDetail, statusFailure } from "./http.js";
export const STACKEXCHANGE_ROUTE_ID = 'stackexchange';
export const STACKEXCHANGE_USAGE_PROVIDER = 'stackexchange';
export const STACKEXCHANGE_SITE = 'stackoverflow';
const SNIPPET_CHARS = 400;
/** One process-wide block state: `backoff` and quota messages apply to every later call. */
export const stackExchangeBlock = new Blocker();
export function stackExchangeUrl(query, count, since) {
    const params = new URLSearchParams({ order: 'desc', sort: 'relevance', q: query, site: STACKEXCHANGE_SITE, pagesize: String(Math.min(Math.max(Math.floor(count), 1), 30)), filter: 'withbody' });
    const from = since ? Math.floor(Date.parse(since) / 1000) : NaN;
    if (Number.isFinite(from))
        params.set('fromdate', String(from));
    return 'https://api.stackexchange.com/2.3/search/advanced?' + params.toString();
}
/** Items -> sources: HTML-decoded title, the question text (tags, answers, score first) as the snippet. */
export function mapStackExchange(items, count) {
    const sources = [];
    for (const item of items) {
        const url = typeof item?.link === 'string' ? item.link : undefined;
        const title = typeof item?.title === 'string' ? stripTags(item.title) : '';
        if (!url || !/^https?:\/\//i.test(url) || !title)
            continue;
        const meta = [
            item.is_answered ? (item.accepted_answer_id !== undefined ? 'answered (accepted)' : 'answered') : 'unanswered',
            (item.answer_count ?? 0) + ' answers', 'score ' + (item.score ?? 0), ...Array.isArray(item.tags) && item.tags.length ? ['tags: ' + item.tags.slice(0, 5).join(', ')] : [],
        ].join(', ');
        const body = typeof item.body === 'string' ? stripTags(item.body) : '';
        const snippet = body ? meta + ' — ' + body : meta;
        const created = typeof item.creation_date === 'number' ? new Date(item.creation_date * 1000).toISOString() : undefined;
        sources.push({ url, title, snippet: snippet.length > SNIPPET_CHARS ? snippet.slice(0, SNIPPET_CHARS) + '…' : snippet, ...created ? { publishedAt: created } : {} });
        if (sources.length >= count)
            break;
    }
    return sources;
}
/** Seconds named by a throttle message ("more requests available in 74268 seconds"). */
export function throttleSeconds(message) {
    const m = /available in (\d+) seconds?/i.exec(message ?? '');
    return m ? Number(m[1]) : undefined;
}
/** An error wrapper (HTTP 400 / 502 with `error_id`) as the engine error contract; throttle violations are remembered. */
export function stackExchangeFailure(status, headers, body) {
    const w = body !== null && typeof body === 'object' ? body : {};
    const detail = safeDetail(w.error_message);
    if (w.error_name === 'throttle_violation' || w.error_id === 502) {
        const wait = throttleSeconds(w.error_message);
        const ms = (wait ?? 60) * 1000;
        // A wait of hours is the daily anonymous quota; a short one is the burst throttle.
        if (wait !== undefined && wait > 3600) {
            stackExchangeBlock.block(ms, 'ENGINE_QUOTA', 'anonymous daily quota used up');
            return new EngineError('Stack Exchange quota exhausted for this IP' + (detail ? ' (' + detail + ')' : ''), 'ENGINE_QUOTA', false);
        }
        stackExchangeBlock.block(ms, 'ENGINE_RATE_LIMIT', 'throttled');
        return new EngineError('Stack Exchange throttled this IP' + (detail ? ' (' + detail + ')' : ''), 'ENGINE_RATE_LIMIT', true, ms);
    }
    return statusFailure('Stack Exchange', status, headers, detail);
}
/** Parse a 2xx wrapper: a `backoff` is stored for the next call, no items is ENGINE_EMPTY. */
export function parseStackExchange(body, count) {
    if (body === null || typeof body !== 'object' || Array.isArray(body) || !Array.isArray(body.items))
        throw new EngineError('Stack Exchange returned an unprocessable response body', 'ENGINE_ERROR', true);
    const w = body;
    if (typeof w.backoff === 'number' && w.backoff > 0)
        stackExchangeBlock.block(w.backoff * 1000, 'ENGINE_RATE_LIMIT', 'the API asked for a backoff');
    const sources = mapStackExchange(w.items, count);
    if (!sources.length)
        throw new EngineError('Stack Exchange returned no results', 'ENGINE_EMPTY', true);
    return sources;
}
export function stackExchangeEngine(deps) {
    return {
        id: STACKEXCHANGE_ROUTE_ID,
        label: 'Stack Overflow',
        available: () => true,
        async search(query, count, signal, options) {
            stackExchangeBlock.check('Stack Exchange');
            const res = await requestProvider('Stack Exchange', stackExchangeUrl(query, count, options?.since), { deps, signal });
            if (!res.ok)
                throw stackExchangeFailure(res.status, res.headers, res.json);
            recordRequest(deps, STACKEXCHANGE_USAGE_PROVIDER);
            if (res.json === undefined)
                throw new EngineError('Stack Exchange returned invalid JSON', 'ENGINE_ERROR', true);
            return { sources: parseStackExchange(res.json, count) };
        },
    };
}
export const STACKEXCHANGE_DESCRIPTOR = {
    id: 'builtin:stackexchange',
    aliases: [STACKEXCHANGE_ROUTE_ID],
    label: 'Stack Overflow',
    adapterVersion: '1',
    contractVersion: 1,
    operations: ['search'],
    taskProfiles: ['docs_code', 'experience'],
    languages: ['en'],
    regions: ['global'],
    resultKinds: ['qa'],
    sourceFamily: 'stackexchange',
    requirements: [],
    supportedFilters: ['time_window'],
    costModel: { kind: 'free', note: 'anonymous API with a small daily quota per IP; requests counted in the usage ledger' },
    priority: 80,
    verification: { live: true, note: 'live 2026-10-02: 2 requests (plain and fromdate; quota_max 300 anonymous), fixture test/fixtures/stackexchange-search.json' },
};
export const stackExchangeAdapter = {
    descriptor: STACKEXCHANGE_DESCRIPTOR,
    probeLocal: () => ({ available: true, installation: 'not_required', credential: 'not_required' }),
    create: deps => stackExchangeEngine(deps),
    compile: (task, now) => compileKeywords(task, STACKEXCHANGE_ROUTE_ID, now, { terms: 4, since: true }),
};
//# sourceMappingURL=stackexchange.js.map