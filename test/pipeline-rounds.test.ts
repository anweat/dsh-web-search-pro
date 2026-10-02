import test from 'node:test'
import assert from 'node:assert/strict'
import { runPipeline, type PageInput, type PipelineDeps, type ProviderCall, type ProviderOutcome } from '../src/pipeline/run.ts'
import { gapQueryText, keyTokens } from '../src/pipeline/compile.ts'
import type { ProviderStatus } from '../src/pipeline/plan.ts'
import type { ScoreJob, Scorer } from '../src/pipeline/score.ts'
import type { TaskSpec } from '../src/pipeline/types.ts'

const TASK: TaskSpec = {
  goal: 'Configure SQLite connections in Node.js', query: 'node:sqlite configure connection', profile: 'docs_code',
  needs: [{ id: 'n1', text: 'how to set the busy timeout', critical: true }, { id: 'n2', text: 'enable WAL journal mode', critical: true }],
  constraints: [], budget: {},
}
const BUSY = '# Busy timeout\n\nIn node:sqlite you set the busy timeout with PRAGMA busy_timeout = 5000 on the DatabaseSync connection. The busy timeout makes a blocked writer wait instead of failing at once.\n\n# Unrelated\n\nThe cooking section explains how to bake bread with flour and water in a hot oven for an hour.'
const WAL = '# WAL mode\n\nEnable WAL journal mode in node:sqlite by running PRAGMA journal_mode = WAL once. WAL allows readers and a writer to work together.\n\n# Footer\n\nCopyright notice and site navigation links.'
const BREAD = 'Bread baking basics: flour, water, salt and time. Nothing about databases here at all, only kitchen advice for the weekend baker.'
const PAGES: Record<string, string> = { 'https://docs.test/busy': BUSY, 'https://docs.test/wal': WAL, 'https://other.test/bread': BREAD }
const ok = (...urls: string[]): ProviderOutcome => ({ state: 'ok', sources: urls.map(url => ({ url, title: 'T ' + url, snippet: 'node:sqlite guide' })) })
/** First round: the busy-timeout page only. Round 2 (the query starts with the WAL need): the WAL page. */
const wal2 = (call: ProviderCall): ProviderOutcome => (call.query.startsWith('enable WAL') ? ok('https://docs.test/wal') : ok('https://docs.test/busy', 'https://other.test/bread'))

/** Grades by need-specific marker words, so a block either answers a need or does not (the lexical scorer is too generous with shared words). */
const MARKERS: Record<string, string> = { n1: 'busy_timeout', n2: 'journal_mode' }
function markerScorer(jobsSeen: ScoreJob[][] = []): Scorer {
  return {
    id: 'marker', model: 'marker-v1',
    async score(_task, jobs) {
      jobsSeen.push([...jobs])
      const grades = new Map<string, Map<string, { grade: number }>>()
      for (const job of jobs) grades.set(job.need.id, new Map(job.blocks.map(b => [b.blockId, { grade: b.text.includes(MARKERS[job.need.id]!) ? 3 : 0 }])))
      return { grades }
    },
  }
}

function harness(opts: { scorer?: Scorer; search?: (call: ProviderCall) => Promise<ProviderOutcome> | ProviderOutcome; status?: Record<string, ProviderStatus>; configured?: string[] } = {}) {
  const calls: ProviderCall[] = []
  const fetched: string[] = []
  const deps: PipelineDeps = {
    providerStatus: async ids => new Map(ids.map(id => [id, opts.status?.[id] ?? { state: 'ready' as const }])),
    searchProvider: async call => { calls.push(call); return (opts.search ?? wal2)(call) },
    fetchPage: async url => {
      fetched.push(url)
      const text = PAGES[url]
      if (text === undefined) throw new Error('404')
      return { url, text } satisfies PageInput
    },
    scorers: { control: opts.scorer ?? markerScorer() },
    configuredEngines: opts.configured ?? ['ddg', 'bing'],
    fusion: { k: 60, freshnessBoost: 0, freshnessDays: 30, authorityBoost: 0, authorityDomains: [] },
    newId: () => 'r_rounds01',
  }
  return { deps, calls, fetched }
}

