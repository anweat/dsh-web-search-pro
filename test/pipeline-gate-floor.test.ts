import test from 'node:test'
import assert from 'node:assert/strict'
import { candidateIdOf } from '../src/pipeline/candidates.ts'
import {
  applyFloor, DEFAULT_MIN_KEEP, DEFAULT_RELEVANCE_THRESHOLD, gateCandidates, gateItem, gateRelevance, keptCandidates, lexicalRelevance, relevanceContextOf,
} from '../src/pipeline/gate.ts'
import { renderEvidencePack } from '../src/pipeline/render.ts'
import { runPipeline, type PageInput, type PipelineDeps, type ProviderOutcome } from '../src/pipeline/run.ts'
import type { Candidate, Constraint, TaskSpec } from '../src/pipeline/types.ts'

// The real-host failure (dsh-web-search-pro, web_search_pro docs_code): English query, Chinese task and needs, English
// results. Candidates 20, kept 0, gaps n1/n2 no_candidates.
const GO: TaskSpec = {
  goal: '确认 Go 1.22 循环变量语义变化及其影响',
  query: 'Go 1.22 for loop variable per-iteration semantics change',
  profile: 'docs_code',
  needs: [
    { id: 'n1', text: 'Go 1.22 中 for 循环变量从每循环共享改为每次迭代新建', critical: true },
    { id: 'n2', text: '旧代码迁移时需要注意什么', critical: true },
  ],
  constraints: [],
  budget: {},
}
const RELEASE = { title: 'Go 1.22 Release Notes — Changes to the language: each iteration of a for loop creates new variables', text: '' }
const WIKI = { title: 'LoopvarExperiment · golang/go Wiki', text: '' }
const MISTAKES = { title: 'Go Wiki: Common Mistakes', text: 'Using goroutines on loop iterator variables' }
const FIXING = { title: 'Fixing For Loops in Go 1.22 - The Go Programming Language', text: 'Go 1.22 will change the semantics of for loops' }
const OFF_TOPIC = [
  { title: 'Cooking pasta', text: 'Boil water and add salt.' },
  { title: 'Python for loop tutorial', text: 'A for loop in Python iterates over a sequence.' },
  { title: 'Weather today', text: 'Sunny with a light breeze' },
]

const constraint = (id: string, kind: Constraint['kind'], value: string, strength: Constraint['strength'] = 'hard'): Constraint => ({ id, kind, value, strength, origin: 'param' })
const candidate = (url: string, title: string, snippet: string): Candidate => ({
  candidateId: candidateIdOf(url), canonicalUrl: url, url, title, snippet, contributions: [{ providerId: 'ddg', rank: 1, query: 'q' }],
})

// ── S4 is cross-lingual ─────────────────────────────────────────────────────

test('gate: Chinese needs against English candidates are scored with the alignment, not the Han-diluted lexical score', () => {
  const ctx = relevanceContextOf(GO)
  for (const item of [RELEASE, FIXING, MISTAKES]) {
    const { relevance, aligned } = gateRelevance(ctx, item)
    assert.equal(aligned, true)
    assert.ok(relevance > lexicalRelevance(ctx, item, false), item.title + ': aligned beats lexical')
    assert.equal(gateItem(GO, item).gate.keep, true, item.title + ' stays')
    assert.equal(gateItem(GO, item).gate.aligned, true)
  }
  // Before the change the iterator-variable page (a real answer to n2) fell below the threshold; the alignment keeps it.
  assert.ok(lexicalRelevance(ctx, MISTAKES, false) < DEFAULT_RELEVANCE_THRESHOLD)
  assert.ok(gateRelevance(ctx, MISTAKES).relevance >= DEFAULT_RELEVANCE_THRESHOLD)
  // The exact real-host pair: at least one relevant candidate survives.
  const gated = gateCandidates(GO, [RELEASE, WIKI, ...OFF_TOPIC].map((c, i) => candidate('https://e.test/' + i, c.title, c.text)))
  assert.ok(keptCandidates(gated).some(c => c.title.startsWith('Go 1.22 Release Notes')))
  // Off-topic English pages still go.
  for (const g of gated.filter(c => OFF_TOPIC.some(o => o.title === c.title))) assert.equal(g.gate!.keep, false, g.title)
})

