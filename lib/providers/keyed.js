/**
 * Shared plumbing of the keyed ("reserved interface") search sources (dev-plan M7c): Tavily, Brave, Linkup, Serper,
 * Metaso, Zhipu, Baidu Qianfan. Each is a descriptor + adapter in its own file; this module holds what they share:
 *
 *  - the key table: route id -> default environment variable names (the router resolves
 *    config literal `keyedSources.<id>.apiKey` -> credentials ref -> environment into `deps.sourceKeys`);
 *  - one request path (SSRF-safe `requestProvider`, redirects refused so a key never reaches another origin, request
 *    counted in the usage ledger with tokens n/a and no price);
 *  - the common status -> EngineError mapping, consistent with Bocha: 401 / 403 and 402 are not retryable (so no
 *    cooldown), `ENGINE_QUOTA` when the service says the account has no credit or quota, 429 is `ENGINE_RATE_LIMIT`
 *    carrying Retry-After, request errors (400 / 404 / 422) are not retryable, 5xx and the rest are retryable;
 *  - error messages that never contain the key or an unredacted response body (`safeDetail`).
 * A source without a key reports `credential: missing` and is not executable.
 * NO live call has been made to any of these services (no keys): every contract here comes from the documents cited
 * at the top of each adapter and is marked `verification.live = false`.
 * @module web-search-pro/providers/keyed
 */
import { EngineError } from "../engines.js";
import { requestProvider, safeDetail, statusFailure } from "./http.js";
/** Default environment variable names of each keyed source's API key, first one preferred (route id -> names). */
export const KEYED_SOURCE_ENVS = Object.freeze({
    tavily: ['TAVILY_API_KEY'],
    brave: ['BRAVE_API_KEY'],
    linkup: ['LINKUP_API_KEY'],
    serper: ['SERPER_API_KEY'],
    metaso: ['METASO_API_KEY'],
    zhipu: ['ZHIPU_API_KEY'],
    // The official page says "AppBuilder API Key" without naming a variable; the MIT reference SDK (searchsuite) reads both.
    'baidu-qianfan': ['QIANFAN_API_KEY', 'BAIDU_API_KEY'],
});
export const KEYED_SOURCE_IDS = Object.freeze(Object.keys(KEYED_SOURCE_ENVS));
export const KEYED_TIMEOUT_MS = 30_000;
export const SNIPPET_CHARS = 1_000;
/** Words that say "the account has no credit / quota / balance" (as opposed to "slow down"). */
export const QUOTA_WORDS = /money|quota|balance|insufficient|not enough|credit|plan limit|paygo|exhaust|overdue|arrears|余额|额度|欠费|套餐|充值/i;
/** First usable message of the error envelopes seen across these APIs (`detail.error`, `error.message`, `message`, `msg`, `errMsg`). */
export function errorMessage(json) {
    if (json === null || typeof json !== 'object')
        return '';
    const j = json;
    const detail = j.detail;
    const error = j.error;
    const candidates = [
        typeof detail === 'string' ? detail : detail?.error,
        Array.isArray(detail) ? detail[0]?.msg : undefined,
        typeof error === 'string' ? error : error?.message,
        j.message, j.msg, j.errMsg,
    ];
    for (const c of candidates)
        if (typeof c === 'string' && c.trim())
            return safeDetail(c);
    return '';
}
/** Business error code of an envelope (`error.code`, `code`), as a string; empty when absent. */
export function errorCode(json) {
    if (json === null || typeof json !== 'object')
        return '';
    const j = json;
    const code = j.error?.code ?? j.code;
    return typeof code === 'string' || typeof code === 'number' ? String(code) : '';
}
/**
 * The shared HTTP-status mapping. `detail` is already safe. A 401 / 403 / 429 whose message says "no credit / quota"
 * is `ENGINE_QUOTA` (not retryable, no cooldown: a wait does not refill a balance); 402 is always quota (payment
 * required: the adapter only ever sends its key, it never pays).
 */
