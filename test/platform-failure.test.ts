import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { registerHooks } from 'node:module'
import { resolveConfig } from '../src/config.ts'
import { createBuiltinRegistry } from '../src/providers/index.ts'
import { SearchRouter } from '../src/router.ts'
import { Store } from '../src/store.ts'
import { EngineError } from '../src/engine-error.ts'
import { CliAdapterError } from '../src/cli/runner.ts'
import { chainEngine } from '../src/providers/platforms.ts'
import { PlatformFailedError } from '../src/providers/unavailable.ts'
import { mapError } from '../src/actions/errors.ts'
import { SAVE_LOGIN_COMMAND, SAVE_LOGIN_SCRIPT } from '../src/login-script.ts'
import { BROWSER_020 } from './browser-stub.ts'

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === '@deepseek-ai/dsh-tools') return { url: 'data:text/javascript,export const defineTool = value => value', shortCircuit: true }
    return nextResolve(specifier, context)
  },
})
const { EvidenceService } = await import('../src/pipeline/service.ts')

const HINT = '在你的 Chrome 里登录 www.zhihu.com 后重试（opencli 使用 Chrome 的登录态）'
const count = (text: string, part: string): number => text.split(part).length - 1
const PAGE = 'Rust async runtimes compared by people who ran them in production.\n\nTokio is the most widely used runtime: multi-threaded work stealing, mature ecosystem, and the default choice for network services.'
const TASK = { query: 'rust async runtime tokio smol', task: 'compare Rust async runtimes tokio and smol from real experience', profile: 'experience' as const, count: 5 }

function harness(zhihu: () => Promise<unknown>, web: () => Promise<unknown> = async () => ({ sources: [{ url: 'https://web.test/rust', title: 'Rust async runtimes tokio smol', snippet: 'tokio and smol runtime comparison' }] })) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wsp-platform-failure-'))
  const counts = { zhihu: 0, web: 0 }
  const browser: any = { ...BROWSER_020, render: async () => ({}), snapshot: async () => ({}), close: async () => {}, opencli: async () => ({ code: 0, stdout: '', stderr: '' }), searchResults: async () => [] }
  const config = resolveConfig({ engines: ['ddg'], dbPath: path.join(dir, 'store.db'), enableCliBackends: true, opencliEnabled: true, agentReachEnabled: false, ttlSeconds: 60, timeoutMs: 5_000, playwright: { enabled: true, snapshotDir: path.join(dir, 'shots') } } as never)
  const store = new Store(config.dbPath)
  const router = new SearchRouter({ get: () => undefined } as never, config, store, () => config, () => browser, undefined, createBuiltinRegistry())
  const entries = (router as any).backends.entries as Map<string, any>
  // No real source may run: the experience profile would also plan hackernews, v2ex, ...
  for (const id of [...entries.keys()]) entries.set(id, { id, probe: async () => ({ available: false, reason: 'stubbed out' }), run: async () => { throw new Error('a real backend ran: ' + id) } })
  entries.set('zhihu', { id: 'zhihu', probe: async () => ({ available: true }), run: async () => { counts.zhihu++; return zhihu() } })
  entries.set('ddg', { id: 'ddg', probe: async () => ({ available: true }), run: async () => { counts.web++; return web() } })
  const fetchSvc = { fetchPage: async (url: string) => ({ url, title: 'Page', text: PAGE, source: 'http', shellPage: false }) }
  const service = new EvidenceService({ router, fetch: fetchSvc as never, store, dynamic: () => config })
  return { router, service, counts, cleanup: () => { store.close(); fs.rmSync(dir, { recursive: true, force: true }) } }
}

const notLoggedIn = async (): Promise<never> => { throw new CliAdapterError('opencli is not logged in: login wall', 'CLI_NOT_LOGGED_IN', HINT) }
const plainSearch = (h: ReturnType<typeof harness>) => h.router.search({ query: 'q', count: 3, fresh: true, multi: false, signal: undefined, platform: { id: 'zhihu' } as never })

test('the login hint of a platform failure reaches the plain platform error exactly once, as a typed error', async () => {
  const h = harness(notLoggedIn)
  try {
    const error = await plainSearch(h).then(() => undefined, (e: unknown) => e) as Error
    assert.ok(error instanceof PlatformFailedError)
    assert.match(error.message, /^platform zhihu unavailable \(tried: zhihu\): .*opencli is not logged in/)
    assert.equal(count(error.message, HINT), 1)
    const body = mapError(error)
    assert.equal(body.code, 'ACTION_FAILED')
    assert.match(body.hint!, /Do not repeat the same platform search in this turn/)
    assert.match(body.hint!, /allowFallback=true/)
  } finally { h.cleanup() }
})

