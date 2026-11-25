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
import { clearOpencliCache, discoverOpencliSite, parseOpencliList, parseSiteSearchHelp } from '../src/cli/opencli.ts'
import { chainReport } from '../src/cli/chain.ts'
import { withBrowserOpencli, type DepInfo } from '../src/deps.ts'
import { browserOpencliVersion } from '../src/browser-access.ts'
import { BROWSER_020 } from './browser-stub.ts'
import { fakeOpencli, OPENCLI_SILENT_HELP, posix, withCommands } from './cli-helpers.ts'

const FIX = new URL('./fixtures/cli/', import.meta.url)
const read = (name: string): string => fs.readFileSync(new URL(name, FIX), 'utf8')
const FAILURES = JSON.parse(read('constructed-opencli2-failures.json')) as Record<string, { exit: number; line: string } | string>

/** The two generations: what a failure looks like (1.8: YAML on stderr; 2.x: one JSON line on stdout) and what a success prints (bare array; envelope). */
const yaml = (code: string, message: string, exitCode: number): string => ['ok: false', 'error:', '  code: ' + code, '  message: ' + JSON.stringify(message), '  exitCode: ' + exitCode].join('\n')
const ROWS = [{ rank: 1, id: 'N1', title: '露营装备到底怎么选', author: '甲', time: '3分钟前', url: 'https://weibo.com/1/N1' }]
const GENERATIONS = [
  {
    name: 'opencli 1.8.8', version: '1.8.8', generation: 1 as const,
    ok: JSON.stringify(ROWS),
    fail: (code: string, message: string, exit: number) => ({ code: exit, stderr: yaml(code, message, exit) }),
  },
  {
    name: 'opencli 2.0.3', version: '2.0.3', generation: 2 as const,
    ok: JSON.stringify({ ok: true, data: ROWS }),
    fail: (code: string, message: string, exit: number) => ({ code: exit, stdout: JSON.stringify({ ok: false, error: { code, message, exitCode: exit } }) }),
  },
]

function harness(extra: Record<string, unknown> = {}) {
  clearProbeCache()
  clearOpencliCache()
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wsp-ogen-'))
  const store = new Store(path.join(dir, 'store.db'))
  const browser: any = {
    ...BROWSER_020, render: async () => ({}), snapshot: async () => ({}), close: async () => {}, opencli: async () => ({ code: 0, stdout: '', stderr: '' }),
    searchResults: async () => [{ url: 'https://zh.test/1', title: 'Browser page hit' }],
  }
  const config = resolveConfig({ engines: ['ddg'], dbPath: path.join(dir, 'store.db'), enableCliBackends: true, opencliEnabled: true, agentReachEnabled: false, ttlSeconds: 60, ...extra } as never)
  const router = new SearchRouter({ get: () => undefined } as never, config, store, () => config, () => browser, undefined, createBuiltinRegistry())
  const search = (query: string, platform: string) => router.search({ query, count: 3, fresh: true, multi: false, signal: undefined, platform: { id: platform } as never })
  const deps = (): any => ({ enableCli: true, opencliEnabled: true, agentReachEnabled: false, allowProxyFakeIp: false, skipSeam: false, browser })
  const history = () => store.listQueries({ kind: 'platform' })[0]!
  return { router, config, search, deps, history, cleanup: () => { router.dispose(); store.close(); fs.rmSync(dir, { recursive: true, force: true }) } }
}

