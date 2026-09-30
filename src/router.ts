/**
 * Search orchestration: engine ordering/fallback (agent-reach style routing),
 * optional parallel multi-engine merging, SQLite caching, and persistence.
 * @module web-search-pro/router
 */

import type { Context } from '@deepseek-ai/cordis'
import type { WebRuntime, WebSearchRequest, WebSearchResult } from '@deepseek-ai/dsh-web'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import type { Store } from './store.ts'
import type { ResolvedConfig } from './config.ts'
import {
  seamEngine, exaEngine, ddgEngine, bingEngine, jinaSearchEngine, githubEngine,
  bilibiliEngine, v2exEngine, youtubeEngine, arxivEngine, pubmedEngine, platformEngines,
  rssEngine, customPlatformEngine, EngineError, type Engine, type EngineDeps, type SearchOutcome, type EngineSearchOptions,
} from './engines.ts'
import { normQuery, shapeSources } from './util.ts'
import { LruCache } from './memory-cache.ts'
import type { BrowserService } from './browser-service.ts'
import { browserGap, toBrowserGetter, type BrowserGetter } from './browser-access.ts'
import { createPlatformCacheKey, createSearchCacheKey } from './cache-key.ts'
import { allAttemptsBenign, allAttemptsEmpty, BackendRegistry, NoBackendError, type BackendAttempt, type BackendDiagnostic } from './backend-registry.ts'
import { ExaClient, type ExaResult } from './exa-client.ts'
import { SingleFlight } from './singleflight.ts'
import { mergeCandidates, type ProviderOutput } from './pipeline/candidates.ts'
import { fuseCandidates } from './pipeline/fusion.ts'
import type { ProviderCall, ProviderOutcome } from './pipeline/run.ts'
import type { ProviderStatus } from './pipeline/plan.ts'

export interface RouterSearchOptions {
  query: string
  /** Engine ids to try, in order. Defaults to config.engines. */
  engines?: string[]
  count: number
  /** Bypass the fresh-cache lookup. */
  fresh: boolean
  /** Run all requested engines in parallel and merge results. */
  multi: boolean
  signal: AbortSignal | undefined
  /** True when called from the ctx.web provider (prevents seam recursion). */
  skipSeam?: boolean
  /** Native Exa search controls; ignored by other engines. */
  exa?: EngineSearchOptions['exa']
}

export interface RouterSearchResult {
  content?: string
  sources: { url: string; title?: string; snippet?: string; publishedAt?: string }[]
  engine: string
  enginesTried: string[]
  fromCache: boolean
  /** Sources available before slicing to `count` (>= sources.length); drives `truncated`. */
  availableCount?: number
  /** Human-readable explanation of why the router fell back to `engine` (P1-1). */
  fallbackNote?: string
}

const ENGINE_FACTORIES: Record<string, (deps: any, config: ResolvedConfig) => Engine> = {
  seam: (_deps) => seamEngine(_deps),
  exa: (deps) => exaEngine(deps),
  ddg: (deps) => ddgEngine(deps.allowProxyFakeIp),
  bing: (deps) => bingEngine(deps.allowProxyFakeIp),
  jina: (deps) => jinaSearchEngine(deps),
  github: (deps) => githubEngine(deps),
  bilibili: (deps) => bilibiliEngine(deps),
  v2ex: (deps) => v2exEngine(deps.allowProxyFakeIp),
  youtube: (deps) => youtubeEngine(deps),
  arxiv: (deps) => arxivEngine(deps.allowProxyFakeIp),
  pubmed: (deps) => pubmedEngine(deps.allowProxyFakeIp),
}

export class SearchRouter {
  /** In-flight de-duplication of identical non-fresh requests (C3). */
  private readonly searchFlights = new SingleFlight<RouterSearchResult>()
  private readonly platformFlights = new SingleFlight<RouterSearchResult>()
  private readonly getBrowser: BrowserGetter
  private readonly backends: BackendRegistry<{ query: string; count: number; signal?: AbortSignal; skipSeam: boolean; options?: EngineSearchOptions }, SearchOutcome>

