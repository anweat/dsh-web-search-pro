/**
 * Candidate merging (dev-plan M2a S3, design §6.1): provider outputs become
 * one Candidate per canonical URL. Every (provider, rank, query) contribution
 * is kept; title and snippet are the most complete ones seen, with
 * complementary snippets joined inside a character cap.
 * @module web-search-pro/pipeline/candidates
 */

import crypto from 'node:crypto'
import { termsOf } from './lexical.ts'
import type { Candidate } from './types.ts'
import { canonicalizeUrl } from './url.ts'

/** Same cap as `shapeSources` applies to outgoing snippets (util.ts SNIPPET_MAX_CHARS). */
export const SNIPPET_JOIN_CAP = 500
const SNIPPET_SEPARATOR = ' … '
/** Less than this much room left: do not append a truncated stub. */
const MIN_APPEND_CHARS = 40
/** Share of a snippet's terms already present in the other before it counts as a repeat. */
const REPEAT_OVERLAP = 0.8

export interface ProviderSource { url: string; title?: string | null; snippet?: string | null; publishedAt?: string | null }

/** One provider's ordered result list for one query (index 0 = rank 1). */
export interface ProviderOutput {
  providerId: string
  query: string
  sources: readonly ProviderSource[]
}

export interface MergeOptions {
  /** Cap for joined snippets; a single snippet longer than the cap is kept whole (shaping is the exit's job). */
  snippetMaxChars?: number
}

export function candidateIdOf(canonical: string): string {
  return 'c_' + crypto.createHash('sha1').update(canonical).digest('hex').slice(0, 12)
}

const squash = (text: string): string => text.replace(/\s+/g, ' ').trim()

function overlapOf(a: string, b: string): number {
  const ta = termsOf(a)
  const tb = termsOf(b)
  if (!ta.size || !tb.size) return 0
  let hit = 0
  for (const t of ta.keys()) if (tb.has(t)) hit++
  return hit / Math.min(ta.size, tb.size)
}

/** Fold snippet `next` into `current`: drop repeats, keep the longer of near-duplicates, join complements within `cap`. */
export function mergeSnippets(current: string, next: string | null | undefined, cap: number = SNIPPET_JOIN_CAP): string {
  const n = squash(next ?? '')
  if (!n) return current
  if (!current) return n
  const cl = current.toLowerCase()
  const nl = n.toLowerCase()
  if (cl.includes(nl)) return current
  if (nl.includes(cl)) return n
  if (overlapOf(current, n) >= REPEAT_OVERLAP) return n.length > current.length ? n : current
  const room = cap - current.length - SNIPPET_SEPARATOR.length
  if (room >= n.length) return current + SNIPPET_SEPARATOR + n
  if (room >= MIN_APPEND_CHARS) {
    const cut = n.slice(0, room - 1)
    const space = cut.lastIndexOf(' ')
    return current + SNIPPET_SEPARATOR + (space >= MIN_APPEND_CHARS / 2 ? cut.slice(0, space) : cut) + '…'
  }
  return current
}

/**
 * Merge provider outputs into candidates keyed by canonical URL, in first-seen
 * order (outputs in the given order, sources by rank). Sources without a URL
 * are skipped; their rank positions still count.
 */
export function mergeCandidates(outputs: readonly ProviderOutput[], options: MergeOptions = {}): Candidate[] {
  const cap = options.snippetMaxChars ?? SNIPPET_JOIN_CAP
  const byKey = new Map<string, Candidate>()
  for (const output of outputs) {
    output.sources.forEach((source, index) => {
      const url = source.url?.trim()
      if (!url) return
      const key = canonicalizeUrl(url)
      let candidate = byKey.get(key)
      if (!candidate) {
        candidate = { candidateId: candidateIdOf(key), canonicalUrl: key, url, title: '', snippet: '', contributions: [] }
        byKey.set(key, candidate)
      }
      candidate.contributions.push({ providerId: output.providerId, rank: index + 1, query: output.query })
      const title = squash(source.title ?? '')
      if (title.length > candidate.title.length) candidate.title = title
      candidate.snippet = mergeSnippets(candidate.snippet, source.snippet, cap)
      if (!candidate.publishedAt && source.publishedAt) candidate.publishedAt = source.publishedAt
    })
  }
  return [...byKey.values()]
}
