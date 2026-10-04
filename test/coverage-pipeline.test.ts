import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { resolveConfig } from '../src/config.ts'
import type { CoverageStage } from '../src/pipeline/coverage.ts'
import { resolveCoverageSettings } from '../src/pipeline/coverage.ts'
import type { CoverageItem, CoverageJudge } from '../src/pipeline/judges/coverage.ts'
import { judgeStatus } from '../src/pipeline/judge-status.ts'
import { renderEvidencePack } from '../src/pipeline/render.ts'
import { builtinRubric, refOf } from '../src/pipeline/rubrics.ts'
import { runPipeline, type PageInput, type PipelineDeps, type ProviderCall, type ProviderOutcome } from '../src/pipeline/run.ts'
import { EvidenceService } from '../src/pipeline/service.ts'
import type { ScoreJob, Scorer } from '../src/pipeline/score.ts'
import type { TaskSpec } from '../src/pipeline/types.ts'
import { Store } from '../src/store.ts'
import { findAction } from '../src/actions/registry.ts'
import { checkOutput } from '../src/actions/schema.ts'

// ── pipeline level: a mock judge and a marker scorer ────────────────────────

const TASK: TaskSpec = {
  goal: 'Configure SQLite connections in Node.js', query: 'node:sqlite configure connection', profile: 'docs_code',
  needs: [{ id: 'n1', text: 'how to set the busy timeout', critical: true }, { id: 'n2', text: 'enable WAL journal mode', critical: false }],
  constraints: [], budget: {},
}
const BUSY = '# Busy timeout\n\nIn node:sqlite you set the busy timeout with PRAGMA busy_timeout = 5000 on the DatabaseSync connection. The busy timeout makes a blocked writer wait instead of failing at once.\n\n# Unrelated\n\nThe cooking section explains how to bake bread with flour and water in a hot oven for an hour.'
const WAL = '# WAL mode\n\nEnable WAL journal mode in node:sqlite by running PRAGMA journal_mode = WAL once. WAL allows readers and a writer to work together.\n\n# Footer\n\nCopyright notice and site navigation links.'
const PAGES: Record<string, string> = { 'https://docs.test/busy': BUSY, 'https://docs.test/wal': WAL }
const bothPages = (): ProviderOutcome => ({ state: 'ok', sources: Object.keys(PAGES).map(url => ({ url, title: 'T ' + url, snippet: 'node:sqlite guide' })) })
const MARKERS: Record<string, string> = { n1: 'busy_timeout', n2: 'journal_mode' }
const markerScorer: Scorer = {
  id: 'marker', model: 'marker-v1',
  async score(_task, jobs: readonly ScoreJob[]) {
    const grades = new Map<string, Map<string, { grade: number }>>()
    for (const job of jobs) grades.set(job.need.id, new Map(job.blocks.map(b => [b.blockId, { grade: b.text.includes(MARKERS[job.need.id]!) ? 3 : 0 }])))
    return { grades }
  },
}

/** A judge that answers from `probs` (needId -> probability; absent = no answer) and records what it was asked. */
function mockJudge(probs: Record<string, number>, fail?: Error) {
  const asked: CoverageItem[][] = []
  const judge: CoverageJudge = {
    id: 'jev', model: 'mock-1', rubricRef: refOf(builtinRubric('cover.sufficient')), provider: { id: 'mock', protocol: 'systemone', model: 'mock-1' },
    async judge(_task, items) {
      asked.push([...items])
      if (fail) throw fail
      return { probs: new Map(items.filter(i => probs[i.needId] !== undefined).map(i => [i.needId, probs[i.needId]!])), usage: { requests: 1, questions: items.length, cacheHits: 0, inputTokens: 100 * items.length, outputTokens: 2 }, notes: [] }
    },
  }
  return { judge, asked }
}
const THRESHOLDS = { weak: 0.3, covered: 0.7 }