  constructor(
    private readonly ctx: Context,
    private readonly config: ResolvedConfig,
    private readonly store: Store,
    private readonly dynamic: () => ResolvedConfig = () => config,
    browser?: BrowserService | BrowserGetter,
    private readonly memory = new LruCache<RouterSearchResult>(config.memoryCacheEntries),
  ) {
    this.getBrowser = toBrowserGetter(browser)
    this.backends = new BackendRegistry({ cooldownMs: 30_000 })
    for (const id of Object.keys(ENGINE_FACTORIES)) {
      this.backends.register({
        id,
        probe: async () => {
          try {
            const engine = await this.build(id, false)
            if (engine.available()) return { available: true }
            return { available: false, reason: engine.label + ' unavailable' }
          } catch (error) {
            return { available: false, reason: error instanceof Error ? error.message : String(error) }
          }
        },
        run: async input => {
          const engine = await this.build(id, input.skipSeam)
          if (!engine.available()) throw new EngineError(engine.label + ' unavailable', 'ENGINE_UNAVAILABLE', false)
          return engine.search(input.query, input.count, input.signal, input.options)
        },
        // Quality gate: a result whose snippet coverage is below 50% is usable
        // but thin — the router should keep probing later engines instead of
        // settling for titles-only output (the ddg-regex regression case).
        // Engines that produce descriptive snippets by construction (GitHub
        // metadata, bili video cards, YouTube meta lines) are exempt: their
        // snippet field carries structured info, not prose coverage.
        assess: outcome => {
          const sources = outcome.sources
          if (!sources.length) return { ok: true }
          const META_SNIPPET_ENGINES = new Set(['github', 'github-code', 'github-issues', 'bilibili', 'youtube'])
          if (META_SNIPPET_ENGINES.has(id)) return { ok: true }
          const withSnippet = sources.filter(s => s.snippet && s.snippet.trim()).length
          const ratio = withSnippet / sources.length
          if (ratio >= 0.5) return { ok: true }
          return { ok: true, lowQuality: true, detail: 'snippets=' + withSnippet + '/' + sources.length }
        },
      })
    }
  }

  async backendDiagnostics(cliAvailability?: ReadonlyMap<string, boolean>): Promise<BackendDiagnostic[]> {
    const diagnostics = await this.backends.diagnosticsAsync()
    if (!cliAvailability || !this.dynamic().enableCliBackends) return diagnostics

    const cfg = this.dynamic()
    const exaKey = await this.resolveKey(cfg.exaApiKeyEnv, cfg.exaApiKey)
    const requiredCli = new Map<string, string>([
      ...exaKey ? [] : [['exa', 'mcporter'] as const],
      ['bilibili', 'bili'],
      ['youtube', 'yt-dlp'],
    ])
    return diagnostics.map(diagnostic => {
      const dependency = requiredCli.get(diagnostic.id)
      if (!dependency || cliAvailability.get(dependency) !== false) return diagnostic
      return {
        ...diagnostic,
        available: false,
        state: 'unavailable',
        reason: dependency + ' executable not found',
      }
    })
  }

  async exaContents(urls: string[], signal?: AbortSignal): Promise<ExaResult[]> {
    const cfg = this.dynamic()
    const key = await this.resolveKey(cfg.exaApiKeyEnv, cfg.exaApiKey)
    if (!key) throw new Error('Exa is unavailable: configure exaApiKey or ' + cfg.exaApiKeyEnv)
    return new ExaClient({ apiKey: key }).contents(urls, signal)
  }

  /** Resolve a secret by credentials ref / environment variable name (credentials service first, then env). */
  resolveSecret(ref: string): Promise<string | undefined> {
    return this.resolveKey(ref)
  }

  /**
   * Availability of engines for source planning: the registry's probe and
   * cooldown state, without running a search. Ids the registry does not know are absent.
   */
  async providerStatuses(ids: readonly string[]): Promise<Map<string, ProviderStatus>> {
    const wanted = new Set(ids)
    const out = new Map<string, ProviderStatus>()
    for (const d of await this.backends.diagnosticsAsync()) {
      if (!wanted.has(d.id)) continue
      const reason = d.state === 'cooldown' ? d.lastError : d.reason
      out.set(d.id, { state: d.state, ...reason ? { reason } : {} })
    }
    return out
  }

