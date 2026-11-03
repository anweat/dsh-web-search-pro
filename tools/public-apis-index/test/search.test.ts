import { test } from 'node:test'
import assert from 'node:assert/strict'
import { loadSnapshot, createSearcher, InputError, CATEGORY_ZH } from '../src/index.ts'

const { snapshot } = loadSnapshot({ bundledOnly: true })
const searcher = createSearcher(snapshot)
const ids = (q: string, o = {}) => searcher.search(q, { limit: 10, ...o }).items.map(i => i.id)

test('weather: top results are in the Weather category', () => {
  const r = searcher.search('weather', { limit: 10 })
  assert.equal(r.items.length, 10)
  assert.ok(r.total > 40)
  const inWeather = r.items.filter(i => i.category === 'Weather').length
  assert.ok(inWeather >= 8, `Weather items in top 10: ${inWeather}`)
  assert.equal(r.items[0]!.category, 'Weather')
})

test('cat facts finds Cat Facts', () => {
  const r = searcher.search('cat facts', { limit: 5 })
  assert.equal(r.items[0]!.name, 'Cat Facts')
  assert.equal(r.items[0]!.category, 'Animals')
  assert.ok(r.items.filter(i => i.name === 'Cat Facts').length >= 2, 'both Cat Facts entries are kept')
})

test('items carry the documented fields', () => {
  const [item] = searcher.search('weather', { limit: 1 }).items
  for (const k of ['name', 'url', 'description', 'category', 'auth', 'https', 'cors', 'score', 'title', 'snippet']) {
    assert.ok(k in item!, k)
  }
  assert.equal(item!.title, `${item!.name} — ${item!.category}`)
  assert.match(item!.snippet, / · Auth: .+ · HTTPS: (yes|no) · CORS: (yes|no|unknown)$/)
})

test('Chinese query equals the English one', () => {
  assert.deepEqual(ids('天气'), ids('weather'))
  const r = searcher.search('天气')
  assert.deepEqual(r.terms, ['weather'])
  assert.deepEqual(r.notes, [])
})

test('mixed query with stopwords works', () => {
  assert.deepEqual(ids('免费 天气 api'), ids('weather'))
  assert.deepEqual(ids('free weather api'), ids('weather'))
  const r = searcher.search('免费 weather api')
  assert.deepEqual(r.terms, ['weather'])
  assert.ok(r.total > 0)
})

test('Chinese multi-term queries and category terms', () => {
  const crypto = searcher.search('比特币', { limit: 10 })
  assert.ok(crypto.items.some(i => i.category === 'Cryptocurrency'))
  const qr = searcher.search('二维码', { limit: 10 })
  assert.ok(qr.items.some(i => /qr/i.test(i.name)))
  const fin = searcher.search('股票', { limit: 10 })
  assert.ok(fin.items.some(i => i.category === 'Finance'))
})

test('every category has a Chinese alias and resolves through it', () => {
  for (const c of searcher.categories()) {
    assert.ok(c.zh, `no zh alias for ${c.slug}`)
    const r = searcher.search('', { category: c.zh!, limit: 50 })
    assert.equal(r.total, c.count, c.slug)
    assert.ok(r.items.every(i => i.category === c.name))
  }
  assert.ok(Object.keys(CATEGORY_ZH).length >= 45)
})

test('unknown CJK text produces a note and is ignored', () => {
  const r = searcher.search('阿巴阿巴 weather')
  assert.deepEqual(r.terms, ['weather'])
  assert.equal(r.notes.length, 1)
  assert.match(r.notes[0]!, /阿巴阿巴/)
  const only = searcher.search('阿巴阿巴')
  assert.equal(only.total, 0)
  assert.deepEqual(only.items, [])
  assert.match(only.notes.join(' '), /阿巴阿巴/)
})

test('AND falls back to OR when nothing matches all terms', () => {
  const r = searcher.search('weather zzzqqxx')
  assert.ok(r.total > 0)
  assert.equal(r.items[0]!.category, 'Weather')
  assert.match(r.notes.join(' '), /any term/)
  assert.equal(searcher.search('zzzqqxx').total, 0)
})

test('filters: category / auth / https / cors', () => {
  const none = searcher.search('weather', { auth: 'NONE', limit: 50 })
  assert.ok(none.items.length > 0 && none.items.every(i => i.auth === 'none'))
  const key = searcher.search('weather', { auth: 'apiKey', limit: 50 })
  assert.ok(key.items.length > 0 && key.items.every(i => i.auth === 'apiKey'))
  const other = searcher.search('', { auth: 'other', limit: 50 })
  assert.ok(other.total >= 10 && other.items.every(i => !['none', 'apiKey', 'OAuth'].includes(i.auth)))
  const http = searcher.search('weather', { https: false, limit: 50 })
  assert.ok(http.items.every(i => !i.https))
  const cors = searcher.search('weather', { cors: 'yes', limit: 50 })
  assert.ok(cors.items.length > 0 && cors.items.every(i => i.cors === 'yes'))
  const cat = searcher.search('music', { category: 'Weather', limit: 50 })
  assert.ok(cat.items.every(i => i.category === 'Weather'))
  assert.deepEqual(ids('weather', { category: 'weather' }), ids('weather', { category: 'WEATHER' }))
  assert.deepEqual(ids('cat', { category: 'animals' }), ids('cat', { category: '动物' }))
  assert.deepEqual(ids('x', { category: 'art-design' }), ids('x', { category: 'Art & Design' }))
})

test('empty query + category lists the category sorted by name', () => {
  const r = searcher.search('', { category: 'Weather', limit: 50 })
  const cat = searcher.categories().find(c => c.slug === 'weather')!
  assert.equal(r.total, cat.count)
  const names = r.items.map(i => i.name)
  const sorted = [...names].sort((a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' }))
  assert.deepEqual(names, sorted)
  assert.ok(r.items.every(i => i.category === 'Weather'))
})

test('empty query without filters returns nothing, with a note', () => {
  const r = searcher.search('   ')
  assert.equal(r.total, 0)
  assert.equal(r.notes.length, 1)
})

test('limit is clamped to 50; bad input throws InputError', () => {
  assert.equal(searcher.search('data', { limit: 500 }).items.length, 50)
  assert.equal(searcher.search('weather').items.length, 10)
  assert.throws(() => searcher.search('x', { auth: 'bogus' }), InputError)
  assert.throws(() => searcher.search('x', { cors: 'maybe' }), InputError)
  assert.throws(() => searcher.search('x', { category: 'nonexistent-cat' }), InputError)
  assert.throws(() => searcher.search('x', { limit: 0 }), InputError)
})

test('categories() reports counts that add up', () => {
  const cats = searcher.categories()
  assert.ok(cats.length > 45)
  assert.equal(cats.reduce((n, c) => n + c.count, 0), snapshot.entries.length)
  assert.deepEqual(cats.find(c => c.slug === 'weather')!.zh, '天气')
})
