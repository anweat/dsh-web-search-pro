/**
 * Search orchestration: engine ordering/fallback (agent-reach style routing),
 * optional parallel multi-engine merging, SQLite caching, and persistence.
 * @module web-search-pro/router
 */
import { credentialRef } from '@deepseek-ai/dsh-credentials';
import { seamEngine, exaEngine, ddgEngine, bingEngine, jinaSearchEngine, githubEngine, bilibiliEngine, v2exEngine, youtubeEngine, platformEngines, rssEngine, EngineError, } from "./engines.js";
import { normQuery, capText } from "./util.js";
import { LruCache } from "./memory-cache.js";
const ENGINE_FACTORIES = {
    seam: (_deps) => seamEngine(_deps),
    exa: (deps) => exaEngine(deps),
    ddg: () => ddgEngine(),
    bing: () => bingEngine(),
    jina: (deps) => jinaSearchEngine(deps),
    github: (deps) => githubEngine(deps),
    bilibili: (deps) => bilibiliEngine(deps),
    v2ex: () => v2exEngine(),
    youtube: (deps) => youtubeEngine(deps),
};
export class SearchRouter {
    ctx;
    config;
    store;
    dynamic;
    memory;
    constructor(ctx, config, store, dynamic = () => config, memory = new LruCache(config.memoryCacheEntries)) {
        this.ctx = ctx;
        this.config = config;
        this.store = store;
        this.dynamic = dynamic;
        this.memory = memory;
    }
    /** Resolve a key through credentials first, then process env. */
    async resolveKey(ref, literal) {
        if (literal && literal.length > 0)
            return literal;
        const credentials = this.ctx.get('credentials');
        if (credentials) {
            try {
                const resolved = await credentials.resolve(credentialRef(ref));
                if (resolved?.value)
                    return resolved.value;
            }
            catch { /* fall through to env */ }
        }
        return process.env[ref];
    }
    async deps(skipSeam) {
        const cfg = this.dynamic();
        const web = this.ctx.get('web');
        const exaApiKey = await this.resolveKey(cfg.exaApiKeyEnv, cfg.exaApiKey);
        const jinaApiKey = await this.resolveKey(cfg.jinaApiKeyEnv, cfg.jinaApiKey);
        return {
            ...web !== undefined ? { web } : {},
            ...exaApiKey ? { exaApiKey } : {},
            ...jinaApiKey ? { jinaApiKey } : {},
            enableCli: cfg.enableCliBackends,
            opencliEnabled: cfg.opencliEnabled,
            agentReachEnabled: cfg.agentReachEnabled,
            skipSeam,
        };
    }
    /** Sync key check for available() (no credential resolution — env/literal only). */
    depsSync(skipSeam) {
        const cfg = this.dynamic();
        const web = this.ctx.get('web');
        const exaApiKey = cfg.exaApiKey || process.env[cfg.exaApiKeyEnv];
        const jinaApiKey = cfg.jinaApiKey || process.env[cfg.jinaApiKeyEnv];
        return {
            ...web !== undefined ? { web } : {},
            ...exaApiKey ? { exaApiKey } : {},
            ...jinaApiKey ? { jinaApiKey } : {},
            enableCli: cfg.enableCliBackends,
            opencliEnabled: cfg.opencliEnabled,
            agentReachEnabled: cfg.agentReachEnabled,
            skipSeam,
        };
    }
    /** Whether any configured engine is currently usable. */
    anyEngineAvailable() {
        const ids = this.dynamic().engines;
        return ids.some(id => this.buildSync(id, false).available());
    }
    async build(id, skipSeam) {
        const factory = ENGINE_FACTORIES[id];
        if (!factory)
            throw new EngineError('unknown engine: ' + id, 'ENGINE_UNAVAILABLE', false);
        return factory(await this.deps(skipSeam), this.dynamic());
    }
    buildSync(id, skipSeam) {
        const factory = ENGINE_FACTORIES[id];
        if (!factory)
            throw new EngineError('unknown engine: ' + id, 'ENGINE_UNAVAILABLE', false);
        return factory(this.depsSync(skipSeam), this.dynamic());
    }
    /** Run a full search with caching + persistence. */
    async search(opts) {
        const query = opts.query.trim();
        if (!query)
            throw new Error('query must be a non-empty string');
        const cfg = this.dynamic();
        const ids = (opts.engines && opts.engines.length ? opts.engines : cfg.engines)
            .filter((id, i, arr) => arr.indexOf(id) === i);
        const nq = normQuery(query);
        const count = Math.min(Math.max(opts.count, 1), 20);
        // 1. In-process LRU cache, then SQLite.
        if (!opts.fresh) {
            for (const id of ids) {
                const hot = this.memory.get(id + '|' + nq, cfg.ttlSeconds * 1000);
                if (hot)
                    return { ...hot, fromCache: true, enginesTried: [id] };
            }
            for (const id of ids) {
                const cached = this.store.getCachedSearch(id, nq, cfg.ttlSeconds);
                if (cached) {
                    const rows = this.store.resultsForQuery(cached.id);
                    if (rows.length) {
                        let detail;
                        if (cached.detail) {
                            try {
                                detail = JSON.parse(cached.detail);
                            }
                            catch { /* ignore */ }
                        }
                        return {
                            ...detail?.content ? { content: detail.content } : {},
                            sources: rows.map(r => ({
                                url: r.url,
                                ...r.title ? { title: r.title } : {},
                                ...r.snippet ? { snippet: r.snippet } : {},
                                ...r.published ? { publishedAt: r.published } : {},
                            })),
                            engine: id,
                            enginesTried: [id],
                            fromCache: true,
                        };
                    }
                }
            }
        }
        // 2. Run engines.
        const enginesTried = [];
        let outcome;
        let usedId;
        const signal = opts.signal;
        if (opts.multi) {
            const results = await Promise.allSettled(ids.map(async (id) => {
                const engine = await this.build(id, opts.skipSeam ?? false);
                if (!engine.available())
                    throw new EngineError(engine.label + ' unavailable', 'ENGINE_UNAVAILABLE', false);
                return { id, outcome: await engine.search(query, count, signal) };
            }));
            enginesTried.push(...ids);
            // Reciprocal Rank Fusion: each engine's rank order contributes
            // 1/(k + rank); sources are ranked by summed score, so a source highly
            // ranked by several engines beats one ranked by a single engine.
            const k = Math.max(cfg.rrfConstant, 1);
            const scores = new Map();
            const entries = new Map();
            for (const r of results) {
                if (r.status !== 'fulfilled')
                    continue;
                r.value.outcome.sources.forEach((s, rank) => {
                    if (!s.url)
                        return;
                    const score = scores.get(s.url) ?? 0;
                    scores.set(s.url, score + 1 / (k + rank + 1));
                    if (!entries.has(s.url)) {
                        entries.set(s.url, { url: s.url, ...s.title ? { title: s.title } : {}, ...s.snippet ? { snippet: s.snippet } : {}, ...s.publishedAt ? { publishedAt: s.publishedAt } : {} });
                    }
                });
            }
            if (!scores.size)
                throw new Error('all engines failed: ' + enginesTried.join(', '));
            const ranked = [...scores.entries()].sort((a, b) => b[1] - a[1]).slice(0, count);
            outcome = { sources: ranked.map(([url]) => entries.get(url)) };
            usedId = 'multi(' + ids.join('+') + ')';
        }
        else {
            for (const id of ids) {
                enginesTried.push(id);
                const engine = await this.build(id, opts.skipSeam ?? false);
                if (!engine.available())
                    continue;
                try {
                    outcome = await engine.search(query, count, signal);
                    usedId = id;
                    break;
                }
                catch (error) {
                    if (signal?.aborted)
                        throw error;
                    // keep trying the next engine on failure
                }
            }
            if (!outcome || !usedId) {
                throw new Error('no engine produced results (tried: ' + enginesTried.join(', ') + ')');
            }
        }
        // 3. Persist.
        const queryId = this.store.recordQuery({
            kind: 'search',
            query: nq,
            engine: usedId,
            status: 'ok',
            ...outcome.content ? { detail: JSON.stringify({ content: outcome.content }) } : {},
        });
        this.store.recordResults(queryId, outcome.sources, usedId);
        const result = {
            ...outcome.content ? { content: outcome.content } : {},
            sources: outcome.sources.slice(0, count).map(s => ({
                url: s.url,
                ...s.title ? { title: s.title } : {},
                ...s.snippet ? { snippet: capText(s.snippet, 500) } : {},
                ...s.publishedAt ? { publishedAt: s.publishedAt } : {},
            })),
            engine: usedId,
            enginesTried,
            fromCache: false,
        };
        // 4. Warm the in-process LRU (memory-only; survives across SQLite hits).
        this.memory.set(usedId + '|' + nq, result);
        return result;
    }
    /** Platform search (web_platform_search tool) with the same cache+persist flow. */
    async platformSearch(platform, query, url, count, opts) {
        const nq = normQuery(query || url || platform);
        const engines = platform === 'rss' && url
            ? [rssEngine(url)]
            : platformEngines(platform, this.depsSync(true));
        if (!engines.length)
            throw new Error('unsupported platform: ' + platform);
        if (!opts.fresh) {
            const cached = this.store.getCachedSearch('platform-' + platform, nq, this.dynamic().ttlSeconds);
            if (cached) {
                const rows = this.store.resultsForQuery(cached.id);
                if (rows.length) {
                    return {
                        sources: rows.map(r => ({ url: r.url, ...r.title ? { title: r.title } : {}, ...r.snippet ? { snippet: r.snippet } : {} })),
                        engine: platform,
                        enginesTried: [platform],
                        fromCache: true,
                    };
                }
            }
        }
        const enginesTried = [];
        let outcome;
        for (const engine of engines) {
            enginesTried.push(engine.id);
            if (!engine.available())
                continue;
            try {
                outcome = await engine.search(query || 'latest', Math.min(Math.max(count, 1), 20), opts.signal);
                break;
            }
            catch (error) {
                if (opts.signal?.aborted)
                    throw error;
            }
        }
        if (!outcome)
            throw new Error('platform ' + platform + ' unavailable (tried: ' + enginesTried.join(', ') + ')');
        const queryId = this.store.recordQuery({
            kind: 'platform',
            query: nq,
            platform,
            engine: enginesTried.at(-1) ?? 'unknown',
            status: 'ok',
        });
        this.store.recordResults(queryId, outcome.sources, 'platform-' + platform);
        return { sources: outcome.sources, engine: platform, enginesTried, fromCache: false };
    }
    /**
     * ctx.web provider adapter: route the seam request through this router.
     * Returns a WebSearchResult-shaped value for the built-in web_search tool.
     */
    async searchAsProvider(request, signal) {
        const cfg = this.dynamic();
        const result = await this.search({
            query: request.query,
            count: request.maxResults ?? cfg.searchMaxResults,
            fresh: false,
            multi: cfg.parallelEngines,
            signal,
            skipSeam: true,
        });
        return {
            ...result.content ? { content: result.content } : {},
            sources: result.sources.map(s => ({ url: s.url, ...s.title ? { title: s.title } : {}, ...s.snippet ? { snippet: s.snippet } : {}, ...s.publishedAt ? { publishedAt: s.publishedAt } : {} })),
            truncated: result.sources.length > (request.maxResults ?? cfg.searchMaxResults),
        };
    }
}
//# sourceMappingURL=router.js.map