  /**
   * Run ONE engine through the registry (probe, cooldown, quality gate,
   * attempts) for the evidence pipeline. Not cached or persisted: the pipeline
   * persists its fused result once. Cancellation is rethrown; every other
   * outcome is a value.
   */
  async runProvider(call: ProviderCall): Promise<ProviderOutcome> {
    try {
      const selected = await this.backends.runSelected(
        { query: call.query, count: call.count, signal: call.signal, skipSeam: false, ...call.options ? { options: call.options } : {} },
        { preferred: [call.id], signal: call.signal },
      )
      const sources = selected.value.sources
      return sources.length ? { state: 'ok', sources } : { state: 'empty' }
    } catch (error) {
      if (call.signal.aborted) throw error
      if (error instanceof NoBackendError) {
        if (allAttemptsEmpty(error.attempts)) return { state: 'empty' }
        const skipped = error.attempts.find(a => a.outcome === 'skipped')
        if (skipped && allAttemptsBenign(error.attempts)) return { state: 'skipped', reason: skipped.detail ?? 'unavailable' }
      }
      return { state: 'error', message: error instanceof Error ? error.message : String(error) }
    }
  }

  /** Resolve a key through credentials first, then process env. */
  private async resolveKey(ref: string, literal?: string): Promise<string | undefined> {
    if (literal && literal.length > 0) return literal
    const credentials = this.ctx.get('credentials')
    if (credentials) {
      try {
        const resolved = await credentials.resolve(credentialRef(ref))
        if (resolved?.value) return resolved.value
      } catch { /* fall through to env */ }
    }
    return process.env[ref]
  }

  private async deps(skipSeam: boolean): Promise<EngineDeps> {
    const cfg = this.dynamic()
    const web = this.ctx.get('web') as WebRuntime | undefined
    const browser = this.getBrowser()
    const exaApiKey = await this.resolveKey(cfg.exaApiKeyEnv, cfg.exaApiKey)
    const jinaApiKey = await this.resolveKey(cfg.jinaApiKeyEnv, cfg.jinaApiKey)
    const githubToken = await this.resolveKey(cfg.githubTokenEnv, cfg.githubToken)
    return {
      ...web !== undefined ? { web } : {},
      ...exaApiKey ? { exaApiKey } : {},
      ...jinaApiKey ? { jinaApiKey } : {},
      ...githubToken ? { githubToken } : {},
      enableCli: cfg.enableCliBackends,
      opencliEnabled: cfg.opencliEnabled,
      agentReachEnabled: cfg.agentReachEnabled,
      allowProxyFakeIp: cfg.allowProxyFakeIp,
      ...browser !== undefined ? { browser } : {},
      ...cfg.platformRules !== undefined ? { platformRules: cfg.platformRules } : {},
      ...cfg.customPlatforms !== undefined ? { customPlatforms: cfg.customPlatforms } : {},
      skipSeam,
    }
  }

  /** Sync key check for available() (no credential resolution — env/literal only). */
  private depsSync(skipSeam: boolean): EngineDeps {
    const cfg = this.dynamic()
    const web = this.ctx.get('web') as WebRuntime | undefined
    const browser = this.getBrowser()
    const exaApiKey = cfg.exaApiKey || process.env[cfg.exaApiKeyEnv]
    const jinaApiKey = cfg.jinaApiKey || process.env[cfg.jinaApiKeyEnv]
    const githubToken = cfg.githubToken || process.env[cfg.githubTokenEnv] || process.env.GH_TOKEN
    return {
      ...web !== undefined ? { web } : {},
      ...exaApiKey ? { exaApiKey } : {},
      ...jinaApiKey ? { jinaApiKey } : {},
      ...githubToken ? { githubToken } : {},
      enableCli: cfg.enableCliBackends,
      opencliEnabled: cfg.opencliEnabled,
      agentReachEnabled: cfg.agentReachEnabled,
      allowProxyFakeIp: cfg.allowProxyFakeIp,
      ...browser !== undefined ? { browser } : {},
      ...cfg.platformRules !== undefined ? { platformRules: cfg.platformRules } : {},
      ...cfg.customPlatforms !== undefined ? { customPlatforms: cfg.customPlatforms } : {},
      skipSeam,
    }
  }