test('the JSON help of one site reads the same on 1.8.8 and 2.0.3 (real captures): read access, a positional query, limit, the three silent options, domain', () => {
  for (const site of ['zhihu', 'weibo', 'tieba', 'douyin', 'xiaohongshu', 'reddit', 'twitter', 'weixin']) {
    const old = parseSiteSearchHelp(read('help/opencli1-' + site + '-search.json'), site)
    const modern = parseSiteSearchHelp(read('help/opencli2-' + site + '-search.json'), site)
    assert.ok(old.entry, site + ' on 1.8.8: ' + old.problem)
    assert.deepEqual(modern.entry?.hasLimit, true, site)
    assert.equal(old.entry!.silent, true, site)
    assert.equal(modern.entry!.silent, true, site)
    assert.equal(old.entry!.browser, true)
    assert.equal(old.entry!.strategy, site === 'weixin' ? 'public' : 'cookie', 'the help carries no strategy: a small static table of public sites')
    assert.deepEqual({ ...modern.entry, domain: undefined }, { ...old.entry, domain: undefined }, site + ': the same entry on both generations')
  }
  assert.equal(parseSiteSearchHelp(read('help/opencli2-weibo-search.json'), 'weibo').entry!.domain, 'weibo.com')
})

test('a site without a search command prints a site overview, an unknown site a failure: both are unsupported with a clear reason; help that is not JSON is flagged for the fallback', () => {
  for (const gen of ['1', '2']) {
    const v2ex = parseSiteSearchHelp(read('help/opencli' + gen + '-v2ex-search.json'), 'v2ex')
    assert.equal(v2ex.unsupported, true, gen)
    assert.match(v2ex.problem!, /opencli has no usable `search` command for the site v2ex \(the site lists no search command\)/)
  }
  const unknown = parseSiteSearchHelp(read('live-opencli2-unknown-command.json'), 'nosuchsite')
  assert.equal(unknown.unsupported, true)
  assert.match(unknown.problem!, /Unknown command: nosuchsite/)
  assert.deepEqual(parseSiteSearchHelp('Usage: opencli weibo search <keyword> [options]\n  --window <mode>', 'weibo'), { notJson: true })
  assert.deepEqual(parseSiteSearchHelp('', 'weibo'), { notJson: true })
  // A write command is never taken for a search.
  assert.match(parseSiteSearchHelp(JSON.stringify({ access: 'write', positionals: [{ positional: true }] }), 'x').problem!, /`write`, not a read command/)
  assert.match(parseSiteSearchHelp(JSON.stringify({ access: 'read', positionals: [] }), 'x').problem!, /takes no positional query/)
})

test('parseOpencliList reads the 2.x paged object without error and says nothing about sites (it has no argument details); the 1.8 array still works', () => {
  assert.equal(parseOpencliList(read('live-opencli2-list-page.json')).size, 0, 'a 2.x list page cannot show a positional query: discovery by the JSON help is what works there')
  assert.ok(parseOpencliList(read('opencli-list.json')).has('douyin'))
})

