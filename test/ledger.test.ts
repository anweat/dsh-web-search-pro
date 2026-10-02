import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { BudgetExceededError } from '../src/pipeline/judges/errors.ts'
import { createModelScorer, PRESETS } from '../src/pipeline/judges/providers.ts'
import { estimatePlainTokens } from '../src/pipeline/judges/tokens.ts'
import type { ProviderConfig, ScoreJob } from '../src/pipeline/judges/types.ts'
import { DEFAULT_BUDGET, dayKey, resolveBudget, UsageLedger, type BudgetInput } from '../src/pipeline/ledger.ts'
import { Store } from '../src/store.ts'

const provider: ProviderConfig = { id: 'p1', protocol: 'systemone', baseUrl: 'https://x.test', model: 'm' }
const T0 = Date.parse('2026-10-02T12:00:00Z')

function setup(budget: BudgetInput = {}, now: () => number = () => T0) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wsp-ledger-'))
  const file = path.join(dir, 'store.db')
  const store = new Store(file)
  const ledger = new UsageLedger(store, resolveBudget(budget).caps, now)
  return { dir, file, store, ledger, cleanup: () => { store.close(); fs.rmSync(dir, { recursive: true, force: true }) } }
}
const rows = (s: Store, day = dayKey(T0)) => s.usageRows(day)

test('reserve then settle books the actual tokens: one row per call, price unknown means amount null, never 0', () => {
  const t = setup()
  try {
    const meter = t.ledger.forSearch('s1').meterFor(provider)
    const ticket = meter.reserve({ inputTokens: 1000 })
    assert.deepEqual(rows(t.store).map(r => [r.status, r.inputTokens, r.requests]), [['reserved', 1000, 0]])
    assert.deepEqual(ticket.settle({ inputTokens: 800, outputTokens: 5 }), { inputTokens: 800, outputTokens: 5, estimated: false })
    const [row] = rows(t.store)
    assert.deepEqual([row!.status, row!.provider, row!.protocol, row!.model, row!.searchId, row!.requests, row!.inputTokens, row!.outputTokens, row!.estimated, row!.amount], ['settled', 'p1', 'systemone', 'm', 's1', 1, 800, 5, false, null])
    const today = t.ledger.today()
    assert.deepEqual([today.totals.inputTokens, today.totals.outputTokens, today.totals.requests, today.totals.amount, today.providers.length], [800, 5, 1, null, 1])
    assert.deepEqual(today.caps, { perSearchInputTokens: 60_000, dailyInputTokens: 1_000_000, providers: {} })
  } finally { t.cleanup() }
})

test('a service without usage is booked at the conservative estimate, flagged estimated; an unknown outcome too', () => {
  const t = setup()
  try {
    const meter = t.ledger.forSearch().meterFor(provider)
    assert.deepEqual(meter.reserve({ inputTokens: 700 }).settle({}), { inputTokens: 700, outputTokens: 0, estimated: true })
    assert.deepEqual(meter.reserve({ inputTokens: 300 }).unknown(), { inputTokens: 300, outputTokens: 0, estimated: true })
    assert.deepEqual(rows(t.store).map(r => [r.inputTokens, r.estimated]), [[700, true], [300, true]])
    assert.match(rows(t.store)[1]!.note!, /outcome unknown/)
    assert.equal(t.ledger.today().totals.estimated, true)
  } finally { t.cleanup() }
})

test('a refused call counts its request but no tokens and frees the reservation', () => {
  const t = setup({ dailyInputTokens: 1000 })
  try {
    const meter = t.ledger.forSearch().meterFor(provider)
    meter.reserve({ inputTokens: 900 }).refused()
    const [row] = rows(t.store)
    assert.deepEqual([row!.status, row!.requests, row!.inputTokens], ['released', 1, 0])
    meter.reserve({ inputTokens: 900 })
    const today = t.ledger.today()
    assert.equal(today.totals.requests, 1)
    assert.equal(today.totals.inputTokens, 900)
  } finally { t.cleanup() }
})