  /** Whether any configured engine is currently usable. */
  anyEngineAvailable(): boolean {
    const ids = this.dynamic().engines
    return ids.some(id => this.buildSync(id, false).available())
  }

  private async build(id: string, skipSeam: boolean): Promise<Engine> {
    const factory = ENGINE_FACTORIES[id]
    if (!factory) throw new EngineError('unknown engine: ' + id, 'ENGINE_UNAVAILABLE', false)
    return factory(await this.deps(skipSeam), this.dynamic())
  }

  private buildSync(id: string, skipSeam: boolean): Engine {
    const factory = ENGINE_FACTORIES[id]
    if (!factory) throw new EngineError('unknown engine: ' + id, 'ENGINE_UNAVAILABLE', false)
    return factory(this.depsSync(skipSeam), this.dynamic())
  }

  /** Run a full search with caching + persistence. */
  async search(opts: RouterSearchOptions): Promise<RouterSearchResult> {
    const query = opts.query.trim()
    if (!query) throw new Error('query must be a non-empty string')
    const cfg = this.dynamic()
    const ids = (opts.engines && opts.engines.length ? opts.engines : cfg.engines)
      .filter((id, i, arr) => arr.indexOf(id) === i)
    const nq = normQuery(query)
    const count = Math.min(Math.max(opts.count, 1), 20)
    const multi = opts.multi && ids.length > 1
    const cacheKey = createSearchCacheKey({ query, engines: ids, count, multi, ...opts.exa ? { exa: opts.exa as Record<string, unknown> } : {} })
    const memoryKey = cacheKey + ':count=' + count
    const run = (signal: AbortSignal | undefined): Promise<RouterSearchResult> => this.runSearch({ opts, query, nq, ids, count, multi, cacheKey, memoryKey }, signal)
    if (opts.fresh) return run(opts.signal)
    // skipSeam changes which engines can run, so it must be part of the flight identity.
    return this.searchFlights.do(memoryKey + (opts.skipSeam ? ':skipSeam' : ''), run, opts.signal)
  }

