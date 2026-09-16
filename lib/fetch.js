/**
 * Enhanced page fetch pipeline (agent-reach Jina reader + userscript-style
 * extraction + playwright fallback), with page snapshot persistence.
 * @module web-search-pro/fetch
 */
import { extractText, BUILTIN_RULES } from "./extract.js";
import { httpGet, capText } from "./util.js";
import { LruCache } from "./memory-cache.js";
import { assertSafePublicUrl } from "./safe-http.js";
/**
 * Heuristic: a "shell" page looks like text but is really navigation — search
 * forms, "look elsewhere" pointers, JS-only stubs. Signals: very little prose,
 * a high link-to-text ratio, or explicit form/redirect phrasing. Returning true
 * lets the tool tell the model to fetch one of the pointed-at URLs instead of
 * re-fetching the same kind of page in a loop (P1-3).
 */
export function detectShellPage(text) {
    const trimmed = text.trim();
    if (!trimmed || trimmed.length < 200)
        return true;
    const linkCount = (trimmed.match(/\[[^\]]*\]\([^)]*\)/g) ?? []).length;
    const words = trimmed.split(/\s+/).filter(Boolean).length;
    // Link-dense: more than one markdown link per ~15 words is navigation, not prose.
    if (words > 0 && linkCount / words > 1 / 15)
        return true;
    // Explicit form/redirect phrasing with almost no other content.
    const shellPhrases = /\b(search for|search by|look here|try searching|no results found|please (use|go to|visit)|enter (a |your )?(query|keyword)|data is (available|located) at)\b/i;
    if (shellPhrases.test(trimmed) && words < 250)
        return true;
    return false;
}
/** Validate and normalize a URL for fetching. */
export function normalizeUrl(raw) {
    const trimmed = raw.trim();
    if (!/^https?:\/\//i.test(trimmed)) {
        throw new Error('url must be an http(s) URL');
    }
    let parsed;
    try {
        parsed = new URL(trimmed);
    }
    catch {
        throw new Error('url is not a valid URL');
    }
    return assertSafePublicUrl(parsed).href;
}
/** All rules: user (DB) first, then built-ins; user rules win on ties. */
export function mergedRules(store) {
    const dbRules = store.listRules().map(r => ({
        hostname: r.hostname,
        contentSelectors: r.content.split(/[,\n]/).map(s => s.trim()).filter(Boolean),
        ...r.remove ? { removeSelectors: r.remove.split(/[,\n]/).map(s => s.trim()).filter(Boolean) } : {},
    }));
    return [...dbRules, ...BUILTIN_RULES];
}
export class FetchService {
    store;
    config;
    browser;
    memory = new LruCache(128);
    constructor(store, config, browser) {
        this.store = store;
        this.config = config;
        this.browser = browser;
    }
    cfg() {
        return typeof this.config === 'function' ? this.config() : this.config;
    }
    async fetchPage(url, opts) {
        const normalized = normalizeUrl(url);
        const maxChars = Math.min(Math.max(opts.maxChars, 1_000), 500_000);
        const memoryKey = ['page', normalized, opts.mode, maxChars, opts.persist ? 'persist' : 'ephemeral'].join('|');
        if (!opts.fresh) {
            const hot = this.memory.get(memoryKey, this.cfg().ttlSeconds * 1000);
            if (hot)
                return { ...hot, fromCache: true };
            // Auto mode may reuse the freshest successful representation. An explicit
            // backend is a caller contract and must not silently replay another mode.
            const cached = this.store.getPage(normalized, this.cfg().ttlSeconds, opts.mode === 'auto' ? undefined : opts.mode);
            if (cached && cached.text) {
                const page = {
                    url: normalized,
                    ...cached.title ? { title: cached.title } : {},
                    text: capText(cached.text, maxChars),
                    source: 'cache:' + (cached.source ?? 'unknown'),
                    fromCache: true,
                    ...typeof cached.status === 'number' ? { statusCode: cached.status } : {},
                };
                this.memory.set(memoryKey, page);
                return page;
            }
        }
        const rules = mergedRules(this.store);
        let result;
        if (opts.mode === 'auto' || opts.mode === 'jina') {
            try {
                result = await this.fetchJina(normalized, opts, maxChars);
            }
            catch (error) {
                if (opts.mode === 'jina')
                    throw error;
                if (opts.signal?.aborted)
                    throw error;
            }
        }
        if (!result && (opts.mode === 'auto' || opts.mode === 'http')) {
            try {
                result = await this.fetchHttp(normalized, opts, maxChars, rules);
            }
            catch (error) {
                if (opts.mode === 'http')
                    throw error;
                if (opts.signal?.aborted)
                    throw error;
            }
        }
        if (!result && (opts.mode === 'auto' || opts.mode === 'playwright')) {
            if (this.cfg().playwright.enabled) {
                result = await this.fetchPlaywright(normalized, opts, maxChars, rules);
            }
            else if (opts.mode === 'playwright') {
                throw new Error('playwright backend is disabled in config');
            }
        }
        if (!result) {
            throw new Error('all fetch backends failed for ' + normalized);
        }
        // P1-3: flag navigation/JS/form shells so the model knows there is no data
        // here and should follow the pointers instead of re-fetching the same page.
        if (detectShellPage(result.text))
            result.shellPage = true;
        this.memory.set(memoryKey, result);
        if (opts.persist) {
            const queryId = this.store.recordQuery({
                kind: 'fetch',
                url: normalized,
                query: result.title ?? normalized,
                engine: result.source,
                status: 'ok',
                detail: JSON.stringify({ textLength: result.text.length, usedRule: result.usedRule }),
            });
            this.store.savePage({
                queryId,
                url: normalized,
                ...result.title ? { title: result.title } : {},
                text: result.text,
                ...result.statusCode !== undefined ? { status: result.statusCode } : {},
                source: result.source,
            });
        }
        return result;
    }
    async fetchJina(url, opts, maxChars) {
        const cfg = this.cfg();
        const headers = {};
        const key = cfg.jinaApiKey || process.env[cfg.jinaApiKeyEnv];
        if (key)
            headers['authorization'] = 'Bearer ' + key;
        headers['x-respond-with'] = 'markdown';
        const res = await httpGet('https://r.jina.ai/' + url, { headers, signal: opts.signal, timeoutMs: 30_000, allowProxyFakeIp: cfg.allowProxyFakeIp });
        if (res.status === 401 && !key)
            throw new Error('jina reader requires an API key (set jinaApiKey or $JINA_API_KEY)');
        if (!res.ok)
            throw new Error('jina reader HTTP ' + res.status);
        const text = res.text;
        // Jina returns "# Title\n\ncontent"; peel the first H1 as title when present.
        let title;
        let body = text;
        const m = /^#\s+(.+?)\s*\n/.exec(text);
        if (m) {
            title = m[1].trim();
            body = text.slice(m[0].length);
        }
        return { url, ...title ? { title } : {}, text: capText(body.trim(), maxChars), source: 'jina', fromCache: false };
    }
    async fetchHttp(url, opts, maxChars, rules) {
        const res = await httpGet(url, { signal: opts.signal, timeoutMs: 30_000, allowProxyFakeIp: this.cfg().allowProxyFakeIp });
        const contentType = res.contentType ?? '';
        const isHtml = /html|xml/i.test(contentType) || /<\s*!doctype|<!DOCTYPE|(<html[\s>])/i.test(res.text.slice(0, 2000));
        if (isHtml) {
            const extracted = extractText(res.text, res.finalUrl, rules, maxChars);
            return {
                url: res.finalUrl,
                ...extracted.title ? { title: extracted.title } : {},
                text: extracted.text || capText(res.text.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim(), maxChars),
                source: 'http',
                fromCache: false,
                statusCode: res.status,
                ...extracted.usedRule ? { usedRule: extracted.usedRule } : {},
            };
        }
        return { url: res.finalUrl, text: capText(res.text, maxChars), source: 'http', fromCache: false, statusCode: res.status };
    }
    async fetchPlaywright(url, opts, maxChars, rules) {
        const rendered = await this.browser.render(url, rules, { signal: opts.signal, maxChars });
        return {
            url,
            ...rendered.title ? { title: rendered.title } : {},
            text: rendered.text,
            source: 'playwright',
            fromCache: false,
            ...rendered.usedRule ? { usedRule: rendered.usedRule } : {},
        };
    }
}
//# sourceMappingURL=fetch.js.map