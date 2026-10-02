import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { registerHooks } from 'node:module'
import { resolveConfig } from '../src/config.ts'
import { Store } from '../src/store.ts'
import type { ProviderCall, ProviderOutcome } from '../src/pipeline/run.ts'

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === '@deepseek-ai/dsh-tools') return { url: 'data:text/javascript,export const defineTool = value => value', shortCircuit: true }
    return nextResolve(specifier, context)
  },
})
const { registerTools } = await import('../src/tools.ts')
const { EvidenceService } = await import('../src/pipeline/service.ts')

interface Schema { type?: string; additionalProperties?: boolean; properties?: Record<string, Schema & { required?: boolean }>; items?: Schema & { required?: boolean } }

/** Minimal validator for the closed tool-output schemas: type, additionalProperties:false, required, nested items. */
function assertFits(value: unknown, schema: Schema, at = '$'): void {
  if (schema.type === 'array') {
    assert.ok(Array.isArray(value), at + ' must be an array')
    value.forEach((item, i) => schema.items && assertFits(item, schema.items, at + '[' + i + ']'))
  } else if (schema.type === 'object') {
    assert.ok(value && typeof value === 'object' && !Array.isArray(value), at + ' must be an object')
    const record = value as Record<string, unknown>
    if (schema.additionalProperties === false) for (const key of Object.keys(record)) assert.ok(schema.properties && key in schema.properties, at + '.' + key + ' is not in the closed schema')
    for (const [key, sub] of Object.entries(schema.properties ?? {})) {
      if (record[key] === undefined) { assert.ok(!sub.required, at + '.' + key + ' is required'); continue }
      assertFits(record[key], sub, at + '.' + key)
    }
  } else if (schema.type === 'string') assert.equal(typeof value, 'string', at + ' must be a string')
  else if (schema.type === 'number') assert.equal(typeof value, 'number', at + ' must be a number')
  else if (schema.type === 'boolean') assert.equal(typeof value, 'boolean', at + ' must be a boolean')
}

function harness(overrides: Record<string, unknown> = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wsp-evidence-tool-'))
  const config = resolveConfig({
    engines: ['ddg', 'bing'], parallelEngines: false, searchMaxResults: 8, timeoutMs: 5_000, ttlSeconds: 60, memoryCacheEntries: 16,
    rrfConstant: 60, freshnessBoost: 0, authorityBoost: 0, freshnessDays: 30, authorityDomains: [], enableCliBackends: false,
    opencliEnabled: false, agentReachEnabled: false, registerProvider: false, providerId: 'web-search-pro',
    dbPath: path.join(dir, 'store.db'), playwright: { enabled: true, snapshotDir: path.join(dir, 'shots') }, allowProxyFakeIp: false, verbose: false,
    ...overrides,
  } as never)
  const definitions = new Map<string, any>()
  const store = new Store(config.dbPath)
  const cleanup = (): void => { store.close(); fs.rmSync(dir, { recursive: true, force: true }) }
  return { dir, config, definitions, store, cleanup }
}

// ── regression: without evidence parameters nothing changes ─────────────────

test('web_search_pro without task/profile: same router call, same output, same rendering, old schema fields intact', async () => {
  const h = harness()
  const received: unknown[] = []
  const routerResult = { content: 'C', sources: [{ url: 'https://a.test/', title: 'A', snippet: 'snip', publishedAt: '2026-01-01' }, { url: 'https://b.test/x' }], engine: 'ddg', enginesTried: ['ddg', 'bing'], fromCache: true, fallbackNote: 'fallback; x', availableCount: 9 }
  try {
    registerTools({
      ctx: { tools: { register: (d: any) => h.definitions.set(d.name, d) } } as any, config: h.config, dynamic: () => h.config, store: h.store,
      router: { search: async (options: unknown) => { received.push(options); return routerResult } } as any, fetch: {} as any, browser: {} as any,
      evidence: { search: async () => { throw new Error('the evidence pipeline must not run') } },
    })
    const def = h.definitions.get('web_search_pro')
    const out = await def.execute({ query: 'q', engines: 'ddg,bing', count: 3, fresh: true, includeDomains: 'a.test' }, { signal: undefined })
    assert.deepEqual(received[0], {
      query: 'q', engines: ['ddg', 'bing'], count: 3, fresh: true, multi: false, signal: undefined, exa: { includeDomains: ['a.test'] },
    })
    assert.deepEqual(out, {
      content: 'C', sources: routerResult.sources, engine: 'ddg', enginesTried: ['ddg', 'bing'], fromCache: true, fallbackNote: 'fallback; x',
    })
    assert.deepEqual(Object.keys(out), ['content', 'sources', 'engine', 'enginesTried', 'fromCache', 'fallbackNote'])
    assert.equal(def.output.render({}, out)[0].text, 'C\n\n- [A](https://a.test/) — snip (2026-01-01)\n- [b.test](https://b.test/x)\n\nEngine: ddg (cached) (fallback; x); tried: ddg, bing\n\nThese are navigation targets — several lack snippets. Fetch the most relevant 1-2 before answering.')
    assertFits(out, def.output.schema)
  } finally { h.cleanup() }
})

