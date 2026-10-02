import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { resolveConfig } from '../src/config.ts'
import { Store } from '../src/store.ts'
import { dayKey } from '../src/pipeline/ledger.ts'
import { EvidenceService } from '../src/pipeline/service.ts'
import type { ProviderCall, ProviderOutcome } from '../src/pipeline/run.ts'

const BUSY = '# Busy timeout\n\nIn node:sqlite you set the busy timeout with PRAGMA busy_timeout = 5000 on the DatabaseSync connection. The busy timeout makes a blocked writer wait instead of failing at once.\n\n# Unrelated\n\nThe cooking section explains how to bake bread with flour and water in a hot oven for an hour.'
const WAL = '# WAL mode\n\nEnable WAL journal mode in node:sqlite by running PRAGMA journal_mode = WAL once. WAL allows readers and a writer to work together.'

interface Seen { url: string; headers: Record<string, string>; raw: string; body: any }

function harness(over: { evidence?: Record<string, unknown>; secrets?: Record<string, string>; reply?: (seen: Seen) => Response; now?: () => number; store?: Store; dir?: string } = {}) {
  const dir = over.dir ?? fs.mkdtempSync(path.join(os.tmpdir(), 'wsp-evidence-judge-'))
  const config = resolveConfig({
    engines: ['ddg', 'bing'], parallelEngines: false, searchMaxResults: 8, timeoutMs: 5_000, ttlSeconds: 60, memoryCacheEntries: 16,
    rrfConstant: 60, freshnessBoost: 0, authorityBoost: 0, freshnessDays: 30, authorityDomains: [], enableCliBackends: false,
    opencliEnabled: false, agentReachEnabled: false, registerProvider: false, providerId: 'web-search-pro',
    dbPath: path.join(dir, 'store.db'), playwright: { enabled: true, snapshotDir: path.join(dir, 'shots') }, allowProxyFakeIp: false, verbose: false,
    ...over.evidence ? { evidence: over.evidence } : {},
  } as never)
  const store = over.store ?? new Store(config.dbPath)
  const seen: Seen[] = []
  const asked: string[] = []
  const router = {
    providerStatuses: async (ids: string[]) => new Map(ids.map(id => [id, { state: 'ready' as const }])),
    runProvider: async (_call: ProviderCall): Promise<ProviderOutcome> => ({ state: 'ok', sources: [{ url: 'https://docs.test/busy', title: 'Busy docs', snippet: 'node:sqlite busy timeout' }, { url: 'https://docs.test/wal', title: 'WAL docs', snippet: 'node:sqlite WAL mode' }] }),
    resolveSecret: async (ref: string) => { asked.push(ref); return over.secrets?.[ref] },
  }
  const fetchSvc = { fetchPage: async (url: string) => ({ url, title: 'Title of ' + url, text: url.endsWith('busy') ? BUSY : WAL, source: 'http', fromCache: false }) }
  const fetchImpl = (async (url: string, init: { headers: Record<string, string>; body: string }) => {
    const s: Seen = { url, headers: init.headers, raw: init.body, body: JSON.parse(init.body) }
    seen.push(s)
    if (over.reply) return over.reply(s)
    if (s.body.questions) return new Response(JSON.stringify({ answers: Object.fromEntries(Object.keys(s.body.questions).map(k => [k, { score: 2.9 }])), usage: { input_tokens: 500, output_tokens: 0 } }))
    if (s.body.documents) return new Response(JSON.stringify({ results: s.body.documents.map((_: string, i: number) => ({ index: i, relevance_score: 0.8 })), usage: { total_tokens: 400 } }))
    const ids = ((s.body.messages[1].content as string).match(/^\[(q\d+)\]$/gm) ?? []).map(x => x.slice(1, -1))
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ grades: Object.fromEntries(ids.map(id => [id, 3])) }) } }], usage: { prompt_tokens: 600, completion_tokens: 20 } }))
  }) as unknown as typeof fetch
  const service = new EvidenceService({ router: router as never, fetch: fetchSvc as never, store, dynamic: () => config, fetchImpl, ...over.now ? { now: over.now } : {} })
  const run = (extra: Record<string, unknown> = {}) => service.search({ query: 'node:sqlite busy timeout', task: 't', profile: 'docs_code', needs: 'busy timeout;WAL mode', count: 5, ...extra } as never)
  return { dir, config, store, seen, asked, service, run, cleanup: () => { store.close(); fs.rmSync(dir, { recursive: true, force: true }) } }
}
const SECRETS = { BOCHA_JEV_API_KEY: 'sk-bocha' }
const notesOf = (out: { notes: string[] }): string => out.notes.join(' | ')

