/**
 * Wiring of the evidence pipeline to the plugin: registry-backed providers,
 * FetchService pages, the configured scorers, and persistence of the run.
 * `search.run` calls {@link EvidenceService.search} when `task` or
 * `profile` is given.
 * @module web-search-pro/pipeline/service
 */

import { SEARCH_CACHE_VERSION } from '../cache-key.ts'
import type { FetchService } from '../fetch.ts'
import type { ResolvedConfig } from '../config.ts'
import type { SearchRouter } from '../router.ts'
import type { Store } from '../store.ts'
import { normQuery, shapeSources } from '../util.ts'
import { buildTaskSpec, type TaskInput } from './task.ts'
import { runPipeline, type PipelineDeps, type PipelineOptions, type PipelineResult } from './run.ts'
import { createModelScorer, selectProvider } from './judges/providers.ts'
import { resolveBudget, UsageLedger, type SearchBudget } from './ledger.ts'
import { resolveRubric } from './rubrics.ts'
import { HybridScorer, RuleScorer, type Scorer } from './score.ts'
import type { EvidencePack } from './types.ts'
import { compileQuery } from './compile.ts'
import type { ProviderRegistry } from '../providers/registry.ts'
import { SourceUnavailableError } from '../providers/unavailable.ts'

export interface EvidenceRequest extends TaskInput {
  /** Explicit engine ids (tool `engines`). */
  engines?: string[] | undefined
  /**
   * One platform provider as the explicit source set of S1 / S2 (`search.run platform=` with `task`): it wins over the
   * profile's table, and `url` / `authProfile` / `rulePack` go to its calls (`browserBindings` fill the rest). S3-S8 run as usual.
   */
  platform?: { id: string; url?: string | undefined; authProfile?: string | undefined; rulePack?: string | undefined } | undefined
  /**
   * An explicit platform source that cannot run (missing browser / login / CLI / token, cooling down) is an error naming
   * what is missing. With `allowFallback` the profile's web engines are searched instead and the pack says so.
   */
  allowFallback?: boolean | undefined
  /** `sources` entries to return. */
  count: number
  signal?: AbortSignal | undefined
  /** Overall deadline in ms (default: `timeoutMs` + 30 s). The ctx.web provider route passes a shorter one. */
  deadlineMs?: number | undefined
  /** The caller is the ctx.web provider: keep the ctx.web engine out of the run (it would call back into this plugin). */
  skipSeam?: boolean | undefined
}

export interface EvidenceServiceDeps {
  router: Pick<SearchRouter, 'providerStatuses' | 'resolveSecret'> & { runProvider: SearchRouter['runProvider'] } & { registry?: ProviderRegistry }
  fetch: Pick<FetchService, 'fetchPage'>
  store: Store
  dynamic: () => ResolvedConfig
  /** Test seam for the judge HTTP client. */
  fetchImpl?: typeof fetch
  /** Test seam for the usage ledger's clock (epoch ms). */
  now?: () => number
}

/** Pack as returned by the tool: `sources` shaped like every other exit. */
export type EvidenceOutput = Omit<EvidencePack, 'sources'> & { sources: ReturnType<typeof shapeSources>; fromCache: false }

export const PAGE_MAX_CHARS = 60_000
/** Route id of the ctx.web engine (see providers/builtin.ts). */
const SEAM_ROUTE_ID = 'seam'


export class EvidenceService {
  constructor(private readonly deps: EvidenceServiceDeps) {}

  /**
   * Which scorer decides and which (if any) only observes. The mode is `evidence.judge.mode`, or its legacy alias
   * `evidence.jevMode`; the model behind it is `evidence.judge.provider` (default `bocha-jev`). Whatever cannot be set
   * up (unknown provider, missing key, uncalibrated reranker, ...) leaves the rule scorer in charge and says why.
   */
  private async scorers(notes: string[], budget: SearchBudget): Promise<{ control: Scorer; shadow?: Scorer }> {
    const cfg = this.deps.dynamic().evidence
    const rule = new RuleScorer()
    const mode = cfg.judge?.mode ?? cfg.jevMode
    if (mode === 'off') {
      if (cfg.scorer === 'jev') notes.push('evidence.scorer=jev ignored: evidence.jevMode is off')
      return { control: rule }
    }
    const selection = selectProvider(cfg.judge)
    notes.push(...selection.diagnostics, ...resolveBudget(cfg.budget).diagnostics)
    const provider = selection.provider
    if (!provider) {
      notes.push((selection.unusable ?? 'no judge provider') + ': rule scorer used')
      return { control: rule }
    }
    const label = provider.label ?? provider.id
    const key = provider.keyRef ? await this.deps.router.resolveSecret(provider.keyRef) : undefined
    if (provider.keyRef && !key) {
      notes.push(label + ' ' + mode + ' mode needs ' + provider.keyRef + ' (credentials ref or environment): rule scorer used')
      return { control: rule }
    }
    // The rubric words the questions of the rubric-driven protocols; a reranker takes the need text as its query.
    let rubric
    if (provider.protocol !== 'rerank') {
      const resolved = resolveRubric(provider.rubricId ?? 'score.support', cfg.rubrics)
      notes.push(...resolved.diagnostics)
      rubric = resolved.rubric
    }
    let model: Scorer
    try {
      model = createModelScorer(provider, { apiKey: key, rubric, ...this.deps.fetchImpl ? { fetchImpl: this.deps.fetchImpl } : {}, meter: budget.meterFor(provider), requestCap: provider.limits?.requestCap ?? 16 })
    } catch (error) {
      notes.push(label + ' could not be set up, rule scorer used: ' + (error instanceof Error ? error.message : String(error)))
      return { control: rule }
    }
    if (mode === 'shadow') return { control: rule, shadow: model }
    if (mode === 'hybrid') return { control: new HybridScorer({ jev: model, rule, borderline: cfg.hybridBorderline, maxQuestions: cfg.maxJevQuestions }) }
    // `control`: the legacy key pair needs `scorer: jev` as well; the neutral `judge.mode` is a single explicit switch.
    if (cfg.judge?.mode === 'control' || cfg.scorer === 'jev') return { control: model }
    notes.push('evidence.jevMode=control needs evidence.scorer=jev: rule scorer used')
    return { control: rule }
  }