test('web_search_pro: an empty classic result renders the retry hint unchanged', async () => {
  const h = harness()
  try {
    registerTools({
      ctx: { tools: { register: (d: any) => h.definitions.set(d.name, d) } } as any, config: h.config, dynamic: () => h.config, store: h.store,
      router: { search: async () => ({ sources: [], engine: 'none', enginesTried: ['ddg'], fromCache: false }) } as any, fetch: {} as any, browser: {} as any,
    })
    const def = h.definitions.get('web_search_pro')
    const out = await def.execute({ query: 'q' }, { signal: undefined })
    assert.deepEqual(out, { sources: [], engine: 'none', enginesTried: ['ddg'], fromCache: false })
    assert.equal(def.output.render({}, out)[0].text, 'No results found.\n\nEngine: none\n\nNo usable results for this query. Retry with a different phrasing, a site: filter, or the "api documentation" / "<host> API" form.')
  } finally { h.cleanup() }
})

// ── evidence mode through the tool ──────────────────────────────────────────

const BUSY = '# Busy timeout\n\nIn node:sqlite you set the busy timeout with PRAGMA busy_timeout = 5000 on the DatabaseSync connection. The busy timeout makes a blocked writer wait instead of failing at once.\n\n# Unrelated\n\nThe cooking section explains how to bake bread with flour and water in a hot oven for an hour.'
const WAL = '# WAL mode\n\nEnable WAL journal mode in node:sqlite by running PRAGMA journal_mode = WAL once. WAL allows readers and a writer to work together.'

function evidenceHarness(over: { evidence?: Record<string, unknown>; jev?: (init: { headers: Record<string, string>; body: string }) => Response; secret?: string | undefined; search?: (call: ProviderCall) => ProviderOutcome } = {}) {
  const h = harness(over.evidence ? { evidence: over.evidence } : {})
  const jevCalls: { headers: Record<string, string>; body: any }[] = []
  const calls: ProviderCall[] = []
  const router = {
    providerStatuses: async (ids: string[]) => new Map(ids.map(id => [id, { state: 'ready' as const }])),
    runProvider: async (call: ProviderCall): Promise<ProviderOutcome> => {
      calls.push(call)
      return over.search?.(call) ?? { state: 'ok', sources: [{ url: 'https://docs.test/busy', title: 'Busy docs', snippet: 'node:sqlite busy timeout' }, { url: 'https://docs.test/wal', title: 'WAL docs', snippet: 'node:sqlite WAL mode' }] }
    },
    resolveSecret: async () => over.secret,
  }
  const fetchSvc = { fetchPage: async (url: string) => ({ url, title: 'Title of ' + url, text: url.endsWith('busy') ? BUSY : WAL, source: 'http', fromCache: false }) }
  const fetchImpl = (async (_url: string, init: { headers: Record<string, string>; body: string }) => {
    jevCalls.push({ headers: init.headers, body: JSON.parse(init.body) })
    if (over.jev) return over.jev(init)
    const q = JSON.parse(init.body).questions as Record<string, unknown>
    return new Response(JSON.stringify({ answers: Object.fromEntries(Object.keys(q).map(k => [k, { score: 2.9 }])), usage: { input_tokens: 500, output_tokens: 0 } }))
  }) as unknown as typeof fetch
  const service = new EvidenceService({ router: router as any, fetch: fetchSvc as any, store: h.store, dynamic: () => h.config, fetchImpl })
  registerTools({
    ctx: { tools: { register: (d: any) => h.definitions.set(d.name, d) } } as any, config: h.config, dynamic: () => h.config, store: h.store,
    router: {} as any, fetch: {} as any, browser: {} as any, evidence: service,
  })
  return { ...h, calls, jevCalls, def: h.definitions.get('web_search_pro'), history: h.definitions.get('web_history') }
}

