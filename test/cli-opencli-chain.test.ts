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
import { resolveChain } from '../src/cli/chain.ts'
import { BROWSER_020 } from './browser-stub.ts'
import { fakeOpencli, posix, withCommands } from './cli-helpers.ts'

const FIXTURES = new URL('./fixtures/cli/', import.meta.url).pathname

const AUTH_REQUIRED = [
  'ok: false', 'error:', '  code: AUTH_REQUIRED', '  message: Zhihu search results are blocked behind a login wall',
  '  help: Please open Chrome or Chromium and log in to https://www.zhihu.com', '  exitCode: 77',
].join('\n')
const HTML_ERROR = [
  'ok: false', 'error:', '  code: UNKNOWN', "  message: 'SyntaxError: Unexpected token ''<'', \"<body clas\"... is not valid JSON'", '  exitCode: 1',
].join('\n')

function harness(extra: Record<string, unknown> = {}) {
  clearProbeCache()
  clearOpencliCache()
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wsp-ochain-'))
  const store = new Store(path.join(dir, 'store.db'))
  const calls = { opencli: [] as string[][] }
  const browser: any = {
    ...BROWSER_020, render: async () => ({}), snapshot: async () => ({}), close: async () => {}, searchResults: async () => [{ url: 'https://zh.test/1', title: 'Browser page hit' }],
    opencli: async (args: string[]) => { calls.opencli.push(args); return { code: 0, stdout: '- url: https://www.reddit.com/r/x/comments/1\n  title: browser reddit hit\n', stderr: '' } },
  }
  const config = resolveConfig({ engines: ['ddg'], dbPath: path.join(dir, 'store.db'), enableCliBackends: true, opencliEnabled: true, agentReachEnabled: true, ttlSeconds: 60, ...extra } as never)
  const router = new SearchRouter({ get: () => undefined } as never, config, store, () => config, () => browser, undefined, createBuiltinRegistry())
  const search = (query: string, platform: string) => router.search({ query, count: 3, fresh: true, multi: false, signal: undefined, platform: { id: platform } as never })
  const deps = (): any => ({ enableCli: true, opencliEnabled: true, agentReachEnabled: true, allowProxyFakeIp: false, skipSeam: false, browser })
  const history = () => store.listQueries({ kind: 'platform' })[0]!
  return { router, store, calls, config, search, deps, history, cleanup: () => { router.dispose(); store.close(); fs.rmSync(dir, { recursive: true, force: true }) } }
}

/** A throwaway HOME: the optional standalone CLIs look for their own saved login there (existence only). */
async function withHome<T>(files: string[], fn: () => Promise<T>): Promise<T> {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'wsp-ochain-home-'))
  for (const file of files) { fs.mkdirSync(path.dirname(path.join(home, file)), { recursive: true }); fs.writeFileSync(path.join(home, file), '{}') }
  const saved = process.env.HOME
  process.env.HOME = home
  try { return await fn() } finally { if (saved === undefined) delete process.env.HOME; else process.env.HOME = saved; fs.rmSync(home, { recursive: true, force: true }) }
}

const ZHIHU_CLI = 'case "$1" in --version) cat \'' + FIXTURES + 'help/zhihu-version.txt\';; search) if [ "$2" = "--help" ]; then cat \'' + FIXTURES + 'help/zhihu-search.txt\'; else cat \'' + FIXTURES + 'constructed-zhihu-search.json\'; fi;; esac'

test('login platforms try the standalone OpenCLI first, then the standalone CLI, then the dsh-browser leg; an explicit platformBackends still wins', () => {
  const h = harness()
  try {
    const ids = (platform: string, config = h.config): string[] => resolveChain(platform, { deps: h.deps(), config }).legs.map(l => l.id)
    assert.deepEqual(ids('xiaohongshu'), ['opencli', 'xhs', 'browser-opencli'])
    assert.deepEqual(ids('reddit'), ['opencli', 'rdt', 'browser-opencli'])
    assert.deepEqual(ids('twitter'), ['opencli', 'twitter', 'browser-opencli'])
    assert.deepEqual(ids('zhihu'), ['opencli', 'zhihu', 'browser-search'])
    const own = resolveConfig({ platformBackends: { twitter: ['twitter', 'browser-opencli'], zhihu: ['browser-search'] } } as never)
    assert.deepEqual(ids('twitter', own), ['twitter', 'browser-opencli'], 'the user\'s order replaces the default as written')
    assert.deepEqual(ids('zhihu', own), ['browser-search'])
    assert.deepEqual(ids('reddit', own), ['opencli', 'rdt', 'browser-opencli'], 'platforms the user did not list keep the new default')
  } finally { h.cleanup() }
})

test('OpenCLI is not logged in: the chain falls through to the standalone CLI that has a saved login, and says why OpenCLI was passed over', { skip: !posix }, async () => {
  await withCommands({ opencli: fakeOpencli({ zhihu: { code: 77, stderr: AUTH_REQUIRED } }), zhihu: ZHIHU_CLI }, async dir => {
    await withHome(['.zhihu-cli/cookies.json'], async () => {
      const h = harness()
      try {
        const out = await h.search('rust', 'zhihu')
        assert.ok(out.sources.length > 0)
        assert.equal(h.history().engine, 'zhihu', 'the second backend answered')
        assert.match(JSON.stringify(h.history().detail), /skipped backends: opencli: opencli is not logged in/)
        assert.equal(fs.readFileSync(path.join(dir, 'argv.log'), 'utf8').trim().split('\n').length, 1, 'OpenCLI was asked exactly once')
      } finally { h.cleanup() }
    })
  })
})

test('every earlier backend failing is reported in order, and the last leg answers: OpenCLI got a web page, rdt is not installed', { skip: !posix }, async () => {
  await withCommands({ opencli: fakeOpencli({ reddit: { code: 1, stderr: HTML_ERROR } }) }, async () => {
    const h = harness()
    try {
      const out = await h.search('rust', 'reddit')
      assert.equal(out.sources[0]!.title, 'browser reddit hit')
      assert.equal(h.history().engine, 'opencli-reddit', 'the dsh-browser leg answered')
      const detail = JSON.stringify(h.history().detail)
      assert.match(detail, /skipped backends: opencli: .*; rdt: the rdt command is not installed/)
    } finally { h.cleanup() }
  })
})

test('no earlier backend can answer and no later one exists: the error names every leg with its reason, in chain order', { skip: !posix }, async () => {
  await withCommands({ opencli: fakeOpencli({ zhihu: { code: 77, stderr: AUTH_REQUIRED } }) }, async () => {
    const h = harness({ platformBackends: { zhihu: ['opencli', 'zhihu'] } })
    try {
      await withHome([], async () => {
        await assert.rejects(h.search('rust', 'zhihu'), (e: any) => /opencli is not logged in.*zhihu: /.test(e.message))
      })
    } finally { h.cleanup() }
  })
})
