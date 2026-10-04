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

export interface EvidenceBlockRow {
  evidenceId: string
  runId: string
  url: string
  blockId: string
  heading?: string
  text: string
  hash?: string
  grade?: number
  scorer?: string
  /** `id@version#hash` of the judge rubric when a Jev-based scorer graded the block. */
  rubric?: string
  /** `provider|protocol|model[|calibration]` of the model judge that graded the block (dev-plan M5). */
  judge?: string
}

/** One model call (or reservation) of the usage ledger (design §9). */
export interface UsageRow {
  id: string
  ts: string
  /** Calendar day (YYYY-MM-DD) in the configured budget time zone at reservation time. */
  day: string
  searchId?: string
  provider: string
  protocol: string
  model?: string
  /** reserved: estimate held while the call runs (counts against the caps); settled: final; released: refused or failed without billing. */
  status: 'reserved' | 'settled' | 'released'
  requests: number
  inputTokens: number
  outputTokens: number
  /** Some token figures are the plugin's estimate (the service reported none, or the call outcome is unknown). */
  estimated: boolean
  /** Money spent in `currency`; null = price unknown (never 0). */
  amount: number | null
  currency?: string
  note?: string
}

export interface UsageTotals { requests: number; inputTokens: number; outputTokens: number; estimated: boolean; calls: number; amount: number | null; currency?: string }

