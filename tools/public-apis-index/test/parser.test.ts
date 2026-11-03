import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { parseReadme, parseReadmeDetailed, splitRow, stripUtm, slugify } from '../src/parser.ts'

const fixture = readFileSync(new URL('./fixtures/sample-readme.md', import.meta.url), 'utf8')

test('splitRow handles missing outer pipes and escaped pipes', () => {
  assert.deepEqual(splitRow('API | Description | Auth '), ['API', 'Description', 'Auth'])
  assert.deepEqual(splitRow('| a \\| b | c |'), ['a | b', 'c'])
})

test('stripUtm removes only utm_* params', () => {
  assert.equal(stripUtm('https://a.com/?utm_source=x&utm_medium=y'), 'https://a.com/')
  assert.equal(stripUtm('https://a.com/p?x=1&utm_campaign=z#f'), 'https://a.com/p?x=1#f')
  assert.equal(stripUtm('https://a.com'), 'https://a.com')
})

test('slugify', () => {
  assert.equal(slugify('Art & Design'), 'art-design')
  assert.equal(slugify('Anti-Malware'), 'anti-malware')
})

test('fixture: only curated tables are indexed', () => {
  const { entries, skipped, tables } = parseReadmeDetailed(fixture)
  assert.equal(tables, 2)
  assert.equal(entries.length, 8)
  assert.ok(!entries.some(e => /Sponsored|Weatherstack|IPstack|Some MCP/.test(e.name + e.description)))
  assert.equal(skipped.length, 2)
  assert.ok(skipped.every(s => s.category === 'Animals'))
  assert.equal(parseReadme(fixture).length, 8)
})

test('fixture: fields are normalized', () => {
  const entries = parseReadme(fixture)
  const by = (name: string) => entries.filter(e => e.name === name)
  const cats = by('Cats')[0]!
  assert.equal(cats.url, 'https://docs.thecatapi.com/')
  assert.equal(cats.description, 'Pictures of cats from Tumblr')
  assert.equal(cats.auth, 'apiKey')
  assert.equal(cats.https, true)
  assert.equal(cats.cors, 'no')
  assert.equal(cats.category, 'Animals')
  assert.equal(cats.categorySlug, 'animals')

  assert.equal(by('Dog Pipe')[0]!.description, 'Dogs | and puppies')
  assert.equal(by('Dog Pipe')[0]!.https, false)
  assert.equal(by('Dog Pipe')[0]!.cors, 'unknown')

  assert.equal(by('Odd Auth One')[0]!.auth, 'X-Mashape-Key')
  assert.equal(by('Odd Auth One')[0]!.url, 'https://example.com/one?x=1')
  assert.equal(by('Agent Auth')[0]!.auth, 'User-Agent')
  assert.equal(by('Agent Auth')[0]!.cors, 'yes')
  assert.equal(by('OAuth Weather')[0]!.auth, 'OAuth')
  assert.equal(by('Open Weather')[0]!.auth, 'none')
  assert.equal(by('Open Weather')[0]!.cors, 'no')
  assert.equal(by('Open Weather')[0]!.url, 'https://example.com/four#frag')
})

test('fixture: duplicate names are kept with distinct stable ids', () => {
  const entries = parseReadme(fixture)
  const dup = entries.filter(e => e.name === 'Cat Facts')
  assert.equal(dup.length, 2)
  assert.notEqual(dup[0]!.id, dup[1]!.id)
  assert.deepEqual(parseReadme(fixture).map(e => e.id), entries.map(e => e.id))
  assert.equal(new Set(entries.map(e => e.id)).size, entries.length)
})

test('empty or garbage input does not throw', () => {
  assert.deepEqual(parseReadme(''), [])
  assert.deepEqual(parseReadme('| | |\n### X\n| API | Auth |\n'), [])
})
