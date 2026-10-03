/**
 * Search orchestration: engine ordering/fallback (agent-reach style routing),
 * optional parallel multi-engine merging, SQLite caching, and persistence.
 * @module web-search-pro/router
 */
import { credentialRef } from '@deepseek-ai/dsh-credentials';
import { EngineError, } from "./engines.js";
import { customKeyProblem, customPlatformAdapter } from "./providers/platforms.js";
import { SourceUnavailableError } from "./providers/unavailable.js";
import { defaultProviderRegistry, routeIdOf } from "./providers/index.js";
import { BOCHA_FALLBACK_KEY_ENV, BOCHA_KEY_ENV } from "./providers/bocha.js";
import { OPENALEX_KEY_ENV } from "./providers/openalex.js";
import { SEMANTICSCHOLAR_KEY_ENV } from "./providers/semanticscholar.js";
import { ANYSEARCH_KEY_ENV } from "./providers/anysearch.js";
import { KEYED_SOURCE_ENVS } from "./providers/keyed.js";
import { resolveBudget, UsageLedger } from "./pipeline/ledger.js";
import { normQuery, shapeSources } from "./util.js";
import { LruCache } from "./memory-cache.js";
import { toBrowserGetter } from "./browser-access.js";
import { createPlatformCacheKey, createSearchCacheKey } from "./cache-key.js";
import { allAttemptsBenign, allAttemptsEmpty, BackendRegistry, NoBackendError } from "./backend-registry.js";
import { ExaClient } from "./exa-client.js";
import { SingleFlight } from "./singleflight.js";
import { mergeCandidates } from "./pipeline/candidates.js";
import { fuseCandidates } from "./pipeline/fusion.js";
export class SearchRouter {
    ctx;
    config;
    store;
    dynamic;
    memory;
    registry;
    /** In-flight de-duplication of identical non-fresh requests (C3). */
    searchFlights = new SingleFlight();
    getBrowser;
    backends;
    /** Backend ids this router created from the registry (a stub a test installed under another id is never touched). */
    owned = new Set();
    syncedRevision = -1;
    /** Custom platforms (settings `customPlatforms`) this router registered: key -> spec signature + unregister. A key the registry refused stays here with its problem so it is not retried on every call. */
    custom = new Map();
    /** Latest local probe per route id (read by providerStatuses for the credential dimension). */
    readiness = new Map();
    /** Last real call per route id: feeds the health dimension (never inferred from a local probe). */
    outcomes = new Map();
    constructor(ctx, config, store, dynamic = () => config, browser, memory = new LruCache(config.memoryCacheEntries), registry = defaultProviderRegistry) {
        this.ctx = ctx;
        this.config = config;
        this.store = store;
        this.dynamic = dynamic;
        this.memory = memory;
        this.registry = registry;
        this.getBrowser = toBrowserGetter(browser);
        this.backends = new BackendRegistry({ cooldownMs: 30_000 });
        this.syncBackends();
    }
    /** Mirror the registry into the backend registry: new providers appear, unregistered ones stop being scheduled. */
    syncBackends() {
        this.syncCustomPlatforms();
        if (this.syncedRevision === this.registry.revision)
            return;
        this.syncedRevision = this.registry.revision;
        const wanted = new Map(this.registry.list({ operation: 'search' }).map(a => [routeIdOf(a.descriptor), a.descriptor]));
        for (const id of [...this.owned])
            if (!wanted.has(id)) {
                this.backends.unregister(id);
                this.owned.delete(id);
            }
        for (const id of wanted.keys())
            if (!this.backends.has(id)) {
                this.backends.register(this.backendFor(id));
                this.owned.add(id);
            }
    }
    /**
     * Keep the registry's custom platform providers equal to the settings: new keys register, edited ones are replaced,
     * removed ones unregister (the revision bump then makes {@link syncBackends} drop their backends). A key that clashes
     * with a provider already registered is not registered (a user platform never replaces a built-in source); see {@link customPlatformProblems}.
     */
    syncCustomPlatforms() {
        const specs = this.dynamic().customPlatforms ?? {};
        const next = new Map(Object.entries(specs).map(([key, spec]) => [key, JSON.stringify(spec)]));
        for (const [key, entry] of [...this.custom])
            if (next.get(key) !== entry.sig) {
                entry.off();
                this.custom.delete(key);
            }
        for (const [key, sig] of next) {
            if (this.custom.has(key))
                continue;
            const problem = customKeyProblem(key);
            if (problem) {
                this.custom.set(key, { sig, off: () => { }, problem });
                continue;
            }
            try {
                this.custom.set(key, { sig, off: this.registry.register(customPlatformAdapter(key, specs[key])) });
            }
            catch (error) {
                this.custom.set(key, { sig, off: () => { }, problem: 'custom platform "' + key + '" was not registered: ' + (error instanceof Error ? error.message : String(error)) });
            }
        }
    }
    /** Custom platforms the registry could not take (key clash, bad key), for `sources.status`. */
    customPlatformProblems() {
        this.syncCustomPlatforms();
        return [...this.custom.values()].flatMap(entry => (entry.problem ? [entry.problem] : []));
    }
    /** Unregister what this router put into the registry (plugin unload). */
    dispose() {
        for (const entry of this.custom.values())
            entry.off();
        this.custom.clear();
    }
    backendFor(id) {
        return {
            id,
            probe: async () => {
                try {
                    const adapter = this.registry.resolve(id);
                    if (!adapter)
                        return { available: false, reason: 'unregistered' };
                    const readiness = await adapter.probeLocal(await this.probeEnv());
                    this.readiness.set(id, readiness);
                    return { available: readiness.available, ...readiness.reason ? { reason: readiness.reason } : {} };
                }
                catch (error) {
                    return { available: false, reason: error instanceof Error ? error.message : String(error) };
                }
            },
            run: async (input) => {
                const engine = await this.build(id, input.skipSeam);
                if (!engine.available())
                    throw new EngineError(engine.label + ' unavailable', 'ENGINE_UNAVAILABLE', false);
                try {
                    const outcome = await engine.search(input.query, input.count, input.signal, this.withBindings(id, input.options));
                    this.outcomes.set(id, { ok: true, at: new Date().toISOString() });
                    return { ...outcome, via: outcome.via ?? engine.id };
                }
                catch (error) {
                    const code = error?.code;
                    // An empty answer is the service working; a cancelled call says nothing about it.
                    if (code === 'ENGINE_EMPTY')
                        this.outcomes.set(id, { ok: true, at: new Date().toISOString() });
                    else if (!input.signal?.aborted)
                        this.outcomes.set(id, { ok: false, at: new Date().toISOString(), message: error instanceof Error ? error.message : String(error), ...typeof code === 'string' ? { code } : {} });
                    throw error;
                }
            },
            // Quality gate: a result whose snippet coverage is below 50% is usable
            // but thin — the router should keep probing later engines instead of
            // settling for titles-only output (the ddg-regex regression case).
            // Engines that produce descriptive snippets by construction (GitHub
            // metadata, bili video cards, YouTube meta lines) are exempt: their
            // snippet field carries structured info, not prose coverage.
            assess: outcome => {
                const sources = outcome.sources;
                if (!sources.length)
                    return { ok: true };
                const META_SNIPPET_ENGINES = new Set(['github', 'github-code', 'github-issues', 'bilibili', 'youtube']);
                if (META_SNIPPET_ENGINES.has(id))
                    return { ok: true };
                const withSnippet = sources.filter(s => s.snippet && s.snippet.trim()).length;
                const ratio = withSnippet / sources.length;
                if (ratio >= 0.5)
                    return { ok: true };
                return { ok: true, lowQuality: true, detail: 'snippets=' + withSnippet + '/' + sources.length };
            },
        };
    }
    /** `browserBindings[id]` fills the auth profile / rule pack a call did not name itself (the call wins). */
    withBindings(id, options) {
        const binding = this.dynamic().browserBindings?.[id];
        if (!binding?.authProfile && !binding?.rulePack)
            return options;
        const browser = { ...binding.authProfile ? { authProfile: binding.authProfile } : {}, ...binding.rulePack ? { rulePack: binding.rulePack } : {}, ...options?.browser };
        return { ...options, browser };
    }
    /** Bindings that apply to these providers, for cache keys: a rebound auth profile must not replay older results. */
    bindingsOf(ids) {
        const all = this.dynamic().browserBindings ?? {};
        const out = {};
        for (const id of ids) {
            const b = all[id];
            if (b?.authProfile || b?.rulePack)
                out[id] = { ...b.authProfile ? { authProfile: b.authProfile } : {}, ...b.rulePack ? { rulePack: b.rulePack } : {} };
        }
        return Object.keys(out).length ? out : undefined;
    }
    async probeEnv(cli) {
        return { deps: await this.deps(false), config: this.dynamic(), ...cli ? { cli } : {} };
    }
    /** Alias / full id -> route id; ids the registry does not know are kept as written (the backend then reports them unknown). */
    canonicalIds(ids) {
        return [...new Set(ids.map(id => this.registry.routeId(id) ?? id))];
    }
    async backendDiagnostics(cliAvailability) {
        this.syncBackends();
        const diagnostics = await this.backends.diagnosticsAsync();
        if (!cliAvailability || !this.dynamic().enableCliBackends)
            return diagnostics;
        const cfg = this.dynamic();
        const exaKey = await this.resolveKey(cfg.exaApiKeyEnv, cfg.exaApiKey);
        const requiredCli = new Map([
            ...exaKey ? [] : [['exa', 'mcporter']],
            ['bilibili', 'bili'],
            ['youtube', 'yt-dlp'],
        ]);
        return diagnostics.map(diagnostic => {
            const dependency = requiredCli.get(diagnostic.id);
            if (!dependency || cliAvailability.get(dependency) !== false)
                return diagnostic;
            return {
                ...diagnostic,
                available: false,
                state: 'unavailable',
                reason: dependency + ' executable not found',
            };
        });
    }
    async exaContents(urls, signal) {
        const cfg = this.dynamic();
        const key = await this.resolveKey(cfg.exaApiKeyEnv, cfg.exaApiKey);
        if (!key)
            throw new Error('Exa is unavailable: configure exaApiKey or ' + cfg.exaApiKeyEnv);
        return new ExaClient({ apiKey: key }).contents(urls, signal);
    }
    /** Resolve a secret by credentials ref / environment variable name (credentials service first, then env). */
    resolveSecret(ref) {
        return this.resolveKey(ref);
    }
    /**
     * Availability of engines for source planning: the registry's probe and
     * cooldown state, without running a search. Ids the registry does not know are absent.
     */
    async providerStatuses(ids) {
        this.syncBackends();
        const route = new Map(ids.map(id => [id, this.registry.routeId(id) ?? id]));
        const wanted = new Set(route.values());
        const byId = new Map();
        for (const d of await this.backends.diagnosticsAsync()) {
            if (!wanted.has(d.id))
                continue;
            const reason = d.state === 'cooldown' ? d.lastError : d.reason;
            const credential = this.readiness.get(d.id)?.credential;
            byId.set(d.id, { state: d.state, ...reason ? { reason } : {}, ...credential ? { credential } : {} });
        }
        const out = new Map();
        for (const [id, r] of route) {
            const status = byId.get(r);
            if (status)
                out.set(id, status);
        }
        return out;
    }
    /**
     * Run ONE engine through the registry (probe, cooldown, quality gate,
     * attempts) for the evidence pipeline. Not cached or persisted: the pipeline
     * persists its fused result once. Cancellation is rethrown; every other
     * outcome is a value. `skipSeam` keeps the ctx.web engine out (the caller IS the ctx.web provider: no recursion).
     */
    async runProvider(call, opts = {}) {
        this.syncBackends();
        try {
            const selected = await this.backends.runSelected({ query: call.query, count: call.count, signal: call.signal, skipSeam: opts.skipSeam ?? false, ...call.options ? { options: call.options } : {} }, { preferred: this.canonicalIds([call.id]), signal: call.signal });
            const sources = selected.value.sources;
            return sources.length ? { state: 'ok', sources } : { state: 'empty' };
        }
        catch (error) {
            if (call.signal.aborted)
                throw error;
            if (error instanceof NoBackendError) {
                if (allAttemptsEmpty(error.attempts))
                    return { state: 'empty' };
                const skipped = error.attempts.find(a => a.outcome === 'skipped');
                if (skipped && allAttemptsBenign(error.attempts))
                    return { state: 'skipped', reason: skipped.detail ?? 'unavailable' };
            }
            return { state: 'error', message: error instanceof Error ? error.message : String(error) };
        }
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
        const browser = this.getBrowser();
        const exaApiKey = await this.resolveKey(cfg.exaApiKeyEnv, cfg.exaApiKey);
        const jinaApiKey = await this.resolveKey(cfg.jinaApiKeyEnv, cfg.jinaApiKey);
        const githubToken = await this.resolveKey(cfg.githubTokenEnv, cfg.githubToken);
        // One Bocha account key serves search and Jev: the search name first, then the documented Jev name.
        const bochaApiKey = await this.resolveKey(cfg.bochaApiKeyEnv ?? BOCHA_KEY_ENV, cfg.bochaApiKey) ?? await this.resolveKey(BOCHA_FALLBACK_KEY_ENV);
        // Optional free keys of the anonymous APIs: they raise limits, nothing needs them.
        const openalexApiKey = await this.resolveKey(OPENALEX_KEY_ENV);
        const semanticScholarApiKey = await this.resolveKey(SEMANTICSCHOLAR_KEY_ENV);
        const anysearchApiKey = await this.resolveKey(ANYSEARCH_KEY_ENV);
        const keyed = await this.keyedSources(cfg, (ref, literal) => this.resolveKey(ref, literal));
        return {
            ...keyed,
            ...openalexApiKey ? { openalexApiKey } : {},
            ...semanticScholarApiKey ? { semanticScholarApiKey } : {},
            ...anysearchApiKey ? { anysearchApiKey } : {},
            ...cfg.searxngUrl ? { searxngUrl: cfg.searxngUrl } : {},
            ...cfg.openalexMailto ? { openalexMailto: cfg.openalexMailto } : {},
            ...web !== undefined ? { web } : {},
            ...exaApiKey ? { exaApiKey } : {},
            ...jinaApiKey ? { jinaApiKey } : {},
            ...githubToken ? { githubToken } : {},
            ...bochaApiKey ? { bochaApiKey } : {},
            ...cfg.bochaBaseUrl ? { bochaBaseUrl: cfg.bochaBaseUrl } : {},
            ...cfg.bochaSummary !== undefined ? { bochaSummary: cfg.bochaSummary } : {},
            usage: this.usageRecorder(),
            enableCli: cfg.enableCliBackends,
            opencliEnabled: cfg.opencliEnabled,
            agentReachEnabled: cfg.agentReachEnabled,
            allowProxyFakeIp: cfg.allowProxyFakeIp,
            ...browser !== undefined ? { browser } : {},
            ...cfg.platformRules !== undefined ? { platformRules: cfg.platformRules } : {},
            ...cfg.customPlatforms !== undefined ? { customPlatforms: cfg.customPlatforms } : {},
            skipSeam,
        };
    }
    /** Sync key check for available() (no credential resolution — env/literal only). */
    depsSync(skipSeam) {
        const cfg = this.dynamic();
        const web = this.ctx.get('web');
        const browser = this.getBrowser();
        const exaApiKey = cfg.exaApiKey || process.env[cfg.exaApiKeyEnv];
        const jinaApiKey = cfg.jinaApiKey || process.env[cfg.jinaApiKeyEnv];
        const githubToken = cfg.githubToken || process.env[cfg.githubTokenEnv] || process.env.GH_TOKEN;
        const bochaApiKey = cfg.bochaApiKey || process.env[cfg.bochaApiKeyEnv ?? BOCHA_KEY_ENV] || process.env[BOCHA_FALLBACK_KEY_ENV];
        const openalexApiKey = process.env[OPENALEX_KEY_ENV];
        const semanticScholarApiKey = process.env[SEMANTICSCHOLAR_KEY_ENV];
        const anysearchApiKey = process.env[ANYSEARCH_KEY_ENV];
        const keyed = this.keyedSourcesSync(cfg);
        return {
            ...keyed,
            ...openalexApiKey ? { openalexApiKey } : {},
            ...semanticScholarApiKey ? { semanticScholarApiKey } : {},
            ...anysearchApiKey ? { anysearchApiKey } : {},
            ...cfg.searxngUrl ? { searxngUrl: cfg.searxngUrl } : {},
            ...cfg.openalexMailto ? { openalexMailto: cfg.openalexMailto } : {},
            ...web !== undefined ? { web } : {},
            ...exaApiKey ? { exaApiKey } : {},
            ...jinaApiKey ? { jinaApiKey } : {},
            ...githubToken ? { githubToken } : {},
            ...bochaApiKey ? { bochaApiKey } : {},
            ...cfg.bochaBaseUrl ? { bochaBaseUrl: cfg.bochaBaseUrl } : {},
            ...cfg.bochaSummary !== undefined ? { bochaSummary: cfg.bochaSummary } : {},
            usage: this.usageRecorder(),
            enableCli: cfg.enableCliBackends,
            opencliEnabled: cfg.opencliEnabled,
            agentReachEnabled: cfg.agentReachEnabled,
            allowProxyFakeIp: cfg.allowProxyFakeIp,
            ...browser !== undefined ? { browser } : {},
            ...cfg.platformRules !== undefined ? { platformRules: cfg.platformRules } : {},
            ...cfg.customPlatforms !== undefined ? { customPlatforms: cfg.customPlatforms } : {},
            skipSeam,
        };
    }
    /**
     * Keys and base URLs of the keyed search sources (dev-plan M7c): per source the config literal, then the credentials ref /
     * environment variable (`keyedSources.<id>.apiKeyEnv`, else the documented default names in order).
     */
    async keyedSources(cfg, resolve) {
        const sourceKeys = {};
        const sourceBaseUrls = {};
        for (const [id, defaults] of Object.entries(KEYED_SOURCE_ENVS)) {
            const own = cfg.keyedSources?.[id];
            const names = [...new Set([own?.apiKeyEnv, ...defaults].filter((n) => !!n))];
            let key = own?.apiKey || undefined;
            for (const name of names) {
                if (key)
                    break;
                key = await resolve(name);
            }
            if (key)
                sourceKeys[id] = key;
            if (own?.baseUrl)
                sourceBaseUrls[id] = own.baseUrl;
        }
        return { ...Object.keys(sourceKeys).length ? { sourceKeys } : {}, ...Object.keys(sourceBaseUrls).length ? { sourceBaseUrls } : {} };
    }
    keyedSourcesSync(cfg) {
        const sourceKeys = {};
        const sourceBaseUrls = {};
        for (const [id, defaults] of Object.entries(KEYED_SOURCE_ENVS)) {
            const own = cfg.keyedSources?.[id];
            const names = [...new Set([own?.apiKeyEnv, ...defaults].filter((n) => !!n))];
            const key = own?.apiKey || names.map(n => process.env[n]).find(Boolean);
            if (key)
                sourceKeys[id] = key;
            if (own?.baseUrl)
                sourceBaseUrls[id] = own.baseUrl;
        }
        return { ...Object.keys(sourceKeys).length ? { sourceKeys } : {}, ...Object.keys(sourceBaseUrls).length ? { sourceBaseUrls } : {} };
    }
    /** Counts a metered, non-model request (Bocha search) in the usage ledger; best effort, never throws into the search. */
    usageRecorder() {
        return {
            record: entry => {
                try {
                    new UsageLedger(this.store, resolveBudget(this.dynamic().evidence?.budget).caps).recordRequests(entry);
                }
                catch { /* the ledger is advisory for these providers */ }
            },
        };
    }
    /** Whether any configured engine is currently usable. */
    anyEngineAvailable() {
        this.syncBackends();
        const ids = this.canonicalIds(this.dynamic().engines);
        return ids.some(id => { try {
            return this.buildSync(id, false).available();
        }
        catch {
            return false;
        } });
    }
    async build(id, skipSeam) {
        const adapter = this.registry.resolve(id);
        if (!adapter)
            throw new EngineError(this.registry.unknownMessage([id]), 'ENGINE_UNAVAILABLE', false);
        return adapter.create(await this.deps(skipSeam), this.dynamic());
    }
    buildSync(id, skipSeam) {
        const adapter = this.registry.resolve(id);
        if (!adapter)
            throw new EngineError(this.registry.unknownMessage([id]), 'ENGINE_UNAVAILABLE', false);
        return adapter.create(this.depsSync(skipSeam), this.dynamic());
    }
    /**
     * Every registered search provider with its descriptor and LOCAL readiness by dimension (installation / credential /
     * health), for `sources.status`. No network. Health is only `ready` after a real call succeeded in this process,
     * `cooldown` / `error` after failures; a provider that merely passed its local probe is `unknown`, not verified.
     */
    async providerReport(cliAvailability) {
        this.syncBackends();
        const diagnostics = new Map((await this.backendDiagnostics(cliAvailability)).map(d => [d.id, d]));
        const env = await this.probeEnv(cliAvailability);
        const now = new Date().toISOString();
        const out = [];
        for (const adapter of this.registry.list({ operation: 'search' })) {
            const d = adapter.descriptor;
            const route = routeIdOf(d);
            let local;
            try {
                local = await adapter.probeLocal(env);
            }
            catch (error) {
                local = { available: false, reason: error instanceof Error ? error.message : String(error), diagnosticCode: 'probe_failed' };
            }
            const diag = diagnostics.get(route);
            // The CLI scan can overrule the engine's own check (same rule as backendDiagnostics).
            const available = diag ? diag.available : local.available;
            const last = this.outcomes.get(route);
            const cooling = diag?.state === 'cooldown';
            const health = cooling ? 'cooldown' : last ? (last.ok ? 'ready' : 'error') : 'unknown';
            const credential = last?.code === 'ENGINE_AUTH' ? 'rejected' : local.credential;
            const reason = !available ? (diag?.reason ?? local.reason) : undefined;
            out.push({
                id: d.id, route, aliases: [...d.aliases], label: d.label, kind: d.kind ?? 'web', ...d.domains?.length ? { domains: [...d.domains] } : {}, ...d.needsBrowser ? { needsBrowser: d.needsBrowser } : {}, operations: [...d.operations], taskProfiles: [...d.taskProfiles],
                languages: [...d.languages], regions: [...d.regions], resultKinds: [...d.resultKinds],
                ...d.sourceFamily ? { sourceFamily: d.sourceFamily } : {},
                requirements: d.requirements.map(({ env, ...r }) => ({ ...r, ...env ? { env: [...env] } : {} })), supportedFilters: [...d.supportedFilters], costModel: { ...d.costModel },
                ...d.verification?.live ? {} : { unverified: true },
                readiness: {
                    available,
                    ...local.installation ? { installation: local.installation } : {},
                    ...credential ? { credential } : {},
                    health,
                    ...reason ? { reason } : {},
                    ...local.diagnosticCode ? { diagnosticCode: local.diagnosticCode } : {},
                    lastLocalCheck: now,
                    ...last?.ok ? { lastRemoteSuccess: last.at } : {},
                    ...last && !last.ok && last.message ? { lastError: last.message } : {},
                    ...diag?.cooldownUntil ? { cooldownUntil: diag.cooldownUntil } : {},
                },
            });
        }
        return out;
    }
    /** Run a full search with caching + persistence. */
    async search(opts) {
        const cfg = this.dynamic();
        this.syncBackends();
        const platform = opts.platform ? this.resolvePlatform(opts.platform, opts.query) : undefined;
        const query = platform ? platform.query : opts.query.trim();
        if (!platform && !query)
            throw new Error('query must be a non-empty string');
        const ids = platform ? [platform.id] : this.canonicalIds(opts.engines && opts.engines.length ? opts.engines : cfg.engines);
        const nq = normQuery(platform ? query || platform.url || platform.id : query);
        const count = Math.min(Math.max(opts.count, 1), 20);
        const multi = !platform && opts.multi && ids.length > 1;
        const bindings = platform ? undefined : this.bindingsOf(ids);
        const cacheKey = platform
            ? createPlatformCacheKey({ platform: platform.id, query: query || platform.url || platform.id, ...platform.url ? { url: platform.url } : {}, count, ...platform.authProfile ? { authProfile: platform.authProfile } : {}, ...platform.rulePack ? { rulePack: platform.rulePack } : {} })
            : createSearchCacheKey({ query, engines: ids, count, multi, ...opts.exa ? { exa: opts.exa } : {}, ...bindings ? { browser: bindings } : {} });
        const memoryKey = cacheKey + ':count=' + count;
        const run = (signal) => this.runSearch({ opts, query, nq, ids, count, multi, cacheKey, memoryKey, ...platform ? { platform } : {} }, signal);
        if (opts.fresh)
            return run(opts.signal);
        // skipSeam changes which engines can run, so it must be part of the flight identity.
        return this.searchFlights.do(memoryKey + (opts.skipSeam ? ':skipSeam' : ''), run, opts.signal);
    }
    /**
     * Normalise a platform request: the provider's route id; `rss` takes a feed URL from `query` when no `url` is given
     * (the old tool contract); the call's auth profile / rule pack, else the platform's `browserBindings`.
     */
    resolvePlatform(request, rawQuery) {
        const id = this.registry.routeId(request.id) ?? request.id;
        const text = rawQuery.trim();
        const legacyFeed = id === 'rss' && !request.url && /^https?:\/\//i.test(text) ? text : undefined;
        const url = request.url ?? legacyFeed;
        const binding = this.dynamic().browserBindings?.[id];
        const authProfile = request.authProfile ?? binding?.authProfile;
        const rulePack = request.rulePack ?? binding?.rulePack;
        return { id, query: legacyFeed ? '' : text, ...url ? { url } : {}, ...authProfile ? { authProfile } : {}, ...rulePack ? { rulePack } : {} };
    }
    async runSearch(p, signal) {
        const { opts, query, nq, ids, count, multi, cacheKey, memoryKey, platform } = p;
        const kind = platform ? 'platform' : 'search';
        const cfg = this.dynamic();
        // 1. In-process LRU cache, then SQLite.
        if (!opts.fresh) {
            const hot = this.memory.get(memoryKey, cfg.ttlSeconds * 1000);
            if (hot)
                return { ...hot, fromCache: true };
            const cached = this.store.bestEffort(kind + ' cache read', () => {
                const hit = this.store.getCachedQuery(kind, cacheKey, cfg.ttlSeconds);
                return hit ? { hit, rows: this.store.resultsForQuery(hit.id) } : undefined;
            });
            if (cached?.rows.length) {
                let detail;
                if (cached.hit.detail) {
                    try {
                        detail = JSON.parse(cached.hit.detail);
                    }
                    catch { /* ignore */ }
                }
                if (detail?.requestedCount === undefined || detail.requestedCount >= count) {
                    const result = {
                        ...detail?.content ? { content: detail.content } : {},
                        sources: shapeSources(cached.rows.map(r => ({ url: r.url, title: r.title, snippet: r.snippet, publishedAt: r.published })), count),
                        engine: detail?.engine ?? ids[0] ?? 'unknown',
                        enginesTried: detail?.enginesTried ?? ids,
                        fromCache: true,
                        availableCount: cached.rows.length,
                        ...detail?.fallbackNote ? { fallbackNote: detail.fallbackNote } : {},
                    };
                    this.memory.set(memoryKey, result);
                    return result;
                }
            }
        }
        // 2. Run engines.
        const enginesTried = [];
        let outcome;
        let usedId;
        let viaId;
        let fallbackNote;
        let availableCount;
        let persistExtras;
        if (multi) {
            // Every engine goes through the registry (probe, cooldown, quality gate,
            // attempts) in parallel; failures of one never cancel the others.
            const input = { query, count, signal, skipSeam: opts.skipSeam ?? false, ...opts.exa ? { options: { exa: opts.exa } } : {} };
            const results = await Promise.allSettled(ids.map(id => this.backends.runSelected(input, { preferred: [id], ...signal ? { signal } : {} })));
            if (signal?.aborted)
                throw signal.reason ?? new DOMException('This operation was aborted', 'AbortError');
            enginesTried.push(...ids);
            // Merge by canonical URL (every provider/rank/query contribution kept),
            // then fuse: one normalised RRF term per provider, freshness/authority
            // bonuses once per URL (pipeline/fusion.ts).
            const outputs = [];
            results.forEach((r, index) => {
                if (r.status === 'fulfilled' && r.value.value.sources.length)
                    outputs.push({ providerId: ids[index], query, sources: r.value.value.sources });
            });
            if (!outputs.length) {
                // No engine failed at runtime: each answered with nothing or was skipped
                // (unavailable / cooling down). That is an empty result with a note, not an error.
                const benign = results.every(r => r.status === 'fulfilled' || (r.reason instanceof NoBackendError && allAttemptsBenign(r.reason.attempts)));
                if (benign)
                    return this.emptyResult(ids, 'multi(' + ids.join('+') + ')', results.flatMap(r => r.status === 'rejected' && r.reason instanceof NoBackendError ? r.reason.attempts : []));
                const failures = results.map((r, index) => ids[index] + ': ' + (r.status === 'rejected' ? (r.reason instanceof Error ? r.reason.message : String(r.reason)) : 'empty')).join('; ');
                throw new Error('all engines failed: ' + failures);
            }
            const merged = mergeCandidates(outputs);
            const ranked = fuseCandidates(merged, {
                k: cfg.rrfConstant,
                freshnessBoost: cfg.freshnessBoost,
                freshnessDays: cfg.freshnessDays,
                authorityBoost: cfg.authorityBoost,
                authorityDomains: cfg.authorityDomains,
                nProviders: outputs.length,
            }).slice(0, count);
            availableCount = merged.length;
            outcome = { sources: ranked.map(({ candidate }) => ({ url: candidate.url, ...candidate.title ? { title: candidate.title } : {}, ...candidate.snippet ? { snippet: candidate.snippet } : {}, ...candidate.publishedAt ? { publishedAt: candidate.publishedAt } : {} })) };
            // Per-source provenance survives in results.extra (no schema change); the cache-hit path ignores it.
            persistExtras = ranked.map(({ candidate, score }) => JSON.stringify({ contributions: candidate.contributions, score: Number(score.toFixed(6)) }));
            usedId = 'multi(' + ids.join('+') + ')';
        }
        else {
            try {
                const options = {
                    ...opts.exa && !platform ? { exa: opts.exa } : {},
                    ...platform?.url ? { url: platform.url } : {},
                    ...platform && (platform.authProfile || platform.rulePack) ? { browser: { ...platform.authProfile ? { authProfile: platform.authProfile } : {}, ...platform.rulePack ? { rulePack: platform.rulePack } : {} } } : {},
                };
                const selected = await this.backends.runSelected(
                // A platform without a query lists its latest items (a feed has no query at all).
                { query: platform ? query || (platform.url ? '' : 'latest') : query, count, signal, skipSeam: opts.skipSeam ?? false, ...Object.keys(options).length ? { options } : {} }, { preferred: ids, ...signal ? { signal } : {} });
                outcome = selected.value;
                usedId = platform ? platform.id : selected.id;
                viaId = selected.value.via ?? selected.id;
                enginesTried.push(...ids.slice(0, Math.max(ids.indexOf(selected.id) + 1, 1)));
                // P1-1: explain the fallback (e.g. ddg returned results but none had snippets). A single platform has nothing to fall back to.
                const lowQualityAttempts = platform ? [] : selected.attempts.filter(a => a.outcome === 'low-quality');
                if (lowQualityAttempts.length) {
                    const triedLine = selected.attempts
                        .map(a => a.id + '(' + a.outcome + (a.detail ? ':' + a.detail : '') + ')')
                        .join(' -> ');
                    fallbackNote = 'fallback; ' + lowQualityAttempts.map(a => a.id + ' returned results but ' + (a.detail ?? 'low quality')).join('; ') + '\ntried: ' + triedLine;
                }
            }
            catch (error) {
                if (signal?.aborted)
                    throw error;
                enginesTried.push(...ids);
                if (error instanceof NoBackendError) {
                    // A platform that is down is an error with its reason; one that answered with nothing is an empty result that says so.
                    if (platform)
                        return this.platformFailure(platform.id, error);
                    // Every engine answered empty or was skipped (no runtime failure): report that, do not fail or cache it.
                    if (allAttemptsBenign(error.attempts))
                        return this.emptyResult(ids, 'none', error.attempts);
                }
                throw error;
            }
        }
        availableCount ??= outcome.sources.length;
        // 3. Persist (atomic query + rows). A storage failure must not lose results
        // the network already paid for: it is logged and the search still returns.
        const finalOutcome = outcome;
        const finalId = usedId;
        this.store.bestEffort('recordSearch', () => this.store.recordSearch({
            kind,
            query: nq,
            ...platform ? { platform: platform.id } : {},
            // History keeps naming the concrete backend that answered for a platform (`opencli-twitter`).
            engine: platform ? viaId ?? finalId : finalId,
            status: 'ok',
            cacheKey,
            detail: JSON.stringify({ ...finalOutcome.content ? { content: finalOutcome.content } : {}, engine: finalId, enginesTried, requestedCount: count, ...fallbackNote ? { fallbackNote } : {} }),
        }, persistExtras ? finalOutcome.sources.map((source, i) => ({ ...source, extra: persistExtras[i] })) : finalOutcome.sources, platform ? 'platform-' + platform.id : finalId));
        const result = {
            ...outcome.content ? { content: outcome.content } : {},
            sources: shapeSources(outcome.sources, count),
            engine: usedId,
            enginesTried,
            fromCache: false,
            availableCount,
            ...fallbackNote ? { fallbackNote } : {},
        };
        // 4. Warm the in-process LRU (memory-only; survives across SQLite hits).
        this.memory.set(memoryKey, result);
        return result;
    }
    /**
     * No engine failed at runtime: each returned ENGINE_EMPTY or was skipped
     * (unavailable / cooldown). Zero sources plus an explanation (never cached).
     */
    emptyResult(ids, engine, attempts = []) {
        const skipped = attempts.filter(a => a.outcome === 'skipped');
        return {
            sources: [],
            engine,
            enginesTried: [...ids],
            fromCache: false,
            availableCount: 0,
            fallbackNote: 'all engines returned no results' + (skipped.length ? ' or were unavailable' : '') + ' (tried: ' + ids.join(', ') + ')'
                + (skipped.length ? '; skipped: ' + skipped.map(a => a.id + ' (' + (a.detail ?? 'unavailable') + ')').join(', ') : ''),
        };
    }
    /**
     * A platform provider that did not answer. Empty (it ran and found nothing) is a result with the provider's own hint
     * (login, selectors); anything else is the error `platform <id> unavailable (tried: ...): <reason>`.
     */
    platformFailure(id, error) {
        if (allAttemptsEmpty(error.attempts)) {
            return { sources: [], engine: id, enginesTried: [id], fromCache: false, availableCount: 0, fallbackNote: 'no results: ' + (error.attempts[0]?.detail ?? id) };
        }
        const last = [...error.attempts].reverse().find(a => a.detail);
        const message = 'platform ' + id + ' unavailable (tried: ' + error.attempts.map(a => a.id).join(', ') + ')' + (last?.detail ? ': ' + last.detail : '');
        // Never ran (failed its local probe, cooling down): a structured "not available", with what is missing.
        if (error.attempts.length && error.attempts.every(a => a.outcome === 'skipped'))
            throw new SourceUnavailableError(message, id, error.attempts.map(a => a.detail ?? 'unavailable'));
        throw new Error(message);
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
            // Cut only when the router really had more sources than it returned.
            truncated: (result.availableCount ?? result.sources.length) > result.sources.length,
        };
    }
}
//# sourceMappingURL=router.js.map