function harness(coverage?: CoverageStage) {
  const calls: ProviderCall[] = []
  const deps: PipelineDeps = {
    providerStatus: async ids => new Map(ids.map(id => [id, { state: 'ready' as const }])),
    searchProvider: async call => { calls.push(call); return bothPages() },
    fetchPage: async url => { const text = PAGES[url]; if (text === undefined) throw new Error('404'); return { url, text } satisfies PageInput },
    scorers: { control: markerScorer },
    ...coverage ? { coverage } : {},
    configuredEngines: ['ddg', 'bing'],
    fusion: { k: 60, freshnessBoost: 0, freshnessDays: 30, authorityBoost: 0, authorityDomains: [] },
    newId: () => 'r_cover01',
  }
  return { deps, calls }
}

test('off (no stage): rule coverage only, no stats.coverage, nothing asked', async () => {
  const h = harness()
  const { pack } = await runPipeline(TASK, h.deps)
  assert.deepEqual(pack.coveredNeeds, ['n1', 'n2'])
  assert.deepEqual(pack.gaps, [])
  assert.equal(pack.stats.coverage, undefined)
  assert.equal(pack.uncertainNeeds, undefined)
})

test('shadow: verdicts are recorded (raw probabilities in stats), the coverage and the rounds are unchanged', async () => {
  const m = mockJudge({ n1: 0.1, n2: 0.9 })
  const h = harness({ mode: 'shadow', judge: m.judge, thresholds: THRESHOLDS })
  const { pack } = await runPipeline(TASK, h.deps)
  assert.deepEqual(pack.coveredNeeds, ['n1', 'n2'])
  assert.deepEqual(pack.gaps, [])
  assert.equal(pack.uncertainNeeds, undefined)
  assert.equal(pack.stats.rounds, 1)
  assert.equal(h.calls.length, 3, 'a weak verdict in shadow does not start a second round')
  const c = pack.stats.coverage!
  assert.deepEqual([c.mode, c.provider, c.protocol, c.model, c.asked, c.weak, c.uncertain, c.requests, c.inputTokens, c.outputTokens], ['shadow', 'mock', 'systemone', 'mock-1', 2, 1, 0, 1, 200, 2])
  assert.match(c.rubric, /^cover\.sufficient@v1#[0-9a-f]{12}$/)
  assert.deepEqual(c.thresholds, THRESHOLDS)
  assert.deepEqual(c.verdicts, [{ needId: 'n1', prob: 0.1, band: 'weak' }, { needId: 'n2', prob: 0.9, band: 'covered' }])
  // The judge saw, per need, the excerpts mapped to it (numbered, with title and host), not the other need's.
  assert.equal(m.asked[0]!.length, 2)
  assert.match(m.asked[0]![0]!.evidence, /^\[1\] T https:\/\/docs\.test\/busy — docs\.test\n/)
  assert.ok(m.asked[0]![0]!.evidence.includes('busy_timeout = 5000'))
  assert.ok(!m.asked[0]![0]!.evidence.includes('journal_mode = WAL'))
  assert.equal(m.asked[0]![0]!.need, 'how to set the busy timeout')
})

test('control: a weak verdict on a critical need makes it a weak_support gap and triggers the existing bounded second round; the judge is not asked twice about an unchanged view', async () => {
  const m = mockJudge({ n1: 0.1, n2: 0.9 })
  const h = harness({ mode: 'control', judge: m.judge, thresholds: THRESHOLDS })
  const { pack } = await runPipeline(TASK, h.deps)
  assert.deepEqual(pack.coveredNeeds, ['n2'])
  assert.deepEqual(pack.gaps, [{ needId: 'n1', text: 'how to set the busy timeout', critical: true, reason: 'weak_support', band: 'weak' }])
  assert.equal(pack.stats.rounds, 2)
  assert.equal(h.calls.length, 4)
  assert.match(h.calls[3]!.query, /^how to set the busy timeout/)
  assert.match(pack.notes.join('\n'), /second round: 1 search\(es\) for n1 .* no new need covered/)
  // Round 1 asked about n1 and n2; the second round brought no new page, so the views and the verdicts stand: one call only.
  assert.equal(m.asked.length, 1)
  assert.equal(pack.stats.coverage!.weak, 1)
  assert.equal(pack.stats.coverage!.requests, 1)
})

test('control: a weak verdict on an optional need is a gap without a second round; maxRounds=1 also keeps it to one round', async () => {
  const m = mockJudge({ n1: 0.9, n2: 0.05 })
  const h = harness({ mode: 'control', judge: m.judge, thresholds: THRESHOLDS })
  const { pack } = await runPipeline(TASK, h.deps)
  assert.deepEqual(pack.coveredNeeds, ['n1'])
  assert.deepEqual(pack.gaps.map(g => [g.needId, g.reason, g.band, g.critical]), [['n2', 'weak_support', 'weak', false]])
  assert.equal(pack.stats.rounds, 1)
  assert.equal(h.calls.length, 3)

  const m2 = mockJudge({ n1: 0.0, n2: 0.9 })
  const h2 = harness({ mode: 'control', judge: m2.judge, thresholds: THRESHOLDS })
  const { pack: p2 } = await runPipeline(TASK, h2.deps, { maxRounds: 1 })
  assert.equal(p2.stats.rounds, 1)
  assert.equal(h2.calls.length, 3)
  assert.deepEqual(p2.gaps.map(g => g.needId), ['n1'])
})

test('control: a view that changes after the second round is judged again (a fresh question, not the stale verdict)', async () => {
  // Round 1 finds one busy-timeout page; the judge calls it weak, so round 2 searches for n1 and brings a second page: the view changed.
  const asked: CoverageItem[][] = []
  const judge: CoverageJudge = {
    id: 'jev', model: 'mock-1', rubricRef: refOf(builtinRubric('cover.sufficient')), provider: { id: 'mock', protocol: 'systemone', model: 'mock-1' },
    async judge(_task, items) {
      asked.push([...items])
      const prob = asked.length === 1 ? 0.2 : 0.9
      return { probs: new Map(items.map(i => [i.needId, prob])), usage: { requests: 1, questions: items.length, cacheHits: 0, inputTokens: 50, outputTokens: 0 }, notes: [] }
    },
  }
  const MORE = '# Busy timeout (more)\n\nSet PRAGMA busy_timeout = 10000 to let a blocked DatabaseSync writer wait ten seconds before SQLITE_BUSY is raised. This is the recommended busy_timeout for write-heavy workloads.'
  const deps: PipelineDeps = {
    providerStatus: async ids => new Map(ids.map(id => [id, { state: 'ready' as const }])),
    searchProvider: async call => ({ state: 'ok', sources: call.query.startsWith('how to set the busy') ? [{ url: 'https://docs.test/busy2', title: 'B2', snippet: 'node:sqlite' }, { url: 'https://docs.test/busy', title: 'B', snippet: 'node:sqlite' }] : [{ url: 'https://docs.test/busy', title: 'B', snippet: 'node:sqlite' }] }),
    fetchPage: async url => ({ url, text: url.endsWith('busy2') ? MORE : PAGES[url]! }),
    scorers: { control: markerScorer }, coverage: { mode: 'control', judge, thresholds: THRESHOLDS },
    configuredEngines: ['ddg', 'bing'], fusion: { k: 60, freshnessBoost: 0, freshnessDays: 30, authorityBoost: 0, authorityDomains: [] }, newId: () => 'r_cover02',
  }
  const { pack } = await runPipeline(TASK, deps, { fetchTopK: 1 })
  assert.equal(pack.stats.rounds, 2)
  assert.equal(asked.length, 2, 'asked once after round 1 and once more because the evidence for n1 changed')
  assert.deepEqual(asked.map(a => a.map(i => i.needId)), [['n1'], ['n1']])
  assert.notEqual(asked[0]![0]!.evidence, asked[1]![0]!.evidence)
  assert.ok(asked[1]![0]!.evidence.includes('busy_timeout = 10000'))
  assert.deepEqual(pack.coveredNeeds, ['n1'])
  assert.deepEqual(pack.gaps.map(g => [g.needId, g.reason]), [['n2', 'weak_support']])
  assert.equal(pack.gaps[0]!.band, undefined, 'n2 stays a rule gap (no excerpt, never judged)')
  assert.deepEqual(pack.stats.coverage!.verdicts.map(v => [v.needId, v.prob, v.band]), [['n1', 0.9, 'covered']])
  assert.equal(pack.stats.coverage!.requests, 2)
  assert.match(pack.notes.join('\n'), /second round: 1 search\(es\) for n1 .* 1 more need\(s\) covered/)
})

test('control: an uncertain verdict keeps the need covered with a caution marker; the rendered pack shows it', async () => {
  const m = mockJudge({ n1: 0.5, n2: 0.9 })
  const h = harness({ mode: 'control', judge: m.judge, thresholds: THRESHOLDS })
  const { pack } = await runPipeline(TASK, h.deps)
  assert.deepEqual(pack.coveredNeeds, ['n1', 'n2'])
  assert.deepEqual(pack.uncertainNeeds, ['n1'])
  assert.deepEqual(pack.gaps, [])
  assert.equal(pack.stats.rounds, 1)
  const text = renderEvidencePack(pack, pack.sources, 'Engine: x')
  assert.match(text, /n1 "how to set the busy timeout" ✓ \(judge unsure\)/)
  assert.match(text, /n2 "enable WAL journal mode" ✓(;|$)/m)
  assert.equal(pack.stats.coverage!.uncertain, 1)
})

test('a failing judge or one that answers only some needs keeps the rule coverage for the rest, with a note', async () => {
  const failing = mockJudge({}, new Error('Jev HTTP 500 boom'))
  const a = await runPipeline(TASK, harness({ mode: 'control', judge: failing.judge, thresholds: THRESHOLDS }).deps)
  assert.deepEqual(a.pack.coveredNeeds, ['n1', 'n2'])
  assert.deepEqual(a.pack.gaps, [])
  assert.match(a.pack.notes.join('\n'), /coverage judge failed, rule coverage kept: Jev HTTP 500 boom/)
  assert.deepEqual([a.pack.stats.coverage!.asked, a.pack.stats.coverage!.unanswered, a.pack.stats.coverage!.verdicts], [2, 2, []])

  const partial = mockJudge({ n2: 0.0 })
  const b = await runPipeline(TASK, harness({ mode: 'control', judge: partial.judge, thresholds: THRESHOLDS }).deps)
  assert.deepEqual(b.pack.coveredNeeds, ['n1'])
  assert.deepEqual(b.pack.gaps.map(g => [g.needId, g.band]), [['n2', 'weak']])
  assert.equal(b.pack.stats.coverage!.unanswered, 1)
})

test('the judge is asked only about needs the rules claim covered: none claimed, nothing asked', async () => {
  const m = mockJudge({ n1: 0.9, n2: 0.9 })
  const deps = harness({ mode: 'control', judge: m.judge, thresholds: THRESHOLDS }).deps
  deps.searchProvider = async () => ({ state: 'ok', sources: [] })
  const { pack } = await runPipeline(TASK, deps)
  assert.deepEqual(pack.coveredNeeds, [])
  assert.equal(m.asked.length, 0)
  assert.deepEqual([pack.stats.coverage!.asked, pack.stats.coverage!.requests, pack.stats.coverage!.verdicts], [0, 0, []])
})

test('render: judge gaps read weak_support (judge) without any raw number; rule gaps keep their best grade; the heuristic caveat stays', () => {
  const pack = {
    resultId: 'r_x', profile: 'docs_code' as const, needs: [{ id: 'n1', text: 'a', critical: true }, { id: 'n2', text: 'b', critical: false }], evidence: [], coveredNeeds: [] as string[],
    gaps: [{ needId: 'n1', text: 'a', critical: true, reason: 'weak_support' as const, band: 'weak' as const }, { needId: 'n2', text: 'b', critical: false, reason: 'weak_support' as const, bestGrade: 1.5 }],
    partial: false, notes: [], verification: { native: [], local: [] },
  }
  const text = renderEvidencePack(pack, [], 'Engine: x')
  assert.match(text, /Gaps: n1 weak_support \(judge\); n2 weak_support \(best grade 1\.5\) \[optional\]\./)
  assert.match(text, /Coverage is heuristic/)
  assert.ok(!/0\.\d\d+/.test(text.replace('1.5', '')))
})

// ── settings ────────────────────────────────────────────────────────────────

test('evidence.coverage settings: absent means off; invalid mode, provider and thresholds are reported and ignored', () => {
  assert.deepEqual(resolveCoverageSettings(undefined), { settings: { mode: 'off' }, diagnostics: [] })
  assert.deepEqual(resolveCoverageSettings({ mode: 'control', provider: 'my-jev', thresholds: { weak: 0.2, covered: 0.6 } }), { settings: { mode: 'control', provider: 'my-jev', thresholds: { weak: 0.2, covered: 0.6 } }, diagnostics: [] })
  const bad = resolveCoverageSettings({ mode: 'always', provider: 7, thresholds: { weak: 0.9, covered: 0.1 }, extra: true })
  assert.equal(bad.settings.mode, 'off')
  assert.equal(bad.settings.thresholds, undefined)
  assert.equal(bad.diagnostics.length, 4)
  assert.match(bad.diagnostics.join('|'), /unknown field "extra".*mode "always" ignored.*provider ignored.*thresholds ignored: thresholds.weak must not exceed/)
  assert.equal(resolveCoverageSettings('x').settings.mode, 'off')
})

test('config: evidence.coverage is optional, unwrapped when volatile, and absent from the default shape', () => {
  assert.equal('coverage' in resolveConfig({} as never).evidence, false)
  const coverage = { mode: 'shadow', thresholds: { weak: 0.2, covered: 0.6 } }
  assert.deepEqual(resolveConfig({ evidence: { coverage: { get: () => coverage } } } as never).evidence.coverage, coverage)
  assert.deepEqual(resolveConfig({ evidence: { coverage } } as never).evidence.coverage, coverage)
})

// ── service level: mocked Jev over fetch ────────────────────────────────────

const SBUSY = BUSY
const SWAL = WAL

interface Seen { url: string; headers: Record<string, string>; body: any }
function service(over: { evidence?: Record<string, unknown>; secrets?: Record<string, string>; noul?: (needs: string[]) => number[] } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wsp-cover-svc-'))
  const config = resolveConfig({
    engines: ['ddg', 'bing'], parallelEngines: false, searchMaxResults: 8, timeoutMs: 5_000, ttlSeconds: 60, memoryCacheEntries: 16,
    rrfConstant: 60, freshnessBoost: 0, authorityBoost: 0, freshnessDays: 30, authorityDomains: [], enableCliBackends: false,
    opencliEnabled: false, agentReachEnabled: false, registerProvider: false, providerId: 'web-search-pro',
    dbPath: path.join(dir, 'store.db'), playwright: { enabled: true, snapshotDir: path.join(dir, 'shots') }, allowProxyFakeIp: false, verbose: false,
    ...over.evidence ? { evidence: over.evidence } : {},
  } as never)
  const store = new Store(config.dbPath)
  const seen: Seen[] = []
  const router = {
    providerStatuses: async (ids: string[]) => new Map(ids.map(id => [id, { state: 'ready' as const }])),
    runProvider: async (): Promise<ProviderOutcome> => ({ state: 'ok', sources: [{ url: 'https://docs.test/busy', title: 'Busy docs', snippet: 'node:sqlite busy timeout' }, { url: 'https://docs.test/wal', title: 'WAL docs', snippet: 'node:sqlite WAL mode' }] }),
    resolveSecret: async (ref: string) => over.secrets?.[ref],
  }
  const fetchSvc = { fetchPage: async (url: string) => ({ url, title: 'Title of ' + url, text: url.endsWith('busy') ? SBUSY : SWAL, source: 'http', fromCache: false }) }
  const fetchImpl = (async (url: string, init: { headers: Record<string, string>; body: string }) => {
    const body = JSON.parse(init.body)
    seen.push({ url, headers: init.headers, body })
    const keys = Object.keys(body.questions) as string[]
    const types = new Set(keys.map(k => body.questions[k].type))
    if (types.has('noul')) {
      const probs = over.noul ? over.noul(keys.map(k => body.questions[k].instructions)) : keys.map(() => 0.9)
      return new Response(JSON.stringify({ answers: Object.fromEntries(keys.map((k, i) => [k, { noul: probs[i] ?? 0.9 }])), usage: { input_tokens: 700, output_tokens: 0 } }))
    }
    return new Response(JSON.stringify({ answers: Object.fromEntries(keys.map(k => [k, { score: 2.9 }])), usage: { input_tokens: 500, output_tokens: 0 } }))
  }) as unknown as typeof fetch
  const svc = new EvidenceService({ router: router as never, fetch: fetchSvc as never, store, dynamic: () => config, fetchImpl })
  const run = () => svc.search({ query: 'node:sqlite busy timeout', task: 'node:sqlite 配置', profile: 'docs_code', needs: 'busy timeout;WAL mode', count: 5 } as never)
  const noulBodies = (): Seen[] => seen.filter(s => Object.values<any>(s.body.questions).every(q => q.type === 'noul'))
  return { dir, config, store, seen, run, noulBodies, cleanup: () => { store.close(); fs.rmSync(dir, { recursive: true, force: true }) } }
}
const SECRETS = { BOCHA_JEV_API_KEY: 'sk-bocha' }
const T = { weak: 0.3, covered: 0.7 }

test('service, default: no coverage setting means no noul request, even with a ready hybrid scorer (never auto-enabled)', async () => {
  const s = service({ evidence: { jevMode: 'hybrid', hybridBorderline: true }, secrets: SECRETS })
  try {
    const out = await s.run()
    assert.equal(s.noulBodies().length, 0)
    assert.equal(out.stats.coverage, undefined)
    assert.ok(!out.notes.join('|').includes('coverage judge'))
  } finally { s.cleanup() }
})

test('service, shadow: one noul request for the claimed needs with the key and rubric wording; recorded in stats and the store, coverage unchanged', async () => {
  const s = service({ evidence: { coverage: { mode: 'shadow', thresholds: T } }, secrets: SECRETS, noul: () => [0.1, 0.95] })
  try {
    const out = await s.run()
    assert.equal(s.seen.length, 1)
    const call = s.seen[0]!
    assert.equal(call.url, 'https://jev.bocha.cn/v1/systemone')
    assert.equal(call.headers.authorization, 'Bearer sk-bocha')
    assert.deepEqual(Object.keys(call.body), ['model', 'state', 'questions'])
    assert.deepEqual(Object.values<any>(call.body.questions).map(q => q.type), ['noul', 'noul'])
    assert.match(call.body.questions.q0.instructions, /^下面的证据摘录本身是否已经明确给出了该需求的答案/)
    assert.equal(call.body.state, '搜索任务：node:sqlite 配置')
    assert.deepEqual(out.coveredNeeds, ['n1', 'n2'])
    assert.deepEqual(out.gaps, [])
    const c = out.stats.coverage!
    assert.deepEqual([c.mode, c.provider, c.asked, c.weak, c.requests, c.inputTokens], ['shadow', 'bocha-jev', 2, 1, 1, 700])
    assert.deepEqual(c.verdicts.map(v => [v.needId, v.prob, v.band]), [['n1', 0.1, 'weak'], ['n2', 0.95, 'covered']])
    const stored = JSON.parse(s.store.evidenceRun(out.resultId)!.packJson)
    assert.equal(stored.stats.coverage.weak, 1)
  } finally { s.cleanup() }
})

test('service, control: weak becomes a gap in the output pack; usage goes through the ledger; the key never leaks', async () => {
  const s = service({ evidence: { coverage: { mode: 'control', thresholds: T }, maxRounds: 1 }, secrets: SECRETS, noul: () => [0.05, 0.9] })
  try {
    const out = await s.run()
    assert.deepEqual(out.coveredNeeds, ['n2'])
    assert.deepEqual(out.gaps.map(g => [g.needId, g.reason, g.band]), [['n1', 'weak_support', 'weak']])
    const rows = s.store.usageRows(new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()))
    assert.deepEqual(rows.map(r => [r.provider, r.protocol, r.status, r.inputTokens]), [['bocha-jev', 'systemone', 'settled', 700]])
    assert.ok(!JSON.stringify(out).includes('sk-bocha'))
  } finally { s.cleanup() }
})