test('web_search_pro with task/profile returns an evidence pack that fits the closed schema and renders compactly', async () => {
  const h = evidenceHarness()
  try {
    const args = { query: 'node:sqlite busy timeout WAL', task: 'Configure busy timeout and WAL for node:sqlite', profile: 'docs_code', needs: 'how to set busy timeout in node:sqlite; enable WAL journal mode in node:sqlite', count: 5 }
    const out = await h.def.execute(args, { signal: undefined })
    assertFits(out, h.def.output.schema)
    assert.match(out.resultId, /^r_[0-9a-f]{10}$/)
    assert.equal(out.profile, 'docs_code')
    assert.equal(out.fromCache, false)
    assert.equal(out.partial, false)
    assert.deepEqual(out.coveredNeeds, ['n1', 'n2'])
    assert.deepEqual(out.gaps, [])
    assert.deepEqual(out.needs.map((n: { id: string }) => n.id), ['n1', 'n2'])
    assert.ok(out.evidence.length >= 2)
    assert.ok(out.sources.length > 0 && out.sources.every((s: { url: string }) => s.url.startsWith('https://')))
    assert.equal(out.engine, 'pipeline(ddg+bing+github)')
    const ev = out.evidence.find((e: { excerpt: string }) => e.excerpt.includes('PRAGMA busy_timeout'))
    assert.equal(ev.title, 'Busy docs')
    assert.equal(ev.heading, 'Busy timeout')
    const text = h.def.output.render(args, out)[0].text as string
    assert.match(text, /^Evidence pack r_[0-9a-f]{10} \(docs_code\): \d+ excerpt\(s\); needs covered 2\/2\./)
    assert.ok(text.includes(ev.evidenceId) && text.includes('PRAGMA busy_timeout = 5000'))
    assert.match(text, /Needs: n1 "how to set busy timeout in node:sqlite" ✓; n2 "enable WAL journal mode in node:sqlite" ✓/)
    assert.match(text, /web_history action=expand evidenceId=<id>/)
    assert.ok(!text.includes('bake bread'))
    assert.ok(text.length < 2500, 'compact: ' + text.length)
    assert.ok(h.calls.every(c => c.count === 10))
  } finally { h.cleanup() }
})

test('web_search_pro evidence mode: profile alone works, bad input is rejected, ignored options are noted', async () => {
  const h = evidenceHarness()
  try {
    const out = await h.def.execute({ query: 'node:sqlite busy timeout', profile: 'general', fresh: true, multi: true, exaType: 'fast', constraints: '[{"kind":"site","value":"docs.test","strength":"hard"}]', budget: 1000 }, { signal: undefined })
    assertFits(out, h.def.output.schema)
    assert.equal(out.profile, 'general')
    assert.match(out.notes.join(' | '), /ignored in evidence mode: fresh, multi, exa options/)
    assert.deepEqual(out.verification.local.length + out.verification.native.length, 1)
    assert.ok(out.stats.excerptChars <= 1000)
    await assert.rejects(h.def.execute({ query: 'q', profile: 'nonsense' }, { signal: undefined }), /profile must be one of/)
    await assert.rejects(h.def.execute({ query: 'q', task: 't', constraints: '{bad' }, { signal: undefined }), /constraints is not valid JSON/)
    await assert.rejects(h.def.execute({ query: 'q', task: 't', engines: 'nope' }, { signal: undefined }), /unknown engine: nope/)
    const explicit = await h.def.execute({ query: 'node:sqlite busy timeout', task: 't', engines: 'arxiv' }, { signal: undefined })
    assert.deepEqual(explicit.enginesTried, ['arxiv'])
  } finally { h.cleanup() }
})

