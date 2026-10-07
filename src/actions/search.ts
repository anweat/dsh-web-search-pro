/**
 * `search` group: the search run (classic list, evidence pack, or one platform) and source recommendation.
 * @module web-search-pro/actions/search
 */

import { PLATFORM_IDS, defaultProviderRegistry } from '../providers/index.ts'
import { loadCatalog } from '../catalog/load.ts'
import { recommendSources, renderRecommendation, type Recommendation } from '../catalog/recommend.ts'
import { detectDeps } from '../deps.ts'
import { browserState } from '../browser-access.ts'
import { renderEvidenceOutput } from '../pipeline/render.ts'
import { PROFILES, type Profile } from '../pipeline/types.ts'
import type { EvidenceOutput } from '../pipeline/service.ts'
import { ActionArgError, type ActionDef, type OutputNode } from './types.ts'
import { formatSources } from './format.ts'

const EVIDENCE_ITEM_SCHEMA: OutputNode = {
  type: 'object', additionalProperties: false,
  properties: {
    evidenceId: { type: 'string', required: true }, blockId: { type: 'string' }, url: { type: 'string', required: true }, title: { type: 'string' },
    excerpt: { type: 'string', required: true }, heading: { type: 'string' }, publishedAt: { type: 'string' }, lowConfidence: { type: 'boolean' },
    needIds: { type: 'array', required: true, items: { type: 'string' } }, grade: { type: 'number', required: true }, source: { type: 'string', required: true },
  },
}

/** Output schema fields added for the evidence pipeline (all optional: the classic output stays valid). */
const EVIDENCE_OUTPUT_PROPERTIES: Record<string, OutputNode> = {
  resultId: { type: 'string' },
  profile: { type: 'string' },
  profileInferred: { type: 'boolean' },
  needs: { type: 'array', items: { type: 'object', additionalProperties: false, properties: { id: { type: 'string', required: true }, text: { type: 'string', required: true }, critical: { type: 'boolean', required: true } } } },
  evidence: { type: 'array', items: EVIDENCE_ITEM_SCHEMA },
  coveredNeeds: { type: 'array', items: { type: 'string' } },
  gaps: { type: 'array', items: { type: 'object', additionalProperties: false, properties: { needId: { type: 'string', required: true }, text: { type: 'string', required: true }, critical: { type: 'boolean', required: true }, reason: { type: 'string', required: true }, bestGrade: { type: 'number' }, band: { type: 'string' } } } },
  uncertainNeeds: { type: 'array', items: { type: 'string' } },
  partial: { type: 'boolean' },
  notes: { type: 'array', items: { type: 'string' } },
  verification: { type: 'object', additionalProperties: false, properties: { native: { type: 'array', required: true, items: { type: 'string' } }, local: { type: 'array', required: true, items: { type: 'string' } } } },
  stats: {
    type: 'object', additionalProperties: false,
    properties: {
      candidates: { type: 'number' }, kept: { type: 'number' }, lowConfidence: { type: 'number' }, fetched: { type: 'number' }, blocksScored: { type: 'number' }, excerptChars: { type: 'number' }, scorer: { type: 'string' }, rounds: { type: 'number' }, queries: { type: 'number' },
      coverage: { type: 'object', additionalProperties: false, properties: {
        mode: { type: 'string' }, provider: { type: 'string' }, protocol: { type: 'string' }, model: { type: 'string' }, rubric: { type: 'string' },
        thresholds: { type: 'object', additionalProperties: false, properties: { weak: { type: 'number' }, covered: { type: 'number' } } },
        asked: { type: 'number' }, weak: { type: 'number' }, uncertain: { type: 'number' }, requests: { type: 'number' }, inputTokens: { type: 'number' }, outputTokens: { type: 'number' }, estimated: { type: 'boolean' }, unanswered: { type: 'number' },
        verdicts: { type: 'array', items: { type: 'object', additionalProperties: false, properties: { needId: { type: 'string' }, prob: { type: 'number' }, band: { type: 'string' } } } },
      } },
      jev: { type: 'object', additionalProperties: false, properties: { requests: { type: 'number' }, questions: { type: 'number' }, inputTokens: { type: 'number' }, outputTokens: { type: 'number' }, mode: { type: 'string' }, rubric: { type: 'string' }, rubricOverridden: { type: 'boolean' }, provider: { type: 'string' }, protocol: { type: 'string' }, model: { type: 'string' }, calibration: { type: 'string' }, estimated: { type: 'boolean' } } },
    },
  },
}