test('gate: same-language pairs are byte-identical to lexical-v1 (the calibrated function)', () => {
  const zh = { title: '配置 busy timeout', text: 'node:sqlite 的 busy timeout 选项用来设置等待时间，数据库忙时重试' }
  const zhTask: TaskSpec = { goal: '配置 node:sqlite 的 busy timeout', query: 'node:sqlite busy timeout 配置', needs: [{ id: 'n1', text: '如何配置 busy timeout 选项', critical: true }], constraints: [constraint('c1', 'entity', 'node:sqlite', 'soft')], budget: {} }
  const zhOut = gateItem(zhTask, zh).gate
  assert.equal(zhOut.aligned, undefined)
  assert.equal(zhOut.relevance, lexicalRelevance(relevanceContextOf(zhTask), zh, false))

  const enTask: TaskSpec = { goal: 'Set the busy timeout of node:sqlite', query: 'node:sqlite DatabaseSync busy timeout', needs: [{ id: 'n1', text: 'how to set the busy timeout option', critical: true }], constraints: [constraint('c1', 'entity', 'DatabaseSync', 'hard')], budget: {} }
  for (const en of [{ title: 'DatabaseSync busy timeout option', text: 'node:sqlite' }, { title: 'Cooking pasta', text: 'Boil water.' }, { title: 'busy_timeout pragma', text: 'The timeout option of the DatabaseSync class' }]) {
    const out = gateItem(enTask, en).gate
    assert.equal(out.aligned, undefined)
    assert.equal(out.relevance, lexicalRelevance(relevanceContextOf(enTask), en, false), en.title)
  }
  // English needs against a Chinese candidate are a language mismatch too: aligned.
  assert.equal(gateItem(enTask, zh).gate.aligned, true)
  // No letters at all in the needs: no language, so no alignment.
  const digits: TaskSpec = { ...enTask, needs: [{ id: 'n1', text: '1.22', critical: true }] }
  assert.equal(gateItem(digits, zh).gate.aligned, undefined)
})

// ── the floor ───────────────────────────────────────────────────────────────

test('floor: fewer than minKeep survivors are topped up from the best-fused dropped candidates, flagged low confidence', () => {
  const task: TaskSpec = { ...GO, constraints: [] }
  const items = [...OFF_TOPIC, { title: 'Weather again', text: 'Rain tomorrow' }, { title: 'More cooking', text: 'Bake bread' }]
  const gated = gateCandidates(task, items.map((c, i) => candidate('https://e.test/' + i, c.title, c.text)))
  assert.equal(keptCandidates(gated).length, 0, 'the gate alone drops everything')
  const { kept, added } = applyFloor(gated)
  assert.equal(DEFAULT_MIN_KEEP, 3)
  assert.equal(added, 3)
  assert.deepEqual(kept.map(c => c.url), ['https://e.test/0', 'https://e.test/1', 'https://e.test/2'], 'the top of the fused order')
  assert.ok(kept.every(c => c.gate!.keep === true && c.gate!.lowConfidence === true && c.gate!.relevance < DEFAULT_RELEVANCE_THRESHOLD))
  assert.equal(gated[0]!.gate!.keep, false, 'the input is not mutated')

  // Survivors stay first and unflagged; the floor only fills up to minKeep.
  const mixed = gateCandidates(task, [candidate('https://e.test/off', 'Cooking', 'pasta'), candidate('https://e.test/go', RELEASE.title, ''), candidate('https://e.test/off2', 'Weather', 'sun'), candidate('https://e.test/off3', 'Beach', 'sea')])
  const m = applyFloor(mixed)
  assert.deepEqual(m.kept.map(c => c.url), ['https://e.test/go', 'https://e.test/off', 'https://e.test/off2'])
  assert.deepEqual(m.kept.map(c => c.gate!.lowConfidence), [undefined, true, true])
  assert.equal(m.added, 2)

  // Enough survivors: nothing changes. minKeep 0 turns it off.
  const good = [1, 2, 3].map(i => candidate('https://e.test/g' + i, FIXING.title, FIXING.text))
  const full = gateCandidates(task, [...good, candidate('https://e.test/x', 'Cooking', 'pasta')])
  assert.equal(applyFloor(full).added, 0)
  assert.equal(applyFloor(full).kept.length, 3)
  assert.equal(applyFloor(gated, 0).kept.length, 0)
  // Fewer candidates than minKeep: all non-violators come back, no more.
  assert.equal(applyFloor(gated.slice(0, 2)).kept.length, 2)
})

test('floor: a definite hard-constraint violation is never resurrected', () => {
  const task: TaskSpec = { ...GO, constraints: [constraint('c1', 'exclude_site', 'blocked.test'), constraint('c2', 'exclude_term', 'Selenium')] }
  const gated = gateCandidates(task, [
    candidate('https://blocked.test/a', 'Cooking pasta', 'Boil water'),
    candidate('https://ok.test/b', 'Cooking pasta', 'Selenium Boil water'),
    candidate('https://ok.test/c', 'Weather', 'sun'),
    candidate('https://ok.test/d', 'Beach', 'sea'),
  ])
  assert.deepEqual(gated.map(c => c.gate!.reason), ['constraint', 'constraint', 'relevance', 'relevance'])
  const { kept, added } = applyFloor(gated)
  assert.deepEqual(kept.map(c => c.url), ['https://ok.test/c', 'https://ok.test/d'])
  assert.equal(added, 2)
  assert.ok(kept.every(c => c.gate!.violated === undefined))
  // All candidates violate: the pack stays empty (there is nothing admissible to bring back).
  assert.equal(applyFloor(gated.slice(0, 2)).kept.length, 0)
})

// ── in the pipeline ─────────────────────────────────────────────────────────

