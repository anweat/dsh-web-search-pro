import test from 'node:test'
import assert from 'node:assert/strict'
import { limitQuestions, runPipeline, verificationOf, type PageInput, type PipelineDeps, type ProviderCall, type ProviderOutcome } from '../src/pipeline/run.ts'
import { compileQuery } from '../src/pipeline/compile.ts'
import { RuleScorer, type ScoreJob, type Scorer } from '../src/pipeline/score.ts'
import type { ProviderStatus } from '../src/pipeline/plan.ts'
import type { TaskSpec } from '../src/pipeline/types.ts'

const TASK: TaskSpec = {
  goal: 'Configure busy timeout and WAL mode for node:sqlite', query: 'node:sqlite busy timeout WAL mode', profile: 'docs_code',
  needs: [{ id: 'n1', text: 'how to set busy timeout in node:sqlite', critical: true }, { id: 'n2', text: 'enable WAL journal mode in node:sqlite', critical: true }],
  constraints: [], budget: {},
}

const BUSY = '# Busy timeout\n\nIn node:sqlite you set the busy timeout with PRAGMA busy_timeout = 5000 on the DatabaseSync connection. The busy timeout makes a blocked writer wait instead of failing at once.\n\n# Unrelated\n\nThe cooking section explains how to bake bread with flour and water in a hot oven for an hour.'
const WAL = '# WAL mode\n\nEnable WAL journal mode in node:sqlite by running PRAGMA journal_mode = WAL once. WAL allows readers and a writer to work together.\n\n# Footer\n\nCopyright notice and site navigation links.'
const PAGES: Record<string, string> = {
  'https://docs.test/busy': BUSY,
  'https://docs.test/wal': WAL,
  'https://blog.test/mix': BUSY + '\n\n' + WAL,
  'https://other.test/bread': 'Bread baking basics: flour, water, salt and time. Nothing about databases here at all, only kitchen advice for the weekend baker.',
}
const okSources = (...urls: string[]): ProviderOutcome => ({ state: 'ok', sources: urls.map(url => ({ url, title: 'T ' + url, snippet: 'node:sqlite busy timeout WAL mode guide' })) })

function harness(over: Partial<PipelineDeps> & { search?: (call: ProviderCall) => Promise<ProviderOutcome> | ProviderOutcome; pages?: Record<string, string | Error>; status?: Record<string, ProviderStatus> } = {}) {
  const calls: ProviderCall[] = []
  const fetched: string[] = []
  let inflight = 0
  let peak = 0
  const deps: PipelineDeps = {
    providerStatus: async ids => new Map(ids.map(id => [id, over.status?.[id] ?? { state: 'ready' as const }])),
    searchProvider: async call => {
      calls.push(call)
      return (over.search ?? ((c: ProviderCall) => okSources('https://docs.test/busy', 'https://docs.test/wal', c.id === 'github' ? 'https://blog.test/mix' : 'https://other.test/bread')))(call)
    },
    fetchPage: async (url, signal) => {
      fetched.push(url)
      inflight++
      peak = Math.max(peak, inflight)
      try {
        await new Promise(resolve => setTimeout(resolve, 2))
        if (signal.aborted) throw signal.reason
        const page = (over.pages ?? PAGES)[url]
        if (page instanceof Error) throw page
        if (page === undefined) throw new Error('404')
        return { url, text: page } satisfies PageInput
      } finally { inflight-- }
    },
    scorers: {},
    configuredEngines: ['ddg', 'bing'],
    fusion: { k: 60, freshnessBoost: 0, freshnessDays: 30, authorityBoost: 0, authorityDomains: [] },
    newId: () => 'r_test0001',
    ...over.providerStatus ? { providerStatus: over.providerStatus } : {},
    ...over.scorers ? { scorers: over.scorers } : {},
  }
  return { deps, calls, fetched, peak: () => peak }
}

