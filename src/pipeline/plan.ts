/**
 * S1 source planning (dev-plan §4.3): profile -> provider table, explicit
 * `engines` first, availability / cooldown filtering, one compiled query per
 * provider. Pure: availability comes in through a callback so the router
 * registry (or a test double) supplies it.
 * @module web-search-pro/pipeline/plan
 */

import { compileQuery, type CompiledQuery } from './compile.ts'
import { detectLang } from './align.ts'
import { routeIdOf, type CredentialState, type ProviderDescriptor } from '../providers/registry.ts'
import type { Profile, TaskSpec } from './types.ts'

/** Provider ids per profile (`general` uses the configured `engines`). */
export const PROFILE_PROVIDERS: Readonly<Record<Exclude<Profile, 'general'>, readonly string[]>> = {
  docs_code: ['ddg', 'bing', 'github'],
  academic: ['arxiv', 'pubmed', 'ddg'],
  experience: ['ddg', 'bing', 'v2ex'],
  news_fact: ['ddg', 'bing'],
  compare: ['ddg', 'bing', 'github'],
}

/** Default cap on providers of one plan (general profile with a long engine list). */
export const DEFAULT_MAX_PROVIDERS = 4

export type ProviderState = 'ready' | 'unavailable' | 'cooldown'
export interface ProviderStatus {
  state: ProviderState
  reason?: string
  /** Local credential dimension from the registry probe; `missing` keeps a provider out of automatic promotion (it still runs when asked for). */
  credential?: CredentialState
}

export interface PlannedProvider { id: string; compiled: CompiledQuery }

export interface SourcePlan {
  profile: Profile
  /** The profile came from rule inference, not from the caller. */
  profileInferred: boolean
  providers: PlannedProvider[]
  /** Task language the plan was made for (`zh`, `en`); absent when the text has no letters. */
  language?: 'zh' | 'en'
  /** The ordered provider ids the plan drew from before availability filtering and caps (the follow-up round reuses it). */
  wanted: string[]
  /** Providers dropped by the availability filter, with the reason. */
  skipped: { id: string; reason: string }[]
  notes: string[]
}

export interface PlanOptions {
  /** Explicit engine ids (tool `engines` param): override the profile table. */
  engines?: readonly string[]
  /** Configured engine list, used by the general profile. */
  configured: readonly string[]
  /** Availability lookup; undefined = the registry does not know the id. Omitted = everything is ready. */
  status?: (id: string) => ProviderStatus | undefined
  maxProviders?: number
  now?: Date
  /**
   * Registry descriptors (search providers). With them S1 is language-aware: a provider that is strong in the
   * task's language (`languages` names `zh` / `en`), serves the profile (`taskProfiles`), returns `web` results and is
   * ready with a configured key is PROMOTED ahead of the profile table (by `priority`), and the other web engines
   * behind it shrink to `webFallbacks` (vertical sources such as GitHub or arXiv are untouched). Nothing names a provider: a new adapter's descriptor is enough.
   */
  descriptors?: readonly ProviderDescriptor[]
  /** false = no promotion (the profile table / configured engines as they are). Default true. */
  autoProviders?: boolean
  /** Other web engines kept behind promoted providers, in table order (default 1). */
  webFallbacks?: number
  /** Per-provider compilation; defaults to the core compiler (adapters may supply their own). */
  compiler?: (task: TaskSpec, providerId: string, now: Date) => CompiledQuery
}

export const DEFAULT_WEB_FALLBACKS = 1

const PROMOTABLE_CREDENTIALS: readonly (CredentialState | undefined)[] = [undefined, 'configured', 'not_required']

/** `zh` / `en` from the task text (goal + query); undefined when there is no letter to tell. */
export function taskLanguage(task: Pick<TaskSpec, 'goal' | 'query'>): 'zh' | 'en' | undefined {
  const lang = detectLang(task.goal + ' ' + task.query)
  return lang === 'zh' ? 'zh' : lang === 'latin' ? 'en' : undefined
}

// ── profile inference (rule fallback; the calling model's `profile` wins) ───

const PROFILE_KEYWORDS: Record<Exclude<Profile, 'general'>, RegExp> = {
  docs_code: /(文档|api|用法|版本|报错|安装|配置|示例|源码|sdk|cli|函数|参数|接口|升级|迁移|docs?|install|config|error|exception|version|syntax|usage|example)/gi,
  news_fact: /(新闻|最新|发布|公告|据报道|是否属实|官方回应|事件|声明|宣布|news|announce|released?|reported|latest|did |是否)/gi,
  academic: /(论文|arxiv|综述|研究|方法|实验|基准|模型|算法|paper|survey|study|benchmark|theorem|dataset|citation)/gi,
  experience: /(体验|踩坑|口碑|推荐|经验|评测|值得|好用|吐槽|心得|怎么样|review|experience|worth|recommend|reddit|v2ex|小红书)/gi,
  compare: /(对比|区别|比较|选型|哪个好|哪个更|vs\.?|versus|difference|compare|comparison|alternatives?|优缺点)/gi,
}

/** Keyword hit counts per profile (general has no keywords). */
export function profileHits(text: string): Record<Exclude<Profile, 'general'>, number> {
  const out = {} as Record<Exclude<Profile, 'general'>, number>
  for (const [profile, re] of Object.entries(PROFILE_KEYWORDS)) out[profile as Exclude<Profile, 'general'>] = (text.match(re) ?? []).length
  return out
}

