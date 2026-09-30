/**
 * SQLite persistence for web-search-pro (node:sqlite, zero dependencies).
 * Stores search queries + results, fetched page snapshots, and user-extended
 * extraction rules (userscript-style). All methods are synchronous; writes are
 * small and batched per call.
 * @module web-search-pro/store
 */
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { uid } from "./util.js";
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
  scorer TEXT
);
CREATE INDEX IF NOT EXISTS idx_evidence_blocks_run ON evidence_blocks(run_id);
CREATE INDEX IF NOT EXISTS idx_evidence_runs_query ON evidence_runs(query_id);
CREATE INDEX IF NOT EXISTS idx_results_query ON results(query_id);
CREATE INDEX IF NOT EXISTS idx_queries_ts ON queries(ts);
CREATE INDEX IF NOT EXISTS idx_queries_kind ON queries(kind);
CREATE INDEX IF NOT EXISTS idx_pages_url ON pages(url);
`;
const PAGE_COLUMNS = 'id, query_id AS queryId, url, title, text, html_path AS htmlPath, screenshot_path AS screenshotPath, status, fetched_at AS fetchedAt, source';
export class Store {
    dbPath;
    db;
    closed = false;
    txDepth = 0;
    writeFailures = 0;
    skippedWrites = 0;
    lastError;
    onDiagnostic;
    constructor(dbPath, opts = {}) {
        this.dbPath = dbPath;
        this.onDiagnostic = opts.onDiagnostic;
        fs.mkdirSync(path.dirname(dbPath), { recursive: true });
        this.db = new DatabaseSync(dbPath);
        // busy_timeout first: every later statement (incl. the WAL switch and the
        // migration) must wait for other DSH processes sharing this file, not throw.
        this.db.exec('PRAGMA busy_timeout = ' + Math.max(Math.floor(opts.busyTimeoutMs ?? 5000), 0));
        this.db.exec('PRAGMA journal_mode = WAL');
        this.db.exec('PRAGMA synchronous = NORMAL');
        this.transaction(() => {
            this.db.exec(SCHEMA);
            const columns = this.db.prepare('PRAGMA table_info(queries)').all();
            if (!columns.some(column => column.name === 'cache_key'))
                this.db.exec('ALTER TABLE queries ADD COLUMN cache_key TEXT');
            const pageColumns = this.db.prepare('PRAGMA table_info(pages)').all();
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
        `);
            }
            this.db.exec('CREATE INDEX IF NOT EXISTS idx_queries_cache ON queries(kind, cache_key, ts)');
            this.db.exec('CREATE INDEX IF NOT EXISTS idx_pages_url ON pages(url)');
            this.db.exec('CREATE INDEX IF NOT EXISTS idx_pages_url_source ON pages(url, source, fetched_at)');
            this.db.exec('CREATE INDEX IF NOT EXISTS idx_pages_query ON pages(query_id)');
        });
    }
    close() {
        this.closed = true;
        try {
            this.db.close();
        }
        catch { /* already closed */ }
    }
    get isClosed() { return this.closed; }
    diagnostics() {
        return {
            closed: this.closed,
            writeFailures: this.writeFailures,
            skippedWrites: this.skippedWrites,
            ...this.lastError ? { lastError: this.lastError.message, lastErrorAt: this.lastError.at } : {},
        };
    }
    note(message) {
        try {
            this.onDiagnostic?.(message);
        }
        catch { /* diagnostics must never throw */ }
    }
    /** Write guard: after close() writes are no-ops (counted) instead of throwing for in-flight requests. */
    write(op, skipped, fn) {
        if (this.closed) {
            this.skippedWrites++;
            this.note('store closed: skipped ' + op);
            return skipped;
        }
        return fn();
    }
    /** Read guard: after close() reads return a cache miss. */
    read(miss, fn) {
        return this.closed ? miss : fn();
    }
    /**
     * Run best-effort persistence: a failure (SQLITE_BUSY past the timeout, disk
     * full, ...) is logged and counted but never propagates, so a search/fetch
     * that already has its result still returns it.
     */
    bestEffort(op, fn) {
        try {
            return fn();
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            this.writeFailures++;
            this.lastError = { message: op + ': ' + message, at: new Date().toISOString() };
            this.note('persistence failed (' + op + '): ' + message);
            return undefined;
        }
    }
    /**
     * Run `fn` atomically: BEGIN IMMEDIATE / COMMIT, ROLLBACK when it throws.
     * Nested calls become savepoints, so an inner failure rolls back only its own
     * writes. After close() `fn` still runs but its writes are no-ops.
     */
    transaction(fn) {
        if (this.closed)
            return fn();
        const depth = this.txDepth;
        const savepoint = 'sp_' + depth;
        this.db.exec(depth === 0 ? 'BEGIN IMMEDIATE' : 'SAVEPOINT ' + savepoint);
        this.txDepth++;
        try {
            const result = fn();
            this.txDepth--;
            this.db.exec(depth === 0 ? 'COMMIT' : 'RELEASE ' + savepoint);
            return result;
        }
        catch (error) {
            if (this.txDepth > depth)
                this.txDepth--;
            try {
                this.db.exec(depth === 0 ? 'ROLLBACK' : 'ROLLBACK TO ' + savepoint + '; RELEASE ' + savepoint);
            }
            catch { /* connection already rolled back / closed */ }
            throw error;
        }
    }
    /** Record one operation (search / fetch / platform / snapshot). Returns its id. */
    recordQuery(input) {
        const id = input.id ?? uid();
        return this.write('recordQuery', id, () => {
            const ts = new Date().toISOString();
            this.db.prepare('INSERT OR REPLACE INTO queries (id, kind, query, engine, platform, url, status, ts, detail, cache_key) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(id, input.kind, input.query ?? null, input.engine ?? null, input.platform ?? null, input.url ?? null, input.status, ts, input.detail ?? null, input.cacheKey ?? null);
            return id;
        });
    }
    /** Atomically record a search-like query and its result rows (all or nothing). */
    recordSearch(input, sources, engine) {
        const fallbackId = input.id ?? uid();
        return this.write('recordSearch', fallbackId, () => this.transaction(() => {
            const id = this.recordQuery({ ...input, id: fallbackId });
            this.recordResults(id, sources, engine);
            return id;
        }));
    }
    /** Atomically record a fetch/snapshot query and its page row (all or nothing). */
    recordFetch(input, page) {
        const fallbackId = input.id ?? uid();
        return this.write('recordFetch', fallbackId, () => this.transaction(() => {
            const id = this.recordQuery({ ...input, id: fallbackId });
            this.savePage({ ...page, queryId: id });
            return id;
        }));
    }
    /**
     * Atomically record an evidence-pipeline run: its history query + fused
     * result rows, the run (task + pack JSON) and the selected blocks' full text
     * (all or nothing). Returns the history query id.
     */
    recordEvidenceRun(input) {
        const fallbackId = input.query.id ?? uid();
        return this.write('recordEvidenceRun', fallbackId, () => this.transaction(() => {
            const queryId = this.recordSearch({ ...input.query, id: fallbackId }, input.sources, input.engine);
            this.db.prepare('INSERT OR REPLACE INTO evidence_runs (id, query_id, task_json, pack_json, created_at) VALUES (?, ?, ?, ?, ?)')
                .run(input.run.id, queryId, input.run.taskJson, input.run.packJson, new Date().toISOString());
            const stmt = this.db.prepare('INSERT OR REPLACE INTO evidence_blocks (evidence_id, run_id, url, block_id, heading, text, hash, grade, scorer) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
            for (const b of input.blocks)
                stmt.run(b.evidenceId, input.run.id, b.url, b.blockId, b.heading ?? null, b.text, b.hash ?? null, b.grade ?? null, b.scorer ?? null);
            return queryId;
        }));
    }
    evidenceBlock(evidenceId) {
        return this.read(undefined, () => this.db.prepare(`SELECT evidence_id AS evidenceId, run_id AS runId, url, block_id AS blockId, heading, text, hash, grade, scorer FROM evidence_blocks WHERE evidence_id = ?`).get(evidenceId));
    }
    evidenceRun(runId) {
        return this.read(undefined, () => this.db.prepare(`SELECT id, query_id AS queryId, task_json AS taskJson, pack_json AS packJson, created_at AS createdAt FROM evidence_runs WHERE id = ?`).get(runId));
    }
    /** Newest stored page text for a URL, regardless of age (evidence expansion reads around a block). */
    latestPage(url) {
        return this.read(undefined, () => this.db.prepare(`SELECT ${PAGE_COLUMNS} FROM pages WHERE url = ? AND text IS NOT NULL ORDER BY fetched_at DESC LIMIT 1`).get(url));
    }
    /** Look up a fresh cached operation by kind and its complete input fingerprint. */
    getCachedQuery(kind, cacheKey, ttlSeconds) {
        return this.read(undefined, () => this.getCachedQueryRow(kind, cacheKey, ttlSeconds));
    }
    getCachedQueryRow(kind, cacheKey, ttlSeconds) {
        const row = this.db.prepare(`SELECT id, detail FROM queries WHERE kind = ? AND cache_key = ? AND status = 'ok'
       AND ts > ? ORDER BY ts DESC LIMIT 1`).get(kind, cacheKey, new Date(Date.now() - ttlSeconds * 1000).toISOString());
        if (!row)
            return undefined;
        return { id: row.id, ...row.detail != null ? { detail: row.detail } : {} };
    }
    recordResults(queryId, sources, engine) {
        this.write('recordResults', undefined, () => this.transaction(() => {
            const stmt = this.db.prepare('INSERT OR REPLACE INTO results (id, query_id, rank, url, title, snippet, published, engine, extra) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
            sources.forEach((s, i) => {
                stmt.run(uid(), queryId, i, s.url, s.title ?? null, s.snippet ?? null, s.publishedAt ?? null, engine, s.extra ?? null);
            });
        }));
    }
    resultsForQuery(queryId) {
        return this.read([], () => this.db.prepare('SELECT * FROM results WHERE query_id = ? ORDER BY rank ASC').all(queryId));
    }
    queryById(id) {
        return this.read(undefined, () => this.db.prepare('SELECT * FROM queries WHERE id = ?').get(id));
    }
    /** Fresh page snapshot by URL and, when requested, its exact backend source. */
    getPage(url, ttlSeconds, source) {
        return this.read(undefined, () => this.getPageRow(url, ttlSeconds, source));
    }
    getPageRow(url, ttlSeconds, source) {
        const cutoff = new Date(Date.now() - ttlSeconds * 1000).toISOString();
        const row = source
            ? this.db.prepare(`SELECT ${PAGE_COLUMNS} FROM pages WHERE url = ? AND source = ? AND fetched_at > ? ORDER BY fetched_at DESC LIMIT 1`).get(url, source, cutoff)
            : this.db.prepare(`SELECT ${PAGE_COLUMNS} FROM pages WHERE url = ? AND fetched_at > ? ORDER BY fetched_at DESC LIMIT 1`).get(url, cutoff);
        return row;
    }
    savePage(input) {
        this.write('savePage', undefined, () => {
            this.db.prepare(`INSERT INTO pages (id, query_id, url, title, text, html_path, screenshot_path, status, fetched_at, source)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(uid(), input.queryId ?? null, input.url, input.title ?? null, input.text ?? null, input.htmlPath ?? null, input.screenshotPath ?? null, input.status ?? null, new Date().toISOString(), input.source ?? null);
        });
    }
    /** Exact persisted fetch/snapshot for a history query; legacy rows fall back by URL. */
    pageForQuery(queryId) {
        return this.read(undefined, () => this.pageForQueryRow(queryId));
    }
    pageForQueryRow(queryId) {
        const exact = this.db.prepare(`SELECT ${PAGE_COLUMNS} FROM pages WHERE query_id = ? ORDER BY fetched_at DESC LIMIT 1`).get(queryId);
        if (exact)
            return exact;
        const query = this.queryById(queryId);
        if (!query?.url)
            return undefined;
        return this.db.prepare(`SELECT ${PAGE_COLUMNS} FROM pages WHERE query_id IS NULL AND url = ? ORDER BY fetched_at DESC LIMIT 1`).get(query.url);
    }
    listQueries(opts) {
        return this.read([], () => this.listQueriesRows(opts));
    }
    listQueriesRows(opts) {
        const limit = Math.min(Math.max(opts.limit ?? 20, 1), 200);
        const clauses = [];
        const params = [];
        const kind = opts.kind;
        if (kind) {
            clauses.push('kind = ?');
            params.push(kind);
        }
        const q = opts.query;
        if (q) {
            clauses.push('(query LIKE ? OR url LIKE ?)');
            params.push(`%${q}%`, `%${q}%`);
        }
        const engine = opts.engine;
        if (engine) {
            clauses.push('engine = ?');
            params.push(engine);
        }
        const platform = opts.platform;
        if (platform) {
            clauses.push('platform = ?');
            params.push(platform);
        }
        const where = clauses.length ? 'WHERE ' + clauses.join(' AND ') : '';
        return this.db.prepare(`SELECT * FROM queries ${where} ORDER BY ts DESC LIMIT ${limit}`).all(...params);
    }
    clearCache(opts) {
        return this.write('clearCache', { queries: 0, results: 0, pages: 0 }, () => this.transaction(() => this.clearCacheRows(opts)));
    }
    clearCacheRows(opts) {
        const cutoff = opts.olderThanDays !== undefined
            ? new Date(Date.now() - Math.max(opts.olderThanDays, 0) * 86400_000).toISOString()
            : undefined;
        let removed = { queries: 0, results: 0, pages: 0 };
        if (opts.olderThanDays === undefined) {
            const engine = opts.engine;
            if (engine) {
                const q = this.db.prepare('SELECT COUNT(*) AS c FROM queries WHERE engine = ?').get(engine);
                const r = this.db.prepare('SELECT COUNT(*) AS c FROM results WHERE query_id IN (SELECT id FROM queries WHERE engine = ?)').get(engine);
                const p = this.db.prepare('SELECT COUNT(*) AS c FROM pages WHERE query_id IN (SELECT id FROM queries WHERE engine = ?)').get(engine);
                this.deleteEvidenceWhere('query_id IN (SELECT id FROM queries WHERE engine = ?)', [engine]);
                this.db.prepare('DELETE FROM pages WHERE query_id IN (SELECT id FROM queries WHERE engine = ?)').run(engine);
                this.db.prepare('DELETE FROM results WHERE query_id IN (SELECT id FROM queries WHERE engine = ?)').run(engine);
                this.db.prepare('DELETE FROM queries WHERE engine = ?').run(engine);
                removed = { queries: q.c, results: r.c, pages: p.c };
            }
            else {
                const q = this.db.prepare('SELECT COUNT(*) AS c FROM queries').get();
                const r = this.db.prepare('SELECT COUNT(*) AS c FROM results').get();
                const p = this.db.prepare('SELECT COUNT(*) AS c FROM pages').get();
                this.db.exec('DELETE FROM evidence_blocks; DELETE FROM evidence_runs; DELETE FROM results; DELETE FROM queries; DELETE FROM pages');
                removed = { queries: q.c, results: r.c, pages: p.c };
            }
        }
        else {
            const engine = opts.engine;
            const since = cutoff ?? new Date(0).toISOString();
            const rows = engine
                ? this.db.prepare(`SELECT id FROM queries WHERE ts < ? AND engine = ?`).all(since, engine)
                : this.db.prepare(`SELECT id FROM queries WHERE ts < ?`).all(since);
            const predicate = engine ? 'ts < ? AND engine = ?' : 'ts < ?';
            const params = engine ? [since, engine] : [since];
            const r = this.db.prepare(`SELECT COUNT(*) AS c FROM results WHERE query_id IN (SELECT id FROM queries WHERE ${predicate})`).get(...params);
            const legacyPredicate = engine ? '' : ' OR (query_id IS NULL AND fetched_at < ?)';
            const pageParams = engine ? params : [...params, since];
            const p = this.db.prepare(`SELECT COUNT(*) AS c FROM pages WHERE query_id IN (SELECT id FROM queries WHERE ${predicate})${legacyPredicate}`).get(...pageParams);
            this.deleteEvidenceWhere(`query_id IN (SELECT id FROM queries WHERE ${predicate})`, params);
            this.db.prepare(`DELETE FROM pages WHERE query_id IN (SELECT id FROM queries WHERE ${predicate})${legacyPredicate}`).run(...pageParams);
            this.db.prepare(`DELETE FROM results WHERE query_id IN (SELECT id FROM queries WHERE ${predicate})`).run(...params);
            this.db.prepare(`DELETE FROM queries WHERE ${predicate}`).run(...params);
            removed = { queries: rows.length, results: r.c, pages: p.c };
        }
        return removed;
    }
    /**
     * Purge search rows minted with an older cache-key version (e.g. ddg results
     * saved before the snippet-regex fix). Called once at startup so stale
     * titles-only rows are never replayed from the persistent cache.
     */
    cleanupLegacySearchCache(currentPrefix) {
        return this.write('cleanupLegacySearchCache', { queries: 0, results: 0 }, () => this.transaction(() => this.cleanupLegacyRows(currentPrefix)));
    }
    cleanupLegacyRows(currentPrefix) {
        const stale = this.db.prepare(`SELECT id FROM queries WHERE kind = 'search' AND (cache_key IS NULL OR cache_key NOT LIKE ?)`).all(currentPrefix + '%');
        let removedResults = 0;
        if (stale.length) {
            const placeholders = stale.map(() => '?').join(', ');
            const r = this.db.prepare(`SELECT COUNT(*) AS c FROM results WHERE query_id IN (${placeholders})`).get(...stale.map(s => s.id));
            removedResults = r.c;
            this.deleteEvidenceWhere(`query_id IN (${placeholders})`, stale.map(s => s.id));
            this.db.prepare(`DELETE FROM pages WHERE query_id IN (${placeholders})`).run(...stale.map(s => s.id));
            this.db.prepare(`DELETE FROM results WHERE query_id IN (${placeholders})`).run(...stale.map(s => s.id));
            this.db.prepare(`DELETE FROM queries WHERE id IN (${placeholders})`).run(...stale.map(s => s.id));
        }
        return { queries: stale.length, results: removedResults };
    }
    /** Delete evidence runs matching `predicate` (over evidence_runs) and their blocks. */
    deleteEvidenceWhere(predicate, params) {
        this.db.prepare(`DELETE FROM evidence_blocks WHERE run_id IN (SELECT id FROM evidence_runs WHERE ${predicate})`).run(...params);
        this.db.prepare(`DELETE FROM evidence_runs WHERE ${predicate}`).run(...params);
    }
    removeQuery(id) {
        this.deleteEvidenceWhere('query_id = ?', [id]);
        this.db.prepare('DELETE FROM pages WHERE query_id = ?').run(id);
        this.db.prepare('DELETE FROM results WHERE query_id = ?').run(id);
        this.db.prepare('DELETE FROM queries WHERE id = ?').run(id);
    }
    /** Delete one query and its linked rows; returns exact counts when it existed. */
    deleteQuery(id) {
        return this.write('deleteQuery', undefined, () => this.transaction(() => this.deleteQueryRows(id)));
    }
    deleteQueryRows(id) {
        const row = this.db.prepare('SELECT id FROM queries WHERE id = ?').get(id);
        if (!row)
            return undefined;
        const results = this.db.prepare('SELECT COUNT(*) AS c FROM results WHERE query_id = ?').get(id).c;
        const pages = this.db.prepare('SELECT COUNT(*) AS c FROM pages WHERE query_id = ?').get(id).c;
        this.removeQuery(id);
        return { queries: 1, results, pages };
    }
    /** Most-used engines, desc. */
    topEngines(limit = 8) {
        return this.read([], () => this.db.prepare('SELECT engine, COUNT(*) AS count FROM queries WHERE engine IS NOT NULL GROUP BY engine ORDER BY count DESC LIMIT ?').all(limit));
    }
    /** Most-frequent queries, desc. */
    topQueries(limit = 8) {
        return this.read([], () => this.db.prepare('SELECT query, COUNT(*) AS count FROM queries WHERE query IS NOT NULL GROUP BY query ORDER BY count DESC LIMIT ?').all(limit));
    }
    /** Per-kind record counts. */
    kindCounts() {
        return this.read([], () => this.db.prepare('SELECT kind, COUNT(*) AS count FROM queries GROUP BY kind ORDER BY count DESC').all());
    }
    stats() {
        return this.read({ dbSizeBytes: 0, queries: 0, results: 0, pages: 0, rules: 0 }, () => this.statsRows());
    }
    statsRows() {
        const count = (sql) => this.db.prepare(sql).get().c;
        let dbSizeBytes = 0;
        try {
            dbSizeBytes = fs.statSync(this.dbPath).size;
        }
        catch { /* not on disk (memory) */ }
        return {
            dbSizeBytes,
            queries: count('SELECT COUNT(*) AS c FROM queries'),
            results: count('SELECT COUNT(*) AS c FROM results'),
            pages: count('SELECT COUNT(*) AS c FROM pages'),
            rules: count('SELECT COUNT(*) AS c FROM rules'),
        };
    }
    listRules() {
        return this.read([], () => this.db.prepare('SELECT * FROM rules ORDER BY hostname ASC').all());
    }
    upsertRule(hostname, content, remove) {
        this.write('upsertRule', undefined, () => {
            const now = new Date().toISOString();
            this.db.prepare(`INSERT INTO rules (hostname, content, remove, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(hostname) DO UPDATE SET content = excluded.content, remove = excluded.remove, updated_at = excluded.updated_at`).run(hostname.toLowerCase(), content, remove ?? null, now, now);
        });
    }
    removeRule(hostname) {
        return this.write('removeRule', false, () => this.db.prepare('DELETE FROM rules WHERE hostname = ?').run(hostname.toLowerCase()).changes > 0);
    }
}
//# sourceMappingURL=store.js.map