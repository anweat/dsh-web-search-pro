/**
 * Wiring of the evidence pipeline to the plugin: registry-backed providers,
 * FetchService pages, the configured scorers, and persistence of the run.
 * `web_search_pro` calls {@link EvidenceService.search} when `task` or
 * `profile` is given.
 * @module web-search-pro/pipeline/service
 */
import { SEARCH_CACHE_VERSION } from "../cache-key.js";
import { normQuery, shapeSources } from "../util.js";
import { buildTaskSpec } from "./task.js";
import { runPipeline } from "./run.js";
import { HybridScorer, JEV_KEY_REF, JevScorer, RuleScorer } from "./score.js";
export const PAGE_MAX_CHARS = 60_000;
export class EvidenceService {
    deps;
    constructor(deps) {
        this.deps = deps;
    }
    /** Which scorer decides and which (if any) only observes, from `evidence.scorer` / `evidence.jevMode`. */
    async scorers(notes) {
        const cfg = this.deps.dynamic().evidence;
        const rule = new RuleScorer();
        if (cfg.jevMode === 'off') {
            if (cfg.scorer === 'jev')
                notes.push('evidence.scorer=jev ignored: evidence.jevMode is off');
            return { control: rule };
        }
        const key = await this.deps.router.resolveSecret(JEV_KEY_REF);
        if (!key) {
            notes.push('Jev ' + cfg.jevMode + ' mode needs ' + JEV_KEY_REF + ' (credentials ref or environment): rule scorer used');
            return { control: rule };
        }
        const jev = new JevScorer({ apiKey: key, ...this.deps.fetchImpl ? { fetchImpl: this.deps.fetchImpl } : {}, requestCap: 16 });
        if (cfg.jevMode === 'shadow')
            return { control: rule, shadow: jev };
        if (cfg.jevMode === 'hybrid')
            return { control: new HybridScorer({ jev, rule, borderline: cfg.hybridBorderline, maxQuestions: cfg.maxJevQuestions }) };
        if (cfg.scorer === 'jev')
            return { control: jev };
        notes.push('evidence.jevMode=control needs evidence.scorer=jev: rule scorer used');
        return { control: rule };
    }
    async search(request) {
        const { spec, notes: specNotes } = buildTaskSpec(request);
        const cfg = this.deps.dynamic();
        const scorerNotes = [];
        const scorers = await this.scorers(scorerNotes);
        const { router, fetch: fetchSvc } = this.deps;
        const deps = {
            providerStatus: ids => router.providerStatuses(ids),
            searchProvider: call => router.runProvider(call),
            fetchPage: async (url, signal) => {
                const page = await fetchSvc.fetchPage(url, { mode: 'auto', signal, maxChars: PAGE_MAX_CHARS, fresh: false, persist: true });
                return { url: page.url, ...page.title ? { title: page.title } : {}, text: page.text, ...page.shellPage ? { shellPage: true } : {}, source: page.source };
            },
            scorers,
            configuredEngines: cfg.engines,
            fusion: { k: cfg.rrfConstant, freshnessBoost: cfg.freshnessBoost, freshnessDays: cfg.freshnessDays, authorityBoost: cfg.authorityBoost, authorityDomains: cfg.authorityDomains },
        };
        const options = {
            signal: request.signal,
            deadlineMs: cfg.timeoutMs + 30_000,
            ...request.engines?.length ? { engines: request.engines } : {},
            sourcesCount: request.count,
            maxScoreQuestions: cfg.evidence.maxJevQuestions,
        };
        const result = await runPipeline(spec, deps, options);
        result.pack.notes.unshift(...specNotes, ...scorerNotes);
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