/** Softmax over keyword hits with a fixed prior for `general` (the r1 bench rule judge's choice scores). */
export function profileScores(text: string): Record<string, number> {
  const raw: Record<string, number> = { general: 0.6, ...profileHits(text) }
  const exp = Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, Math.exp(v)]))
  const sum = Object.values(exp).reduce((a, b) => a + b, 0)
  return Object.fromEntries(Object.entries(exp).map(([k, v]) => [k, v / sum]))
}

/** Conservative rule inference: the profile with strictly the most keyword hits, else general (r1: 60% accurate, hence only a fallback). */
export function inferProfile(text: string): Profile {
  const hits = Object.entries(profileHits(text)).sort((a, b) => b[1] - a[1])
  const [best, second] = hits
  if (!best || best[1] === 0 || (second && second[1] === best[1])) return 'general'
  return best[0] as Profile
}

// ── the plan ────────────────────────────────────────────────────────────────

export function planSources(task: TaskSpec, options: PlanOptions): SourcePlan {
  const notes: string[] = []
  const profileInferred = task.profile === undefined
  const profile = task.profile ?? inferProfile(task.goal + ' ' + task.query)
  const explicit = Boolean(options.engines?.length)
  const language = taskLanguage(task)
  const base: readonly string[] = options.engines?.length
    ? options.engines
    : profile === 'general' ? options.configured : PROFILE_PROVIDERS[profile]
  const descriptors = new Map((options.descriptors ?? []).map(d => [routeIdOf(d), d] as const))
  const isReady = (id: string): ProviderStatus | undefined => {
    const status = options.status ? options.status(id) : { state: 'ready' as const }
    return status && status.state === 'ready' ? status : undefined
  }

  // Promotion: specialists for the task's language, then the table with its language-agnostic web engines trimmed.
  let planList = [...base]
  const held: string[] = []
  const promoted: string[] = []
  if (!explicit && language && options.autoProviders !== false && descriptors.size) {
    const candidates = [...descriptors.values()]
      .filter(d => d.operations.includes('search') && d.resultKinds.includes('web') && d.languages.includes(language) && d.taskProfiles.includes(profile))
      .sort((a, b) => (a.priority ?? 100) - (b.priority ?? 100))
    for (const d of candidates) {
      const status = isReady(routeIdOf(d))
      if (status && PROMOTABLE_CREDENTIALS.includes(status.credential)) promoted.push(routeIdOf(d))
    }
    if (promoted.length) {
      // Web engines that were not promoted (language-agnostic ones, or strong in another language) are the fallbacks; vertical sources stay.
      const generic = (id: string): boolean => !!descriptors.get(id)?.resultKinds.includes('web')
      const keep = Math.max(options.webFallbacks ?? DEFAULT_WEB_FALLBACKS, 0)
      let kept = 0
      const rest = base.filter(id => {
        if (promoted.includes(id)) return false
        if (!generic(id) || !isReady(id)) return true // an engine that is not ready is skipped later with its reason and takes no fallback slot
        if (kept < keep) { kept++; return true }
        held.push(id)
        return false
      })
      planList = [...promoted, ...rest]
      notes.push('language ' + language + ': preferred ' + promoted.join(', ') + (held.length ? '; fallback web engines limited to ' + rest.filter(id => generic(id) && isReady(id)).join(', ') + ' (held for a second round: ' + held.join(', ') + ')' : ''))
      // A hard filter a promoted provider cannot enforce is checked locally, never silently dropped.
      const hardKinds = [...new Set(task.constraints.filter(c => c.strength === 'hard').map(c => c.kind))]
      for (const id of promoted) {
        const unsupported = hardKinds.filter(k => !descriptors.get(id)!.supportedFilters.includes(k) && ['site', 'exclude_site', 'exclude_term', 'time_window'].includes(k))
        if (unsupported.length) notes.push(id + ' does not enforce hard ' + unsupported.join(', ') + ' natively: verified locally')
      }
    }
  }

  const max = Math.max(options.maxProviders ?? DEFAULT_MAX_PROVIDERS, 1)
  const compile = options.compiler ?? compileQuery
  const providers: PlannedProvider[] = []
  const skipped: { id: string; reason: string }[] = []
  const seen = new Set<string>()
  const now = options.now ?? new Date()
  for (const id of planList) {
    if (seen.has(id)) continue
    seen.add(id)
    const status = options.status ? options.status(id) : { state: 'ready' as const }
    if (!status) { skipped.push({ id, reason: 'unknown provider' }); continue }
    if (status.state !== 'ready') { skipped.push({ id, reason: status.state + (status.reason ? ' (' + status.reason + ')' : '') }); continue }
    if (providers.length >= max && !explicit) { skipped.push({ id, reason: 'provider cap ' + max }); continue }
    providers.push({ id, compiled: compile(task, id, now) })
  }
  if (profileInferred) notes.push('profile inferred by rule: ' + profile)
  if (skipped.length) notes.push('skipped providers: ' + skipped.map(s => s.id + ' [' + s.reason + ']').join(', '))
  if (!providers.length) notes.push('no usable provider for profile ' + profile + (explicit ? ' (explicit engines)' : ''))
  return { profile, profileInferred, providers, ...language ? { language } : {}, wanted: [...new Set([...planList, ...held])], skipped, notes }
}
