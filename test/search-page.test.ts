import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { resolveConfig } from '../src/config.ts'
import { createBuiltinRegistry } from '../src/providers/index.ts'
import { SearchRouter } from '../src/router.ts'
import { Store } from '../src/store.ts'
import { clearProbeCache } from '../src/cli/probe.ts'
import { clearOpencliCache } from '../src/cli/opencli.ts'
import { sourcesOfSearchPage } from '../src/search-page.ts'
import type { SearchPageResult, SearchPageState } from '../src/browser-service.ts'
import { BROWSER_020 } from './browser-stub.ts'
import { fakeOpencli, posix, withCommands } from './cli-helpers.ts'

const ITEM = { url: 'https://s.weibo.com/1', title: 'hit', snippet: 's' }
const page = (state: SearchPageState, over: Partial<SearchPageResult> = {}): SearchPageResult => ({ state, items: state === 'ok' ? [ITEM] : [], tookMs: 5, ...over })
const catchErr = (res: SearchPageResult, ctx: Partial<Parameters<typeof sourcesOfSearchPage>[1]> = {}): any => {
  try { sourcesOfSearchPage(res, { label: '微博', platform: 'weibo', ...ctx }) } catch (error) { return error }
  assert.fail('expected an error for ' + res.state)
}
/** The old combined sentence, which only the `searchResults` fallback may use. */
const OLD_COMBINED = /需要浏览器登录态|登录态.*选择器|微调结果选择器/

test('every state has its own error: code, retryability, the outcome on the error, and the one next step that fits it', () => {
  assert.deepEqual(sourcesOfSearchPage(page('ok'), { label: '微博', platform: 'weibo' }), [ITEM])

  const empty = catchErr(page('empty'))
  assert.deepEqual([empty.code, empty.retryable, empty.outcome], ['ENGINE_EMPTY', false, 'empty'])
  assert.match(empty.message, /^微博 没有结果：搜索页明确提示没有匹配的内容。换一个关键词再试。/)
  assert.doesNotMatch(empty.message, /登录|选择器|cookie/i, 'a clear empty page says nothing about logins')

  const unsure = catchErr(page('empty_unconfirmed', { detail: 'no list and no notice after 12s' }))
  assert.deepEqual([unsure.code, unsure.retryable, unsure.outcome], ['ENGINE_EMPTY', false, 'empty_unconfirmed'])
  assert.match(unsure.message, /无法确认原因（可能是需要登录，也可能是页面改版）（依据：no list and no notice after 12s）：先在浏览器里手动打开同一搜索页/)

  const withProfile = catchErr(page('needs_login', { authProfile: 'weibo-main' }))
  assert.deepEqual([withProfile.code, withProfile.retryable, withProfile.outcome], ['ENGINE_AUTH', false, 'needs_login'])
  assert.match(withProfile.message, /要求登录：使用的 AuthProfile「weibo-main」里保存的登录已经失效。重新运行 node "[^"]*save-login\.mjs"/)
  assert.equal(catchErr(page('needs_login'), { boundProfile: 'bound-one' }).code, 'ENGINE_AUTH', 'the bound profile counts when the result does not name one')

  const noProfile = catchErr(page('needs_login'))
  assert.deepEqual([noProfile.code, noProfile.retryable, noProfile.outcome], ['CLI_NOT_LOGGED_IN', false, 'needs_login'])
  assert.match(noProfile.message, /要求登录，而这次没有绑定任何 AuthProfile。运行 node "[^"]*save-login\.mjs" 登录一次.*browserBindings\.weibo 绑定。（该平台的后端链里有 opencli，它直接使用你日常 Chrome 的登录态/)
  assert.doesNotMatch(catchErr(page('needs_login'), { platform: 'kuaishou', label: '快手' }).message, /opencli/, 'a platform without an opencli site does not mention it')

  for (const state of ['captcha', 'blocked'] as const) {
    const risk = catchErr(page(state, { status: 403 }))
    assert.deepEqual([risk.code, risk.retryable, risk.outcome], ['ENGINE_ERROR', false, state])
    assert.match(risk.message, /这是站点的风控，不是登录或选择器问题/)
    assert.match(risk.message, /不要马上重试/)
  }
  assert.match(catchErr(page('blocked', { status: 403 })).message, /HTTP 403/)

  const rate = catchErr(page('rate_limited'))
  assert.deepEqual([rate.code, rate.retryable, rate.outcome], ['ENGINE_RATE_LIMIT', true, 'rate_limited'])
  for (const [state, code] of [['site_error', 'ENGINE_ERROR'], ['network', 'ENGINE_ERROR'], ['timeout', 'ENGINE_TIMEOUT']] as const) {
    const transient = catchErr(page(state))
    assert.deepEqual([transient.code, transient.retryable, transient.outcome], [code, true, state])
  }

  const drift = catchErr(page('contract_drift'))
  assert.deepEqual([drift.code, drift.retryable, drift.outcome], ['ENGINE_ERROR', false, 'contract_drift'])
  assert.match(drift.message, /页面上有结果列表，但现有选择器一个也没匹配到.*在 \$DSH_HOME\/settings\.yaml 的 platformRules\.weibo 里更新结果选择器/)
  assert.match(catchErr(page('contract_drift'), { custom: true, platform: 'mysite', label: '我的站点' }).message, /更新 customPlatforms\.mysite 里的 item \/ title \/ link 选择器/)

  // A custom platform with its own cookie: a login wall means that cookie is no longer accepted.
  const cookie = catchErr(page('needs_login'), { custom: true, platform: 'mysite', hasCookie: true })
  assert.deepEqual([cookie.code, cookie.outcome], ['ENGINE_AUTH', 'needs_login'])
  assert.match(cookie.message, /customPlatforms\.mysite\.cookie 里的登录已经失效/)
  assert.match(catchErr(page('needs_login'), { custom: true, platform: 'mysite' }).message, /customPlatforms\.mysite\.cookie 填入登录后的 cookie/)

  // The old combined sentence is for the searchResults fallback only: no state of searchPage uses it.
  const all: SearchPageState[] = ['empty', 'empty_unconfirmed', 'needs_login', 'captcha', 'blocked', 'rate_limited', 'site_error', 'network', 'timeout', 'contract_drift']
  for (const state of all) assert.doesNotMatch(catchErr(page(state)).message, OLD_COMBINED, state)
})