test('web_search_pro evidence mode persists the run and web_history expands an evidence id with its neighbours', async () => {
  const h = evidenceHarness()
  try {
    const out = await h.def.execute({ query: 'node:sqlite busy timeout WAL', task: 'sqlite config', profile: 'docs_code', needs: 'busy timeout;WAL mode' }, { signal: undefined })
    const run = h.store.evidenceRun(out.resultId)!
    assert.ok(run)
    assert.equal(JSON.parse(run.packJson).resultId, out.resultId)
    assert.equal(JSON.parse(run.taskJson).profile, 'docs_code')
    const queryRecord = h.store.queryById(run.queryId!)!
    assert.equal(queryRecord.kind, 'search')
    assert.equal(queryRecord.engine, 'pipeline')
    assert.ok(h.store.resultsForQuery(queryRecord.id).length > 0, 'history replay shows the fused sources')
    const listed = await h.history.execute({ engine: 'pipeline' }, { signal: undefined })
    assert.equal(listed.records[0].id, queryRecord.id)

    // A stored page lets expansion show the neighbours.
    const ev = out.evidence.find((e: { excerpt: string }) => e.excerpt.includes('PRAGMA busy_timeout'))
    h.store.savePage({ url: ev.url, title: 't', text: BUSY, source: 'http' })
    const expanded = await h.history.execute({ action: 'expand', evidenceId: ev.evidenceId }, { signal: undefined })
    assertFits(expanded, h.history.output.schema)
    assert.deepEqual(expanded.records, [])
    assert.equal(expanded.expanded.evidenceId, ev.evidenceId)
    assert.equal(expanded.expanded.title, 'Busy docs')
    const match = expanded.expanded.blocks.find((b: { position: string }) => b.position === 'match')
    assert.ok(match.text.includes('PRAGMA busy_timeout = 5000'))
    const rendered = h.history.output.render({}, expanded)[0].text as string
    assert.match(rendered, />>> matched block/)
    await assert.rejects(h.history.execute({ action: 'expand' }, { signal: undefined }), /evidenceId is required/)
    await assert.rejects(h.history.execute({ action: 'expand', evidenceId: 'e_missing' }, { signal: undefined }), /evidence id not found/)
    await assert.rejects(h.history.execute({ action: 'explode' }, { signal: undefined }), /action must be expand/)
    // Clearing the history query removes its evidence too.
    await h.definitions.get('web_cache_clear').execute({ queryId: queryRecord.id }, { signal: undefined })
    assert.equal(h.store.evidenceRun(out.resultId), undefined)
    assert.equal(h.store.evidenceBlock(ev.evidenceId), undefined)
  } finally { h.cleanup() }
})

// ── Jev configuration ───────────────────────────────────────────────────────

test('evidence scorer config: off ignores Jev (and says so), missing key falls back, shadow records, control decides', async () => {
  // off (default) with scorer=jev
  const off = evidenceHarness({ evidence: { scorer: 'jev', jevMode: 'off' }, secret: 'sk-secret' })
  try {
    const out = await off.def.execute({ query: 'node:sqlite busy timeout', task: 't', profile: 'docs_code' }, { signal: undefined })
    assert.equal(off.jevCalls.length, 0)
    assert.equal(out.stats.scorer, 'rule')
    assert.match(out.notes.join(' | '), /evidence\.scorer=jev ignored: evidence\.jevMode is off/)
  } finally { off.cleanup() }

  // shadow without a key
  const noKey = evidenceHarness({ evidence: { jevMode: 'shadow' }, secret: undefined })
  try {
    const out = await noKey.def.execute({ query: 'node:sqlite busy timeout', task: 't', profile: 'docs_code' }, { signal: undefined })
    assert.equal(noKey.jevCalls.length, 0)
    assert.match(out.notes.join(' | '), /BOCHA_JEV_API_KEY.*rule scorer used/)
  } finally { noKey.cleanup() }

  // shadow with a key: the rule pack decides, Jev scores are stored
  const shadow = evidenceHarness({ evidence: { jevMode: 'shadow' }, secret: 'sk-secret' })
  try {
    const out = await shadow.def.execute({ query: 'node:sqlite busy timeout', task: 't', profile: 'docs_code', needs: 'busy timeout;WAL mode' }, { signal: undefined })
    assert.equal(out.stats.scorer, 'rule')
    assert.equal(out.stats.jev.mode, 'shadow')
    assert.ok(shadow.jevCalls.length >= 1)
    assert.equal(shadow.jevCalls[0]!.headers.authorization, 'Bearer sk-secret')
    const stored = JSON.parse(shadow.store.evidenceRun(out.resultId)!.packJson)
    assert.equal(stored.shadow.scorer, 'jev')
    assert.ok(stored.shadow.rows.length > 0 && stored.shadow.rows.every((r: { shadow: number }) => r.shadow === 2.9))
    assert.ok(!shadow.store.evidenceRun(out.resultId)!.packJson.includes('sk-secret'), 'the key is never persisted')
    assert.ok(!JSON.stringify(out).includes('sk-secret'))
    assertFits(out, shadow.def.output.schema)
  } finally { shadow.cleanup() }

  // control + scorer=jev: Jev decides
  const control = evidenceHarness({ evidence: { scorer: 'jev', jevMode: 'control', maxJevQuestions: 6 }, secret: 'sk-secret' })
  try {
    const out = await control.def.execute({ query: 'node:sqlite busy timeout', task: 't', profile: 'docs_code', needs: 'busy timeout;WAL mode' }, { signal: undefined })
    assert.equal(out.stats.scorer, 'jev')
    assert.equal(out.stats.jev.mode, 'control')
    assert.ok(out.stats.jev.questions <= 6, 'maxJevQuestions caps the questions')
    assert.ok(out.evidence.every((e: { grade: number }) => e.grade === 2.9))
    assertFits(out, control.def.output.schema)
    const blocks = control.store.evidenceBlock(out.evidence[0].evidenceId)!
    assert.equal(blocks.scorer, 'jev')
  } finally { control.cleanup() }

  // control + scorer=rule: explained fallback
  const half = evidenceHarness({ evidence: { scorer: 'rule', jevMode: 'control' }, secret: 'sk-secret' })
  try {
    const out = await half.def.execute({ query: 'node:sqlite busy timeout', task: 't', profile: 'docs_code' }, { signal: undefined })
    assert.equal(half.jevCalls.length, 0)
    assert.match(out.notes.join(' | '), /jevMode=control needs evidence\.scorer=jev/)
  } finally { half.cleanup() }
})

