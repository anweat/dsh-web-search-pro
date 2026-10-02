import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { expandEvidence, EXPAND_MAX_CHARS } from '../src/history.ts'
import { splitBlocks } from '../src/pipeline/blocks.ts'
import { Store } from '../src/store.ts'

function tmp(): { dir: string; file: string; done: () => void } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wsp-store-evidence-'))
  return { dir, file: path.join(dir, 'store.db'), done: () => fs.rmSync(dir, { recursive: true, force: true }) }
}
const tables = (file: string): string[] => {
  const db = new DatabaseSync(file)
  try { return (db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all() as { name: string }[]).map(r => r.name) } finally { db.close() }
}
const run = (id: string, blocks: { evidenceId: string; url: string; blockId: string; text: string; hash?: string }[], over: { query?: string; engine?: string } = {}) => ({
  query: { kind: 'search' as const, query: over.query ?? 'q ' + id, engine: over.engine ?? 'pipeline', status: 'ok' },
  sources: [{ url: 'https://ex.test/' + id, title: 'T' }],
  engine: over.engine ?? 'pipeline',
  run: { id, taskJson: '{"goal":"g"}', packJson: JSON.stringify({ resultId: id, evidence: blocks.map(b => ({ evidenceId: b.evidenceId, title: 'Title ' + b.evidenceId })) }) },
  blocks: blocks.map(b => ({ ...b, heading: 'H', hash: b.hash ?? 'hash-' + b.evidenceId, grade: 2.5, scorer: 'rule' })),
})

test('migration: evidence tables are added to an existing M2a database, idempotently, without touching old data', () => {
  const t = tmp()
  try {
    // A database as M2a left it: only the old tables, with a row in each of two.
    const db = new DatabaseSync(t.file)
    db.exec(`CREATE TABLE queries (id TEXT PRIMARY KEY, kind TEXT NOT NULL, query TEXT, engine TEXT, platform TEXT, url TEXT, status TEXT NOT NULL, ts TEXT NOT NULL, detail TEXT, cache_key TEXT);
      CREATE TABLE results (id TEXT PRIMARY KEY, query_id TEXT NOT NULL, rank INTEGER NOT NULL, url TEXT NOT NULL, title TEXT, snippet TEXT, published TEXT, engine TEXT, extra TEXT);
      CREATE TABLE pages (id TEXT PRIMARY KEY, query_id TEXT, url TEXT NOT NULL, title TEXT, text TEXT, html_path TEXT, screenshot_path TEXT, status INTEGER, fetched_at TEXT NOT NULL, source TEXT);
      CREATE TABLE rules (hostname TEXT PRIMARY KEY, content TEXT NOT NULL, remove TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      INSERT INTO queries (id, kind, query, engine, status, ts) VALUES ('old', 'search', 'old query', 'ddg', 'ok', '2026-01-01T00:00:00Z');
      INSERT INTO results (id, query_id, rank, url) VALUES ('r', 'old', 0, 'https://old.test/');`)
    db.close()
    assert.ok(!tables(t.file).includes('evidence_runs'))
    for (let i = 0; i < 3; i++) {
      const store = new Store(t.file)
      assert.equal(store.queryById('old')!.query, 'old query')
      assert.equal(store.resultsForQuery('old').length, 1)
      store.close()
    }
    const names = tables(t.file)
    assert.ok(names.includes('evidence_runs') && names.includes('evidence_blocks'))
    const check = new DatabaseSync(t.file)
    const cols = (table: string): string[] => (check.prepare('PRAGMA table_info(' + table + ')').all() as { name: string }[]).map(c => c.name)
    assert.deepEqual(cols('evidence_runs'), ['id', 'query_id', 'task_json', 'pack_json', 'created_at'])
    assert.deepEqual(cols('evidence_blocks'), ['evidence_id', 'run_id', 'url', 'block_id', 'heading', 'text', 'hash', 'grade', 'scorer', 'rubric'])
    check.close()
  } finally { t.done() }
})

test('migration: evidence_blocks of an M2b-M3 database gains the rubric column; rubric round-trips', () => {
  const t = tmp()
  try {
    const db = new DatabaseSync(t.file)
    db.exec(`CREATE TABLE evidence_blocks (evidence_id TEXT PRIMARY KEY, run_id TEXT NOT NULL, url TEXT NOT NULL, block_id TEXT NOT NULL, heading TEXT, text TEXT NOT NULL, hash TEXT, grade REAL, scorer TEXT);
      INSERT INTO evidence_blocks (evidence_id, run_id, url, block_id, text, scorer) VALUES ('eold', 'rold', 'https://old.test/', 'b', 'old text', 'rule');`)
    db.close()
    for (let i = 0; i < 2; i++) {
      const store = new Store(t.file)
      assert.equal(store.evidenceBlock('eold')!.text, 'old text')
      assert.equal(store.evidenceBlock('eold')!.rubric, null)
      store.close()
    }
    const store = new Store(t.file)
    try {
      store.recordEvidenceRun({ ...run('rj', []), blocks: [{ evidenceId: 'ej', url: 'https://ex.test/j', blockId: 'b', text: 't', scorer: 'jev', rubric: 'score.support@v1#abc' }] })
      assert.equal(store.evidenceBlock('ej')!.rubric, 'score.support@v1#abc')
    } finally { store.close() }
  } finally { t.done() }
})

