/**
 * Live regression of the key-less, login-free CLI adapters (dev-plan M12, run 2026-10-26).
 *
 * Offline (default): the captured outputs in test/fixtures/cli/live-* are parsed with the built-in specs and the results are
 * checked for the defects that the live runs found (field-name rows, placeholder text, wrong counts).
 * Live (WSP_LIVE_CLI=1): the real tools are run through the plugin's own probe and runner - real network, real tool versions -
 * and the same shape checks are applied to whatever comes back. Run it with `pnpm run test:live-cli`. Only read-only searches
 * of tools that need no login of their own (gh needs the user's own gh login for any call) are run; xhs, zhihu, rdt, twitter and
 * opencli are never run here (scripts/cli-login-check.mjs is for those, run by the user).
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { WebSearchSource } from '@deepseek-ai/dsh-web'
import { builtinSpecById } from '../src/cli/builtin-specs.ts'
import { findOnPath, probeCli } from '../src/cli/probe.ts'
import { parseCliOutput, runCliSearchDetailed, CliAdapterError } from '../src/cli/runner.ts'
import { searchSpecFor, type CliAdapterSpec } from '../src/cli/spec.ts'
import { exaEngine, parseMcporterExaSearch } from '../src/engines.ts'
import { resolveConfig } from '../src/config.ts'
import { createBuiltinRegistry } from '../src/providers/index.ts'
import { SearchRouter } from '../src/router.ts'
import { Store } from '../src/store.ts'
import { clearProbeCache } from '../src/cli/probe.ts'

const dir = new URL('./fixtures/cli/', import.meta.url)
const read = (name: string): string => fs.readFileSync(new URL(name, dir), 'utf8')
const spec = (id: string): CliAdapterSpec => builtinSpecById(id)!
const parse = (id: string, fixture: string, platform: string | undefined, count: number): WebSearchSource[] => parseCliOutput(spec(id), searchSpecFor(spec(id), platform ?? spec(id).platforms[0]!), read(fixture), count)

/** What every result of every adapter must satisfy, whatever the query returned. */
function assertSane(label: string, sources: readonly WebSearchSource[], count: number, urlPattern: RegExp): void {
  assert.ok(sources.length >= 1 && sources.length <= count, label + ': 1..' + count + ' results, got ' + sources.length)
  const seen = new Set<string>()
  for (const s of sources) {
    assert.match(s.url, urlPattern, label + ' url ' + s.url)
    assert.ok(!seen.has(s.url), label + ': duplicate url ' + s.url)
    seen.add(s.url)
    assert.ok(s.title && s.title.trim().length > 0, label + ': title for ' + s.url)
    // The defect of issue #38: a field name of a structured dump taken for a title (`profileImageUrl:`).
    assert.doesNotMatch(s.title!, /^[A-Za-z_][\w.-]*:$/, label + ': title is a field name')
    // The defect of yt-dlp's NA placeholder.
    for (const text of [s.title, s.snippet]) assert.doesNotMatch(text ?? '', /(^|[|·] )(NA|None|null|undefined)( views)?( [|·]|$)/, label + ': placeholder text in "' + text + '"')
    if (s.snippet !== undefined) assert.ok(s.snippet.trim().length > 0 && s.snippet.trim() !== '-', label + ': empty snippet kept')
    if (s.publishedAt !== undefined) assert.ok(!Number.isNaN(Date.parse(s.publishedAt)), label + ': publishedAt ' + s.publishedAt)
  }
}

// ── offline: the captured live outputs ──────────────────────────────────────