test('default provider: legacy keys keep working, the request is the Jev request, results record provider / protocol / model', async () => {
  const h = harness({ evidence: { scorer: 'jev', jevMode: 'control', maxJevQuestions: 6 }, secrets: SECRETS })
  try {
    const out = await h.run()
    assert.equal(out.stats.scorer, 'jev')
    assert.deepEqual({ ...out.stats.jev, requests: undefined, questions: undefined }, { requests: undefined, questions: undefined, inputTokens: 500 * h.seen.length, outputTokens: 0, mode: 'control', rubric: out.stats.jev!.rubric, rubricOverridden: false, provider: 'bocha-jev', protocol: 'systemone', model: 'bocha-jev-v1' })
    assert.match(out.stats.jev!.rubric!, /^score\.support@v1#[0-9a-f]{12}$/)
    const call = h.seen[0]!
    assert.equal(call.url, 'https://jev.bocha.cn/v1/systemone')
    assert.deepEqual(Object.keys(call.headers), ['content-type', 'authorization'])
    assert.equal(call.headers.authorization, 'Bearer sk-bocha')
    assert.deepEqual(Object.keys(call.body), ['model', 'state', 'questions'])
    assert.equal(call.raw, JSON.stringify(call.body), 'nothing but model, state and questions is on the wire')
    assert.equal(call.body.model, 'bocha-jev-v1')
    assert.deepEqual(h.asked, ['BOCHA_JEV_API_KEY'])
    const row = h.store.evidenceBlock(out.evidence[0]!.evidenceId)!
    assert.equal(row.scorer, 'jev')
    assert.equal(row.judge, 'bocha-jev|systemone|bocha-jev-v1')
    assert.equal(row.rubric, out.stats.jev!.rubric)
  } finally { h.cleanup() }
})

test('evidence.judge.mode is the provider-neutral switch: it wins over jevMode and control needs no scorer key', async () => {
  const neutral = harness({ evidence: { jevMode: 'off', judge: { mode: 'control' } }, secrets: SECRETS })
  try {
    const out = await neutral.run()
    assert.equal(out.stats.scorer, 'jev')
    assert.equal(out.stats.jev!.mode, 'control')
  } finally { neutral.cleanup() }
  const legacy = harness({ evidence: { jevMode: 'control' }, secrets: SECRETS })
  try {
    const out = await legacy.run()
    assert.equal(legacy.seen.length, 0)
    assert.equal(out.stats.scorer, 'rule')
    assert.match(notesOf(out), /jevMode=control needs evidence\.scorer=jev/)
  } finally { legacy.cleanup() }
  const off = harness({ evidence: { jevMode: 'hybrid', judge: { mode: 'off' } }, secrets: SECRETS })
  try {
    const out = await off.run()
    assert.equal(off.seen.length, 0)
    assert.equal(out.stats.jev, undefined)
  } finally { off.cleanup() }
})

test('a custom systemone provider (another Jev deployment) is used through settings, with its own key ref and recorded identity', async () => {
  const providers = { 'my-jev': { protocol: 'systemone', baseUrl: 'https://jev.example.test/api', model: 'jev-x-1', keyRef: 'MY_JEV_KEY', limits: { maxQuestionsPerRequest: 2 } } }
  const h = harness({ evidence: { jevMode: 'hybrid', hybridBorderline: true, maxJevQuestions: 6, judge: { provider: 'my-jev', providers } }, secrets: { MY_JEV_KEY: 'sk-mine' } })
  try {
    const out = await h.run({ needs: '如何设置 busy timeout;如何开启 WAL 模式' })
    assert.equal(h.seen[0]!.url, 'https://jev.example.test/api/v1/systemone')
    assert.equal(h.seen[0]!.headers.authorization, 'Bearer sk-mine')
    assert.equal(h.seen[0]!.body.model, 'jev-x-1')
    assert.ok(h.seen.every(s => Object.keys(s.body.questions).length <= 2))
    assert.deepEqual(h.asked, ['MY_JEV_KEY'])
    assert.equal(out.stats.scorer, 'hybrid')
    assert.deepEqual([out.stats.jev!.provider, out.stats.jev!.protocol, out.stats.jev!.model], ['my-jev', 'systemone', 'jev-x-1'])
    const row = h.store.evidenceBlock(out.evidence[0]!.evidenceId)!
    assert.equal(row.judge, 'my-jev|systemone|jev-x-1')
    assert.ok(!JSON.stringify(out).includes('sk-mine'))
  } finally { h.cleanup() }
})

test('laya-local needs no key: nothing is looked up and no authorization header is sent', async () => {
  const h = harness({ evidence: { judge: { mode: 'shadow', provider: 'laya-local' } } })
  try {
    const out = await h.run()
    assert.deepEqual(h.asked, [])
    assert.equal(h.seen[0]!.url, 'http://127.0.0.1:8765/v1/systemone')
    assert.equal(h.seen[0]!.headers.authorization, undefined)
    assert.equal(out.stats.scorer, 'rule')
    assert.equal(out.stats.jev!.mode, 'shadow')
    assert.equal(out.stats.jev!.provider, 'laya-local')
    const stored = JSON.parse(h.store.evidenceRun(out.resultId)!.packJson)
    assert.equal(stored.shadow.scorer, 'laya-local')
    assert.equal(stored.shadow.judge, 'laya-local|systemone|multilingual')
  } finally { h.cleanup() }
})

test('providers that cannot be used leave the rule scorer in charge and say why', async () => {
  const cases: [Record<string, unknown>, RegExp][] = [
    [{ provider: 'nope' }, /evidence\.judge\.provider "nope" is not defined \(known: bocha-jev, typesafe-jev, laya-local, jina-rerank, cohere-rerank\).*rule scorer used/],
    [{ provider: 'typesafe-jev' }, /placeholder preset: set baseUrl and model in evidence\.judge\.providers\.typesafe-jev/],
    [{ provider: 'jina-rerank' }, /rerank provider: set calibration\.points/],
    [{ provider: 'bad', providers: { bad: { protocol: 'systemone', baseUrl: 'http://example.com', model: 'm' } } }, /providers\.bad ignored: baseUrl must be https/],
    [{ provider: 'l', providers: { l: { protocol: 'llm', baseUrl: 'https://llm.example.test/v1', model: 'm' } } }, /uses the llm protocol, which is off: set evidence\.judge\.allowLlm/],
  ]
  for (const [judge, expected] of cases) {
    const h = harness({ evidence: { judge: { mode: 'control', ...judge } }, secrets: { ...SECRETS, JINA_API_KEY: 'k' } })
    try {
      const out = await h.run()
      assert.equal(h.seen.length, 0, JSON.stringify(judge))
      assert.equal(out.stats.scorer, 'rule')
      assert.match(notesOf(out), expected)
    } finally { h.cleanup() }
  }
  // a keyed provider without a key
  const noKey = harness({ evidence: { judge: { mode: 'control', provider: 'my', providers: { my: { protocol: 'systemone', baseUrl: 'https://my.example.test', model: 'm', keyRef: 'MY_KEY' } } } } })
  try {
    const out = await noKey.run()
    assert.match(notesOf(out), /my control mode needs MY_KEY \(credentials ref or environment\): rule scorer used/)
  } finally { noKey.cleanup() }
})

test('a calibrated reranker decides S6 through the same pipeline; the need text is its query and the rubric is not involved', async () => {
  const judge = { mode: 'control', provider: 'jina-rerank', providers: { 'jina-rerank': { calibration: { version: 'draft-1', points: [[0.2, 0], [0.9, 3]] } } } }
  const h = harness({ evidence: { judge }, secrets: { JINA_API_KEY: 'sk-jina' } })
  try {
    const out = await h.run()
    assert.equal(h.seen[0]!.url, 'https://api.jina.ai/v1/rerank')
    assert.equal(h.seen[0]!.headers.authorization, 'Bearer sk-jina')
    assert.ok(['busy timeout', 'WAL mode'].includes(h.seen[0]!.body.query))
    assert.equal(out.stats.scorer, 'jina-rerank')
    assert.equal(out.stats.jev!.provider, 'jina-rerank')
    assert.equal(out.stats.jev!.protocol, 'rerank')
    assert.match(out.stats.jev!.calibration!, /^draft-1#[0-9a-f]{8}$/)
    assert.equal(out.stats.jev!.rubric, undefined)
    assert.ok(out.evidence.every(e => Math.abs(e.grade - (0.8 - 0.2) / 0.7 * 3) < 0.01))
    const row = h.store.evidenceBlock(out.evidence[0]!.evidenceId)!
    assert.match(row.judge!, /^jina-rerank\|rerank\|jina-reranker-v2-base-multilingual\|draft-1#/)
    assert.equal(row.rubric, null)
  } finally { h.cleanup() }
})

test('the llm protocol is off unless evidence.judge.allowLlm is set; then it grades through the rubric', async () => {
  const providers = { 'my-llm': { protocol: 'llm', baseUrl: 'https://llm.example.test/v1', model: 'judge-1', keyRef: 'LLM_KEY' } }
  const h = harness({ evidence: { judge: { mode: 'control', provider: 'my-llm', providers, allowLlm: true } }, secrets: { LLM_KEY: 'sk-llm' } })
  try {
    const out = await h.run()
    assert.equal(h.seen[0]!.url, 'https://llm.example.test/v1/chat/completions')
    assert.equal(h.seen[0]!.body.temperature, 0)
    assert.equal(out.stats.scorer, 'my-llm')
    assert.ok(out.evidence.every(e => e.grade === 3))
    assert.equal(out.stats.jev!.protocol, 'llm')
    assert.match(out.stats.jev!.rubric!, /^score\.support@v1#/)
  } finally { h.cleanup() }
})

test('a Jev-less run records nothing in the ledger and exposes no provider stats', async () => {
  const h = harness()
  try {
    const out = await h.run()
    assert.equal(out.stats.jev, undefined)
    assert.deepEqual(h.store.usageByProvider(dayKey(Date.now())), [])
  } finally { h.cleanup() }
})

// ── budget and ledger through the service ───────────────────────────────────

test('control mode over the per-search cap: no request, rule grades, "model budget exceeded" in the notes, nothing booked', async () => {
  const h = harness({ evidence: { judge: { mode: 'control' }, budget: { perSearchInputTokens: 10 } }, secrets: SECRETS })
  try {
    const out = await h.run()
    assert.equal(h.seen.length, 0)
    assert.equal(out.stats.scorer, 'rule')
    assert.match(notesOf(out), /scorer jev failed, used the rule scorer: model budget exceeded: per-search cap 10 input tokens/)
    assert.ok(out.evidence.length > 0, 'the search still answers')
    assert.deepEqual(h.store.usageByProvider(dayKey(Date.now())), [])
  } finally { h.cleanup() }
})

test('hybrid mode over the daily cap: the rule grades are kept and the budget is named', async () => {
  const h = harness({ evidence: { judge: { mode: 'hybrid' }, hybridBorderline: true, budget: { dailyInputTokens: 1_000 } }, secrets: SECRETS })
  try {
    const out = await h.run({ needs: '如何设置 busy timeout;如何开启 WAL 模式' })
    assert.equal(h.seen.length, 0)
    assert.equal(out.stats.scorer, 'hybrid')
    assert.match(notesOf(out), /Jev re-scoring failed, kept the rule grades: model budget exceeded: daily cap 1000 input tokens/)
    assert.ok(out.evidence.length > 0)
  } finally { h.cleanup() }
})

test('a model call is booked in the ledger with provider, protocol, model and the service\'s actual tokens; the next search sees what is left', async () => {
  const h = harness({ evidence: { judge: { mode: 'control', provider: 'laya-local' }, budget: { dailyInputTokens: 100_000, perSearchInputTokens: 50_000 } } })
  try {
    const first = await h.run()
    const day = dayKey(Date.now())
    const [row, ...rest] = h.store.usageRows(day)
    assert.deepEqual(rest, [])
    assert.deepEqual([row!.provider, row!.protocol, row!.model, row!.status, row!.inputTokens, row!.estimated, row!.amount], ['laya-local', 'systemone', 'multilingual', 'settled', 500, false, null])
    assert.equal(first.stats.jev!.inputTokens, 500)
    // earlier use today leaves too little for the next search: it falls back without a call
    const ledgerUsed = 100_000 - 100
    h.store.reserveUsage({ id: 'u_seed', ts: new Date().toISOString(), day, provider: 'laya-local', protocol: 'systemone', inputTokens: ledgerUsed - 500, dailyCap: 100_000 })
    const before = h.seen.length
    const second = await h.run({ query: 'another busy timeout query' })
    assert.equal(h.seen.length, before)
    assert.equal(second.stats.scorer, 'rule')
    assert.match(notesOf(second), /model budget exceeded: daily cap 100000 input tokens/)
  } finally { h.cleanup() }
})

test('invalid budget settings are reported and the defaults apply', async () => {
  const h = harness({ evidence: { judge: { mode: 'control' }, budget: { perSearchInputTokens: -5, timezone: 'Mars/Base' } }, secrets: SECRETS })
  try {
    const out = await h.run()
    assert.match(notesOf(out), /evidence\.budget\.perSearchInputTokens ignored/)
    assert.match(notesOf(out), /evidence\.budget\.timezone "Mars\/Base" is not a time zone/)
    assert.ok(h.seen.length >= 1, 'the default caps let the call through')
  } finally { h.cleanup() }
})

test('the ledger and the store share a restart: usage booked before a reopen still counts', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wsp-evidence-restart-'))
  const evidence = { judge: { mode: 'control' }, budget: { dailyInputTokens: 60_000 } }
  try {
    const first = harness({ dir, evidence, secrets: SECRETS })
    await first.run()
    first.store.close()
    const store = new Store(path.join(dir, 'store.db'))
    const used = store.usageByProvider(dayKey(Date.now()))[0]!.inputTokens
    assert.ok(used > 0)
    // exhaust the rest of the day, reopen again: still refused
    store.reserveUsage({ id: 'u_rest', ts: new Date().toISOString(), day: dayKey(Date.now()), provider: 'bocha-jev', protocol: 'systemone', inputTokens: 60_000 - used, dailyCap: 60_000 })
    store.close()
    const store3 = new Store(path.join(dir, 'store.db'))
    const third = harness({ dir, evidence, secrets: SECRETS, store: store3 })
    const out = await third.run({ query: 'after the restart' })
    assert.equal(third.seen.length, 0)
    assert.match(notesOf(out), /model budget exceeded: daily cap 60000/)
    store3.close()
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
})
