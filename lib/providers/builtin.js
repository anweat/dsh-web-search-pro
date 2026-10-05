/**
 * The built-in search providers as registry entries (dev-plan M6): descriptors plus the factories that
 * already existed in engines.ts, so behaviour is unchanged. Adding a source = one descriptor + adapter
 * (see bocha.ts) registered here or, later, by an external plugin; nothing in the router or planner names it.
 * @module web-search-pro/providers/builtin
 */
import { seamEngine, exaEngine, ddgEngine, bingEngine, jinaSearchEngine, githubEngine, bilibiliEngine, v2exEngine, youtubeEngine, arxivEngine, pubmedEngine, } from "../engines.js";
import { bochaAdapter } from "./bocha.js";
import { platformAdapters } from "./platforms.js";
import { wikipediaAdapter } from "./wikipedia.js";
import { hackerNewsAdapter } from "./hackernews.js";
import { stackExchangeAdapter } from "./stackexchange.js";
import { openAlexAdapter } from "./openalex.js";
import { semanticScholarAdapter } from "./semanticscholar.js";
import { anySearchAdapter } from "./anysearch.js";
import { searxngAdapter } from "./searxng.js";
import { tavilyAdapter } from "./tavily.js";
import { braveAdapter } from "./brave.js";
import { linkupAdapter } from "./linkup.js";
import { serperAdapter } from "./serper.js";
import { metasoAdapter } from "./metaso.js";
import { zhipuAdapter } from "./zhipu.js";
import { baiduAdapter } from "./baidu-qianfan.js";
import { descriptor } from "./descriptor.js";
import { ProviderRegistry } from "./registry.js";
const WEB_PROFILES = ['general', 'news_fact', 'experience', 'compare', 'docs_code'];
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
            costModel: { kind: 'unknown', note: 'decided by the host provider behind ctx.web' }, costTier: 'anonymous',
        }), seamEngine, (env, ok) => ({ installation: 'not_required', credential: 'not_required', ...!ok ? { diagnosticCode: 'service_missing' } : {} })),
        adapter(descriptor({
            id: 'builtin:exa', label: 'Exa', taskProfiles: ['general', 'news_fact', 'experience', 'compare', 'docs_code'],
            languages: ['en'], sourceFamily: 'exa', priority: 10,
            requirements: [key('exa-key', ['EXA_API_KEY']), { kind: 'cli', id: 'mcporter', optional: true, note: 'MCP fallback without a key (no advanced filters)' }],
            supportedFilters: ['site', 'exclude_site', 'time_window', 'category'],
            costModel: { kind: 'metered', unit: 'request', note: 'keyless MCP route (mcporter): anonymous, rate limited; API key route: $10 of free credits every month (https://exa.ai/pricing, read 2026-10-04)' },
            costTier: 'anonymous',
        }), exaEngine, (env) => {
            const hasKey = (env.deps.exaApiKey?.length ?? 0) > 0;
            const mcporter = env.cli?.get('mcporter');
            // The route that would run decides the tier: the API key (free monthly credits) or the keyless MCP route through mcporter (anonymous).
            return hasKey
                ? { installation: 'not_required', credential: 'configured', costTier: 'free-quota' }
                : { credential: 'missing', costTier: 'anonymous', ...env.deps.enableCli && mcporter !== false ? { keyless: true } : {}, ...mcporter !== undefined ? { installation: mcporter ? 'detected' : 'missing' } : {}, ...mcporter === false && env.deps.enableCli ? { reason: 'mcporter executable not found', diagnosticCode: 'cli_missing' } : {} };
        }),
        adapter(descriptor({ id: 'builtin:ddg', label: 'DuckDuckGo', taskProfiles: [...WEB_PROFILES, 'academic'], supportedFilters: ['site', 'exclude_site', 'exclude_term'] }), (deps) => ddgEngine(deps.allowProxyFakeIp), noRequirements),
        adapter(descriptor({ id: 'builtin:bing', label: 'Bing', taskProfiles: WEB_PROFILES.slice(), sourceFamily: 'bing', supportedFilters: ['site', 'exclude_site', 'exclude_term'] }), (deps) => bingEngine(deps.allowProxyFakeIp), noRequirements),
        adapter(descriptor({
            id: 'builtin:jina', label: 'Jina AI', taskProfiles: ['general'],
            requirements: [key('jina-key', ['JINA_API_KEY'])], costModel: { kind: 'unknown', note: 'search needs a key; every new key comes with 10M free tokens, one time, a search costs at least 10,000 (https://jina.ai/reader/, read 2026-10-04)' }, costTier: 'free-quota',
        }), jinaSearchEngine, (env) => ({ installation: 'not_required', credential: (env.deps.jinaApiKey?.length ?? 0) > 0 ? 'configured' : 'missing' })),
        adapter(descriptor({
            id: 'builtin:github', label: 'GitHub', kind: 'platform', domains: ['github.com'], taskProfiles: ['docs_code', 'compare'], resultKinds: ['code'], sourceFamily: 'github',
            requirements: [key('github-token', ['GITHUB_TOKEN', 'GH_TOKEN'], true, 'optional: raises the rate limit')],
        }), githubEngine, (env) => ({ installation: 'not_required', credential: (env.deps.githubToken?.length ?? 0) > 0 ? 'configured' : 'not_required' })),
        adapter(descriptor({
            id: 'builtin:bilibili', label: 'Bilibili', kind: 'platform', domains: ['bilibili.com'], taskProfiles: ['experience'], languages: ['zh'], regions: ['cn'], resultKinds: ['video'],
            requirements: [{ kind: 'cli', id: 'bili' }],
        }), bilibiliEngine, (env, ok) => cliDims('bili', ok, env)),
        adapter(descriptor({ id: 'builtin:v2ex', label: 'V2EX', kind: 'platform', domains: ['v2ex.com'], taskProfiles: ['experience'], languages: ['zh'], regions: ['cn'], resultKinds: ['forum'] }), (deps) => v2exEngine(deps.allowProxyFakeIp), noRequirements),
        adapter(descriptor({
            id: 'builtin:youtube', label: 'YouTube', kind: 'platform', domains: ['youtube.com', 'youtu.be'], taskProfiles: ['experience'], resultKinds: ['video'],
            requirements: [{ kind: 'cli', id: 'yt-dlp' }],
        }), deps => youtubeEngine(deps), (env, ok) => cliDims('yt-dlp', ok, env)),
        adapter(descriptor({ id: 'builtin:arxiv', label: 'arXiv', kind: 'platform', domains: ['arxiv.org'], taskProfiles: ['academic'], languages: ['en'], resultKinds: ['paper'], sourceFamily: 'arxiv' }), (deps) => arxivEngine(deps.allowProxyFakeIp), noRequirements),
        adapter(descriptor({ id: 'builtin:pubmed', label: 'PubMed', kind: 'platform', domains: ['pubmed.ncbi.nlm.nih.gov'], taskProfiles: ['academic'], languages: ['en'], resultKinds: ['paper'], sourceFamily: 'pubmed' }), (deps) => pubmedEngine(deps.allowProxyFakeIp), noRequirements),
        // Platforms (dev-plan M8b): site / community sources, searched explicitly (`platform=` or `engines`), never planned on their own.
        ...platformAdapters,
        bochaAdapter,
        // Anonymous API sources (dev-plan M7b): vertical / supplementary, never promoted ahead of web search.
        wikipediaAdapter,
        hackerNewsAdapter,
        stackExchangeAdapter,
        openAlexAdapter,
        semanticScholarAdapter,
        anySearchAdapter,
        searxngAdapter,
        // Keyed sources (dev-plan M7c): reserved interfaces, executable only once a key is configured; never called live.
        tavilyAdapter,
        braveAdapter,
        linkupAdapter,
        serperAdapter,
        metasoAdapter,
        zhipuAdapter,
        baiduAdapter,
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