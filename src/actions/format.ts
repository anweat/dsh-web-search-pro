/** Text helpers shared by the action renderers. @module web-search-pro/actions/format */

import { WHOLE_OUTPUT_SCHEME } from '../cli/spec.ts'
import { qualityTag } from '../pipeline/render.ts'

function sourceLine(s: { url: string; title?: string; snippet?: string; publishedAt?: string; rerankScore?: number; authority?: number }): string {
  const label = s.title && s.title.length ? s.title : safeHost(s.url)
  // The whole output of a custom CLI is a block of text, not a one-line snippet: it goes below the heading, indented.
  if (s.url.startsWith(WHOLE_OUTPUT_SCHEME)) {
    const quality = qualityTag(s)
    return '- ' + label + ' (' + s.url + ')' + (quality ? ' ' + quality : '') + (s.snippet ? '\n' + s.snippet.split('\n').map(line => '    ' + line).join('\n') : '')
  }
  const meta: string[] = []
  if (s.snippet) meta.push(s.snippet)
  if (s.publishedAt) meta.push('(' + s.publishedAt + ')')
  const quality = qualityTag(s)
  if (quality) meta.push(quality)
  const suffix = meta.length ? ' — ' + meta.join(' ') : ''
  return '- [' + label + '](' + s.url + ')' + suffix
}

function safeHost(url: string): string {
  try { return new URL(url).hostname } catch { return url }
}

export function formatSources(sources: { url: string; title?: string; snippet?: string; publishedAt?: string; rerankScore?: number; authority?: number }[]): string {
  if (!sources.length) return 'No results found.'
  return sources.map(sourceLine).join('\n')
}

/**
 * Per-item character limit so that `sum(min(length, limit)) <= total` and `limit <= perItem`:
 * short texts keep all they have and the room they leave over goes to the long ones.
 */
export function fairShareLimit(lengths: readonly number[], perItem: number, total: number): number {
  const sorted = lengths.filter(n => n > 0).sort((a, b) => a - b)
  let room = total
  let left = sorted.length
  for (const n of sorted) {
    const wanted = Math.min(n, perItem)
    const share = Math.floor(room / left)
    if (wanted > share) return Math.max(share, 0)
    room -= wanted
    left--
  }
  return perItem
}

/** The fallback for a character cap when the config has none. */
export const DEFAULT_FETCH_CHARS = 20_000