test('evidence.jevMode=hybrid: the rule scorer decides, only Chinese-need / English-block pairs go to Jev, failures keep the rule pack', async () => {
  const args = { query: 'node:sqlite busy timeout', task: 't', profile: 'docs_code', needs: '如何设置 busy timeout;如何开启 WAL 模式' }
  const hybrid = evidenceHarness({ evidence: { jevMode: 'hybrid', maxJevQuestions: 3 }, secret: 'sk-secret' })
  try {
    const out = await hybrid.def.execute(args, { signal: undefined })
    assert.equal(out.stats.scorer, 'hybrid')
    assert.equal(out.stats.jev.mode, 'hybrid')
    assert.ok(out.stats.jev.questions >= 1 && out.stats.jev.questions <= 3, 'maxJevQuestions caps the pairs the hybrid scorer sends: ' + out.stats.jev.questions)
    const sent = hybrid.jevCalls.flatMap(c => Object.values(c.body.questions as Record<string, { instructions: string }>))
    assert.equal(sent.length, out.stats.jev.questions)
    assert.ok(sent.every(q => /需求：如何/.test(q.instructions)), 'only mismatching pairs were asked')
    assert.equal(hybrid.jevCalls[0]!.headers.authorization, 'Bearer sk-secret')
    assert.ok(!JSON.stringify(out).includes('sk-secret'))
    assertFits(out, hybrid.def.output.schema)
    assert.equal(hybrid.store.evidenceBlock(out.evidence[0].evidenceId)!.scorer, 'hybrid')
  } finally { hybrid.cleanup() }

  const noKey = evidenceHarness({ evidence: { jevMode: 'hybrid' }, secret: undefined })
  try {
    const out = await noKey.def.execute(args, { signal: undefined })
    assert.equal(noKey.jevCalls.length, 0)
    assert.equal(out.stats.scorer, 'rule')
    assert.match(out.notes.join(' | '), /BOCHA_JEV_API_KEY.*rule scorer used/)
  } finally { noKey.cleanup() }

  const down = evidenceHarness({ evidence: { jevMode: 'hybrid', hybridBorderline: true }, secret: 'sk-secret', jev: () => new Response('{"detail":"nope"}', { status: 500 }) })
  try {
    const out = await down.def.execute(args, { signal: undefined })
    assert.ok(out.evidence.length > 0, 'the search still answers with the rule grades')
    assert.match(out.notes.join(' | '), /kept the rule grades/)
    assert.ok(!JSON.stringify(out).includes('sk-secret'))
  } finally { down.cleanup() }
})

