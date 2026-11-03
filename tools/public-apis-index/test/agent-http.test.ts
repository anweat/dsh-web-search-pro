import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { once } from 'node:events'
import { startServer, serverFilePath, readServerInfo } from '../src/index.ts'
import { runCli, spawnCli, tempHome } from './helpers.ts'

const text = async (url: string) => {
  const res = await fetch(url)
  return { status: res.status, type: res.headers.get('content-type') ?? '', body: await res.text() }
}

test('GET / and /help: plain-text agent guide with the bound host:port', async () => {
  const t = tempHome()
  const s = await startServer({ port: 0, home: t.home })
  try {
    for (const path of ['/', '/help']) {
      const r = await text(s.url + path)
      assert.equal(r.status, 200)
      assert.match(r.type, /^text\/plain/)
      assert.ok(r.body.includes(`Base URL: ${s.url}`))
      assert.ok(r.body.includes(`curl -sS -G ${s.url}/search`))
      for (const needle of ['/api/<id>', '/categories', '/health', 'keyless=1', 'format=text', 'pretty=1']) assert.ok(r.body.includes(needle), needle)
      assert.ok(r.body.split('\n').length <= 60, `guide has ${r.body.split('\n').length} lines`)
    }
  } finally {
    await s.close()
    t.cleanup()
  }
})

