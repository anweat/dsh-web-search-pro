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
  rssEngine, customPlatformEngine, EngineError, type Engine, type EngineDeps, type SearchOutcome,
} from './engines.ts'
import { normQuery, capText } from './util.ts'
import { LruCache } from './memory-cache.ts'
import type { BrowserService } from './browser-service.ts'

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
  ddg: () => ddgEngine(),
  bing: () => bingEngine(),
  jina: (deps) => jinaSearchEngine(deps),
  github: (deps) => githubEngine(deps),
  bilibili: (deps) => bilibiliEngine(deps),
  v2ex: () => v2exEngine(),
  youtube: (deps) => youtubeEngine(deps),
  arxiv: () => arxivEngine(),
  pubmed: () => pubmedEngine(),
}

export class SearchRouter {
  constructor(
    private readonly ctx: Context,
    private readonly config: ResolvedConfig,
    private readonly store: Store,
    private readonly dynamic: () => ResolvedConfig = () => config,
    private readonly browser?: BrowserService,
    private readonly memory = new LruCache<RouterSearchResult>(config.memoryCacheEntries),
  ) {}

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

    // 1. In-process LRU cache, then SQLite.
    if (!opts.fresh) {
      for (const id of ids) {
        const hot = this.memory.get(id + '|' + nq, cfg.ttlSeconds * 1000)
        if (hot) return { ...hot, fromCache: true, enginesTried: [id] }
      }
      for (const id of ids) {
        const cached = this.store.getCachedSearch(id, nq, cfg.ttlSeconds)
        if (cached) {
          const rows = this.store.resultsForQuery(cached.id)
          if (rows.length) {
            let detail: { content?: string } | undefined
            if (cached.detail) { try { detail = JSON.parse(cached.detail) } catch { /* ignore */ } }
            return {
              ...detail?.content ? { content: detail.content } : {},
              sources: rows.map(r => ({
                url: r.url,
                ...r.title ? { title: r.title } : {},
                ...r.snippet ? { snippet: r.snippet } : {},
                ...r.published ? { publishedAt: r.published } : {},
              })),
              engine: id,
              enginesTried: [id],
              fromCache: true,
            }
          }
        }
      }
    }

    // 2. Run engines.
    const enginesTried: string[] = []
    let outcome: SearchOutcome | undefined
    let usedId: string | undefined
    const signal = opts.signal

    if (opts.multi) {
      const results = await Promise.allSettled(ids.map(async (id) => {
        const engine = await this.build(id, opts.skipSeam ?? false)
        if (!engine.available()) throw new EngineError(engine.label + ' unavailable', 'ENGINE_UNAVAILABLE', false)
        return { id, outcome: await engine.search(query, count, signal) }
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
      if (!scores.size) throw new Error('all engines failed: ' + enginesTried.join(', '))
      const ranked = [...scores.entries()].sort((a, b) => b[1] - a[1]).slice(0, count)
      outcome = { sources: ranked.map(([url]) => entries.get(url)!) }
      usedId = 'multi(' + ids.join('+') + ')'
    } else {
      for (const id of ids) {
        enginesTried.push(id)
        const engine = await this.build(id, opts.skipSeam ?? false)
        if (!engine.available()) continue
        try {
          outcome = await engine.search(query, count, signal)
          usedId = id
          break
        } catch (error) {
          if (signal?.aborted) throw error
          // keep trying the next engine on failure
        }
      }
      if (!outcome || !usedId) {
        throw new Error('no engine produced results (tried: ' + enginesTried.join(', ') + ')')
      }
    }

    // 3. Persist.
    const queryId = this.store.recordQuery({
      kind: 'search',
      query: nq,
      engine: usedId,
      status: 'ok',
      ...outcome.content ? { detail: JSON.stringify({ content: outcome.content }) } : {},
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
    this.memory.set(usedId + '|' + nq, result)
    return result
  }

  /** Platform search (web_platform_search tool) with the same cache+persist flow. */
  async platformSearch(
    platform: string,
    query: string,
    url: string | undefined,
    count: number,
    opts: { signal?: AbortSignal; fresh?: boolean },
  ): Promise<RouterSearchResult> {
    const nq = normQuery(query || url || platform)
    const custom = this.dynamic().customPlatforms?.[platform]
    // Async deps (not depsSync): platform engines may need credentials-resolved
    // keys (e.g. githubToken from the credentials service), which the sync path
    // cannot reach. platformSearch is async, so awaiting is free.
    const deps = await this.deps(true)
    const engines = custom
      ? [customPlatformEngine(platform, custom, deps)]
      : (platform === 'rss' && url ? [rssEngine(url)] : platformEngines(platform, deps))
    if (!engines.length) throw new Error('unsupported platform: ' + platform)

    if (!opts.fresh) {
      const cached = this.store.getCachedSearch('platform-' + platform, nq, this.dynamic().ttlSeconds)
      if (cached) {
        const rows = this.store.resultsForQuery(cached.id)
        if (rows.length) {
          return {
            sources: rows.map(r => ({ url: r.url, ...r.title ? { title: r.title } : {}, ...r.snippet ? { snippet: r.snippet } : {} })),
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
        outcome = await engine.search(query || 'latest', Math.min(Math.max(count, 1), 20), opts.signal)
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

