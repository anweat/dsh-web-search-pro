import test from 'node:test'
import assert from 'node:assert/strict'
import { candidateIdOf, mergeCandidates, mergeSnippets, SNIPPET_JOIN_CAP } from '../src/pipeline/candidates.ts'

test('mergeCandidates: one candidate per canonical URL with every contribution kept', () => {
  const merged = mergeCandidates([
    { providerId: 'ddg', query: 'q', sources: [
      { url: 'https://Example.com/a?utm_source=x', title: 'A', snippet: 'first snippet about a' },
      { url: 'https://example.com/b', title: 'B' },
    ] },
    { providerId: 'bing', query: 'q', sources: [
      { url: 'https://example.com/b/#top', title: 'B – the longer title', snippet: 'bing snippet for b' },
      { url: 'https://example.com/a', publishedAt: '2026-09-01' },
    ] },
    { providerId: 'ddg', query: 'site:example.com q', sources: [{ url: 'https://example.com/a?fbclid=9' }] },
  ])
  assert.equal(merged.length, 2)
  const [a, b] = merged
  assert.equal(a!.canonicalUrl, 'https://example.com/a')
  assert.equal(a!.url, 'https://Example.com/a?utm_source=x', 'first-seen raw URL is kept')
  assert.deepEqual(a!.contributions, [
    { providerId: 'ddg', rank: 1, query: 'q' },
    { providerId: 'bing', rank: 2, query: 'q' },
    { providerId: 'ddg', rank: 1, query: 'site:example.com q' },
  ])
  assert.equal(a!.publishedAt, '2026-09-01')
  assert.equal(b!.title, 'B – the longer title', 'the most complete title wins')
  assert.equal(b!.snippet, 'bing snippet for b')
  assert.equal(a!.candidateId, candidateIdOf(a!.canonicalUrl))
  assert.match(a!.candidateId, /^c_[0-9a-f]{12}$/)
  assert.notEqual(a!.candidateId, b!.candidateId)
})

test('mergeCandidates: sources without a URL are skipped but still occupy their rank', () => {
  const merged = mergeCandidates([{ providerId: 'p', query: 'q', sources: [{ url: '' }, { url: 'https://example.com/x', title: 'X' }] }])
  assert.equal(merged.length, 1)
  assert.equal(merged[0]!.contributions[0]!.rank, 2)
})

test('mergeSnippets: repeats dropped, near-duplicates keep the longer, complements joined within the cap', () => {
  assert.equal(mergeSnippets('', '  hello   world '), 'hello world')
  assert.equal(mergeSnippets('Busy timeout sets how long to wait', 'busy timeout'), 'Busy timeout sets how long to wait')
  assert.equal(mergeSnippets('busy timeout', 'Busy timeout sets how long to wait'), 'Busy timeout sets how long to wait')
  assert.equal(
    mergeSnippets('DatabaseSync accepts a timeout option', 'Available since Node.js 22.5 behind a flag'),
    'DatabaseSync accepts a timeout option … Available since Node.js 22.5 behind a flag',
  )
  const long = 'alpha '.repeat(70).trim() // 419 chars
  const joined = mergeSnippets(long, 'completely different words follow here for the test of capping behaviour at the boundary of the limit', 500)
  assert.ok(joined.length <= 500, 'joined length ' + joined.length)
  assert.ok(joined.startsWith(long) && joined.endsWith('…'))
  // No room for a meaningful stub: unchanged. A single over-cap snippet is never cut here.
  const full = 'x'.repeat(SNIPPET_JOIN_CAP - 10)
  assert.equal(mergeSnippets(full, 'another unrelated snippet'), full)
  const huge = 'y'.repeat(900)
  assert.equal(mergeSnippets('', huge), huge)
})