interface Calls { searchResults: number; searchPage: { url: string; opts: any }[] }

function harness(extra: Record<string, unknown> = {}, opts: { page?: boolean; verdict?: () => SearchPageResult } = {}) {
  clearProbeCache()
  clearOpencliCache()
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wsp-search-page-'))
  const store = new Store(path.join(dir, 'store.db'))
  const calls: Calls = { searchResults: 0, searchPage: [] }
  const browser: any = {
    ...BROWSER_020, render: async () => ({}), snapshot: async () => ({}), close: async () => {}, opencli: async () => ({ code: 0, stdout: '', stderr: '' }),
    searchResults: async () => { calls.searchResults++; return [] },
    ...opts.page === false ? {} : { searchPage: async (url: string, _spec: unknown, o: unknown) => { calls.searchPage.push({ url, opts: o }); return (opts.verdict ?? (() => page('ok')))() } },
  }
  const config = resolveConfig({ engines: ['ddg'], dbPath: path.join(dir, 'store.db'), enableCliBackends: true, opencliEnabled: true, agentReachEnabled: false, ttlSeconds: 60, ...extra } as never)
  const router = new SearchRouter({ get: () => undefined } as never, config, store, () => config, () => browser, undefined, createBuiltinRegistry())
  const search = (query: string, platform: Record<string, unknown>) => router.search({ query, count: 5, fresh: true, multi: false, signal: undefined, platform: platform as never })
  return { router, calls, search, browser, config, cleanup: () => { router.dispose(); store.close(); fs.rmSync(dir, { recursive: true, force: true }) } }
}

