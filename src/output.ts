import type { CategoryInfo, SearchResponse, Snapshot } from './types.ts'

export const SCHEMA_VERSION = 1

export function sourceInfo(snapshot: Snapshot) {
  return { sha: snapshot.source.sha, fetchedAt: snapshot.source.fetchedAt }
}

export function searchDocument(res: SearchResponse, snapshot: Snapshot) {
  return {
    ok: true as const,
    schema_version: SCHEMA_VERSION,
    query: res.query,
    terms: res.terms,
    total: res.total,
    notes: res.notes,
    items: res.items,
    source: sourceInfo(snapshot),
  }
}

export function categoriesDocument(categories: CategoryInfo[], snapshot: Snapshot) {
  return { ok: true as const, schema_version: SCHEMA_VERSION, total: categories.length, categories, source: sourceInfo(snapshot) }
}

export function errorDocument(code: string, message: string) {
  return { ok: false as const, error: { code, message } }
}

/** Compact human-readable result list. */
export function formatSearchText(res: SearchResponse): string {
  const lines: string[] = []
  if (res.items.length === 0) lines.push('No results.')
  res.items.forEach((it, i) => {
    lines.push(`${i + 1}. ${it.name} [${it.category}]  auth: ${it.auth} · https: ${it.https ? 'yes' : 'no'} · cors: ${it.cors}`)
    if (it.description) lines.push(`   ${it.description}`)
    lines.push(`   ${it.url}`)
  })
  lines.push(res.total > res.items.length ? `${res.items.length} of ${res.total} results.` : `${res.total} result${res.total === 1 ? '' : 's'}.`)
  for (const n of res.notes) lines.push(`note: ${n}`)
  return lines.join('\n') + '\n'
}
