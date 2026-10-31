import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { registerHooks } from 'node:module'
import { resolveConfig } from '../src/config.ts'
import { Store } from '../src/store.ts'
import { findAction } from '../src/actions/registry.ts'
import { checkOutput } from '../src/actions/schema.ts'
import { runAction, renderEnvelope } from '../src/actions/run.ts'
import { renderEvidenceOutput } from '../src/pipeline/render.ts'
import { createFetchProvider, createSearchProvider } from '../src/provider.ts'
import type { ProviderOutcome } from '../src/pipeline/run.ts'
import {
  NoticeBoard, NOTICE_TABLE, attachNotices, noticeModeOf, noticesOf, notice, renderNotices, takeNotices, uniqueNotices, type Notice, type NoticeMode,
} from '../src/wechat/notices.ts'
import { callEnvelope, renderResult } from './call-helper.ts'

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === '@deepseek-ai/dsh-tools') return { url: 'data:text/javascript,export const defineTool = value => value', shortCircuit: true }
    return nextResolve(specifier, context)
  },
})
const { EvidenceService } = await import('../src/pipeline/service.ts')

const SIGNED = 'https://mp.weixin.qq.com/s?src=11&timestamp=1793462540&ver=7060&signature=FIXTURESIGNATURE&new=1'
const antispider = (): Notice => notice('wechat.antispider')
const codes = (list: readonly Notice[] | undefined): string[] => (list ?? []).map(n => n.code)

test('the phase A notice codes: level, English code, Chinese message', () => {
  assert.deepEqual(Object.entries(NOTICE_TABLE).map(([code, e]) => [code, e.level]), [['wechat.antispider', 'warn'], ['wechat.signed-url', 'info'], ['wechat.bare-url', 'info'], ['wechat.copyright', 'info']])
  for (const e of Object.values(NOTICE_TABLE)) assert.match(e.message, /[一-鿿]/)
  assert.deepEqual(notice('wechat.copyright', 'custom'), { level: 'info', code: 'wechat.copyright', message: 'custom' })
})

test('NoticeBoard once (default): each code is shown once per instance; a warn comes again with a different message; info is by code', () => {
  const board = new NoticeBoard()
  assert.deepEqual(codes(board.take([notice('wechat.signed-url'), notice('wechat.signed-url', 'other text')])), ['wechat.signed-url'], 'duplicates within one call collapse by text, an info by code afterwards')
  assert.equal(board.take([notice('wechat.signed-url')]), undefined)
  assert.equal(board.take([notice('wechat.signed-url', 'yet another text')]), undefined, 'info is remembered by code')
  assert.deepEqual(codes(board.take([antispider()])), ['wechat.antispider'])
  assert.equal(board.take([antispider()]), undefined)
  assert.deepEqual(codes(board.take([notice('wechat.antispider', '又一次：换了出口 IP 仍然被拦')])), ['wechat.antispider'], 'a new failure is shown again')
  assert.equal(board.take(undefined), undefined)
  assert.equal(board.take([]), undefined)
  board.reset('wechat.antispider')
  assert.deepEqual(codes(board.take([antispider()])), ['wechat.antispider'], 'reset forgets the code')
  board.reset()
  assert.deepEqual(codes(board.take([notice('wechat.signed-url')])), ['wechat.signed-url'])
})

test('NoticeBoard always shows every time; off never; the mode is read at call time; unknown modes mean once', () => {
  let mode: NoticeMode = 'always'
  const board = new NoticeBoard(() => mode)
  assert.deepEqual(codes(board.take([antispider()])), ['wechat.antispider'])
  assert.deepEqual(codes(board.take([antispider()])), ['wechat.antispider'])
  mode = 'off'
  assert.equal(board.take([antispider()]), undefined)
  mode = 'once'
  assert.deepEqual(codes(board.take([antispider()])), ['wechat.antispider'], 'always did not use up the once-memory')
  assert.equal(board.take([antispider()]), undefined)
  assert.equal(noticeModeOf('always'), 'always')
  assert.equal(noticeModeOf('off'), 'off')
  assert.equal(noticeModeOf('whatever'), 'once')
  assert.equal(noticeModeOf(undefined), 'once')
})

