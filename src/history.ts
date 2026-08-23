import type { PageRecord, QueryRecord, Store } from './store.ts'

export interface HistorySource {
  url: string
  title?: string
  snippet?: string
  publishedAt?: string
}

export type HistoryReplay =
  | { record: QueryRecord; sources: HistorySource[]; page?: never }
  | { record: QueryRecord; page: PageRecord; sources?: never }

/** Resolve a history id according to its operation kind. */
export function replayHistory(store: Store, id: string): HistoryReplay {
  const record = store.queryById(id)
  if (!record) throw new Error('history query id not found: ' + id)
  if (record.kind === 'search' || record.kind === 'platform') {
    const sources = store.resultsForQuery(id).map(row => ({
      url: row.url,
      ...row.title ? { title: row.title } : {},
      ...row.snippet ? { snippet: row.snippet } : {},
      ...row.published ? { publishedAt: row.published } : {},
    }))
    if (!sources.length) throw new Error('no saved sources for ' + record.kind + ' query id ' + id)
    return { record, sources }
  }
  const page = store.pageForQuery(id)
  if (!page) throw new Error('no saved page for ' + record.kind + ' query id ' + id)
  return { record, page }
}
