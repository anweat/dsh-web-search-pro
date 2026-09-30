/**
 * RuleJudge: deterministic lexical baseline (dev-plan §4.3 rule column).
 * Relevance = weighted term overlap of query / need / entity terms with the
 * candidate text; constraints that rules can decide (must/exclude term, site,
 * version string, known dates, language) are checked directly.
 * @module bench/judges/rule
 */

import type { Satisfied, TaskConstraint } from '../types.ts'
import { hanRatio, hostOf, termsOf, weightedOverlap, type QueryPart } from './lexical.ts'
import type { Judge, JudgeContext, JudgeItem, JudgeQuestion, JudgeResult, Readiness } from './types.ts'

/** Relevance -> grade buckets: [0,T1) 0, [T1,T2) 1, [T2,T3) 2, >=T3 3. */
export const GRADE_THRESHOLDS = [0.12, 0.3, 0.55] as const

export function bucketGrade(relevance: number): 0 | 1 | 2 | 3 {
  if (relevance < GRADE_THRESHOLDS[0]) return 0
  if (relevance < GRADE_THRESHOLDS[1]) return 1
  if (relevance < GRADE_THRESHOLDS[2]) return 2
  return 3
}

export interface ConstraintVerdict { satisfied: Satisfied; prob: number }

const yes = (prob = 1): ConstraintVerdict => ({ satisfied: 'yes', prob })
const no = (prob = 0): ConstraintVerdict => ({ satisfied: 'no', prob })
const unknown = (prob = 0.5): ConstraintVerdict => ({ satisfied: 'unknown', prob })

function domainOf(value: string): string {
  return value.trim().toLowerCase().replace(/^site:/, '').replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/^www\./, '')
}

function hostMatches(host: string, domain: string): boolean {
  const h = host.replace(/^www\./, '')
  return h === domain || h.endsWith('.' + domain)
}

function versionNumbers(value: string): string[] {
  return value.match(/\d+(?:\.\d+)*/g) ?? []
}

function containsVersion(text: string, version: string): boolean {
  const escaped = version.replace(/\./g, '\\.')
  return new RegExp('(?<![\\d.])' + escaped + '(?![\\d]|\\.\\d)').test(text)
}

const CURRENT_YEAR = 2026

/** Newest year evidenced by an explicit date: publishedAt, then date-shaped strings in url/title/snippet. */
export function knownYear(item: JudgeItem): number | undefined {
  const published = item.meta?.publishedAt
  if (published) {
    const ts = Date.parse(published)
    if (Number.isFinite(ts)) return new Date(ts).getUTCFullYear()
    const m = published.match(/(?:19|20)\d\d/)
    if (m) return Number(m[0])
  }
  const hay = (item.meta?.url ?? '') + ' ' + (item.meta?.title ?? '') + ' ' + item.text
  const years = [...hay.matchAll(/(?<![\d])((?:19|20)\d\d)(?:[-/.](?:0?[1-9]|1[0-2])\b|\s*年\s*\d{1,2}\s*月)/g)].map(m => Number(m[1]))
    .filter(y => y <= CURRENT_YEAR + 1)
  return years.length ? Math.max(...years) : undefined
}

/** Rule verdict for one constraint on one candidate. Semantic kinds that rules cannot decide are `unknown`. */
export function checkConstraint(c: TaskConstraint, item: JudgeItem): ConstraintVerdict {
  const text = (item.meta?.title ? item.meta.title + '\n' : '') + item.text
  const lower = text.toLowerCase()
  const value = c.value.trim()
  switch (c.kind) {
    case 'site':
    case 'exclude_site': {
      const host = hostOf(item.meta?.url)
      if (!host) return unknown()
      const match = hostMatches(host, domainOf(value))
      return (c.kind === 'site') === match ? yes() : no()
    }
    case 'exclude_term':
      return lower.includes(value.toLowerCase()) ? no() : yes(0.9)
    case 'must_term':
    case 'entity': {
      if (lower.includes(value.toLowerCase())) return yes()
      const want = termsOf(value)
      if (want.size === 0) return unknown()
      const have = termsOf(text)
      let hit = 0
      for (const t of want.keys()) if (have.has(t)) hit++
      const frac = hit / want.size
      if (frac >= 1) return yes(0.95)
      return frac >= 0.5 ? unknown(frac) : no(frac)
    }
    case 'version': {
      const versions = versionNumbers(value)
      if (!versions.length) return unknown()
      return versions.some(v => containsVersion(text, v)) ? yes(0.9) : unknown(0.35)
    }
    case 'time_window': {
      const from = Number(value.match(/(?:19|20)\d\d/)?.[0])
      const year = knownYear(item)
      if (!Number.isFinite(from) || year === undefined) return unknown()
      return year >= from ? yes(0.9) : no(0.1)
    }
    case 'language': {
      if (text.replace(/\s/g, '').length < 12) return unknown()
      const wantZh = /^(zh|cn|中文|汉语|简体)/i.test(value)
      const wantEn = /^(en|english|英文|英语)/i.test(value)
      if (!wantZh && !wantEn) return unknown()
      const isZh = hanRatio(text) > 0.2
      return wantZh === isZh ? yes(0.9) : no(0.1)
    }
    default:
      return unknown()
  }
}

// ── relevance ───────────────────────────────────────────────────────────────

function docOf(item: JudgeItem): string {
  return [item.meta?.title, item.meta?.heading, item.text].filter(Boolean).join('\n')
}

