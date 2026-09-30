import test from 'node:test'
import assert from 'node:assert/strict'
import { canonicalUrl, enginesFor, HostGate, queriesFor, selectFetchUrls } from '../src/harvest-lib.ts'
import type { EngineRun } from '../src/types.ts'

const run = (engine: string, urls: string[], query = 'q'): EngineRun => ({
  engine, query, status: urls.length ? 'ok' : 'empty', ms: 1,
  results: urls.map((url, i) => ({ rank: i + 1, url })),
})

test('canonicalUrl merges fragments, tracking params and trailing slashes', () => {
  assert.equal(canonicalUrl('https://Example.com/a/?utm_source=x#top'), 'https://example.com/a')
  assert.equal(canonicalUrl('https://example.com/a?id=1&utm_medium=y'), 'https://example.com/a?id=1')
  assert.equal(canonicalUrl('https://example.com/'), 'https://example.com/')
})

test('selectFetchUrls round-robins by rank, dedupes, skips binaries, records provenance', () => {
  const runs = [
    run('ddg', ['https://a.com/1', 'https://a.com/2', 'https://a.com/3']),
    run('bing', ['https://b.com/1', 'https://a.com/1/', 'https://b.com/paper.pdf', 'https://b.com/4']),
    run('github', ['https://github.com/x/y']),
  ]
  const picked = selectFetchUrls(runs, 5)
  assert.deepEqual(picked.map(p => p.url), ['https://a.com/1', 'https://b.com/1', 'https://github.com/x/y', 'https://a.com/2', 'https://a.com/3'])
  assert.deepEqual(picked[0]!.from, ['ddg#1', 'bing#2'])
  assert.equal(selectFetchUrls(runs, 0).length, 0)
})

test('selectFetchUrls puts site: variants after primary runs', () => {
  const runs = [run('ddg', ['https://a.com/1']), run('ddg', ['https://site.com/1'], 'site:site.com q'), run('bing', ['https://b.com/1'])]
  assert.deepEqual(selectFetchUrls(runs, 3).map(p => p.url), ['https://a.com/1', 'https://b.com/1', 'https://site.com/1'])
})

test('enginesFor / queriesFor follow the profile and site constraints', () => {
  assert.deepEqual(enginesFor({ profile: 'docs_code', lang: 'en' }), ['ddg', 'bing', 'github'])
  assert.deepEqual(enginesFor({ profile: 'academic', lang: 'en' }), ['ddg', 'bing', 'arxiv'])
  assert.deepEqual(enginesFor({ profile: 'experience', lang: 'zh' }), ['ddg', 'bing', 'v2ex'])
  assert.deepEqual(enginesFor({ profile: 'experience', lang: 'en' }), ['ddg', 'bing'])
  assert.deepEqual(enginesFor({ profile: 'general', lang: 'zh' }, ['bing', 'ddg']), ['ddg', 'bing'])
  const task = { query: 'hello', constraints: [{ id: 'c1', kind: 'site' as const, value: 'v2ex.com', strength: 'hard' as const }] }
  assert.deepEqual(queriesFor(task, 'ddg'), ['hello', 'site:v2ex.com hello'])
  assert.deepEqual(queriesFor(task, 'bing'), ['hello', 'site:v2ex.com hello'])
  assert.deepEqual(queriesFor(task, 'github'), ['hello'])
})

test('HostGate enforces the per-host gap and penalize doubles it', async () => {
  let clock = 0
  const slept: number[] = []
  const gate = new HostGate({ 'slow.test': 5_000 }, 1_500, () => clock, async ms => { slept.push(ms); clock += ms })
  await gate.wait('a.test')
  gate.done('a.test')
  clock += 400
  await gate.wait('a.test')
  assert.deepEqual(slept, [1_100])
  gate.done('a.test')
  await gate.wait('other.test')
  assert.equal(slept.length, 1, 'other hosts are independent')
  gate.done('slow.test')
  await gate.wait('slow.test')
  assert.equal(slept[1], 5_000)
  assert.equal(gate.penalize('slow.test'), 10_000)
  assert.equal(gate.penalize('a.test'), 3_000)
})
