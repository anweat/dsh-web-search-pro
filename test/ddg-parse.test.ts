import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseDdgHtml, ddgEngine, EngineError } from '../src/engines.ts'

const here = path.dirname(fileURLToPath(import.meta.url))
const readFixture = (name: string) => fs.readFileSync(path.join(here, 'fixtures', name), 'utf8')

test('parseDdgHtml extracts >=9 of 10 snippets (regression: lazy-bridge + optional group)', () => {
  const html = readFixture('ddg-html.html')
  const sources = parseDdgHtml(html, 10)
  // Block slicing must find all ten results.
  assert.ok(sources.length >= 10, 'expected >=10 sources, got ' + sources.length)
  // The core anti-regression assertion: snippets must actually be captured.
  const withSnippet = sources.filter(s => s.snippet && s.snippet.trim()).length
  assert.ok(withSnippet >= 9, `expected >=9 snippets, got ${withSnippet}/${sources.length}`)
  for (const s of sources) {
    assert.match(s.url, /^https?:\/\//, 'url must be absolute http(s): ' + s.url)
    assert.ok(s.title && s.title.trim().length >= 2, 'title must be non-empty')
  }
})

test('parseDdgHtml decodes DDG redirect hrefs to the real target', () => {
  const html = readFixture('ddg-html.html')
  const sources = parseDdgHtml(html, 10)
  assert.ok(sources.some(s => s.url.includes('ottawa.weatherstats.ca')), 'expected decoded weatherstats url')
  // No DDG redirect wrapper should leak into the returned urls.
  assert.ok(!sources.some(s => s.url.includes('duckduckgo.com/l/')), 'no duckduckgo redirect urls should remain')
})

test('parseDdgHtml honours the count cap', () => {
  const html = readFixture('ddg-html.html')
  assert.equal(parseDdgHtml(html, 3).length, 3)
})

test('parseDdgHtml yields no usable snippets on a snippet-less rate-limited variant', () => {
  const html = readFixture('ddg-rate-limited.html')
  // The parser is pure: it reports what it can see. A rate-limited page has
  // result__a anchors but no snippets — the regression case returned these as
  // "success". The router's quality gate (P0-2) treats snippet-less output as
  // low-quality and keeps probing; the engine throws ENGINE_EMPTY when nothing
  // parseable remains. Either way, zero usable snippets here is the contract.
  const sources = parseDdgHtml(html, 10)
  const usable = sources.filter(s => s.snippet && s.snippet.trim()).length
  assert.equal(usable, 0, 'rate-limited fixture must yield no usable snippets')
})

test('parseDdgHtml returns [] for HTML with no result blocks', () => {
  assert.deepEqual(parseDdgHtml('<html><body></body></html>', 10), [])
  // The engine wraps an empty parse as a retryable ENGINE_EMPTY (ddgEngine.search).
  assert.equal(typeof EngineError, 'function')
})