test('uniqueNotices orders action before warn before info and drops repeats; takeNotices without a board is just unique', () => {
  const list: Notice[] = [notice('wechat.copyright'), antispider(), { level: 'action', code: 'wechat.login-expired', message: '请重新扫码' }, antispider()]
  assert.deepEqual(uniqueNotices(list).map(n => n.level), ['action', 'warn', 'info'])
  assert.deepEqual(takeNotices(undefined, list)!.length, 3)
  assert.equal(takeNotices(undefined, []), undefined)
})

test('notices travel on thrown errors', () => {
  const error = attachNotices(new Error('x'), [antispider()])
  assert.deepEqual(codes(noticesOf(error)), ['wechat.antispider'])
  assert.deepEqual(codes(noticesOf(attachNotices(error, [notice('wechat.copyright')]))), ['wechat.antispider', 'wechat.copyright'])
  assert.deepEqual(noticesOf(new Error('plain')), [])
  assert.deepEqual(noticesOf('a string'), [])
  assert.equal(attachNotices('a string', [antispider()]), 'a string')
  assert.deepEqual(codes(noticesOf(Object.assign(new Error('y'), { notices: [antispider(), { nope: true }] }))), ['wechat.antispider'], 'a notices property is read too, malformed entries are ignored')
})

test('renderNotices: a separate "提醒用户 / Tell the user" block, action items first and marked', () => {
  assert.equal(renderNotices(undefined), '')
  assert.equal(renderNotices([]), '')
  const text = renderNotices([antispider(), { level: 'action', code: 'wechat.login-expired', message: '请重新扫码登录' }])
  assert.match(text, /^提醒用户 \/ Tell the user/)
  assert.match(text, /请在回答里明确转告/, 'an action notice says the user must act')
  assert.match(text, /\n- \[警告\] 搜狗微信搜索触发了反爬验证.*\(wechat\.antispider\)/)
  assert.match(renderNotices([notice('wechat.copyright')]), /relay these to the user/)
})

// ── the output schemas and the action layer ─────────────────────────────────

const NOTICES = [{ level: 'warn', code: 'wechat.antispider', message: '搜狗反爬' }]

test('output schemas: search.run and read.fetch accept notices (closed: an unknown notice field is refused)', () => {
  const run = findAction('search.run')!.output
  const read = findAction('read.fetch')!.output
  assert.deepEqual(checkOutput(run, { sources: [], engine: 'wechat', fromCache: false, notices: NOTICES }), [])
  assert.deepEqual(checkOutput(read, { url: 'u', text: 't', source: 'http', fromCache: false, notices: NOTICES }), [])
  assert.match(checkOutput(run, { sources: [], engine: 'wechat', fromCache: false, notices: [{ level: 'warn', code: 'c', message: 'm', extra: 1 }] }).join(), /extra: not declared/)
  assert.match(checkOutput(read, { url: 'u', text: 't', source: 'http', fromCache: false, notices: [{ level: 'warn' }] }).join(), /code: required but missing/)
})

