import test from 'node:test'
import assert from 'node:assert/strict'
import { candidateIdOf, mergeCandidates, provenanceOf, type ProviderOutput } from '../src/pipeline/candidates.ts'
import { CONFIDENCE_STRENGTH, clampConfidence, confidenceFactor, guaranteeSeats } from '../src/pipeline/confidence.ts'
import { fuseCandidates } from '../src/pipeline/fusion.ts'
import { resolveSources } from '../src/pipeline/sources-spec.ts'
import type { Candidate } from '../src/pipeline/types.ts'
import { USER_DEFINED_TAG } from '../src/cli/spec.ts'
import { baseSpec, posix, withCommands } from './cli-helpers.ts'
import { routerHarness } from './custom-cli-harness.ts'

const options = { k: 60, freshnessBoost: 0, freshnessDays: 30, authorityBoost: 0, authorityDomains: [] as string[] }
const cand = (url: string, contributions: [string, number, number?][], extra: Partial<Candidate> = {}): Candidate => ({
  candidateId: candidateIdOf(url), canonicalUrl: url, url, title: '', snippet: '',
  contributions: contributions.map(([providerId, rank, confidence]) => ({ providerId, rank, query: 'q', ...confidence !== undefined ? { confidence } : {} })), ...extra,
})

test('the factor: 1 at confidence 1 (exactly), 1 - STRENGTH at 0, linear between, clamped, 1 when there is none', () => {
  assert.equal(CONFIDENCE_STRENGTH, 0.2)
  assert.equal(confidenceFactor(1), 1)
  assert.equal(confidenceFactor(undefined), 1)
  assert.equal(confidenceFactor(0), 0.8)
  assert.equal(confidenceFactor(0.5), 0.9)
  assert.equal(confidenceFactor(-3), 0.8)
  assert.equal(confidenceFactor(7), 1)
  assert.equal(confidenceFactor(Number.NaN), 1)
  assert.equal(clampConfidence(0.25), 0.25)
  // Whatever the confidence, a source keeps at least 80% of its weight: it is never silenced.
  for (let c = 0; c <= 1; c += 0.05) assert.ok(confidenceFactor(c) >= 0.8 && confidenceFactor(c) <= 1)
})

test('fusion with every confidence 1 (or none) is the fusion that existed before: same scores bit for bit, same order', () => {
  const plain = [cand('https://a.test/1', [['p1', 1], ['p2', 3]]), cand('https://b.test/2', [['p1', 2]]), cand('https://github.com/o/r', [['p2', 1]], { publishedAt: '2026-10-01' }), cand('https://c.test/3', [['p1', 3], ['p2', 2]])]
  const ones = plain.map(c => ({ ...c, contributions: c.contributions.map(x => ({ ...x, confidence: 1 })) }))
  const full = { ...options, freshnessBoost: 0.2, authorityBoost: 0.25, nProviders: 2, now: new Date('2026-10-05T00:00:00Z') }
  const before = fuseCandidates(plain, full)
  const withOnes = fuseCandidates(ones, full)
  assert.deepEqual(withOnes.map(r => [r.candidate.url, r.score, r.rrf, r.bonus]), before.map(r => [r.candidate.url, r.score, r.rrf, r.bonus]))
  // The reference numbers, computed by hand from the documented formula, so the baseline itself is pinned.
  const a = before.find(r => r.candidate.url === 'https://a.test/1')!
  assert.equal(a.rrf, 1 / 61 + 1 / 63)
  assert.equal(a.normalized, (1 / 61 + 1 / 63) / (2 / 61))
})

test('fusion: a doubted source weighs less, a uniform confidence changes no order, and agreement outweighs doubt', () => {
  const alpha = (c?: number) => [1, 2, 3].map(rank => cand('https://a.test/' + rank, [['alpha', rank, c]]))
  const beta = (c?: number) => [1, 2, 3].map(rank => cand('https://b.test/' + rank, [['beta', rank, c]]))
  const order = (list: Candidate[]) => fuseCandidates(list, { ...options, nProviders: 2 }).map(r => r.candidate.url.replace('https://', '').replace('.test/', ''))
  assert.deepEqual(order([...alpha(), ...beta()]), ['a1', 'b1', 'a2', 'b2', 'a3', 'b3'])
  assert.deepEqual(order([...alpha(), ...beta(0.5)]), ['a1', 'a2', 'a3', 'b1', 'b2', 'b3'], 'the doubted source follows')
  assert.deepEqual(order([...alpha(0.5), ...beta(0.5)]), ['a1', 'b1', 'a2', 'b2', 'a3', 'b3'], 'both doubted equally: the order is the same')
  assert.deepEqual(order([...alpha(0), ...beta(0)]), ['a1', 'b1', 'a2', 'b2', 'a3', 'b3'])
  // The same URL from both: the doubted source's rank still counts, so agreement beats a lone full-confidence rank 2.
  const shared = [cand('https://s.test/x', [['alpha', 3], ['beta', 1, 0.5]]), ...alpha().slice(0, 2).map(c => ({ ...c, contributions: c.contributions.map(x => ({ ...x })) }))]
  const ranked = fuseCandidates(shared, { ...options, nProviders: 2 })
  assert.equal(ranked[0]!.candidate.url, 'https://s.test/x', 'rank 3 of a full source plus rank 1 of a doubted one beats a lone rank 1')
})