test('pipeline: S1-S8 produce a pack with evidence, coverage, sources and verification', async () => {
  const h = harness()
  const { pack, evidenceBlocks } = await runPipeline(TASK, h.deps)
  assert.equal(pack.resultId, 'r_test0001')
  assert.equal(pack.profile, 'docs_code')
  assert.equal(pack.profileInferred, false)
  assert.deepEqual(pack.enginesTried, ['ddg', 'bing', 'github'])
  assert.deepEqual(h.calls.map(c => c.id).sort(), ['bing', 'ddg', 'github'])
  assert.equal(pack.engine, 'pipeline(ddg+bing+github)')
  assert.deepEqual(pack.coveredNeeds, ['n1', 'n2'])
  assert.deepEqual(pack.gaps, [])
  assert.equal(pack.partial, false)
  assert.ok(pack.evidence.length >= 2 && pack.evidence.length <= 6)
  const busy = pack.evidence.find(e => e.excerpt.includes('PRAGMA busy_timeout'))!
  assert.ok(busy, 'the busy_timeout passage is in the pack')
  assert.match(busy.evidenceId, /^e_[0-9a-f]{10}$/)
  assert.ok(busy.needIds.includes('n1'))
  assert.ok(busy.grade >= 2)
  assert.equal(busy.heading, 'Busy timeout')
  assert.match(busy.source, /ddg/)
  assert.ok(!pack.evidence.some(e => e.excerpt.includes('bake bread')), 'off-topic blocks are not selected')
  assert.ok(pack.evidence.reduce((n, e) => n + e.excerpt.length, 0) <= 6000)
  assert.equal(pack.stats.scorer, 'rule')
  assert.equal(pack.stats.candidates, 4)
  assert.ok(pack.stats.fetched >= 1 && pack.stats.fetched <= 4)
  assert.equal(pack.sources[0]!.url.startsWith('https://'), true)
  assert.equal(evidenceBlocks.length, pack.evidence.length)
  assert.ok(evidenceBlocks.every(b => b.scorer === 'rule' && b.text.length > 0 && b.hash))
  assert.deepEqual(pack.verification, { native: [], local: [] })
})

test('pipeline: GitHub runs its broader keyword queries one after another while empty', async () => {
  const seen: string[] = []
  const h = harness({
    search: call => {
      if (call.id !== 'github') return okSources('https://docs.test/busy')
      seen.push(call.query)
      return seen.length < 3 ? { state: 'empty' } : okSources('https://docs.test/wal')
    },
  })
  const task: TaskSpec = { ...TASK, query: 'node:sqlite busy_timeout WAL journal mode pragma', constraints: [{ id: 'c1', kind: 'entity', value: 'node:sqlite', strength: 'soft', origin: 'param' }] }
  const { pack } = await runPipeline(task, h.deps)
  const github = compileQuery(task, 'github')
  assert.deepEqual(seen, [github.query, ...github.fallbacks!.slice(0, 2)])
  assert.ok(seen.length === 3)
  assert.equal(pack.stats.candidates, 2, 'the third attempt answered')
})

test('pipeline: unavailable and cooling providers are not called; explicit engines override the profile table', async () => {
  const h = harness({ status: { bing: { state: 'cooldown', reason: 'HTTP 429' }, github: { state: 'unavailable', reason: 'rate limited' } } })
  const { pack } = await runPipeline(TASK, h.deps)
  assert.deepEqual(h.calls.map(c => c.id), ['ddg'])
  assert.match(pack.notes.join('\n'), /skipped providers: bing \[cooldown \(HTTP 429\)\], github \[unavailable \(rate limited\)\]/)
  const explicit = harness()
  await runPipeline(TASK, explicit.deps, { engines: ['arxiv', 'ddg'] })
  assert.deepEqual(explicit.calls.map(c => c.id).sort(), ['arxiv', 'ddg'])
})

