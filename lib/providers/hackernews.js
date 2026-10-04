/**
 * Hacker News search through the Algolia HN API (anonymous): `GET https://hn.algolia.com/api/v1/search`
 * with `query`, `tags=story`, `hitsPerPage` and, for a date lower bound, `numericFilters=created_at_i>EPOCH`.
 * Hits carry `objectID`, `title`, `url` (null for Ask HN / text posts), `author`, `points`, `num_comments`,
 * `created_at`, `story_text`. Stories only: the external article is the result, the HN thread is named in the
 * snippet (comment hits are noisier and their pages are not extractable).
 * @module web-search-pro/providers/hackernews
 */
import { EngineError } from "../engines.js";
import { compileKeywords } from "../pipeline/compile.js";
import { stripTags } from "../util.js";
import { recordRequest, requestProvider, safeDetail, statusFailure } from "./http.js";
export const HACKERNEWS_ROUTE_ID = 'hackernews';
export const HACKERNEWS_USAGE_PROVIDER = 'hackernews';
const SNIPPET_CHARS = 400;
export function hackerNewsUrl(query, count, since) {
    const params = new URLSearchParams({ query, tags: 'story', hitsPerPage: String(Math.min(Math.max(Math.floor(count), 1), 50)) });
    const epoch = since ? Math.floor(Date.parse(since) / 1000) : NaN;
    if (Number.isFinite(epoch))
        params.set('numericFilters', 'created_at_i>' + epoch);
    return 'https://hn.algolia.com/api/v1/search?' + params.toString();
}
export const threadUrl = (id) => 'https://news.ycombinator.com/item?id=' + encodeURIComponent(id);
/** Hits -> sources: the linked article when there is one, else the HN thread; the snippet shows points, comments and the thread. */
export function mapHackerNews(hits, count) {
    const sources = [];
    for (const hit of hits) {
        const id = typeof hit?.objectID === 'string' ? hit.objectID : undefined;
        const title = typeof hit?.title === 'string' ? hit.title.trim() : '';
        if (!id || !title)
            continue;
        const thread = threadUrl(id);
        const external = typeof hit.url === 'string' && /^https?:\/\//i.test(hit.url) ? hit.url : undefined;
        const text = typeof hit.story_text === 'string' ? stripTags(hit.story_text) : '';
        const meta = 'HN: ' + (hit.points ?? 0) + ' points, ' + (hit.num_comments ?? 0) + ' comments' + (external ? ' (discussion ' + thread + ')' : '');
        const snippet = [meta, text].filter(Boolean).join(' — ');
        sources.push({
            url: external ?? thread, title,
            snippet: snippet.length > SNIPPET_CHARS ? snippet.slice(0, SNIPPET_CHARS) + '…' : snippet,
            ...typeof hit.created_at === 'string' && hit.created_at ? { publishedAt: hit.created_at } : {},
        });
        if (sources.length >= count)
            break;
    }
    return sources;
}
export function parseHackerNews(body, count) {
    if (body === null || typeof body !== 'object' || Array.isArray(body) || !Array.isArray(body.hits))
        throw new EngineError('Hacker News returned an unprocessable response body', 'ENGINE_ERROR', true);
    const sources = mapHackerNews(body.hits, count);
    if (!sources.length)
        throw new EngineError('Hacker News returned no results', 'ENGINE_EMPTY', true);
    return sources;
}
export function hackerNewsEngine(deps) {
    return {
        id: HACKERNEWS_ROUTE_ID,
        label: 'Hacker News',
        available: () => true,
        async search(query, count, signal, options) {
            const res = await requestProvider('Hacker News', hackerNewsUrl(query, count, options?.since), { deps, signal });
            if (!res.ok)
                throw statusFailure('Hacker News', res.status, res.headers, safeDetail(typeof res.json === 'object' && res.json !== null ? res.json.message : undefined));
            recordRequest(deps, HACKERNEWS_USAGE_PROVIDER);
            if (res.json === undefined)
                throw new EngineError('Hacker News returned invalid JSON', 'ENGINE_ERROR', true);
            return { sources: parseHackerNews(res.json, count) };
        },
    };
}
export const HACKERNEWS_DESCRIPTOR = {
    id: 'builtin:hackernews',
    aliases: [HACKERNEWS_ROUTE_ID],
    label: 'Hacker News',
    adapterVersion: '1',
    contractVersion: 1,
    operations: ['search'],
    taskProfiles: ['experience', 'news_fact'],
    languages: ['en'],
    regions: ['global'],
    resultKinds: ['forum'],
    sourceFamily: 'hackernews',
    requirements: [],
    supportedFilters: ['time_window'],
    costModel: { kind: 'free', note: 'anonymous Algolia HN API (per-IP rate limit); requests counted in the usage ledger' },
    costTier: 'anonymous',
    priority: 80,
    verification: { live: true, note: 'live 2026-10-02: 2 requests (plain and numericFilters created_at_i), fixture test/fixtures/hackernews-search.json' },
};
export const hackerNewsAdapter = {
    descriptor: HACKERNEWS_DESCRIPTOR,
    probeLocal: () => ({ available: true, installation: 'not_required', credential: 'not_required' }),
    create: deps => hackerNewsEngine(deps),
    compile: (task, now) => compileKeywords(task, HACKERNEWS_ROUTE_ID, now, { terms: 4, since: true }),
};
//# sourceMappingURL=hackernews.js.map