test('fusion: confidence scales the rank term and the tie-break bonus, and never changes the relative order among full-confidence sources', () => {
  const now = new Date('2026-10-01T00:00:00Z')
  const opts = { ...options, freshnessBoost: 0.2, authorityBoost: 0.25, nProviders: 1, now }
  const doubted = fuseCandidates([cand('https://github.com/o/r', [['p', 1, 0.5]])], opts)[0]!
  const full = fuseCandidates([cand('https://github.com/o/r', [['p', 1]])], opts)[0]!
  assert.ok(Math.abs(doubted.rrf - 0.9 / 61) < 1e-15)
  assert.ok(Math.abs(doubted.bonus - full.bonus * 0.9) < 1e-15, 'the bonus is scaled by the best factor too')
  // Full-confidence sources keep their order among themselves whatever a doubted source brings.
  const fullOnly = [cand('https://x.test/1', [['p1', 2], ['p2', 1]]), cand('https://x.test/2', [['p1', 1], ['p2', 4]]), cand('https://x.test/3', [['p1', 5]])]
  const withDoubted = [...fullOnly, cand('https://y.test/1', [['p3', 1, 0]]), cand('https://y.test/2', [['p3', 2, 0]])]
  const fullOrder = fuseCandidates(fullOnly, { ...options, nProviders: 2 }).map(r => r.candidate.url)
  const mixedOrder = fuseCandidates(withDoubted, { ...options, nProviders: 3 }).map(r => r.candidate.url).filter(url => url.startsWith('https://x.test'))
  assert.deepEqual(mixedOrder, fullOrder)
})

test('guaranteeSeats: the best result of a doubted source stays within the shown list; nothing changes without a doubted source', () => {
  const rows = (providerId: string, confidence: number | undefined, n: number) => Array.from({ length: n }, (_, i) => cand('https://' + providerId + '.test/' + (i + 1), [[providerId, i + 1, confidence]]))
  const contributions = (c: Candidate) => c.contributions
  const ranked = fuseCandidates([...rows('a', undefined, 5), ...rows('b', 0.5, 5)], { ...options, nProviders: 2 })
  const order = ranked.map(r => r.candidate)
  const seated = guaranteeSeats(order, 3, contributions).map(c => c.url)
  assert.deepEqual(seated.slice(0, 3), ['https://a.test/1', 'https://a.test/2', 'https://b.test/1'], 'a1 a2 then the doubted source\'s best, not a3')
  assert.equal(seated.length, order.length, 'nothing is dropped, only reordered')
  assert.deepEqual([...seated].sort(), order.map(c => c.url).sort())
  // Two doubted sources, a window of three: both get a seat, one slot stays for the rest.
  const two = fuseCandidates([...rows('a', undefined, 5), ...rows('b', 0.5, 5), ...rows('c', 0.2, 5)], { ...options, nProviders: 3 }).map(r => r.candidate)
  const window = guaranteeSeats(two, 3, contributions).slice(0, 3).map(c => c.contributions[0]!.providerId).sort()
  assert.deepEqual(window, ['a', 'b', 'c'])
  // A window of two keeps room for the others: only one seat.
  assert.equal(new Set(guaranteeSeats(two, 2, contributions).slice(0, 2).map(c => c.contributions[0]!.providerId)).size, 2)
  // Nothing doubted: untouched, also when the list is shorter than the window.
  const plain = fuseCandidates([...rows('a', undefined, 5), ...rows('b', undefined, 5)], { ...options, nProviders: 2 }).map(r => r.candidate)
  assert.deepEqual(guaranteeSeats(plain, 3, contributions), plain)
  assert.deepEqual(guaranteeSeats(order, 50, contributions), order)
  assert.deepEqual(guaranteeSeats(order, 1, contributions), order)
})