for (const g of GENERATIONS) {
  test(g.name + ': discovery, search ok, empty, not logged in, missing search command through the whole chain', { skip: !posix }, async () => {
    const f = (name: string) => FAILURES[name] as { exit: number; line: string }
    const sites = {
      weibo: { stdout: g.ok },
      tieba: g.generation === 1 ? { code: 66, stderr: yaml('EMPTY_RESULT', 'tieba search returned no data', 66) } : { code: f('EMPTY_RESULT').exit, stdout: f('EMPTY_RESULT').line },
      douyin: g.generation === 1 ? { code: 77, stderr: yaml('AUTH_REQUIRED', 'Not logged in to www.douyin.com', 77) } : { code: f('AUTH_REQUIRED').exit, stdout: f('AUTH_REQUIRED').line },
      v2ex: { overview: true },
    }
    await withCommands({ opencli: fakeOpencli(sites, { version: g.version, generation: g.generation }) }, async dir => {
      const h = harness()
      try {
        // Discovery: weibo is usable (limit, silent options, domain), v2ex has no search command, an unlisted site is unknown.
        const weibo = await discoverOpencliSite('weibo', { version: g.version })
        assert.deepEqual([weibo.entry?.hasLimit, weibo.entry?.silent, weibo.entry?.domain, weibo.entry?.strategy], [true, true, 'weibo.com', 'cookie'])
        const v2ex = await discoverOpencliSite('v2ex', { version: g.version })
        assert.equal(v2ex.unsupported, true)
        assert.match(v2ex.problem!, /no usable `search` command for the site v2ex/)
        assert.equal((await discoverOpencliSite('facebook', { version: g.version })).unsupported, true, 'an unknown site is unsupported, not an error')

        // search ok: the silent options come from the JSON help.
        const ok = await h.search('露营', 'weibo')
        assert.equal(ok.sources[0]!.url, 'https://weibo.com/1/N1')
        assert.equal(h.history().engine, 'opencli')
        assert.equal(fs.readFileSync(path.join(dir, 'argv.log'), 'utf8').trim().split('\n')[0], 'weibo search 露营 --limit 3 -f json --window background --site-session ephemeral --keep-tab false')

        // empty: opencli passes, the search page answers, and the pass is named.
        const empty = await h.search('露营', 'tieba')
        assert.equal(empty.sources[0]!.title, 'Browser page hit')
        assert.match(JSON.stringify(h.history().detail), /skipped backends: opencli: opencli returned no results/)

        // not logged in
        await h.search('露营', 'douyin')
        assert.match(JSON.stringify(h.history().detail), /opencli: opencli is not logged in/)

      } finally { h.cleanup() }
    })
  })
}

test('whole-chain failures on both generations name what happened, in the chain notes', { skip: !posix }, async () => {
  for (const g of GENERATIONS) {
    const fail = g.fail
    const cases: [string, ReturnType<typeof fail>, RegExp][] = [
      ['douyin', fail('SECURITY_BLOCK', 'Reddit blocked the request: this is not an expired login', 1), /opencli: the site blocked the request \(SECURITY_BLOCK: Reddit blocked the request: this is not an expired login\); this is risk control, not an expired login/],
      ['tieba', fail('SESSION_BUSY', 'Another command holds the tieba session', 75), /opencli is busy: another opencli process holds the browser session.*not a login problem/],
      ['weibo', fail(g.generation === 1 ? 'ARGUMENT' : 'commander.missingArgument', 'bad', 2), /opencli rejected the command arguments of this adapter/],
      ['zhihu', fail('LOGIN_WALL', 'Server returned HTML', 77), /the site returned a web page instead of data, or blocked the request.*LOGIN_WALL/],
    ]
    for (const [site, failure, pattern] of cases) {
      await withCommands({ opencli: fakeOpencli({ [site]: failure }, { version: g.version, generation: g.generation }) }, async () => {
        const h = harness({ platformBackends: { [site]: ['opencli', 'browser-search'] } })
        try {
          await h.search('x', site)
          assert.match(JSON.stringify(h.history().detail), pattern, g.name + ' ' + site)
        } finally { h.cleanup() }
      })
    }
  }
})

test('a 2.x failure line on stdout with exit code ZERO is still a failure; the success envelope and a null data are handled; usage errors are a contract mismatch, not a retry', { skip: !posix }, async () => {
  const wall = (FAILURES.AUTH_REQUIRED as { line: string }).line
  const nothing = FAILURES.successNull as string
  await withCommands({ opencli: fakeOpencli({ weibo: { code: 0, stdout: wall }, tieba: { code: 0, stdout: nothing }, douyin: { code: 0, stdout: FAILURES.success as string } }, { version: '2.0.3' }) }, async () => {
    const h = harness()
    try {
      await h.search('x', 'weibo')
      assert.match(JSON.stringify(h.history().detail), /opencli: opencli is not logged in: Not logged in to www\.weibo\.com/, 'exit 0 with an ok:false envelope')
      await h.search('x', 'tieba')
      assert.match(JSON.stringify(h.history().detail), /opencli: opencli returned no results/, '{ok:true,data:null} is empty')
      const ok = await h.search('x', 'douyin')
      assert.equal(ok.sources[0]!.url, 'https://weibo.com/1/N1', 'the success envelope')
    } finally { h.cleanup() }
  })
})