const RECOMMEND_PROPERTIES: Record<string, OutputNode> = {
  profile: { type: 'string', required: true }, profileInferred: { type: 'boolean' }, language: { type: 'string' },
  picks: { type: 'array', required: true, items: { type: 'object', additionalProperties: false, properties: {
    id: { type: 'string', required: true }, label: { type: 'string', required: true }, kind: { type: 'string' }, costTier: { type: 'string' }, status: { type: 'string', required: true }, executable: { type: 'boolean', required: true },
    use: { type: 'string', required: true }, why: { type: 'string' }, missing: { type: 'array', items: { type: 'string' } }, setup: { type: 'string' }, notFor: { type: 'string' }, verified: { type: 'boolean' }, sourceFamily: { type: 'string' },
  } } },
  instruction: { type: 'string', required: true },
  notes: { type: 'array', items: { type: 'string' } },
}

const EXA_FIELDS = ['exaType', 'includeDomains', 'excludeDomains', 'startPublishedDate', 'endPublishedDate', 'category'] as const
const EVIDENCE_FIELDS = ['task', 'profile', 'needs', 'constraints', 'budget'] as const

type SourceRow = { url: string; title?: string; snippet?: string; publishedAt?: string; lowConfidence?: boolean }

export const SEARCH_ACTIONS: ActionDef[] = [
  {
    name: 'search.run',
    group: 'search',
    summary: 'Search the web. With task or profile it returns an evidence pack (only the passages that answer your needs, plus gaps); otherwise a ranked source list. platform searches one platform instead.',
    notes: 'Prefer evidence mode: pass task (one sentence) and optionally profile/needs/constraints. Read gaps before concluding something is absent; coverage is heuristic. Use 1-2 sources (see search.recommend), never all.',
    params: {
      query: { type: 'string', description: 'The search query. Required, except platform=rss with url.' },
      task: { type: 'string', description: 'Evidence mode: your goal in one short sentence (not the chat); switches to an evidence pack.' },
      profile: { type: 'string', description: 'Evidence mode: docs_code, news_fact, academic, experience, compare or general; selects sources (inferred if omitted).' },
      needs: { type: 'string', description: 'Evidence mode: sub-questions separated by ";" (or a JSON array string); default the task.' },
      constraints: { type: 'string', description: 'Evidence mode: JSON array string of {"kind","value","strength"}; kind: must_term, exclude_term, entity, version, time_window, site, exclude_site, language, region, source_type; strength: hard (drop violators) or soft (default).' },
      budget: { type: 'number', description: 'Evidence mode: excerpt characters (default 6000, max 30000). fresh, multi and Exa options are ignored there.' },
      engines: { type: 'string', description: 'Comma-separated source ids, tried in order (see sources.status or search.recommend). Default: configured list.' },
      count: { type: 'number', description: 'Max results (1-20); default from settings (8 for platform).' },
      fresh: { type: 'boolean', description: 'Bypass the cache (classic and platform mode).' },
      multi: { type: 'boolean', description: 'Classic mode: query all listed engines in parallel and merge.' },
      exaType: { type: 'string', description: 'Exa mode: instant, fast, auto, deep-lite, deep, deep-reasoning.' },
      includeDomains: { type: 'string', description: 'Exa only: domain allowlist (comma-separated).' },
      excludeDomains: { type: 'string', description: 'Exa only: domain denylist (comma-separated).' },
      startPublishedDate: { type: 'string', description: 'Exa only: ISO published-date lower bound.' },
      endPublishedDate: { type: 'string', description: 'Exa only: ISO published-date upper bound.' },
      category: { type: 'string', description: 'Exa only: search category.' },
      platform: { type: 'string', description: 'Search one platform instead (' + PLATFORM_IDS.join(', ') + ', or a customPlatforms key). Each platform runs an ordered backend chain (standalone CLIs, OpenCLI, dsh-browser); logins are yours to do, see sources.status. With task/profile the platform is the evidence source; if it is unavailable that is an error (allowFallback=true searches the web engines instead).' },
      allowFallback: { type: 'boolean', description: 'Evidence mode with an explicit platform: if it is unavailable (no browser, login, CLI or token) search the web engines instead of failing; the pack says so.' },
      url: { type: 'string', description: 'platform=rss only: the feed URL.' },
      authProfile: { type: 'string', description: 'platform only: domain-scoped dsh-browser auth profile.' },
      rulePack: { type: 'string', description: 'platform only: domain-scoped dsh-browser rule pack.' },
    },
    output: {
      type: 'object', additionalProperties: false,
      properties: {
        ...EVIDENCE_OUTPUT_PROPERTIES,
        content: { type: 'string' },
        platform: { type: 'string' },
        sources: { type: 'array', required: true, items: { type: 'object', additionalProperties: false, properties: { url: { type: 'string', required: true }, title: { type: 'string' }, snippet: { type: 'string' }, publishedAt: { type: 'string' }, lowConfidence: { type: 'boolean' } } } },
        engine: { type: 'string', required: true },
        backend: { type: 'string' },
        enginesTried: { type: 'array', items: { type: 'string' } },
        fromCache: { type: 'boolean', required: true },
        fallbackNote: { type: 'string' },
      },
    },
    approval: 'none', mutating: false, concurrencySafe: true,
    // The evidence path reads pages and may score remotely: its own deadline (timeoutMs + 30 s, then a partial pack) must come before this ceiling.
    timeoutMs: config => config.timeoutMs + 60_000,
    examples: [
      { args: { query: 'node:sqlite busy timeout', task: 'how to set a busy timeout in node:sqlite', profile: 'docs_code' }, note: 'evidence pack' },
      { args: { query: '量子计算 最新进展', task: '了解量子计算的最新进展', profile: 'news_fact' }, note: 'evidence pack, Chinese' },
      { args: { query: 'rust async runtime', count: 5 }, note: 'plain source list' },
    ],
    async execute(args, ctx) {
      const cfg = ctx.dynamic()
      const registry = ctx.router.registry ?? defaultProviderRegistry
      const evidenceFields = EVIDENCE_FIELDS.filter(key => args[key] !== undefined)
      // Evidence mode: task or profile (any evidence field once a platform is named).
      const evidenceMode = Boolean(args.task || args.profile || (args.platform && evidenceFields.length))
      const runEvidence = async (query: string, extra: { engines?: string[]; platform?: { id: string; url?: string; authProfile?: string; rulePack?: string } }) => {
        const out = await ctx.evidence().search({
          query,
          ...args.task ? { task: args.task } : {},
          ...args.profile ? { profile: args.profile } : {},
          ...args.needs ? { needs: args.needs } : {},
          ...args.constraints ? { constraints: args.constraints } : {},
          ...args.budget !== undefined ? { budget: args.budget } : {},
          ...extra.engines ? { engines: extra.engines } : {},
          ...extra.platform ? { platform: extra.platform } : {},
          ...args.allowFallback !== undefined ? { allowFallback: args.allowFallback } : {},
          count: Math.min(Math.max(args.count ?? cfg.searchMaxResults, 1), 20),
          signal: ctx.signal,
        })
        const ignored = [args.fresh !== undefined && 'fresh', args.multi !== undefined && 'multi', EXA_FIELDS.some(key => args[key]) && 'exa options'].filter(Boolean)
        return { ...out, ...ignored.length ? { notes: [...out.notes, 'ignored in evidence mode: ' + ignored.join(', ')] } : {} }
      }
      if (args.allowFallback !== undefined && !evidenceMode) throw new ActionArgError('allowFallback only applies in evidence mode', 'Pass task or profile with it: it lets an unavailable platform fall back to the web engines.')
      if (args.platform) {
        const provider = registry.resolve(args.platform)
        if (provider?.descriptor.kind !== 'platform') throw new ActionArgError('unsupported platform: ' + args.platform, 'See sources.status or search.recommend for platform ids: ' + registry.platformIds().join(', '))
        if (args.engines) throw new ActionArgError('platform cannot be combined with engines', 'platform already names the source; use one of them.')
        const request = { id: args.platform, ...args.url ? { url: args.url } : {}, ...args.authProfile ? { authProfile: args.authProfile } : {}, ...args.rulePack ? { rulePack: args.rulePack } : {} }
        if (evidenceMode) {
          // The platform is the explicit source set; the pipeline gates, reads the top pages and scores as for any other source.
          const resolved = ctx.router.resolvePlatform(request, args.query ?? '')
          const query = resolved.query || args.task || ''
          if (!query) throw new ActionArgError('query is required', 'Pass query or task.')
          return runEvidence(query, { platform: { id: resolved.id, ...resolved.url ? { url: resolved.url } : {}, ...resolved.authProfile ? { authProfile: resolved.authProfile } : {}, ...resolved.rulePack ? { rulePack: resolved.rulePack } : {} } })
        }
        const result = await ctx.router.search({ query: args.query ?? '', count: args.count ?? 8, fresh: args.fresh ?? false, multi: false, signal: ctx.signal, platform: request })
        return { platform: args.platform, sources: result.sources, engine: result.engine, ...result.backend ? { backend: result.backend } : {}, ...result.enginesTried ? { enginesTried: result.enginesTried } : {}, fromCache: result.fromCache, ...result.fallbackNote ? { fallbackNote: result.fallbackNote } : {} }
      }
      for (const key of ['url', 'authProfile', 'rulePack'] as const) if (args[key] !== undefined) throw new ActionArgError(key + ' only applies together with platform')
      if (!args.query) throw new ActionArgError('query is required', 'Pass query, or platform=rss with url.')
      // Ids come from the provider registry: aliases and namespaced ids (ddg, builtin:ddg) are accepted, unknown ones list what exists.
      const engines = args.engines ? registry.validate(args.engines.split(',').map((s: string) => s.trim()).filter(Boolean)) : undefined
      if (args.task || args.profile) return runEvidence(args.query, { ...engines ? { engines } : {} })
      const hasExa = EXA_FIELDS.some(key => args[key])
      const result = await ctx.router.search({
        query: args.query,
        ...engines ? { engines } : {},
        count: args.count ?? cfg.searchMaxResults,
        fresh: args.fresh ?? false,
        multi: args.multi ?? cfg.parallelEngines,
        signal: ctx.signal,
        ...hasExa ? { exa: {
          ...args.exaType ? { type: args.exaType as 'instant' | 'fast' | 'auto' | 'deep-lite' | 'deep' | 'deep-reasoning' } : {},
          ...args.includeDomains ? { includeDomains: args.includeDomains.split(',').map((s: string) => s.trim()).filter(Boolean) } : {},
          ...args.excludeDomains ? { excludeDomains: args.excludeDomains.split(',').map((s: string) => s.trim()).filter(Boolean) } : {},
          ...args.startPublishedDate ? { startPublishedDate: args.startPublishedDate } : {},
          ...args.endPublishedDate ? { endPublishedDate: args.endPublishedDate } : {},
          ...args.category ? { category: args.category } : {},
        } } : {},
      })
      return {
        ...result.content ? { content: result.content } : {},
        sources: result.sources,
        engine: result.engine,
        enginesTried: result.enginesTried,
        fromCache: result.fromCache,
        ...result.fallbackNote ? { fallbackNote: result.fallbackNote } : {},
      }
    },
    render(value) {
      const v = value as { content?: string; platform?: string; sources: SourceRow[]; engine: string; backend?: string; enginesTried?: string[]; fromCache: boolean; fallbackNote?: string }
      if (v.platform !== undefined) return 'Platform: ' + v.platform + ' (via ' + (v.backend ?? v.engine) + (v.fromCache ? ', cached' : '') + ')\n\n' + formatSources(v.sources) + (v.fallbackNote ? '\n\n' + v.fallbackNote : '')
      const tried = v.enginesTried ?? []
      const pack = value as unknown as Partial<EvidenceOutput>
      if (pack.resultId !== undefined && pack.evidence && pack.needs && pack.coveredNeeds && pack.gaps && pack.verification) {
        return renderEvidenceOutput({ resultId: pack.resultId, profile: pack.profile ?? 'general', needs: pack.needs, evidence: pack.evidence, coveredNeeds: pack.coveredNeeds, gaps: pack.gaps, ...pack.uncertainNeeds ? { uncertainNeeds: pack.uncertainNeeds } : {}, partial: pack.partial === true, notes: pack.notes ?? [], verification: pack.verification, sources: v.sources, engine: v.engine, enginesTried: tried })
      }
      const parts: string[] = []
      if (v.content) parts.push(v.content)
      parts.push(formatSources(v.sources))
      // Surface *why* the router fell back, so the model can adapt its query.
      parts.push('Engine: ' + v.engine + (v.fromCache ? ' (cached)' : '') + (v.fallbackNote ? ' (' + v.fallbackNote + ')' : '') + (tried.length > 1 ? '; tried: ' + tried.join(', ') : ''))
      // No blanket "cite the URLs" instruction: it pushes the model to answer from titles without reading. Point at fetching when the results are thin, and give an actionable retry hint when empty.
      const withSnippet = v.sources.filter(s => s.snippet && s.snippet.trim()).length
      if (!v.sources.length) parts.push('No usable results for this query. Retry with a different phrasing, a site: filter, or the "api documentation" / "<host> API" form.')
      else if (withSnippet < v.sources.length) parts.push('These are navigation targets — several lack snippets. Fetch the most relevant 1-2 (read.fetch) before answering.')
      return parts.join('\n\n')
    },
  },
  {
    name: 'search.recommend',
    group: 'search',
    summary: 'Recommend at most 3 sources for a task: ready ones first (each with its cost tier: anonymous, free-quota, paid), then free sources to set up, paid ones last, with what is missing. Makes no search requests.',
    notes: 'Use 1-2 of the picks; never fan out to every source. Each pick says how to call it (`use`). A source the user configured stays ready and keeps its rank; settings `sources.priority` / `disabled` apply.',
    params: {
      task: { type: 'string', description: 'Your goal in one sentence.' },
      query: { type: 'string', description: 'The search query, if any.' },
      profile: { type: 'string', description: 'docs_code, news_fact, academic, experience, compare or general (inferred if omitted).' },
      language: { type: 'string', description: 'zh or en (detected from task/query if omitted).' },
      platform: { type: 'string', description: 'A platform or source id you lean towards.' },
    },
    output: { type: 'object', additionalProperties: false, properties: RECOMMEND_PROPERTIES },
    approval: 'none', mutating: false, concurrencySafe: true,
    timeoutMs: () => 20_000,
    examples: [{ args: { task: '查找 Rust 异步运行时的官方文档', profile: 'docs_code' } }],
    async execute(args, ctx) {
      const profile = args.profile?.trim()
      if (profile && !(PROFILES as readonly string[]).includes(profile)) throw new ActionArgError('profile must be one of ' + PROFILES.join(', '))
      const language = args.language?.trim().toLowerCase()
      if (language && language !== 'zh' && language !== 'en') throw new ActionArgError('language must be zh or en')
      const { router } = ctx
      const cli = await detectDeps({ config: ctx.dynamic() })
      const availability = new Map(cli.map(value => [value.id, value.available]))
      const catalog = loadCatalog()
      const cfg = ctx.dynamic() as unknown as Record<string, unknown>
      const providerIds = [...new Set(catalog.entries.flatMap(e => (e.provider ? [e.provider] : [])))]
      const providers = typeof (router as { providerStatuses?: unknown }).providerStatuses === 'function' ? await router.providerStatuses(providerIds) : new Map()
      const envNames = [...new Set(catalog.entries.flatMap(e => e.keyEnv ?? []))]
      const present = new Set<string>()
      if (typeof (router as { resolveSecret?: unknown }).resolveSecret === 'function') await Promise.all(envNames.map(async n => { if (await router.resolveSecret(n)) present.add(n) }))
      else for (const n of envNames) if (process.env[n]) present.add(n)
      const routeOf = (id: string): string => (router as { registry?: { routeId(id: string): string | undefined } }).registry?.routeId(id) ?? id
      return recommendSources({
        ...args.task?.trim() ? { task: args.task.trim() } : {}, ...args.query?.trim() ? { query: args.query.trim() } : {},
        ...profile ? { profile: profile as Profile } : {}, ...language ? { language: language as 'zh' | 'en' } : {}, ...args.platform?.trim() ? { platform: args.platform.trim() } : {},
      }, { catalog, providers, cli: availability, browser: browserState(ctx.browser()).state === 'ready', hasEnv: n => present.has(n), hasConfig: n => typeof cfg[n] === 'string' ? (cfg[n] as string).trim().length > 0 : !!cfg[n], priority: (ctx.dynamic().sources?.priority ?? []).map(routeOf), disabled: (ctx.dynamic().sources?.disabled ?? []).map(routeOf) })
    },
    render: value => renderRecommendation(value as Recommendation),
  },
]