function services(over: Record<string, unknown> = {}, mode: NoticeMode = 'once') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wsp-notices-'))
  const config = resolveConfig({ dbPath: path.join(dir, 'store.db'), searchMaxResults: 5 } as never)
  const store = new Store(config.dbPath)
  const board = new NoticeBoard(() => mode)
  const router = {
    registry: undefined,
    search: async (input: any) => ({ sources: [{ url: SIGNED, title: '公众号文章' }, { url: 'https://example.com/a', title: 'Other' }], engine: input.platform ? 'wechat' : 'ddg', enginesTried: ['wechat'], fromCache: false, backend: 'sogou', notices: [antispider()] }),
    resolvePlatform: (request: any, query: string) => ({ id: request.id, query }),
  }
  const evidence = { search: async () => ({ resultId: 'r1', profile: 'general', profileInferred: false, needs: [{ id: 'n1', text: 'q', critical: true }], evidence: [{ evidenceId: 'e1', url: SIGNED, title: 'T', excerpt: 'text', needIds: ['n1'], grade: 3, source: 'wechat' }], coveredNeeds: ['n1'], gaps: [], partial: false, notes: [], verification: { native: [], local: [] }, sources: [{ url: SIGNED, title: 'T' }], engine: 'pipeline(wechat/sogou)', enginesTried: ['wechat'], stats: { candidates: 1, kept: 1, lowConfidence: 0, fetched: 1, blocksScored: 1, excerptChars: 4, scorer: 'rule' }, fromCache: false, notices: [antispider()] }) }
  const fetchSvc = { fetchPage: async (url: string) => ({ url, title: 'T', text: '正文', source: 'http', fromCache: false, notices: [notice('wechat.copyright'), notice('wechat.signed-url')] }) }
  const base = { config, dynamic: () => config, store, router, fetch: fetchSvc, browser: () => undefined, evidence: () => evidence, outputCap: () => 20_000, notices: board, ...over }
  return { base, board, cleanup: () => { store.close(); fs.rmSync(dir, { recursive: true, force: true }) } }
}

async function call(base: any, action: string, args: Record<string, unknown>) {
  const envelope = await runAction(action, args, { ...base, signal: new AbortController().signal })
  assert.equal(envelope.ok, true, JSON.stringify(envelope.error))
  assert.deepEqual(checkOutput(findAction(action)!.output, envelope.result), [], 'the result fits the closed schema')
  return { result: envelope.result as any, text: renderEnvelope(envelope, args) }
}

test('search.run (platform mode): notices of the run plus the signed-url one, rendered as their own block; the second call is quiet (once)', async () => {
  const s = services()
  try {
    const first = await call(s.base, 'search.run', { query: '大模型', platform: 'wechat' })
    assert.deepEqual(codes(first.result.notices), ['wechat.antispider', 'wechat.signed-url'])
    assert.match(first.text, /\n\n提醒用户 \/ Tell the user[^\n]*:\n- \[警告\].*\n- \[提示\].*wechat\.signed-url/)
    const second = await call(s.base, 'search.run', { query: '大模型 2', platform: 'wechat' })
    assert.equal(second.result.notices, undefined)
    assert.doesNotMatch(second.text, /Tell the user/)
  } finally { s.cleanup() }
})

test('search.run (plain and evidence mode) carry the notices too; a web source returning a signed link also earns the signed-url notice', async () => {
  const s = services()
  try {
    const plain = await call(s.base, 'search.run', { query: '大模型' })
    assert.deepEqual(codes(plain.result.notices), ['wechat.antispider', 'wechat.signed-url'])
    assert.match(plain.text, /Tell the user/)
  } finally { s.cleanup() }
  const e = services()
  try {
    const pack = await call(e.base, 'search.run', { query: '大模型', task: '了解大模型' })
    assert.deepEqual(codes(pack.result.notices), ['wechat.antispider', 'wechat.signed-url'])
    assert.match(pack.text, /Evidence pack r1[\s\S]*\n\n提醒用户 \/ Tell the user/)
    assert.equal(pack.result.resultId, 'r1')
  } finally { e.cleanup() }
})

test('search.run: mode off shows nothing, mode always shows every time', async () => {
  const off = services({}, 'off')
  const always = services({}, 'always')
  try {
    assert.equal((await call(off.base, 'search.run', { query: 'q', platform: 'wechat' })).result.notices, undefined)
    assert.ok((await call(always.base, 'search.run', { query: 'q', platform: 'wechat' })).result.notices)
    assert.ok((await call(always.base, 'search.run', { query: 'q', platform: 'wechat' })).result.notices)
    // No board at all (a host without one): everything is shown.
    const none = services({ notices: undefined })
    assert.ok((await call(none.base, 'search.run', { query: 'q', platform: 'wechat' })).result.notices)
    none.cleanup()
  } finally { off.cleanup(); always.cleanup() }
})