export interface EvidenceRunRow {
  id: string
  queryId?: string
  taskJson: string
  packJson: string
  createdAt: string
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
CREATE TABLE IF NOT EXISTS evidence_runs (
  id TEXT PRIMARY KEY,
  query_id TEXT,
  task_json TEXT NOT NULL,
  pack_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS evidence_blocks (
  evidence_id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  url TEXT NOT NULL,
  block_id TEXT NOT NULL,
  heading TEXT,
  text TEXT NOT NULL,
  hash TEXT,
  grade REAL,
  scorer TEXT,
  rubric TEXT,
  judge TEXT
);
CREATE TABLE IF NOT EXISTS usage_ledger (
  id TEXT PRIMARY KEY,
  ts TEXT NOT NULL,
  day TEXT NOT NULL,
  search_id TEXT,
  provider TEXT NOT NULL,
  protocol TEXT NOT NULL,
  model TEXT,
  status TEXT NOT NULL,
  requests INTEGER NOT NULL DEFAULT 0,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  estimated INTEGER NOT NULL DEFAULT 0,
  amount REAL,
  currency TEXT,
  note TEXT
);
CREATE INDEX IF NOT EXISTS idx_usage_day ON usage_ledger(day, provider);
CREATE INDEX IF NOT EXISTS idx_evidence_blocks_run ON evidence_blocks(run_id);
CREATE INDEX IF NOT EXISTS idx_evidence_runs_query ON evidence_runs(query_id);
CREATE INDEX IF NOT EXISTS idx_results_query ON results(query_id);
CREATE INDEX IF NOT EXISTS idx_queries_ts ON queries(ts);
CREATE INDEX IF NOT EXISTS idx_queries_kind ON queries(kind);
CREATE INDEX IF NOT EXISTS idx_pages_url ON pages(url);
`

const PAGE_COLUMNS = 'id, query_id AS queryId, url, title, text, html_path AS htmlPath, screenshot_path AS screenshotPath, status, fetched_at AS fetchedAt, source'

/** Persistence health counters; never throws, safe to read after close. */
export interface StoreDiagnostics {
  closed: boolean
  /** Writes that threw (e.g. SQLITE_BUSY after the busy timeout). */
  writeFailures: number
  /** Writes silently skipped because the store was already closed. */
  skippedWrites: number
  lastError?: string
  lastErrorAt?: string
}

export interface StoreOptions {
  currentSearchCacheKeyPrefix?: string
  /** SQLite busy timeout; concurrent writers wait this long instead of failing at once. */
  busyTimeoutMs?: number
  /** Receives one line per persistence failure / skipped write. */
  onDiagnostic?: (message: string) => void
}

export class Store {
  private db: DatabaseSync
  private closed = false
  private txDepth = 0
  private writeFailures = 0
  private skippedWrites = 0
  private lastError: { message: string; at: string } | undefined
  private readonly onDiagnostic: ((message: string) => void) | undefined

  constructor(readonly dbPath: string, opts: StoreOptions = {}) {
    this.onDiagnostic = opts.onDiagnostic
    fs.mkdirSync(path.dirname(dbPath), { recursive: true })
    this.db = new DatabaseSync(dbPath)
    // busy_timeout first: every later statement (incl. the WAL switch and the
    // migration) must wait for other DSH processes sharing this file, not throw.
    this.db.exec('PRAGMA busy_timeout = ' + Math.max(Math.floor(opts.busyTimeoutMs ?? 5000), 0))
    this.db.exec('PRAGMA journal_mode = WAL')
    this.db.exec('PRAGMA synchronous = NORMAL')
    this.transaction(() => {
      this.db.exec(SCHEMA)
      const columns = this.db.prepare('PRAGMA table_info(queries)').all() as unknown as { name: string }[]
      if (!columns.some(column => column.name === 'cache_key')) this.db.exec('ALTER TABLE queries ADD COLUMN cache_key TEXT')
      const blockColumns = this.db.prepare('PRAGMA table_info(evidence_blocks)').all() as unknown as { name: string }[]
      if (!blockColumns.some(column => column.name === 'rubric')) this.db.exec('ALTER TABLE evidence_blocks ADD COLUMN rubric TEXT')
      if (!blockColumns.some(column => column.name === 'judge')) this.db.exec('ALTER TABLE evidence_blocks ADD COLUMN judge TEXT')
      const pageColumns = this.db.prepare('PRAGMA table_info(pages)').all() as unknown as { name: string }[]
      if (!pageColumns.some(column => column.name === 'query_id')) {
        this.db.exec(`
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
        `)
      }
      this.db.exec('CREATE INDEX IF NOT EXISTS idx_queries_cache ON queries(kind, cache_key, ts)')
      this.db.exec('CREATE INDEX IF NOT EXISTS idx_pages_url ON pages(url)')
      this.db.exec('CREATE INDEX IF NOT EXISTS idx_pages_url_source ON pages(url, source, fetched_at)')
      this.db.exec('CREATE INDEX IF NOT EXISTS idx_pages_query ON pages(query_id)')
    })
  }

  close(): void {
    this.closed = true
    try { this.db.close() } catch { /* already closed */ }
  }

  get isClosed(): boolean { return this.closed }

  diagnostics(): StoreDiagnostics {
    return {
      closed: this.closed,
      writeFailures: this.writeFailures,
      skippedWrites: this.skippedWrites,
      ...this.lastError ? { lastError: this.lastError.message, lastErrorAt: this.lastError.at } : {},
    }
  }

  private note(message: string): void {
    try { this.onDiagnostic?.(message) } catch { /* diagnostics must never throw */ }
  }

  /** Write guard: after close() writes are no-ops (counted) instead of throwing for in-flight requests. */
  private write<T>(op: string, skipped: T, fn: () => T): T {
    if (this.closed) {
      this.skippedWrites++
      this.note('store closed: skipped ' + op)
      return skipped
    }
    return fn()
  }

  /** Read guard: after close() reads return a cache miss. */
  private read<T>(miss: T, fn: () => T): T {
    return this.closed ? miss : fn()
  }

  /**
   * Run best-effort persistence: a failure (SQLITE_BUSY past the timeout, disk
   * full, ...) is logged and counted but never propagates, so a search/fetch
   * that already has its result still returns it.
   */
  bestEffort<T>(op: string, fn: () => T): T | undefined {
    try {
      return fn()
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.writeFailures++
      this.lastError = { message: op + ': ' + message, at: new Date().toISOString() }
      this.note('persistence failed (' + op + '): ' + message)
      return undefined
    }
  }

  /**
   * Run `fn` atomically: BEGIN IMMEDIATE / COMMIT, ROLLBACK when it throws.
   * Nested calls become savepoints, so an inner failure rolls back only its own
   * writes. After close() `fn` still runs but its writes are no-ops.
   */
  transaction<T>(fn: () => T): T {
    if (this.closed) return fn()
    const depth = this.txDepth
    const savepoint = 'sp_' + depth
    this.db.exec(depth === 0 ? 'BEGIN IMMEDIATE' : 'SAVEPOINT ' + savepoint)
    this.txDepth++
    try {
      const result = fn()
      this.txDepth--
      this.db.exec(depth === 0 ? 'COMMIT' : 'RELEASE ' + savepoint)
      return result
    } catch (error) {
      if (this.txDepth > depth) this.txDepth--
      try {
        this.db.exec(depth === 0 ? 'ROLLBACK' : 'ROLLBACK TO ' + savepoint + '; RELEASE ' + savepoint)
      } catch { /* connection already rolled back / closed */ }
      throw error
    }
  }

  /** Record one operation (search / fetch / platform / snapshot). Returns its id. */
  recordQuery(input: Omit<QueryRecord, 'id' | 'ts'> & { id?: string }): string {
    const id = input.id ?? uid()
    return this.write('recordQuery', id, () => {
      const ts = new Date().toISOString()
      this.db.prepare(
        'INSERT OR REPLACE INTO queries (id, kind, query, engine, platform, url, status, ts, detail, cache_key) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      ).run(id, input.kind, input.query ?? null, input.engine ?? null, input.platform ?? null, input.url ?? null, input.status, ts, input.detail ?? null, input.cacheKey ?? null)
      return id
    })
  }

  /** Atomically record a search-like query and its result rows (all or nothing). */
  recordSearch(
    input: Omit<QueryRecord, 'id' | 'ts'> & { id?: string },
    sources: { url: string; title?: string; snippet?: string; publishedAt?: string; extra?: string }[],
    engine: string,
  ): string {
    const fallbackId = input.id ?? uid()
    return this.write('recordSearch', fallbackId, () => this.transaction(() => {
      const id = this.recordQuery({ ...input, id: fallbackId })
      this.recordResults(id, sources, engine)
      return id
    }))
  }

  /** Atomically record a fetch/snapshot query and its page row (all or nothing). */
  recordFetch(input: Omit<QueryRecord, 'id' | 'ts'> & { id?: string }, page: Omit<PageRecord, 'id' | 'fetchedAt' | 'queryId'>): string {
    const fallbackId = input.id ?? uid()
    return this.write('recordFetch', fallbackId, () => this.transaction(() => {
      const id = this.recordQuery({ ...input, id: fallbackId })
      this.savePage({ ...page, queryId: id })
      return id
    }))
  }

  /**
   * Atomically record an evidence-pipeline run: its history query + fused
   * result rows, the run (task + pack JSON) and the selected blocks' full text
   * (all or nothing). Returns the history query id.
   */
  recordEvidenceRun(input: {
    query: Omit<QueryRecord, 'id' | 'ts'> & { id?: string }
    sources: { url: string; title?: string; snippet?: string; publishedAt?: string; extra?: string }[]
    engine: string
    run: { id: string; taskJson: string; packJson: string }
    blocks: readonly Omit<EvidenceBlockRow, 'runId'>[]
  }): string {
    const fallbackId = input.query.id ?? uid()
    return this.write('recordEvidenceRun', fallbackId, () => this.transaction(() => {
      const queryId = this.recordSearch({ ...input.query, id: fallbackId }, input.sources, input.engine)
      this.db.prepare('INSERT OR REPLACE INTO evidence_runs (id, query_id, task_json, pack_json, created_at) VALUES (?, ?, ?, ?, ?)')
        .run(input.run.id, queryId, input.run.taskJson, input.run.packJson, new Date().toISOString())
      const stmt = this.db.prepare('INSERT OR REPLACE INTO evidence_blocks (evidence_id, run_id, url, block_id, heading, text, hash, grade, scorer, rubric, judge) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      for (const b of input.blocks) stmt.run(b.evidenceId, input.run.id, b.url, b.blockId, b.heading ?? null, b.text, b.hash ?? null, b.grade ?? null, b.scorer ?? null, b.rubric ?? null, b.judge ?? null)
      return queryId
    }))
  }

  // ── usage ledger (dev-plan M5, design §9) ──────────────────────────────────

  /**
   * Reserve `inputTokens` for a model call, atomically across processes sharing this file
   * (BEGIN IMMEDIATE): refused when today's reserved + settled input tokens, over all providers or
   * for this provider, plus the request would pass a daily cap. Reserved rows count until settled,
   * so a crash between reserve and settle never frees the tokens. A closed or failing store refuses.
   */
  reserveUsage(input: {
    id: string; ts: string; day: string; searchId?: string; provider: string; protocol: string; model?: string
    inputTokens: number; dailyCap?: number; providerDailyCap?: number
  }): { ok: true } | { ok: false; scope: 'daily' | 'provider-daily' | 'unavailable'; used: number; cap: number } {
    if (this.closed) return { ok: false, scope: 'unavailable', used: 0, cap: 0 }
    try {
      return this.transaction(() => {
        const sum = (provider?: string): number => (this.db.prepare(
          `SELECT COALESCE(SUM(input_tokens), 0) AS t FROM usage_ledger WHERE day = ? AND status != 'released'` + (provider ? ' AND provider = ?' : ''),
        ).get(...provider ? [input.day, provider] : [input.day]) as { t: number }).t
        if (input.dailyCap !== undefined) {
          const used = sum()
          if (used + input.inputTokens > input.dailyCap) return { ok: false as const, scope: 'daily' as const, used, cap: input.dailyCap }
        }
        if (input.providerDailyCap !== undefined) {
          const used = sum(input.provider)
          if (used + input.inputTokens > input.providerDailyCap) return { ok: false as const, scope: 'provider-daily' as const, used, cap: input.providerDailyCap }
        }
        this.db.prepare(
          `INSERT INTO usage_ledger (id, ts, day, search_id, provider, protocol, model, status, requests, input_tokens, output_tokens, estimated, amount, currency, note)
           VALUES (?, ?, ?, ?, ?, ?, ?, 'reserved', 0, ?, 0, 1, NULL, NULL, NULL)`,
        ).run(input.id, input.ts, input.day, input.searchId ?? null, input.provider, input.protocol, input.model ?? null, input.inputTokens)
        return { ok: true as const }
      })
    } catch (error) {
      this.note('usage reserve failed: ' + (error as Error).message)
      return { ok: false, scope: 'unavailable', used: 0, cap: 0 }
    }
  }

  /**
   * Requests booked for a request-counted provider (protocol `search`): over all time and on `day`. A settled row counts its
   * `requests`, an open reservation counts one (a crash never frees it), a released row none.
   */
  requestCounts(provider: string, day: string): { total: number; today: number } {
    return this.read({ total: 0, today: 0 }, () => {
      const sum = (extra: string, ...params: string[]): number => (this.db.prepare(
        `SELECT COALESCE(SUM(CASE WHEN status = 'reserved' THEN 1 ELSE requests END), 0) AS n FROM usage_ledger WHERE provider = ? AND protocol = 'search' AND status != 'released'` + extra,
      ).get(provider, ...params) as { n: number }).n
      return { total: sum(''), today: sum(' AND day = ?', day) }
    })
  }

  /**
   * Reserve ONE request of a request-capped source, atomically across processes sharing this file (BEGIN IMMEDIATE), like
   * {@link reserveUsage} does for tokens: refused when the all-time `total` or today's `daily` cap would be passed. A closed or
   * failing store refuses.
   */
  reserveRequest(input: { id: string; ts: string; day: string; searchId?: string; provider: string; protocol: string; total?: number; daily?: number }): { ok: true } | { ok: false; scope: 'total' | 'daily' | 'unavailable'; used: number; cap: number } {
    if (this.closed) return { ok: false, scope: 'unavailable', used: 0, cap: 0 }
    try {
      return this.transaction(() => {
        const count = (extra: string, ...params: string[]): number => (this.db.prepare(
          `SELECT COALESCE(SUM(CASE WHEN status = 'reserved' THEN 1 ELSE requests END), 0) AS n FROM usage_ledger WHERE provider = ? AND protocol = 'search' AND status != 'released'` + extra,
        ).get(input.provider, ...params) as { n: number }).n
        if (input.total !== undefined) {
          const used = count('')
          if (used + 1 > input.total) return { ok: false as const, scope: 'total' as const, used, cap: input.total }
        }
        if (input.daily !== undefined) {
          const used = count(' AND day = ?', input.day)
          if (used + 1 > input.daily) return { ok: false as const, scope: 'daily' as const, used, cap: input.daily }
        }
        this.db.prepare(
          `INSERT INTO usage_ledger (id, ts, day, search_id, provider, protocol, model, status, requests, input_tokens, output_tokens, estimated, amount, currency, note)
           VALUES (?, ?, ?, ?, ?, ?, NULL, 'reserved', 0, 0, 0, 0, NULL, NULL, NULL)`,
        ).run(input.id, input.ts, input.day, input.searchId ?? null, input.provider, input.protocol)
        return { ok: true as const }
      })
    } catch (error) {
      this.note('request reserve failed: ' + (error as Error).message)
      return { ok: false, scope: 'unavailable', used: 0, cap: 0 }
    }
  }

  /** Close a reservation: final tokens (actual, or the estimate flagged `estimated`) and amount (null = unknown price). */
  settleUsage(id: string, final: { status: 'settled' | 'released'; requests: number; inputTokens: number; outputTokens: number; estimated: boolean; amount: number | null; currency?: string; note?: string }): void {
    this.write('settleUsage', undefined, () => {
      this.db.prepare(
        'UPDATE usage_ledger SET status = ?, requests = ?, input_tokens = ?, output_tokens = ?, estimated = ?, amount = ?, currency = ?, note = ? WHERE id = ?',
      ).run(final.status, final.requests, final.inputTokens, final.outputTokens, final.estimated ? 1 : 0, final.amount, final.currency ?? null, final.note ?? null, id)
    })
  }

  /** Ledger rows of one day, oldest first (optionally one provider). */
  usageRows(day: string, provider?: string): UsageRow[] {
    type Raw = { id: string; ts: string; day: string; searchId: string | null; provider: string; protocol: string; model: string | null; status: UsageRow['status']; requests: number; inputTokens: number; outputTokens: number; estimated: number; amount: number | null; currency: string | null; note: string | null }
    return this.read([], () => (this.db.prepare(
      `SELECT id, ts, day, search_id AS searchId, provider, protocol, model, status, requests, input_tokens AS inputTokens, output_tokens AS outputTokens, estimated, amount, currency, note
       FROM usage_ledger WHERE day = ?` + (provider ? ' AND provider = ?' : '') + ' ORDER BY rowid ASC',
    ).all(...provider ? [day, provider] : [day]) as unknown as Raw[]).map((r): UsageRow => ({
      id: r.id, ts: r.ts, day: r.day, provider: r.provider, protocol: r.protocol, status: r.status, requests: r.requests,
      inputTokens: r.inputTokens, outputTokens: r.outputTokens, estimated: r.estimated === 1, amount: r.amount,
      ...r.searchId !== null ? { searchId: r.searchId } : {}, ...r.model !== null ? { model: r.model } : {},
      ...r.currency !== null ? { currency: r.currency } : {}, ...r.note !== null ? { note: r.note } : {},
    })))
  }

  /** Per-provider totals of one day over reserved and settled rows (released rows only add their request). */
  usageByProvider(day: string): (UsageTotals & { provider: string; protocol: string })[] {
    const out = new Map<string, UsageTotals & { provider: string; protocol: string }>()
    for (const r of this.usageRows(day)) {
      const t = out.get(r.provider) ?? { provider: r.provider, protocol: r.protocol, requests: 0, inputTokens: 0, outputTokens: 0, estimated: false, calls: 0, amount: 0 as number | null }
      t.requests += r.requests
      if (r.status !== 'released') { t.inputTokens += r.inputTokens; t.outputTokens += r.outputTokens; t.calls++ }
      if (r.estimated && r.status !== 'released') t.estimated = true
      // A day's amount is known only when every billed row has one.
      if (r.status !== 'released') { t.amount = t.amount !== null && r.amount !== null ? t.amount + r.amount : null; if (r.currency) t.currency = r.currency }
      out.set(r.provider, t)
    }
    return [...out.values()]
  }

  evidenceBlock(evidenceId: string): EvidenceBlockRow | undefined {
    return this.read(undefined, () => this.db.prepare(
      `SELECT evidence_id AS evidenceId, run_id AS runId, url, block_id AS blockId, heading, text, hash, grade, scorer, rubric, judge FROM evidence_blocks WHERE evidence_id = ?`,
    ).get(evidenceId) as unknown as EvidenceBlockRow | undefined)
  }

  evidenceRun(runId: string): EvidenceRunRow | undefined {
    return this.read(undefined, () => this.db.prepare(
      `SELECT id, query_id AS queryId, task_json AS taskJson, pack_json AS packJson, created_at AS createdAt FROM evidence_runs WHERE id = ?`,
    ).get(runId) as unknown as EvidenceRunRow | undefined)
  }

  /** Newest stored page text for a URL, regardless of age (evidence expansion reads around a block). */
  latestPage(url: string): PageRecord | undefined {
    return this.read(undefined, () => this.db.prepare(
      `SELECT ${PAGE_COLUMNS} FROM pages WHERE url = ? AND text IS NOT NULL ORDER BY fetched_at DESC LIMIT 1`,
    ).get(url) as unknown as PageRecord | undefined)
  }

  /** Look up a fresh cached operation by kind and its complete input fingerprint. */
  getCachedQuery(kind: QueryKind, cacheKey: string, ttlSeconds: number): { id: string; detail?: string } | undefined {
    return this.read(undefined, () => this.getCachedQueryRow(kind, cacheKey, ttlSeconds))
  }

  private getCachedQueryRow(kind: QueryKind, cacheKey: string, ttlSeconds: number): { id: string; detail?: string } | undefined {
    const row = this.db.prepare(
      `SELECT id, detail FROM queries WHERE kind = ? AND cache_key = ? AND status = 'ok'
       AND ts > ? ORDER BY ts DESC LIMIT 1`,
    ).get(kind, cacheKey, new Date(Date.now() - ttlSeconds * 1000).toISOString()) as { id: string; detail: string | null } | undefined
    if (!row) return undefined
    return { id: row.id, ...row.detail != null ? { detail: row.detail } : {} }
  }

  recordResults(queryId: string, sources: { url: string; title?: string; snippet?: string; publishedAt?: string; extra?: string }[], engine: string): void {
    this.write('recordResults', undefined, () => this.transaction(() => {
      const stmt = this.db.prepare(
        'INSERT OR REPLACE INTO results (id, query_id, rank, url, title, snippet, published, engine, extra) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      )
      sources.forEach((s, i) => {
        stmt.run(uid(), queryId, i, s.url, s.title ?? null, s.snippet ?? null, s.publishedAt ?? null, engine, s.extra ?? null)
      })
    }))
  }

  resultsForQuery(queryId: string): SourceRow[] {
    return this.read([], () => this.db.prepare(
      'SELECT * FROM results WHERE query_id = ? ORDER BY rank ASC',
    ).all(queryId) as unknown as SourceRow[])
  }

  queryById(id: string): QueryRecord | undefined {
    return this.read(undefined, () => this.db.prepare('SELECT * FROM queries WHERE id = ?').get(id) as unknown as QueryRecord | undefined)
  }

  /** Fresh page snapshot by URL and, when requested, its exact backend source. */
  getPage(url: string, ttlSeconds: number, source?: string): PageRecord | undefined {
    return this.read(undefined, () => this.getPageRow(url, ttlSeconds, source))
  }

  private getPageRow(url: string, ttlSeconds: number, source?: string): PageRecord | undefined {
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
    this.write('savePage', undefined, () => {
      this.db.prepare(
        `INSERT INTO pages (id, query_id, url, title, text, html_path, screenshot_path, status, fetched_at, source)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        uid(), input.queryId ?? null, input.url, input.title ?? null, input.text ?? null,
        input.htmlPath ?? null, input.screenshotPath ?? null, input.status ?? null,
        new Date().toISOString(), input.source ?? null,
      )
    })
  }

  /** Exact persisted fetch/snapshot for a history query; legacy rows fall back by URL. */
  pageForQuery(queryId: string): PageRecord | undefined {
    return this.read(undefined, () => this.pageForQueryRow(queryId))
  }

  private pageForQueryRow(queryId: string): PageRecord | undefined {
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
    return this.read([], () => this.listQueriesRows(opts))
  }

  private listQueriesRows(opts: { kind?: QueryKind; query?: string; engine?: string; platform?: string; limit?: number }): QueryRecord[] {
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
    return this.write('clearCache', { queries: 0, results: 0, pages: 0 }, () => this.transaction(() => this.clearCacheRows(opts)))
  }

  private clearCacheRows(opts: { olderThanDays?: number; engine?: string }): { queries: number; results: number; pages: number } {
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
        this.deleteEvidenceWhere('query_id IN (SELECT id FROM queries WHERE engine = ?)', [engine])
        this.db.prepare('DELETE FROM pages WHERE query_id IN (SELECT id FROM queries WHERE engine = ?)').run(engine)
        this.db.prepare('DELETE FROM results WHERE query_id IN (SELECT id FROM queries WHERE engine = ?)').run(engine)
        this.db.prepare('DELETE FROM queries WHERE engine = ?').run(engine)
        removed = { queries: q.c, results: r.c, pages: p.c }
      } else {
        const q = this.db.prepare('SELECT COUNT(*) AS c FROM queries').get() as { c: number }
        const r = this.db.prepare('SELECT COUNT(*) AS c FROM results').get() as { c: number }
        const p = this.db.prepare('SELECT COUNT(*) AS c FROM pages').get() as { c: number }
        this.db.exec('DELETE FROM evidence_blocks; DELETE FROM evidence_runs; DELETE FROM results; DELETE FROM queries; DELETE FROM pages')
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
      this.deleteEvidenceWhere(`query_id IN (SELECT id FROM queries WHERE ${predicate})`, params)
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
    return this.write('cleanupLegacySearchCache', { queries: 0, results: 0 }, () => this.transaction(() => this.cleanupLegacyRows(currentPrefix)))
  }

  private cleanupLegacyRows(currentPrefix: string): { queries: number; results: number } {
    const stale = this.db.prepare(
      `SELECT id FROM queries WHERE kind = 'search' AND (cache_key IS NULL OR cache_key NOT LIKE ?)`,
    ).all(currentPrefix + '%') as unknown as { id: string }[]
    let removedResults = 0
    if (stale.length) {
      const placeholders = stale.map(() => '?').join(', ')
      const r = this.db.prepare(`SELECT COUNT(*) AS c FROM results WHERE query_id IN (${placeholders})`).get(...stale.map(s => s.id)) as { c: number }
      removedResults = r.c
      this.deleteEvidenceWhere(`query_id IN (${placeholders})`, stale.map(s => s.id))
      this.db.prepare(`DELETE FROM pages WHERE query_id IN (${placeholders})`).run(...stale.map(s => s.id))
      this.db.prepare(`DELETE FROM results WHERE query_id IN (${placeholders})`).run(...stale.map(s => s.id))
      this.db.prepare(`DELETE FROM queries WHERE id IN (${placeholders})`).run(...stale.map(s => s.id))
    }
    return { queries: stale.length, results: removedResults }
  }

  /** Delete evidence runs matching `predicate` (over evidence_runs) and their blocks. */
  private deleteEvidenceWhere(predicate: string, params: (string | number)[]): void {
    this.db.prepare(`DELETE FROM evidence_blocks WHERE run_id IN (SELECT id FROM evidence_runs WHERE ${predicate})`).run(...params)
    this.db.prepare(`DELETE FROM evidence_runs WHERE ${predicate}`).run(...params)
  }

  private removeQuery(id: string): void {
    this.deleteEvidenceWhere('query_id = ?', [id])
    this.db.prepare('DELETE FROM pages WHERE query_id = ?').run(id)
    this.db.prepare('DELETE FROM results WHERE query_id = ?').run(id)
    this.db.prepare('DELETE FROM queries WHERE id = ?').run(id)
  }

  /** Delete one query and its linked rows; returns exact counts when it existed. */
  deleteQuery(id: string): { queries: number; results: number; pages: number } | undefined {
    return this.write('deleteQuery', undefined, () => this.transaction(() => this.deleteQueryRows(id)))
  }

  private deleteQueryRows(id: string): { queries: number; results: number; pages: number } | undefined {
    const row = this.db.prepare('SELECT id FROM queries WHERE id = ?').get(id) as { id: string } | undefined
    if (!row) return undefined
    const results = (this.db.prepare('SELECT COUNT(*) AS c FROM results WHERE query_id = ?').get(id) as { c: number }).c
    const pages = (this.db.prepare('SELECT COUNT(*) AS c FROM pages WHERE query_id = ?').get(id) as { c: number }).c
    this.removeQuery(id)
    return { queries: 1, results, pages }
  }

  /** Most-used engines, desc. */
  topEngines(limit = 8): { engine: string; count: number }[] {
    return this.read([], () => this.db.prepare('SELECT engine, COUNT(*) AS count FROM queries WHERE engine IS NOT NULL GROUP BY engine ORDER BY count DESC LIMIT ?').all(limit) as unknown as { engine: string; count: number }[])
  }

  /** Most-frequent queries, desc. */
  topQueries(limit = 8): { query: string; count: number }[] {
    return this.read([], () => this.db.prepare('SELECT query, COUNT(*) AS count FROM queries WHERE query IS NOT NULL GROUP BY query ORDER BY count DESC LIMIT ?').all(limit) as unknown as { query: string; count: number }[])
  }

  /** Per-kind record counts. */
  kindCounts(): { kind: string; count: number }[] {
    return this.read([], () => this.db.prepare('SELECT kind, COUNT(*) AS count FROM queries GROUP BY kind ORDER BY count DESC').all() as unknown as { kind: string; count: number }[])
  }

  stats(): { dbSizeBytes: number; queries: number; results: number; pages: number; rules: number } {
    return this.read({ dbSizeBytes: 0, queries: 0, results: 0, pages: 0, rules: 0 }, () => this.statsRows())
  }

  private statsRows(): { dbSizeBytes: number; queries: number; results: number; pages: number; rules: number } {
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
    return this.read([], () => this.db.prepare('SELECT * FROM rules ORDER BY hostname ASC').all() as unknown as RuleRecord[])
  }

  upsertRule(hostname: string, content: string, remove?: string): void {
    this.write('upsertRule', undefined, () => {
      const now = new Date().toISOString()
      this.db.prepare(
        `INSERT INTO rules (hostname, content, remove, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(hostname) DO UPDATE SET content = excluded.content, remove = excluded.remove, updated_at = excluded.updated_at`,
      ).run(hostname.toLowerCase(), content, remove ?? null, now, now)
    })
  }

  removeRule(hostname: string): boolean {
    return this.write('removeRule', false, () => this.db.prepare('DELETE FROM rules WHERE hostname = ?').run(hostname.toLowerCase()).changes > 0)
  }
}
