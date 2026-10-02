/**
 * Tool definitions for web-search-pro: 8 model-facing tools over the router,
 * fetch service, store, and playwright manager.
 * @module web-search-pro/tools
 */
import { defineTool } from '@deepseek-ai/dsh-tools';
import { resolveAllRubrics } from "./pipeline/rubrics.js";
import { judgeStatus } from "./pipeline/judge-status.js";
import { browserState, requireBrowser, toBrowserGetter } from "./browser-access.js";
import { mergedRules } from "./fetch.js";
import { PLATFORM_IDS, isPlatformSupported } from "./engines.js";
import { defaultProviderRegistry } from "./providers/index.js";
import { detectDeps, installDep } from "./deps.js";
import { loadCatalog } from "./catalog/load.js";
import { recommendSources, renderRecommendation } from "./catalog/recommend.js";
import { expandEvidence, replayHistory } from "./history.js";
import { EvidenceService } from "./pipeline/service.js";
import { renderEvidencePack } from "./pipeline/render.js";
import { PROFILES } from "./pipeline/types.js";
import { capText } from "./util.js";
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
const EVIDENCE_ITEM_SCHEMA = {
    type: 'object', additionalProperties: false,
    properties: {
        evidenceId: { type: 'string', required: true }, blockId: { type: 'string' }, url: { type: 'string', required: true }, title: { type: 'string' },
        excerpt: { type: 'string', required: true }, heading: { type: 'string' }, publishedAt: { type: 'string' }, lowConfidence: { type: 'boolean' },
        needIds: { type: 'array', required: true, items: { type: 'string' } }, grade: { type: 'number', required: true }, source: { type: 'string', required: true },
    },
};
/** Output schema fields added for the evidence pipeline (all optional: the classic output stays valid). */
const EVIDENCE_OUTPUT_PROPERTIES = {
    resultId: { type: 'string' },
    profile: { type: 'string' },
    profileInferred: { type: 'boolean' },
    needs: { type: 'array', items: { type: 'object', additionalProperties: false, properties: { id: { type: 'string', required: true }, text: { type: 'string', required: true }, critical: { type: 'boolean', required: true } } } },
    evidence: { type: 'array', items: EVIDENCE_ITEM_SCHEMA },
    coveredNeeds: { type: 'array', items: { type: 'string' } },
    gaps: { type: 'array', items: { type: 'object', additionalProperties: false, properties: { needId: { type: 'string', required: true }, text: { type: 'string', required: true }, critical: { type: 'boolean', required: true }, reason: { type: 'string', required: true }, bestGrade: { type: 'number' } } } },
    partial: { type: 'boolean' },
    notes: { type: 'array', items: { type: 'string' } },
    verification: { type: 'object', additionalProperties: false, properties: { native: { type: 'array', required: true, items: { type: 'string' } }, local: { type: 'array', required: true, items: { type: 'string' } } } },
    stats: {
        type: 'object', additionalProperties: false,
        properties: {
            candidates: { type: 'number' }, kept: { type: 'number' }, lowConfidence: { type: 'number' }, fetched: { type: 'number' }, blocksScored: { type: 'number' }, excerptChars: { type: 'number' }, scorer: { type: 'string' }, rounds: { type: 'number' }, queries: { type: 'number' },
            jev: { type: 'object', additionalProperties: false, properties: { requests: { type: 'number' }, questions: { type: 'number' }, inputTokens: { type: 'number' }, outputTokens: { type: 'number' }, mode: { type: 'string' }, rubric: { type: 'string' }, rubricOverridden: { type: 'boolean' }, provider: { type: 'string' }, protocol: { type: 'string' }, model: { type: 'string' }, calibration: { type: 'string' }, estimated: { type: 'boolean' } } },
        },
    },
};
/** One registry provider in `web_backend_status` (all fields beyond id / label / readiness.available are optional extensions). */
const PROVIDER_REPORT_SCHEMA = {
    type: 'object', additionalProperties: false,
    properties: {
        id: { type: 'string', required: true }, route: { type: 'string' }, aliases: { type: 'array', items: { type: 'string' } }, label: { type: 'string', required: true },
        operations: { type: 'array', items: { type: 'string' } }, taskProfiles: { type: 'array', items: { type: 'string' } }, languages: { type: 'array', items: { type: 'string' } },
        regions: { type: 'array', items: { type: 'string' } }, resultKinds: { type: 'array', items: { type: 'string' } }, sourceFamily: { type: 'string' },
        requirements: { type: 'array', items: { type: 'object', additionalProperties: false, properties: { kind: { type: 'string', required: true }, id: { type: 'string', required: true }, env: { type: 'array', items: { type: 'string' } }, optional: { type: 'boolean' }, note: { type: 'string' } } } },
        supportedFilters: { type: 'array', items: { type: 'string' } },
        costModel: { type: 'object', additionalProperties: false, properties: { kind: { type: 'string', required: true }, unit: { type: 'string' }, note: { type: 'string' } } },
        unverified: { type: 'boolean' },
        readiness: { type: 'object', additionalProperties: false, properties: {
                available: { type: 'boolean', required: true }, installation: { type: 'string' }, credential: { type: 'string' }, health: { type: 'string' }, reason: { type: 'string' }, diagnosticCode: { type: 'string' },
                lastLocalCheck: { type: 'string' }, lastRemoteSuccess: { type: 'string' }, lastError: { type: 'string' }, cooldownUntil: { type: 'string' },
            } },
    },
};
/** `web_backend_status action=recommend`: at most three sources for the task, ready ones first. */
const RECOMMEND_SCHEMA = {
    type: 'object', additionalProperties: false,
    properties: {
        profile: { type: 'string', required: true }, profileInferred: { type: 'boolean' }, language: { type: 'string' },
        picks: { type: 'array', required: true, items: { type: 'object', additionalProperties: false, properties: {
                    id: { type: 'string', required: true }, label: { type: 'string', required: true }, kind: { type: 'string' }, status: { type: 'string', required: true }, executable: { type: 'boolean', required: true },
                    use: { type: 'string', required: true }, why: { type: 'string' }, missing: { type: 'array', items: { type: 'string' } }, setup: { type: 'string' }, notFor: { type: 'string' }, verified: { type: 'boolean' }, sourceFamily: { type: 'string' },
                } } },
        instruction: { type: 'string', required: true },
        notes: { type: 'array', items: { type: 'string' } },
    },
};
const DEFAULT_FETCH_CHARS = 20_000;
/** One-line explanation per non-content page class (web_fetch_pro render). */
const PAGE_CLASS_NOTE = {
    shell: 'This page contains no extractable data (navigation/JS shell).',
    js_shell: 'This page needs JavaScript to show its content and no browser render was available or helpful.',
    login_wall: 'This page is a login wall; the content is not available without signing in.',
    captcha: 'This page is a captcha / bot check, not the requested content.',
    error: 'This page is an error response, not the requested content.',
};
/**
 * Per-item character limit so that `sum(min(length, limit)) <= total` and `limit <= perItem`:
 * short texts keep all they have and the room they leave over goes to the long ones.
 */