test('older 1.8.x whose help is not JSON: the list table and the text probe are used; a 2.x whose JSON help fails has no list to fall back on and is said so', { skip: !posix }, async () => {
  await withCommands({ opencli: fakeOpencli({ weibo: { stdout: JSON.stringify(ROWS), help: OPENCLI_SILENT_HELP } }, { version: '1.8.1' }) }, async () => {
    const h = harness({ platformBackends: { weibo: ['opencli'] } })
    try {
      const found = await discoverOpencliSite('weibo', { version: '1.8.1' })
      assert.equal(found.entry?.site, 'weibo', found.problem)
      assert.equal(found.entry?.silent, true, 'the silent options come from the text probe on this path')
    } finally { h.cleanup() }
  })
  await withCommands({ opencli: '[ "$1" = "--version" ] && { echo 2.0.3; exit 0; }\n[ "$1" = "list" ] && [ "$2" = "--help" ] && { echo "  -f, --format <fmt>  json, table"; exit 0; }\n[ "$1" = "list" ] && { cat \'' + FIX.pathname + 'live-opencli2-list-page.json\'; exit 0; }\necho "not json"; exit 0' }, async () => {
    const h = harness()
    try {
      const found = await discoverOpencliSite('weibo', { version: '2.0.3' })
      assert.equal(found.entry, undefined)
      assert.match(found.problem!, /no read `search` command for the site weibo \(opencli list\)/)
    } finally { h.cleanup() }
  })
})

test('a site without a search command: the readiness says unsupported with the reason, and the search names it; the leg is not run', { skip: !posix }, async () => {
  for (const g of GENERATIONS) {
    await withCommands({ opencli: fakeOpencli({}, { version: g.version, generation: g.generation }) }, async dir => {
      const h = harness({ platformBackends: { instagram: ['opencli'] } })
      try {
        const report = await chainReport('instagram', { deps: h.deps(), config: h.config })
        assert.equal(report.entries[0]!.id, 'opencli')
        assert.equal(report.entries[0]!.state, 'skipped', g.name)
        assert.match(report.entries[0]!.reason!, /opencli: opencli has no (usable|read) `search` command for the site instagram/)
        await assert.rejects(h.search('x', 'instagram'), /opencli has no (usable|read) `search` command for the site instagram/)
        assert.equal(fs.existsSync(path.join(dir, 'argv.log')), false, 'no search ran')
      } finally { h.cleanup() }
    })
  }
})

test('discovery is cached per (launcher, version, site), shares one run between concurrent calls and bounds the processes', { skip: !posix }, async () => {
  await withCommands({ opencli: fakeOpencli({}) }, async () => {
    clearOpencliCache()
    let calls = 0
    let live = 0
    let peak = 0
    const run = async (_bin: string, args: string[]): Promise<any> => {
      calls++
      live++
      peak = Math.max(peak, live)
      await new Promise(resolve => setTimeout(resolve, 15))
      live--
      return { code: 0, stdout: read('help/opencli2-weibo-search.json'), stderr: '', timedOut: false, truncated: false, spawnFailed: false, args }
    }
    const same = await Promise.all([1, 2, 3, 4].map(() => discoverOpencliSite('weibo', { run, version: '2.0.3' })))
    assert.equal(calls, 1, 'four concurrent asks, one run')
    assert.ok(same.every(r => r === same[0]))
    await discoverOpencliSite('weibo', { run, version: '2.0.3' })
    assert.equal(calls, 1, 'cached')
    await discoverOpencliSite('weibo', { run, version: '2.0.4' })
    assert.equal(calls, 2, 'another version is another key')
    let t = Date.now()
    await discoverOpencliSite('weibo', { run, version: '2.0.3', now: () => t })
    t += 400_000
    await discoverOpencliSite('weibo', { run, version: '2.0.3', now: () => t })
    assert.equal(calls, 3, 'fresh at first, expired after five minutes')
    calls = 0
    await Promise.all(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].map(site => discoverOpencliSite(site, { run, version: '2.0.3' })))
    assert.equal(calls, 8)
    assert.ok(peak <= 3, 'at most three help processes at once, saw ' + peak)
  })
})

