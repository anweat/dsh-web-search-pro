/** Text helpers shared by the action renderers. @module web-search-pro/actions/format */

function sourceLine(s: { url: string; title?: string; snippet?: string; publishedAt?: string }): string {
  const label = s.title && s.title.length ? s.title : safeHost(s.url)
  const meta: string[] = []
  if (s.snippet) meta.push(s.snippet)
  if (s.publishedAt) meta.push('(' + s.publishedAt + ')')
  const suffix = meta.length ? ' — ' + meta.join(' ') : ''
  return '- [' + label + '](' + s.url + ')' + suffix
}

function safeHost(url: string): string {
  try { return new URL(url).hostname } catch { return url }
}

export function formatSources(sources: { url: string; title?: string; snippet?: string; publishedAt?: string }[]): string {
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