export function fairShareLimit(lengths, perItem, total) {
    const sorted = lengths.filter(n => n > 0).sort((a, b) => a - b);
    let room = total;
    let left = sorted.length;
    for (const n of sorted) {
        const wanted = Math.min(n, perItem);
        const share = Math.floor(room / left);
        if (wanted > share)
            return Math.max(share, 0);
        room -= wanted;
        left--;
    }
    return perItem;
}
export function registerTools(deps) {
    const { ctx, config, dynamic, store, router, fetch: fetchSvc } = deps;
    const getBrowser = toBrowserGetter(deps.browser);
    /** Default characters one text exit may return (config `fetchDefaultChars`). */
    const outputCap = () => dynamic().fetchDefaultChars ?? DEFAULT_FETCH_CHARS;
    let evidenceService = deps.evidence;
    const evidence = () => (evidenceService ??= new EvidenceService({ router, fetch: fetchSvc, store, dynamic }));
    ctx.tools.register(defineTool({
        name: 'web_search_pro',
        description: 'Web search over DeepSeek/Exa/Bocha/DuckDuckGo/Bing/Jina with engine fallback, SQLite cache and history; web_fetch_pro reads a result. Evidence mode: pass task (one-sentence goal) or profile (docs_code, news_fact, academic, experience, compare, general) to get an evidence pack of only the passages that answer your needs, plus gaps, instead of a result list; also needs, constraints, budget.',
        parameters: {
            query: { type: 'string', required: true, description: 'The search query.' },
            engines: { type: 'string', description: 'Comma-separated engine ids, tried in order: ' + (router.registry ?? defaultProviderRegistry).searchIds().join(', ') + '. Default: configured list.' },
            count: { type: 'number', description: 'Max results (1-20), default ' + String(config.searchMaxResults) + '.' },
            fresh: { type: 'boolean', description: 'Bypass the cache.' },
            multi: { type: 'boolean', description: 'Query all engines in parallel and merge.' },
            exaType: { type: 'string', description: 'Exa mode: instant, fast, auto, deep-lite, deep, deep-reasoning.' },
            includeDomains: { type: 'string', description: 'Exa only: domain allowlist (comma-separated).' },
            excludeDomains: { type: 'string', description: 'Exa only: domain denylist (comma-separated).' },
            startPublishedDate: { type: 'string', description: 'Exa only: ISO published-date lower bound.' },
            endPublishedDate: { type: 'string', description: 'Exa only: ISO published-date upper bound.' },
            category: { type: 'string', description: 'Exa only: search category.' },
            task: { type: 'string', description: 'Evidence mode: your goal in one short sentence (not the chat); switches to an evidence pack.' },
            profile: { type: 'string', description: 'Evidence mode: docs_code, news_fact, academic, experience, compare or general; selects sources (inferred if omitted).' },
            needs: { type: 'string', description: 'Evidence mode: sub-questions separated by ";" (or a JSON array); default the task.' },
            constraints: { type: 'string', description: 'Evidence mode: JSON array of {"kind","value","strength"}; kind: must_term, exclude_term, entity, version, time_window, site, exclude_site, language, region, source_type; strength: hard (drop violators) or soft (default).' },
            budget: { type: 'number', description: 'Evidence mode: excerpt characters (default 6000, max 30000). fresh, multi and Exa options are ignored there.' },
        },
        output: {
            schema: {
                type: 'object',
                additionalProperties: false,
                properties: {
                    ...EVIDENCE_OUTPUT_PROPERTIES,
                    content: { type: 'string' },
                    sources: { type: 'array', required: true, items: { type: 'object', additionalProperties: false, properties: { url: { type: 'string', required: true }, title: { type: 'string' }, snippet: { type: 'string' }, publishedAt: { type: 'string' }, lowConfidence: { type: 'boolean' } } } },
                    engine: { type: 'string', required: true },
                    enginesTried: { type: 'array', required: true, items: { type: 'string' } },
                    fromCache: { type: 'boolean', required: true },
                    fallbackNote: { type: 'string' },
                },
            },
            render: (_args, value) => {
                const v = value;
                const pack = value;
                if (pack.resultId !== undefined && pack.evidence && pack.needs && pack.coveredNeeds && pack.gaps && pack.verification) {
                    return [{ type: 'text', text: renderEvidencePack({ resultId: pack.resultId, profile: pack.profile ?? 'general', needs: pack.needs, evidence: pack.evidence, coveredNeeds: pack.coveredNeeds, gaps: pack.gaps, partial: pack.partial === true, notes: pack.notes ?? [], verification: pack.verification }, v.sources, 'Engine: ' + v.engine + (v.enginesTried.length ? '; tried: ' + v.enginesTried.join(', ') : '')) }];
                }
                const parts = [];
                if (v.content)
                    parts.push(v.content);
                parts.push(formatSources(v.sources));
                // P1-1: surface *why* the router fell back, so the model can adapt its query.
                parts.push('Engine: ' + v.engine + (v.fromCache ? ' (cached)' : '') + (v.fallbackNote ? ' (' + v.fallbackNote + ')' : '') + (v.enginesTried.length > 1 ? '; tried: ' + v.enginesTried.join(', ') : ''));
                // P1-2/P1-4: no blanket "cite the URLs" instruction — it pushes the model
                // to answer from titles without reading. Instead, point at fetching when
                // the results are thin, and give an actionable retry hint when empty.
                const withSnippet = v.sources.filter(s => s.snippet && s.snippet.trim()).length;
                if (!v.sources.length) {
                    parts.push('No usable results for this query. Retry with a different phrasing, a site: filter, or the "api documentation" / "<host> API" form.');
                }
                else if (withSnippet < v.sources.length) {
                    parts.push('These are navigation targets — several lack snippets. Fetch the most relevant 1-2 before answering.');
                }
                return [{ type: 'text', text: parts.join('\n\n') }];
            },
        },
        // The evidence path reads pages and may score remotely: its own deadline
        // (timeoutMs + 30 s, then a partial pack) must come before this host ceiling.
        timeoutMs: config.timeoutMs + 60_000,
        isConcurrencySafe: () => true,
        presentCall: (args) => ({ card: 'generic', kind: 'search', title: args.query, rawInput: args.query }),
        async execute(args, exec) {
            // Ids come from the provider registry: aliases and namespaced ids (ddg, builtin:ddg) are accepted, unknown ones list what exists.
            const engines = args.engines ? (router.registry ?? defaultProviderRegistry).validate(args.engines.split(',').map(s => s.trim()).filter(Boolean)) : undefined;
            if (args.task || args.profile) {
                const out = await evidence().search({
                    query: args.query,
                    ...args.task ? { task: args.task } : {},
                    ...args.profile ? { profile: args.profile } : {},
                    ...args.needs ? { needs: args.needs } : {},
                    ...args.constraints ? { constraints: args.constraints } : {},
                    ...args.budget !== undefined ? { budget: args.budget } : {},
                    ...engines ? { engines } : {},
                    count: Math.min(Math.max(args.count ?? dynamic().searchMaxResults, 1), 20),
                    signal: exec.signal,
                });
                const ignored = [args.fresh !== undefined && 'fresh', args.multi !== undefined && 'multi', (args.exaType || args.includeDomains || args.excludeDomains || args.startPublishedDate || args.endPublishedDate || args.category) && 'exa options'].filter(Boolean);
                return { ...out, ...ignored.length ? { notes: [...out.notes, 'ignored in evidence mode: ' + ignored.join(', ')] } : {} };
            }
            const result = await router.search({
                query: args.query,
                ...engines ? { engines } : {},
                count: args.count ?? dynamic().searchMaxResults,
                fresh: args.fresh ?? false,
                multi: args.multi ?? dynamic().parallelEngines,
                signal: exec.signal,
                ...(args.exaType || args.includeDomains || args.excludeDomains || args.startPublishedDate || args.endPublishedDate || args.category) ? { exa: {
                        ...args.exaType ? { type: args.exaType } : {},
                        ...args.includeDomains ? { includeDomains: args.includeDomains.split(',').map(s => s.trim()).filter(Boolean) } : {},
                        ...args.excludeDomains ? { excludeDomains: args.excludeDomains.split(',').map(s => s.trim()).filter(Boolean) } : {},
                        ...args.startPublishedDate ? { startPublishedDate: args.startPublishedDate } : {},
                        ...args.endPublishedDate ? { endPublishedDate: args.endPublishedDate } : {},
                        ...args.category ? { category: args.category } : {},
                    } } : {},
            });
            return {
                ...result.content ? { content: result.content } : {},
                sources: result.sources,
                engine: result.engine,
                enginesTried: result.enginesTried,
                fromCache: result.fromCache,
                ...result.fallbackNote ? { fallbackNote: result.fallbackNote } : {},
            };
        },
    }));
    ctx.tools.register(defineTool({
        name: 'web_exa_contents',
        description: 'Full text of up to 100 URLs via Exa /contents (needs the Exa key). Capped at ' + String(config.exaContentsPerUrlChars) + ' chars per URL and ' + String(config.exaContentsTotalChars) + ' in total; web_fetch_pro offset reads the rest.',
        parameters: {
            urls: { type: 'array', required: true, items: { type: 'string' }, description: 'HTTP(S) URLs, at most 100.' },
        },
        output: {
            schema: {
                type: 'object', additionalProperties: false,
                properties: {
                    results: { type: 'array', required: true, items: { type: 'object', additionalProperties: false, properties: { url: { type: 'string', required: true }, title: { type: 'string' }, text: { type: 'string' }, publishedDate: { type: 'string' }, truncated: { type: 'boolean' }, totalChars: { type: 'number' } } } },
                    note: { type: 'string' },
                },
            },
            render: (_args, value) => {
                const v = value;
                const body = v.results.map(row => (row.title ? '# ' + row.title + '\n' : '') + row.url + '\n\n' + (row.text ?? '')).join('\n\n---\n\n');
                return [{ type: 'text', text: v.note ? body + '\n\n' + v.note : body }];
            },
        },
        timeoutMs: config.timeoutMs + 30_000,
        isConcurrencySafe: () => true,
        async execute(args, exec) {
            if (!args.urls.length || args.urls.length > 100)
                throw new Error('urls must contain 1-100 entries');
            const cfg = dynamic();
            const rows = await router.exaContents(args.urls, exec.signal);
            const perUrl = cfg.exaContentsPerUrlChars ?? 8_000;
            const total = cfg.exaContentsTotalChars ?? 30_000;
            const limit = fairShareLimit(rows.map(row => row.text?.length ?? 0), perUrl, total);
            let cut = 0;
            const results = rows.map(row => {
                const text = row.text;
                const over = text !== undefined && text.length > limit;
                if (over)
                    cut++;
                return {
                    url: row.url,
                    ...row.title ? { title: row.title } : {},
                    ...text ? { text: over ? capText(text, limit) : text } : {},
                    ...row.publishedDate ? { publishedDate: row.publishedDate } : {},
                    ...over ? { truncated: true, totalChars: text.length } : {},
                };
            });
            return {
                results,
                ...cut ? { note: cut + ' of ' + results.length + ' text(s) cut to ' + limit + ' chars (caps: ' + perUrl + ' per URL, ' + total + ' total). Read the rest with web_fetch_pro url=<url> offset=' + limit + '.' } : {},
            };
        },
    }));
    ctx.tools.register(defineTool({
        name: 'web_fetch_pro',
        description: 'Fetch a page as readable text: Jina → HTTP with per-site rules → Playwright when the result is a shell or login wall and dsh-browser is ready. Snapshots are cached in SQLite. Output is capped at ' + String(config.fetchDefaultChars) + ' chars; read on with offset.',
        parameters: {
            url: { type: 'string', required: true, description: 'The HTTP(S) URL to fetch.' },
            mode: { type: 'string', description: 'auto (default), jina, http or playwright (needs dsh-browser; auto skips it when absent).' },
            maxChars: { type: 'number', description: 'Output cap in chars (1000-500000), default ' + String(config.fetchDefaultChars) + '.' },
            offset: { type: 'number', description: 'Continue from this character offset (a truncated result gives nextOffset); served from the stored snapshot.' },
            fresh: { type: 'boolean', description: 'Bypass the cached snapshot.' },
            persist: { type: 'boolean', description: 'Store the snapshot (default true).' },
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
                    usedRule: { type: 'string' },
                    shellPage: { type: 'boolean' },
                    pageClass: { type: 'string' },
                    attempts: { type: 'array', items: { type: 'object', additionalProperties: false, properties: { source: { type: 'string', required: true }, class: { type: 'string', required: true }, chars: { type: 'number' }, detail: { type: 'string' } } } },
                    truncated: { type: 'boolean' },
                    nextOffset: { type: 'number' },
                    totalChars: { type: 'number' },
                },
            },
            render: (_args, value) => {
                const v = value;
                const parts = [];
                if (v.title)
                    parts.push('Title: ' + v.title);
                // P1-3: a navigation/JS/form shell has no data — say so and point the
                // model at the links it contains instead of re-fetching the same page.
                if (v.shellPage) {
                    const pointed = (v.text.match(/\[[^\]]*\]\((https?:[^)]+)\)/g) ?? []).map(s => s.slice(s.indexOf('(') + 1, -1)).slice(0, 5);
                    parts.push(PAGE_CLASS_NOTE[v.pageClass ?? 'shell'] ?? PAGE_CLASS_NOTE['shell']);
                    if (pointed.length)
                        parts.push('It points to: ' + pointed.join(', ') + '. Consider fetching one of those instead.');
                }
                parts.push(v.text);
                parts.push('— Source: ' + v.source + (v.fromCache ? ' (cached snapshot)' : '') + ' · ' + v.url + (v.attempts && v.attempts.length > 1 ? ' · tried ' + v.attempts.map(a => a.source + ':' + a.class).join(' → ') : ''));
                if (v.nextOffset !== undefined)
                    parts.push('more: call web_fetch_pro with offset=' + v.nextOffset + (v.totalChars !== undefined ? ' (page has ' + v.totalChars + ' chars)' : ''));
                return [{ type: 'text', text: parts.join('\n\n') }];
            },
        },
        timeoutMs: config.timeoutMs + 30_000,
        isConcurrencySafe: () => true,
        async execute(args, exec) {
            const mode = (args.mode ?? 'auto');
            if (!['auto', 'jina', 'http', 'playwright'].includes(mode))
                throw new Error('mode must be auto, jina, http, or playwright');
            if (args.offset !== undefined && (!Number.isFinite(args.offset) || args.offset < 0))
                throw new Error('offset must be a non-negative number of characters');
            const page = await fetchSvc.fetchPage(args.url, {
                mode,
                signal: exec.signal,
                maxChars: args.maxChars ?? dynamic().fetchDefaultChars ?? DEFAULT_FETCH_CHARS,
                ...args.offset !== undefined ? { offset: args.offset } : {},
                fresh: args.fresh ?? false,
                persist: args.persist ?? true,
            });
            return {
                url: page.url,
                ...page.title ? { title: page.title } : {},
                text: page.text,
                source: page.source,
                fromCache: page.fromCache,
                ...page.statusCode !== undefined ? { statusCode: page.statusCode } : {},
                ...page.usedRule ? { usedRule: page.usedRule } : {},
                ...page.shellPage ? { shellPage: true } : {},
                ...page.pageClass ? { pageClass: page.pageClass } : {},
                ...page.attempts?.length ? { attempts: page.attempts } : {},
                ...page.truncated ? { truncated: true } : {},
                ...page.nextOffset !== undefined ? { nextOffset: page.nextOffset } : {},
                ...page.totalChars !== undefined ? { totalChars: page.totalChars } : {},
            };
        },
    }));
    ctx.tools.register(defineTool({
        name: 'web_platform_search',
        description: 'Search one platform (built-in or configured custom); web_backend_status shows what works. Chinese communities need a one-time login (scripts/save-login.mjs or dsh-browser storageStatePath) and, like OpenCLI platforms, the optional dsh-browser plugin. Results go to history.',
        parameters: {
            platform: { type: 'string', required: true, description: PLATFORM_IDS.join(', ') + ', or a customPlatforms key.' },
            query: { type: 'string', description: 'Search query; for rss an optional keyword filter (a feed URL here still works).' },
            url: { type: 'string', description: 'rss only: the feed URL.' },
            count: { type: 'number', description: 'Max results (1-20).' },
            authProfile: { type: 'string', description: 'Domain-scoped dsh-browser auth profile.' },
            rulePack: { type: 'string', description: 'Domain-scoped dsh-browser rule pack.' },
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
            if (!isPlatformSupported(args.platform, dynamic().customPlatforms)) {
                throw new Error('unsupported platform: ' + args.platform);
            }
            const legacyRssUrl = args.platform === 'rss' && !args.url && /^https?:\/\//i.test(args.query?.trim() ?? '') ? args.query.trim() : undefined;
            const result = await router.platformSearch(args.platform, legacyRssUrl ? '' : (args.query ?? ''), args.url ?? legacyRssUrl, args.count ?? 8, { signal: exec.signal, ...args.authProfile ? { authProfile: args.authProfile } : {}, ...args.rulePack ? { rulePack: args.rulePack } : {} });
            return { platform: args.platform, sources: result.sources, engine: result.engine, fromCache: result.fromCache };
        },
    }));
    ctx.tools.register(defineTool({
        name: 'web_snapshot',
        description: 'Render a page in headless Playwright (optional saved login): text via per-site rules plus saved HTML and optional PNG; returns file paths. For JS-heavy pages or visual capture. Needs the optional dsh-browser plugin. Text capped like web_fetch_pro.',
        parameters: {
            url: { type: 'string', required: true, description: 'The HTTP(S) URL.' },
            screenshot: { type: 'boolean', description: 'Save a full-page PNG (default true).' },
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
        isConcurrencySafe: () => true,
        async execute(args, exec) {
            const browser = requireBrowser(getBrowser(), 'snapshot', 'web_snapshot');
            const rules = mergedRules(store);
            const shot = await browser.snapshot(args.url, rules, {
                signal: exec.signal,
                outDir: config.playwright.snapshotDir,
                screenshot: args.screenshot ?? true,
            });
            const out = {
                url: args.url,
                ...shot.title ? { title: shot.title } : {},
                // Same exit budget as web_fetch_pro; the full text is stored (web_fetch_pro offset reads on from it).
                text: capText(shot.text, outputCap()),
                htmlPath: shot.htmlPath,
            };
            if (args.screenshot !== false && shot.screenshotPath)
                out.screenshotPath = shot.screenshotPath;
            // Atomic query + page rows; a storage failure must not lose the captured snapshot.
            store.bestEffort('recordFetch', () => store.recordFetch({ kind: 'snapshot', url: args.url, query: shot.title ?? args.url, engine: 'playwright', status: 'ok', detail: JSON.stringify({ screenshotPath: out.screenshotPath, htmlPath: shot.htmlPath }) }, {
                url: args.url,
                ...shot.title ? { title: shot.title } : {},
                text: shot.text,
                htmlPath: shot.htmlPath,
                ...out.screenshotPath ? { screenshotPath: out.screenshotPath } : {},
                source: 'playwright',
            }));
            return out;
        },
    }));
    ctx.tools.register(defineTool({
        name: 'web_history',
        description: 'Search/fetch/snapshot history from SQLite; replay a saved result; action=expand reads an evidence excerpt in context.',
        parameters: {
            kind: { type: 'string', description: 'search, fetch, platform, snapshot or all.' },
            query: { type: 'string', description: 'Substring of the query or URL.' },
            engine: { type: 'string', description: 'Engine id (ddg, github, multi(...)).' },
            platform: { type: 'string', description: 'Platform (github, zhihu, arxiv).' },
            limit: { type: 'number', description: 'Max rows (1-200, default 20).' },
            replay: { type: 'string', description: 'Query id from the records: returns the saved sources or page (text capped like web_fetch_pro).' },
            export: { type: 'boolean', description: 'Write the filtered history to a JSON file and return its path.' },
            action: { type: 'string', description: 'expand: the stored text of an evidence excerpt plus neighbouring blocks (needs evidenceId); omit to list history.' },
            evidenceId: { type: 'string', description: 'Evidence id from an evidence pack (action=expand).' },
        },
        output: {
            schema: {
                type: 'object',
                additionalProperties: false,
                properties: {
                    records: { type: 'array', required: true, items: { type: 'object', additionalProperties: false, properties: { id: { type: 'string' }, kind: { type: 'string' }, query: { type: 'string' }, engine: { type: 'string' }, platform: { type: 'string' }, url: { type: 'string' }, status: { type: 'string' }, ts: { type: 'string' } } } },
                    replayedSources: { type: 'array', items: { type: 'object', additionalProperties: false, properties: { url: { type: 'string', required: true }, title: { type: 'string' }, snippet: { type: 'string' }, publishedAt: { type: 'string' } } } },
                    replayedPage: { type: 'object', additionalProperties: false, properties: { url: { type: 'string', required: true }, title: { type: 'string' }, text: { type: 'string' }, htmlPath: { type: 'string' }, screenshotPath: { type: 'string' }, status: { type: 'number' }, fetchedAt: { type: 'string', required: true }, source: { type: 'string' } } },
                    exportPath: { type: 'string' },
                    expanded: { type: 'object', additionalProperties: false, properties: { evidenceId: { type: 'string', required: true }, url: { type: 'string', required: true }, title: { type: 'string' }, heading: { type: 'string' }, note: { type: 'string' }, blocks: { type: 'array', required: true, items: { type: 'object', additionalProperties: false, properties: { blockId: { type: 'string', required: true }, position: { type: 'string', required: true }, text: { type: 'string', required: true }, truncated: { type: 'boolean' } } } } } },
                },
            },
            render: (_args, value) => {
                const expanded = value.expanded;
                if (expanded) {
                    const lines = ['Evidence ' + expanded.evidenceId + ' — ' + (expanded.title ? expanded.title + ' — ' : '') + expanded.url + (expanded.heading ? '\n§ ' + expanded.heading : '')];
                    for (const b of expanded.blocks)
                        lines.push((b.position === 'match' ? '>>> matched block' : '(' + b.position + ' block)') + (b.truncated ? ' [truncated]' : '') + '\n' + b.text);
                    if (expanded.note)
                        lines.push('Note: ' + expanded.note);
                    return [{ type: 'text', text: lines.join('\n\n') }];
                }
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
                if (v.replayedPage) {
                    const page = v.replayedPage;
                    parts.push([
                        page.title ? 'Title: ' + page.title : undefined,
                        page.text,
                        '— Replayed page: ' + page.url + (page.source ? ' · ' + page.source : ''),
                        page.htmlPath ? 'HTML: ' + page.htmlPath : undefined,
                        page.screenshotPath ? 'Screenshot: ' + page.screenshotPath : undefined,
                    ].filter(Boolean).join('\n\n'));
                }
                if (v.exportPath)
                    parts.push('Exported to: ' + v.exportPath);
                return [{ type: 'text', text: parts.join('\n\n') }];
            },
        },
        timeoutMs: 15_000,
        isConcurrencySafe: () => true,
        async execute(args) {
            if (args.action !== undefined && args.action !== 'expand')
                throw new Error('action must be expand or omitted');
            if (args.action === 'expand') {
                if (!args.evidenceId)
                    throw new Error('evidenceId is required for action=expand');
                return { records: [], expanded: expandEvidence(store, args.evidenceId) };
            }
            const requestedKind = args.kind;
            if (requestedKind && !['search', 'fetch', 'platform', 'snapshot', 'all'].includes(requestedKind))
                throw new Error('kind must be search, fetch, platform, snapshot, all, or omitted');
            const kind = requestedKind === 'all' ? undefined : requestedKind;
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
                const replay = replayHistory(store, args.replay);
                if (replay.sources) {
                    out.replayedSources = replay.sources;
                }
                else {
                    const page = replay.page;
                    out.replayedPage = { url: page.url, ...page.title ? { title: page.title } : {}, ...page.text ? { text: capText(page.text, outputCap()) } : {}, ...page.htmlPath ? { htmlPath: page.htmlPath } : {}, ...page.screenshotPath ? { screenshotPath: page.screenshotPath } : {}, ...typeof page.status === 'number' ? { status: page.status } : {}, fetchedAt: page.fetchedAt, ...page.source ? { source: page.source } : {} };
                }
            }
            if (args.export) {
                const { default: fs } = await import('node:fs');
                const { default: path } = await import('node:path');
                const outDir = path.dirname(config.dbPath);
                fs.mkdirSync(outDir, { recursive: true });
                const exportPath = path.join(outDir, 'history-export-' + Date.now() + '.json');
                const payload = mapped.map(r => {
                    const page = store.pageForQuery(r.id);
                    return {
                        ...r,
                        results: store.resultsForQuery(r.id).map(s => ({ url: s.url, ...s.title ? { title: s.title } : {}, ...s.snippet ? { snippet: s.snippet } : {} })),
                        ...page ? { page } : {},
                    };
                });
                fs.writeFileSync(exportPath, JSON.stringify(payload, null, 2), 'utf8');
                out.exportPath = exportPath;
            }
            return out;
        },
    }));
    ctx.tools.register(defineTool({
        name: 'web_cache_clear',
        description: 'Purge cached search results and page snapshots (by age and/or engine) or delete one query by id; returns removed counts.',
        parameters: {
            olderThanDays: { type: 'number', description: 'Only records older than N days; omit for everything.' },
            engine: { type: 'string', description: 'Only this engine.' },
            queryId: { type: 'string', description: 'Delete one query and its results (id from web_history).' },
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
            if (args.queryId) {
                const removed = store.deleteQuery(args.queryId);
                if (!removed)
                    throw new Error('query id not found: ' + args.queryId);
                return { removedQueries: removed.queries, removedResults: removed.results, removedPages: removed.pages };
            }
            const removed = store.clearCache({
                ...args.olderThanDays != null ? { olderThanDays: args.olderThanDays } : {},
                ...args.engine ? { engine: args.engine } : {},
            });
            return { removedQueries: removed.queries, removedResults: removed.results, removedPages: removed.pages };
        },
    }));
    ctx.tools.register(defineTool({
        name: 'web_rule',
        description: 'Per-site extraction rules (contentSelectors/removeSelectors by hostname) used by web_fetch_pro and web_snapshot; stored in SQLite, override built-ins. list, upsert, remove, export/import as a JSON pack.',
        parameters: {
            action: { type: 'string', required: true, description: 'list, upsert, remove, export or import.' },
            hostname: { type: 'string', description: 'Hostname, e.g. example.com (upsert/remove).' },
            contentSelectors: { type: 'string', description: 'CSS selectors of the main content, comma-separated (upsert).' },
            removeSelectors: { type: 'string', description: 'CSS selectors to remove first, comma-separated (upsert).' },
            rulesJson: { type: 'string', description: 'JSON array of rules or an exported pack (import).' },
        },
        output: {
            schema: {
                type: 'object',
                additionalProperties: false,
                properties: {
                    message: { type: 'string' },
                    rules: { type: 'array', items: { type: 'object', additionalProperties: false, properties: { hostname: { type: 'string' }, content: { type: 'string' }, remove: { type: 'string' } } } },
                    exportPath: { type: 'string' },
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
                if (v.exportPath)
                    parts.push('Exported to: ' + v.exportPath);
                return [{ type: 'text', text: parts.join('\n') || 'No rules.' }];
            },
        },
        timeoutMs: 10_000,
        // list/export are read-only; upsert/remove/import mutate the SQLite rules table.
        isConcurrencySafe: (args) => args.action === 'list' || args.action === 'export',
        async execute(args) {
            const action = args.action;
            if (!['list', 'upsert', 'remove', 'export', 'import'].includes(action))
                throw new Error('action must be list, upsert, remove, export, or import');
            const rules = store.listRules().map(r => ({ hostname: r.hostname, content: r.content, ...r.remove ? { remove: r.remove } : {} }));
            if (action === 'list') {
                return { rules };
            }
            if (action === 'export') {
                const { default: fs } = await import('node:fs');
                const { default: path } = await import('node:path');
                const exportPath = path.join(path.dirname(config.dbPath), 'rules-export-' + Date.now() + '.json');
                fs.mkdirSync(path.dirname(exportPath), { recursive: true });
                fs.writeFileSync(exportPath, JSON.stringify({ version: 1, exportedAt: new Date().toISOString(), rules }, null, 2), 'utf8');
                return { message: 'Exported ' + rules.length + ' rules', rules, exportPath };
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
                const importedRules = Array.isArray(parsed)
                    ? parsed
                    : (parsed && typeof parsed === 'object' && Array.isArray(parsed.rules) ? parsed.rules : undefined);
                if (!importedRules)
                    throw new Error('rulesJson must be a JSON array or exported rule pack');
                let count = 0;
                for (const item of importedRules) {
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
        description: 'Store state: database size, table and kind counts, top engines and queries, configured engines.',
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
                    kindCounts: { type: 'array', required: true, items: { type: 'object', additionalProperties: false, properties: { kind: { type: 'string', required: true }, count: { type: 'number', required: true } } } },
                    topEngines: { type: 'array', required: true, items: { type: 'object', additionalProperties: false, properties: { engine: { type: 'string', required: true }, count: { type: 'number', required: true } } } },
                    topQueries: { type: 'array', required: true, items: { type: 'object', additionalProperties: false, properties: { query: { type: 'string', required: true }, count: { type: 'number', required: true } } } },
                },
            },
            render: (_args, value) => {
                const v = value;
                const lines = [
                    'Database: ' + v.dbPath,
                    'Size: ' + (v.dbSizeBytes / 1024).toFixed(1) + ' KB',
                    'Queries: ' + v.queries + ' · Result rows: ' + v.results + ' · Page snapshots: ' + v.pages + ' · Custom rules: ' + v.rules,
                    'Engines: ' + v.engines.join(', '),
                    'Per kind: ' + (v.kindCounts.map(k => k.kind + '=' + k.count).join(', ') || '-'),
                    'Top engines: ' + (v.topEngines.map(e => e.engine + '(' + e.count + ')').join(', ') || '-'),
                    'Top queries: ' + (v.topQueries.map(q => JSON.stringify(q.query) + '(' + q.count + ')').join(', ') || '-'),
                ];
                return [{ type: 'text', text: lines.join('\n') }];
            },
        },
        timeoutMs: 10_000,
        isConcurrencySafe: () => true,
        async execute() {
            const stats = store.stats();
            return {
                dbPath: config.dbPath,
                ...stats,
                engines: dynamic().engines,
                kindCounts: store.kindCounts(),
                topEngines: store.topEngines(),
                topQueries: store.topQueries(),
            };
        },
    }));
    ctx.tools.register(defineTool({
        name: 'web_backend_status',
        description: 'Side-effect-free diagnostics: engine availability and cooldowns, CLI dependency health (twitter also needs its credentials), dsh-browser state, evidence settings. action=recommend (with task/profile/query) returns at most 3 suggested sources for a task. Makes no search requests, shows no credentials.',
        parameters: {
            action: { type: 'string', description: 'status (default) or recommend: up to 3 sources for the task; ready ones first, others with what is missing.' },
            task: { type: 'string', description: 'recommend: your goal in one sentence.' },
            profile: { type: 'string', description: 'recommend: docs_code, news_fact, academic, experience, compare or general (inferred if omitted).' },
            query: { type: 'string', description: 'recommend: the search query, if any.' },
            language: { type: 'string', description: 'recommend: zh or en (detected from task/query if omitted).' },
            platform: { type: 'string', description: 'recommend: a platform or source id you lean towards.' },
        },
        output: {
            schema: {
                type: 'object', additionalProperties: false,
                properties: {
                    engines: { type: 'array', required: true, items: { type: 'object', additionalProperties: false, properties: { id: { type: 'string', required: true }, available: { type: 'boolean', required: true }, state: { type: 'string', required: true }, reason: { type: 'string' }, lastError: { type: 'string' }, cooldownUntil: { type: 'string' } } } },
                    recommend: RECOMMEND_SCHEMA,
                    providers: { type: 'array', items: PROVIDER_REPORT_SCHEMA },
                    cli: { type: 'array', required: true, items: { type: 'object', additionalProperties: false, properties: { id: { type: 'string', required: true }, available: { type: 'boolean', required: true }, path: { type: 'string' }, note: { type: 'string' } } } },
                    browser: { type: 'object', additionalProperties: false, properties: { available: { type: 'boolean', required: true }, state: { type: 'string', required: true }, reason: { type: 'string' } } },
                    evidence: { type: 'object', additionalProperties: false, properties: {
                            scorer: { type: 'string', required: true }, jevMode: { type: 'string', required: true },
                            mode: { type: 'string' }, decides: { type: 'string' }, modeNote: { type: 'string' },
                            rubrics: { type: 'array', required: true, items: { type: 'object', additionalProperties: false, properties: { id: { type: 'string', required: true }, version: { type: 'string', required: true }, overridden: { type: 'boolean', required: true }, hash: { type: 'string', required: true } } } },
                            diagnostics: { type: 'array', items: { type: 'string' } },
                            provider: { type: 'object', additionalProperties: false, properties: { id: { type: 'string', required: true }, protocol: { type: 'string' }, model: { type: 'string' }, usable: { type: 'boolean', required: true }, reason: { type: 'string' }, unverified: { type: 'boolean' }, calibration: { type: 'string' }, keyConfigured: { type: 'boolean' } } },
                            providers: { type: 'array', items: { type: 'string' } },
                            usage: { type: 'object', additionalProperties: false, properties: {
                                    day: { type: 'string', required: true }, timezone: { type: 'string' }, requests: { type: 'number', required: true }, inputTokens: { type: 'number', required: true }, outputTokens: { type: 'number', required: true },
                                    estimated: { type: 'boolean', required: true }, amountKnown: { type: 'boolean', required: true }, amount: { type: 'number' }, currency: { type: 'string' },
                                    caps: { type: 'object', additionalProperties: false, properties: { perSearchInputTokens: { type: 'number', required: true }, dailyInputTokens: { type: 'number', required: true } } },
                                    byProvider: { type: 'array', items: { type: 'object', additionalProperties: false, properties: { provider: { type: 'string', required: true }, protocol: { type: 'string' }, requests: { type: 'number', required: true }, inputTokens: { type: 'number', required: true }, outputTokens: { type: 'number', required: true }, estimated: { type: 'boolean', required: true } } } },
                                } },
                        } },
                },
            },
            render: (_args, value) => {
                const rec = value.recommend;
                if (rec)
                    return [{ type: 'text', text: renderRecommendation(rec) }];
                const v = value;
                const lines = v.engines.map(e => (e.available ? '✅ ' : '❌ ') + e.id + ' [' + e.state + ']' + (e.lastError || e.reason ? ' — ' + (e.lastError ?? e.reason) : ''));
                for (const p of v.providers ?? []) {
                    const r = p.readiness;
                    const dims = [r.installation && 'installation=' + r.installation, r.credential && 'credential=' + r.credential, r.health && 'health=' + r.health].filter(Boolean).join(' ');
                    lines.push('  provider ' + p.route + (p.id !== p.route ? ' (' + p.id + ')' : '') + ': ' + dims + ' · ' + (p.languages.join('/') || '*') + ' · ' + p.taskProfiles.join('/') + (p.sourceFamily ? ' · family ' + p.sourceFamily : '') + (p.unverified ? ' · [not verified live]' : '') + (r.available ? '' : ' [' + (r.reason ?? 'unavailable') + ']'));
                }
                lines.push(...v.cli.map(e => (e.available ? '✅ ' : '❌ ') + 'cli:' + e.id + (e.path ? ' — ' + e.path : '') + (e.note ? ' — ' + e.note : '')));
                if (v.browser)
                    lines.push((v.browser.state === 'ready' ? '✅ ' : '❌ ') + 'browser:dsh-browser [' + v.browser.state + ']' + (v.browser.reason ? ' — ' + v.browser.reason : ''));
                if (v.evidence) {
                    // The effective judge mode, not the legacy `scorer` flag (which reads "rule" even while hybrid mode is on).
                    lines.push(v.evidence.mode !== undefined
                        ? 'evidence: judge mode=' + v.evidence.mode + ', decides=' + v.evidence.decides + (v.evidence.modeNote ? ' (' + v.evidence.modeNote + ')' : '')
                        : 'evidence: scorer=' + v.evidence.scorer + ' jevMode=' + v.evidence.jevMode);
                    lines.push(...v.evidence.rubrics.map(r => '  rubric ' + r.id + '@' + r.version + ' #' + r.hash + (r.overridden ? ' (override)' : ' (built-in)')));
                    const p = v.evidence.provider;
                    if (p)
                        lines.push('  judge provider: ' + p.id + (p.protocol ? ' (' + p.protocol + ', ' + p.model + ')' : '') + (p.usable ? '' : ' [unusable: ' + p.reason + ']') + (p.unverified ? ' [preset not verified live]' : '') + (p.calibration ? ' calibration ' + p.calibration : '') + (p.keyConfigured === false ? ' [key not found]' : ''));
                    const u = v.evidence.usage;
                    if (u)
                        lines.push('  model usage ' + u.day + (u.timezone ? ' ' + u.timezone : '') + ': ' + u.requests + ' request(s), ' + u.inputTokens + ' input / ' + u.outputTokens + ' output tokens' + (u.estimated ? ' (partly estimated)' : '') + (u.amount !== undefined ? ', ' + u.amount.toFixed(4) + ' ' + (u.currency ?? '') : u.requests ? ', cost unknown' : '') + '; caps: ' + u.caps.perSearchInputTokens + '/search, ' + u.caps.dailyInputTokens + '/day input tokens');
                    for (const b of u?.byProvider ?? [])
                        if (b.protocol === 'search')
                            lines.push('  search usage ' + b.provider + ': ' + b.requests + ' request(s) today (tokens n/a, price unknown)');
                    lines.push(...(v.evidence.diagnostics ?? []).map(d => '  ⚠ ' + d));
                }
                return [{ type: 'text', text: lines.join('\n') }];
            },
        },
        timeoutMs: 20_000,
        isConcurrencySafe: () => true,
        async execute(args) {
            const action = args?.action ?? 'status';
            if (action !== 'status' && action !== 'recommend')
                throw new Error('action must be status or recommend');
            const cli = await detectDeps();
            const availability = new Map(cli.map(value => [value.id, value.available]));
            if (action === 'recommend') {
                const catalog = loadCatalog();
                const profile = args.profile?.trim();
                if (profile && !PROFILES.includes(profile))
                    throw new Error('profile must be one of ' + PROFILES.join(', '));
                const language = args.language?.trim().toLowerCase();
                if (language && language !== 'zh' && language !== 'en')
                    throw new Error('language must be zh or en');
                const cfg = dynamic();
                const providerIds = [...new Set(catalog.entries.flatMap(e => (e.provider ? [e.provider] : [])))];
                const providers = typeof router.providerStatuses === 'function' ? await router.providerStatuses(providerIds) : new Map();
                const envNames = [...new Set(catalog.entries.flatMap(e => e.keyEnv ?? []))];
                const present = new Set();
                if (typeof router.resolveSecret === 'function')
                    await Promise.all(envNames.map(async (n) => { if (await router.resolveSecret(n))
                        present.add(n); }));
                else
                    for (const n of envNames)
                        if (process.env[n])
                            present.add(n);
                const recommend = recommendSources({
                    ...args.task?.trim() ? { task: args.task.trim() } : {}, ...args.query?.trim() ? { query: args.query.trim() } : {},
                    ...profile ? { profile: profile } : {}, ...language ? { language: language } : {}, ...args.platform?.trim() ? { platform: args.platform.trim() } : {},
                }, { catalog, providers, cli: availability, browser: browserState(getBrowser()).state === 'ready', hasEnv: n => present.has(n), hasConfig: n => typeof cfg[n] === 'string' ? cfg[n].trim().length > 0 : !!cfg[n] });
                return { engines: [], cli: [], recommend };
            }
            const ev = dynamic().evidence;
            const { rubrics, diagnostics } = resolveAllRubrics(ev.rubrics);
            const judge = await judgeStatus(ev, store, { hasSecret: typeof router.resolveSecret === 'function' ? async (ref) => !!(await router.resolveSecret(ref)) : undefined });
            return {
                engines: await router.backendDiagnostics(availability),
                ...typeof router.providerReport === 'function' ? { providers: await router.providerReport(availability) } : {},
                cli: cli.map(v => {
                    const gate = v.id === 'twitter' ? twitterGate(dynamic(), v) : undefined;
                    return { id: v.id, available: gate ? gate.available : v.available, ...v.path ? { path: v.path } : {}, ...gate?.note ? { note: gate.note } : v.optional ? { note: 'optional helper, not executed by this plugin' } : v.diagnostic ? { note: v.diagnostic } : {} };
                }),
                browser: browserState(getBrowser()),
                evidence: { scorer: ev.scorer, jevMode: ev.jevMode, mode: judge.mode, decides: judge.decides, ...judge.modeNote ? { modeNote: judge.modeNote } : {}, rubrics: rubrics.map(r => ({ id: r.id, version: r.version, overridden: r.overridden, hash: r.hash })), ...diagnostics.length || judge.diagnostics.length ? { diagnostics: [...diagnostics, ...judge.diagnostics] } : {}, provider: judge.provider, providers: judge.providers, ...judge.usage ? { usage: judge.usage } : {} },
            };
        },
    }));
    ctx.tools.register(defineTool({
        name: 'web_deps',
        description: 'Check or install the external CLIs this plugin runs (bili, yt-dlp, twitter, mcporter; agent-reach is an optional helper): check lists what is present with install commands; install runs one command, only when the user asks. Playwright/OpenCLI belong to dsh-browser.',
        parameters: {
            action: { type: 'string', description: 'check (default) or install.' },
            backend: { type: 'string', description: 'Dependency id (bili, yt-dlp, twitter, agent-reach, mcporter).' },
            installer: { type: 'string', description: 'winget, choco, uv, pipx, pip or npm.' },
        },
        output: {
            schema: {
                type: 'object',
                additionalProperties: false,
                properties: {
                    backends: { type: 'array', required: true, items: { type: 'object', additionalProperties: false, properties: { id: { type: 'string', required: true }, label: { type: 'string', required: true }, usedBy: { type: 'string', required: true }, available: { type: 'boolean', required: true }, optional: { type: 'boolean' }, path: { type: 'string' }, source: { type: 'string' }, requiredVersion: { type: 'string' }, version: { type: 'string' }, diagnostic: { type: 'string' }, installs: { type: 'array', required: true, items: { type: 'object', additionalProperties: false, properties: { installer: { type: 'string', required: true }, command: { type: 'string', required: true } } } } } } },
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
                        const details = [b.version ? '版本 ' + b.version : '', b.requiredVersion ? '要求 ' + b.requiredVersion : '', b.source ? '来源 ' + b.source : '', b.path ? b.path : ''].filter(Boolean);
                        parts.push((b.available ? '✅' : b.optional ? '➖' : '❌') + ' ' + b.label + ' (' + b.id + ') — ' + b.usedBy + (details.length ? ' · ' + details.join(' · ') : ''));
                        if (b.diagnostic)
                            parts.push('   诊断: ' + b.diagnostic);
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
            const action = args.action ?? 'check';
            if (action === 'install') {
                if (!args.backend)
                    throw new Error('backend is required for install');
                const installer = args.installer ?? defaultInstallerFor(args.backend);
                const result = await installDep(args.backend, installer);
                return { backends: [], install: { ...result } };
            }
            if (action !== 'check' && action !== 'install')
                throw new Error('action must be check or install');
            const backends = await detectDeps();
            const allOk = backends.every(b => b.available || b.optional);
            return {
                backends: backends.map(b => ({ ...b, installs: b.installs })),
                ...allOk ? { message: '所有外部依赖已就绪。' } : { message: '部分外部依赖缺失，可对缺失项运行 web_deps action=install（或手动执行列出的安装命令）。' },
            };
        },
    }));
}
/**
 * Whether the twitter platform backend can really run: the `twitter` command works (probed by detectDeps)
 * AND the backend is enabled in settings AND its credentials are in the environment (same gates as the engine).
 */
export function twitterGate(cfg, dep) {
    if (!dep.available)
        return { available: false, note: dep.diagnostic ?? 'twitter command not found (install twitter-cli; Agent-Reach alone does not provide it)' };
    if (!cfg.enableCliBackends)
        return { available: false, note: 'CLI backends are disabled in settings (enableCliBackends)' };
    if (!cfg.agentReachEnabled)
        return { available: false, note: 'disabled in settings (agentReachEnabled)' };
    if (!process.env.TWITTER_AUTH_TOKEN || !process.env.TWITTER_CT0)
        return { available: false, note: 'twitter command found, but TWITTER_AUTH_TOKEN / TWITTER_CT0 are not set' };
    return { available: true };
}
function defaultInstallerFor(backend) {
    switch (backend) {
        case 'bili': return 'uv';
        case 'yt-dlp': return 'uv';
        case 'agent-reach': return 'uv';
        case 'twitter': return 'uv';
        case 'mcporter': return 'npm';
        default: throw new Error('unknown backend: ' + backend);
    }
}
//# sourceMappingURL=tools.js.map