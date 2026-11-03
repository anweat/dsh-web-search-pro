import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { runCli, tempHome, FIXTURE } from './helpers.ts'
import { syncSnapshot, loadSnapshot, cachePath, SyncError } from '../src/index.ts'

test('sync --from <fixture> writes the cache in the temp home and search then uses it', async () => {
  const t = tempHome()
  try {
    const r = await runCli(['sync', '--from', FIXTURE, '--json'], t.home)
    assert.equal(r.code, 0, r.stderr)
    const doc = JSON.parse(r.stdout)
    assert.equal(doc.ok, true)
    assert.equal(doc.sync.status, 'updated')
    assert.equal(doc.sync.count, 8)
    assert.equal(doc.sync.mode, 'local')
    assert.ok(existsSync(cachePath(t.home)))

    const info = JSON.parse((await runCli(['info', '--json'], t.home)).stdout)
    assert.equal(info.loaded_from, 'cache')
    assert.equal(info.entries, 8)

    const found = JSON.parse((await runCli(['search', 'cat', 'facts', '--json'], t.home)).stdout)
    assert.equal(found.items[0].name, 'Cat Facts')
    assert.equal(found.total, 2)
  } finally {
    t.cleanup()
  }
})

test('syncSnapshot library: from file, sha handling with a git-less path', async () => {
  const t = tempHome()
  try {
    const res = await syncSnapshot({ from: FIXTURE, home: t.home })
    assert.equal(res.count, 8)
    assert.equal(res.skipped, 2)
    assert.equal(loadSnapshot({ home: t.home }).origin, 'cache')
    await assert.rejects(syncSnapshot({ from: '/no/such/file.md', home: t.home }), SyncError)
  } finally {
    t.cleanup()
  }
})

test('network sync logic with an injected fetch: unchanged sha is skipped, --force is not', async () => {
  const t = tempHome()
  try {
    const { readFileSync } = await import('node:fs')
    const md = readFileSync(FIXTURE, 'utf8')
    const calls: string[] = []
    const sha = 'a'.repeat(40)
    const fetchImpl = (async (url: string | URL | Request) => {
      const u = String(url)
      calls.push(u)
      if (u.includes('api.github.com')) return new Response(JSON.stringify({ sha, commit: { committer: { date: '2026-01-01T00:00:00Z' } } }), { status: 200 })
      return new Response(md, { status: 200 })
    }) as typeof fetch
    const first = await syncSnapshot({ home: t.home, fetchImpl })
    assert.equal(first.status, 'updated')
    assert.equal(first.sha, sha)
    assert.equal(calls.length, 2)
    const second = await syncSnapshot({ home: t.home, fetchImpl })
    assert.equal(second.status, 'unchanged')
    assert.equal(calls.length, 3, 'only the commit lookup, no README download')
    const forced = await syncSnapshot({ home: t.home, fetchImpl, force: true })
    assert.equal(forced.status, 'updated')
    assert.equal(calls.length, 5)
  } finally {
    t.cleanup()
  }
})

test('commit lookup failure is tolerated (sha null); README failure is a clear error', async () => {
  const t = tempHome()
  try {
    const { readFileSync } = await import('node:fs')
    const md = readFileSync(FIXTURE, 'utf8')
    const ok = (async (url: string | URL | Request) =>
      String(url).includes('api.github.com') ? new Response('rate limited', { status: 403 }) : new Response(md)) as typeof fetch
    const res = await syncSnapshot({ home: t.home, fetchImpl: ok })
    assert.equal(res.sha, null)
    assert.equal(res.status, 'updated')

    const bad = (async () => new Response('nope', { status: 500, statusText: 'Server Error' })) as typeof fetch
    await assert.rejects(syncSnapshot({ home: t.home, fetchImpl: bad, commitsUrl: '' }), /HTTP 500/)
    const down = (async () => { throw new TypeError('fetch failed') }) as typeof fetch
    await assert.rejects(syncSnapshot({ home: t.home, fetchImpl: down, commitsUrl: '' }), /NODE_USE_ENV_PROXY=1/)
    assert.equal(loadSnapshot({ home: t.home }).snapshot.entries.length, 8, 'failed syncs keep the old cache')
  } finally {
    t.cleanup()
  }
})