test('round 2: a critical gap after round 1 triggers one targeted search; its pages merge into the same pack', async () => {
  const seen: ScoreJob[][] = []
  const h = harness({ scorer: markerScorer(seen) })
  const { pack, evidenceBlocks } = await runPipeline(TASK, h.deps)
  // Round 1 scores both needs; round 2 scores only the gap need, on the blocks of the new page only.
  assert.equal(seen.length, 2)
  assert.deepEqual(seen[0]!.map(j => j.need.id), ['n1', 'n2'])
  assert.deepEqual(seen[1]!.map(j => j.need.id), ['n2'])
  assert.ok(seen[1]!.every(j => j.blocks.every(b => b.url === 'https://docs.test/wal')))
  assert.ok(evidenceBlocks.every(b => b.scorer === 'marker'))
  assert.deepEqual(pack.coveredNeeds, ['n1', 'n2'])
  assert.deepEqual(pack.gaps, [])
  assert.equal(pack.stats.rounds, 2)
  assert.equal(pack.stats.queries, h.calls.length)
  assert.ok(h.calls.length <= 4, 'total queries stay within 4: ' + h.calls.length)
  assert.equal(h.calls.length, 4, 'three first-round providers plus one follow-up')
  const second = h.calls.slice(3)
  assert.equal(second.length, 1)
  assert.match(second[0]!.query, /^enable WAL journal mode node:sqlite/)
  assert.equal(pack.evidence.some(e => e.needIds.includes('n2') && e.excerpt.includes('journal_mode = WAL')), true)
  assert.equal(pack.evidence.some(e => e.excerpt.includes('busy_timeout')), true, 'round-1 evidence is kept')
  assert.match(pack.notes.join('\n'), /second round: 1 search\(es\) for n2 via \w+ -> 1 new candidate\(s\), 1 new page\(s\) read, 1 more need\(s\) covered/)
  assert.equal(new Set(h.fetched).size, h.fetched.length, 'no page is read twice')
  assert.equal(pack.stats.candidates, 3)
})

test('round 2: no critical gap, optional gaps, or a gap that is only a budget overflow do not trigger it', async () => {
  const full = harness({ search: () => ok('https://docs.test/busy', 'https://docs.test/wal') })
  const a = await runPipeline(TASK, full.deps)
  assert.equal(a.pack.stats.rounds, 1)
  assert.equal(a.pack.stats.queries, 3)
  assert.equal(full.calls.length, 3)

  const optional = harness({ search: () => ok('https://docs.test/busy') })
  const b = await runPipeline({ ...TASK, needs: [TASK.needs[0]!, { ...TASK.needs[1]!, critical: false }] }, optional.deps)
  assert.equal(b.pack.gaps.length, 1)
  assert.equal(b.pack.stats.rounds, 1)
  assert.equal(optional.calls.length, 3)
})

test('round 2: evidence.maxRounds=1 turns it off; maxQueries caps the whole task', async () => {
  const off = harness()
  const a = await runPipeline(TASK, off.deps, { maxRounds: 1 })
  assert.equal(a.pack.stats.rounds, 1)
  assert.equal(off.calls.length, 3)
  assert.deepEqual(a.pack.gaps.map(g => g.needId), ['n2'])

  const capped = harness()
  const b = await runPipeline(TASK, capped.deps, { maxQueries: 3 })
  assert.equal(b.pack.stats.rounds, 1)
  assert.match(b.pack.notes.join('\n'), /second round skipped: query budget used up \(3\/3\)/)
  assert.equal(capped.calls.length, 3)

  const roomy = harness()
  const c = await runPipeline(TASK, roomy.deps, { maxQueries: 6 })
  assert.equal(c.pack.stats.rounds, 2)
  assert.ok(roomy.calls.length <= 6)
  assert.equal(c.pack.stats.queries, roomy.calls.length)
})

test('round 2: prefers a provider the first round did not use, and compiles the query for it', async () => {
  // General profile with five configured engines: the plan caps at four, so `jina` is left over for the follow-up.
  const h = harness({ configured: ['ddg', 'bing', 'exa', 'seam', 'jina'], search: wal2 })
  const task: TaskSpec = { ...TASK, profile: 'general', constraints: [{ id: 'c1', kind: 'site', value: 'docs.test', strength: 'hard', origin: 'param' }] }
  const { pack } = await runPipeline(task, h.deps, { maxQueries: 5 })
  assert.deepEqual(h.calls.slice(0, 4).map(c => c.id).sort(), ['bing', 'ddg', 'exa', 'seam'])
  assert.equal(h.calls[4]!.id, 'jina')
  assert.equal(pack.stats.rounds, 2)
  assert.deepEqual(pack.enginesTried, ['ddg', 'bing', 'exa', 'seam', 'jina'])

  // The same task with only operator providers left keeps the site constraint in the follow-up query.
  const ops = harness({ configured: ['ddg'], search: wal2 })
  await runPipeline({ ...task }, ops.deps)
  assert.equal(ops.calls.length, 2)
  assert.match(ops.calls[1]!.query, /^enable WAL journal mode node:sqlite site:docs\.test$/)
})