export function keyedFailure(label, status, headers, detail, quota = false) {
    if (quota || status === 402 || ((status === 401 || status === 403 || status === 429) && QUOTA_WORDS.test(detail))) {
        return new EngineError(label + ': ' + (detail || 'no credit or quota') + ' (HTTP ' + status + '; the account has no balance, credit or quota for this API)', 'ENGINE_QUOTA', false);
    }
    return statusFailure(label, status, headers, detail);
}
/** `text` trimmed and cut at `SNIPPET_CHARS`; undefined when blank. */
export function snippetOf(value, max = SNIPPET_CHARS) {
    if (typeof value !== 'string')
        return undefined;
    const t = value.replace(/\s+/g, ' ').trim();
    if (!t)
        return undefined;
    return t.length > max ? t.slice(0, max) + '…' : t;
}
export const textOf = (value) => (typeof value === 'string' && value.trim() ? value.trim() : undefined);
export const isHttpUrl = (value) => typeof value === 'string' && /^https?:\/\//i.test(value.trim());
/** `n` clamped to `[min, max]` as an integer. */
export const clamp = (n, min, max) => Math.min(Math.max(Math.floor(n), min), max);
/** Cut `text` to at most `chars` characters and `words` whitespace-separated words (query limits). */
export function limitQuery(text, chars, words) {
    let out = text.replace(/\s+/g, ' ').trim();
    if (words !== undefined) {
        const parts = out.split(' ');
        if (parts.length > words)
            out = parts.slice(0, words).join(' ');
    }
    return out.length > chars ? [...out].slice(0, chars).join('').trim() : out;
}
/** `YYYY-MM-DD` of an ISO timestamp or a Date. */
export const dayOf = (iso) => (typeof iso === 'string' ? iso : iso.toISOString()).slice(0, 10);
/** The key of a keyed source in `deps`, undefined when not configured. */
export const keyOf = (deps, route) => deps.sourceKeys?.[route] || undefined;
export function missingKeyMessage(label, route) {
    const env = KEYED_SOURCE_ENVS[route] ?? [];
    return label + ' is not configured: set $' + env.join(' or $') + ' (or credentials ref / settings keyedSources.' + route + '.apiKey)';
}
export function keyedEngine(spec, deps) {
    return {
        id: spec.route,
        label: spec.label,
        available: () => keyOf(deps, spec.route) !== undefined,
        async search(query, count, signal, options) {
            const key = keyOf(deps, spec.route);
            if (!key)
                throw new EngineError(missingKeyMessage(spec.label, spec.route), 'ENGINE_UNAVAILABLE', false);
            const base = (deps.sourceBaseUrls?.[spec.route] ?? spec.defaultBase).replace(/\/+$/, '');
            const req = spec.request(query, count, options);
            let url = base + spec.path;
            if (req.method === 'GET') {
                const params = new URLSearchParams();
                for (const [k, v] of Object.entries(req.params ?? {}))
                    if (v !== undefined && v !== '')
                        params.set(k, v);
                const qs = params.toString();
                if (qs)
                    url += '?' + qs;
            }
            const res = await requestProvider(spec.label, url, {
                deps, signal, method: req.method, redirect: 'error', timeoutMs: KEYED_TIMEOUT_MS,
                ...req.method === 'POST' ? { body: JSON.stringify(req.body ?? {}) } : {},
                headers: { ...req.method === 'POST' ? { 'content-type': 'application/json' } : {}, ...req.headers(key) },
            });
            if (!res.ok)
                throw spec.failure(res);
            // A 2xx answer is a billed request, whatever it holds.
            try {
                deps.usage?.record({ provider: spec.route, protocol: 'search', requests: 1, note: 'tokens n/a, price unknown' });
            }
            catch { /* the ledger is advisory */ }
            if (res.json === undefined)
                throw new EngineError(spec.label + ' returned invalid JSON', 'ENGINE_ERROR', true);
            return { sources: spec.parse(res.json, count) };
        },
    };
}
/** Descriptor for a keyed source: web results, search only, metered per request, a key requirement, not verified live. */
export function keyedDescriptor(d) {
    const { route, costNote, verificationNote, ...rest } = d;
    return {
        id: 'builtin:' + route,
        aliases: [route],
        adapterVersion: '1',
        contractVersion: 1,
        operations: ['search'],
        taskProfiles: ['general', 'news_fact', 'experience', 'compare', 'docs_code'],
        resultKinds: ['web'],
        requirements: [{ kind: 'key', id: route + '-key', env: [...KEYED_SOURCE_ENVS[route] ?? []] }],
        costModel: { kind: 'metered', unit: 'request', note: costNote },
        priority: 50,
        verification: { live: false, note: verificationNote },
        ...rest,
    };
}
export function keyedAdapter(descriptor, spec, compile) {
    const route = descriptor.aliases[0];
    const full = { ...spec, route, label: descriptor.label };
    return {
        descriptor,
        probeLocal({ deps }) {
            return keyOf(deps, route)
                ? { available: true, installation: 'not_required', credential: 'configured' }
                : { available: false, installation: 'not_required', credential: 'missing', reason: 'no ' + descriptor.label + ' key (set $' + (KEYED_SOURCE_ENVS[route] ?? []).join(' or $') + ')', diagnosticCode: 'credential_missing' };
        },
        create: deps => keyedEngine(full, deps),
        compile,
    };
}
/** Fail a 2xx body that is not an object. */
export function expectObject(label, json) {
    if (json === null || typeof json !== 'object' || Array.isArray(json))
        throw new EngineError(label + ' returned an unprocessable response body', 'ENGINE_ERROR', true);
    return json;
}
export function emptyResults(label) {
    return new EngineError(label + ' returned no results', 'ENGINE_EMPTY', true);
}
//# sourceMappingURL=keyed.js.map