test('merging carries confidence per contribution (below 1 only) and the origin of a user-defined CLI per URL', () => {
  const outputs: ProviderOutput[] = [
    { providerId: 'ddg', query: 'q', sources: [{ url: 'https://a.test/1', title: 'A' }, { url: 'https://shared.test/', title: 'S' }] },
    { providerId: 'custom-cli:x', query: 'q', sources: [{ url: 'https://shared.test/', via: 'custom-cli:x', tag: 'T', confidence: 0.5 }, { url: 'https://only.test/', via: 'custom-cli:x', tag: 'T', confidence: 0.5 }, { url: 'https://one.test/', confidence: 1 }] },
  ]
  const merged = mergeCandidates(outputs)
  const by = (url: string) => merged.find(c => c.url === url)!
  assert.deepEqual(by('https://a.test/1').contributions, [{ providerId: 'ddg', rank: 1, query: 'q' }], 'no confidence key for a full-confidence source')
  assert.equal(by('https://only.test/').contributions[0]!.confidence, 0.5)
  assert.equal(by('https://one.test/').contributions[0]!.confidence, undefined, 'a confidence of 1 is not recorded')
  assert.deepEqual(provenanceOf(by('https://a.test/1')), {})
  assert.deepEqual(provenanceOf(by('https://only.test/')), { via: 'custom-cli:x', tag: 'T', confidence: 0.5 })
  // A URL a full-confidence source also returned is as sure as that source: no confidence is shown, the CLI still is.
  assert.deepEqual(provenanceOf(by('https://shared.test/')), { via: 'custom-cli:x', tag: 'T' })
})

test('sources.confidence is validated: numbers 0..1 for registered sources and platform backends, the rest is dropped with a reason', () => {
  const known = (id: string): boolean => id !== 'nope'
  const r = resolveSources({ confidence: { ddg: 0.7, 'custom-cli:x': 0, xhs: 1, nope: 0.5, bing: 1.5, exa: '0.5' as never, jina: Number.NaN } }, known, id => id === 'xhs' || id === 'nope2')
  assert.deepEqual(r.confidence, { ddg: 0.7, 'custom-cli:x': 0, xhs: 1 })
  assert.equal(r.diagnostics.length, 4)
  assert.match(r.diagnostics.join('\n'), /sources\.confidence\.nope ignored: not a registered source or platform backend/)
  assert.match(r.diagnostics.join('\n'), /sources\.confidence\.bing ignored: must be a number 0\.\.1/)
  assert.deepEqual(resolveSources(undefined).confidence, {})
  assert.match(resolveSources({ confidence: [] as never }).diagnostics[0]!, /sources\.confidence ignored: must be an object/)
})

// ── through the router, with two real (fake) commands ───────────────────────────────────────────────────────────────────────────

const json = (urls: string[]): string => JSON.stringify({ data: urls.map(url => ({ url, title: 'T ' + url, summary: 's ' + url })) })
const fake = (urls: string[]): string => 'case "$1" in --version) echo "x 1.0";; search) if [ "$2" = "--help" ]; then echo "--json"; else printf \'%s\' \'' + json(urls) + '\'; fi;; esac'
const engineSpec = (id: string, bin: string, over: Record<string, unknown> = {}) => ({ ...baseSpec({ id, bins: [bin], platforms: [], engine: true }), ...over })

test('two custom CLIs fused in a parallel search: the doubted one follows but keeps a place; rows say via, confidence and the honest label', { skip: !posix }, async () => {
  const alpha = ['https://a.test/1', 'https://a.test/2', 'https://a.test/3']
  const beta = ['https://b.test/1', 'https://b.test/2', 'https://b.test/3']
  await withCommands({ 'alpha-cli': fake(alpha), 'beta-cli': fake(beta) }, async () => {
    const cliAdapters = { alpha: engineSpec('alpha', 'alpha-cli', { confidence: 1 }), beta: engineSpec('beta', 'beta-cli', { confidence: 0.5 }) }
    const equal = routerHarness({ cliAdapters: { alpha: cliAdapters.alpha, beta: engineSpec('beta', 'beta-cli', { confidence: 1 }) } })
    try {
      const r = await equal.search('q', { engines: ['custom-cli:alpha', 'custom-cli:beta'], multi: true, count: 3 })
      assert.deepEqual(r.sources.map(s => s.url), ['https://a.test/1', 'https://b.test/1', 'https://a.test/2'], 'equal confidence: interleaved')
      assert.ok(r.sources.every(s => s.via?.startsWith('custom-cli:') && s.tag === USER_DEFINED_TAG && s.confidence === undefined), 'confidence 1 is not printed')
    } finally { equal.cleanup() }
    const h = routerHarness({ cliAdapters })
    try {
      const r = await h.search('q', { engines: ['custom-cli:alpha', 'custom-cli:beta'], multi: true, count: 3 })
      assert.deepEqual(r.sources.map(s => s.url), ['https://a.test/1', 'https://a.test/2', 'https://b.test/1'], 'the doubted source\'s best result takes the last place instead of a3')
      assert.deepEqual(r.sources[2], { url: 'https://b.test/1', title: 'T https://b.test/1', snippet: 's https://b.test/1', via: 'custom-cli:beta', confidence: 0.5, tag: USER_DEFINED_TAG })
      assert.equal(r.sources[0]!.via, 'custom-cli:alpha')
      assert.equal('confidence' in r.sources[0]!, false)
      // The second call is a cache hit and says the same.
      const again = await h.search('q', { engines: ['custom-cli:alpha', 'custom-cli:beta'], multi: true, count: 3, fresh: false })
      assert.equal(again.fromCache, true)
      assert.deepEqual(again.sources, r.sources)
      // Fewer places than sources: the window of two keeps room for the rest, so a2 stays out and the doubted one still gets in.
      const wide = await h.search('q', { engines: ['custom-cli:alpha', 'custom-cli:beta'], multi: true, count: 2 })
      assert.deepEqual(wide.sources.map(s => s.url), ['https://a.test/1', 'https://b.test/1'])
    } finally { h.cleanup() }
  })
})