test('read.fetch: copyright and signed-url notices once per instance, rendered after the page', async () => {
  const s = services()
  try {
    const first = await call(s.base, 'read.fetch', { url: SIGNED })
    assert.deepEqual(codes(first.result.notices), ['wechat.copyright', 'wechat.signed-url'])
    assert.match(first.text, /正文\n\n— Source: http[\s\S]*\n\n提醒用户 \/ Tell the user/)
    const second = await call(s.base, 'read.fetch', { url: SIGNED })
    assert.equal(second.result.notices, undefined)
  } finally { s.cleanup() }
})

test('an error that carries notices puts them on the error body (once), so a failure still tells the user why', async () => {
  const failing = { search: async () => { throw attachNotices(new Error('platform wechat unavailable (tried: wechat): sogou anti-spider'), [antispider()]) }, resolvePlatform: (r: any, q: string) => ({ id: r.id, query: q }) }
  const s = services({ router: failing })
  try {
    const envelope = await runAction('search.run', { query: 'q', platform: 'wechat' }, { ...s.base, signal: new AbortController().signal })
    assert.equal(envelope.ok, false)
    assert.deepEqual(codes(envelope.error!.notices), ['wechat.antispider'])
    assert.match(renderEnvelope(envelope), /wechat\.antispider/)
    const again = await runAction('search.run', { query: 'q', platform: 'wechat' }, { ...s.base, signal: new AbortController().signal })
    assert.equal(again.error!.notices, undefined)
  } finally { s.cleanup() }
})

test('the web_call envelope schema accepts the notices of an error body', async () => {
  const { registerTools } = await import('../src/tools.ts')
  const failing = { search: async () => { throw attachNotices(new Error('platform wechat unavailable'), [antispider()]) }, resolvePlatform: (r: any, q: string) => ({ id: r.id, query: q }) }
  const s = services({ router: failing })
  try {
    const defs = new Map<string, any>()
    registerTools({ ctx: { tools: { register: (d: any) => defs.set(d.name, d) } } as any, config: s.base.config, dynamic: s.base.dynamic, store: s.base.store, router: failing as any, fetch: s.base.fetch as any, notices: s.board })
    const envelope = await callEnvelope(defs, 'search.run', { query: 'q', platform: 'wechat' })
    assert.equal(envelope.ok, false)
    assert.deepEqual(codes(envelope.error.notices), ['wechat.antispider'])
    assert.deepEqual(checkOutput(defs.get('web_call').output.schema, envelope), [])
  } finally { s.cleanup() }
})

test('renderResult of an evidence pack shows notices after the expand line; none, no block', () => {
  const pack: any = { resultId: 'r', profile: 'general', needs: [{ id: 'n1', text: 'q', critical: true }], evidence: [], coveredNeeds: [], gaps: [], partial: false, notes: [], verification: { native: [], local: [] }, sources: [], engine: 'x' }
  assert.doesNotMatch(renderEvidenceOutput(pack), /Tell the user/)
  assert.match(renderEvidenceOutput({ ...pack, notices: [antispider()] }), /Tell the user/)
  assert.doesNotMatch(renderResult('read.fetch', { url: 'u', text: 't', source: 'http', fromCache: false }), /Tell the user/)
})

// ── evidence service and the ctx.web route ──────────────────────────────────

