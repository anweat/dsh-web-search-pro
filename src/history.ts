import { splitBlocks } from './pipeline/blocks.ts'
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
    return { record, sources }
  }
  const page = store.pageForQuery(id)
  if (!page) throw new Error('no saved page for ' + record.kind + ' query id ' + id)
  return { record, page }
}

// ── evidence expansion (web_history action=expand) ──────────────────────────

/** Output cap of one expansion. */
export const EXPAND_MAX_CHARS = 4000

export interface ExpandedBlock {
  blockId: string
  position: 'before' | 'match' | 'after'
  text: string
  /** The text was cut to fit the cap. */
  truncated?: boolean
}

export interface ExpandedEvidence {
  evidenceId: string
  url: string
  title?: string
  heading?: string
  blocks: ExpandedBlock[]
  note?: string
}

const TRUNCATION_MARKER = /\n*\(Content truncated at \d+ characters\.\)\s*$/

/**
 * Full text of a stored evidence block plus its neighbouring blocks (+-1) from
 * the stored page, capped at `EXPAND_MAX_CHARS` characters overall: the match
 * is kept whole (cut only when it alone exceeds the cap), the neighbours share
 * what is left (the tail of the previous block, the head of the next).
 */
export function expandEvidence(store: Store, evidenceId: string, maxChars = EXPAND_MAX_CHARS): ExpandedEvidence {
  const row = store.evidenceBlock(evidenceId)
  if (!row) throw new Error('evidence id not found: ' + evidenceId)
  let title: string | undefined
  const run = store.evidenceRun(row.runId)
  if (run) {
    try { title = (JSON.parse(run.packJson) as { evidence?: { evidenceId: string; title?: string }[] }).evidence?.find(e => e.evidenceId === evidenceId)?.title } catch { /* pack JSON is informational */ }
  }
  const out: ExpandedEvidence = { evidenceId, url: row.url, ...title ? { title } : {}, ...row.heading ? { heading: row.heading } : {}, blocks: [] }

  let before: { blockId: string; text: string } | undefined
  let after: { blockId: string; text: string } | undefined
  let page = store.latestPage(row.url)
  if (!page) { try { page = store.latestPage(new URL(row.url).href) } catch { /* not a URL */ } }
  if (page?.text) {
    const blocks = splitBlocks(page.text.replace(TRUNCATION_MARKER, ''), row.url)
    const at = blocks.findIndex(b => b.blockId === row.blockId || (row.hash !== undefined && b.hash === row.hash))
    if (at >= 0) { before = blocks[at - 1]; after = blocks[at + 1] }
    else out.note = 'the stored page no longer contains this block; neighbouring blocks are unavailable'
  } else {
    out.note = 'page snapshot is no longer stored; neighbouring blocks are unavailable'
  }

  const matchText = row.text.length > maxChars ? row.text.slice(0, maxChars) : row.text
  const room = Math.max(maxChars - matchText.length, 0)
  const share = Math.floor(room / ((before ? 1 : 0) + (after ? 1 : 0) || 1))
  if (before && share > 0) {
    const cut = before.text.length > share
    out.blocks.push({ blockId: before.blockId, position: 'before', text: cut ? '…' + before.text.slice(before.text.length - share + 1) : before.text, ...cut ? { truncated: true } : {} })
  }
  out.blocks.push({ blockId: row.blockId, position: 'match', text: matchText, ...matchText.length < row.text.length ? { truncated: true } : {} })
  if (after && share > 0) {
    const cut = after.text.length > share
    out.blocks.push({ blockId: after.blockId, position: 'after', text: cut ? after.text.slice(0, share - 1) + '…' : after.text, ...cut ? { truncated: true } : {} })
  }
  return out
}