test('money is booked only for a declared price; output tokens without an output price make the amount unknown', () => {
  const t = setup({ perSearchInputTokens: 100_000_000, dailyInputTokens: 100_000_000 })
  try {
    const priced: ProviderConfig = { ...provider, price: { inputPerMTokens: 2, outputPerMTokens: 8, currency: 'CNY' } }
    const meter = t.ledger.forSearch().meterFor(priced)
    meter.reserve({ inputTokens: 1_000_000 }).settle({ inputTokens: 500_000, outputTokens: 250_000 })
    const inputOnly = t.ledger.forSearch().meterFor({ ...provider, price: { inputPerMTokens: 2, currency: 'CNY' } })
    inputOnly.reserve({ inputTokens: 10 }).settle({ inputTokens: 1_000_000, outputTokens: 0 })
    t.ledger.forSearch().meterFor({ ...provider, price: { inputPerMTokens: 2, currency: 'CNY' } }).reserve({ inputTokens: 10 }).settle({ inputTokens: 10, outputTokens: 3 })
    assert.deepEqual(rows(t.store).map(r => [r.amount, r.currency]).sort((a, b) => String(a[0]).localeCompare(String(b[0]))), [[2, 'CNY'], [3, 'CNY'], [null, undefined]])
    const today = t.ledger.today()
    assert.equal(today.totals.amount, null, 'one unpriced call makes the day total unknown, not smaller')
  } finally { t.cleanup() }
})

test('per-search cap: the second reservation that would pass it is refused; settling below the estimate frees headroom', () => {
  const t = setup({ perSearchInputTokens: 1000 })
  try {
    const search = t.ledger.forSearch()
    const meter = search.meterFor(provider)
    const a = meter.reserve({ inputTokens: 600 })
    assert.equal(meter.headroom(), 400)
    assert.throws(() => meter.reserve({ inputTokens: 600 }), (e: Error) => e instanceof BudgetExceededError && /^model budget exceeded: per-search cap 1000 input tokens \(600 used, 600 requested\)/.test(e.message))
    assert.equal(rows(t.store).length, 1, 'a refused reservation leaves no row')
    a.settle({ inputTokens: 100 })
    assert.equal(search.used, 100)
    meter.reserve({ inputTokens: 600 }).settle({ inputTokens: 600 })
    // another search starts from zero
    t.ledger.forSearch().meterFor(provider).reserve({ inputTokens: 900 })
  } finally { t.cleanup() }
})

test('provider overrides tighten the global caps: per search and per day, the stricter wins', () => {
  const t = setup({ perSearchInputTokens: 10_000, dailyInputTokens: 10_000, providers: { p1: { perSearchInputTokens: 500, dailyInputTokens: 1200 } } })
  try {
    const search = t.ledger.forSearch()
    const mine = search.meterFor(provider)
    const other = search.meterFor({ ...provider, id: 'p2' })
    assert.equal(mine.headroom(), 500)
    assert.equal(other.headroom(), 10_000)
    assert.throws(() => mine.reserve({ inputTokens: 501 }), /p1 per-search cap 500/)
    other.reserve({ inputTokens: 5000 }).settle({ inputTokens: 5000 })
    mine.reserve({ inputTokens: 500 }).settle({ inputTokens: 500 })
    t.ledger.forSearch().meterFor(provider).reserve({ inputTokens: 500 }).settle({ inputTokens: 500 })
    assert.throws(() => t.ledger.forSearch().meterFor(provider).reserve({ inputTokens: 500 }), /p1 daily cap 1200 input tokens \(1000 used today, 500 requested\)/)
    t.ledger.forSearch().meterFor(provider).reserve({ inputTokens: 200 })
    // the global daily cap counts every provider
    assert.throws(() => t.ledger.forSearch().meterFor({ ...provider, id: 'p2' }).reserve({ inputTokens: 5000 }), /model budget exceeded: daily cap 10000 input tokens/)
  } finally { t.cleanup() }
})

test('daily cap holds across searches; reserved rows count until settled', () => {
  const t = setup({ dailyInputTokens: 1000 })
  try {
    const a = t.ledger.forSearch('a').meterFor(provider).reserve({ inputTokens: 700 })
    const other = t.ledger.forSearch('b').meterFor(provider)
    assert.throws(() => other.reserve({ inputTokens: 400 }), /daily cap 1000 input tokens \(700 used today, 400 requested\)/)
    a.settle({ inputTokens: 300 })
    other.reserve({ inputTokens: 400 })
  } finally { t.cleanup() }
})