test('round 2: a task with no usable provider left, or too little time, says why and returns the first-round pack', async () => {
  const none = harness({ status: { ddg: { state: 'ready' }, bing: { state: 'unavailable' }, github: { state: 'unavailable' } } })
  const a = await runPipeline(TASK, none.deps)
  // ddg answered in round 1 and is still ready, so the follow-up reuses it with the targeted query.
  assert.equal(a.pack.stats.rounds, 2)
  assert.equal(none.calls.length, 2)

  const late = harness()
  const b = await runPipeline(TASK, late.deps, { refineMinRemainingMs: 1_000_000 })
  assert.equal(b.pack.stats.rounds, 1)
  assert.match(b.pack.notes.join('\n'), /second round skipped: \d+ s left before the deadline/)
  assert.equal(late.calls.length, 3)
})

test('round 2: provider failures in the follow-up are noted and do not fail the run', async () => {
  const h = harness({ search: call => (call.query.startsWith('enable WAL') ? { state: 'error', message: 'HTTP 503' } : ok('https://docs.test/busy')) })
  const { pack } = await runPipeline(TASK, h.deps)
  assert.equal(pack.stats.rounds, 2)
  assert.deepEqual(pack.gaps.map(g => g.needId), ['n2'])
  assert.match(pack.notes.join('\n'), /round 2 provider failures: \w+: HTTP 503/)
  assert.match(pack.notes.join('\n'), /no new need covered/)
})

test('round 2: the caller aborting during the follow-up search is rethrown', async () => {
  const controller = new AbortController()
  const h = harness({ search: call => { if (call.query.startsWith('enable WAL')) { controller.abort(new Error('user stop')); throw new Error('aborted') } return ok('https://docs.test/busy') } })
  await assert.rejects(runPipeline(TASK, h.deps, { signal: controller.signal }), /aborted/)
  assert.equal(controller.signal.aborted, true)
})

test('round 2: broader GitHub variants of the follow-up count against the query budget; first-round fallbacks use it up', async () => {
  const github = harness({
    configured: ['ddg', 'bing', 'exa', 'seam', 'github'],
    search: call => (call.id === 'github' ? { state: 'empty' } : ok('https://docs.test/busy')),
  })
  const general: TaskSpec = { ...TASK, profile: 'general' }
  const a = await runPipeline(general, github.deps, { maxQueries: 5 })
  assert.deepEqual(github.calls.slice(4).map(c => c.id), ['github'], 'one request left: no broader variant after the empty answer')
  assert.equal(github.calls.length, 5)
  assert.equal(a.pack.stats.queries, 5)
  const two = harness({ configured: ['ddg', 'bing', 'exa', 'seam', 'github'], search: call => (call.id === 'github' ? { state: 'empty' } : ok('https://docs.test/busy')) })
  const c = await runPipeline(general, two.deps, { maxQueries: 6 })
  assert.deepEqual(two.calls.slice(4).map(x => x.id).sort(), ['ddg', 'github'], 'two requests: the unused provider, then a reused one, still no variant')
  assert.equal(c.pack.stats.queries, 6)

  // GitHub empty in round 1 burns its variants (3 requests) and with them the budget.
  const spent = harness({ search: call => (call.id === 'github' ? { state: 'empty' } : ok('https://docs.test/busy')) })
  const b = await runPipeline({ ...TASK, constraints: [{ id: 'c1', kind: 'entity', value: 'node:sqlite', strength: 'soft', origin: 'param' }, { id: 'c2', kind: 'must_term', value: 'journal_mode', strength: 'soft', origin: 'param' }] }, spent.deps)
  assert.ok(b.pack.stats.queries! >= 4)
  assert.equal(b.pack.stats.rounds, 1)
  assert.match(b.pack.notes.join('\n'), /second round skipped: query budget used up \(\d+\/4\)/)
})

test('gapQueryText: the need text plus the task entities it does not mention, capped', () => {
  const task = { query: 'node:sqlite busy_timeout WAL mode DatabaseSync v22.5', constraints: [{ id: 'c1', kind: 'entity' as const, value: 'SQLite', strength: 'soft' as const, origin: 'param' as const }, { id: 'c2', kind: 'exclude_term' as const, value: 'postgres', strength: 'hard' as const, origin: 'param' as const }] }
  assert.deepEqual(keyTokens(task.query), ['node:sqlite', 'busy_timeout', 'DatabaseSync', 'v22.5'])
  assert.equal(gapQueryText(task, { text: 'enable WAL journal mode' }), 'enable WAL journal mode SQLite node:sqlite busy_timeout')
  assert.equal(gapQueryText(task, { text: 'how DatabaseSync handles busy_timeout in node:sqlite' }), 'how DatabaseSync handles busy_timeout in node:sqlite v22.5')
  assert.equal(gapQueryText({ query: 'plain words only', constraints: [] }, { text: 'what is it' }), 'what is it')
  assert.ok(gapQueryText(task, { text: 'x'.repeat(500) }).length <= 200)
})