test('a single custom CLI engine tried alone: rows carry its confidence (default 0.5) and survive the cache; sources.confidence overrides the spec', { skip: !posix }, async () => {
  await withCommands({ 'alpha-cli': fake(['https://a.test/1']) }, async () => {
    const spec = engineSpec('alpha', 'alpha-cli')
    const h = routerHarness({ cliAdapters: { alpha: spec } })
    try {
      assert.equal(h.router.confidenceOf('custom-cli:alpha'), 0.5, 'a custom CLI without a confidence in its spec has 0.5')
      const first = await h.search('q', { engines: ['custom-cli:alpha'] })
      assert.deepEqual(first.sources.map(s => [s.via, s.confidence]), [['custom-cli:alpha', 0.5]])
      const cached = await h.search('q', { engines: ['custom-cli:alpha'], fresh: false })
      assert.equal(cached.fromCache, true)
      assert.deepEqual(cached.sources, first.sources)
    } finally { h.cleanup() }
    const over = routerHarness({ cliAdapters: { alpha: { ...spec, confidence: 0.9 } }, sources: { confidence: { 'custom-cli:alpha': 0.3, ddg: 0.6 } } })
    try {
      assert.equal(over.router.confidenceOf('custom-cli:alpha'), 0.3, 'the setting beats the spec')
      assert.equal(over.router.confidenceOf('ddg'), 0.6, 'and works for a built-in engine')
      assert.equal(over.router.confidenceOf('bing'), 1, 'every other built-in source is 1')
      assert.equal(over.router.confidenceOf('twitter', 'opencli'), 1)
      assert.equal(over.router.confidenceOf('twitter', 'custom-cli:alpha'), 0.3, 'a platform backend counts too')
      assert.equal(over.router.confidenceOf('custom-cli:alpha', 'custom-cli:alpha'), 0.3, 'its own id is not counted twice')
      assert.deepEqual(over.router.sourceDiagnostics(), [])
    } finally { over.cleanup() }
    const both = routerHarness({ sources: { confidence: { weibo: 0.5, 'browser-search': 0.5, xhs: 0.5, ghost: 0.5, ddg: 2 } } })
    try {
      assert.equal(both.router.confidenceOf('weibo', 'browser-search'), 0.25, 'the provider and the backend that answered multiply')
      assert.equal(both.router.confidenceOf('xiaohongshu', 'xhs'), 0.5)
      assert.deepEqual(both.router.sourceDiagnostics().map(m => m.replace(/ ignored.*/, '')), ['sources.confidence.ghost', 'sources.confidence.ddg'])
    } finally { both.cleanup() }
  })
})

test('sources.status reports the confidence of each source and of each leg of a chain', { skip: !posix }, async () => {
  await withCommands({ 'alpha-cli': fake(['https://a.test/1']) }, async () => {
    const h = routerHarness({ cliAdapters: { alpha: engineSpec('alpha', 'alpha-cli', { platforms: ['weibo'], confidence: 0.6 }) }, platformBackends: { weibo: ['custom-cli:alpha', 'browser-search'] }, sources: { confidence: { 'browser-search': 0.8 } } })
    try {
      const report = await h.router.providerReport()
      assert.equal(report.find(p => p.route === 'ddg')!.confidence, 1)
      assert.equal(report.find(p => p.route === 'custom-cli:alpha')!.confidence, 0.6)
      const weibo = report.find(p => p.route === 'weibo')!
      assert.equal(weibo.confidence, 1)
      assert.deepEqual(weibo.chain!.map(leg => [leg.id, leg.confidence, leg.verification]), [['custom-cli:alpha', 0.6, 'user-defined'], ['browser-search', 0.8, 'unverified']])
    } finally { h.cleanup() }
  })
})