test('the judged pack fits the closed output schema of search.run (band, uncertainNeeds, stats.coverage) and renders through it', async () => {
  const s = service({ evidence: { coverage: { mode: 'control', thresholds: T }, maxRounds: 1 }, secrets: SECRETS, noul: () => [0.05, 0.5] })
  try {
    const out = await s.run()
    const def = findAction('search.run')!
    assert.deepEqual(checkOutput(def.output, { ...out, enginesTried: out.enginesTried }), [])
    assert.deepEqual(out.uncertainNeeds, ['n2'])
    const text = def.render!({ ...out } as never, {} as never)
    assert.match(text, /Gaps: n1 weak_support \(judge\)/)
    assert.match(text, /n2 "[^"]*" ✓ \(judge unsure\)/)
  } finally { s.cleanup() }
})

test('service: unusable setups keep the rule coverage and say why (no thresholds, no key, wrong protocol, bad provider, invalid mode)', async () => {
  const providers = { 'my-jev': { protocol: 'systemone', baseUrl: 'https://jev.example.test', model: 'm', keyRef: 'MY_KEY' } }
  const noThresholds = service({ evidence: { coverage: { mode: 'control', provider: 'my-jev' }, judge: { providers } }, secrets: { MY_KEY: 'k' } })
  try {
    const out = await noThresholds.run()
    assert.equal(noThresholds.seen.length, 0)
    assert.deepEqual(out.coveredNeeds, ['n1', 'n2'])
    assert.match(out.notes.join('|'), /coverage judge \(control\) not used, rule coverage kept: no calibrated thresholds for my-jev\|cover\.sufficient@v1: set evidence\.coverage\.thresholds/)
  } finally { noThresholds.cleanup() }
  const noKey = service({ evidence: { coverage: { mode: 'shadow', thresholds: T } } })
  try {
    assert.match((await noKey.run()).notes.join('|'), /coverage judge \(shadow\) not used, rule coverage kept: Jev needs BOCHA_JEV_API_KEY/)
    assert.equal(noKey.seen.length, 0)
  } finally { noKey.cleanup() }
  const rerank = service({ evidence: { coverage: { mode: 'shadow', provider: 'jina-rerank', thresholds: T } }, secrets: { JINA_API_KEY: 'x' } })
  try {
    assert.match((await rerank.run()).notes.join('|'), /coverage judge \(shadow\) not used, rule coverage kept: provider jina-rerank is a rerank provider|speaks rerank/)
  } finally { rerank.cleanup() }
  const unknown = service({ evidence: { coverage: { mode: 'shadow', provider: 'nope', thresholds: T } }, secrets: SECRETS })
  try {
    assert.match((await unknown.run()).notes.join('|'), /not used, rule coverage kept: evidence\.judge\.provider "nope" is not defined/)
  } finally { unknown.cleanup() }
  const badMode = service({ evidence: { coverage: { mode: 'sometimes', thresholds: T } }, secrets: SECRETS })
  try {
    const out = await badMode.run()
    assert.equal(badMode.seen.length, 0)
    assert.match(out.notes.join('|'), /evidence\.coverage\.mode "sometimes" ignored/)
  } finally { badMode.cleanup() }
})