test('live captures (offline): bili zh / en, Exa through mcporter zh / en', () => {
  const bili = parse('bili', 'live-bili-zh.json', 'bilibili', 5)
  assert.equal(bili.length, 4, 'five rows, one is a course entry without a bvid and is skipped')
  assertSane('bili zh', bili, 5, /^https:\/\/www\.bilibili\.com\/video\/BV[0-9A-Za-z]{10}$/)
  // Asked for 6 to get 3 (overfetch): the third entry is a course without a bvid, the count is still met.
  const over = parse('bili', 'live-bili-overfetch.json', 'bilibili', 3)
  assert.equal(over.length, 3)
  assert.ok(JSON.parse(read('live-bili-overfetch.json')).data.some((row: { bvid: string }) => !row.bvid), 'the capture holds an entry without a link')
  assert.equal(bili[0]!.title, '全网最简单的Deepseek本地部署方法，谁都可以照抄！')
  assert.equal(bili[0]!.snippet, 'UP: 我是阿众 | 播放: 1502363 | 3:47')
  const en = parse('bili', 'live-bili-en.json', 'bilibili', 3)
  assert.equal(en.length, 3)
  assertSane('bili en', en, 3, /^https:\/\/www\.bilibili\.com\/video\/BV/)
  for (const file of ['live-mcporter-exa-en.txt', 'live-mcporter-exa-zh.txt']) {
    const exa = parseMcporterExaSearch(read(file), 3)
    assert.equal(exa.length, 3, file)
    assertSane(file, exa, 3, /^https?:\/\//)
    assert.ok(exa.every(s => (s.snippet ?? '').length > 0 && (s.snippet ?? '').length <= 440), 'snippets are capped')
  }
  const exaEn = parseMcporterExaSearch(read('live-mcporter-exa-en.txt'), 3)
  assert.equal(exaEn[2]!.publishedAt, '2024-02-21T15:30:52.000Z', 'Published: N/A is dropped, a real date is kept')
  assert.equal(exaEn[0]!.publishedAt, undefined)
})

// ── live: opt-in, real tools, real network ──────────────────────────────────

const LIVE = process.env.WSP_LIVE_CLI === '1'
const REAL_PATH = process.env.WSP_REAL_PATH

/** Run `fn` with the caller's real PATH (the suite otherwise isolates PATH to /usr/bin:/bin). */
async function withRealPath<T>(fn: () => Promise<T>, extraFirst?: string): Promise<T> {
  const saved = process.env.PATH
  process.env.PATH = (extraFirst ? extraFirst + path.delimiter : '') + (REAL_PATH ?? saved ?? '')
  try { return await fn() } finally { process.env.PATH = saved }
}

const skipReason = (bin: string): string | false => {
  if (!LIVE) return 'set WSP_LIVE_CLI=1 (pnpm run test:live-cli) to run the real tools'
  const saved = process.env.PATH
  process.env.PATH = REAL_PATH ?? saved ?? ''
  const found = findOnPath(bin)
  process.env.PATH = saved
  return found ? false : bin + ' is not installed'
}

interface LiveCase { label: string; platform: string; query: string; count: number; url: RegExp; may?: 'be-empty' }

async function live(id: string, cases: readonly LiveCase[], check?: (c: LiveCase, sources: WebSearchSource[]) => void): Promise<void> {
  const s = spec(id)
  await withRealPath(async () => {
    const probe = await probeCli(s, { force: true })
    assert.equal(probe.state, 'detected', id + ' probe: ' + probe.reason)
    for (const c of cases) {
      try {
        const { sources } = await runCliSearchDetailed(s, { query: c.query, count: c.count }, { platform: c.platform, bin: probe.path })
        assertSane(id + ' ' + c.label, sources, c.count, c.url)
        check?.(c, sources)
      } catch (error) {
        if (c.may === 'be-empty' && error instanceof Error && (error as { code?: string }).code === 'ENGINE_EMPTY') continue
        throw error
      }
    }
  })
}

const RUN_OPTS = { timeout: 180_000 }

test('live bili: Chinese, English and special-character queries', { skip: skipReason('bili'), ...RUN_OPTS }, async () => {
  const v = /^https:\/\/www\.bilibili\.com\/video\/BV[0-9A-Za-z]{10}$/
  await live('bili', [
    { label: 'zh', platform: 'bilibili', query: 'DeepSeek 本地部署教程', count: 5, url: v },
    { label: 'en', platform: 'bilibili', query: 'rust async runtime tutorial', count: 3, url: v },
    { label: 'special', platform: 'bilibili', query: 'C++ "template" <b>& 100%', count: 3, url: v },
  ], (c, sources) => assert.equal(sources.length, c.count, c.label + ': the requested count is met (overfetch covers the entries without a link)'))
})

test('live gh: repos, issues and code; multi-word queries are words, not one exact phrase', { skip: skipReason('gh'), ...RUN_OPTS }, async () => {
  await live('gh', [
    { label: 'repos zh', platform: 'github', query: 'DeepSeek 插件', count: 4, url: /^https:\/\/github\.com\/[^/]+\/[^/]+$/ },
    { label: 'repos en', platform: 'github', query: 'web search plugin', count: 4, url: /^https:\/\/github\.com\/[^/]+\/[^/]+$/ },
    { label: 'issues qualifier', platform: 'github-issues', query: 'repo:anweat/dsh-web-search-pro is:issue twitter', count: 3, url: /^https:\/\/github\.com\/[^/]+\/[^/]+\/(issues|pull)\/\d+$/ },
    { label: 'issues words', platform: 'github-issues', query: 'DeepSeek Harness 插件 搜索', count: 3, url: /^https:\/\/github\.com\/[^/]+\/[^/]+\/(issues|pull)\/\d+$/, may: 'be-empty' },
    { label: 'code', platform: 'github-code', query: 'web_call repo:anweat/dsh-web-search-pro', count: 3, url: /^https:\/\/github\.com\/[^/]+\/[^/]+\/blob\/[0-9a-f]{40}\/.+/ },
  ])
  // A nonsense query is an empty answer, not a failure.
  await withRealPath(async () => {
    const probe = await probeCli(spec('gh'), { force: true })
    await assert.rejects(runCliSearchDetailed(spec('gh'), { query: 'qzxwvkjhgfdsa1928374zzqq', count: 3 }, { platform: 'github', bin: probe.path }), (e: any) => e.code === 'ENGINE_EMPTY')
  })
})

test('live yt-dlp: Chinese, English, live streams (NA placeholders) and a nonsense query', { skip: skipReason('yt-dlp'), ...RUN_OPTS }, async () => {
  const v = /^https:\/\/www\.youtube\.com\/watch\?v=[\w-]{11}$/
  await live('yt-dlp', [
    { label: 'zh', platform: 'youtube', query: 'DeepSeek 本地部署教程', count: 4, url: v },
    { label: 'en', platform: 'youtube', query: 'rust async runtime tokio', count: 4, url: v },
    { label: 'live streams', platform: 'youtube', query: 'lofi hip hop radio live 24/7', count: 10, url: v },
    { label: 'special', platform: 'youtube', query: 'C++ "template" <b>& 100% | $x', count: 3, url: v },
  ], (c, sources) => {
    // Durations are H:M:S, never a bare number of seconds.
    for (const s of sources) for (const part of (s.snippet ?? '').split(' | ')) assert.doesNotMatch(part, /^\d{1,2}$/, c.label + ': bare duration in "' + s.snippet + '"')
  })
})

test('live wx-search-cli: Chinese and English queries (an anti-spider page is an empty answer, not a failure)', { skip: skipReason('wx-search-cli'), ...RUN_OPTS }, async () => {
  const w = /^https:\/\/mp\.weixin\.qq\.com\/s\?/
  await live('wx-search-cli', [
    { label: 'zh', platform: 'wechat', query: '人工智能', count: 5, url: w, may: 'be-empty' },
    { label: 'en', platform: 'wechat', query: 'DeepSeek V4 harness', count: 3, url: w, may: 'be-empty' },
  ])
})

test('live omnireach: the wechat source, and the multi-source search that must never reach the browser', { skip: skipReason('omnireach'), ...RUN_OPTS }, async () => {
  await live('omnireach', [
    { label: 'wechat zh', platform: 'wechat', query: '大模型 备案', count: 3, url: /^https:\/\/mp\.weixin\.qq\.com\/s\?/, may: 'be-empty' },
  ])
  // The DSH Host runs with NO_PROXY=...,[::1]; omnireach (httpx) fails every source with "Invalid port: ':1]'" unless the entry is bare.
  const savedNoProxy = [process.env.NO_PROXY, process.env.no_proxy]
  process.env.NO_PROXY = 'localhost,127.0.0.1,[::1]'
  process.env.no_proxy = 'localhost,127.0.0.1,[::1]'
  try {
    await live('omnireach', [{ label: 'wechat with [::1] in NO_PROXY', platform: 'wechat', query: '大模型 备案', count: 2, url: /^https:\/\/mp\.weixin\.qq\.com\/s\?/ }])
  } finally {
    for (const [name, value] of [['NO_PROXY', savedNoProxy[0]], ['no_proxy', savedNoProxy[1]]] as const) { if (value === undefined) delete process.env[name]; else process.env[name] = value }
  }
  // A stand-in `opencli` first on PATH records any call: omnireach's automatic routing would run it for google / twitter.
  const stub = fs.mkdtempSync(path.join(os.tmpdir(), 'wsp-live-opencli-'))
  const marker = path.join(stub, 'called')
  fs.writeFileSync(path.join(stub, 'opencli'), '#!/bin/sh\necho "$@" >> "' + marker + '"\nexit 1\n', { mode: 0o755 })
  try {
    await withRealPath(async () => {
      const probe = await probeCli(spec('omnireach'), { force: true })
      assert.equal(probe.state, 'detected')
      for (const query of ['DeepSeek 联网搜索 插件', 'rust async runtime comparison']) {
        const { sources } = await runCliSearchDetailed(spec('omnireach'), { query, count: 5 }, { platform: 'omnireach', bin: probe.path })
        assertSane('omnireach multi ' + query, sources, 5, /^https?:\/\//)
      }
    }, stub)
    assert.ok(!fs.existsSync(marker), 'opencli was never called by the multi-source search: ' + (fs.existsSync(marker) ? fs.readFileSync(marker, 'utf8') : ''))
  } finally { fs.rmSync(stub, { recursive: true, force: true }) }
})

test('live Exa through mcporter (keyless): Chinese and English', { skip: skipReason('mcporter'), ...RUN_OPTS }, async () => {
  const savedKey = process.env.EXA_API_KEY
  delete process.env.EXA_API_KEY
  try {
    await withRealPath(async () => {
      const engine = exaEngine({ enableCli: true } as never)
      for (const query of ['rust async runtime comparison', 'DeepSeek 联网搜索 插件 对比']) {
        const { sources } = await engine.search(query, 3, undefined as never)
        assertSane('exa ' + query, sources, 3, /^https?:\/\//)
      }
    })
  } finally { if (savedKey !== undefined) process.env.EXA_API_KEY = savedKey }
})

/** A router on an isolated store with the real PATH: the platform chains as a Host would run them. */
async function withRouter<T>(extra: Record<string, unknown>, fn: (r: { search: (platform: string, query: string) => Promise<{ engine: string; sources: WebSearchSource[] }>; last: () => { engine: string; detail: string }; report: () => Promise<Awaited<ReturnType<SearchRouter['providerReport']>>> }) => Promise<T>): Promise<T> {
  clearProbeCache()
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'wsp-live-chain-'))
  const store = new Store(path.join(work, 'store.db'))
  const config = resolveConfig({ engines: ['ddg'], dbPath: path.join(work, 'store.db'), enableCliBackends: true, opencliEnabled: true, agentReachEnabled: true, ttlSeconds: 60, allowProxyFakeIp: true, ...extra } as never)
  const router = new SearchRouter({ get: () => undefined } as never, config, store, () => config, () => undefined, undefined, createBuiltinRegistry())
  try {
    return await fn({
      search: (platform, query) => router.search({ query, count: 3, fresh: true, multi: false, signal: undefined, platform: { id: platform } } as never) as never,
      last: () => { const q = store.listQueries({ kind: 'platform' })[0]!; return { engine: q.engine, detail: typeof q.detail === 'string' ? q.detail : JSON.stringify(q.detail) } },
      report: () => router.providerReport(),
    })
  } finally { router.dispose(); store.close(); fs.rmSync(work, { recursive: true, force: true }) }
}

test('live chains: configured order, fall-through with the reason, REST failure falls back to gh', { skip: skipReason('wx-search-cli') || skipReason('omnireach') || skipReason('gh'), ...RUN_OPTS }, async () => {
  await withRealPath(async () => {
    await withRouter({}, async r => {
      assert.equal((await r.search('wechat', '人工智能')).sources.length > 0, true)
      assert.equal(r.last().engine, 'omnireach', 'wechat: omnireach is first')
    })
    await withRouter({ platformBackends: { wechat: ['wx-search-cli', 'omnireach'] } }, async r => {
      await r.search('wechat', '人工智能')
      assert.equal(r.last().engine, 'wx-search-cli', 'a configured order replaces the default')
    })
    // The first backend of the wechat chain is not there: the second answers and the history says why the first was passed over.
    const withoutOmnireach = (process.env.PATH ?? '').split(path.delimiter).filter(dirName => !fs.existsSync(path.join(dirName, 'omnireach'))).join(path.delimiter)
    const saved = process.env.PATH
    process.env.PATH = withoutOmnireach
    try {
      await withRouter({}, async r => {
        await r.report()
        const out = await r.search('wechat', '人工智能')
        assert.ok(out.sources.length > 0)
        assert.equal(r.last().engine, 'wx-search-cli')
        assert.match(r.last().detail, /skipped backends: omnireach: the omnireach command is not installed: install it/)
      })
    } finally { process.env.PATH = saved }
    // github: REST first; a rejected token makes it fall through to gh with the REST error named.
    await withRouter({}, async r => { await r.search('github', 'web search plugin'); assert.equal(r.last().engine, 'github'); assert.match(r.last().detail, /"backend":"rest"/) })
    await withRouter({ githubToken: 'ghp_' + 'invalid'.repeat(5) }, async r => {
      const out = await r.search('github', 'web search plugin')
      assert.ok(out.sources.length > 0)
      assert.match(r.last().detail, /"backend":"gh"/)
      assert.match(r.last().detail, /skipped backends: github: GitHub API 401/)
    })
  })
})

test('live chains: login-bound backends are reported as skipped without being run when their saved login is missing (an empty HOME)', { skip: skipReason('bili'), ...RUN_OPTS }, async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'wsp-live-nohome-'))
  const savedHome = process.env.HOME
  process.env.HOME = home
  try {
    await withRealPath(async () => {
      await withRouter({}, async r => {
        const report = await r.report()
        const chainOf = (route: string) => report.find(p => p.route === route)!.chain!
        for (const [route, id, bin] of [['xiaohongshu', 'xhs', 'xhs'], ['reddit', 'rdt', 'rdt'], ['zhihu', 'zhihu', 'zhihu']] as const) {
          const leg = chainOf(route).find(e => e.id === id)!
          if (leg.installation === 'missing') continue // not installed on this machine: reported as missing instead
          assert.deepEqual([leg.state, leg.credential], ['skipped', 'missing'], route)
          assert.match(leg.reason ?? '', new RegExp(id + ': no saved login \\(run `' + bin + ' login` yourself\\)'), route)
        }
        const tw = chainOf('twitter').find(e => e.id === 'twitter')!
        if (tw.installation !== 'missing') assert.match(tw.reason ?? '', /TWITTER_AUTH_TOKEN \/ TWITTER_CT0 not set/)
        assert.equal(chainOf('bilibili')[0]!.state, 'ready')
      })
    })
  } finally { if (savedHome === undefined) delete process.env.HOME; else process.env.HOME = savedHome; fs.rmSync(home, { recursive: true, force: true }) }
})

test('the live suite never runs a login-bound tool: only the key-less adapters are named', () => {
  const body = fs.readFileSync(new URL(import.meta.url), 'utf8')
  const live = body.slice(body.indexOf('// ── live: opt-in'))
  const named = new Set([...live.matchAll(/(?:live|spec|skipReason)\('([\w-]+)'/g)].map(m => m[1]))
  assert.deepEqual([...named].sort(), ['bili', 'gh', 'mcporter', 'omnireach', 'wx-search-cli', 'yt-dlp'])
  // No platform search is issued for a login-bound platform: only reports are read.
  assert.deepEqual([...live.matchAll(/\.search\('([\w-]+)'/g)].map(m => m[1]).filter(p => ['xiaohongshu', 'reddit', 'zhihu', 'twitter'].includes(p!)), [])
})
