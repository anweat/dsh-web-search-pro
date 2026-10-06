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
import { chainReport, resolveChain } from '../src/cli/chain.ts'
import { platformBackendIssues } from '../src/cli/chains-spec.ts'
import { detectDeps } from '../src/deps.ts'
import { BROWSER_020 } from './browser-stub.ts'
import { baseSpec, posix, withCommands } from './cli-helpers.ts'

const WX_HELP = 'case "$1" in --version) echo "0.1.0";; *) echo "wx-search-cli v0.1.0 search <query> Sogou";; esac'
const wxRows = (rows: object[]): string => WX_HELP.replace(';; esac', ';; esac').replace('*) echo', 'search) printf \'%s\' \'' + JSON.stringify(rows) + '\';; *) echo')
const OMNI_OK_HELP = 'echo "omnireach, version 0.19.0-alpha"'
function omnireach(output: string | undefined): string {
  // --version and `search --help` answer like the real tool; `search QUERY ...` prints the given JSON.
  return 'case "$1" in --version) echo "omnireach, version 0.19.0-alpha";; search) if [ "$2" = "--help" ]; then echo "Usage: omnireach search [OPTIONS] QUERY --on --limit --json"; else ' + (output === undefined ? 'exit 1' : "printf '%s' '" + output + "'") + '; fi;; *) ' + OMNI_OK_HELP + ';; esac'
}
const OMNI_CAPTCHA = JSON.stringify({ query: 'q', ts: 't', results: [], errors: [{ source: 'wechat', error: 'sogou captcha', category: 'failed' }] })

function harness(extra: Record<string, unknown> = {}, opts: { browser?: boolean } = {}) {
  clearProbeCache()
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wsp-chain-'))
  const store = new Store(path.join(dir, 'store.db'))
  const calls = { opencli: [] as string[][], searchResults: 0 }
  const holder: { browser: any } = {
    browser: opts.browser === false ? undefined : {
      ...BROWSER_020, render: async () => ({}), snapshot: async () => ({}), close: async () => {},
      searchResults: async () => { calls.searchResults++; return [{ url: 'https://zh.test/1', title: 'Browser hit' }] },
      opencli: async (args: string[]) => { calls.opencli.push(args); return { code: 0, stdout: '- url: https://www.xiaohongshu.com/n/1\n  title: browser note\n', stderr: '' } },
    },
  }
  const config = resolveConfig({ engines: ['ddg'], dbPath: path.join(dir, 'store.db'), enableCliBackends: true, opencliEnabled: true, agentReachEnabled: true, ttlSeconds: 60, ...extra } as never)
  const router = new SearchRouter({ get: () => undefined } as never, config, store, () => config, () => holder.browser, undefined, createBuiltinRegistry())
  const search = (query: string, platform: string, o: { count?: number } = {}) => router.search({ query, count: o.count ?? 5, fresh: true, multi: false, signal: undefined, platform: { id: platform } as never })
  const deps = (): any => ({ enableCli: true, opencliEnabled: true, agentReachEnabled: true, allowProxyFakeIp: false, skipSeam: false, ...holder.browser ? { browser: holder.browser } : {} })
  return { router, store, calls, holder, config, search, deps, cleanup: () => { router.dispose(); store.close(); fs.rmSync(dir, { recursive: true, force: true }) } }
}

