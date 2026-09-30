/**
 * Cross-lingual term alignment for the S6 rule scorer (dev-plan M3a).
 *
 * Problem (M2c end-to-end run): the need "DatabaseSync 构造参数中的 timeout 选项"
 * against the English block "sqlite.DatabaseSyncOptions.timeout — timeout?:
 * number — The busy timeout in milliseconds" only got grade 1. Two structural
 * reasons, both fixed here without touching the calibrated gate lexicon
 * (`lexical.ts`):
 *
 *  1. Dilution. Every Han bigram of the need / query / goal counts in the
 *     denominator but can never appear in an English block, so a fully matching
 *     Latin half scores ~0.25. For a Latin block the Han terms are therefore
 *     left out, and the score is shrunk when the remaining Latin evidence is
 *     thin (one stray shared word must not reach grade 3).
 *  2. Identifier shape. `DatabaseSync` versus `DatabaseSyncOptions`,
 *     `busy_timeout` versus `busyTimeout` versus "busy timeout": Latin tokens
 *     are split on separators and on camelCase boundaries, matched in a
 *     separator-free normal form, and a need identifier that is the prefix /
 *     suffix of a longer block identifier earns partial credit.
 *
 * Latin terms come from the need, the query, the goal and entity / must_term
 * constraint values, so a Chinese need inherits the English terms the calling
 * model already put into the query.
 *
 * The RuleScorer applies this only to pairs whose need and block languages
 * differ (`languagesDiffer`); same-language pairs keep the calibrated lexical-v1
 * relevance: an offline sweep (bench/src/eval-pack.ts, 60 tasks) found no gain
 * from identifier splitting there (-1 need hit) while mismatch-only alignment
 * is neutral-to-positive on every metric.
 * @module web-search-pro/pipeline/align
 */

import { LATIN_STOP, termsOf } from './lexical.ts'
import type { ConstraintLike } from './gate.ts'

export type TextLang = 'zh' | 'latin' | 'none'

const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu
const HAN_KEY = /[\p{Script=Han}]/u

/**
 * zh vs latin by character ratio. A Han character carries about three times the
 * information of a Latin letter, so `zh` when Han share (weighted 3:1) of all
 * letters reaches 30%: a Chinese sentence with a few identifiers stays zh, an
 * English page with a Chinese title stays latin. `none`: no letters at all.
 */
export function detectLang(text: string): TextLang {
  const han = text.match(CJK)?.length ?? 0
  const latin = text.match(/[A-Za-z]/g)?.length ?? 0
  if (han + latin === 0) return 'none'
  return (han * 3) / (han * 3 + latin) >= 0.3 ? 'zh' : 'latin'
}

/** Both texts have a language and it differs: the pairs the lexical rule is structurally weak on. */
export function languagesDiffer(a: string, b: string): boolean {
  const la = detectLang(a)
  const lb = detectLang(b)
  return la !== 'none' && lb !== 'none' && la !== lb
}

// ── Latin / identifier terms ────────────────────────────────────────────────

const TOKEN = /[A-Za-z0-9_$]+(?:[.:/-][A-Za-z0-9_$]+)*/g
const SEPARATORS = /[._:/$-]+/
const weightOf = (w: string): number => (/\d/.test(w) ? 1.5 : Math.min(2, 0.5 + w.length / 6))
const worthy = (w: string): boolean => (w.length >= 2 || /\d/.test(w)) && !LATIN_STOP.has(w)

function camelWords(piece: string): string[] {
  return piece.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2').toLowerCase().split(' ').filter(Boolean)
}

/**
 * Latin terms of a text with intrinsic weights. A token yields its separator-free
 * lowercase form (`busy_timeout`, `busyTimeout` -> `busytimeout`), each
 * separator-delimited piece (x0.7) and each camelCase sub-word (x0.6).
 * Consecutive plain words stay separate terms, as in `termsOf`.
 */