test('GET /search format=text is compact; json is one line unless pretty=1', async () => {
  const t = tempHome()
  const s = await startServer({ port: 0, home: t.home })
  try {
    const r = await text(`${s.url}/search?q=${encodeURIComponent('天气')}&limit=3&keyless=1&https=1&format=text`)
    assert.equal(r.status, 200)
    assert.match(r.type, /^text\/plain/)
    const lines = r.body.trimEnd().split('\n')
    assert.match(lines[0]!, /^total: \d+ \(showing 3\) \| query: 天气 \| terms: weather$/)
    const items = lines.filter(l => !l.startsWith('total:') && !l.startsWith('note:') && !l.startsWith('#'))
    assert.equal(items.length, 3)
    for (const l of items) {
      const cols = l.split(' | ')
      assert.equal(cols.length, 8, l)
      assert.equal(cols[2], 'none')
      assert.equal(cols[3], 'yes')
      assert.match(cols[5]!, /^https?:\/\//)
      assert.match(cols[7]!, /^id=[0-9a-f]+/)
    }

    const compact = await text(`${s.url}/search?q=weather&limit=2`)
    assert.equal(compact.body.trimEnd().split('\n').length, 1)
    const doc = JSON.parse(compact.body)
    assert.equal(doc.items.length, 2)
    assert.ok(doc.items.every((i: { how_to_call: string }) => typeof i.how_to_call === 'string' && i.how_to_call.length > 0))
    const pretty = await text(`${s.url}/search?q=weather&limit=2&pretty=1`)
    assert.ok(pretty.body.split('\n').length > 10)
    assert.deepEqual(JSON.parse(pretty.body), doc)

    const bad = await text(`${s.url}/search?q=x&format=xml`)
    assert.equal(bad.status, 400)
  } finally {
    await s.close()
    t.cleanup()
  }
})

test('keyless=1 is auth=none; conflicting auth is a 400', async () => {
  const t = tempHome()
  const s = await startServer({ port: 0, home: t.home })
  try {
    const a = JSON.parse((await text(`${s.url}/search?q=weather&keyless=1&limit=50`)).body)
    const b = JSON.parse((await text(`${s.url}/search?q=weather&auth=none&limit=50`)).body)
    assert.deepEqual(a.items.map((i: { id: string }) => i.id), b.items.map((i: { id: string }) => i.id))
    assert.ok(a.items.every((i: { auth: string }) => i.auth === 'none'))
    assert.equal((await text(`${s.url}/search?q=weather&keyless=1&auth=apikey`)).status, 400)
  } finally {
    await s.close()
    t.cleanup()
  }
})

test('GET /api/<id>: json and text, with how_to_call by auth kind', async () => {
  const t = tempHome()
  const s = await startServer({ port: 0, home: t.home })
  try {
    const keyless = JSON.parse((await text(`${s.url}/search?q=weather&keyless=1&limit=1`)).body).items[0]
    const keyed = JSON.parse((await text(`${s.url}/search?q=weather&auth=apikey&limit=1`)).body).items[0]

    const one = JSON.parse((await text(`${s.url}/api/${keyless.id}`)).body)
    assert.equal(one.ok, true)
    assert.equal(one.item.id, keyless.id)
    assert.equal(one.item.how_to_call, `no key needed: read the docs at ${keyless.url} to find the endpoint, then curl it`)

    const k = JSON.parse((await text(`${s.url}/api/${keyed.id}`)).body)
    assert.equal(k.item.how_to_call, 'needs apiKey: only use if the user supplies a key; never invent or hardcode keys')

    const t1 = await text(`${s.url}/api/${keyless.id}?format=text`)
    assert.match(t1.type, /^text\/plain/)
    assert.match(t1.body, /^name: /)
    assert.ok(t1.body.includes(`docs: ${keyless.url}`))
    assert.ok(t1.body.includes('how_to_call: no key needed'))

    const missing = await text(`${s.url}/api/doesnotexist`)
    assert.equal(missing.status, 404)
    assert.equal(JSON.parse(missing.body).ok, false)
  } finally {
    await s.close()
    t.cleanup()
  }
})

test('server.json is written on start and removed on close; readServerInfo checks the pid', async () => {
  const t = tempHome()
  const s = await startServer({ port: 0, home: t.home, serverFile: true })
  try {
    const file = serverFilePath(t.home)
    assert.ok(existsSync(file))
    const info = JSON.parse(readFileSync(file, 'utf8'))
    assert.equal(info.url, s.url)
    assert.equal(info.pid, process.pid)
    assert.ok(!Number.isNaN(Date.parse(info.startedAt)))
    assert.equal(readServerInfo(t.home)?.url, s.url)
    writeFileSync(file, JSON.stringify({ url: 'http://127.0.0.1:1', pid: 2 ** 22 + 12345, startedAt: new Date().toISOString() }))
    assert.equal(readServerInfo(t.home), null, 'dead pid is not a running server')
    writeFileSync(file, JSON.stringify({ url: s.url, pid: process.pid, startedAt: new Date().toISOString() }))
  } finally {
    await s.close()
  }
  assert.ok(!existsSync(serverFilePath(t.home)), 'removed on close')
  t.cleanup()
})

test('serve --port 0 prints the real port, writes server.json, `url` finds it, SIGTERM cleans up', async () => {
  const t = tempHome()
  const none = await runCli(['url'], t.home)
  assert.equal(none.code, 1)
  assert.match(none.stderr, /no running/)
  const noneJson = await runCli(['url', '--json'], t.home)
  assert.equal(noneJson.code, 1)
  assert.equal(JSON.parse(noneJson.stdout).error.code, 'not_running')

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
      setTimeout(() => reject(new Error('timeout')), 10_000)
    })
    assert.doesNotMatch(url, /:0$/)
    assert.ok(existsSync(serverFilePath(t.home)))
    const found = await runCli(['url'], t.home)
    assert.equal(found.code, 0)
    assert.equal(found.stdout.trim(), url)
    const foundJson = JSON.parse((await runCli(['url', '--json'], t.home)).stdout)
    assert.equal(foundJson.url, url)
    assert.equal(foundJson.pid, child.pid)
    const guide = await text(url + '/')
    assert.ok(guide.body.includes(`Base URL: ${url}`))
  } finally {
    child.kill('SIGTERM')
    await once(child, 'close')
  }
  assert.ok(!existsSync(serverFilePath(t.home)), 'server.json removed after SIGTERM')
  assert.equal((await runCli(['url'], t.home)).code, 1)
  t.cleanup()
})
