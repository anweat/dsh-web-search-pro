/**
 * Query compilation (dev-plan §4.1 step 2): turn a TaskSpec into one query per
 * provider, pushing constraints to the provider natively where it can enforce
 * them and reporting which constraints are left for local verification.
 *
 *  - ddg / bing: `site:`, `-site:` and `-term` operators for HARD site /
 *    exclude_site / exclude_term constraints (the first hard `site` only: two
 *    `site:` operators are ANDed into nothing);
 *  - exa: includeDomains / excludeDomains / startPublishedDate options for HARD
 *    site / exclude_site / time_window (Exa omits undated pages when a date
 *    bound is set, hence hard only);
 *  - github*: the natural-language query returns nothing on repository search
 *    (E1: 0 of 20), so it is replaced by a short keyword query;
 *  - everything else: the plain query.
 * Soft constraints are never pushed down (a preference must not shrink recall);
 * they are verified locally like every constraint the provider cannot express.
 * The gate re-checks rule-checkable constraints on every candidate regardless,
 * so a provider silently ignoring an operator costs nothing but precision.
 * @module web-search-pro/pipeline/compile
 */

import { domainOf } from './gate.ts'
import { LATIN_STOP } from './lexical.ts'
import type { Constraint, TaskSpec } from './types.ts'

export interface CompiledExaOptions {
  includeDomains?: string[]
  excludeDomains?: string[]
  startPublishedDate?: string
}

export interface CompiledQuery {
  providerId: string
  /** Text to send to the provider. */
  query: string
  /** Provider-native options, shaped like `EngineSearchOptions` (only Exa has any today). */
  options?: { exa: CompiledExaOptions }
  /** Broader variants to try, in order, when the provider answers ENGINE_EMPTY for `query` (GitHub: fewer keywords). */
  fallbacks?: string[]
  /** Ids of constraints the provider enforces natively. */
  native: string[]
  /** Ids of constraints that still need local verification (the rest of the task's constraints). */
  local: string[]
}

type TaskLike = Pick<TaskSpec, 'goal' | 'query' | 'needs' | 'constraints'>

const hard = (task: TaskLike, kind: Constraint['kind']): Constraint[] => task.constraints.filter(c => c.kind === kind && c.strength === 'hard' && c.value.trim())

// ── time windows ────────────────────────────────────────────────────────────

const ZH_NUMBERS: Record<string, number> = { 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 }
const UNIT_DAYS: Record<string, number> = { 天: 1, 日: 1, 周: 7, 星期: 7, 个月: 30, 月: 30, 年: 365, day: 1, days: 1, week: 7, weeks: 7, month: 30, months: 30, year: 365, years: 365 }

/**
 * Lower bound (ISO 8601, UTC) of a time_window value, in the same sense the rule
 * gate uses: a year ("2025 年以后", "since 2025", "2025") means "published in or
 * after that year"; relative spans ("最近一周", "past 30 days") count back from
 * `now`. Upper bounds are not expressed by the constraint vocabulary. Returns
 * undefined when the value is not understood (the constraint then stays local).
 */
export function parseTimeWindow(value: string, now: Date = new Date()): string | undefined {
  const relative = /(?:最近|过去|近|past|last)\s*(\d+|[一二两三四五六七八九十])?\s*(个月|星期|周|天|日|月|年|days?|weeks?|months?|years?)/i.exec(value)
  if (relative) {
    const amount = relative[1] ? (ZH_NUMBERS[relative[1]] ?? Number(relative[1])) : 1
    const days = UNIT_DAYS[relative[2]!.toLowerCase()]
    if (days && amount > 0) return new Date(now.getTime() - amount * days * 86_400_000).toISOString()
  }
  const year = /(?<!\d)((?:19|20)\d\d)(?!\d)/.exec(value)
  return year ? year[1] + '-01-01T00:00:00.000Z' : undefined
}

// ── search-engine operators ─────────────────────────────────────────────────