test('pipeline: nothing usable or nothing found is an empty pack with notes; only runtime failures throw', async () => {
  const none = harness({ status: { ddg: { state: 'unavailable' }, bing: { state: 'unavailable' }, github: { state: 'cooldown' } } })
  const a = await runPipeline(TASK, none.deps)
  assert.deepEqual(a.pack.evidence, [])
  assert.deepEqual(a.pack.sources, [])
  assert.equal(a.pack.engine, 'pipeline(none)')
  assert.match(a.pack.notes.join('\n'), /no usable provider/)
  assert.deepEqual(a.pack.gaps.map(g => g.reason), ['no_candidates', 'no_candidates'])
  assert.equal(none.calls.length, 0)

  const empty = harness({ search: () => ({ state: 'empty' }) })
  const b = await runPipeline(TASK, empty.deps)
  assert.deepEqual(b.pack.evidence, [])
  assert.equal(b.pack.stats.candidates, 0)

  const skipped = harness({ search: () => ({ state: 'skipped', reason: 'down' }) })
  assert.match((await runPipeline(TASK, skipped.deps)).pack.notes.join('\n'), /provider ddg skipped: down/)

  const broken = harness({ search: call => (call.id === 'ddg' ? { state: 'error', message: 'HTTP 503' } : { state: 'empty' }) })
  await assert.rejects(runPipeline(TASK, broken.deps), /all providers failed: ddg: HTTP 503/)
  const partialFail = harness({ search: call => (call.id === 'ddg' ? { state: 'error', message: 'HTTP 503' } : okSources('https://docs.test/busy')) })
  const c = await runPipeline(TASK, partialFail.deps)
  assert.match(c.pack.notes.join('\n'), /provider failures: ddg: HTTP 503/)
  assert.ok(c.pack.evidence.length > 0)
})

test('pipeline: a thrown provider error counts as a failure, not a crash', async () => {
  const h = harness({ search: call => { if (call.id === 'bing') throw new Error('socket hang up'); return okSources('https://docs.test/busy') } })
  const { pack } = await runPipeline(TASK, h.deps)
  assert.match(pack.notes.join('\n'), /bing: socket hang up/)
  assert.ok(pack.evidence.length > 0)
})

test('pipeline: the hard-constraint gate keeps dropped candidates out of S5', async () => {
  const h = harness({ search: () => okSources('https://docs.test/busy', 'https://forbidden.test/x') })
  const task: TaskSpec = { ...TASK, constraints: [{ id: 'c1', kind: 'exclude_site', value: 'forbidden.test', strength: 'hard', origin: 'param' }] }
  const { pack } = await runPipeline(task, h.deps)
  assert.ok(!h.fetched.includes('https://forbidden.test/x'))
  assert.ok(!pack.sources.some(s => s.url.includes('forbidden')))
  assert.deepEqual(pack.verification, { native: ['exclude_site=forbidden.test (ddg,bing)'], local: [] })
})

test('pipeline: S5 reads the top K kept candidates, two at a time; failures and shell pages stay navigation-only', async () => {
  const urls = Array.from({ length: 8 }, (_, i) => 'https://many.test/' + i)
  const pages: Record<string, string | Error> = {
    'https://many.test/0': new Error('HTTP 403'),
    'https://many.test/1': BUSY,
    'https://many.test/2': WAL,
    'https://many.test/3': 'x',
  }
  for (const u of urls.slice(4)) pages[u] = BUSY + ' ' + u
  const h = harness({ search: () => okSources(...urls), pages })
  const { pack } = await runPipeline(TASK, h.deps, { fetchTopK: 4, fetchConcurrency: 2 })
  assert.equal(h.fetched.length, 4, 'exactly K attempts')
  assert.ok(h.peak() <= 2)
  assert.match(pack.notes.join('\n'), /1 page\(s\) could not be read/)
  assert.equal(pack.stats.fetched, 3)
  assert.equal(pack.sources.length, 8, 'unread candidates stay as sources')
  assert.ok(pack.sources.some(s => s.url === 'https://many.test/0'), 'the failed page is still a navigation source')
  const shell = harness({ search: () => okSources('https://shell.test/'), pages: { 'https://shell.test/': 'shell' } })
  shell.deps.fetchPage = async url => ({ url, text: 'Search for things. '.repeat(20), shellPage: true })
  const s = await runPipeline(TASK, shell.deps)
  assert.equal(s.pack.stats.fetched, 0)
  assert.deepEqual(s.pack.gaps.map(g => g.reason), ['no_page_content', 'no_page_content'])
  const none = await runPipeline(TASK, harness().deps, { fetchTopK: 0 })
  assert.equal(none.pack.stats.fetched, 0)
})