test('service, ledger cap: a per-search cap too small for the judge keeps the rule coverage with a note, no request goes out', async () => {
  const s = service({ evidence: { coverage: { mode: 'control', thresholds: T }, budget: { perSearchInputTokens: 50 } }, secrets: SECRETS })
  try {
    const out = await s.run()
    assert.equal(s.seen.length, 0)
    assert.deepEqual(out.coveredNeeds, ['n1', 'n2'])
    assert.match(out.notes.join('|'), /coverage judge failed, rule coverage kept: .*per-search cap 50 input tokens/)
    assert.equal(out.stats.coverage!.unanswered, 2)
  } finally { s.cleanup() }
})

test('service, overridden rubric: a new version words the question and is recorded; the override needs thresholds of its own', async () => {
  const rubrics = { 'cover.sufficient': { version: 'v2', instructions: '摘录能回答吗？{need}\n{candidate}' } }
  const s = service({ evidence: { coverage: { mode: 'shadow', thresholds: T }, rubrics }, secrets: SECRETS })
  try {
    const out = await s.run()
    assert.match(s.seen[0]!.body.questions.q0.instructions, /^摘录能回答吗？/)
    assert.match(out.stats.coverage!.rubric, /^cover\.sufficient@v2#/)
  } finally { s.cleanup() }
  const bare = service({ evidence: { coverage: { mode: 'shadow' }, rubrics }, secrets: SECRETS })
  try {
    assert.match((await bare.run()).notes.join('|'), /no calibrated thresholds for bocha-jev\|cover\.sufficient@v2/)
  } finally { bare.cleanup() }
})

test('service: the shipped calibration for bocha-jev + cover.sufficient@v1 needs no thresholds setting, and is recorded in stats', async () => {
  const s = service({ evidence: { coverage: { mode: 'shadow' } }, secrets: SECRETS })
  try {
    const out = await s.run()
    assert.equal(s.seen.length, 1)
    assert.deepEqual(out.stats.coverage!.thresholds, { weak: 0.0512, covered: 0.313 })
  } finally { s.cleanup() }
})

test('sources.status reports the coverage judge only when it is switched on: usable or why not, thresholds and their source', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wsp-cover-status-'))
  const store = new Store(path.join(dir, 'store.db'))
  try {
    const cfg = (coverage?: unknown) => resolveConfig({ ...coverage ? { evidence: { coverage } } : {} } as never).evidence
    assert.equal((await judgeStatus(cfg(), store)).coverage, undefined)
    assert.equal((await judgeStatus(cfg({ mode: 'off' }), store)).coverage, undefined)
    const ok = (await judgeStatus(cfg({ mode: 'control', thresholds: T }), store, { hasSecret: async () => true })).coverage!
    assert.deepEqual(ok, { mode: 'control', provider: 'bocha-jev', rubric: 'cover.sufficient@v1', usable: true, thresholds: T, thresholdSource: 'configured', keyConfigured: true })
    const noKey = (await judgeStatus(cfg({ mode: 'shadow', thresholds: T }), store, { hasSecret: async () => false })).coverage!
    assert.deepEqual([noKey.usable, noKey.reason], [false, 'key not found for BOCHA_JEV_API_KEY'])
    const shipped = (await judgeStatus(cfg({ mode: 'shadow' }), store)).coverage!
    assert.deepEqual([shipped.usable, shipped.thresholds, shipped.thresholdSource], [true, { weak: 0.0512, covered: 0.313 }, 'calibrated'])
    const none = (await judgeStatus(cfg({ mode: 'shadow', provider: 'laya-local' }), store)).coverage!
    assert.equal(none.usable, false)
    assert.match(none.reason!, /no calibrated thresholds/)
    assert.match((await judgeStatus(cfg({ mode: 'shadow', provider: 'jina-rerank', thresholds: T }), store)).coverage!.reason!, /rerank|calibration/)
  } finally { store.close(); fs.rmSync(dir, { recursive: true, force: true }) }
})
