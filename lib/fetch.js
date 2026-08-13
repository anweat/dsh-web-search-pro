/**
 * Enhanced page fetch pipeline (agent-reach Jina reader + userscript-style
 * extraction + playwright fallback), with page snapshot persistence.
 * @module web-search-pro/fetch
 */
import { extractText, BUILTIN_RULES } from "./extract.js";
import { httpGet, capText } from "./util.js";
import { LruCache } from "./memory-cache.js";
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
    return parsed.href;
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
    pw;
    memory = new LruCache(128);
    constructor(store, config, pw) {
        this.store = store;
        this.config = config;
        this.pw = pw;
    }
    cfg() {
        return typeof this.config === 'function' ? this.config() : this.config;
    }
    async fetchPage(url, opts) {
        const normalized = normalizeUrl(url);
        const maxChars = Math.min(Math.max(opts.maxChars, 1_000), 500_000);
        if (!opts.fresh) {
            const hot = this.memory.get('page|' + normalized, this.cfg().ttlSeconds * 1000);
            if (hot)
                return { ...hot, fromCache: true };
            const cached = this.store.getPage(normalized, this.cfg().ttlSeconds);
            if (cached && cached.text) {
                const page = {
                    url: normalized,
                    ...cached.title ? { title: cached.title } : {},
                    text: capText(cached.text, maxChars),
                    source: 'cache:' + (cached.source ?? 'unknown'),
                    fromCache: true,
                    ...cached.status !== undefined ? { statusCode: cached.status } : {},
                };
                this.memory.set('page|' + normalized, page);
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
        this.memory.set('page|' + normalized, result);
        if (opts.persist) {
            this.store.savePage({
                url: normalized,
                ...result.title ? { title: result.title } : {},
                text: result.text,
                ...result.statusCode !== undefined ? { status: result.statusCode } : {},
                source: result.source,
            });
            this.store.recordQuery({
                kind: 'fetch',
                url: normalized,
                query: result.title ?? normalized,
                engine: result.source,
                status: 'ok',
                detail: JSON.stringify({ textLength: result.text.length, usedRule: result.usedRule }),
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
        const res = await httpGet('https://r.jina.ai/' + url, { headers, signal: opts.signal, timeoutMs: 30_000 });
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
        const res = await httpGet(url, { signal: opts.signal, timeoutMs: 30_000 });
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
        const rendered = await this.pw.render(url, rules, { signal: opts.signal, maxChars });
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