const PAGE = '# Loop variables\n\nGo 1.22 changes the for loop: each iteration of a for loop creates new variables, so closures and goroutines capture a fresh variable per iteration. When migrating old code, check code that relied on the shared variable.\n\n# Other\n\nSomething else entirely about modules.'

function harness(sources: { url: string; title: string; snippet: string }[], pages: Record<string, string> = {}) {
  const fetched: string[] = []
  const deps: PipelineDeps = {
    providerStatus: async ids => new Map(ids.map(id => [id, { state: 'ready' as const }])),
    searchProvider: async (): Promise<ProviderOutcome> => ({ state: 'ok', sources }),
    fetchPage: async (url): Promise<PageInput> => {
      fetched.push(url)
      if (pages[url] === undefined) throw new Error('404')
      return { url, text: pages[url]! }
    },
    scorers: {},
    configuredEngines: ['ddg', 'bing'],
    fusion: { k: 60, freshnessBoost: 0, freshnessDays: 30, authorityBoost: 0, authorityDomains: [] },
    newId: () => 'r_floor01',
  }
  return { deps, fetched }
}

test('pipeline: when the gate drops everything the pack still has low-confidence candidates, sources and a note', async () => {
  const off = [...OFF_TOPIC, { title: 'Beach holiday', text: 'Sea and sand' }].map((c, i) => ({ url: 'https://off.test/' + i, title: c.title, snippet: c.text }))
  const h = harness(off, { 'https://off.test/0': PAGE })
  const { pack } = await runPipeline(GO, h.deps)
  assert.equal(pack.stats.candidates, 4)
  assert.equal(pack.stats.kept, 3, 'minKeep candidates')
  assert.equal(pack.stats.lowConfidence, 3)
  assert.equal(pack.sources.length, 3)
  assert.ok(pack.sources.every(s => s.lowConfidence === true))
  assert.match(pack.notes.join('\n'), /relevance gate left 0 of 4 candidate\(s\): kept the 3 best-ranked one\(s\) as low relevance \(floor 3\)/)
  assert.ok(pack.gaps.every(g => g.reason !== 'no_candidates'), 'not an empty pack: ' + JSON.stringify(pack.gaps))
  assert.deepEqual(h.fetched.sort(), ['https://off.test/0', 'https://off.test/1', 'https://off.test/2'], 'the low-confidence candidates are readable')
  // The page text of a low-confidence candidate that does answer the needs is selected and flagged.
  assert.ok(pack.evidence.length > 0)
  assert.ok(pack.evidence.every(e => e.lowConfidence === true && e.url === 'https://off.test/0'))
  const text = renderEvidencePack(pack, pack.sources, 'Engine: x')
  assert.match(text, /\[1\] e_\w+ — .*https:\/\/off\.test\/0 \(low relevance\)/)
  assert.match(text, /Other sources:\n- \[Python for loop tutorial\]\(https:\/\/off\.test\/1\) \(low relevance\)/)
})

test('pipeline: a hard-constraint violator is not resurrected; with only violators the pack is honestly empty', async () => {
  const task: TaskSpec = { ...GO, constraints: [constraint('c1', 'exclude_site', 'blocked.test')] }
  const h = harness([
    { url: 'https://blocked.test/a', title: 'Cooking pasta', snippet: 'Boil water' },
    { url: 'https://ok.test/b', title: 'Weather today', snippet: 'Sunny' },
    { url: 'https://ok.test/c', title: 'Beach holiday', snippet: 'Sea and sand' },
  ])
  const { pack } = await runPipeline(task, h.deps)
  assert.deepEqual(pack.sources.map(s => s.url), ['https://ok.test/b', 'https://ok.test/c'])
  assert.equal(pack.stats.kept, 2)
  assert.ok(!h.fetched.includes('https://blocked.test/a'))

  const only = harness([{ url: 'https://blocked.test/a', title: 'Cooking pasta', snippet: 'Boil water' }])
  const empty = await runPipeline(task, only.deps)
  assert.equal(empty.pack.stats.kept, 0)
  assert.equal(empty.pack.stats.lowConfidence, undefined)
  assert.deepEqual(empty.pack.gaps.map(g => g.reason), ['no_candidates', 'no_candidates'])
})

test('pipeline: relevant candidates pass without the floor and carry no low-confidence mark', async () => {
  const h = harness([FIXING, RELEASE, MISTAKES].map((c, i) => ({ url: 'https://go.test/' + i, title: c.title, snippet: c.text })), { 'https://go.test/0': PAGE })
  const { pack } = await runPipeline(GO, h.deps)
  assert.equal(pack.stats.kept, 3)
  assert.equal(pack.stats.lowConfidence, undefined)
  assert.ok(pack.sources.every(s => s.lowConfidence === undefined))
  assert.ok(pack.evidence.length > 0 && pack.evidence.every(e => e.lowConfidence === undefined))
  assert.doesNotMatch(pack.notes.join('\n'), /low relevance/)
  assert.doesNotMatch(renderEvidencePack(pack, pack.sources, 'Engine: x'), /low relevance/)
})