test('pipeline: a fetcher that returns undefined does not use up a slot (offline snapshots)', async () => {
  const h = harness({ search: () => okSources('https://n1.test/', 'https://n2.test/', 'https://docs.test/busy', 'https://docs.test/wal') })
  const fetched: string[] = []
  h.deps.fetchPage = async url => { fetched.push(url); return PAGES[url] === undefined ? undefined : { url, text: PAGES[url]! } }
  const { pack } = await runPipeline(TASK, h.deps, { fetchTopK: 2, fetchConcurrency: 1 })
  assert.equal(pack.stats.fetched, 2)
  assert.equal(fetched.length, 4)
})

test('pipeline: identical page text under two URLs is read once', async () => {
  const h = harness({ search: () => okSources('https://docs.test/busy', 'https://mirror.test/busy'), pages: { 'https://docs.test/busy': BUSY, 'https://mirror.test/busy': BUSY } })
  const { pack } = await runPipeline(TASK, h.deps)
  assert.equal(pack.stats.fetched, 1)
})

test('pipeline: the deadline cuts slow stages and returns a partial pack; the caller signal rethrows', async () => {
  const slow = harness({ search: () => okSources('https://docs.test/busy', 'https://docs.test/wal') })
  slow.deps.fetchPage = (_url, signal) => new Promise((_resolve, reject) => { signal.addEventListener('abort', () => reject(signal.reason)) })
  const started = Date.now()
  const { pack } = await runPipeline(TASK, slow.deps, { deadlineMs: 60 })
  assert.ok(Date.now() - started < 1500)
  assert.equal(pack.partial, true)
  assert.match(pack.notes.join('\n'), /deadline reached while reading pages/)
  assert.equal(pack.stats.fetched, 0)
  assert.ok(pack.sources.length > 0, 'candidates survive as navigation sources')

  const hangingSearch = harness({ search: call => new Promise<ProviderOutcome>((_r, reject) => { call.signal.addEventListener('abort', () => reject(call.signal.reason)) }) })
  const cut = await runPipeline(TASK, hangingSearch.deps, { deadlineMs: 40 })
  assert.equal(cut.pack.partial, true)
  assert.match(cut.pack.notes.join('\n'), /deadline reached while searching/)

  const controller = new AbortController()
  const pending = runPipeline(TASK, slow.deps, { signal: controller.signal, deadlineMs: 10_000 })
  setTimeout(() => controller.abort(new Error('user cancelled')), 20)
  await assert.rejects(pending, /user cancelled/)
})

// ── S6 scorer wiring ────────────────────────────────────────────────────────

function fakeJev(grade: (job: ScoreJob, blockId: string, i: number) => number | undefined, opts: { fail?: boolean } = {}): Scorer & { seen: ScoreJob[][] } {
  const seen: ScoreJob[][] = []
  return {
    id: 'jev', model: 'fake', seen,
    async score(_task, jobs) {
      seen.push([...jobs])
      if (opts.fail) throw new Error('HTTP 500 boom')
      const grades = new Map<string, Map<string, { grade: number; rank: number }>>()
      for (const job of jobs) {
        const m = new Map<string, { grade: number; rank: number }>()
        job.blocks.forEach((b, i) => { const g = grade(job, b.blockId, i); if (g !== undefined) m.set(b.blockId, { grade: g, rank: g }) })
        grades.set(job.need.id, m)
      }
      return { grades, usage: { requests: 1, questions: jobs.reduce((n, j) => n + j.blocks.length, 0), cacheHits: 0, inputTokens: 1234, outputTokens: 0 } }
    },
  }
}

test('pipeline: a control scorer decides S6 and its usage is reported', async () => {
  const jev = fakeJev((job, _id, i) => (i === 0 ? 3 : 0.2))
  const h = harness({ scorers: { control: jev } })
  const { pack, evidenceBlocks } = await runPipeline(TASK, h.deps)
  assert.equal(pack.stats.scorer, 'jev')
  assert.deepEqual(pack.stats.jev, { requests: 1, questions: jev.seen[0]!.reduce((n, j) => n + j.blocks.length, 0), inputTokens: 1234, outputTokens: 0, mode: 'control' })
  assert.ok(pack.evidence.every(e => e.grade === 3), 'only the blocks Jev graded 3 qualify')
  assert.ok(evidenceBlocks.every(b => b.scorer === 'jev'))
  assert.equal(jev.seen[0]!.length, 2, 'one job per need')
})