export function latinTermsOf(text: string): Map<string, number> {
  const out = new Map<string, number>()
  const add = (term: string, weight: number): void => { if ((out.get(term) ?? 0) < weight) out.set(term, weight) }
  for (const raw of text.match(TOKEN) ?? []) {
    const pieces = raw.split(SEPARATORS).filter(Boolean)
    const whole = pieces.join('').toLowerCase()
    if (worthy(whole)) add(whole, weightOf(whole))
    for (const piece of pieces) {
      const words = camelWords(piece)
      const joined = words.join('')
      if (pieces.length > 1 && worthy(joined)) add(joined, weightOf(joined) * 0.7)
      if (words.length > 1) for (const w of words) if (w.length >= 3 && worthy(w)) add(w, weightOf(w) * 0.6)
    }
  }
  return out
}

/** Credit for an identifier that only appears inside a longer one (`databasesync` in `databasesyncoptions`). */
export const CONTAINMENT_CREDIT = 0.7
const CONTAINMENT_MIN_LENGTH = 6

/** Weights of the parts of the aligned query (dev-plan M3a; the gate's relevance keeps its own). */
export const ALIGN_WEIGHTS = { need: 1.6, query: 1.0, goal: 0.8, hardConstraint: 1.2, softConstraint: 1.0 } as const
/** Below this much Latin term weight a Latin-only comparison is shrunk proportionally. */
export const ALIGN_MIN_LATIN_WEIGHT = 5
/** Share of a Han term's weight that still counts in the denominator when the block is Latin (0 = dropped; offline sweep: 0 and 1 lose need hit, 0.15-0.5 are equal). */
export const ALIGN_HAN_KEPT = 0.3

export interface AlignContext {
  goal: string
  query: string
  /** The need the block is scored against. */
  need: string
  constraints: readonly ConstraintLike[]
}

export interface AlignItem { heading?: string | undefined; text: string }

interface Part { text: string; weight: number }

function partsOf(ctx: AlignContext): Part[] {
  const parts: Part[] = [{ text: ctx.need, weight: ALIGN_WEIGHTS.need }, { text: ctx.query, weight: ALIGN_WEIGHTS.query }, { text: ctx.goal, weight: ALIGN_WEIGHTS.goal }]
  for (const c of ctx.constraints) {
    if (c.kind === 'entity' || c.kind === 'must_term') parts.push({ text: c.value, weight: c.strength === 'hard' ? ALIGN_WEIGHTS.hardConstraint : ALIGN_WEIGHTS.softConstraint })
  }
  return parts
}

/**
 * Weighted share (0..1) of the task's terms found in the block, with the
 * cross-lingual and identifier handling described in the module comment.
 * Same scale as `lexicalRelevance`, so `bucketGrade` thresholds still apply.
 */
export function alignedRelevance(ctx: AlignContext, item: AlignItem): number {
  const doc = [item.heading, item.text].filter(Boolean).join('\n')
  const lang = detectLang(doc)
  const docHan = termsOf(doc)
  const docLatin = latinTermsOf(doc)
  const docKeys = [...docLatin.keys()]

  const han = new Map<string, number>()
  const latin = new Map<string, number>()
  for (const part of partsOf(ctx)) {
    for (const [term, w] of termsOf(part.text)) {
      if (!HAN_KEY.test(term)) continue
      if ((han.get(term) ?? 0) < w * part.weight) han.set(term, w * part.weight)
    }
    for (const [term, w] of latinTermsOf(part.text)) {
      if ((latin.get(term) ?? 0) < w * part.weight) latin.set(term, w * part.weight)
    }
  }

  let total = 0
  let hit = 0
  let latinTotal = 0
  for (const [term, weight] of latin) {
    total += weight
    latinTotal += weight
    if (docLatin.has(term)) { hit += weight; continue }
    if (term.length >= CONTAINMENT_MIN_LENGTH && docKeys.some(k => k.length > term.length && (k.startsWith(term) || k.endsWith(term)))) hit += weight * CONTAINMENT_CREDIT
  }
  // Han terms cannot occur in a Latin block: they would only dilute, so they count at a fraction of their weight.
  const scale = lang === 'latin' ? ALIGN_HAN_KEPT : 1
  if (scale > 0) {
    for (const [term, weight] of han) {
      total += weight * scale
      if (docHan.has(term)) hit += weight * scale
    }
  }
  if (total === 0) return 0
  const relevance = hit / total
  return lang === 'latin' && han.size > 0 ? relevance * Math.min(1, latinTotal / ALIGN_MIN_LATIN_WEIGHT) : relevance
}
