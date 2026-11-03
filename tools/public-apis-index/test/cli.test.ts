import { test } from 'node:test'
import assert from 'node:assert/strict'
import { runCli, tempHome } from './helpers.ts'

const t = tempHome()
test.after(() => t.cleanup())

test('search --json prints exactly one document with the documented fields', async () => {
  const r = await runCli(['search', 'weather', '--json', '--limit', '3'], t.home)
  assert.equal(r.code, 0)
  const doc = JSON.parse(r.stdout)
  assert.equal(doc.ok, true)
  assert.equal(doc.schema_version, 1)
  assert.equal(doc.query, 'weather')
  assert.deepEqual(doc.terms, ['weather'])
  assert.ok(doc.total > 3)
  assert.ok(Array.isArray(doc.notes))
  assert.equal(doc.items.length, 3)
  for (const it of doc.items) {
    for (const k of ['name', 'url', 'description', 'category', 'auth', 'https', 'cors', 'score', 'title', 'snippet']) assert.ok(k in it, k)
    assert.equal(typeof it.https, 'boolean')
    assert.equal(it.title, `${it.name} — ${it.category}`)
  }
  assert.match(doc.source.sha, /^[0-9a-f]{40}$/)
  assert.ok(doc.source.fetchedAt)
})

test('search with no results is ok with exit code 0', async () => {
  const r = await runCli(['search', 'zzzqqxxnothing', '--json'], t.home)
  assert.equal(r.code, 0)
  const doc = JSON.parse(r.stdout)
  assert.equal(doc.ok, true)
  assert.equal(doc.total, 0)
  assert.deepEqual(doc.items, [])
})

test('search handles Chinese, filters and a dash-leading query', async () => {
  const zh = JSON.parse((await runCli(['search', '天气', '--json', '--limit', '2', '--auth', 'none', '--https'], t.home)).stdout)
  assert.equal(zh.items.length, 2)
  assert.ok(zh.items.every((i: { auth: string; https: boolean }) => i.auth === 'none' && i.https))
  const list = JSON.parse((await runCli(['search', '--category', 'Weather', '--limit', '50', '--json'], t.home)).stdout)
  assert.ok(list.items.every((i: { category: string }) => i.category === 'Weather'))
  const dash = await runCli(['search', '-foo', '--json'], t.home)
  assert.equal(dash.code, 0)
  assert.equal(JSON.parse(dash.stdout).query, '-foo')
})

test('bad flag in JSON mode: error document on stdout, exit 2', async () => {
  const r = await runCli(['search', 'weather', '--bogus', '--json'], t.home)
  assert.equal(r.code, 2)
  const doc = JSON.parse(r.stdout)
  assert.equal(doc.ok, false)
  assert.equal(doc.error.code, 'usage')
  assert.equal(typeof doc.error.message, 'string')
})

test('bad filter value: error document with exit 2; missing query too', async () => {
  const a = await runCli(['search', 'x', '--auth', 'nope', '--json'], t.home)
  assert.equal(a.code, 2)
  assert.equal(JSON.parse(a.stdout).ok, false)
  const b = await runCli(['search', '--json'], t.home)
  assert.equal(b.code, 2)
  assert.equal(JSON.parse(b.stdout).error.code, 'usage')
  const c = await runCli(['search', 'x', '--limit', 'abc', '--json'], t.home)
  assert.equal(c.code, 2)
})

test('sync with a missing --from path is a usage-class error document, exit 2', async () => {
  const r = await runCli(['sync', '--from', '/definitely/not/here/README.md', '--json'], t.home)
  assert.equal(r.code, 2)
  assert.equal(JSON.parse(r.stdout).ok, false)
})

test('search --help mentions --json and --limit', async () => {
  const r = await runCli(['search', '--help'], t.home)
  assert.equal(r.code, 0)
  assert.match(r.stdout, /--json/)
  assert.match(r.stdout, /--limit/)
})

test('--version and --help', async () => {
  const v = await runCli(['--version'], t.home)
  assert.match(v.stdout.trim(), /^\d+\.\d+\.\d+$/)
  const h = await runCli(['--help'], t.home)
  assert.match(h.stdout, /serve/)
  assert.equal(h.code, 0)
})

test('categories and info', async () => {
  const c = JSON.parse((await runCli(['categories', '--json'], t.home)).stdout)
  assert.equal(c.ok, true)
  assert.ok(c.categories.length > 45)
  assert.deepEqual(Object.keys(c.categories[0]).sort(), ['count', 'name', 'slug', 'zh'])
  const i = JSON.parse((await runCli(['info', '--json'], t.home)).stdout)
  assert.equal(i.loaded_from, 'bundled')
  assert.ok(i.entries > 2000)
})