  private async runSearch(
    p: { opts: RouterSearchOptions; query: string; nq: string; ids: string[]; count: number; multi: boolean; cacheKey: string; memoryKey: string },
    signal: AbortSignal | undefined,
  ): Promise<RouterSearchResult> {
    const { opts, query, nq, ids, count, multi, cacheKey, memoryKey } = p
    const cfg = this.dynamic()

    // 1. In-process LRU cache, then SQLite.
    if (!opts.fresh) {
      const hot = this.memory.get(memoryKey, cfg.ttlSeconds * 1000)
      if (hot) return { ...hot, fromCache: true }
      const cached = this.store.bestEffort('search cache read', () => {
        const hit = this.store.getCachedQuery('search', cacheKey, cfg.ttlSeconds)
        return hit ? { hit, rows: this.store.resultsForQuery(hit.id) } : undefined
      })
      if (cached?.rows.length) {
        let detail: { content?: string; engine?: string; enginesTried?: string[]; requestedCount?: number; fallbackNote?: string } | undefined
        if (cached.hit.detail) { try { detail = JSON.parse(cached.hit.detail) } catch { /* ignore */ } }
        if (detail?.requestedCount === undefined || detail.requestedCount >= count) {
          const result: RouterSearchResult = {
            ...detail?.content ? { content: detail.content } : {},
            sources: shapeSources(cached.rows.map(r => ({ url: r.url, title: r.title, snippet: r.snippet, publishedAt: r.published })), count),
            engine: detail?.engine ?? ids[0] ?? 'unknown',
            enginesTried: detail?.enginesTried ?? ids,
            fromCache: true,
            availableCount: cached.rows.length,
            ...detail?.fallbackNote ? { fallbackNote: detail.fallbackNote } : {},
          }
          this.memory.set(memoryKey, result)
          return result
        }
      }
    }

    // 2. Run engines.
    const enginesTried: string[] = []
    let outcome: SearchOutcome | undefined
    let usedId: string | undefined
    let fallbackNote: string | undefined
    let availableCount: number | undefined
    let persistExtras: string[] | undefined

    if (multi) {
      // Every engine goes through the registry (probe, cooldown, quality gate,
      // attempts) in parallel; failures of one never cancel the others.
      const input = { query, count, signal, skipSeam: opts.skipSeam ?? false, ...opts.exa ? { options: { exa: opts.exa } } : {} }
      const results = await Promise.allSettled(ids.map(id => this.backends.runSelected(input, { preferred: [id], ...signal ? { signal } : {} })))
      if (signal?.aborted) throw signal.reason ?? new DOMException('This operation was aborted', 'AbortError')
      enginesTried.push(...ids)
      // Merge by canonical URL (every provider/rank/query contribution kept),
      // then fuse: one normalised RRF term per provider, freshness/authority
      // bonuses once per URL (pipeline/fusion.ts).
      const outputs: ProviderOutput[] = []
      results.forEach((r, index) => {
        if (r.status === 'fulfilled' && r.value.value.sources.length) outputs.push({ providerId: ids[index]!, query, sources: r.value.value.sources })
      })
      if (!outputs.length) {
        // No engine failed at runtime: each answered with nothing or was skipped
        // (unavailable / cooling down). That is an empty result with a note, not an error.
        const benign = results.every(r => r.status === 'fulfilled' || (r.reason instanceof NoBackendError && allAttemptsBenign(r.reason.attempts)))
        if (benign) return this.emptyResult(ids, 'multi(' + ids.join('+') + ')', results.flatMap(r => r.status === 'rejected' && r.reason instanceof NoBackendError ? r.reason.attempts : []))
        const failures = results.map((r, index) => ids[index] + ': ' + (r.status === 'rejected' ? (r.reason instanceof Error ? r.reason.message : String(r.reason)) : 'empty')).join('; ')
        throw new Error('all engines failed: ' + failures)
      }
      const merged = mergeCandidates(outputs)
      const ranked = fuseCandidates(merged, {
        k: cfg.rrfConstant,
        freshnessBoost: cfg.freshnessBoost,
        freshnessDays: cfg.freshnessDays,
        authorityBoost: cfg.authorityBoost,
        authorityDomains: cfg.authorityDomains,
        nProviders: outputs.length,
      }).slice(0, count)
      availableCount = merged.length
      outcome = { sources: ranked.map(({ candidate }) => ({ url: candidate.url, ...candidate.title ? { title: candidate.title } : {}, ...candidate.snippet ? { snippet: candidate.snippet } : {}, ...candidate.publishedAt ? { publishedAt: candidate.publishedAt } : {} })) }
      // Per-source provenance survives in results.extra (no schema change); the cache-hit path ignores it.
      persistExtras = ranked.map(({ candidate, score }) => JSON.stringify({ contributions: candidate.contributions, score: Number(score.toFixed(6)) }))
      usedId = 'multi(' + ids.join('+') + ')'
    } else {
      try {
        const selected = await this.backends.runSelected(
          { query, count, signal, skipSeam: opts.skipSeam ?? false, ...opts.exa ? { options: { exa: opts.exa } } : {} },
          { preferred: ids, ...signal ? { signal } : {} },
        )
        outcome = selected.value
        usedId = selected.id
        enginesTried.push(...ids.slice(0, Math.max(ids.indexOf(selected.id) + 1, 1)))
        // P1-1: explain the fallback (e.g. ddg returned results but none had snippets).
        const lowQualityAttempts = selected.attempts.filter(a => a.outcome === 'low-quality')
        if (lowQualityAttempts.length) {
          const triedLine = selected.attempts
            .map(a => a.id + '(' + a.outcome + (a.detail ? ':' + a.detail : '') + ')')
            .join(' -> ')
          fallbackNote = 'fallback; ' + lowQualityAttempts.map(a => a.id + ' returned results but ' + (a.detail ?? 'low quality')).join('; ') + '\ntried: ' + triedLine
        }
      } catch (error) {
        if (signal?.aborted) throw error
        enginesTried.push(...ids)
        // Every engine answered empty or was skipped (no runtime failure): report that, do not fail or cache it.
        if (error instanceof NoBackendError && allAttemptsBenign(error.attempts)) return this.emptyResult(ids, 'none', error.attempts)
        throw error
      }
    }
    availableCount ??= outcome.sources.length

    // 3. Persist (atomic query + rows). A storage failure must not lose results
    // the network already paid for: it is logged and the search still returns.
    const finalOutcome = outcome
    const finalId = usedId
    this.store.bestEffort('recordSearch', () => this.store.recordSearch({
      kind: 'search',
      query: nq,
      engine: finalId,
      status: 'ok',
      cacheKey,
      detail: JSON.stringify({ ...finalOutcome.content ? { content: finalOutcome.content } : {}, engine: finalId, enginesTried, requestedCount: count, ...fallbackNote ? { fallbackNote } : {} }),
    }, persistExtras ? finalOutcome.sources.map((source, i) => ({ ...source, extra: persistExtras![i]! })) : finalOutcome.sources, finalId))

    const result: RouterSearchResult = {
      ...outcome.content ? { content: outcome.content } : {},
      sources: shapeSources(outcome.sources, count),
      engine: usedId,
      enginesTried,
      fromCache: false,
      availableCount,
      ...fallbackNote ? { fallbackNote } : {},
    }
    // 4. Warm the in-process LRU (memory-only; survives across SQLite hits).
    this.memory.set(memoryKey, result)
    return result
  }