test('two stores on the same file (two DSH processes) cannot both spend the same headroom', () => {
  const t = setup({ dailyInputTokens: 1000 })
  const second = new Store(t.file)
  try {
    const other = new UsageLedger(second, resolveBudget({ dailyInputTokens: 1000 }).caps, () => T0)
    t.ledger.forSearch().meterFor(provider).reserve({ inputTokens: 600 })
    assert.throws(() => other.forSearch().meterFor(provider).reserve({ inputTokens: 600 }), BudgetExceededError)
    other.forSearch().meterFor(provider).reserve({ inputTokens: 400 })
    assert.equal(rows(t.store).reduce((n, r) => n + r.inputTokens, 0), 1000)
  } finally { second.close(); t.cleanup() }
})

test('usage survives a restart; an unsettled reservation (a crash) keeps counting', () => {
  const t = setup({ dailyInputTokens: 1000 })
  const { file, dir } = t
  try {
    t.ledger.forSearch().meterFor(provider).reserve({ inputTokens: 300 }).settle({ inputTokens: 250, outputTokens: 4 })
    t.ledger.forSearch().meterFor(provider).reserve({ inputTokens: 500 }) // never settled: the process dies here
    t.store.close()
    const reopened = new Store(file)
    try {
      const ledger = new UsageLedger(reopened, resolveBudget({ dailyInputTokens: 1000 }).caps, () => T0)
      const today = ledger.today()
      assert.equal(today.totals.inputTokens, 750)
      assert.equal(today.totals.outputTokens, 4)
      assert.throws(() => ledger.forSearch().meterFor(provider).reserve({ inputTokens: 300 }), /daily cap 1000 input tokens \(750 used today/)
      ledger.forSearch().meterFor(provider).reserve({ inputTokens: 250 })
    } finally { reopened.close() }
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
})

test('a closed store refuses reservations instead of letting a call go unmetered', () => {
  const t = setup()
  t.store.close()
  try {
    assert.throws(() => t.ledger.forSearch().meterFor(provider).reserve({ inputTokens: 1 }), /usage ledger unavailable/)
  } finally { fs.rmSync(t.dir, { recursive: true, force: true }) }
})

test('time zones: the day rolls over at local midnight, the daily cap starts again, old rows stay', () => {
  assert.equal(dayKey(Date.parse('2026-10-02T15:30:00Z'), 'Asia/Shanghai'), '2026-10-02')
  assert.equal(dayKey(Date.parse('2026-10-02T16:00:00Z'), 'Asia/Shanghai'), '2026-10-03')
  assert.equal(dayKey(Date.parse('2026-10-02T06:59:00Z'), 'America/Los_Angeles'), '2026-10-01')
  assert.equal(dayKey(Date.parse('2026-10-02T07:00:00Z'), 'America/Los_Angeles'), '2026-10-02')
  assert.equal(dayKey(Date.parse('2026-10-02T23:59:59Z'), 'UTC'), '2026-10-02')
  assert.equal(dayKey(Date.parse('2026-10-03T00:00:00Z'), 'UTC'), '2026-10-03')

  let now = Date.parse('2026-10-02T15:30:00Z')
  const t = setup({ dailyInputTokens: 1000, timezone: 'Asia/Shanghai' }, () => now)
  try {
    t.ledger.forSearch().meterFor(provider).reserve({ inputTokens: 900 }).settle({ inputTokens: 900 })
    assert.throws(() => t.ledger.forSearch().meterFor(provider).reserve({ inputTokens: 200 }), /daily cap/)
    assert.equal(t.ledger.today().day, '2026-10-02')
    now = Date.parse('2026-10-02T16:01:00Z') // 00:01 the next day in Shanghai
    assert.equal(t.ledger.today().day, '2026-10-03')
    assert.equal(t.ledger.today().totals.inputTokens, 0)
    t.ledger.forSearch().meterFor(provider).reserve({ inputTokens: 200 }).settle({ inputTokens: 200 })
    assert.deepEqual(t.store.usageRows('2026-10-02').map(r => r.inputTokens), [900])
    assert.deepEqual(t.store.usageRows('2026-10-03').map(r => r.inputTokens), [200])
    // a reservation made before midnight and settled after stays on its own day
    now = Date.parse('2026-10-03T15:59:00Z')
    const late = t.ledger.forSearch().meterFor(provider).reserve({ inputTokens: 10 })
    now = Date.parse('2026-10-03T16:30:00Z')
    late.settle({ inputTokens: 10 })
    assert.equal(t.store.usageRows('2026-10-03').length, 2)
    assert.equal(t.store.usageRows('2026-10-04').length, 0)
  } finally { t.cleanup() }
})

test('budget settings: defaults 60k per search and 1M per day, invalid values fall back and are reported', () => {
  assert.deepEqual(resolveBudget().caps, { perSearchInputTokens: 60_000, dailyInputTokens: 1_000_000, providers: {} })
  assert.deepEqual(DEFAULT_BUDGET, { perSearchInputTokens: 60_000, dailyInputTokens: 1_000_000 })
  const r = resolveBudget({ perSearchInputTokens: -1, dailyInputTokens: 5000.9, timezone: 'Mars/Base', providers: { a: { dailyInputTokens: 10, perSearchInputTokens: Number.NaN }, b: null as never } })
  assert.deepEqual(r.caps, { perSearchInputTokens: 60_000, dailyInputTokens: 5000, providers: { a: { dailyInputTokens: 10 } } })
  assert.equal(r.diagnostics.length, 4)
  for (const part of [/budget\.perSearchInputTokens ignored/, /timezone "Mars\/Base" is not a time zone/, /providers\.a\.perSearchInputTokens ignored/, /providers\.b ignored/]) assert.match(r.diagnostics.join('|'), part)
  assert.equal(resolveBudget({ perSearchInputTokens: 0 }).caps.perSearchInputTokens, 0, 'zero switches the model stage off')
  assert.equal(resolveBudget({ timezone: 'Asia/Tokyo' }).caps.timezone, 'Asia/Tokyo')
})

// ── through a scorer ────────────────────────────────────────────────────────

const TASK = { goal: '了解 node:sqlite 的 timeout 选项', query: 'q', needs: [], constraints: [] }
const NEED = { id: 'n1', text: 'timeout 选项是什么', critical: true }
const job = (n: number): ScoreJob => ({ need: NEED, blocks: Array.from({ length: n }, (_, i) => ({ blockId: 'b' + i, url: 'https://x.test/' + i, text: '段落 timeout ' + i })) })
const sleep = async (): Promise<void> => {}
const answer = (body: { questions: Record<string, unknown> }, input = 100): Response => new Response(JSON.stringify({ answers: Object.fromEntries(Object.keys(body.questions).map(k => [k, { score: 2 }])), usage: { input_tokens: input, output_tokens: 0 } }))

function metered(t: ReturnType<typeof setup>, p: ProviderConfig, fetchImpl: typeof fetch, search = t.ledger.forSearch()) {
  return createModelScorer(p, { apiKey: p.keyRef ? 'k' : undefined, fetchImpl, sleep, meter: search.meterFor(p) })
}

test('two searches racing for one daily budget: only what fits is sent, nothing is overspent', async () => {
  const t = setup({ dailyInputTokens: 700 })
  try {
    let sent = 0
    const fetchImpl = (async (_u: string, init: { body: string }) => { sent++; await new Promise(r => setTimeout(r, 5)); return answer(JSON.parse(init.body), 100) }) as unknown as typeof fetch
    const settled = await Promise.allSettled(Array.from({ length: 6 }, () => metered(t, PRESETS['laya-local']!, fetchImpl).score(TASK, [job(2)])))
    const ok = settled.filter(s => s.status === 'fulfilled').length
    const denied = settled.filter(s => s.status === 'rejected' && s.reason instanceof BudgetExceededError).length
    assert.equal(ok + denied, 6)
    assert.ok(ok >= 1 && ok < 6, 'some were refused: ' + ok)
    assert.equal(sent, ok, 'refused searches sent nothing')
    const total = rows(t.store).filter(r => r.status !== 'released').reduce((n, r) => n + r.inputTokens, 0)
    assert.ok(total <= 700, 'booked ' + total)
    // reservations were made together (before any settle): the estimate, not the cheap actual, decided how many fit
    const est = estimatePlainTokens('搜索任务：' + TASK.goal + '下面的文本块对该需求的支撑程度如何？\n需求：' + NEED.text + '\n文本块：段落 timeout 0') + 80
    assert.ok(ok <= Math.ceil(700 / est) + 1)
  } finally { t.cleanup() }
})

test('requests are sized to the headroom: with a small per-search cap every request fits it and all questions are still answered', async () => {
  const q = estimatePlainTokens('搜索任务：' + TASK.goal + '下面的文本块对该需求的支撑程度如何？\n需求：' + NEED.text + '\n文本块：段落 timeout 00') + 80
  const t = setup({ perSearchInputTokens: Math.floor(q * 3.5) })
  try {
    const sizes: number[] = []
    const fetchImpl = (async (_u: string, init: { body: string }) => { const b = JSON.parse(init.body); sizes.push(Object.keys(b.questions).length); return answer(b, 20) }) as unknown as typeof fetch
    const out = await metered(t, PRESETS['laya-local']!, fetchImpl).score(TASK, [job(12)])
    assert.ok(sizes.every(s => s <= 3), sizes.join(','))
    assert.equal(out.grades.get('n1')!.size, 12)
    assert.ok(rows(t.store).every(r => r.status === 'settled'))
  } finally { t.cleanup() }
})

test('when the cap is reached mid-stage the answered part is kept and the rest is noted as a budget stop', async () => {
  const t = setup({ perSearchInputTokens: 2000 })
  try {
    // the service reports far more than estimated, so the second request no longer fits
    const fetchImpl = (async (_u: string, init: { body: string }) => answer(JSON.parse(init.body), 1900)) as unknown as typeof fetch
    const p: ProviderConfig = { ...PRESETS['laya-local']!, limits: { maxQuestionsPerRequest: 4 } }
    const out = await metered(t, p, fetchImpl).score(TASK, [job(8)])
    assert.equal(out.grades.get('n1')!.size, 4)
    assert.match(out.notes![0]!, /^model budget exceeded: per-search cap 2000/)
    assert.match(out.notes!.join('|'), /4 of 8 Laya questions got no answer/)
  } finally { t.cleanup() }
})

test('transport outcomes are booked: a retried 503 counts both attempts, a network error keeps the estimate, a 401 is a refused request', async () => {
  const t = setup()
  try {
    let n = 0
    const flaky = (async (_u: string, init: { body: string }) => {
      n++
      if (n === 1) return new Response('busy', { status: 503 })
      if (n === 2) throw new TypeError('fetch failed')
      return answer(JSON.parse(init.body), 42)
    }) as unknown as typeof fetch
    const out = await metered(t, PRESETS['laya-local']!, flaky).score(TASK, [job(1)])
    assert.equal(out.grades.get('n1')!.size, 1)
    const booked = rows(t.store)
    const by = (status: string, estimated: boolean) => booked.find(r => r.status === status && r.estimated === estimated)!
    assert.equal(booked.length, 3)
    assert.deepEqual([by('released', false).requests, by('released', false).inputTokens], [1, 0], 'the 503 was refused: a request, no tokens')
    assert.ok(by('settled', true).inputTokens > 0, 'the network error keeps the estimate booked')
    assert.match(by('settled', true).note!, /outcome unknown/)
    assert.equal(by('settled', false).inputTokens, 42)
    assert.equal(out.usage!.requests, 3)

    const denied = (async () => new Response('no', { status: 401 })) as unknown as typeof fetch
    const keyed: ProviderConfig = { ...PRESETS['laya-local']!, keyRef: 'K' }
    await assert.rejects(metered(t, keyed, denied).score(TASK, [job(1)]), /401/)
    assert.equal(rows(t.store).length, 4)
    assert.equal(rows(t.store).filter(r => r.note === 'refused by the service').length, 2, 'the 503 and the 401')
  } finally { t.cleanup() }
})
