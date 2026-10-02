/**
 * Wiring of the evidence pipeline to the plugin: registry-backed providers,
 * FetchService pages, the configured scorers, and persistence of the run.
 * `web_search_pro` calls {@link EvidenceService.search} when `task` or
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
import { resolveRubric } from './rubrics.ts'
import { HybridScorer, JEV_KEY_REF, JevScorer, RuleScorer, type Scorer } from './score.ts'
import type { EvidencePack } from './types.ts'

export interface EvidenceRequest extends TaskInput {
  /** Explicit engine ids (tool `engines`). */
  engines?: string[] | undefined
  /** `sources` entries to return. */
  count: number
  signal?: AbortSignal | undefined
}

export interface EvidenceServiceDeps {
  router: Pick<SearchRouter, 'providerStatuses' | 'runProvider' | 'resolveSecret'>
  fetch: Pick<FetchService, 'fetchPage'>
  store: Store
  dynamic: () => ResolvedConfig
  /** Test seam for the Jev HTTP client. */
  fetchImpl?: typeof fetch
}

/** Pack as returned by the tool: `sources` shaped like every other exit. */
export type EvidenceOutput = Omit<EvidencePack, 'sources'> & { sources: ReturnType<typeof shapeSources>; fromCache: false }

export const PAGE_MAX_CHARS = 60_000

export class EvidenceService {
  constructor(private readonly deps: EvidenceServiceDeps) {}

  /** Which scorer decides and which (if any) only observes, from `evidence.scorer` / `evidence.jevMode`. */
  private async scorers(notes: string[]): Promise<{ control: Scorer; shadow?: Scorer }> {
    const cfg = this.deps.dynamic().evidence
    const rule = new RuleScorer()
    if (cfg.jevMode === 'off') {
      if (cfg.scorer === 'jev') notes.push('evidence.scorer=jev ignored: evidence.jevMode is off')
      return { control: rule }
    }
    const key = await this.deps.router.resolveSecret(JEV_KEY_REF)
    if (!key) {
      notes.push('Jev ' + cfg.jevMode + ' mode needs ' + JEV_KEY_REF + ' (credentials ref or environment): rule scorer used')
      return { control: rule }
    }
    const { rubric, diagnostics } = resolveRubric('score.support', cfg.rubrics)
    notes.push(...diagnostics)
    const jev = new JevScorer({ apiKey: key, rubric, ...this.deps.fetchImpl ? { fetchImpl: this.deps.fetchImpl } : {}, requestCap: 16 })
    if (cfg.jevMode === 'shadow') return { control: rule, shadow: jev }
    if (cfg.jevMode === 'hybrid') return { control: new HybridScorer({ jev, rule, borderline: cfg.hybridBorderline, maxQuestions: cfg.maxJevQuestions }) }
    if (cfg.scorer === 'jev') return { control: jev }
    notes.push('evidence.jevMode=control needs evidence.scorer=jev: rule scorer used')
    return { control: rule }
  }

  async search(request: EvidenceRequest): Promise<EvidenceOutput> {
    const { spec, notes: specNotes } = buildTaskSpec(request)
    const cfg = this.deps.dynamic()
    const scorerNotes: string[] = []
    const scorers = await this.scorers(scorerNotes)
    const { router, fetch: fetchSvc } = this.deps

    const deps: PipelineDeps = {
      providerStatus: ids => router.providerStatuses(ids),
      searchProvider: call => router.runProvider(call),
      fetchPage: async (url, signal) => {
        const page = await fetchSvc.fetchPage(url, { mode: 'auto', signal, maxChars: PAGE_MAX_CHARS, fresh: false, persist: true })
        return { url: page.url, ...page.title ? { title: page.title } : {}, text: page.text, ...page.shellPage ? { shellPage: true } : {}, source: page.source }
      },
      scorers,
      configuredEngines: cfg.engines,
      fusion: { k: cfg.rrfConstant, freshnessBoost: cfg.freshnessBoost, freshnessDays: cfg.freshnessDays, authorityBoost: cfg.authorityBoost, authorityDomains: cfg.authorityDomains },
    }
    const options: PipelineOptions = {
      signal: request.signal,
      deadlineMs: cfg.timeoutMs + 30_000,
      ...request.engines?.length ? { engines: request.engines } : {},
      sourcesCount: request.count,
      maxScoreQuestions: cfg.evidence.maxJevQuestions,
    }
    const result = await runPipeline(spec, deps, options)
    result.pack.notes.unshift(...specNotes, ...scorerNotes)
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