function partsFor(ctx: JudgeContext, withConstraints: boolean): QueryPart[] {
  const parts: QueryPart[] = [{ text: ctx.query, weight: 1 }, { text: ctx.goal, weight: 0.8 }]
  for (const need of ctx.needs) parts.push({ text: need, weight: 1.6 })
  if (withConstraints) {
    for (const c of ctx.constraints) {
      if (c.kind === 'entity' || c.kind === 'must_term') parts.push({ text: c.value, weight: 1.5 })
    }
  }
  return parts
}

export function lexicalRelevance(ctx: JudgeContext, item: JudgeItem, withConstraints: boolean): number {
  return weightedOverlap(partsFor(ctx, withConstraints), docOf(item))
}

/** gate.single: relevance with constraint penalties (a violated hard constraint cuts the score). */
export function singleGateScore(ctx: JudgeContext, item: JudgeItem): number {
  let rel = lexicalRelevance(ctx, item, true)
  for (const c of ctx.constraints) {
    if (c.strength !== 'hard') continue
    const verdict = checkConstraint(c, item)
    if (verdict.satisfied === 'no') rel *= c.kind === 'must_term' || c.kind === 'entity' ? 0.6 : 0.3
  }
  return Math.min(1, rel)
}

// ── navigation pages ────────────────────────────────────────────────────────

const NAV_PATH = /\/(search|tags?|category|categories|archives?|topics?|list|lists|index|sitemap|explore|trending|latest|all)(?:\/|\.html?$|$|\?)/i
const NAV_TITLE = /(首页|目录|索引|搜索结果|站点地图|文章列表|全部文章|标签|分类|归档|search results|index of|sitemap|all posts|archive|home\s*page|^home\b)/i

export function navScore(item: JudgeItem): number {
  let score = 0
  const url = item.meta?.url
  if (url) {
    try {
      const u = new URL(url)
      if (u.pathname === '/' || u.pathname === '') score += 0.5
      if (NAV_PATH.test(u.pathname)) score += 0.4
      if (/[?&](q|s|query|search|keyword|page|p)=/i.test(u.search)) score += 0.4
    } catch { /* not a URL */ }
  }
  if (NAV_TITLE.test(item.meta?.title ?? '')) score += 0.4
  return Math.min(1, score)
}

// ── profile ─────────────────────────────────────────────────────────────────

const PROFILE_KEYWORDS: Record<string, RegExp> = {
  docs_code: /(文档|api|用法|版本|报错|安装|配置|示例|源码|sdk|cli|函数|参数|接口|升级|迁移|docs?|install|config|error|exception|version|syntax|usage|example)/gi,
  news_fact: /(新闻|最新|发布|公告|据报道|是否属实|官方回应|事件|声明|宣布|news|announce|released?|reported|latest|did |是否)/gi,
  academic: /(论文|arxiv|综述|研究|方法|实验|基准|模型|算法|paper|survey|study|benchmark|theorem|dataset|citation)/gi,
  experience: /(体验|踩坑|口碑|推荐|经验|评测|值得|好用|吐槽|心得|怎么样|review|experience|worth|recommend|reddit|v2ex|小红书)/gi,
  compare: /(对比|区别|比较|选型|哪个好|哪个更|vs\.?|versus|difference|compare|comparison|alternatives?|优缺点)/gi,
}

export function profileScores(text: string): Record<string, number> {
  const raw: Record<string, number> = { general: 0.6 }
  for (const [profile, re] of Object.entries(PROFILE_KEYWORDS)) raw[profile] = (text.match(re) ?? []).length
  const exp = Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, Math.exp(v)]))
  const sum = Object.values(exp).reduce((a, b) => a + b, 0)
  return Object.fromEntries(Object.entries(exp).map(([k, v]) => [k, v / sum]))
}

// ── the judge ───────────────────────────────────────────────────────────────

export class RuleJudge implements Judge {
  readonly id = 'rule'
  readonly model = 'lexical-v1'

  async ready(): Promise<Readiness> {
    return { ready: true }
  }

  async evaluate(_state: string, q: JudgeQuestion, items: readonly JudgeItem[]): Promise<JudgeResult[]> {
    const ctx: JudgeContext = q.context ?? { goal: '', query: '', needs: [], constraints: [] }
    return items.map(item => this.one(q, ctx, item))
  }

  private one(q: JudgeQuestion, ctx: JudgeContext, item: JudgeItem): JudgeResult {
    const base = { id: item.id, judge: this.id, model: this.model, rubricId: q.rubricId, rubricVersion: q.rubricVersion, latencyMs: 0 }
    if (q.kind === 'score') {
      const grade = bucketGrade(lexicalRelevance(ctx, item, true))
      return { ...base, grade, decision: String(grade) }
    }
    if (q.kind === 'choice') {
      const probs = profileScores(item.text)
      const allowed = Object.keys(q.options ?? probs)
      const [choice, prob] = Object.entries(probs).filter(([k]) => allowed.includes(k)).sort((a, b) => b[1] - a[1])[0]!
      return { ...base, decision: choice, prob, probabilities: probs }
    }
    let prob: number
    if (q.rubricId.startsWith('gate.nav')) prob = navScore(item)
    else if (q.rubricId.startsWith('gate.constraint')) {
      prob = ctx.constraint ? checkConstraint(ctx.constraint, item).prob : 0.5
    } else if (q.rubricId.startsWith('gate.relevance')) prob = lexicalRelevance(ctx, item, false)
    else prob = singleGateScore(ctx, item)
    return { ...base, prob, decision: prob >= 0.5 ? 'true' : 'false' }
  }
}
