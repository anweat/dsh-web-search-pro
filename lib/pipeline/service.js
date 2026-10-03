/**
 * Wiring of the evidence pipeline to the plugin: registry-backed providers,
 * FetchService pages, the configured scorers, and persistence of the run.
 * `search.run` calls {@link EvidenceService.search} when `task` or
 * `profile` is given.
 * @module web-search-pro/pipeline/service
 */
import { SEARCH_CACHE_VERSION } from "../cache-key.js";
import { normQuery, shapeSources } from "../util.js";
import { buildTaskSpec } from "./task.js";
import { runPipeline } from "./run.js";
import { createModelScorer, selectProvider } from "./judges/providers.js";
import { resolveBudget, UsageLedger } from "./ledger.js";
import { resolveRubric } from "./rubrics.js";
import { HybridScorer, RuleScorer } from "./score.js";
import { compileQuery } from "./compile.js";
import { SourceUnavailableError } from "../providers/unavailable.js";
export const PAGE_MAX_CHARS = 60_000;
/** Route id of the ctx.web engine (see providers/builtin.ts). */
const SEAM_ROUTE_ID = 'seam';
export class EvidenceService {
    deps;
    constructor(deps) {
        this.deps = deps;
    }
    /**
     * Which scorer decides and which (if any) only observes. The mode is `evidence.judge.mode`, or its legacy alias
     * `evidence.jevMode`; the model behind it is `evidence.judge.provider` (default `bocha-jev`). Whatever cannot be set
     * up (unknown provider, missing key, uncalibrated reranker, ...) leaves the rule scorer in charge and says why.
     */
    async scorers(notes, budget) {
        const cfg = this.deps.dynamic().evidence;
        const rule = new RuleScorer();
        const mode = cfg.judge?.mode ?? cfg.jevMode;
        if (mode === 'off') {
            if (cfg.scorer === 'jev')
                notes.push('evidence.scorer=jev ignored: evidence.jevMode is off');
            return { control: rule };
        }
        const selection = selectProvider(cfg.judge);
        notes.push(...selection.diagnostics, ...resolveBudget(cfg.budget).diagnostics);
        const provider = selection.provider;
        if (!provider) {
            notes.push((selection.unusable ?? 'no judge provider') + ': rule scorer used');
            return { control: rule };
        }
        const label = provider.label ?? provider.id;
        const key = provider.keyRef ? await this.deps.router.resolveSecret(provider.keyRef) : undefined;
        if (provider.keyRef && !key) {
            notes.push(label + ' ' + mode + ' mode needs ' + provider.keyRef + ' (credentials ref or environment): rule scorer used');
            return { control: rule };
        }
        // The rubric words the questions of the rubric-driven protocols; a reranker takes the need text as its query.
        let rubric;
        if (provider.protocol !== 'rerank') {
            const resolved = resolveRubric(provider.rubricId ?? 'score.support', cfg.rubrics);
            notes.push(...resolved.diagnostics);
            rubric = resolved.rubric;
        }
        let model;
        try {
            model = createModelScorer(provider, { apiKey: key, rubric, ...this.deps.fetchImpl ? { fetchImpl: this.deps.fetchImpl } : {}, meter: budget.meterFor(provider), requestCap: provider.limits?.requestCap ?? 16 });
        }
        catch (error) {
            notes.push(label + ' could not be set up, rule scorer used: ' + (error instanceof Error ? error.message : String(error)));
            return { control: rule };
        }
        if (mode === 'shadow')
            return { control: rule, shadow: model };
        if (mode === 'hybrid')
            return { control: new HybridScorer({ jev: model, rule, borderline: cfg.hybridBorderline, maxQuestions: cfg.maxJevQuestions }) };
        // `control`: the legacy key pair needs `scorer: jev` as well; the neutral `judge.mode` is a single explicit switch.
        if (cfg.judge?.mode === 'control' || cfg.scorer === 'jev')
            return { control: model };
        notes.push('evidence.jevMode=control needs evidence.scorer=jev: rule scorer used');
        return { control: rule };
    }
    async search(request) {
        const { spec, notes: specNotes } = buildTaskSpec(request);
        const cfg = this.deps.dynamic();
        const scorerNotes = [];
        const ledger = new UsageLedger(this.deps.store, resolveBudget(cfg.evidence.budget).caps, this.deps.now);
        const scorers = await this.scorers(scorerNotes, ledger.forSearch());
        const { router, fetch: fetchSvc } = this.deps;
        // Registry-aware planning: aliases normalised to route ids, descriptors for language / profile promotion, adapter compilers.
        const registry = router.registry;
        const normalize = (ids) => (registry ? [...new Set(ids.map(id => registry.routeId(id) ?? id))] : [...ids]);
        const compiler = (task, id, now) => registry?.resolve(id)?.compile?.(task, now) ?? compileQuery(task, id, now);
        // Inside the ctx.web provider the ctx.web engine must not run (it would call this plugin again): it is taken out of the
        // configured list before planning, and a call that still reaches it is answered `skipped` without touching ctx.web.
        const skipSeam = request.skipSeam === true;
        const isSeam = (id) => (registry ? registry.routeId(id) ?? id : id) === SEAM_ROUTE_ID;
        const usable = (ids) => normalize(ids).filter(id => !(skipSeam && isSeam(id)));
        const deps = {
            providerStatus: ids => router.providerStatuses(ids),
            searchProvider: async (call) => skipSeam && isSeam(call.id) ? { state: 'skipped', reason: 'ctx.web engine is not used inside the ctx.web provider' } : router.runProvider(call, { skipSeam }),
            fetchPage: async (url, signal) => {
                const page = await fetchSvc.fetchPage(url, { mode: 'auto', signal, maxChars: PAGE_MAX_CHARS, fresh: false, persist: true });
                return { url: page.url, ...page.title ? { title: page.title } : {}, text: page.text, ...page.shellPage ? { shellPage: true } : {}, source: page.source };
            },
            scorers,
            configuredEngines: usable(cfg.engines),
            ...registry ? { descriptors: registry.list({ operation: 'search' }).map(a => a.descriptor), compiler } : {},
            autoProviders: cfg.evidence.autoProviders !== false,
            fusion: { k: cfg.rrfConstant, freshnessBoost: cfg.freshnessBoost, freshnessDays: cfg.freshnessDays, authorityBoost: cfg.authorityBoost, authorityDomains: cfg.authorityDomains },
        };
        // Explicit platform sources: the named platform, or `engines` that are all platforms. None of them runnable = report it.
        const platformNotes = [];
        let explicit = request.platform ? usable([request.platform.id]) : request.engines?.length ? usable(request.engines) : undefined;
        if (explicit?.length && registry && explicit.every(id => registry.resolve(id)?.descriptor.kind === 'platform')) {
            const statuses = await router.providerStatuses(explicit);
            const reasons = explicit.filter(id => statuses.get(id)?.state !== 'ready').map(id => {
                const status = statuses.get(id);
                return status ? (status.state === 'cooldown' ? 'cooling down' : 'unavailable') + (status.reason ? ': ' + status.reason : '') : 'not registered';
            });
            if (reasons.length === explicit.length) {
                const message = 'platform ' + explicit.join(', ') + ' unavailable: ' + reasons.join('; ');
                if (!request.allowFallback)
                    throw new SourceUnavailableError(message, explicit[0], reasons);
                platformNotes.push(message + ' (allowFallback: the profile\'s web engines were searched instead)');
                explicit = undefined;
            }
        }
        const platformId = request.platform ? usable([request.platform.id])[0] : undefined;
        const callOptions = request.platform && platformId !== undefined
            ? { ...request.platform.url ? { url: request.platform.url } : {}, ...request.platform.authProfile || request.platform.rulePack ? { browser: { ...request.platform.authProfile ? { authProfile: request.platform.authProfile } : {}, ...request.platform.rulePack ? { rulePack: request.platform.rulePack } : {} } } : {} }
            : undefined;
        const options = {
            signal: request.signal,
            deadlineMs: request.deadlineMs ?? cfg.timeoutMs + 30_000,
            ...explicit?.length ? { engines: explicit } : {},
            ...callOptions && Object.keys(callOptions).length && platformId !== undefined && explicit?.length ? { providerOptions: { [platformId]: callOptions } } : {},
            sourcesCount: request.count,
            maxScoreQuestions: cfg.evidence.maxJevQuestions,
            maxRounds: cfg.evidence.maxRounds,
            maxQueries: cfg.evidence.maxQueries,
        };
        const result = await runPipeline(spec, deps, options);
        result.pack.notes.unshift(...specNotes, ...scorerNotes, ...platformNotes);
        this.persist(result, request);
        const { sources, ...rest } = result.pack;
        return { ...rest, sources: shapeSources(sources, request.count), fromCache: false };
    }
    /** Best-effort: the pack already exists, a storage failure must not lose it. */
    persist(result, request) {
        const { store } = this.deps;
        const { pack, task } = result;
        store.bestEffort('recordEvidenceRun', () => store.recordEvidenceRun({
            query: {
                kind: 'search', query: normQuery(request.query), engine: 'pipeline', status: 'ok',
                // A current-version key that no lookup ever asks for: keeps the startup purge of legacy rows away from these.
                cacheKey: 'search:v' + SEARCH_CACHE_VERSION + ':pipeline:' + pack.resultId,
                detail: JSON.stringify({ resultId: pack.resultId, profile: pack.profile, engine: pack.engine, enginesTried: pack.enginesTried, partial: pack.partial, evidence: pack.evidence.length }),
            },
            sources: shapeSources(pack.sources, pack.sources.length),
            engine: pack.engine,
            run: {
                id: pack.resultId,
                taskJson: JSON.stringify(task),
                packJson: JSON.stringify({ ...pack, ...result.shadow ? { shadow: result.shadow } : {} }),
            },
            blocks: result.evidenceBlocks,
        }));
    }
}
//# sourceMappingURL=service.js.map