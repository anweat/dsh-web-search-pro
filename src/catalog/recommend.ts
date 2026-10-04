/**
 * Source recommendations (dev-plan M7): from a task / profile / language (and an optional platform hint) pick
 * AT MOST three sources so the model does not fan out to every source. Ready sources come first (registry
 * providers by their readiness; platforms by what a local scan found), then sources that are only in the
 * catalog, each with what is missing and how to set it up. A catalog-only or not-ready entry is never
 * `executable`: the catalog explains, only the registry runs. Pure: readiness comes in through the context.
 * @module web-search-pro/catalog/recommend
 */

import { inferProfile, taskLanguage, type ProviderStatus } from '../pipeline/plan.ts'
import { PROFILES, type Profile } from '../pipeline/types.ts'
import type { CatalogEntry, CostTier, SourceCatalog } from './schema.ts'

/** Most suggestions one call returns. */
export const MAX_RECOMMENDATIONS = 3

/** Shown with every recommendation: the point of the feature is to NOT query everything. */
export const RECOMMEND_INSTRUCTION = 'Use 1-2 of these; do not call all sources in parallel, and add another only if the evidence is insufficient. Sources that are not executable need setup first: tell the user what is missing instead of calling them.'

export interface RecommendInput {
  /** The goal in one sentence (also used to detect language and profile). */
  task?: string
  query?: string
  profile?: Profile
  language?: 'zh' | 'en'
  /** A platform or source id the caller already leans towards (`xiaohongshu`, `reddit`). */
  platform?: string
}

export interface RecommendContext {
  catalog: SourceCatalog
  /** Registry readiness by provider ROUTE id; absent = no such adapter is registered. */
  providers: ReadonlyMap<string, ProviderStatus>
  /** Local CLI scan (`sources.deps` ids); absent = not scanned. */
  cli?: ReadonlyMap<string, boolean>
  /** The dsh-browser plugin is ready. */
  browser?: boolean
  /** Whether an environment variable / credential of that name is configured (never read out). */
  hasEnv?: (name: string) => boolean
  /** Whether a plugin setting is set (`searxngUrl`). */
  hasConfig?: (name: string) => boolean
  /** The user's `sources.priority`: ready sources named here lead, in this order (entry id, provider or platform id). */
  priority?: readonly string[]
  /** The user's `sources.disabled`: never recommended. */
  disabled?: readonly string[]
  limit?: number
}

export type SuggestionStatus = 'ready' | 'limited' | 'needs_setup' | 'catalog_only'

export interface Suggestion {
  id: string
  label: string
  kind: CatalogEntry['kind']
  /** `anonymous` / `free-quota` / `paid` (the route that would run: Exa without a key is `anonymous`). */
  costTier: CostTier
  status: SuggestionStatus
  /** True only for `ready` and `limited`: something this plugin can run right now. */
  executable: boolean
  /** The call that runs it (or why it cannot be called yet). */
  use: string
  why: string
  /** What is missing (not executable, or `limited`). */
  missing?: string[]
  /** Short setup text; only when something is missing. */
  setup?: string
  /** First counter-example of the entry. */
  notFor?: string
  verified: boolean
  sourceFamily?: string
}

export interface Recommendation {
  profile: Profile
  profileInferred: boolean
  language?: 'zh' | 'en'
  picks: Suggestion[]
  instruction: string
  notes: string[]
}

interface Assessed {
  entry: CatalogEntry
  costTier: CostTier
  status: SuggestionStatus
  missing: string[]
  use: string
}

const hasEnvAny = (ctx: RecommendContext, names: readonly string[] | undefined): boolean => !!names?.some(n => ctx.hasEnv?.(n))

/** Everything an entry needs that the context does not show as present (without the adapter question). */
function missingOf(entry: CatalogEntry, ctx: RecommendContext): string[] {
  const out: string[] = []
  const r = entry.requires
  if (entry.auth === 'key' && !hasEnvAny(ctx, entry.keyEnv)) out.push('key: set ' + (entry.keyEnv ?? []).join(' or '))
  // Login-type sources that read credentials from the environment (twitter) need all of them.
  if (entry.auth === 'login' && entry.keyEnv?.length) {
    const absent = entry.keyEnv.filter(n => !ctx.hasEnv?.(n))
    if (absent.length) out.push('credentials: set ' + absent.join(', '))
  }
  if (r?.cli && ctx.cli?.get(r.cli) !== true) out.push('cli: ' + r.cli + (ctx.cli?.get(r.cli) === false ? ' not found' : ' (not scanned)'))
  if (r?.browser && !ctx.browser) out.push('dsh-browser plugin')
  if (r?.config && !ctx.hasConfig?.(r.config)) out.push('setting: ' + r.config)
  return out
}