test('a Jev outage never fails the search: rule fallback with a diagnostic note', async () => {
  const h = evidenceHarness({ evidence: { scorer: 'jev', jevMode: 'control' }, secret: 'sk-secret', jev: () => new Response('{"detail":"nope"}', { status: 401 }) })
  try {
    const out = await h.def.execute({ query: 'node:sqlite busy timeout', task: 't', profile: 'docs_code' }, { signal: undefined })
    assert.equal(out.stats.scorer, 'rule')
    assert.match(out.notes.join(' | '), /scorer jev failed, used the rule scorer: Jev HTTP 401/)
    assert.ok(!JSON.stringify(out).includes('sk-secret'))
    assert.ok(out.evidence.length > 0)
  } finally { h.cleanup() }
})

test('the startup purge of legacy search rows keeps pipeline history queries', async () => {
  const { SEARCH_CACHE_VERSION } = await import('../src/cache-key.ts')
  const h = evidenceHarness()
  try {
    const out = await h.def.execute({ query: 'node:sqlite busy timeout', task: 't', profile: 'docs_code' }, { signal: undefined })
    const purged = h.store.cleanupLegacySearchCache('search:v' + SEARCH_CACHE_VERSION + ':')
    assert.equal(purged.queries, 0)
    assert.ok(h.store.evidenceRun(out.resultId))
  } finally { h.cleanup() }
})

// ── judge rubrics ───────────────────────────────────────────────────────────

test('evidence.rubrics: the active rubric id+version is recorded in stats, shadow log and evidence rows; invalid overrides fall back with a note', async () => {
  const rubrics = { 'score.support': { version: 'v2', instructions: '文本块是否直接给出答案？\n需求：{need}\n文本块：{candidate}' } }
  const args = { query: 'node:sqlite busy timeout', task: 't', profile: 'docs_code', needs: 'busy timeout;WAL mode' }

  const control = evidenceHarness({ evidence: { scorer: 'jev', jevMode: 'control', rubrics }, secret: 'sk-secret' })
  try {
    const out = await control.def.execute(args, { signal: undefined })
    assertFits(out, control.def.output.schema)
    assert.match(out.stats.jev.rubric, /^score\.support@v2#[0-9a-f]{12}$/)
    assert.equal(out.stats.jev.rubricOverridden, true)
    assert.ok(control.jevCalls.every(c => Object.values(c.body.questions as Record<string, { instructions: string }>).every(q => q.instructions.startsWith('文本块是否直接给出答案？'))))
    assert.equal(control.store.evidenceBlock(out.evidence[0].evidenceId)!.rubric, out.stats.jev.rubric)
  } finally { control.cleanup() }

  const shadow = evidenceHarness({ evidence: { jevMode: 'shadow', rubrics }, secret: 'sk-secret' })
  try {
    const out = await shadow.def.execute(args, { signal: undefined })
    const stored = JSON.parse(shadow.store.evidenceRun(out.resultId)!.packJson)
    assert.equal(stored.shadow.rubric, out.stats.jev.rubric)
    assert.match(stored.shadow.rubric, /^score\.support@v2#/)
    assert.equal(shadow.store.evidenceBlock(out.evidence[0].evidenceId)!.rubric, null, 'the rule scorer decided: no rubric on the rows')
  } finally { shadow.cleanup() }

  const bad = evidenceHarness({ evidence: { scorer: 'jev', jevMode: 'control', rubrics: { 'score.support': { version: 'v2', instructions: '{need} {candidate} {oops}' } } }, secret: 'sk-secret' })
  try {
    const out = await bad.def.execute(args, { signal: undefined })
    assert.match(out.notes.join(' | '), /score\.support: override ignored, built-in v1 used: unknown variable \{oops\}/)
    assert.match(out.stats.jev.rubric, /^score\.support@v1#/)
    assert.equal(out.stats.jev.rubricOverridden, false)
    assert.ok(bad.jevCalls.every(c => Object.values(c.body.questions as Record<string, { instructions: string }>).every(q => q.instructions.startsWith('下面的文本块对该需求的支撑程度如何？'))))
  } finally { bad.cleanup() }

  const rule = evidenceHarness({ evidence: { rubrics }, secret: 'sk-secret' })
  try {
    const out = await rule.def.execute(args, { signal: undefined })
    assert.equal(out.stats.jev, undefined, 'Jev off: no rubric involved')
    assert.deepEqual(out.notes.filter((n: string) => /rubric/.test(n)), [])
  } finally { rule.cleanup() }
})