test('a help call that did not work (time, start, size) is no verdict on the site: not `unsupported`, not cached, no list fallback', { skip: !posix }, async () => {
  await withCommands({ opencli: fakeOpencli({}) }, async () => {
    for (const broken of [{ timedOut: true }, { spawnFailed: true }, { truncated: true }]) {
      clearOpencliCache()
      const asked: string[][] = []
      let fail = true
      const run = async (_bin: string, args: string[]): Promise<any> => {
        asked.push(args)
        return { code: fail ? -1 : 0, stdout: fail ? '' : read('help/opencli2-weibo-search.json'), stderr: '', timedOut: false, truncated: false, spawnFailed: false, ...fail ? broken : {} }
      }
      const first = await discoverOpencliSite('weibo', { run, version: '2.0.3' })
      assert.equal(first.entry, undefined)
      assert.equal(first.unsupported, undefined)
      assert.match(first.problem!, /opencli weibo search --help (timed out|printed too much|could not be started)/)
      assert.equal(asked.some(args => args[0] === 'list'), false)
      fail = false
      assert.equal((await discoverOpencliSite('weibo', { run, version: '2.0.3' })).entry?.site, 'weibo', 'asked again at once')
    }
  })
})

test('one copy: dsh-browser\'s own OpenCLI version is compared with the one this plugin resolved, and the deps row says both', async () => {
  const row = (over: Partial<DepInfo> = {}): DepInfo => ({ id: 'opencli', label: 'OpenCLI', usedBy: 'x', available: true, version: '2.0.3', path: '/usr/local/bin/opencli', installs: [], ...over })
  const other = { id: 'bili', label: 'bili', usedBy: 'y', available: true, installs: [] } as DepInfo
  const [same] = withBrowserOpencli([row()], '2.0.3')
  assert.equal(same!.diagnostic, undefined, 'equal versions say nothing')
  const [two, untouched] = withBrowserOpencli([row(), other], '1.8.8')
  assert.match(two!.diagnostic!, /two OpenCLI copies: this plugin uses 2\.0\.3 \(\/usr\/local\/bin\/opencli\), dsh-browser uses 1\.8\.8\. A CLI stops the background daemon of another version.*install only one copy \(npm i -g @jackwener\/opencli@2\)/)
  assert.equal(untouched, other)
  assert.equal(withBrowserOpencli([row()], undefined)[0]!.diagnostic, undefined, 'a dsh-browser that does not say: nothing')
  assert.match(withBrowserOpencli([row({ diagnostic: 'old' })], '1.8.8')[0]!.diagnostic!, /^old \| two OpenCLI copies/)
  assert.equal(withBrowserOpencli([row({ version: undefined })], '1.8.8')[0]!.diagnostic, undefined, 'no own version found: nothing to compare')

  // The optional call: absent, failing or garbage never throws.
  assert.equal(await browserOpencliVersion(undefined), undefined)
  assert.equal(await browserOpencliVersion({} as never), undefined)
  assert.equal(await browserOpencliVersion({ status: async () => ({ opencliVersion: '1.8.8' }) } as never), '1.8.8')
  assert.equal(await browserOpencliVersion({ status: async () => { throw new Error('boom') } } as never), undefined)
  assert.equal(await browserOpencliVersion({ status: async () => ({ opencliVersion: 42 }) } as never), undefined)
  assert.equal(await browserOpencliVersion({ status: async () => ({ opencliVersion: 'banana' }) } as never), undefined)
})