function evidenceService(outcome: ProviderOutcome, pageNotices: Notice[] = []) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wsp-notices-evidence-'))
  const config = resolveConfig({ dbPath: path.join(dir, 'store.db'), engines: ['wechat'], timeoutMs: 5_000, enableCliBackends: false } as never)
  const store = new Store(config.dbPath)
  const router = {
    providerStatuses: async (ids: string[]) => new Map(ids.map(id => [id, { state: 'ready' as const }])),
    runProvider: async (): Promise<ProviderOutcome> => outcome,
    resolveSecret: async () => undefined,
    searchAsProvider: async () => ({ content: 'PLAIN', sources: [], truncated: false }),
    anyEngineAvailable: () => true,
  }
  const page = '公众号文章正文，讲 AI Agent 落地的十大领域与三十款产品，其中包含 Agent 在客服、编程与办公场景的真实案例。'.repeat(3)
  const fetchSvc = { fetchPage: async (url: string) => ({ url, title: '文章', text: page, source: 'http', fromCache: false, ...pageNotices.length ? { notices: pageNotices } : {} }) }
  const service = new EvidenceService({ router: router as any, fetch: fetchSvc as any, store, dynamic: () => config })
  return { service, config, router, fetchSvc, cleanup: () => { store.close(); fs.rmSync(dir, { recursive: true, force: true }) } }
}

const WECHAT_HIT: ProviderOutcome = { state: 'ok', sources: [{ url: SIGNED, title: 'AI Agent 落地 十大领域', snippet: 'AI Agent 落地' }], notices: [antispider()] }

test('EvidenceService collects the notices of providers and of the pages it read (raw: the action layer decides what is shown)', async () => {
  const h = evidenceService(WECHAT_HIT, [notice('wechat.copyright')])
  try {
    const out = await h.service.search({ query: 'AI Agent 落地', task: '了解 AI Agent 落地', profile: 'general', count: 5, engines: ['wechat'] })
    assert.deepEqual(codes(out.notices).sort(), ['wechat.antispider', 'wechat.copyright'])
  } finally { h.cleanup() }
  const quiet = evidenceService({ state: 'ok', sources: [{ url: 'https://example.com/a', title: 'AI Agent 落地', snippet: 'AI Agent 落地 十大领域' }] })
  try {
    const out = await quiet.service.search({ query: 'AI Agent 落地', task: '了解 AI Agent 落地', profile: 'general', count: 5, engines: ['wechat'] })
    assert.equal(out.notices, undefined)
  } finally { quiet.cleanup() }
})

test('EvidenceService: when every provider fails, the notices of the failure ride on the thrown error', async () => {
  const h = evidenceService({ state: 'error', message: 'wechat: anti-spider', notices: [antispider()] })
  try {
    const error: any = await h.service.search({ query: 'AI Agent 落地', task: '了解 AI Agent 落地', profile: 'general', count: 5, engines: ['wechat'] }).then(() => undefined, e => e)
    assert.match(error.message, /all providers failed/)
    assert.deepEqual(codes(noticesOf(error)), ['wechat.antispider'])
  } finally { h.cleanup() }
})

test('the ctx.web route shows notices once through the shared board: in the pack text and after a fetched page', async () => {
  const h = evidenceService(WECHAT_HIT, [notice('wechat.copyright')])
  const board = new NoticeBoard()
  try {
    const provider = createSearchProvider({ router: h.router as any, evidence: () => h.service, dynamic: () => h.config, id: () => 'wsp-test', surface: 'indexed', notices: board })
    const first = await provider.search({ query: 'AI Agent 落地' } as never)
    assert.match(first.content!, /Tell the user[\s\S]*wechat\.antispider/)
    assert.match(first.content!, /wechat\.signed-url/)
    const second = await provider.search({ query: 'AI Agent 落地 2' } as never)
    assert.doesNotMatch(second.content!, /Tell the user/)
    const fetcher = createFetchProvider({ fetch: { fetchPage: async (url: string) => ({ url, text: '正文', source: 'http', fromCache: false, notices: [notice('wechat.bare-url')] }) } as never, dynamic: () => h.config, id: () => 'wsp-test', surface: 'indexed', notices: board })
    const page = await fetcher.fetch({ url: SIGNED } as never)
    assert.match((page.body as any).content, /^正文\n\n提醒用户 \/ Tell the user[\s\S]*wechat\.bare-url/)
    const again = await fetcher.fetch({ url: SIGNED } as never)
    assert.equal((again.body as any).content, '正文')
  } finally { h.cleanup() }
})