test('a browser with searchPage is asked for the verdict; the rows are the same ones searchResults would give', async () => {
  const h = harness({ platformBackends: { weibo: ['browser-search'] }, browserBindings: { weibo: { authProfile: 'weibo-main' } } })
  try {
    const out = await h.search('rust', { id: 'weibo' })
    assert.equal(out.sources[0]!.url, ITEM.url)
    assert.equal(h.calls.searchResults, 0)
    assert.equal(h.calls.searchPage.length, 1)
    assert.match(h.calls.searchPage[0]!.url, /^https:\/\/s\.weibo\.com\//)
    assert.equal(h.calls.searchPage[0]!.opts.authProfile, 'weibo-main', 'the binding rides along as it does for searchResults')
    assert.equal(h.calls.searchPage[0]!.opts.count, 5)
  } finally { h.cleanup() }
})

test('an older dsh-browser without searchPage: searchResults exactly as before, with the old combined sentence', async () => {
  const h = harness({ platformBackends: { weibo: ['browser-search'] } }, { page: false })
  try {
    const out = await h.search('rust', { id: 'weibo' })
    assert.deepEqual(out.sources, [])
    assert.match(out.fallbackNote!, /^no results: 微博 未取到结果：该平台需要浏览器登录态。运行 node "[^"]*save-login\.mjs".*platformRules\.weibo 微调结果选择器/)
    assert.equal(h.calls.searchResults, 1)
    assert.equal(h.calls.searchPage.length, 0)
  } finally { h.cleanup() }
})

test('the custom platform engine takes the same route: searchPage when it exists, the old message when it does not', async () => {
  const custom = { mysite: { name: '我的站点', url: 'https://my.test/s?q={query}', item: 'li', title: 'a', link: 'a' } }
  const withPage = harness({ customPlatforms: custom }, { verdict: () => page('contract_drift') })
  try {
    await assert.rejects(withPage.search('x', { id: 'mysite' }), (e: any) => /更新 customPlatforms\.mysite 里的 item \/ title \/ link 选择器/.test(e.message) && !OLD_COMBINED.test(e.message))
    assert.equal(withPage.calls.searchResults, 0)
  } finally { withPage.cleanup() }
  const old = harness({ customPlatforms: custom }, { page: false })
  try {
    const out = await old.search('x', { id: 'mysite' })
    assert.match(out.fallbackNote!, /自定义平台 我的站点 未取到结果：检查 url 的 \{query\} 占位、item\/title\/link 选择器，或补充 cookie/)
  } finally { old.cleanup() }
})

test('sources.status shows a login that expired for a bound profile as the last error, with the credential rejected; no cooldown', async () => {
  const h = harness({ platformBackends: { weibo: ['browser-search'] }, browserBindings: { weibo: { authProfile: 'weibo-main' } } }, { verdict: () => page('needs_login', { authProfile: 'weibo-main' }) })
  try {
    await assert.rejects(h.search('rust', { id: 'weibo' }), /AuthProfile「weibo-main」里保存的登录已经失效/)
    const report = (await h.router.providerReport()).find(p => p.route === 'weibo')!
    assert.equal(report.readiness.credential, 'rejected', 'ENGINE_AUTH is what turns the credential to rejected')
    assert.equal(report.readiness.health, 'error')
    assert.match(report.readiness.lastError!, /AuthProfile「weibo-main」里保存的登录已经失效/)
    assert.equal(report.readiness.cooldownUntil, undefined, 'a login does not come back by waiting: no cooldown')
  } finally { h.cleanup() }
})

test('cooldown by state: captcha, blocked, login and drift never cool a platform down; a rate limit, a site error and a timeout do', async () => {
  let verdict: SearchPageResult = page('captcha')
  const h = harness({ platformBackends: { weibo: ['browser-search'] } }, { verdict: () => verdict })
  try {
    const state = async (): Promise<string> => (await h.router.providerStatuses(['weibo'])).get('weibo')!.state
    for (const quiet of ['captcha', 'blocked', 'needs_login', 'contract_drift', 'empty', 'empty_unconfirmed'] as const) {
      verdict = page(quiet)
      await assert.rejects(h.search('x', { id: 'weibo' }).then(r => { if (r.sources.length === 0) throw new Error('empty') }), () => true)
      assert.notEqual(await state(), 'cooldown', quiet)
    }
  } finally { h.cleanup() }
  for (const loud of ['rate_limited', 'site_error', 'timeout', 'network'] as const) {
    verdict = page(loud)
    const again = harness({ platformBackends: { weibo: ['browser-search'] } }, { verdict: () => verdict })
    try {
      await assert.rejects(again.search('x', { id: 'weibo' }))
      assert.equal((await again.router.providerStatuses(['weibo'])).get('weibo')!.state, 'cooldown', loud)
    } finally { again.cleanup() }
  }
})

const NOT_LOGGED_IN = ['ok: false', 'error:', '  code: AUTH_REQUIRED', '  message: Weibo search results are blocked behind a login wall', '  exitCode: 77'].join('\n')
const WEIBO_ROWS = JSON.stringify([{ rank: 1, id: 'N1', title: '露营', author: '甲', time: '3分钟前', url: 'https://weibo.com/1/N1' }])

test('in the default weibo chain: the notes name the outcome of the page leg, and a captcha there does not cool the platform down while opencli can answer', { skip: !posix }, async () => {
  // OpenCLI is not logged in, the search page meets a captcha: one error naming both legs, the captcha by its outcome, and no cooldown.
  await withCommands({ opencli: fakeOpencli({ weibo: { code: 77, stderr: NOT_LOGGED_IN } }) }, async () => {
    const h = harness({}, { verdict: () => page('captcha') })
    try {
      await assert.rejects(h.search('x', { id: 'weibo' }), (e: any) => {
        assert.match(e.message, /opencli: opencli is not logged in.*playwright-weibo \[captcha\]: 微博 弹出了验证码/)
        assert.equal(e.retryable === undefined ? false : e.retryable, false)
        return true
      })
      assert.notEqual((await h.router.providerStatuses(['weibo'])).get('weibo')!.state, 'cooldown', 'neither leg is a transient fault')
      const lastError = (await h.router.providerReport()).find(p => p.route === 'weibo')!.readiness.lastError!
      assert.match(lastError, /\[captcha\]/)
    } finally { h.cleanup() }
  })
  // The user's login in Chrome works: opencli answers and the captcha leg is never asked.
  await withCommands({ opencli: fakeOpencli({ weibo: { stdout: WEIBO_ROWS } }) }, async () => {
    const h = harness({}, { verdict: () => page('captcha') })
    try {
      const out = await h.search('x', { id: 'weibo' })
      assert.equal(out.sources[0]!.url, 'https://weibo.com/1/N1')
      assert.equal(h.calls.searchPage.length, 0)
    } finally { h.cleanup() }
  })
  // opencli passes (zero results), the page leg answers: the pass is named with its reason.
  await withCommands({ opencli: fakeOpencli({ weibo: { code: 1, stderr: ['ok: false', 'error:', '  code: NOT_FOUND', '  message: none', '  exitCode: 1'].join('\n') } }) }, async () => {
    const h = harness({})
    try {
      const out = await h.search('x', { id: 'weibo' })
      assert.equal(out.sources[0]!.url, ITEM.url)
    } finally { h.cleanup() }
  })
})
