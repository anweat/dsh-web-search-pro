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
import { normQuery, capText } from './util.ts'
import { LruCache } from './memory-cache.ts'
import type { BrowserService } from './browser-service.ts'
import { createPlatformCacheKey, createSearchCacheKey } from './cache-key.ts'
import { BackendRegistry, type BackendDiagnostic } from './backend-registry.ts'
import { ExaClient, type ExaResult } from './exa-client.ts'

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
  private readonly backends: BackendRegistry<{ query: string; count: number; signal?: AbortSignal; skipSeam: boolean; options?: EngineSearchOptions }, SearchOutcome>

  constructor(
    private readonly ctx: Context,
    private readonly config: ResolvedConfig,
    private readonly store: Store,
    private readonly dynamic: () => ResolvedConfig = () => config,
    private readonly browser?: BrowserService,
    private readonly memory = new LruCache<RouterSearchResult>(config.memoryCacheEntries),
  ) {
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
      ...this.browser !== undefined ? { browser: this.browser } : {},
      ...cfg.platformRules !== undefined ? { platformRules: cfg.platformRules } : {},
      ...cfg.customPlatforms !== undefined ? { customPlatforms: cfg.customPlatforms } : {},
      skipSeam,
    }
  }

  /** Sync key check for available() (no credential resolution — env/literal only). */
  private depsSync(skipSeam: boolean): EngineDeps {
    const cfg = this.dynamic()
    const web = this.ctx.get('web') as WebRuntime | undefined
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
      ...this.browser !== undefined ? { browser: this.browser } : {},
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

    // 1. In-process LRU cache, then SQLite.
    if (!opts.fresh) {
      const hot = this.memory.get(memoryKey, cfg.ttlSeconds * 1000)
      if (hot) return { ...hot, fromCache: true }
      const cached = this.store.getCachedQuery('search', cacheKey, cfg.ttlSeconds)
      if (cached) {
          const rows = this.store.resultsForQuery(cached.id)
          if (rows.length) {
            let detail: { content?: string; engine?: string; enginesTried?: string[]; requestedCount?: number } | undefined
            if (cached.detail) { try { detail = JSON.parse(cached.detail) } catch { /* ignore */ } }
            if (detail?.requestedCount === undefined || detail.requestedCount >= count) {
              const result: RouterSearchResult = {
                ...detail?.content ? { content: detail.content } : {},
                sources: rows.slice(0, count).map(r => ({
                  url: r.url,
                  ...r.title ? { title: r.title } : {},
                  ...r.snippet ? { snippet: r.snippet } : {},
                  ...r.published ? { publishedAt: r.published } : {},
                })),
                engine: detail?.engine ?? ids[0] ?? 'unknown',
                enginesTried: detail?.enginesTried ?? ids,
                fromCache: true,
              }
              this.memory.set(memoryKey, result)
              return result
            }
          }
      }
    }

    // 2. Run engines.
    const enginesTried: string[] = []
    let outcome: SearchOutcome | undefined
    let usedId: string | undefined
    const signal = opts.signal

    if (multi) {
      const results = await Promise.allSettled(ids.map(async (id) => {
        const engine = await this.build(id, opts.skipSeam ?? false)
        if (!engine.available()) throw new EngineError(engine.label + ' unavailable', 'ENGINE_UNAVAILABLE', false)
        return { id, outcome: await engine.search(query, count, signal, opts.exa ? { exa: opts.exa } : undefined) }
      }))
      enginesTried.push(...ids)
      // Reciprocal Rank Fusion + freshness/authority signals (Argo-style
      // evidence credibility): each engine's rank order contributes 1/(k+rank);
      // recency and authoritative domains add a bounded bonus so a recent,
      // trustworthy source can edge out an older, lower-authority one.
      const k = Math.max(cfg.rrfConstant, 1)
      const scores = new Map<string, number>()
      const entries = new Map<string, { url: string; title?: string; snippet?: string; publishedAt?: string }>()
      const freshnessBoost = Math.min(Math.max(cfg.freshnessBoost, 0), 1)
      const authorityBoost = Math.min(Math.max(cfg.authorityBoost, 0), 1)
      const freshnessDays = Math.max(cfg.freshnessDays, 1)
      const authorityDomains = [...cfg.authorityDomains, 'github.com', 'wikipedia.org', 'arxiv.org', 'pubmed.ncbi.nlm.nih.gov', 'stackoverflow.com', 'developer.mozilla.org']
      for (const r of results) {
        if (r.status !== 'fulfilled') continue
        r.value.outcome.sources.forEach((s, rank) => {
          if (!s.url) return
          let score = scores.get(s.url) ?? 0
          score += 1 / (k + rank + 1)
          if (freshnessBoost > 0 && s.publishedAt) {
            const published = Date.parse(s.publishedAt)
            if (!Number.isNaN(published)) {
              const ageDays = (Date.now() - published) / 86400_000
              if (ageDays >= 0) score += freshnessBoost * Math.max(0, 1 - ageDays / freshnessDays)
            }
          }
          if (authorityBoost > 0) {
            let host = ''
            try { host = new URL(s.url).hostname.toLowerCase() } catch { /* ignore */ }
            const isAuthority = authorityDomains.some(d => host === d || host.endsWith('.' + d))
              || /(^|\.)(edu|gov|org)$/.test(host)
            if (isAuthority) score += authorityBoost
          }
          scores.set(s.url, score)
          if (!entries.has(s.url)) {
            entries.set(s.url, { url: s.url, ...s.title ? { title: s.title } : {}, ...s.snippet ? { snippet: s.snippet } : {}, ...s.publishedAt ? { publishedAt: s.publishedAt } : {} })
          }
        })
      }
      if (!scores.size) {
        const failures = results.map((r, index) => ids[index] + ': ' + (r.status === 'rejected' ? (r.reason instanceof Error ? r.reason.message : String(r.reason)) : 'empty')).join('; ')
        throw new Error('all engines failed: ' + failures)
      }
      const ranked = [...scores.entries()].sort((a, b) => b[1] - a[1]).slice(0, count)
      outcome = { sources: ranked.map(([url]) => entries.get(url)!) }
      usedId = 'multi(' + ids.join('+') + ')'
    } else {
      try {
        const selected = await this.backends.runSelected(
          { query, count, signal, skipSeam: opts.skipSeam ?? false, ...opts.exa ? { options: { exa: opts.exa } } : {} },
          { preferred: ids },
        )
        outcome = selected.value
        usedId = selected.id
        enginesTried.push(...ids.slice(0, Math.max(ids.indexOf(selected.id) + 1, 1)))
      } catch (error) {
        if (signal?.aborted) throw error
        enginesTried.push(...ids)
        throw error
      }
    }

    // 3. Persist.
    const queryId = this.store.recordQuery({
      kind: 'search',
      query: nq,
      engine: usedId,
      status: 'ok',
      cacheKey,
      detail: JSON.stringify({ ...outcome.content ? { content: outcome.content } : {}, engine: usedId, enginesTried, requestedCount: count }),
    })
    this.store.recordResults(queryId, outcome.sources, usedId)

    const result: RouterSearchResult = {
      ...outcome.content ? { content: outcome.content } : {},
      sources: outcome.sources.slice(0, count).map(s => ({
        url: s.url,
        ...s.title ? { title: s.title } : {},
        ...s.snippet ? { snippet: capText(s.snippet, 500) } : {},
        ...s.publishedAt ? { publishedAt: s.publishedAt } : {},
      })),
      engine: usedId,
      enginesTried,
      fromCache: false,
    }
    // 4. Warm the in-process LRU (memory-only; survives across SQLite hits).
    this.memory.set(memoryKey, result)
    return result
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
    const nq = normQuery(effectiveQuery || feedUrl || platform)
    const boundedCount = Math.min(Math.max(count, 1), 20)
    const binding = this.dynamic().browserBindings?.[platform]
    const authProfile = opts.authProfile ?? binding?.authProfile
    const rulePack = opts.rulePack ?? binding?.rulePack
    const cacheKey = createPlatformCacheKey({ platform, query: effectiveQuery || feedUrl || platform, ...feedUrl ? { url: feedUrl } : {}, count: boundedCount, ...authProfile ? { authProfile } : {}, ...rulePack ? { rulePack } : {} })
    const custom = this.dynamic().customPlatforms?.[platform]
    // Async deps (not depsSync): platform engines may need credentials-resolved
    // keys (e.g. githubToken from the credentials service), which the sync path
    // cannot reach. platformSearch is async, so awaiting is free.
    const deps = await this.deps(true)
    const engines = custom
      ? [customPlatformEngine(platform, custom, deps)]
      : (platform === 'rss' && feedUrl ? [rssEngine(feedUrl, deps.allowProxyFakeIp)] : platformEngines(platform, deps))
    if (!engines.length) throw new Error('unsupported platform: ' + platform)

    if (!opts.fresh) {
      const cached = this.store.getCachedQuery('platform', cacheKey, this.dynamic().ttlSeconds)
      if (cached) {
        const rows = this.store.resultsForQuery(cached.id)
        let detail: { requestedCount?: number } | undefined
        if (cached.detail) { try { detail = JSON.parse(cached.detail) } catch { /* ignore */ } }
        if (rows.length && (detail?.requestedCount === undefined || detail.requestedCount >= boundedCount)) {
          return {
            sources: rows.slice(0, boundedCount).map(r => ({ url: r.url, ...r.title ? { title: r.title } : {}, ...r.snippet ? { snippet: r.snippet } : {}, ...r.published ? { publishedAt: r.published } : {} })),
            engine: platform,
            enginesTried: [platform],
            fromCache: true,
          }
        }
      }
    }

    const enginesTried: string[] = []
    let outcome: SearchOutcome | undefined
    let lastError: unknown
    for (const engine of engines) {
      enginesTried.push(engine.id)
      if (!engine.available()) continue
      try {
        outcome = await engine.search(platform === 'rss' ? effectiveQuery : effectiveQuery || 'latest', boundedCount, opts.signal, authProfile || rulePack ? { browser: { ...authProfile ? { authProfile } : {}, ...rulePack ? { rulePack } : {} } } : undefined)
        break
      } catch (error) {
        if (opts.signal?.aborted) throw error
        lastError = error
      }
    }
    if (!outcome) {
      const reason = lastError instanceof Error && lastError.message ? ': ' + lastError.message : ''
      throw new Error('platform ' + platform + ' unavailable (tried: ' + enginesTried.join(', ') + ')' + reason)
    }

    const queryId = this.store.recordQuery({
      kind: 'platform',
      query: nq,
      platform,
      engine: enginesTried.at(-1) ?? 'unknown',
      status: 'ok',
      cacheKey,
      detail: JSON.stringify({ requestedCount: boundedCount }),
    })
    this.store.recordResults(queryId, outcome.sources, 'platform-' + platform)
    return { sources: outcome.sources, engine: platform, enginesTried, fromCache: false }
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
      truncated: result.sources.length > (request.maxResults ?? cfg.searchMaxResults),
    }
  }
}