function assess(entry: CatalogEntry, ctx: RecommendContext): Assessed {
  const a = assessReadiness(entry, ctx)
  return { ...a, costTier: ctx.providers.get(entry.provider ?? '')?.costTier ?? entry.costTier }
}

function assessReadiness(entry: CatalogEntry, ctx: RecommendContext): Omit<Assessed, 'costTier'> {
  if (entry.provider) {
    const st = ctx.providers.get(entry.provider)
    if (st) {
      const use = entry.platform ? 'search.run platform=' + entry.platform : 'search.run engines=' + entry.provider
      if (st.state === 'ready') {
        const missing = st.credential === 'missing' && !st.keyless ? missingOf(entry, ctx).filter(m => m.startsWith('key')) : []
        // A login session cannot be checked from here: runnable, but not confirmed.
        if (!missing.length && entry.auth === 'login' && st.credential !== 'configured') missing.push('logged-in session (not checked)')
        return { entry, status: missing.length ? 'limited' : 'ready', missing, use }
      }
      const detail = st.state === 'cooldown' ? 'cooling down' + (st.reason ? ': ' + st.reason : '') : undefined
      const missing = missingOf(entry, ctx)
      if (detail) missing.unshift(detail)
      else if (!missing.length && st.reason) missing.push(st.reason)
      return { entry, status: 'needs_setup', missing, use }
    }
    return { entry, status: 'catalog_only', missing: ['adapter not registered in this plugin', ...missingOf(entry, ctx)], use: 'no adapter registered' }
  }
  if (entry.platform) {
    const use = 'search.run platform=' + entry.platform
    const missing = missingOf(entry, ctx)
    if (missing.length) return { entry, status: 'needs_setup', missing, use }
    // Login sessions cannot be checked from here: runnable, but not confirmed.
    return entry.auth === 'login' ? { entry, status: 'limited', missing: ['logged-in session (not checked)'], use } : { entry, status: 'ready', missing: [], use }
  }
  return { entry, status: 'catalog_only', missing: [...(entry.invoke ? [] : ['adapter not implemented in this plugin']), ...missingOf(entry, ctx), ...entry.auth === 'login' && !entry.requires?.browser ? ['logged-in session'] : []], use: entry.invoke ?? 'no adapter yet' }
}

const TIER: Record<SuggestionStatus, number> = { ready: 0, limited: 1, needs_setup: 2, catalog_only: 3 }
/** Among sources the user has NOT set up, the free ones are offered first and the paid ones last (a configured source is the user's own choice and keeps its fit order). */
const COST_ORDER: Record<CostTier, number> = { anonymous: 0, 'free-quota': 1, paid: 2 }
const setupCost = (a: Assessed): number => (a.status === 'needs_setup' || a.status === 'catalog_only' ? COST_ORDER[a.costTier] : 0)
const isWeb = (e: CatalogEntry): boolean => !!e.resultKinds?.includes('web')
/** Result kinds whose content belongs to a language community (the planner orders such a source in another language last, too). */
const LANGUAGE_BOUND_KINDS: readonly string[] = ['forum', 'qa', 'video', 'social']
const languageMismatch = (e: CatalogEntry, language: 'zh' | 'en' | undefined): boolean =>
  !!language && !!e.resultKinds?.length && e.resultKinds.every(k => LANGUAGE_BOUND_KINDS.includes(k)) && !e.languages.includes('*') && !e.languages.includes(language)

/** Higher = better fit; only compares entries of the same readiness tier. */
function score(e: CatalogEntry, profile: Profile, language: 'zh' | 'en' | undefined): number {
  let s = 0
  if (language) s += e.languages.includes(language) ? 30 : e.languages.includes('*') ? 10 : -25
  if (e.profiles.length <= 2 && !isWeb(e)) s += 10 // a specialist index beats a generalist for its own profile
  if (e.profiles[0] === profile) s += 3
  s += (50 - (e.rank ?? 50)) / 2
  return s
}

function toSuggestion(a: Assessed): Suggestion {
  const e = a.entry
  const executable = a.status === 'ready' || a.status === 'limited'
  return {
    id: e.id, label: e.label, kind: e.kind, costTier: a.costTier, status: a.status, executable, use: a.use,
    why: e.recommendedFor[0] ?? e.label,
    ...a.missing.length ? { missing: a.missing, setup: e.install } : {},
    ...e.notFor[0] ? { notFor: e.notFor[0] } : {},
    verified: e.verification.status === 'verified',
    ...e.sourceFamily ? { sourceFamily: e.sourceFamily } : {},
  }
}