test('chain resolution: default orders, a configured order replaces them, and unknown or foreign backends are reported, not used', () => {
  const h = harness()
  try {
    const ids = (platform: string, config = h.config): string[] => resolveChain(platform, { deps: h.deps(), config }).legs.map(l => l.id)
    assert.deepEqual(ids('xiaohongshu'), ['opencli', 'xhs', 'browser-opencli'])
    assert.deepEqual(ids('reddit'), ['rdt', 'opencli', 'browser-opencli'])
    assert.deepEqual(ids('twitter'), ['twitter', 'opencli', 'browser-opencli'])
    assert.deepEqual(ids('zhihu'), ['zhihu', 'browser-search'])
    assert.deepEqual(ids('bilibili'), ['bili'])
    assert.deepEqual(ids('youtube'), ['yt-dlp'])
    assert.deepEqual(ids('github'), ['rest', 'gh'])
    assert.deepEqual(ids('github-code'), ['rest', 'gh'])
    assert.deepEqual(ids('wechat'), ['omnireach', 'wx-search-cli'])
    assert.deepEqual(ids('omnireach'), ['omnireach'])
    const reordered = resolveConfig({ platformBackends: { xiaohongshu: ['xhs', 'browser-opencli'] } } as never)
    assert.deepEqual(ids('xiaohongshu', reordered), ['xhs', 'browser-opencli'])
    assert.deepEqual(ids('reddit', reordered), ['rdt', 'opencli', 'browser-opencli'], 'platforms not listed keep their default')
    const bad = resolveConfig({ platformBackends: { xiaohongshu: ['nope', 'rdt', 'browser-search', 'xhs'] } } as never)
    const resolved = resolveChain('xiaohongshu', { deps: h.deps(), config: bad })
    assert.deepEqual(resolved.legs.map(l => l.id), ['xhs'])
    assert.equal(resolved.diagnostics.length, 3)
    assert.match(resolved.diagnostics.join('\n'), /"nope" is not a known backend/)
    assert.match(resolved.diagnostics.join('\n'), /"rdt" does not serve platform xiaohongshu \(it serves reddit\)/)
    assert.match(resolved.diagnostics.join('\n'), /"browser-search" does not serve platform xiaohongshu/)
    assert.deepEqual(platformBackendIssues({ xiaohongshu: ['xhs'], nowhere: ['xhs'], reddit: ['custom-cli:ghost'] }, undefined).map(m => m.replace(/ \(known:.*\)/, '')), [
      'platformBackends.nowhere: no such platform with a backend chain',
      'platformBackends.reddit: "custom-cli:ghost" is not a known backend (built-in ids: bili, yt-dlp, twitter, xhs, zhihu, rdt, omnireach, gh, wx-search-cli, tanso, opencli, browser-opencli, browser-search, rest)',
    ])
  } finally { h.cleanup() }
})

test('a backend that is missing is skipped with the reason and the next one answers; the leg that answered is named', { skip: !posix }, async () => {
  const rows = [{ title: '人工智能周报', link: 'https://weixin.sogou.com/link?x', real_url: 'https://mp.weixin.qq.com/s?a=1', publish_time: '2026-09-30', page: '1' }]
  await withCommands({ 'wx-search-cli': wxRows(rows) }, async () => {
    const h = harness()
    try {
      // omnireach is not installed: the wechat chain falls through to wx-search-cli.
      const out = await h.search('人工智能', 'wechat')
      assert.equal(out.engine, 'wechat')
      assert.equal(out.sources[0]!.url, 'https://mp.weixin.qq.com/s?a=1')
      assert.equal(h.store.listQueries({ kind: 'platform' })[0]!.engine, 'wx-search-cli', 'history names the leg')
      const report = await chainReport('wechat', { deps: h.deps(), config: h.config })
      assert.deepEqual(report.entries.map(e => [e.id, e.state, e.installation, e.verification]), [['omnireach', 'skipped', 'missing', 'live'], ['wx-search-cli', 'ready', 'detected', 'docs-only']])
      assert.match(report.entries[0]!.reason!, /omnireach: omnireach not found on PATH.*omnireach/)
      assert.equal(report.available, true)
      assert.equal(report.installation, 'detected')
    } finally { h.cleanup() }
  })
})

test('an empty or failing first backend falls through; the first one that answers ends the chain', { skip: !posix }, async () => {
  const rows = [{ title: 'fallback hit', link: 'l', real_url: 'https://mp.weixin.qq.com/s?b=2', publish_time: '', page: '1' }]
  await withCommands({ omnireach: omnireach(OMNI_CAPTCHA), 'wx-search-cli': wxRows(rows) }, async () => {
    const h = harness()
    try {
      const out = await h.search('q', 'wechat')
      assert.equal(out.sources[0]!.title, 'fallback hit', 'omnireach reported a captcha, wx-search-cli answered')
    } finally { h.cleanup() }
  })
  const good = JSON.stringify({ query: 'q', ts: 't', errors: [], results: [{ source: 'wechat', adapter: 'sogou', title: '来自 omnireach', url: 'https://mp.weixin.qq.com/s?c=3', content: '摘要', ts: '2026-10-01T00:00:00Z' }] })
  await withCommands({ omnireach: omnireach(good), 'wx-search-cli': wxRows(rows) }, async dir => {
    const h = harness()
    try {
      const out = await h.search('q', 'wechat')
      assert.equal(out.sources[0]!.title, '来自 omnireach')
      assert.equal(h.store.listQueries({ kind: 'platform' })[0]!.engine, 'omnireach')
      assert.equal(fs.existsSync(path.join(dir, 'ran')), false)
    } finally { h.cleanup() }
  })
})