test('recordEvidenceRun is atomic: a failing block leaves no query, result, run or block behind', () => {
  const t = tmp()
  const store = new Store(t.file, { onDiagnostic: () => {} })
  try {
    const good = run('r1', [{ evidenceId: 'e1', url: 'https://ex.test/a', blockId: 'b1', text: 'hello' }])
    const queryId = store.recordEvidenceRun(good)
    assert.equal(store.queryById(queryId)!.engine, 'pipeline')
    assert.equal(store.evidenceBlock('e1')!.text, 'hello')
    assert.equal(store.evidenceBlock('e1')!.runId, 'r1')
    assert.equal(store.evidenceRun('r1')!.queryId, queryId)

    const bad = run('r2', [{ evidenceId: 'e2', url: 'https://ex.test/b', blockId: 'b2', text: 'ok' }, { evidenceId: 'e3', url: 'https://ex.test/c', blockId: 'b3', text: null as unknown as string }])
    assert.throws(() => store.recordEvidenceRun(bad), /NOT NULL/)
    assert.equal(store.evidenceRun('r2'), undefined)
    assert.equal(store.evidenceBlock('e2'), undefined)
    assert.equal(store.listQueries({ query: 'q r2' }).length, 0)
    assert.equal(store.stats().queries, 1)
    assert.equal(store.bestEffort('persist', () => store.recordEvidenceRun(bad)), undefined, 'bestEffort swallows and counts it')
    assert.equal(store.diagnostics().writeFailures, 1)
    // INSERT OR REPLACE: re-recording the same run replaces its blocks
    store.recordEvidenceRun({ ...good, blocks: [{ ...good.blocks[0]!, text: 'changed' }] })
    assert.equal(store.evidenceBlock('e1')!.text, 'changed')
  } finally { store.close(); t.done() }
})

test('after close, evidence writes are skipped and reads miss', () => {
  const t = tmp()
  const notes: string[] = []
  const store = new Store(t.file, { onDiagnostic: m => notes.push(m) })
  store.recordEvidenceRun(run('r1', [{ evidenceId: 'e1', url: 'https://ex.test/a', blockId: 'b1', text: 'x' }]))
  store.close()
  try {
    store.recordEvidenceRun(run('r2', [{ evidenceId: 'e2', url: 'https://ex.test/a', blockId: 'b2', text: 'x' }]))
    assert.equal(store.diagnostics().skippedWrites, 1)
    assert.equal(store.evidenceBlock('e1'), undefined)
    assert.equal(store.evidenceRun('r1'), undefined)
  } finally { t.done() }
})

test('evidence rows follow their history query: deleteQuery, clearCache (all / by engine / by age) and the legacy purge', () => {
  const t = tmp()
  const store = new Store(t.file)
  try {
    const add = (id: string, engine = 'pipeline'): string => store.recordEvidenceRun(run(id, [{ evidenceId: 'e_' + id, url: 'https://ex.test/' + id, blockId: 'b_' + id, text: id }], { engine }))
    const q1 = add('one')
    add('two')
    assert.deepEqual(store.deleteQuery(q1), { queries: 1, results: 1, pages: 0 })
    assert.equal(store.evidenceRun('one'), undefined)
    assert.equal(store.evidenceBlock('e_one'), undefined)
    assert.ok(store.evidenceRun('two'))

    add('three', 'other')
    store.clearCache({ engine: 'other' })
    assert.equal(store.evidenceBlock('e_three'), undefined)
    assert.ok(store.evidenceBlock('e_two'))

    // age: everything older than "now" goes (timestamps have millisecond resolution)
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10)
    store.clearCache({ olderThanDays: 0 })
    assert.equal(store.evidenceBlock('e_two'), undefined)

    add('four')
    add('five')
    store.clearCache({})
    assert.equal(store.evidenceRun('four'), undefined)
    assert.equal(store.evidenceBlock('e_five'), undefined)

    // legacy purge (cache_key IS NULL rows of kind search) cascades too
    add('six')
    assert.deepEqual(store.cleanupLegacySearchCache('search:v4:'), { queries: 1, results: 1 })
    assert.equal(store.evidenceRun('six'), undefined)
    assert.equal(store.evidenceBlock('e_six'), undefined)
  } finally { store.close(); t.done() }
})

// ── expansion ───────────────────────────────────────────────────────────────

const para = (label: string, size: number): string => label + ' ' + ('sentence. '.repeat(Math.ceil(size / 10))).slice(0, size)

function pageWith(store: Store, url: string, text: string): ReturnType<typeof splitBlocks> {
  store.savePage({ url, title: 'Page', text, source: 'http' })
  return splitBlocks(text, url)
}

