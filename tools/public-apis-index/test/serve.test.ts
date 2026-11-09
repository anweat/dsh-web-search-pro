import { test } from 'node:test'
import assert from 'node:assert/strict'
import { startServer, writeSnapshotFile, cachePath, parseReadme, loadSnapshot } from '../src/index.ts'
import type { SyncResult } from '../src/index.ts'
import { readFileSync } from 'node:fs'
import { once } from 'node:events'
import { spawnCli, tempHome, FIXTURE } from './helpers.ts'

const get = async (base: string, path: string) => {
  const res = await fetch(base + path)
  return { status: res.status, headers: res.headers, body: await res.json() as any }
}

test('serve: /health, /search, /categories, errors, CORS', async () => {
  const t = tempHome()
  const s = await startServer({ port: 0, home: t.home })
  try {
    assert.equal(s.host, '127.0.0.1')
    const health = await get(s.url, '/health')
    assert.equal(health.status, 200)
    assert.equal(health.body.ok, true)
    assert.ok(health.body.entries > 2000)
    assert.equal(health.headers.get('access-control-allow-origin'), '*')

    const search = await get(s.url, '/search?q=' + encodeURIComponent('天气') + '&limit=3&auth=none&https=true')
    assert.equal(search.status, 200)
    assert.equal(search.body.ok, true)
    assert.equal(search.body.items.length, 3)
    assert.ok(search.body.items.every((i: any) => i.auth === 'none' && i.https === true))
    assert.equal(search.headers.get('access-control-allow-origin'), '*')

    const cats = await get(s.url, '/categories')
    assert.ok(cats.body.categories.length > 45)

    const bad = await get(s.url, '/search?q=x&auth=bogus')
    assert.equal(bad.status, 400)
    assert.equal(bad.body.ok, false)
    assert.equal((await get(s.url, '/nope')).status, 404)

    const post = await fetch(s.url + '/sync', { method: 'POST' })
    assert.equal(post.status, 403, 'POST /sync needs --allow-sync')
  } finally {
    await s.close()
    t.cleanup()
  }
})

test('serve: POST /sync with --allow-sync (injected sync) hot-swaps the index', async () => {
  const t = tempHome()
  const fixtureEntries = parseReadme(readFileSync(FIXTURE, 'utf8'))
  const syncFn = async (): Promise<SyncResult> => {
    writeSnapshotFile(cachePath(t.home), {
      schemaVersion: 1,
      source: { repo: 'x/y', sha: 'b'.repeat(40), commitDate: null, fetchedAt: new Date().toISOString(), url: 'test' },
      entries: fixtureEntries,
    })
    return { status: 'updated', mode: 'network', count: fixtureEntries.length, skipped: 0, sha: 'b'.repeat(40), previousSha: null, commitDate: null, fetchedAt: '', path: cachePath(t.home) }
  }
  const s = await startServer({ port: 0, home: t.home, allowSync: true, syncFn })
  try {
    assert.ok((await get(s.url, '/health')).body.entries > 2000)
    const res = await fetch(s.url + '/sync', { method: 'POST' })
    assert.equal(res.status, 200)
    const health = await get(s.url, '/health')
    assert.equal(health.body.entries, 8)
    assert.equal(health.body.loaded_from, 'cache')
  } finally {
    await s.close()
    t.cleanup()
  }
})

test('serve --refresh: background sync swaps the index; failures keep the old one', async () => {
  const t = tempHome()
  const fixtureEntries = parseReadme(readFileSync(FIXTURE, 'utf8'))
  const logs: string[] = []
  let call = 0
  const syncFn = async (): Promise<SyncResult> => {
    call++
    if (call === 1) throw new Error('boom')
    writeSnapshotFile(cachePath(t.home), {
      schemaVersion: 1,
      source: { repo: 'x/y', sha: 'c'.repeat(40), commitDate: null, fetchedAt: new Date().toISOString(), url: 'test' },
      entries: fixtureEntries,
    })
    return { status: 'updated', mode: 'network', count: 8, skipped: 0, sha: 'c'.repeat(40), previousSha: null, commitDate: null, fetchedAt: '', path: '' }
  }
  const s = await startServer({ port: 0, home: t.home, refreshMs: 40, syncFn, log: l => logs.push(l) })
  try {
    for (let i = 0; i < 100 && (await get(s.url, '/health')).body.entries !== 8; i++) await new Promise(r => setTimeout(r, 25))
    assert.equal((await get(s.url, '/health')).body.entries, 8)
    assert.ok(logs.some(l => /refresh failed.*boom/.test(l)), logs.join('\n'))
    assert.equal(loadSnapshot({ home: t.home }).snapshot.entries.length, 8)
  } finally {
    await s.close()
    t.cleanup()
  }
})

test('CLI serve --port 0 prints its URL and answers /health', async () => {
  const t = tempHome()
  const child = spawnCli(['serve', '--port', '0'], t.home)
  try {
    const url = await new Promise<string>((resolve, reject) => {
      let buf = ''
      child.stdout!.on('data', d => {
        buf += d
        const m = /listening on (http:\/\/\S+)/.exec(buf)
        if (m) resolve(m[1]!)
      })
      child.on('close', () => reject(new Error('serve exited early')))
      setTimeout(() => reject(new Error('timeout waiting for serve')), 10_000)
    })
    assert.match(url, /^http:\/\/127\.0\.0\.1:\d+$/)
    const health = await get(url, '/health')
    assert.equal(health.body.ok, true)
  } finally {
    child.kill('SIGTERM')
    await once(child, 'close')
    t.cleanup()
  }
})