test('a backend that is not logged in is skipped without being run; the dsh-browser leg answers; nothing is run that could read cookies', { skip: !posix }, async () => {
  await withCommands({ xhs: 'echo ran > "$0.ran"; case "$1" in --version) echo "xhs, version 0.6.4";; search) echo "Usage: xhs search KEYWORD --json --sort";; esac' }, async dir => {
    const h = harness({ platformBackends: { xiaohongshu: ['xhs', 'browser-opencli'] } })
    try {
      const home = process.env.HOME
      process.env.HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'wsp-nohome-'))
      try {
        const report = await chainReport('xiaohongshu', { deps: h.deps(), config: h.config })
        assert.deepEqual(report.entries.map(e => [e.id, e.state]), [['xhs', 'skipped'], ['browser-opencli', 'ready']])
        assert.match(report.entries[0]!.reason!, /xhs: no saved login \(run `xhs login` yourself\)/)
        assert.equal(report.entries[0]!.installation, 'detected')
        assert.equal(report.entries[0]!.credential, 'missing')
        fs.rmSync(path.join(dir, 'xhs.ran'), { force: true })
        const out = await h.search('露营', 'xiaohongshu')
        assert.equal(out.sources[0]!.title, 'browser note')
        assert.equal(h.calls.opencli.length, 1)
        assert.equal(h.store.listQueries({ kind: 'platform' })[0]!.engine, 'opencli-xiaohongshu')
        assert.equal(fs.existsSync(path.join(dir, 'xhs.ran')), false, 'xhs was only help-probed, never asked to search')
      } finally { fs.rmSync(process.env.HOME!, { recursive: true, force: true }); if (home === undefined) delete process.env.HOME; else process.env.HOME = home }
    } finally { h.cleanup() }
  })
})

test('the whole chain unavailable: one error that names every backend with what to install or run; never cools down', { skip: !posix }, async () => {
  const h = harness({}, { browser: false })
  try {
    await assert.rejects(h.search('x', 'reddit'), (e: any) => /platform reddit unavailable/.test(e.message) && /rdt: rdt not found on PATH.*rdt-cli/.test(e.message) && /opencli: opencli not found on PATH/.test(e.message) && /browser-opencli: platform reddit requires the optional dsh-browser plugin/.test(e.message))
    const status = await h.router.providerStatuses(['reddit'])
    assert.equal(status.get('reddit')!.state, 'unavailable', 'a probe failure is not a cooldown')
    assert.equal(h.store.listQueries({ kind: 'platform' }).length, 0)
  } finally { h.cleanup() }
})

test('a same-named program with another contract is incompatible: reported, never run', { skip: !posix }, async () => {
  await withCommands({ bili: 'echo ran > "$0.ran"; case "$1" in --version) echo "bili, version 0.6.2";; *) echo "Usage: bili URL --download";; esac' }, async dir => {
    const h = harness()
    try {
      await assert.rejects(h.search('x', 'bilibili'), /bili: bili search contract missing --type, --max, --json/)
      const report = await chainReport('bilibili', { deps: h.deps(), config: h.config })
      assert.deepEqual([report.available, report.installation, report.entries[0]!.installation], [false, 'incompatible', 'incompatible'])
      const dep = (await detectDeps()).find(d => d.id === 'bili')!
      assert.deepEqual([dep.available, dep.installation, dep.version], [false, 'incompatible', '0.6.2'])
      assert.match(dep.diagnostic!, /contract missing/)
      assert.equal(fs.readFileSync(path.join(dir, 'bili.ran'), 'utf8').trim(), 'ran', 'only the version / help probes ran')
    } finally { h.cleanup() }
  })
})

test('detectDeps reports every adapter CLI: missing, detected with its version, incompatible; user adapters included; verification shown', { skip: !posix }, async () => {
  clearProbeCache()
  await withCommands({
    gh: 'case "$1" in --version) echo "gh version 2.101.0 (2026-09-15)";; search) echo "--json --limit stargazersCount";; esac',
    rdt: 'case "$1" in --version) echo "rdt, version 0.4.2";; *) echo "something else";; esac',
    'demo-cli': 'case "$1" in --version) echo "1.0.0";; search) echo "--json";; esac',
  }, async () => {
    const deps = await detectDeps({ config: resolveConfig({ cliAdapters: { demo: { ...baseSpec(), id: 'demo' } } } as never), force: true })
    const byId = new Map(deps.map(d => [d.id, d]))
    assert.deepEqual([...byId.keys()].slice(0, 5), ['bili', 'yt-dlp', 'twitter', 'agent-reach', 'mcporter'], 'the plugin\'s historical order is kept')
    for (const id of ['xhs', 'zhihu', 'rdt', 'omnireach', 'gh', 'wx-search-cli', 'tanso', 'opencli', 'custom-cli:demo']) assert.ok(byId.has(id), id)
    assert.deepEqual([byId.get('gh')!.installation, byId.get('gh')!.version, byId.get('gh')!.available, byId.get('gh')!.verification], ['detected', '2.101.0', true, 'live'])
    assert.deepEqual([byId.get('rdt')!.installation, byId.get('rdt')!.available], ['incompatible', false])
    assert.deepEqual([byId.get('xhs')!.installation, byId.get('xhs')!.available], ['missing', false])
    assert.deepEqual([byId.get('tanso')!.verification, byId.get('wx-search-cli')!.verification, byId.get('xhs')!.verification], ['docs-only', 'docs-only', 'contract-only'])
    assert.equal(byId.get('custom-cli:demo')!.available, true)
    assert.equal(byId.get('custom-cli:demo')!.verification, undefined, 'user adapters carry no verification')
    assert.ok(byId.get('xhs')!.installs.some(i => i.command === 'uv tool install xiaohongshu-cli'))
    assert.ok(byId.get('gh')!.installs.some(i => i.installer === 'brew'))
  })
})