  async search(request: EvidenceRequest): Promise<EvidenceOutput> {
    const { spec, notes: specNotes } = buildTaskSpec(request)
    const cfg = this.deps.dynamic()
    const scorerNotes: string[] = []
    const ledger = new UsageLedger(this.deps.store, resolveBudget(cfg.evidence.budget).caps, this.deps.now)
    const scorers = await this.scorers(scorerNotes, ledger.forSearch())
    const { router, fetch: fetchSvc } = this.deps

    // Registry-aware planning: aliases normalised to route ids, descriptors for language / profile promotion, adapter compilers.
    const registry = router.registry
    const normalize = (ids: readonly string[]): string[] => (registry ? [...new Set(ids.map(id => registry.routeId(id) ?? id))] : [...ids])
    const compiler: PipelineDeps['compiler'] = (task, id, now) => registry?.resolve(id)?.compile?.(task, now) ?? compileQuery(task, id, now)

    // Inside the ctx.web provider the ctx.web engine must not run (it would call this plugin again): it is taken out of the
    // configured list before planning, and a call that still reaches it is answered `skipped` without touching ctx.web.
    const skipSeam = request.skipSeam === true
    const isSeam = (id: string): boolean => (registry ? registry.routeId(id) ?? id : id) === SEAM_ROUTE_ID
    const usable = (ids: readonly string[]): string[] => normalize(ids).filter(id => !(skipSeam && isSeam(id)))
    const deps: PipelineDeps = {
      providerStatus: ids => router.providerStatuses(ids),
      searchProvider: async call => skipSeam && isSeam(call.id) ? { state: 'skipped', reason: 'ctx.web engine is not used inside the ctx.web provider' } : router.runProvider(call, { skipSeam }),
      fetchPage: async (url, signal) => {
        const page = await fetchSvc.fetchPage(url, { mode: 'auto', signal, maxChars: PAGE_MAX_CHARS, fresh: false, persist: true })
        return { url: page.url, ...page.title ? { title: page.title } : {}, text: page.text, ...page.shellPage ? { shellPage: true } : {}, source: page.source }
      },
      scorers,
      configuredEngines: usable(cfg.engines),
      ...registry ? { descriptors: registry.list({ operation: 'search' }).map(a => a.descriptor), compiler } : {},
      autoProviders: cfg.evidence.autoProviders !== false,
      fusion: { k: cfg.rrfConstant, freshnessBoost: cfg.freshnessBoost, freshnessDays: cfg.freshnessDays, authorityBoost: cfg.authorityBoost, authorityDomains: cfg.authorityDomains },
    }
    // Explicit platform sources: the named platform, or `engines` that are all platforms. None of them runnable = report it.
    const platformNotes: string[] = []
    let explicit: string[] | undefined = request.platform ? usable([request.platform.id]) : request.engines?.length ? usable(request.engines) : undefined
    if (explicit?.length && registry && explicit.every(id => registry.resolve(id)?.descriptor.kind === 'platform')) {
      const statuses = await router.providerStatuses(explicit)
      const reasons = explicit.filter(id => statuses.get(id)?.state !== 'ready').map(id => {
        const status = statuses.get(id)
        return status ? (status.state === 'cooldown' ? 'cooling down' : 'unavailable') + (status.reason ? ': ' + status.reason : '') : 'not registered'
      })
      if (reasons.length === explicit.length) {
        const message = 'platform ' + explicit.join(', ') + ' unavailable: ' + reasons.join('; ')
        if (!request.allowFallback) throw new SourceUnavailableError(message, explicit[0]!, reasons)
        platformNotes.push(message + ' (allowFallback: the profile\'s web engines were searched instead)')
        explicit = undefined
      }
    }
    const platformId = request.platform ? usable([request.platform.id])[0] : undefined
    const callOptions = request.platform && platformId !== undefined
      ? { ...request.platform.url ? { url: request.platform.url } : {}, ...request.platform.authProfile || request.platform.rulePack ? { browser: { ...request.platform.authProfile ? { authProfile: request.platform.authProfile } : {}, ...request.platform.rulePack ? { rulePack: request.platform.rulePack } : {} } } : {} }
      : undefined
    const options: PipelineOptions = {
      signal: request.signal,
      deadlineMs: request.deadlineMs ?? cfg.timeoutMs + 30_000,
      ...explicit?.length ? { engines: explicit } : {},
      ...callOptions && Object.keys(callOptions).length && platformId !== undefined && explicit?.length ? { providerOptions: { [platformId]: callOptions } } : {},
      sourcesCount: request.count,
      maxScoreQuestions: cfg.evidence.maxJevQuestions,
      maxRounds: cfg.evidence.maxRounds,
      maxQueries: cfg.evidence.maxQueries,
    }
    const result = await runPipeline(spec, deps, options)
    result.pack.notes.unshift(...specNotes, ...scorerNotes, ...platformNotes)
    this.persist(result, request)
    const { sources, ...rest } = result.pack
    return { ...rest, sources: shapeSources(sources, request.count), fromCache: false }
  }

  /** Best-effort: the pack already exists, a storage failure must not lose it. */
  private persist(result: PipelineResult, request: EvidenceRequest): void {
    const { store } = this.deps
    const { pack, task } = result
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
    }))
  }
}
