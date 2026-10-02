/**
 * SearXNG meta-search, ONLY when the user sets `searxngUrl` (no public instance is built in: most disable the JSON
 * format or rate-limit it). Contract source: https://docs.searxng.org/dev/search_api.html — `GET {base}/search?q=…&format=json`
 * (`language`, `pageno`, `time_range`, `categories`); `format=json` must be enabled under `search.formats`, otherwise the
 * instance answers 403; results in `results[]` with `url`, `title`, `content`, `engine`, `publishedDate`.
 *
 * The URL is the user's own configuration (never model input), so a private or loopback address — the normal home of
 * a self-hosted instance — is allowed here, unlike the public-only HTTP path of the other sources. Still enforced:
 * http(s) only, no credentials in the URL, no redirects, bounded body, timeout.
 * @module web-search-pro/providers/searxng
 */
import { EngineError } from "../engines.js";
import { detectLang } from "../pipeline/align.js";
import { compileSince } from "../pipeline/compile.js";
import { readBoundedBody } from "../safe-http.js";
import { PROVIDER_USER_AGENT, recordRequest, safeDetail, statusFailure } from "./http.js";
export const SEARXNG_ROUTE_ID = 'searxng';
export const SEARXNG_USAGE_PROVIDER = 'searxng';
const TIMEOUT_MS = 30_000;
const MAX_BODY_BYTES = 4 * 1024 * 1024;
const SNIPPET_CHARS = 500;
/** The configured base URL as a clean http(s) URL without credentials, trailing slash or query; throws a readable error otherwise. */
export function searxngBase(raw) {
    const text = raw?.trim();
    if (!text)
        throw new EngineError('SearXNG unavailable: set searxngUrl to your instance (JSON format enabled)', 'ENGINE_UNAVAILABLE', false);
    let url;
    try {
        url = new URL(text);
    }
    catch {
        throw new EngineError('SearXNG searxngUrl is not a valid URL', 'ENGINE_UNAVAILABLE', false);
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:')
        throw new EngineError('SearXNG searxngUrl must be http(s)', 'ENGINE_UNAVAILABLE', false);
    if (url.username || url.password)
        throw new EngineError('SearXNG searxngUrl must not contain credentials', 'ENGINE_UNAVAILABLE', false);
    url.search = '';
    url.hash = '';
    url.pathname = url.pathname.replace(/\/+$/, '');
    return url;
}
export function searxngUrl(base, query, lang) {
    const l = lang ?? (detectLang(query) === 'zh' ? 'zh' : undefined);
    const params = new URLSearchParams({ q: query, format: 'json', ...l ? { language: l === 'zh' ? 'zh-CN' : 'en' } : {} });
    return base.href.replace(/\/+$/, '') + '/search?' + params.toString();
}
export function mapSearxng(results, count) {
    const sources = [];
    const seen = new Set();
    for (const r of results) {
        const url = typeof r?.url === 'string' ? r.url.trim() : '';
        if (!/^https?:\/\//i.test(url) || seen.has(url))
            continue;
        seen.add(url);
        const title = typeof r.title === 'string' ? r.title.trim() : '';
        const text = typeof r.content === 'string' ? r.content.replace(/\s+/g, ' ').trim() : '';
        sources.push({
            url, ...title ? { title } : {}, ...text ? { snippet: text.length > SNIPPET_CHARS ? text.slice(0, SNIPPET_CHARS) + '…' : text } : {},
            ...typeof r.publishedDate === 'string' && r.publishedDate ? { publishedAt: r.publishedDate } : {},
        });
        if (sources.length >= count)
            break;
    }
    return sources;
}
export function parseSearxng(body, count) {
    if (body === null || typeof body !== 'object' || Array.isArray(body) || !Array.isArray(body.results))
        throw new EngineError('SearXNG returned an unprocessable response body (is the json format enabled?)', 'ENGINE_ERROR', true);
    const sources = mapSearxng(body.results, count);
    if (!sources.length)
        throw new EngineError('SearXNG returned no results', 'ENGINE_EMPTY', true);
    return sources;
}
export function searxngEngine(deps) {
    return {
        id: SEARXNG_ROUTE_ID,
        label: 'SearXNG',
        available: () => (deps.searxngUrl?.trim().length ?? 0) > 0,
        async search(query, count, signal, options) {
            const base = searxngBase(deps.searxngUrl);
            const timeout = AbortSignal.timeout(TIMEOUT_MS);
            const stage = signal ? AbortSignal.any([signal, timeout]) : timeout;
            let response;
            try {
                response = await (deps.fetchImpl ?? fetch)(searxngUrl(base, query, options?.lang), { method: 'GET', redirect: 'error', signal: stage, headers: { 'user-agent': PROVIDER_USER_AGENT, accept: 'application/json' } });
            }
            catch (error) {
                if (signal?.aborted)
                    throw error;
                if (timeout.aborted)
                    throw new EngineError('SearXNG timed out', 'ENGINE_TIMEOUT', true);
                throw new EngineError('SearXNG request failed: ' + safeDetail(error instanceof Error ? error.message : String(error)), 'ENGINE_ERROR', true);
            }
            let raw;
            try {
                raw = (await readBoundedBody(response, MAX_BODY_BYTES)).toString('utf8');
            }
            catch (error) {
                if (signal?.aborted)
                    throw error;
                if (timeout.aborted)
                    throw new EngineError('SearXNG timed out', 'ENGINE_TIMEOUT', true);
                throw new EngineError('SearXNG response unreadable: ' + safeDetail(error instanceof Error ? error.message : String(error)), 'ENGINE_ERROR', true);
            }
            if (response.status === 403)
                throw new EngineError('SearXNG answered 403: the json format is probably not enabled (search.formats in settings.yml) or the instance blocks this client', 'ENGINE_UNAVAILABLE', false);
            if (response.status === 429)
                throw statusFailure('SearXNG', 429, response.headers);
            if (!response.ok)
                throw statusFailure('SearXNG', response.status, response.headers);
            recordRequest(deps, SEARXNG_USAGE_PROVIDER);
            let parsed;
            try {
                parsed = JSON.parse(raw);
            }
            catch {
                throw new EngineError('SearXNG did not return JSON (is the json format enabled?)', 'ENGINE_ERROR', true);
            }
            return { sources: parseSearxng(parsed, count) };
        },
    };
}
export const SEARXNG_DESCRIPTOR = {
    id: 'builtin:searxng',
    aliases: [SEARXNG_ROUTE_ID],
    label: 'SearXNG',
    adapterVersion: '1',
    contractVersion: 1,
    operations: ['search'],
    taskProfiles: ['general', 'news_fact', 'experience', 'compare', 'docs_code'],
    languages: ['*'],
    regions: ['global'],
    resultKinds: ['web'],
    requirements: [{ kind: 'service', id: 'searxng-instance', note: 'set searxngUrl to a self-hosted instance with the json format enabled; no public instance is built in' }],
    supportedFilters: [],
    costModel: { kind: 'free', note: 'self-hosted' },
    priority: 90,
    verification: { live: false, note: 'contract from the SearXNG Search API documentation; needs a user-run instance, never run live' },
};
export const searxngAdapter = {
    descriptor: SEARXNG_DESCRIPTOR,
    probeLocal({ deps, config }) {
        const url = (deps.searxngUrl ?? config.searxngUrl)?.trim();
        return url
            ? { available: true, installation: 'not_required', credential: 'not_required' }
            : { available: false, installation: 'not_required', credential: 'not_required', reason: 'searxngUrl is not set (no public instance is built in)', diagnosticCode: 'service_missing' };
    },
    create: deps => searxngEngine(deps),
    compile: (task, now) => compileSince(task, SEARXNG_ROUTE_ID, now, { lang: true }),
};
//# sourceMappingURL=searxng.js.map