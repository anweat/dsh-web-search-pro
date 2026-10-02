/**
 * The built-in search providers as registry entries (dev-plan M6): descriptors plus the factories that
 * already existed in engines.ts, so behaviour is unchanged. Adding a source = one descriptor + adapter
 * (see bocha.ts) registered here or, later, by an external plugin; nothing in the router or planner names it.
 * @module web-search-pro/providers/builtin
 */
import { seamEngine, exaEngine, ddgEngine, bingEngine, jinaSearchEngine, githubEngine, bilibiliEngine, v2exEngine, youtubeEngine, arxivEngine, pubmedEngine, } from "../engines.js";
import { bochaAdapter } from "./bocha.js";
import { wikipediaAdapter } from "./wikipedia.js";
import { hackerNewsAdapter } from "./hackernews.js";
import { stackExchangeAdapter } from "./stackexchange.js";
import { openAlexAdapter } from "./openalex.js";
import { semanticScholarAdapter } from "./semanticscholar.js";
import { anySearchAdapter } from "./anysearch.js";
import { searxngAdapter } from "./searxng.js";
import { ProviderRegistry } from "./registry.js";
const WEB_PROFILES = ['general', 'news_fact', 'experience', 'compare', 'docs_code'];
const FREE = { kind: 'free' };
function descriptor(d) {
    return {
        aliases: [d.id.replace(/^builtin:/, '')],
        adapterVersion: '1',
        contractVersion: 1,
        operations: ['search'],
        taskProfiles: [],
        languages: ['*'],
        regions: ['global'],
        resultKinds: ['web'],
        requirements: [],
        supportedFilters: [],
        costModel: FREE,
        verification: { live: true, note: 'shipped before the registry; exercised by the plugin since 0.1' },
        ...d,
    };
}
/** Default local probe: the engine's own cheap `available()` (no network), with the descriptor's dimensions filled in from `dims`. */
function adapter(d, create, dims = () => ({})) {
    return {
        descriptor: d,
        create,
        probeLocal(env) {
            const engine = create(env.deps, env.config);
            const available = engine.available();
            return { available, ...dims(env, available), ...available ? {} : { reason: engine.label + ' unavailable' } };
        },
    };
}
const noRequirements = () => ({ installation: 'not_required', credential: 'not_required' });
/** A CLI the engine runs: `missing` only when the caller scanned and did not find it. */
function cliDims(cli, available, env) {
    const present = env.cli?.get(cli);
    return { credential: 'not_required', ...present !== undefined ? { installation: present ? 'detected' : 'missing' } : {}, ...!available && present === false ? { reason: cli + ' executable not found', diagnosticCode: 'cli_missing' } : {} };
}
const key = (id, env, optional, note) => ({ kind: 'key', id, env, ...optional ? { optional } : {}, ...note ? { note } : {} });
export function builtinAdapters() {
    return [
        adapter(descriptor({
            id: 'builtin:seam', label: 'DeepSeek 原生搜索 (ctx.web)', taskProfiles: ['general'],
            requirements: [{ kind: 'service', id: 'ctx.web', note: 'the host web capability' }],
            costModel: { kind: 'unknown', note: 'decided by the host provider behind ctx.web' },
        }), seamEngine, (env, ok) => ({ installation: 'not_required', credential: 'not_required', ...!ok ? { diagnosticCode: 'service_missing' } : {} })),
        adapter(descriptor({
            id: 'builtin:exa', label: 'Exa', taskProfiles: ['general', 'news_fact', 'experience', 'compare', 'docs_code'],
            languages: ['en'], sourceFamily: 'exa', priority: 10,
            requirements: [key('exa-key', ['EXA_API_KEY']), { kind: 'cli', id: 'mcporter', optional: true, note: 'MCP fallback without a key (no advanced filters)' }],
            supportedFilters: ['site', 'exclude_site', 'time_window', 'category'],
            costModel: { kind: 'metered', unit: 'request', note: 'Exa API plan' },
        }), exaEngine, (env) => {
            const hasKey = (env.deps.exaApiKey?.length ?? 0) > 0;
            const mcporter = env.cli?.get('mcporter');
            return hasKey
                ? { installation: 'not_required', credential: 'configured' }
                : { credential: 'missing', ...mcporter !== undefined ? { installation: mcporter ? 'detected' : 'missing' } : {}, ...mcporter === false && env.deps.enableCli ? { reason: 'mcporter executable not found', diagnosticCode: 'cli_missing' } : {} };
        }),
        adapter(descriptor({ id: 'builtin:ddg', label: 'DuckDuckGo', taskProfiles: [...WEB_PROFILES, 'academic'], supportedFilters: ['site', 'exclude_site', 'exclude_term'] }), (deps) => ddgEngine(deps.allowProxyFakeIp), noRequirements),
        adapter(descriptor({ id: 'builtin:bing', label: 'Bing', taskProfiles: WEB_PROFILES.slice(), sourceFamily: 'bing', supportedFilters: ['site', 'exclude_site', 'exclude_term'] }), (deps) => bingEngine(deps.allowProxyFakeIp), noRequirements),
        adapter(descriptor({
            id: 'builtin:jina', label: 'Jina AI', taskProfiles: ['general'],
            requirements: [key('jina-key', ['JINA_API_KEY'])], costModel: { kind: 'unknown', note: 'Jina API plan' },
        }), jinaSearchEngine, (env) => ({ installation: 'not_required', credential: (env.deps.jinaApiKey?.length ?? 0) > 0 ? 'configured' : 'missing' })),
        adapter(descriptor({
            id: 'builtin:github', label: 'GitHub', taskProfiles: ['docs_code', 'compare'], resultKinds: ['code'], sourceFamily: 'github',
            requirements: [key('github-token', ['GITHUB_TOKEN', 'GH_TOKEN'], true, 'optional: raises the rate limit')],
        }), githubEngine, (env) => ({ installation: 'not_required', credential: (env.deps.githubToken?.length ?? 0) > 0 ? 'configured' : 'not_required' })),
        adapter(descriptor({
            id: 'builtin:bilibili', label: 'Bilibili', taskProfiles: ['experience'], languages: ['zh'], regions: ['cn'], resultKinds: ['video'],
            requirements: [{ kind: 'cli', id: 'bili' }],
        }), bilibiliEngine, (env, ok) => cliDims('bili', ok, env)),
        adapter(descriptor({ id: 'builtin:v2ex', label: 'V2EX', taskProfiles: ['experience'], languages: ['zh'], regions: ['cn'], resultKinds: ['forum'] }), (deps) => v2exEngine(deps.allowProxyFakeIp), noRequirements),
        adapter(descriptor({
            id: 'builtin:youtube', label: 'YouTube', taskProfiles: ['experience'], resultKinds: ['video'],
            requirements: [{ kind: 'cli', id: 'yt-dlp' }],
        }), deps => youtubeEngine(deps), (env, ok) => cliDims('yt-dlp', ok, env)),
        adapter(descriptor({ id: 'builtin:arxiv', label: 'arXiv', taskProfiles: ['academic'], languages: ['en'], resultKinds: ['paper'], sourceFamily: 'arxiv' }), (deps) => arxivEngine(deps.allowProxyFakeIp), noRequirements),
        adapter(descriptor({ id: 'builtin:pubmed', label: 'PubMed', taskProfiles: ['academic'], languages: ['en'], resultKinds: ['paper'], sourceFamily: 'pubmed' }), (deps) => pubmedEngine(deps.allowProxyFakeIp), noRequirements),
        bochaAdapter,
        // Anonymous API sources (dev-plan M7b): vertical / supplementary, never promoted ahead of web search.
        wikipediaAdapter,
        hackerNewsAdapter,
        stackExchangeAdapter,
        openAlexAdapter,
        semanticScholarAdapter,
        anySearchAdapter,
        searxngAdapter,
    ];
}
/** A fresh registry holding the built-in providers (tests and the process-wide default start from this). */
export function createBuiltinRegistry() {
    const registry = new ProviderRegistry();
    for (const a of builtinAdapters())
        registry.register(a);
    return registry;
}
//# sourceMappingURL=builtin.js.map