test('expand returns the block with its previous and next block, keeping the match whole', () => {
  const t = tmp()
  const store = new Store(t.file)
  try {
    const url = 'https://ex.test/doc'
    const text = ['# One', para('alpha', 500), '# Two', para('beta', 500), '# Three', para('gamma', 500)].join('\n\n')
    const blocks = pageWith(store, url, text)
    assert.ok(blocks.length >= 3)
    const mid = blocks[1]!
    store.recordEvidenceRun(run('r1', [{ evidenceId: 'e1', url, blockId: mid.blockId, text: mid.text }]))
    const out = expandEvidence(store, 'e1')
    assert.deepEqual(out.blocks.map(b => b.position), ['before', 'match', 'after'])
    assert.equal(out.blocks[0]!.text, blocks[0]!.text)
    assert.equal(out.blocks[1]!.text, mid.text)
    assert.equal(out.blocks[2]!.text, blocks[2]!.text)
    assert.equal(out.title, 'Title e1')
    assert.equal(out.note, undefined)
    // first block: no 'before'
    store.recordEvidenceRun(run('r2', [{ evidenceId: 'e2', url, blockId: blocks[0]!.blockId, text: blocks[0]!.text }]))
    assert.deepEqual(expandEvidence(store, 'e2').blocks.map(b => b.position), ['match', 'after'])
  } finally { store.close(); t.done() }
})

test('expand caps the output at 4000 characters: the neighbours shrink before the match does', () => {
  const t = tmp()
  const store = new Store(t.file)
  try {
    const url = 'https://ex.test/long'
    const text = ['# A', para('before', 1100), '# B', para('match', 1100), '# C', para('after', 1100)].join('\n\n')
    const blocks = pageWith(store, url, text)
    const mid = blocks[1]!
    store.recordEvidenceRun(run('r1', [{ evidenceId: 'e1', url, blockId: mid.blockId, text: mid.text }]))
    const roomy = expandEvidence(store, 'e1')
    assert.ok(roomy.blocks.reduce((n, b) => n + b.text.length, 0) <= EXPAND_MAX_CHARS)
    assert.ok(!roomy.blocks.some(b => b.truncated), 'three ~1.1k blocks fit under 4000')
    const tight = expandEvidence(store, 'e1', 1500)
    assert.ok(tight.blocks.reduce((n, b) => n + b.text.length, 0) <= 1500)
    assert.equal(tight.blocks.find(b => b.position === 'match')!.text, mid.text, 'the match stays whole')
    assert.ok(tight.blocks.filter(b => b.position !== 'match').every(b => b.truncated))
    assert.ok(tight.blocks[0]!.text.startsWith('…') && tight.blocks[2]!.text.endsWith('…'))
    const huge = 'h'.repeat(6000)
    store.recordEvidenceRun(run('r2', [{ evidenceId: 'e2', url: 'https://ex.test/none', blockId: 'bx', text: huge }]))
    const cut = expandEvidence(store, 'e2')
    assert.equal(cut.blocks.length, 1)
    assert.equal(cut.blocks[0]!.text.length, EXPAND_MAX_CHARS)
    assert.equal(cut.blocks[0]!.truncated, true)
  } finally { store.close(); t.done() }
})

test('expand degrades gracefully: missing page, changed page, unknown id, normalized URL lookup', () => {
  const t = tmp()
  const store = new Store(t.file)
  try {
    store.recordEvidenceRun(run('r1', [{ evidenceId: 'e1', url: 'https://ex.test', blockId: 'b_gone', text: 'stored block text' }]))
    const missing = expandEvidence(store, 'e1')
    assert.deepEqual(missing.blocks.map(b => b.position), ['match'])
    assert.match(missing.note!, /page snapshot is no longer stored/)
    // the stored page is keyed by the normalised URL (trailing slash) and no longer has the block
    store.savePage({ url: 'https://ex.test/', text: 'Completely different content now.', source: 'http' })
    assert.match(expandEvidence(store, 'e1').note!, /no longer contains this block/)
    assert.throws(() => expandEvidence(store, 'e_missing'), /evidence id not found: e_missing/)
    // the block id is stale (the page shifted) but the content hash still finds it, with its neighbour
    const text = '# H\n\nHello world paragraph for hashing.\n\n# I\n\nSecond paragraph follows here.'
    const blocks = splitBlocks(text, 'https://ex.test/h')
    store.savePage({ url: 'https://ex.test/h', text: '\n\n\n' + text, source: 'http' })
    store.recordEvidenceRun(run('r2', [{ evidenceId: 'e2', url: 'https://ex.test/h', blockId: 'b_stale', text: blocks[0]!.text, hash: blocks[0]!.hash }]))
    const shifted = expandEvidence(store, 'e2')
    assert.equal(shifted.note, undefined)
    assert.deepEqual(shifted.blocks.map(b => b.position), ['match', 'after'])
    assert.equal(shifted.blocks[1]!.text, blocks[1]!.text)
  } finally { store.close(); t.done() }
})