test('user-defined adapters: valid ones become custom-cli:<id> platforms and backends, invalid ones are ignored with a diagnostic', { skip: !posix }, async () => {
  const out = JSON.stringify({ data: [{ url: 'https://example.com/a', title: 'From my CLI', summary: 'mine' }] })
  await withCommands({ 'demo-cli': 'case "$1" in --version) echo "demo-cli 1.0";; search) if [ "$2" = "--help" ]; then echo "--json"; else printf \'%s\' \'' + out + '\'; fi;; esac' }, async () => {
    const h = harness({
      cliAdapters: {
        demo: { ...baseSpec(), id: 'demo' },
        evil: { ...baseSpec(), id: 'evil', allowedSubcommands: ['search', 'login'], search: { ...baseSpec().search, argv: ['login', '{query}'] } },
        cookies: { ...baseSpec(), id: 'cookies', search: { ...baseSpec().search, argv: ['search', '{query}', '--cookie-source', 'chrome'] } },
        secret: { ...baseSpec(), id: 'secret', env: { set: { API_TOKEN: 'abc' } } },
      },
      platformBackends: { twitter: ['custom-cli:demo'], reddit: ['custom-cli:ghost'] },
    })
    try {
      const direct = await h.search('rust', 'custom-cli:demo')
      assert.equal(direct.engine, 'custom-cli:demo')
      assert.equal(direct.sources[0]!.title, 'From my CLI')
      assert.equal(h.store.listQueries({ kind: 'platform' })[0]!.engine, 'custom-cli:demo')
      // The same adapter as a backend of another platform.
      assert.equal((await h.search('rust', 'twitter')).sources[0]!.title, 'From my CLI')
      const problems = h.router.cliAdapterProblems()
      assert.ok(problems.some(p => /cliAdapters\.evil ignored.*write \/ login command/.test(p)), problems.join('\n'))
      assert.ok(problems.some(p => /cliAdapters\.cookies ignored.*--cookie-source/.test(p)))
      assert.ok(problems.some(p => /cliAdapters\.secret ignored.*must not set credentials/.test(p)))
      assert.ok(problems.some(p => /platformBackends\.reddit: "custom-cli:ghost" is not a known backend/.test(p)))
      assert.equal(h.router.registry.resolve('custom-cli:evil'), undefined)
      // Editing the setting reaches the registry: the adapter goes away with its entry.
      h.config.cliAdapters = {}
      h.router.cliAdapterProblems()
      assert.equal(h.router.registry.resolve('custom-cli:demo'), undefined)
    } finally { h.cleanup() }
  })
})

test('sources.status carries the chain of each platform and the adapter diagnostics (providers[].chain, notes)', { skip: !posix }, async () => {
  await withCommands({}, async () => {
    const h = harness({ cliAdapters: { bad: { id: 'bad' } } }, { browser: false })
    try {
      const report = await h.router.providerReport()
      const xhs = report.find(p => p.route === 'xiaohongshu')!
      assert.deepEqual(xhs.chain!.map(e => [e.order, e.id, e.kind, e.state]), [[1, 'opencli', 'opencli', 'skipped'], [2, 'xhs', 'cli', 'skipped'], [3, 'browser-opencli', 'browser-opencli', 'skipped']])
      assert.equal(xhs.readiness.available, false)
      assert.match(xhs.readiness.reason!, /^no usable backend: opencli: opencli not found on PATH.*; xhs: xhs not found on PATH.*; browser-opencli: platform xiaohongshu requires/)
      assert.equal(report.find(p => p.route === 'ddg')!.chain, undefined, 'web engines have no chain')
      assert.ok(h.router.cliAdapterProblems().some(p => /cliAdapters\.bad ignored/.test(p)))
    } finally { h.cleanup() }
  })
})
