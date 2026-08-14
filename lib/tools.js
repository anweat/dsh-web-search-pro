/**
 * Tool definitions for web-search-pro: 8 model-facing tools over the router,
 * fetch service, store, and playwright manager.
 * @module web-search-pro/tools
 */
import { defineTool } from '@deepseek-ai/dsh-tools';
import { mergedRules } from "./fetch.js";
import { SEARCH_ENGINE_IDS, PLATFORM_IDS } from "./engines.js";
import { detectDeps, installDep } from "./deps.js";
function sourceLine(s) {
    const label = s.title && s.title.length ? s.title : safeHost(s.url);
    const meta = [];
    if (s.snippet)
        meta.push(s.snippet);
    if (s.publishedAt)
        meta.push('(' + s.publishedAt + ')');
    const suffix = meta.length ? ' — ' + meta.join(' ') : '';
    return '- [' + label + '](' + s.url + ')' + suffix;
}
function safeHost(url) {
    try {
        return new URL(url).hostname;
    }
    catch {
        return url;
    }
}
export function formatSources(sources) {
    if (!sources.length)
        return 'No results found.';
    return sources.map(sourceLine).join('\n');
}
export function registerTools(deps) {
    const { ctx, config, dynamic, store, router, fetch: fetchSvc, pw } = deps;
    ctx.tools.register(defineTool({
        name: 'web_search_pro',
        description: 'Enhanced persistent web search: multi-engine routing (DeepSeek/Exa/DuckDuckGo/Bing/Jina), automatic engine fallback, TTL-cached results stored in SQLite, and a query history. Use for current information, then web_fetch_pro for full page content.',
        parameters: {
            query: { type: 'string', required: true, description: 'The search query.' },
            engines: { type: 'string', description: 'Comma-separated engine ids to try, in order. Options: ' + SEARCH_ENGINE_IDS.join(', ') + '. Defaults to the configured engine list.' },
            count: { type: 'number', description: 'Max results (1-20). Defaults to ' + String(config.searchMaxResults) + '.' },
            fresh: { type: 'boolean', description: 'Bypass the TTL cache and force a live search.' },
            multi: { type: 'boolean', description: 'Query all requested engines in parallel and merge results (slower, broader).' },
        },
        output: {
            schema: {
                type: 'object',
                additionalProperties: false,
                properties: {
                    content: { type: 'string' },
                    sources: { type: 'array', required: true, items: { type: 'object', additionalProperties: false, properties: { url: { type: 'string', required: true }, title: { type: 'string' }, snippet: { type: 'string' }, publishedAt: { type: 'string' } } } },
                    engine: { type: 'string', required: true },
                    enginesTried: { type: 'array', required: true, items: { type: 'string' } },
                    fromCache: { type: 'boolean', required: true },
                },
            },
            render: (_args, value) => {
                const v = value;
                const parts = [];
                if (v.content)
                    parts.push(v.content);
                parts.push(formatSources(v.sources));
                parts.push('Engine: ' + v.engine + (v.fromCache ? ' (cached)' : '') + (v.enginesTried.length > 1 ? '; tried: ' + v.enginesTried.join(', ') : ''));
                parts.push('Cite the relevant URLs above as markdown links in your answer.');
                return [{ type: 'text', text: parts.join('\n\n') }];
            },
        },
        timeoutMs: config.timeoutMs,
        isConcurrencySafe: () => true,
        presentCall: (args) => ({ card: 'generic', kind: 'search', title: args.query, rawInput: args.query }),
        async execute(args, exec) {
            const engines = args.engines ? args.engines.split(',').map(s => s.trim()).filter(Boolean) : undefined;
            for (const id of engines ?? []) {
                if (!SEARCH_ENGINE_IDS.includes(id))
                    throw new Error('unknown engine: ' + id);
            }
            const result = await router.search({
                query: args.query,
                ...engines ? { engines } : {},
                count: args.count ?? dynamic().searchMaxResults,
                fresh: args.fresh ?? false,
                multi: args.multi ?? dynamic().parallelEngines,
                signal: exec.signal,
            });
            return {
                ...result.content ? { content: result.content } : {},
                sources: result.sources,
                engine: result.engine,
                enginesTried: result.enginesTried,
                fromCache: result.fromCache,
            };
        },
    }));
    ctx.tools.register(defineTool({
        name: 'web_fetch_pro',
        description: 'Enhanced persistent page fetch: Jina Reader → direct HTTP with per-site extraction rules (userscript-style, e.g. zhihu/bilibili/github) → Playwright rendering fallback. Snapshots are stored in SQLite and reused within the TTL.',
        parameters: {
            url: { type: 'string', required: true, description: 'The HTTP(S) URL to fetch.' },
            mode: { type: 'string', description: 'Backend: auto (default), jina, http, or playwright.' },
            maxChars: { type: 'number', description: 'Output cap in characters (1000-500000).' },
            fresh: { type: 'boolean', description: 'Bypass the cached snapshot.' },
            persist: { type: 'boolean', description: 'Save the snapshot to the persistent store (default true).' },
        },
        output: {
            schema: {
                type: 'object',
                additionalProperties: false,
                properties: {
                    url: { type: 'string', required: true },
                    title: { type: 'string' },
                    text: { type: 'string', required: true },
                    source: { type: 'string', required: true },
                    fromCache: { type: 'boolean', required: true },
                    statusCode: { type: 'number' },
                },
            },
            render: (_args, value) => {
                const v = value;
                const parts = [];
                if (v.title)
                    parts.push('Title: ' + v.title);
                parts.push(v.text);
                parts.push('— Source: ' + v.source + (v.fromCache ? ' (cached snapshot)' : '') + ' · ' + v.url);
                return [{ type: 'text', text: parts.join('\n\n') }];
            },
        },
        timeoutMs: config.timeoutMs + 30_000,
        async execute(args, exec) {
            const mode = (args.mode ?? 'auto');
            if (!['auto', 'jina', 'http', 'playwright'].includes(mode))
                throw new Error('mode must be auto, jina, http, or playwright');
            return fetchSvc.fetchPage(args.url, {
                mode,
                signal: exec.signal,
                maxChars: args.maxChars ?? 100_000,
                fresh: args.fresh ?? false,
                persist: args.persist ?? true,
            });
        },
    }));
    ctx.tools.register(defineTool({
        name: 'web_platform_search',
        description: 'Search a specific platform: ' + PLATFORM_IDS.join(', ') + '. Chinese communities (zhihu/weibo/douban/tieba/douyin/kuaishou) drive the logged-in browser search page via Playwright — they need the user to log in once (run scripts/save-login.mjs, or set playwright.storageStatePath), and selectors are tunable via settings.yaml platformRules. Results are persisted to the search history.',
        parameters: {
            platform: { type: 'string', required: true, description: 'Platform: ' + PLATFORM_IDS.join(', ') + '.' },
            query: { type: 'string', required: true, description: 'The search query (feed URL for rss).' },
            url: { type: 'string', description: 'Feed URL when platform is rss.' },
            count: { type: 'number', description: 'Max results (1-20).' },
        },
        output: {
            schema: {
                type: 'object',
                additionalProperties: false,
                properties: {
                    platform: { type: 'string', required: true },
                    sources: { type: 'array', required: true, items: { type: 'object', additionalProperties: false, properties: { url: { type: 'string', required: true }, title: { type: 'string' }, snippet: { type: 'string' }, publishedAt: { type: 'string' } } } },
                    engine: { type: 'string', required: true },
                    fromCache: { type: 'boolean', required: true },
                },
            },
            render: (_args, value) => {
                const v = value;
                return [{ type: 'text', text: 'Platform: ' + v.platform + ' (via ' + v.engine + (v.fromCache ? ', cached' : '') + ')\n\n' + formatSources(v.sources) }];
            },
        },
        timeoutMs: config.timeoutMs + 30_000,
        isConcurrencySafe: () => true,
        async execute(args, exec) {
            if (!PLATFORM_IDS.includes(args.platform))
                throw new Error('unsupported platform: ' + args.platform);
            const result = await router.platformSearch(args.platform, args.query, args.url, args.count ?? 8, { signal: exec.signal });
            return { platform: args.platform, sources: result.sources, engine: result.engine, fromCache: result.fromCache };
        },
    }));
    ctx.tools.register(defineTool({
        name: 'web_snapshot',
        description: 'Render a page in a headless browser (Playwright, optional persisted login state), extract readable text with per-site rules, and save a full-page screenshot + HTML to disk. Returns file paths. Use for JS-heavy pages or when you need a visual capture.',
        parameters: {
            url: { type: 'string', required: true, description: 'The HTTP(S) URL to snapshot.' },
            screenshot: { type: 'boolean', description: 'Save a full-page PNG screenshot (default true).' },
        },
        output: {
            schema: {
                type: 'object',
                additionalProperties: false,
                properties: {
                    url: { type: 'string', required: true },
                    title: { type: 'string' },
                    text: { type: 'string', required: true },
                    screenshotPath: { type: 'string' },
                    htmlPath: { type: 'string' },
                },
            },
            render: (_args, value) => {
                const v = value;
                const parts = [];
                if (v.title)
                    parts.push('Title: ' + v.title);
                parts.push(v.text);
                if (v.screenshotPath)
                    parts.push('Screenshot: ' + v.screenshotPath);
                if (v.htmlPath)
                    parts.push('HTML: ' + v.htmlPath);
                return [{ type: 'text', text: parts.join('\n\n') }];
            },
        },
        timeoutMs: config.timeoutMs + 60_000,
        async execute(args, exec) {
            const rules = mergedRules(store);
            const shot = await pw.snapshot(args.url, rules, {
                signal: exec.signal,
                outDir: config.playwright.snapshotDir,
            });
            const out = {
                url: args.url,
                ...shot.title ? { title: shot.title } : {},
                text: shot.text,
                htmlPath: shot.htmlPath,
            };
            if (args.screenshot !== false)
                out.screenshotPath = shot.screenshotPath;
            store.savePage({
                url: args.url,
                ...shot.title ? { title: shot.title } : {},
                text: shot.text,
                htmlPath: shot.htmlPath,
                ...out.screenshotPath ? { screenshotPath: out.screenshotPath } : {},
                source: 'playwright',
            });
            store.recordQuery({ kind: 'snapshot', url: args.url, query: shot.title ?? args.url, engine: 'playwright', status: 'ok', detail: JSON.stringify({ screenshotPath: out.screenshotPath, htmlPath: shot.htmlPath }) });
            return out;
        },
    }));
    ctx.tools.register(defineTool({
        name: 'web_history',
        description: 'Query the persistent search/fetch/snapshot history stored in SQLite (queries, engines, timestamps).',
        parameters: {
            kind: { type: 'string', description: 'Filter: search, fetch, platform, snapshot, or all.' },
            query: { type: 'string', description: 'Substring filter on the query or URL.' },
            engine: { type: 'string', description: 'Filter by engine id (e.g. ddg, github, multi(...)).' },
            platform: { type: 'string', description: 'Filter by platform (e.g. github, zhihu, arxiv).' },
            limit: { type: 'number', description: 'Max rows (1-200, default 20).' },
            replay: { type: 'string', description: 'A query id from web_history records; returns that query saved result sources.' },
            export: { type: 'boolean', description: 'Write the filtered history (with results) to a JSON file and return its path.' },
        },
        output: {
            schema: {
                type: 'object',
                additionalProperties: false,
                properties: {
                    records: { type: 'array', required: true, items: { type: 'object', additionalProperties: false, properties: { id: { type: 'string' }, kind: { type: 'string' }, query: { type: 'string' }, engine: { type: 'string' }, platform: { type: 'string' }, url: { type: 'string' }, status: { type: 'string' }, ts: { type: 'string' } } } },
                    replayedSources: { type: 'array', items: { type: 'object', additionalProperties: false, properties: { url: { type: 'string', required: true }, title: { type: 'string' }, snippet: { type: 'string' }, publishedAt: { type: 'string' } } } },
                    exportPath: { type: 'string' },
                },
            },
            render: (_args, value) => {
                const v = value;
                const parts = [];
                if (v.records.length) {
                    parts.push(v.records.map(r => {
                        const what = r.query ?? r.url ?? '';
                        const via = r.engine ?? r.platform ?? '';
                        return '- [' + r.kind + '] ' + r.ts + ' · ' + (r.status === 'ok' ? 'ok' : r.status) + ' · ' + what + (via ? ' (' + via + ')' : '') + (r.id ? ' · id=' + r.id : '');
                    }).join('\n'));
                }
                else {
                    parts.push('No history records found.');
                }
                if (v.replayedSources?.length)
                    parts.push('Replayed sources:\n' + v.replayedSources.map(s => '- [' + (s.title ?? s.url) + '](' + s.url + ')' + (s.snippet ? ' — ' + s.snippet : '')).join('\n'));
                if (v.exportPath)
                    parts.push('Exported to: ' + v.exportPath);
                return [{ type: 'text', text: parts.join('\n\n') }];
            },
        },
        timeoutMs: 15_000,
        isConcurrencySafe: () => true,
        async execute(args) {
            const kind = args.kind;
            if (kind && !['search', 'fetch', 'platform', 'snapshot'].includes(kind))
                throw new Error('kind must be search, fetch, platform, snapshot, or omitted');
            const records = store.listQueries({
                ...kind ? { kind } : {},
                ...args.query ? { query: args.query } : {},
                ...args.engine ? { engine: args.engine } : {},
                ...args.platform ? { platform: args.platform } : {},
                limit: args.limit ?? 20,
            });
            const mapped = records.map(r => ({
                id: r.id,
                kind: r.kind,
                ...r.query ? { query: r.query } : {},
                ...r.engine ? { engine: r.engine } : {},
                ...r.platform ? { platform: r.platform } : {},
                ...r.url ? { url: r.url } : {},
                status: r.status,
                ts: r.ts,
            }));
            const out = { records: mapped };
            if (args.replay) {
                const rows = store.resultsForQuery(args.replay);
                if (!rows.length)
                    throw new Error('no saved results for query id ' + args.replay);
                out.replayedSources = rows.map(r => ({ url: r.url, ...r.title ? { title: r.title } : {}, ...r.snippet ? { snippet: r.snippet } : {}, ...r.published ? { publishedAt: r.published } : {} }));
            }
            if (args.export) {
                const { default: fs } = await import('node:fs');
                const { default: path } = await import('node:path');
                const outDir = path.dirname(config.dbPath);
                fs.mkdirSync(outDir, { recursive: true });
                const exportPath = path.join(outDir, 'history-export-' + Date.now() + '.json');
                const payload = mapped.map(r => ({ ...r, results: store.resultsForQuery(r.id).map(s => ({ url: s.url, ...s.title ? { title: s.title } : {}, ...s.snippet ? { snippet: s.snippet } : {} })) }));
                fs.writeFileSync(exportPath, JSON.stringify(payload, null, 2), 'utf8');
                out.exportPath = exportPath;
            }
            return out;
        },
    }));
    ctx.tools.register(defineTool({
        name: 'web_cache_clear',
        description: 'Purge persisted search results / page snapshots from the SQLite store (by age and/or engine). Returns removed counts.',
        parameters: {
            olderThanDays: { type: 'number', description: 'Only purge records older than N days; omit to purge everything.' },
            engine: { type: 'string', description: 'Only purge records from this engine.' },
        },
        output: {
            schema: {
                type: 'object',
                additionalProperties: false,
                properties: {
                    removedQueries: { type: 'number', required: true },
                    removedResults: { type: 'number', required: true },
                    removedPages: { type: 'number', required: true },
                },
            },
            render: (_args, value) => [{ type: 'text', text: 'Removed ' + value.removedQueries + ' queries, ' + value.removedResults + ' result rows, ' + value.removedPages + ' page snapshots.' }],
        },
        timeoutMs: 20_000,
        async execute(args) {
            const removed = store.clearCache({
                ...args.olderThanDays != null ? { olderThanDays: args.olderThanDays } : {},
                ...args.engine ? { engine: args.engine } : {},
            });
            return { removedQueries: removed.queries, removedResults: removed.results, removedPages: removed.pages };
        },
    }));
    ctx.tools.register(defineTool({
        name: 'web_rule',
        description: 'Manage persistent per-site extraction rules (userscript-style): contentSelectors and removeSelectors applied when fetching/snapshotting pages from that hostname. Rules survive restarts in SQLite and override built-ins. Supports list/upsert/remove plus export/import as a JSON rule pack.',
        parameters: {
            action: { type: 'string', required: true, description: 'list, upsert, remove, export, or import.' },
            hostname: { type: 'string', description: 'Site hostname, e.g. example.com (required for upsert/remove).' },
            contentSelectors: { type: 'string', description: 'Comma-separated CSS selectors for the main content (upsert).' },
            removeSelectors: { type: 'string', description: 'Comma-separated CSS selectors to remove before extraction (upsert).' },
            rulesJson: { type: 'string', description: 'JSON array of {hostname, content, remove?} rules to import (action=import).' },
        },
        output: {
            schema: {
                type: 'object',
                additionalProperties: false,
                properties: {
                    message: { type: 'string' },
                    rules: { type: 'array', items: { type: 'object', additionalProperties: false, properties: { hostname: { type: 'string' }, content: { type: 'string' }, remove: { type: 'string' } } } },
                },
            },
            render: (_args, value) => {
                const v = value;
                const parts = [];
                if (v.message)
                    parts.push(v.message);
                if (v.rules?.length) {
                    parts.push('Rules:');
                    for (const r of v.rules)
                        parts.push('- ' + r.hostname + ' → content: ' + r.content + (r.remove ? ' | remove: ' + r.remove : ''));
                }
                return [{ type: 'text', text: parts.join('\n') || 'No rules.' }];
            },
        },
        timeoutMs: 10_000,
        async execute(args) {
            const action = args.action;
            if (!['list', 'upsert', 'remove', 'export', 'import'].includes(action))
                throw new Error('action must be list, upsert, remove, export, or import');
            if (action === 'list' || action === 'export') {
                return { rules: store.listRules().map(r => ({ hostname: r.hostname, content: r.content, ...r.remove ? { remove: r.remove } : {} })) };
            }
            if (action === 'import') {
                if (!args.rulesJson)
                    throw new Error('rulesJson is required for import');
                let parsed;
                try {
                    parsed = JSON.parse(args.rulesJson);
                }
                catch {
                    throw new Error('rulesJson is not valid JSON');
                }
                if (!Array.isArray(parsed))
                    throw new Error('rulesJson must be a JSON array');
                let count = 0;
                for (const item of parsed) {
                    if (typeof item?.hostname !== 'string' || typeof item?.content !== 'string')
                        continue;
                    store.upsertRule(item.hostname, item.content, item.remove);
                    count++;
                }
                return { message: 'Imported ' + count + ' rules', rules: store.listRules().map(r => ({ hostname: r.hostname, content: r.content, ...r.remove ? { remove: r.remove } : {} })) };
            }
            if (!args.hostname)
                throw new Error('hostname is required for ' + action);
            if (action === 'upsert') {
                if (!args.contentSelectors)
                    throw new Error('contentSelectors is required for upsert');
                store.upsertRule(args.hostname, args.contentSelectors, args.removeSelectors);
                return { message: 'Rule upserted for ' + args.hostname.toLowerCase() };
            }
            const removed = store.removeRule(args.hostname);
            return { message: removed ? 'Rule removed for ' + args.hostname.toLowerCase() : 'No rule found for ' + args.hostname.toLowerCase() };
        },
    }));
    ctx.tools.register(defineTool({
        name: 'web_search_stats',
        description: 'Report the persistent store state: database size and record counts per table, plus configured engines.',
        parameters: {},
        output: {
            schema: {
                type: 'object',
                additionalProperties: false,
                properties: {
                    dbPath: { type: 'string', required: true },
                    dbSizeBytes: { type: 'number', required: true },
                    queries: { type: 'number', required: true },
                    results: { type: 'number', required: true },
                    pages: { type: 'number', required: true },
                    rules: { type: 'number', required: true },
                    engines: { type: 'array', required: true, items: { type: 'string' } },
                },
            },
            render: (_args, value) => {
                const v = value;
                return [{ type: 'text', text: [
                            'Database: ' + v.dbPath,
                            'Size: ' + (v.dbSizeBytes / 1024).toFixed(1) + ' KB',
                            'Queries: ' + v.queries,
                            'Result rows: ' + v.results,
                            'Page snapshots: ' + v.pages,
                            'Custom rules: ' + v.rules,
                            'Engines: ' + v.engines.join(', '),
                        ].join('\n') }];
            },
        },
        timeoutMs: 10_000,
        isConcurrencySafe: () => true,
        async execute() {
            const stats = store.stats();
            return { dbPath: config.dbPath, ...stats, engines: dynamic().engines };
        },
    }));
    ctx.tools.register(defineTool({
        name: 'web_deps',
        description: 'Detect or install the external tools this plugin shells out to (gh, bili, yt-dlp, opencli, agent-reach, mcporter, playwright). check reports which are present and how to install them; install runs the package-manager command for one backend. Prefer check first; install only when the user asks.',
        parameters: {
            action: { type: 'string', required: true, description: 'check (default) or install.' },
            backend: { type: 'string', description: 'Dependency id to install (gh, bili, yt-dlp, opencli, agent-reach, mcporter, playwright).' },
            installer: { type: 'string', description: 'Package manager: winget, choco, uv, pipx, pip, or npm.' },
        },
        output: {
            schema: {
                type: 'object',
                additionalProperties: false,
                properties: {
                    backends: { type: 'array', required: true, items: { type: 'object', additionalProperties: false, properties: { id: { type: 'string', required: true }, label: { type: 'string', required: true }, usedBy: { type: 'string', required: true }, available: { type: 'boolean', required: true }, path: { type: 'string' }, installs: { type: 'array', required: true, items: { type: 'object', additionalProperties: false, properties: { installer: { type: 'string', required: true }, command: { type: 'string', required: true } } } } } } },
                    message: { type: 'string' },
                    install: { type: 'object', additionalProperties: false, properties: { code: { type: 'number' }, stdout: { type: 'string' }, stderr: { type: 'string' }, timedOut: { type: 'boolean' } } },
                },
            },
            render: (_args, value) => {
                const v = value;
                const parts = [];
                if (v.message)
                    parts.push(v.message);
                if (v.backends.length) {
                    for (const b of v.backends) {
                        parts.push((b.available ? '✅' : '❌') + ' ' + b.label + ' (' + b.id + ') — ' + b.usedBy + (b.available && b.path ? ' · ' + b.path : ''));
                        if (!b.available)
                            parts.push('   安装: ' + b.installs.map(i => i.installer + ': ' + i.command).join('   |   '));
                    }
                }
                if (v.install)
                    parts.push('安装结果 exit=' + v.install.code + (v.install.timedOut ? ' (超时)' : '') + '\n' + (v.install.stderr || v.install.stdout).slice(0, 2000));
                return [{ type: 'text', text: parts.join('\n') }];
            },
        },
        timeoutMs: config.timeoutMs + 180_000,
        isConcurrencySafe: () => true,
        async execute(args, exec) {
            if (args.action === 'install') {
                if (!args.backend)
                    throw new Error('backend is required for install');
                const installer = args.installer ?? defaultInstallerFor(args.backend);
                const result = await installDep(args.backend, installer);
                return { backends: [], install: { ...result } };
            }
            if (args.action !== 'check' && args.action !== 'install')
                throw new Error('action must be check or install');
            const backends = await detectDeps();
            const allOk = backends.every(b => b.available);
            return {
                backends: backends.map(b => ({ ...b, installs: b.installs })),
                ...allOk ? { message: '所有外部依赖已就绪。' } : { message: '部分外部依赖缺失，可对缺失项运行 web_deps action=install（或手动执行列出的安装命令）。' },
            };
        },
    }));
}
function defaultInstallerFor(backend) {
    switch (backend) {
        case 'gh': return 'winget';
        case 'bili': return 'uv';
        case 'yt-dlp': return 'uv';
        case 'agent-reach': return 'uv';
        case 'opencli': return 'npm';
        case 'mcporter': return 'npm';
        case 'playwright': return 'npm';
        default: throw new Error('unknown backend: ' + backend);
    }
}
//# sourceMappingURL=tools.js.map