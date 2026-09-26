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
  queryId?: string
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
  query_id TEXT,
  url TEXT NOT NULL,
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

const PAGE_COLUMNS = 'id, query_id AS queryId, url, title, text, html_path AS htmlPath, screenshot_path AS screenshotPath, status, fetched_at AS fetchedAt, source'

export class Store {
  private db: DatabaseSync

  constructor(readonly dbPath: string, opts: { currentSearchCacheKeyPrefix?: string } = {}) {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true })
    this.db = new DatabaseSync(dbPath)
    this.db.exec('PRAGMA journal_mode = WAL')
    this.db.exec(SCHEMA)
    const columns = this.db.prepare('PRAGMA table_info(queries)').all() as unknown as { name: string }[]
    if (!columns.some(column => column.name === 'cache_key')) this.db.exec('ALTER TABLE queries ADD COLUMN cache_key TEXT')
    const pageColumns = this.db.prepare('PRAGMA table_info(pages)').all() as unknown as { name: string }[]
    if (!pageColumns.some(column => column.name === 'query_id')) {
      this.db.exec(`
        BEGIN;
        CREATE TABLE pages_v2 (
          id TEXT PRIMARY KEY,
          query_id TEXT,
          url TEXT NOT NULL,
          title TEXT,
          text TEXT,
          html_path TEXT,
          screenshot_path TEXT,
          status INTEGER,
          fetched_at TEXT NOT NULL,
          source TEXT
        );
        INSERT INTO pages_v2 (id, query_id, url, title, text, html_path, screenshot_path, status, fetched_at, source)
          SELECT id, NULL, url, title, text, html_path, screenshot_path, status, fetched_at, source FROM pages;
        DROP TABLE pages;
        ALTER TABLE pages_v2 RENAME TO pages;
        COMMIT;
      `)
    }
    this.db.exec('CREATE INDEX IF NOT EXISTS idx_queries_cache ON queries(kind, cache_key, ts)')
    this.db.exec('CREATE INDEX IF NOT EXISTS idx_pages_url ON pages(url)')
    this.db.exec('CREATE INDEX IF NOT EXISTS idx_pages_url_source ON pages(url, source, fetched_at)')
    this.db.exec('CREATE INDEX IF NOT EXISTS idx_pages_query ON pages(query_id)')
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

  queryById(id: string): QueryRecord | undefined {
    return this.db.prepare('SELECT * FROM queries WHERE id = ?').get(id) as unknown as QueryRecord | undefined
  }

  /** Fresh page snapshot by URL and, when requested, its exact backend source. */
  getPage(url: string, ttlSeconds: number, source?: string): PageRecord | undefined {
    const cutoff = new Date(Date.now() - ttlSeconds * 1000).toISOString()
    const row = source
      ? this.db.prepare(
        `SELECT ${PAGE_COLUMNS} FROM pages WHERE url = ? AND source = ? AND fetched_at > ? ORDER BY fetched_at DESC LIMIT 1`,
      ).get(url, source, cutoff) as unknown as PageRecord | undefined
      : this.db.prepare(
        `SELECT ${PAGE_COLUMNS} FROM pages WHERE url = ? AND fetched_at > ? ORDER BY fetched_at DESC LIMIT 1`,
      ).get(url, cutoff) as unknown as PageRecord | undefined
    return row
  }

  savePage(input: Omit<PageRecord, 'id' | 'fetchedAt'>): void {
    this.db.prepare(
      `INSERT INTO pages (id, query_id, url, title, text, html_path, screenshot_path, status, fetched_at, source)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      uid(), input.queryId ?? null, input.url, input.title ?? null, input.text ?? null,
      input.htmlPath ?? null, input.screenshotPath ?? null, input.status ?? null,
      new Date().toISOString(), input.source ?? null,
    )
  }

  /** Exact persisted fetch/snapshot for a history query; legacy rows fall back by URL. */
  pageForQuery(queryId: string): PageRecord | undefined {
    const exact = this.db.prepare(
      `SELECT ${PAGE_COLUMNS} FROM pages WHERE query_id = ? ORDER BY fetched_at DESC LIMIT 1`,
    ).get(queryId) as unknown as PageRecord | undefined
    if (exact) return exact
    const query = this.queryById(queryId)
    if (!query?.url) return undefined
    return this.db.prepare(
      `SELECT ${PAGE_COLUMNS} FROM pages WHERE query_id IS NULL AND url = ? ORDER BY fetched_at DESC LIMIT 1`,
    ).get(query.url) as unknown as PageRecord | undefined
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
    const cutoff = opts.olderThanDays !== undefined
      ? new Date(Date.now() - Math.max(opts.olderThanDays, 0) * 86400_000).toISOString()
      : undefined
    let removed: { queries: number; results: number; pages: number } = { queries: 0, results: 0, pages: 0 }
    if (opts.olderThanDays === undefined) {
      const engine = opts.engine
      if (engine) {
        const q = this.db.prepare('SELECT COUNT(*) AS c FROM queries WHERE engine = ?').get(engine) as { c: number }
        const r = this.db.prepare('SELECT COUNT(*) AS c FROM results WHERE query_id IN (SELECT id FROM queries WHERE engine = ?)').get(engine) as { c: number }
        const p = this.db.prepare('SELECT COUNT(*) AS c FROM pages WHERE query_id IN (SELECT id FROM queries WHERE engine = ?)').get(engine) as { c: number }
        this.db.prepare('DELETE FROM pages WHERE query_id IN (SELECT id FROM queries WHERE engine = ?)').run(engine)
        this.db.prepare('DELETE FROM results WHERE query_id IN (SELECT id FROM queries WHERE engine = ?)').run(engine)
        this.db.prepare('DELETE FROM queries WHERE engine = ?').run(engine)
        removed = { queries: q.c, results: r.c, pages: p.c }
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
      const predicate = engine ? 'ts < ? AND engine = ?' : 'ts < ?'
      const params = engine ? [since, engine] : [since]
      const r = this.db.prepare(`SELECT COUNT(*) AS c FROM results WHERE query_id IN (SELECT id FROM queries WHERE ${predicate})`).get(...params) as { c: number }
      const legacyPredicate = engine ? '' : ' OR (query_id IS NULL AND fetched_at < ?)'
      const pageParams = engine ? params : [...params, since]
      const p = this.db.prepare(`SELECT COUNT(*) AS c FROM pages WHERE query_id IN (SELECT id FROM queries WHERE ${predicate})${legacyPredicate}`).get(...pageParams) as { c: number }
      this.db.prepare(`DELETE FROM pages WHERE query_id IN (SELECT id FROM queries WHERE ${predicate})${legacyPredicate}`).run(...pageParams)
      this.db.prepare(`DELETE FROM results WHERE query_id IN (SELECT id FROM queries WHERE ${predicate})`).run(...params)
      this.db.prepare(`DELETE FROM queries WHERE ${predicate}`).run(...params)
      removed = { queries: rows.length, results: r.c, pages: p.c }
    }
    return removed
  }

  /**
   * Purge search rows minted with an older cache-key version (e.g. ddg results
   * saved before the snippet-regex fix). Called once at startup so stale
   * titles-only rows are never replayed from the persistent cache.
   */
  cleanupLegacySearchCache(currentPrefix: string): { queries: number; results: number } {
    const stale = this.db.prepare(
      `SELECT id FROM queries WHERE kind = 'search' AND (cache_key IS NULL OR cache_key NOT LIKE ?)`,
    ).all(currentPrefix + '%') as unknown as { id: string }[]
    let removedResults = 0
    if (stale.length) {
      const placeholders = stale.map(() => '?').join(', ')
      const r = this.db.prepare(`SELECT COUNT(*) AS c FROM results WHERE query_id IN (${placeholders})`).get(...stale.map(s => s.id)) as { c: number }
      removedResults = r.c
      this.db.prepare(`DELETE FROM pages WHERE query_id IN (${placeholders})`).run(...stale.map(s => s.id))
      this.db.prepare(`DELETE FROM results WHERE query_id IN (${placeholders})`).run(...stale.map(s => s.id))
      this.db.prepare(`DELETE FROM queries WHERE id IN (${placeholders})`).run(...stale.map(s => s.id))
    }
    return { queries: stale.length, results: removedResults }
  }

  private removeQuery(id: string): void {
    this.db.prepare('DELETE FROM pages WHERE query_id = ?').run(id)
    this.db.prepare('DELETE FROM results WHERE query_id = ?').run(id)
    this.db.prepare('DELETE FROM queries WHERE id = ?').run(id)
  }

  /** Delete one query and its linked rows; returns exact counts when it existed. */
  deleteQuery(id: string): { queries: number; results: number; pages: number } | undefined {
    const row = this.db.prepare('SELECT id FROM queries WHERE id = ?').get(id) as { id: string } | undefined
    if (!row) return undefined
    const results = (this.db.prepare('SELECT COUNT(*) AS c FROM results WHERE query_id = ?').get(id) as { c: number }).c
    const pages = (this.db.prepare('SELECT COUNT(*) AS c FROM pages WHERE query_id = ?').get(id) as { c: number }).c
    this.removeQuery(id)
    return { queries: 1, results, pages }
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