  /**
   * No engine failed at runtime: each returned ENGINE_EMPTY or was skipped
   * (unavailable / cooldown). Zero sources plus an explanation (never cached).
   */
  private emptyResult(ids: readonly string[], engine: string, attempts: readonly BackendAttempt[] = []): RouterSearchResult {
    const skipped = attempts.filter(a => a.outcome === 'skipped')
    return {
      sources: [],
      engine,
      enginesTried: [...ids],
      fromCache: false,
      availableCount: 0,
      fallbackNote: 'all engines returned no results' + (skipped.length ? ' or were unavailable' : '') + ' (tried: ' + ids.join(', ') + ')'
        + (skipped.length ? '; skipped: ' + skipped.map(a => a.id + ' (' + (a.detail ?? 'unavailable') + ')').join(', ') : ''),
    }
  }

  /** Platform search (web_platform_search tool) with the same cache+persist flow. */
  async platformSearch(
    platform: string,
    query: string,
    url: string | undefined,
    count: number,
    opts: { signal?: AbortSignal; fresh?: boolean; authProfile?: string; rulePack?: string },
  ): Promise<RouterSearchResult> {
    const legacyRssUrl = platform === 'rss' && !url && /^https?:\/\//i.test(query.trim()) ? query.trim() : undefined
    const feedUrl = url ?? legacyRssUrl
    const effectiveQuery = legacyRssUrl ? '' : query
    const boundedCount = Math.min(Math.max(count, 1), 20)
    const binding = this.dynamic().browserBindings?.[platform]
    const authProfile = opts.authProfile ?? binding?.authProfile
    const rulePack = opts.rulePack ?? binding?.rulePack
    const cacheKey = createPlatformCacheKey({ platform, query: effectiveQuery || feedUrl || platform, ...feedUrl ? { url: feedUrl } : {}, count: boundedCount, ...authProfile ? { authProfile } : {}, ...rulePack ? { rulePack } : {} })
    const run = (signal: AbortSignal | undefined): Promise<RouterSearchResult> =>
      this.runPlatformSearch({ platform, url: feedUrl, effectiveQuery, boundedCount, authProfile, rulePack, cacheKey, fresh: opts.fresh ?? false }, signal)
    if (opts.fresh) return run(opts.signal)
    // The cache key ignores count (smaller requests reuse larger ones); flights must not.
    return this.platformFlights.do(cacheKey + ':count=' + boundedCount, run, opts.signal)
  }

  /** Platform engine list; a seam so tests can inject fakes without network. */
  protected platformEngineList(platform: string, feedUrl: string | undefined, deps: EngineDeps): Engine[] {
    const custom = this.dynamic().customPlatforms?.[platform]
    return custom
      ? [customPlatformEngine(platform, custom, deps)]
      : (platform === 'rss' && feedUrl ? [rssEngine(feedUrl, deps.allowProxyFakeIp)] : platformEngines(platform, deps))
  }