const operatorTerm = (term: string): string => {
  const clean = term.replace(/["']/g, '').trim()
  return /\s/.test(clean) ? '"' + clean + '"' : clean
}

function compileOperators(task: TaskLike, providerId: string): CompiledQuery {
  const parts: string[] = []
  const native: string[] = []
  const has = (token: string): boolean => task.query.toLowerCase().includes(token.toLowerCase())
  const add = (token: string, id: string): void => {
    native.push(id)
    if (!has(token)) parts.push(token) // query_syntax constraints are already spelled in the query
  }
  const site = hard(task, 'site')[0]
  if (site && domainOf(site.value)) add('site:' + domainOf(site.value), site.id)
  for (const c of hard(task, 'exclude_site')) if (domainOf(c.value)) add('-site:' + domainOf(c.value), c.id)
  for (const c of hard(task, 'exclude_term')) if (operatorTerm(c.value)) add('-' + operatorTerm(c.value), c.id)
  return finish(task, providerId, [task.query, ...parts].join(' ').trim(), native)
}

function compileExa(task: TaskLike, providerId: string, now: Date): CompiledQuery {
  const exa: CompiledExaOptions = {}
  const native: string[] = []
  const include = hard(task, 'site').map(c => ({ c, d: domainOf(c.value) })).filter(x => x.d)
  if (include.length) { exa.includeDomains = [...new Set(include.map(x => x.d))]; native.push(...include.map(x => x.c.id)) }
  const exclude = hard(task, 'exclude_site').map(c => ({ c, d: domainOf(c.value) })).filter(x => x.d)
  if (exclude.length) { exa.excludeDomains = [...new Set(exclude.map(x => x.d))]; native.push(...exclude.map(x => x.c.id)) }
  const windows = hard(task, 'time_window').map(c => ({ c, start: parseTimeWindow(c.value, now) })).filter((x): x is { c: Constraint; start: string } => x.start !== undefined)
  if (windows.length) {
    exa.startPublishedDate = windows.map(x => x.start).sort().at(-1)! // several lower bounds: the strictest holds
    native.push(...windows.map(x => x.c.id))
  }
  return { ...finish(task, providerId, task.query, native), ...Object.keys(exa).length ? { options: { exa } } : {} }
}

// ── GitHub keyword queries ──────────────────────────────────────────────────

/** Chinese words that carry no topical signal in a repository search. */
const ZH_FILLER_WORDS = /(如何|怎么样|怎么|怎样|什么|哪个|哪些|是否|能否|可以|使用|用法|方法|示例|例子|教程|指南|介绍|详解|对比|比较|区别|选型|推荐|最新|官方|文档|支持|问题|原因|实现|原理|说明|配置|安装|运行|检测|一下|有没有|请问|我们|取舍|性能|兼容性|评测|榜单|速度|成本|限制|额度|版本|需要|不需要|默认|修改|策略|失败|回滚)/g
/** Single function characters; stripped from free query text only, never from entity / must_term values (中文分词 must survive). */
const ZH_FILLER_CHARS = /[的了和与及在中里是吗呢吧把被对从向为有要能会这那个些]/g
/** English words that carry no topical signal in a repository search (on top of the lexical stop list). */
const LATIN_FILLER = new Set('doc docs documentation tutorial tutorials guide guides example examples usage introduction intro best practice practices tips difference differences between compare comparison latest new official setup install installation configure configuration config how-to'.split(' '))

export const GITHUB_MAX_TERMS = 5

function latinTokens(text: string): string[] {
  // ':' and '/' split tokens so "node:sqlite" cannot be read as a GitHub qualifier.
  return (text.match(/[A-Za-z0-9][A-Za-z0-9_.+#-]*[A-Za-z0-9+#]|[A-Za-z0-9]/g) ?? [])
    .map(t => t.toLowerCase())
    .filter(t => !LATIN_STOP.has(t) && !LATIN_FILLER.has(t) && (t.length >= 2) && !/^[\d.]+$/.test(t))
}

function hanTerms(text: string, freeText: boolean): string[] {
  const stripped = text.replace(ZH_FILLER_WORDS, ' ')
  return ((freeText ? stripped.replace(ZH_FILLER_CHARS, ' ') : stripped).match(/\p{Script=Han}+/gu) ?? []).filter(t => t.length >= 2 && t.length <= 8)
}

/**
 * Short keyword query for repository search: entities, then must_terms, then a
 * few salient Latin tokens of the query; Chinese terms only from entities /
 * must_terms, or from the query when fewer than two terms were found. At most
 * {@link GITHUB_MAX_TERMS} terms, version-like numbers dropped.
 */
export function githubKeywordTerms(task: TaskLike): string[] {
  const order = (kind: Constraint['kind']): Constraint[] => task.constraints
    .filter(c => c.kind === kind && c.value.trim())
    .sort((a, b) => (a.strength === b.strength ? 0 : a.strength === 'hard' ? -1 : 1))
  const terms: string[] = []
  const push = (list: string[]): void => {
    for (const t of list) if (terms.length < GITHUB_MAX_TERMS && !terms.includes(t)) terms.push(t)
  }
  const fromConstraints = [...order('entity'), ...order('must_term')].map(c => c.value)
  for (const value of fromConstraints) push([...latinTokens(value), ...hanTerms(value, false)])
  push(latinTokens(task.query))
  if (terms.length < 2) push(hanTerms(task.query, true))
  return terms
}

export function githubKeywordQuery(task: TaskLike): string {
  return githubKeywordTerms(task).join(' ') || task.query
}

/** Repository search ANDs every keyword, so one rare token empties the result: retry with the leading 3 and 2 terms. */
export const GITHUB_FALLBACK_TERM_COUNTS: readonly number[] = [3, 2]

function compileGithub(task: TaskLike, providerId: string): CompiledQuery {
  const terms = githubKeywordTerms(task)
  const fallbacks = GITHUB_FALLBACK_TERM_COUNTS.filter(n => n < terms.length).map(n => terms.slice(0, n).join(' '))
  return { ...finish(task, providerId, terms.join(' ') || task.query, []), ...fallbacks.length ? { fallbacks } : {} }
}

// ── entry points ────────────────────────────────────────────────────────────

function finish(task: TaskLike, providerId: string, query: string, native: string[]): CompiledQuery {
  const done = new Set(native)
  return { providerId, query, native, local: task.constraints.map(c => c.id).filter(id => !done.has(id)) }
}

/** Compile the task for one provider id (`ddg`, `bing`, `exa`, `github*`; anything else gets the plain query). */
export function compileQuery(task: TaskLike, providerId: string, now: Date = new Date()): CompiledQuery {
  if (providerId === 'ddg' || providerId === 'bing') return compileOperators(task, providerId)
  if (providerId === 'exa') return compileExa(task, providerId, now)
  if (providerId === 'github' || providerId.startsWith('github-')) return compileGithub(task, providerId)
  return finish(task, providerId, task.query, [])
}

export function compileQueries(task: TaskLike, providerIds: readonly string[], now: Date = new Date()): CompiledQuery[] {
  return providerIds.map(id => compileQuery(task, id, now))
}