test('the login hint reaches the evidence failure exactly once and the error is typed', async () => {
  const h = harness(notLoggedIn)
  try {
    const error = await h.service.search({ ...TASK, platform: { id: 'zhihu' } }).then(() => undefined, (e: unknown) => e) as Error
    assert.ok(error instanceof PlatformFailedError)
    assert.match(error.message, /^all providers failed: zhihu: .*opencli is not logged in/)
    assert.equal(count(error.message, HINT), 1)
    assert.equal(mapError(error).code, 'ACTION_FAILED')
    assert.equal(h.counts.web, 0, 'no fallback without allowFallback')
  } finally { h.cleanup() }
})

test('chainEngine puts a leg error\'s hint into its note once, also when several legs failed', async () => {
  const leg = (id: string, error: Error) => ({ id, label: id, available: () => true, search: async () => { throw error } }) as never
  const chain = chainEngine('zhihu', 'Zhihu', [leg('opencli', new CliAdapterError('opencli is not logged in', 'CLI_NOT_LOGGED_IN', HINT)), leg('browser-search', new EngineError('page blocked', 'ENGINE_ERROR', false))])
  const error = await chain.search('q', 3, undefined as never).then(() => undefined, (e: unknown) => e) as Error
  assert.equal(count(error.message, HINT), 1)
  assert.match(error.message, /browser-search: page blocked/)
})

test('allowFallback covers a platform that ran and failed: the web engines answer and the pack carries the platform failure', async () => {
  const h = harness(notLoggedIn)
  try {
    const out = await h.service.search({ ...TASK, platform: { id: 'zhihu' }, allowFallback: true })
    assert.equal(h.counts.zhihu, 1)
    assert.ok(h.counts.web >= 1)
    assert.ok(out.enginesTried.includes('ddg') && !out.enginesTried.includes('zhihu'))
    const notes = out.notes.join('\n')
    assert.match(notes, /all providers failed: zhihu: .*opencli is not logged in/)
    assert.equal(count(notes, HINT), 1)
    assert.match(notes, /the platform ran and failed, the profile's web engines were searched instead/)
  } finally { h.cleanup() }
})

test('the fallback plan does not ask the platform that just failed again (v2ex is in the experience profile)', async () => {
  const h = harness(notLoggedIn)
  let calls = 0
  ;((h.router as any).backends.entries as Map<string, any>).set('v2ex', { id: 'v2ex', probe: async () => ({ available: true }), run: async () => { calls++; return notLoggedIn() } })
  try {
    const out = await h.service.search({ ...TASK, platform: { id: 'v2ex' }, allowFallback: true }).catch((e: unknown) => e) as { notes?: string[] }
    assert.equal(calls, 1)
    assert.match((out.notes ?? []).join('\n'), /the platform ran and failed/)
  } finally { h.cleanup() }
})

test('when the web engines fail too the error holds both failures', async () => {
  const h = harness(notLoggedIn, async () => { throw new EngineError('HTTP 503', 'ENGINE_ERROR', false) })
  try {
    const error = await h.service.search({ ...TASK, platform: { id: 'zhihu' }, allowFallback: true }).then(() => undefined, (e: unknown) => e) as Error
    assert.ok(error instanceof PlatformFailedError)
    assert.match(error.message, /opencli is not logged in/)
    assert.match(error.message, /web engines searched instead failed too: .*HTTP 503/)
  } finally { h.cleanup() }
})

test('an empty platform answer is not a failure: no fallback', async () => {
  const h = harness(async () => { throw new EngineError('no results', 'ENGINE_EMPTY', false) })
  try {
    const out = await h.service.search({ ...TASK, platform: { id: 'zhihu' }, allowFallback: true })
    assert.equal(h.counts.web, 0)
    assert.deepEqual(out.enginesTried, ['zhihu'])
  } finally { h.cleanup() }
})

test('no time left after the platform failure: the original error, no second run', async () => {
  const h = harness(notLoggedIn)
  try {
    const error = await h.service.search({ ...TASK, platform: { id: 'zhihu' }, allowFallback: true, deadlineMs: 500 }).then(() => undefined, (e: unknown) => e) as Error
    assert.ok(error instanceof PlatformFailedError)
    assert.match(error.message, /^all providers failed: zhihu:/)
    assert.equal(h.counts.web, 0)
  } finally { h.cleanup() }
})

test('the save-login command is the absolute, quoted path of a script that exists', () => {
  assert.ok(path.isAbsolute(SAVE_LOGIN_SCRIPT))
  assert.ok(fs.existsSync(SAVE_LOGIN_SCRIPT), SAVE_LOGIN_SCRIPT)
  assert.equal(SAVE_LOGIN_COMMAND, 'node "' + SAVE_LOGIN_SCRIPT + '"')
})