  private async runPlatformSearch(
    p: { platform: string; url: string | undefined; effectiveQuery: string; boundedCount: number; authProfile: string | undefined; rulePack: string | undefined; cacheKey: string; fresh: boolean },
    signal: AbortSignal | undefined,
  ): Promise<RouterSearchResult> {
    const { platform, url: feedUrl, effectiveQuery, boundedCount, authProfile, rulePack, cacheKey } = p
    const nq = normQuery(effectiveQuery || feedUrl || platform)
    // Async deps (not depsSync): platform engines may need credentials-resolved
    // keys (e.g. githubToken from the credentials service), which the sync path
    // cannot reach. platformSearch is async, so awaiting is free.
    const deps = await this.deps(true)
    const engines = this.platformEngineList(platform, feedUrl, deps)
    if (!engines.length) throw new Error('unsupported platform: ' + platform)

    if (!p.fresh) {
      const cached = this.store.bestEffort('platform cache read', () => {
        const hit = this.store.getCachedQuery('platform', cacheKey, this.dynamic().ttlSeconds)
        return hit ? { hit, rows: this.store.resultsForQuery(hit.id) } : undefined
      })
      if (cached) {
        let detail: { requestedCount?: number } | undefined
        if (cached.hit.detail) { try { detail = JSON.parse(cached.hit.detail) } catch { /* ignore */ } }
        if (cached.rows.length && (detail?.requestedCount === undefined || detail.requestedCount >= boundedCount)) {
          return {
            sources: shapeSources(cached.rows.map(r => ({ url: r.url, title: r.title, snippet: r.snippet, publishedAt: r.published })), boundedCount),
            engine: platform,
            enginesTried: [platform],
            fromCache: true,
            availableCount: cached.rows.length,
          }
        }
      }
    }

    const enginesTried: string[] = []
    let outcome: SearchOutcome | undefined
    let lastError: unknown
    for (const engine of engines) {
      enginesTried.push(engine.id)
      if (!engine.available()) {
        // Say why when the blocker is the optional dsh-browser service.
        const gap = engine.needsBrowser ? browserGap(deps.browser, engine.needsBrowser, 'platform ' + platform) : undefined
        if (gap) lastError = new Error(gap)
        continue
      }
      try {
        outcome = await engine.search(platform === 'rss' ? effectiveQuery : effectiveQuery || 'latest', boundedCount, signal, authProfile || rulePack ? { browser: { ...authProfile ? { authProfile } : {}, ...rulePack ? { rulePack } : {} } } : undefined)
        break
      } catch (error) {
        if (signal?.aborted) throw error
        lastError = error
      }
    }
    if (!outcome) {
      const reason = lastError instanceof Error && lastError.message ? ': ' + lastError.message : ''
      throw new Error('platform ' + platform + ' unavailable (tried: ' + enginesTried.join(', ') + ')' + reason)
    }

    const found = outcome
    this.store.bestEffort('recordSearch', () => this.store.recordSearch({
      kind: 'platform',
      query: nq,
      platform,
      engine: enginesTried.at(-1) ?? 'unknown',
      status: 'ok',
      cacheKey,
      detail: JSON.stringify({ requestedCount: boundedCount }),
    }, found.sources, 'platform-' + platform))
    return { sources: shapeSources(found.sources, boundedCount), engine: platform, enginesTried, fromCache: false, availableCount: found.sources.length }
  }

  /**
   * ctx.web provider adapter: route the seam request through this router.
   * Returns a WebSearchResult-shaped value for the built-in web_search tool.
   */
  async searchAsProvider(request: WebSearchRequest, signal?: AbortSignal): Promise<WebSearchResult> {
    const cfg = this.dynamic()
    const result = await this.search({
      query: request.query,
      count: request.maxResults ?? cfg.searchMaxResults,
      fresh: false,
      multi: cfg.parallelEngines,
      signal,
      skipSeam: true,
    })
    return {
      ...result.content ? { content: result.content } : {},
      sources: result.sources.map(s => ({ url: s.url, ...s.title ? { title: s.title } : {}, ...s.snippet ? { snippet: s.snippet } : {}, ...s.publishedAt ? { publishedAt: s.publishedAt } : {} })),
      // Cut only when the router really had more sources than it returned.
      truncated: (result.availableCount ?? result.sources.length) > result.sources.length,
    }
  }
}
