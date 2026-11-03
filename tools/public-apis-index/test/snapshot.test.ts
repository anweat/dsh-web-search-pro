import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadSnapshot, writeSnapshotFile, cachePath, cacheHome, isValidSnapshot, parseReadme } from '../src/index.ts'

test('bundled snapshot is large and has many categories', () => {
  const { snapshot, origin } = loadSnapshot({ bundledOnly: true })
  assert.equal(origin, 'bundled')
  assert.ok(snapshot.entries.length > 2000, `entries: ${snapshot.entries.length}`)
  assert.ok(new Set(snapshot.entries.map(e => e.category)).size > 45)
  assert.equal(snapshot.source.repo, 'public-apis/public-apis')
  assert.equal(snapshot.source.sha, '2676ca49d557ef14a0f478311506dae947639028')
  assert.ok(isValidSnapshot(snapshot))
  assert.ok(snapshot.entries.every(e => !/utm_/i.test(e.url)))
})

test('bundled snapshot has the expected auth vocabulary', () => {
  const { snapshot } = loadSnapshot({ bundledOnly: true })
  const auths = new Set(snapshot.entries.map(e => e.auth))
  for (const a of ['none', 'apiKey', 'OAuth']) assert.ok(auths.has(a), a)
})

test('cache snapshot wins when valid; invalid cache falls back to bundled', () => {
  const home = mkdtempSync(join(tmpdir(), 'pai-snap-'))
  try {
    assert.equal(loadSnapshot({ home }).origin, 'bundled')
    const entries = parseReadme('### Zoo\n| API | Description | Auth | HTTPS | CORS |\n|---|---|---|---|---|\n| [A](https://a.example/) | d | No | Yes | No |\n')
    writeSnapshotFile(cachePath(home), {
      schemaVersion: 1,
      source: { repo: 'x/y', sha: 'abc', commitDate: null, fetchedAt: new Date().toISOString(), url: 'u' },
      entries,
    })
    const loaded = loadSnapshot({ home })
    assert.equal(loaded.origin, 'cache')
    assert.equal(loaded.snapshot.entries.length, 1)
    assert.deepEqual(readdirSync(home), ['snapshot.json'], 'no temp files left behind')
    writeFileSync(cachePath(home), '{ not json')
    assert.equal(loadSnapshot({ home }).origin, 'bundled')
    writeFileSync(cachePath(home), JSON.stringify({ schemaVersion: 2, source: {}, entries: [] }))
    assert.equal(loadSnapshot({ home }).origin, 'bundled')
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

test('cacheHome honours PUBLIC_APIS_INDEX_HOME', () => {
  assert.equal(cacheHome({ PUBLIC_APIS_INDEX_HOME: '/x/y' }), '/x/y')
  assert.ok(cacheHome({}).endsWith('.cache/public-apis-index'))
})