test('pipeline: any control-scorer failure falls back to the rule scorer with a note', async () => {
  const h = harness({ scorers: { control: fakeJev(() => 3, { fail: true }) } })
  const { pack } = await runPipeline(TASK, h.deps)
  assert.equal(pack.stats.scorer, 'rule')
  assert.match(pack.notes.join('\n'), /scorer jev failed, used the rule scorer: HTTP 500 boom/)
  assert.ok(pack.evidence.length > 0)
  assert.equal(pack.stats.jev, undefined)
})

test('pipeline: blocks the remote scorer did not answer are not eligible; questions are capped', async () => {
  const answered = new Set<string>()
  const jev = fakeJev((_job, id, i) => { if (i < 1) { answered.add(id); return 3 } return undefined })
  const h = harness({ scorers: { control: jev } })
  const { pack } = await runPipeline(TASK, h.deps, { maxScoreQuestions: 2 })
  assert.equal(jev.seen[0]!.reduce((n, j) => n + j.blocks.length, 0), 2, 'one question per need under a cap of two')
  assert.ok(pack.evidence.every(e => answered.has(e.blockId)))
  assert.deepEqual(limitQuestions([{ need: TASK.needs[0]!, blocks: [1, 2, 3].map(i => ({ blockId: 'a' + i, url: 'u', text: 't' })) }, { need: TASK.needs[1]!, blocks: [1, 2].map(i => ({ blockId: 'b' + i, url: 'u', text: 't' })) }], 4).map(j => j.blocks.map(b => b.blockId)), [['a1', 'a2'], ['b1', 'b2']])
  assert.deepEqual(limitQuestions([{ need: TASK.needs[0]!, blocks: [] }], 4), [{ need: TASK.needs[0]!, blocks: [] }].slice(0, 1))
})

test('pipeline: shadow mode leaves the rule pack untouched and records both scores', async () => {
  const rule = await runPipeline(TASK, harness().deps)
  const shadowJev = fakeJev(() => 2.5)
  const withShadow = await runPipeline(TASK, harness({ scorers: { shadow: shadowJev } }).deps)
  assert.deepEqual(withShadow.pack.evidence, rule.pack.evidence)
  assert.deepEqual(withShadow.pack.coveredNeeds, rule.pack.coveredNeeds)
  assert.equal(withShadow.pack.stats.scorer, 'rule')
  assert.equal(withShadow.pack.stats.jev!.mode, 'shadow')
  assert.equal(withShadow.shadow!.scorer, 'jev')
  assert.ok(withShadow.shadow!.rows.length > 0)
  assert.ok(withShadow.shadow!.rows.every(r => r.shadow === 2.5 && r.control >= 0 && r.control <= 3))
  const broken = await runPipeline(TASK, harness({ scorers: { shadow: fakeJev(() => 1, { fail: true }) } }).deps)
  assert.deepEqual(broken.pack.evidence, rule.pack.evidence)
  assert.match(broken.pack.notes.join('\n'), /shadow scorer jev failed: HTTP 500 boom/)
  assert.equal(broken.shadow, undefined)
  assert.ok(new RuleScorer().id === 'rule')
})

test('pipeline: verification lists natively enforced constraints per provider and the local-only rest', () => {
  const task: TaskSpec = { ...TASK, constraints: [
    { id: 'c1', kind: 'site', value: 'github.com', strength: 'hard', origin: 'param' },
    { id: 'c2', kind: 'entity', value: 'node:sqlite', strength: 'hard', origin: 'param' },
    { id: 'c3', kind: 'time_window', value: '2025 年以后', strength: 'hard', origin: 'param' },
  ] }
  const v = verificationOf(task, [compileQuery(task, 'ddg'), compileQuery(task, 'exa')])
  assert.deepEqual(v, { native: ['site=github.com (ddg,exa)', 'time_window=2025 年以后 (exa)'], local: ['entity=node:sqlite'] })
})

test('pipeline: a budget and per-URL limit from the task reach selection', async () => {
  const small = await runPipeline({ ...TASK, budget: { chars: 500, maxPerUrl: 1 } }, harness().deps)
  assert.ok(small.pack.stats.excerptChars <= 500)
  assert.equal(new Set(small.pack.evidence.map(e => e.url)).size, small.pack.evidence.length)
})