export function recommendSources(input: RecommendInput, ctx: RecommendContext): Recommendation {
  const limit = Math.min(Math.max(ctx.limit ?? MAX_RECOMMENDATIONS, 1), MAX_RECOMMENDATIONS)
  const text = [input.task, input.query].filter(Boolean).join(' ').trim()
  const notes: string[] = []
  const profileInferred = !(input.profile && PROFILES.includes(input.profile))
  const profile: Profile = !profileInferred ? input.profile! : text ? inferProfile(text) : 'general'
  const language = input.language ?? (text ? taskLanguage({ goal: input.task ?? '', query: input.query ?? '' }) : undefined)

  const named = (e: CatalogEntry): string[] => [e.id, ...e.provider ? [e.provider] : [], ...e.platform ? [e.platform] : []]
  const disabled = new Set(ctx.disabled ?? [])
  let pool = ctx.catalog.entries.filter(e => !named(e).some(id => disabled.has(id)))
  const hint = input.platform?.trim().toLowerCase()
  let hinted = false
  if (hint) {
    const matched = pool.filter(e => e.id === hint || e.platform === hint || e.provider === hint || e.id === 'opencli-' + hint)
    if (matched.length) { pool = matched; hinted = true } else notes.push('no catalog entry for "' + input.platform + '": recommended by profile instead')
  }
  // The user's own say, for sources that can run now (the same precedence as the automatic plan): the listed ones first, in the
  // listed order, then sources whose key the user configured, then the rest by fit.
  const order = ctx.priority ?? []
  const prio = (a: Assessed): number => {
    if (a.status !== 'ready' && a.status !== 'limited') return Infinity
    const listed = Math.min(...named(a.entry).map(id => (order.indexOf(id) < 0 ? Infinity : order.indexOf(id))))
    if (listed !== Infinity) return listed
    return a.entry.auth === 'key' && ctx.providers.get(a.entry.provider ?? '')?.credential === 'configured' ? 1_000 : 2_000
  }
  const candidates: Assessed[] = pool
    .filter(e => hinted || e.operations.includes('search'))
    .filter(e => hinted || e.profiles.includes(profile))
    // A general web engine in the wrong language is noise; a paper / code index in another language still works.
    .filter(e => hinted || !language || !isWeb(e) || e.languages.includes(language) || e.languages.includes('*'))
    .map(e => assess(e, ctx))
    .sort((a, b) => Number(languageMismatch(a.entry, language)) - Number(languageMismatch(b.entry, language)) || TIER[a.status] - TIER[b.status] || prio(a) - prio(b) || setupCost(a) - setupCost(b) || score(b.entry, profile, language) - score(a.entry, profile, language) || a.entry.id.localeCompare(b.entry.id))

  // A general web engine that can run now leads (reference and vertical sources supplement it, they do not replace it) —
  // except for academic tasks, where the paper indexes are the primary sources.
  const lead = profile === 'academic' ? -1 : candidates.findIndex(a => isWeb(a.entry) && (a.status === 'ready' || a.status === 'limited'))
  if (lead > 0) candidates.unshift(...candidates.splice(lead, 1))

  // Greedy pick: one source per upstream family; at most one general web engine that runs now and one that needs setup
  // (the language specialist as an upgrade path). The web limit is relaxed only to fill the slots.
  const picks: Assessed[] = []
  const runnable = (a: Assessed): boolean => a.status === 'ready' || a.status === 'limited'
  const take = (strict: boolean): void => {
    for (const a of candidates) {
      if (picks.length >= limit) return
      if (picks.includes(a)) continue
      const family = a.entry.sourceFamily
      if (family && picks.some(p => p.entry.sourceFamily === family)) continue
      if (strict && isWeb(a.entry) && picks.some(p => isWeb(p.entry) && runnable(p) === runnable(a))) continue
      picks.push(a)
    }
  }
  take(true)
  take(false)
  if (!picks.length) notes.push('no catalog source fits profile ' + profile + (language ? '/' + language : ''))
  else if (!picks.some(p => p.status === 'ready' || p.status === 'limited')) notes.push('nothing suitable is ready: set up one of the sources above or use search.run without engines')
  return { profile, profileInferred, ...language ? { language } : {}, picks: picks.map(toSuggestion), instruction: RECOMMEND_INSTRUCTION, notes }
}

/** Plain text of a recommendation (the tool's render). */
export function renderRecommendation(r: Recommendation): string {
  const lines = ['Recommended sources for profile ' + r.profile + (r.profileInferred ? ' (inferred)' : '') + (r.language ? ', language ' + r.language : '') + ':']
  r.picks.forEach((p, i) => {
    lines.push((i + 1) + '. ' + p.label + ' [' + p.id + '] ' + p.status + ', ' + p.costTier + (p.verified ? '' : ', unverified') + ' — ' + p.why)
    lines.push('   use: ' + p.use + (p.missing?.length ? ' | missing: ' + p.missing.join('; ') : '') + (p.setup && p.missing?.length ? ' | setup: ' + p.setup : ''))
    if (p.notFor) lines.push('   not for: ' + p.notFor)
  })
  lines.push(...r.notes.map(n => 'note: ' + n))
  lines.push(r.instruction)
  return lines.join('\n')
}
