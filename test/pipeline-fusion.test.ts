import test from 'node:test'
import assert from 'node:assert/strict'
import { candidateIdOf } from '../src/pipeline/candidates.ts'
import { bestRanks, fuseCandidates, freshnessFactor, isAuthorityHost } from '../src/pipeline/fusion.ts'
import type { Candidate } from '../src/pipeline/types.ts'

const cand = (url: string, contributions: [string, number][], extra: Partial<Candidate> = {}): Candidate => ({
  candidateId: candidateIdOf(url), canonicalUrl: url, url, title: '', snippet: '',
  contributions: contributions.map(([providerId, rank]) => ({ providerId, rank, query: 'q' })), ...extra,
})
const baseOptions = { k: 60, freshnessBoost: 0, freshnessDays: 30, authorityBoost: 0, authorityDomains: [] as string[] }

test('fusion: normalised RRF is 1 at rank 1 everywhere, each provider counts once per URL', () => {
  const both = cand('https://a.test/1', [['ddg', 1], ['bing', 1]])
  const once = cand('https://a.test/2', [['ddg', 1], ['ddg', 4]]) // same provider twice (two queries): best rank only
  const [first, second] = fuseCandidates([once, both], { ...baseOptions, nProviders: 2 })
  assert.equal(first!.candidate, both)
  assert.ok(Math.abs(first!.normalized - 1) < 1e-12)
  assert.ok(Math.abs(second!.rrf - 1 / 61) < 1e-12, 'a duplicate hit from the same provider adds nothing')
  assert.ok(Math.abs(second!.normalized - 0.5) < 1e-12)
  assert.deepEqual([...bestRanks(once)], [['ddg', 1]])
})

test('fusion: (a) a URL found by three engines gets the authority bonus once, not three times', () => {
  const options = { ...baseOptions, authorityBoost: 0.25, nProviders: 3 }
  const multi = cand('https://github.com/o/r', [['e1', 5], ['e2', 5], ['e3', 5]])
  const single = cand('https://github.com/o/s', [['e1', 5]])
  const plain = cand('https://plain.test/x', [['e1', 5], ['e2', 5], ['e3', 5]])
  const byUrl = new Map(fuseCandidates([multi, single, plain], options).map(r => [r.candidate.url, r]))
  const unit = 1 / (3 * 62)
  assert.ok(Math.abs(byUrl.get(multi.url)!.bonus - 0.25 * unit) < 1e-12)
  assert.ok(Math.abs(byUrl.get(single.url)!.bonus - 0.25 * unit) < 1e-12, 'one hit and three hits earn the same bonus')
  assert.equal(byUrl.get(plain.url)!.bonus, 0)
  // and the multi-engine URL still wins on rank evidence alone, not on triple authority
  assert.ok(byUrl.get(multi.url)!.score - byUrl.get(plain.url)!.score < 0.01)
})

test('fusion: (b) authority and freshness cannot lift rank 10 over rank 1 of the same engine, even at their maximum', () => {
  const now = new Date('2026-10-01T00:00:00Z')
  const top = cand('https://blog.example.net/top', [['ddg', 1]])
  const tenth = cand('https://developer.mozilla.org/x', [['ddg', 10]], { publishedAt: '2026-10-01' })
  for (const boost of [0.25, 1]) {
    const ranked = fuseCandidates([tenth, top], { ...baseOptions, freshnessBoost: boost, authorityBoost: boost, nProviders: 1, now })
    assert.equal(ranked[0]!.candidate, top, 'boost ' + boost)
  }
  // Defaults: the two bonuses together stay under half of one top-rank step.
  const defaults = fuseCandidates([tenth], { ...baseOptions, freshnessBoost: 0.2, authorityBoost: 0.25, nProviders: 1, now })[0]!
  assert.ok(defaults.bonus < 0.5 / 62, 'bonus ' + defaults.bonus)
  // Even at the maximum the bonus is worth about two adjacent top ranks, nowhere near nine.
  const max = fuseCandidates([tenth], { ...baseOptions, freshnessBoost: 1, authorityBoost: 1, nProviders: 1, now })[0]!
  assert.ok(max.bonus <= 2 / 62 + 1e-12)
})

test('fusion: bonuses break ties between equal rank evidence, and ties otherwise keep first-seen order', () => {
  const options = { ...baseOptions, authorityBoost: 0.25, nProviders: 2 }
  const a = cand('https://plain.test/a', [['p1', 1], ['p2', 2]])
  const b = cand('https://en.wikipedia.org/wiki/B', [['p1', 2], ['p2', 1]])
  assert.deepEqual(fuseCandidates([a, b], options).map(r => r.candidate.url), [b.url, a.url])
  assert.deepEqual(fuseCandidates([a, b], { ...options, authorityBoost: 0 }).map(r => r.candidate.url), [a.url, b.url])
})

test('fusion helpers: freshness decays linearly, authority hosts', () => {
  const now = new Date('2026-10-01T00:00:00Z')
  assert.equal(freshnessFactor(undefined, 30, now), 0)
  assert.equal(freshnessFactor('garbage', 30, now), 0)
  assert.equal(freshnessFactor('2027-01-01', 30, now), 0, 'future dates get nothing')
  assert.ok(Math.abs(freshnessFactor('2026-09-16', 30, now) - 0.5) < 1e-9)
  assert.equal(freshnessFactor('2026-01-01', 30, now), 0)
  assert.ok(isAuthorityHost('docs.github.com') && isAuthorityHost('mit.edu') && isAuthorityHost('my.custom.dev', ['custom.dev']))
  assert.ok(!isAuthorityHost('notgithub.com') && !isAuthorityHost('example.com'))
})
