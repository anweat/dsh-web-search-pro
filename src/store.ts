/**
 * SQLite persistence for web-search-pro (node:sqlite, zero dependencies).
 * Stores search queries + results, fetched page snapshots, and user-extended
 * extraction rules (userscript-style). All methods are synchronous; writes are
 * small and batched per call.
 * @module web-search-pro/store
 */

import { DatabaseSync } from 'node:sqlite'
import fs from 'node:fs'
import path from 'node:path'
import { uid } from './util.ts'

export type QueryKind = 'search' | 'fetch' | 'platform' | 'snapshot'

export interface QueryRecord {
  id: string
  kind: QueryKind
  query?: string
  engine?: string
  platform?: string
  url?: string
  status: string
  ts: string
  detail?: string
  cacheKey?: string
}

export interface SourceRow {
  id: string
  queryId: string
  rank: number
  url: string
  title?: string
  snippet?: string
  published?: string
  engine?: string
  extra?: string
}

export interface PageRecord {
  id: string
  url: string
  title?: string
  text?: string
  htmlPath?: string
  screenshotPath?: string
  status?: number
  fetchedAt: string
  source?: string
}

export interface RuleRecord {
  hostname: string
  content: string
  remove?: string
  createdAt: string
  updatedAt: string
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS queries (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  query TEXT,
  engine TEXT,
  platform TEXT,
  url TEXT,
  status TEXT NOT NULL,
  ts TEXT NOT NULL,
	  detail TEXT
	);
CREATE TABLE IF NOT EXISTS results (
  id TEXT PRIMARY KEY,
  query_id TEXT NOT NULL,
  rank INTEGER NOT NULL,
  url TEXT NOT NULL,
  title TEXT,
  snippet TEXT,
  published TEXT,
  engine TEXT,
  extra TEXT
);
CREATE TABLE IF NOT EXISTS pages (
  id TEXT PRIMARY KEY,
  url TEXT UNIQUE NOT NULL,
  title TEXT,
  text TEXT,
  html_path TEXT,
  screenshot_path TEXT,
  status INTEGER,
  fetched_at TEXT NOT NULL,
  source TEXT
);
CREATE TABLE IF NOT EXISTS rules (
  hostname TEXT PRIMARY KEY,
  content TEXT NOT NULL,
  remove TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_results_query ON results(query_id);
CREATE INDEX IF NOT EXISTS idx_queries_ts ON queries(ts);
CREATE INDEX IF NOT EXISTS idx_queries_kind ON queries(kind);
CREATE INDEX IF NOT EXISTS idx_pages_url ON pages(url);
`

export class Store {
  private db: DatabaseSync

  constructor(readonly dbPath: string) {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true })
    this.db = new DatabaseSync(dbPath)
    this.db.exec('PRAGMA journal_mode = WAL')
    this.db.exec(SCHEMA)
    const columns = this.db.prepare('PRAGMA table_info(queries)').all() as unknown as { name: string }[]
    if (!columns.some(column => column.name === 'cache_key')) this.db.exec('ALTER TABLE queries ADD COLUMN cache_key TEXT')
    this.db.exec('CREATE INDEX IF NOT EXISTS idx_queries_cache ON queries(kind, cache_key, ts)')
  }

  close(): void {
    try { this.db.close() } catch { /* already closed */ }
  }

  /** Record one operation (search / fetch / platform / snapshot). Returns its id. */
  recordQuery(input: Omit<QueryRecord, 'id' | 'ts'> & { id?: string }): string {
    const id = input.id ?? uid()
    const ts = new Date().toISOString()
    this.db.prepare(
      'INSERT OR REPLACE INTO queries (id, kind, query, engine, platform, url, status, ts, detail, cache_key) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    ).run(id, input.kind, input.query ?? null, input.engine ?? null, input.platform ?? null, input.url ?? null, input.status, ts, input.detail ?? null, input.cacheKey ?? null)
    return id
  }

  /** Look up a fresh cached search by (engine, normalized query). */
  getCachedSearch(engine: string, normQuery: string, ttlSeconds: number): { id: string; detail?: string } | undefined {
    const row = this.db.prepare(
      `SELECT id, detail FROM queries
       WHERE kind = 'search' AND engine = ? AND query = ? AND status = 'ok'
         AND ts > ? ORDER BY ts DESC LIMIT 1`,
    ).get(engine, normQuery, new Date(Date.now() - ttlSeconds * 1000).toISOString()) as { id: string; detail: string | null } | undefined
    if (!row) return undefined
    return { id: row.id, ...row.detail != null ? { detail: row.detail } : {} }
  }

  /** Look up a fresh cached operation by kind and its complete input fingerprint. */
  getCachedQuery(kind: QueryKind, cacheKey: string, ttlSeconds: number): { id: string; detail?: string } | undefined {
    const row = this.db.prepare(
      `SELECT id, detail FROM queries WHERE kind = ? AND cache_key = ? AND status = 'ok'
       AND ts > ? ORDER BY ts DESC LIMIT 1`,
    ).get(kind, cacheKey, new Date(Date.now() - ttlSeconds * 1000).toISOString()) as { id: string; detail: string | null } | undefined
    if (!row) return undefined
    return { id: row.id, ...row.detail != null ? { detail: row.detail } : {} }
  }

  recordResults(queryId: string, sources: { url: string; title?: string; snippet?: string; publishedAt?: string; extra?: string }[], engine: string): void {
    const stmt = this.db.prepare(
      'INSERT OR REPLACE INTO results (id, query_id, rank, url, title, snippet, published, engine, extra) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    )
    sources.forEach((s, i) => {
      stmt.run(uid(), queryId, i, s.url, s.title ?? null, s.snippet ?? null, s.publishedAt ?? null, engine, s.extra ?? null)
    })
  }

  resultsForQuery(queryId: string): SourceRow[] {
    return this.db.prepare(
      'SELECT * FROM results WHERE query_id = ? ORDER BY rank ASC',
    ).all(queryId) as unknown as SourceRow[]
  }

  /** Fresh page snapshot by URL, or undefined. */
  getPage(url: string, ttlSeconds: number): PageRecord | undefined {
    const row = this.db.prepare(
      `SELECT * FROM pages WHERE url = ? AND fetched_at > ? ORDER BY fetched_at DESC LIMIT 1`,
    ).get(url, new Date(Date.now() - ttlSeconds * 1000).toISOString()) as unknown as PageRecord | undefined
    return row
  }

  savePage(input: Omit<PageRecord, 'id' | 'fetchedAt'>): void {
    this.db.prepare(
      `INSERT OR REPLACE INTO pages (id, url, title, text, html_path, screenshot_path, status, fetched_at, source)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      uid(), input.url, input.title ?? null, input.text ?? null,
      input.htmlPath ?? null, input.screenshotPath ?? null, input.status ?? null,
      new Date().toISOString(), input.source ?? null,
    )
  }

  listQueries(opts: { kind?: QueryKind; query?: string; engine?: string; platform?: string; limit?: number }): QueryRecord[] {
    const limit = Math.min(Math.max(opts.limit ?? 20, 1), 200)
    const clauses: string[] = []
    const params: (string | number)[] = []
    const kind = opts.kind
    if (kind) { clauses.push('kind = ?'); params.push(kind) }
    const q = opts.query
    if (q) { clauses.push('(query LIKE ? OR url LIKE ?)'); params.push(`%${q}%`, `%${q}%`) }
    const engine = opts.engine
    if (engine) { clauses.push('engine = ?'); params.push(engine) }
    const platform = opts.platform
    if (platform) { clauses.push('platform = ?'); params.push(platform) }
    const where = clauses.length ? 'WHERE ' + clauses.join(' AND ') : ''
    return this.db.prepare(`SELECT * FROM queries ${where} ORDER BY ts DESC LIMIT ${limit}`).all(...params) as unknown as QueryRecord[]
  }

  clearCache(opts: { olderThanDays?: number; engine?: string }): { queries: number; results: number; pages: number } {
    const cutoff = opts.olderThanDays
      ? new Date(Date.now() - opts.olderThanDays * 86400_000).toISOString()
      : undefined
    let removed: { queries: number; results: number; pages: number } = { queries: 0, results: 0, pages: 0 }
    if (opts.olderThanDays === undefined) {
      const engine = opts.engine
      if (engine) {
        const ids = this.db.prepare(`SELECT id FROM queries WHERE engine = ?`).all(engine) as { id: string }[]
        for (const r of ids) this.removeQuery(r.id)
        removed.queries = ids.length
      } else {
        const q = this.db.prepare('SELECT COUNT(*) AS c FROM queries').get() as { c: number }
        const r = this.db.prepare('SELECT COUNT(*) AS c FROM results').get() as { c: number }
        const p = this.db.prepare('SELECT COUNT(*) AS c FROM pages').get() as { c: number }
        this.db.exec('DELETE FROM results; DELETE FROM queries; DELETE FROM pages')
        removed = { queries: q.c, results: r.c, pages: p.c }
      }
    } else {
      const engine = opts.engine
      const since = cutoff ?? new Date(0).toISOString()
      const rows = engine
        ? this.db.prepare(`SELECT id FROM queries WHERE ts < ? AND engine = ?`).all(since, engine) as { id: string }[]
        : this.db.prepare(`SELECT id FROM queries WHERE ts < ?`).all(since) as { id: string }[]
      for (const row of rows) this.removeQuery(row.id)
      const p = this.db.prepare(`SELECT COUNT(*) AS c FROM pages WHERE fetched_at < ?`).get(since) as { c: number }
      this.db.prepare('DELETE FROM pages WHERE fetched_at < ?').run(since)
      removed = { queries: rows.length, results: rows.length, pages: p.c }
    }
    return removed
  }

  private removeQuery(id: string): void {
    this.db.prepare('DELETE FROM results WHERE query_id = ?').run(id)
    this.db.prepare('DELETE FROM queries WHERE id = ?').run(id)
  }

  /** Delete one query and its results; returns whether it existed. */
  deleteQuery(id: string): boolean {
    const row = this.db.prepare('SELECT id FROM queries WHERE id = ?').get(id) as { id: string } | undefined
    if (!row) return false
    this.removeQuery(id)
    return true
  }

  /** Most-used engines, desc. */
  topEngines(limit = 8): { engine: string; count: number }[] {
    return this.db.prepare('SELECT engine, COUNT(*) AS count FROM queries WHERE engine IS NOT NULL GROUP BY engine ORDER BY count DESC LIMIT ?').all(limit) as unknown as { engine: string; count: number }[]
  }

  /** Most-frequent queries, desc. */
  topQueries(limit = 8): { query: string; count: number }[] {
    return this.db.prepare('SELECT query, COUNT(*) AS count FROM queries WHERE query IS NOT NULL GROUP BY query ORDER BY count DESC LIMIT ?').all(limit) as unknown as { query: string; count: number }[]
  }

  /** Per-kind record counts. */
  kindCounts(): { kind: string; count: number }[] {
    return this.db.prepare('SELECT kind, COUNT(*) AS count FROM queries GROUP BY kind ORDER BY count DESC').all() as unknown as { kind: string; count: number }[]
  }

  stats(): { dbSizeBytes: number; queries: number; results: number; pages: number; rules: number } {
    const count = (sql: string): number => (this.db.prepare(sql).get() as { c: number }).c
    let dbSizeBytes = 0
    try { dbSizeBytes = fs.statSync(this.dbPath).size } catch { /* not on disk (memory) */ }
    return {
      dbSizeBytes,
      queries: count('SELECT COUNT(*) AS c FROM queries'),
      results: count('SELECT COUNT(*) AS c FROM results'),
      pages: count('SELECT COUNT(*) AS c FROM pages'),
      rules: count('SELECT COUNT(*) AS c FROM rules'),
    }
  }

  listRules(): RuleRecord[] {
    return this.db.prepare('SELECT * FROM rules ORDER BY hostname ASC').all() as unknown as RuleRecord[]
  }

  upsertRule(hostname: string, content: string, remove?: string): void {
    const now = new Date().toISOString()
    this.db.prepare(
      `INSERT INTO rules (hostname, content, remove, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(hostname) DO UPDATE SET content = excluded.content, remove = excluded.remove, updated_at = excluded.updated_at`,
    ).run(hostname.toLowerCase(), content, remove ?? null, now, now)
  }

  removeRule(hostname: string): boolean {
    const res = this.db.prepare('DELETE FROM rules WHERE hostname = ?').run(hostname.toLowerCase())
    return res.changes > 0
  }
}
