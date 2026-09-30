/**
 * Lexical helpers shared by the S3/S4 rule gate, query compilation, the bench
 * rule judge, the block pre-ranker and the labeler: Chinese via character
 * bigrams, Latin via lowercase word tokens. Ported from bench/judges/lexical
 * (the r1 experiment); thresholds calibrated on it only hold while this
 * tokenisation stays unchanged, so edit with `bench/src/eval-gate.ts` at hand.
 * @module web-search-pro/pipeline/lexical
 */

const HAN_RUN = /\p{Script=Han}+/gu
const LATIN_WORD = /[a-z0-9][a-z0-9_.:+#/-]*[a-z0-9+#]|[a-z0-9]/g
const SPLIT_PARTS = /[._:/-]+/

/** Chinese function characters; bigrams containing them carry no topical signal. */
export const HAN_STOP = new Set('的了是在和与及或吗呢么就也都而把被让对从向为有要能会可以这那个些什如何怎么样请问'.split(''))
export const LATIN_STOP = new Set((
  'the a an of to in for and or is are was were be been how what which who when where why with on by from as at it its this that these those do does did can could ' +
  'use using used should would will i you we they your my our not no vs via about into than then there here also more most some any all if but so'
).split(' '))

export interface Term { term: string; weight: number }

/** Distinct terms of a text with intrinsic weights (longer / digit-bearing terms weigh more). */
export function termsOf(text: string): Map<string, number> {
  const out = new Map<string, number>()
  const add = (term: string, weight: number): void => {
    if (!out.has(term) || out.get(term)! < weight) out.set(term, weight)
  }
  for (const run of text.match(HAN_RUN) ?? []) {
    const chars = [...run]
    if (chars.length === 1) { if (!HAN_STOP.has(chars[0]!)) add(chars[0]!, 0.5); continue }
    for (let i = 0; i + 1 < chars.length; i++) {
      if (HAN_STOP.has(chars[i]!) || HAN_STOP.has(chars[i + 1]!)) continue
      add(chars[i]! + chars[i + 1]!, 1)
    }
  }
  for (const word of text.toLowerCase().match(LATIN_WORD) ?? []) {
    const weightOf = (w: string): number => (/\d/.test(w) ? 1.5 : Math.min(2, 0.5 + w.length / 6))
    if (!LATIN_STOP.has(word) && (word.length >= 2 || /\d/.test(word))) add(word, weightOf(word))
    const parts = word.split(SPLIT_PARTS).filter(p => p && (p.length >= 2 || /\d/.test(p)) && !LATIN_STOP.has(p))
    if (parts.length > 1) for (const p of parts) add(p, weightOf(p) * 0.7)
  }
  return out
}

export interface QueryPart { text: string; weight: number }

/** Weighted fraction of query terms present in `doc` (0..1). Term weight = part weight * intrinsic weight. */
export function weightedOverlap(parts: readonly QueryPart[], doc: string): number {
  const docTerms = termsOf(doc)
  const merged = new Map<string, number>()
  for (const part of parts) {
    for (const [term, w] of termsOf(part.text)) {
      const weight = w * part.weight
      if ((merged.get(term) ?? 0) < weight) merged.set(term, weight)
    }
  }
  let total = 0
  let hit = 0
  for (const [term, weight] of merged) {
    total += weight
    if (docTerms.has(term)) hit += weight
  }
  return total === 0 ? 0 : hit / total
}

export function hostOf(url: string | undefined): string | undefined {
  if (!url) return undefined
  try { return new URL(url).hostname.toLowerCase() } catch { return undefined }
}

/** Share of Han characters among letters/ideographs: a cheap zh/en detector. */
export function hanRatio(text: string): number {
  const han = (text.match(/\p{Script=Han}/gu) ?? []).length
  const latin = (text.match(/[A-Za-z]/g) ?? []).length
  return han + latin === 0 ? 0 : han / (han + latin)
}
