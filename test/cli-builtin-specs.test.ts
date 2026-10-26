import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { BUILTIN_CLI_SPECS, builtinSpecById } from '../src/cli/builtin-specs.ts'
import { evaluateCliContract } from '../src/cli/probe.ts'
import { opencliSearchSpec, parseOpencliList } from '../src/cli/opencli.ts'
import { CliAdapterError, parseCliOutput, runCliSearch } from '../src/cli/runner.ts'
import { commandWords, DENIED_FLAGS, parseVersion, searchSpecFor, validateCliAdapterSpec, type CliAdapterSpec } from '../src/cli/spec.ts'
import { BROWSER_OPENCLI_PLATFORMS, BROWSER_SEARCH_PLATFORMS, CHAIN_PLATFORMS, DEFAULT_CHAINS, platformBackendIssues, REST_PLATFORMS } from '../src/cli/chains-spec.ts'
import { OPENCLI_PLATFORMS } from '../src/engines.ts'
import { PLATFORM_SEARCH_SPECS } from '../src/platform-search.ts'
import { PLATFORM_IDS, defaultProviderRegistry } from '../src/providers/index.ts'
import { loadCatalog } from '../src/catalog/load.ts'
import { posix, withCommands } from './cli-helpers.ts'

const dir = new URL('./fixtures/cli/', import.meta.url)
const read = (name: string): string => fs.readFileSync(new URL(name, dir), 'utf8')
const spec = (id: string): CliAdapterSpec => builtinSpecById(id)!
const parse = (id: string, fixture: string, platform?: string, count = 20) => parseCliOutput(spec(id), searchSpecFor(spec(id), platform ?? spec(id).platforms[0]!), read(fixture), count)

test('every built-in spec passes the same validation as a user spec, and is read-only by construction', () => {
  assert.deepEqual(BUILTIN_CLI_SPECS.map(s => s.id), ['bili', 'yt-dlp', 'twitter', 'xhs', 'zhihu', 'rdt', 'omnireach', 'gh', 'wx-search-cli', 'tanso'])
  for (const s of BUILTIN_CLI_SPECS) {
    const result = validateCliAdapterSpec(s, 'builtin')
    assert.equal(result.ok, true, s.id + ': ' + result.errors.join('; '))
    // A user-defined copy is only refused for carrying a verification record, never for its commands.
    assert.deepEqual(validateCliAdapterSpec({ ...s, verification: undefined }, 'user').errors, [], s.id + ' as a user spec')
    for (const search of [s.search, ...Object.values(s.searches ?? {})]) {
      for (const word of commandWords(search.argv)) assert.ok(s.allowedSubcommands.includes(word), s.id + ' ' + word)
      const flags = search.argv.filter(t => t.startsWith('-')).map(t => t.replace(/^-+/, ''))
      assert.deepEqual(flags.filter(f => DENIED_FLAGS.includes(f)), [], s.id + ' passes no cookie / credential flag')
      assert.ok(!search.argv.some(t => ['login', 'logout', 'post', 'delete', 'like', 'follow', 'comment', 'publish', 'setup', 'init'].includes(t)), s.id + ' argv carries no write command')
    }
    assert.ok(s.verification && ['live', 'contract-only', 'docs-only'].includes(s.verification.status), s.id + ' records its verification')
    for (const bin of s.bins) assert.doesNotMatch(bin, /[\\/]/)
  }
})

test('verification records: live only where a real read-only search was run, docs-only where the tool was not available to probe', () => {
  const status = Object.fromEntries(BUILTIN_CLI_SPECS.map(s => [s.id, s.verification!.status]))
  assert.deepEqual(status, { bili: 'live', 'yt-dlp': 'live', twitter: 'contract-only', xhs: 'contract-only', zhihu: 'contract-only', rdt: 'contract-only', omnireach: 'live', gh: 'live', 'wx-search-cli': 'contract-only', tanso: 'docs-only' })
  for (const s of BUILTIN_CLI_SPECS) {
    if (s.verification!.status === 'live') assert.match(s.verification!.date ?? '', /^\d{4}-\d{2}-\d{2}$/)
    assert.ok(s.verification!.version, s.id + ' records the verified version')
  }
})

test('contract probes accept the real help and version output captured on 2026-10-06 (help / version only)', () => {
  const help = (name: string): string => read('help/' + name)
  const check = (id: string, bin: string, helpFile: string, versionFile: string): void => {
    const s = spec(id)
    const verdict = evaluateCliContract(s, bin, { code: 0, output: help(versionFile) }, { code: 0, output: help(helpFile) })
    assert.deepEqual([id, verdict.state, verdict.reason], [id, 'detected', undefined])
    const detected = parseVersion(help(versionFile))
    if (detected) assert.ok(s.verification!.version!.startsWith(detected), id + ' version ' + detected + ' vs ' + s.verification!.version)
  }
  check('bili', 'bili', 'bili-search.txt', 'bili-version.txt')
  check('xhs', 'xhs', 'xhs-search.txt', 'xhs-version.txt')
  check('zhihu', 'zhihu', 'zhihu-search.txt', 'zhihu-version.txt')
  check('rdt', 'rdt', 'rdt-search.txt', 'rdt-version.txt')
  check('twitter', 'twitter', 'twitter-search.txt', 'twitter-version.txt')
  check('omnireach', 'omnireach', 'omnireach-search.txt', 'omnireach-version.txt')
  check('gh', 'gh', 'gh-search-repos.txt', 'gh-version.txt')
  check('yt-dlp', 'yt-dlp', 'yt-dlp-excerpt.txt', 'yt-dlp-version.txt')
  check('wx-search-cli', 'wx-search-cli', 'wx-search-cli.txt', 'wx-search-cli-version.txt')
  // The standalone OpenCLI is probed by its own probe subject.
  const opencli = { probe: { versionArgs: ['--version'], minVersion: '1.8.0', helpArgs: ['list', '--help'], mustContain: ['--format', 'json'] } }
  assert.equal(evaluateCliContract(opencli, 'opencli', { code: 0, output: help('opencli-version.txt') }, { code: 0, output: help('opencli-list.txt') }).state, 'detected')
  // A same-named program with another contract is incompatible, never detected (dev issue #20).
  const imposter = evaluateCliContract(spec('bili'), 'bili', { code: 0, output: 'bili, version 0.6.2' }, { code: 0, output: 'Usage: bili [OPTIONS] URL\n  --download' })
  assert.equal(imposter.state, 'incompatible')
  assert.match(imposter.reason!, /bili search contract missing --type, --max, --json/)
  assert.equal(evaluateCliContract(spec('xhs'), 'xhs', { code: 0, output: '0.1' }, { code: 0, output: 'Usage: xhs [x]' }).state, 'incompatible')
})

test('bili (live fixture): versioned envelope, HTML-entity titles, UTF-8 metadata', () => {
  const out = parse('bili', 'live-bili-search.json')
  assert.equal(out.length, 2)
  assert.deepEqual(out[0], { url: 'https://www.bilibili.com/video/BV1LQHr6NEGx', title: 'DeepSeek假期突袭！截胡Claude新功能Mods', snippet: 'UP: 杜雨说AI | 播放: 57143 | 4:23' })
  assert.match(out[1]!.title!, /"大肥鱼"/)
})

test('gh (live fixture and documented fields): repos, issues and code each have their own command and mapping', () => {
  const repos = parse('gh', 'live-gh-repos.json', 'github')
  assert.deepEqual(repos[0], {
    url: 'https://github.com/anweat/dsh-web-search-pro', title: 'anweat/dsh-web-search-pro', publishedAt: '2026-10-06',
    snippet: 'Enhanced, persistent web search plugin for DeepSeek Harness (multi-engine search, SQLite+LRU cache, platform backends, Playwright rendering) | ⭐74 | [TypeScript] | forks 7',
  })
  const gh = spec('gh')
  assert.deepEqual(searchSpecFor(gh, 'github').argv.slice(0, 3), ['search', 'repos', '--json'])
  assert.deepEqual(searchSpecFor(gh, 'github-issues').argv.slice(0, 2), ['search', 'issues'])
  assert.deepEqual(searchSpecFor(gh, 'github-code').argv.slice(0, 2), ['search', 'code'])
  // The query follows `--`, so a query that starts with a dash cannot become a flag, and it is handed over as separate words
  // ({terms}): gh quotes a one-token query as an exact phrase, which found nothing for four-word queries and broke `repo:x some words`.
  for (const platform of gh.platforms) assert.deepEqual(searchSpecFor(gh, platform).argv.slice(-2), ['--', '{terms}'])
  const issues = parseCliOutput(gh, searchSpecFor(gh, 'github-issues'), JSON.stringify([{ title: 'Crash on start', url: 'https://github.com/o/r/issues/1', state: 'open', repository: { name: 'r', nameWithOwner: 'o/r' }, commentsCount: 3, updatedAt: '2026-10-01T00:00:00Z' }]))
  assert.deepEqual(issues, [{ url: 'https://github.com/o/r/issues/1', title: 'Crash on start', snippet: '[open] · o/r · 3 comments', publishedAt: '2026-10-01' }])
  const code = parseCliOutput(gh, searchSpecFor(gh, 'github-code'), JSON.stringify([{ path: 'src/a.ts', repository: { nameWithOwner: 'o/r' }, url: 'https://github.com/o/r/blob/main/src/a.ts' }]))
  assert.deepEqual(code, [{ url: 'https://github.com/o/r/blob/main/src/a.ts', title: 'o/r / src/a.ts', snippet: '仓库: o/r' }])
})

test('gh (live fixtures 2026-10-26): Chinese repos query, issues and code searches, the empty answer', () => {
  const gh = spec('gh')
  const zh = parse('gh', 'live-gh-repos-zh.json', 'github')
  assert.equal(zh.length, 4)
  assert.deepEqual(zh[0], { url: 'https://github.com/KomoriDev/nonebot-plugin-deepseek', title: 'KomoriDev/nonebot-plugin-deepseek', publishedAt: '2026-10-26', snippet: 'NoneBot DeepSeek 插件。接入 DeepSeek 模型，提供智能对话与问答功能 | ⭐178 | [Python] | forks 19' })
  assert.ok(zh.every(r => /^https:\/\/github\.com\/[^/]+\/[^/]+$/.test(r.url) && r.title === r.url.replace('https://github.com/', '')), 'title is owner/name of the url')
  const issues = parse('gh', 'live-gh-issues.json', 'github-issues')
  assert.deepEqual(issues, [{ url: 'https://github.com/anweat/dsh-web-search-pro/issues/38', title: '[Bug] twitter 平台源结果全错：url-lines 解析器套在 twitter-cli 的 YAML 输出上（0.2.1 与 main 均复现）', publishedAt: '2026-10-08', snippet: '[open] · anweat/dsh-web-search-pro · 0 comments' }])
  const code = parse('gh', 'live-gh-code.json', 'github-code')
  assert.equal(code.length, 3)
  assert.deepEqual(code[0], { url: 'https://github.com/anweat/dsh-web-search-pro/blob/9e905c212fac5e891cc0f7ea75e1c276c9e5498e/src/prompt.ts', title: 'anweat/dsh-web-search-pro / src/prompt.ts', snippet: '仓库: anweat/dsh-web-search-pro' })
  // No hits prints `[]`: nothing parsed, which the runner reports as an empty answer.
  assert.deepEqual(parseCliOutput(gh, gh.search, '[]\n', 5), [])
})

test('omnireach (live fixtures): every command names its sources with --on - the tool\'s automatic routing drives the user\'s Chrome', () => {
  const s = spec('omnireach')
  assert.deepEqual(searchSpecFor(s, 'wechat').argv, ['search', '{query}', '--on', 'wechat', '--limit', '{count}', '--json'])
  assert.deepEqual(searchSpecFor(s, 'omnireach').argv, ['search', '{query}', '--on', 'hackernews,youtube,github,wechat,bilibili', '--limit', '{count}', '--json'])
  // Without --on omnireach 0.19 adds `google` and `twitter` (adapter opencli = the user's logged-in Chrome) whenever `opencli` is on PATH.
  for (const platform of s.platforms) {
    const argv = searchSpecFor(s, platform).argv
    assert.ok(argv[argv.indexOf('--on') + 1], platform + ' passes --on <sources>')
    const sources = argv[argv.indexOf('--on') + 1]!.split(',')
    assert.deepEqual(sources.filter(id => ['google', 'twitter', 'reddit', 'xiaohongshu', 'tiktok', 'douyin', 'agy', 'tavily', 'brave', 'perplexity', 'exa'].includes(id)), [], platform + ' names no browser-backed, wip or paid source')
  }
  for (const [file, expectSources] of [['live-omnireach-multi-zh.json', ['bilibili', 'github', 'wechat', 'youtube']], ['live-omnireach-multi-en.json', ['bilibili', 'github', 'hackernews', 'wechat', 'youtube']]] as const) {
    const envelope = JSON.parse(read(file)) as { results: { source: string; adapter: string }[]; errors: unknown[] }
    assert.deepEqual([...new Set(envelope.results.map(r => r.source))].sort(), expectSources, file + ' holds only the explicit sources')
    assert.ok(!envelope.results.some(r => r.adapter === 'opencli'), file + ': no result came through opencli')
    const out = parse('omnireach', file, 'omnireach', 50)
    assert.equal(out.length, envelope.results.length)
    assert.ok(out.every(r => /^https?:\/\//.test(r.url) && r.title && r.snippet !== '-'))
  }
  assert.equal(parse('omnireach', 'live-omnireach-multi-zh.json', 'omnireach', 3).length, 3, 'the count cuts the ranked list')
  assert.ok(parse('omnireach', 'live-omnireach-multi-en.json', 'omnireach', 50).some(r => r.publishedAt === '2026-09-27T02:22:52Z'), 'ts becomes publishedAt')
  const out = parse('omnireach', 'live-omnireach-wechat.json', 'wechat')
  assert.equal(out.length, 1)
  assert.match(out[0]!.url, /^https:\/\/mp\.weixin\.qq\.com\/s\?src=11/)
  assert.equal(out[0]!.publishedAt, '2026-09-29T01:03:58Z')
  assert.match(out[0]!.snippet!, /^截至2026年9月28日/)
  // The parser alone sees an empty list; the runner turns "no results plus the tool's error list" into a failure (below).
  assert.deepEqual(parseCliOutput(s, searchSpecFor(s, 'wechat'), JSON.stringify({ query: 'q', ts: 't', results: [], errors: [{ source: 'wechat', error: 'sogou captcha', category: 'failed' }] })), [])
})

test('xhs / rdt / zhihu / twitter / yt-dlp (constructed from help and installed source: contract-only)', () => {
  const xhs = parse('xhs', 'constructed-xhs-search.json')
  assert.deepEqual(xhs, [{ url: 'https://www.xiaohongshu.com/explore/66f0aa0000000000?xsec_token=ABtoken1=&xsec_source=pc_search', title: '新手露营装备清单', snippet: '作者: 露营小王 | 赞: 1234' }])
  assert.throws(() => parseCliOutput(spec('xhs'), spec('xhs').search, read('constructed-xhs-not-authenticated.json')), (e: any) => e instanceof CliAdapterError && e.code === 'CLI_FAILED' && /No 'a1' cookie/.test(e.message))

  const rdt = parse('rdt', 'constructed-rdt-search.json')
  assert.equal(rdt[0]!.url, 'https://www.reddit.com/r/programming/comments/1abc123/rust_vs_go_for_async_services/')
  assert.equal(rdt[0]!.snippet, 'r/programming | score 842 | 211 comments | I have been comparing both for a year.')
  assert.equal(rdt[0]!.publishedAt, new Date(1_790_000_000 * 1000).toISOString())

  const zhihu = parse('zhihu', 'constructed-zhihu-search.json')
  assert.deepEqual(zhihu.map(s => s.url), ['https://www.zhihu.com/question/111/answer/333', 'https://zhuanlan.zhihu.com/p/222', 'https://www.zhihu.com/question/444'], 'topics have no result page and are dropped')
  assert.equal(zhihu[0]!.title, '大模型备案怎么做？')
  assert.equal(zhihu[0]!.snippet, '备案流程分三步', 'tags stripped')
  assert.equal(zhihu[1]!.title, '大模型备案指南')

  const tw = parse('twitter', 'constructed-twitter-search.json')
  assert.deepEqual(tw, [
    { url: 'https://x.com/alice/status/1900000000000000001', title: 'Shipping v2 today. Changelog and migration notes: https://t.co/AbCdEfGhIj', snippet: 'Alice Dev (@alice) · likes 1234 · retweets 56 · views 98765 · 2026-10-07T18:05:04+00:00', publishedAt: '2026-10-07T18:05:04+00:00' },
    { url: 'https://x.com/bob_cn/status/1900000000000000002', title: 'Bob 中文 (@bob_cn)', snippet: 'Bob 中文 (@bob_cn) · likes 0 · retweets 0 · views 0 · 2026-10-06T09:00:00+00:00', publishedAt: '2026-10-06T09:00:00+00:00' },
    { url: 'https://x.com/dave/status/1900000000000000003', title: 'RT @carol: Thread on caching strategies for LLM agents (1/5)', snippet: 'Dave (@dave) · likes 3 · retweets 1 · views 410 · 2026-10-05T12:30:00+00:00', publishedAt: '2026-10-05T12:30:00+00:00' },
  ])
  // No avatar, video or t.co link of the payload is ever a result.
  assert.ok(!tw.some(s => /twimg\.com|t\.co\//.test(s.url)))
  assert.deepEqual(spec('twitter').search.argv, ['search', '{query}', '-n', '{count}', '--json'])
  // The tool's own failure payload is quoted by its message (CLI_FAILED), not parsed as results.
  assert.throws(() => parseCliOutput(spec('twitter'), spec('twitter').search, read('constructed-twitter-error.json')), (e: any) => e instanceof CliAdapterError && e.code === 'CLI_FAILED' && /No Twitter cookies found/.test(e.message))

  // The `None` placeholders of yt-dlp's print template (constructed fixture; the live capture is tested below).
  const yt = parse('yt-dlp', 'constructed-yt-dlp-search.tsv')
  assert.deepEqual(yt, [
    { url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', title: 'Rust async explained', snippet: 'Some Channel | 1234567 views | 10:21' },
    { url: 'https://www.youtube.com/watch?v=abc123def45', title: 'No views video', snippet: '01:00' },
  ])
})

test('yt-dlp (live fixture 2026-10-11): the print template records parse; notices on stdout and a structured dump are not rows', () => {
  const yt = spec('yt-dlp')
  assert.deepEqual(yt.search.argv.slice(0, 1), ['ytsearch{count}:{query}'])
  const out = parse('yt-dlp', 'live-yt-dlp-search.txt')
  assert.deepEqual(out, [
    { url: 'https://www.youtube.com/watch?v=nt1SzojVy38', title: 'How to actually run DeepSeek locally', snippet: 'Bog | 351134 views | 4:05' },
    { url: 'https://www.youtube.com/watch?v=DG0vTg25OCY', title: 'Deploy DeepSeek R1 + Dify Locally｜ The Easiest Tutorial', snippet: 'Dify | 5906 views | 5:27' },
  ])
  // yt-dlp wrote its Python 3.10 deprecation notice to stderr; if a version prints one to stdout instead, it is not a record.
  const noisy = 'Deprecated Feature: Support for Python version 3.10 has been deprecated. Please update to Python 3.11 or above\n' + read('live-yt-dlp-search.txt') + 'WARNING: [youtube] something\n'
  assert.deepEqual(parseCliOutput(yt, yt.search, noisy, 20), out)
  // A search with no hits prints nothing: no rows, and the runner turns that into an empty answer.
  assert.deepEqual(parseCliOutput(yt, yt.search, '', 20), [])
})

test('yt-dlp (live fixtures 2026-10-26): NA placeholders of live streams are dropped, durations are H:M:S, Chinese and English queries', () => {
  const live = parse('yt-dlp', 'live-yt-dlp-livestreams.txt')
  assert.equal(live.length, 10)
  assert.ok(live.every(r => !/\bNA\b|None/.test(r.snippet ?? '')), 'no placeholder text reaches a snippet')
  assert.deepEqual(live[0], { url: 'https://www.youtube.com/watch?v=rFZHOHl-L8A', title: 'lofi hip hop radio 📚 beats to relax/study to', snippet: 'Lofi Girl' }, 'a live stream: channel only')
  assert.equal(live[1]!.snippet, 'Cloud Club Lofi | 647457 views | 07:52:55', 'a finished stream keeps views and duration')
  const zh = parse('yt-dlp', 'live-yt-dlp-zh.txt')
  assert.equal(zh.length, 3)
  assert.deepEqual(zh[0], { url: 'https://www.youtube.com/watch?v=bxKavltsOBo', title: '太牛逼了！12GB 显卡就能跑！DeepSeek-V4.1-Flash-1017 Strata版 AI 大模型本地部署教程｜接入 Harness', snippet: 'X超哥 | 8955 views | 00:24:54' })
  const en = parse('yt-dlp', 'live-yt-dlp-en.txt')
  assert.equal(en.length, 4)
  assert.equal(en[0]!.snippet, 'Rust Dev Lab | 78 views | 00:00:11', 'an 11 second video is 00:00:11, not a bare "11"')
  assert.ok([...zh, ...en, ...live].every(r => /^https:\/\/www\.youtube\.com\/watch\?v=[\w-]{11}$/.test(r.url) && r.title))
})

test('wx-search-cli (README fixture) and tanso (docs-only fixture): drop captcha rows, keep the documented fields', () => {
  assert.deepEqual(parse('wx-search-cli', 'constructed-wx-search-cli.json'), [{ url: 'https://mp.weixin.qq.com/s?src=11&abc', title: '人工智能周报', publishedAt: '2026-09-30T08:00:00Z' }])
  assert.deepEqual(parse('tanso', 'constructed-tanso.json'), [{ url: 'https://example.com/article', title: 'Example result title', snippet: 'A normalized summary from the provider response.' }])
  // Tanso never asks for the paid Volcengine answer source.
  assert.ok(!spec('tanso').search.argv.includes('volcengine_answer'))
  assert.deepEqual(spec('tanso').search.argv.filter((_t, i, a) => a[i - 1] === '--source'), ['bocha_web', 'zhihu_search'])
})

test('standalone opencli: only sites whose own list shows a read search command; per-site argv and output', () => {
  const sites = parseOpencliList(read('opencli-list.json'))
  assert.deepEqual([...sites.keys()].sort(), ['douyin', 'hackernews', 'reddit', 'twitter', 'weixin', 'xiaohongshu', 'zhihu'], 'v2ex and xiaoyuzhou have no search command')
  assert.equal(sites.get('hackernews')!.strategy, 'public')
  assert.equal(sites.get('xiaohongshu')!.loginCommand, 'opencli xiaohongshu login')
  const xhs = opencliSearchSpec('xiaohongshu', sites.get('xiaohongshu')!)!
  assert.deepEqual(xhs.search.argv, ['xiaohongshu', 'search', '{query}', '--limit', '{count}', '-f', 'json'])
  assert.equal(xhs.needsLogin, true)
  assert.deepEqual(opencliSearchSpec('hackernews', sites.get('hackernews')!)!.needsLogin, false)
  assert.equal(validateCliAdapterSpec(xhs, 'builtin').ok, true)
  const out = parseCliOutput(xhs, xhs.search, read('constructed-opencli-xiaohongshu-search.json'))
  assert.deepEqual(out, [{ url: 'https://www.xiaohongshu.com/search_result/66f0aa0000000000', title: '露营装备测评', snippet: '小王', publishedAt: '2026-09-20' }])
  const wx = opencliSearchSpec('wechat', sites.get('weixin')!)!
  assert.deepEqual(wx.search.argv.slice(0, 3), ['weixin', 'search', '{query}'])
  assert.equal(parseCliOutput(wx, wx.search, read('constructed-opencli-weixin-search.json'))[0]!.snippet, '摘要文字')
  // A command table entry that is a write command is never read as search.
  assert.deepEqual([...parseOpencliList(JSON.stringify([{ site: 'x', name: 'search', access: 'write', args: [{ name: 'query', positional: true }] }])).keys()], [])
})

test('fixture provenance: live captures, constructed ones are named so, and no fixture holds a credential', () => {
  const names = fs.readdirSync(dir).filter(n => n !== 'help')
  for (const name of names) assert.match(name, /^(live|constructed)-|^opencli-list\.json$/, name)
  for (const name of [...names.map(n => n), ...fs.readdirSync(new URL('help/', dir)).map(n => 'help/' + n)].filter(n => !n.endsWith('/'))) {
    assert.doesNotMatch(read(name), /(?:sk|key|token)-[A-Za-z0-9]{16,}|cookie[=:]\s*\S{20,}/i, name)
  }
})

test('runner on built-in specs: a tool that keeps a saved login is not run without one; with it the fixture parses', { skip: !posix }, async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'wsp-home-'))
  const emit = (name: string): string => "cat '" + new URL(name, dir).pathname + "'"
  try {
    for (const [id, file, login] of [['xhs', 'constructed-xhs-search.json', '.xiaohongshu-cli/cookies.json'], ['rdt', 'constructed-rdt-search.json', '.config/rdt-cli/credential.json'], ['zhihu', 'constructed-zhihu-search.json', '.zhihu-cli/cookies.json']] as const) {
      await withCommands({ [id]: 'echo ran > "$0.ran"; ' + emit(file) }, async bin => {
        await assert.rejects(runCliSearch(spec(id), { query: 'q', count: 3 }, { home }), (e: any) => e.code === 'CLI_NOT_LOGGED_IN' && new RegExp('run `' + id + ' login` yourself').test(e.hint), id)
        assert.equal(fs.existsSync(path.join(bin, id + '.ran')), false, id + ' was not started')
        fs.mkdirSync(path.dirname(path.join(home, login)), { recursive: true })
        fs.writeFileSync(path.join(home, login), '{}')
        const out = await runCliSearch(spec(id), { query: 'q', count: 3 }, { home })
        assert.ok(out.length >= 1, id)
        fs.rmSync(path.join(home, login))
      })
    }
    // twitter: both tokens are required and only their names are ever reported.
    const saved = [process.env.TWITTER_AUTH_TOKEN, process.env.TWITTER_CT0]
    delete process.env.TWITTER_AUTH_TOKEN; delete process.env.TWITTER_CT0
    try {
      await withCommands({ twitter: emit('constructed-twitter-search.json') }, async () => {
        await assert.rejects(runCliSearch(spec('twitter'), { query: 'q', count: 3 }), (e: any) => e.code === 'CLI_NOT_LOGGED_IN' && /TWITTER_AUTH_TOKEN \/ TWITTER_CT0/.test(e.message))
        process.env.TWITTER_AUTH_TOKEN = 'tok-aaaaaaaa'; process.env.TWITTER_CT0 = 'ct0-bbbbbbbb'
        assert.equal((await runCliSearch(spec('twitter'), { query: 'q', count: 3 })).length, 3)
      })
    } finally {
      if (saved[0] === undefined) delete process.env.TWITTER_AUTH_TOKEN; else process.env.TWITTER_AUTH_TOKEN = saved[0]
      if (saved[1] === undefined) delete process.env.TWITTER_CT0; else process.env.TWITTER_CT0 = saved[1]
    }
    // omnireach: no results plus the tool's own error list is a failure with its message.
    await withCommands({ omnireach: "printf '%s' '" + JSON.stringify({ query: 'q', ts: 't', results: [], errors: [{ source: 'wechat', error: 'sogou captcha', category: 'failed' }] }) + "'" }, async () => {
      await assert.rejects(runCliSearch(spec('omnireach'), { query: 'q', count: 3 }, { platform: 'wechat' }), (e: any) => e.code === 'CLI_FAILED' && /sogou captcha/.test(e.message))
    })
    // wx-search-cli: only captcha rows come back, so nothing is left: an empty answer.
    await withCommands({ 'wx-search-cli': "printf '%s' '[{\"title\":\"t\",\"link\":\"l\",\"real_url\":\"\",\"publish_time\":\"\",\"page\":\"1\"}]'" }, async () => {
      await assert.rejects(runCliSearch(spec('wx-search-cli'), { query: 'q', count: 3 }), (e: any) => e.code === 'ENGINE_EMPTY')
    })
  } finally { fs.rmSync(home, { recursive: true, force: true }) }
})

test('consistency: chains, catalog and registry agree', () => {
  const catalog = loadCatalog()
  const platforms = new Set<string>(PLATFORM_IDS)
  // Every spec has a catalog entry that names its command; every platform a spec serves is registered.
  for (const s of [...BUILTIN_CLI_SPECS]) {
    assert.ok(catalog.entries.some(e => e.kind === 'cli' && e.requires?.cli === s.bins[0]), s.id + ' has a catalog entry requiring ' + s.bins[0])
    for (const p of s.platforms) assert.ok(platforms.has(p), s.id + ' serves registered platform ' + p)
  }
  assert.ok(catalog.entries.some(e => e.requires?.cli === 'opencli'), 'standalone opencli')
  assert.ok(catalog.entries.some(e => e.id === 'douyin-cli' && !e.provider && !e.platform), 'douyin-cli is a catalog entry only (its README does not document the record fields)')
  // Every catalog CLI entry that names a provider names a registered one.
  for (const e of catalog.entries.filter(x => x.kind === 'cli' && x.provider)) assert.ok(defaultProviderRegistry.resolve(e.provider!), e.id)
  // Each default chain names backends that exist for it, and every chain platform is a registered platform provider.
  assert.deepEqual(platformBackendIssues(DEFAULT_CHAINS, undefined), [])
  for (const p of CHAIN_PLATFORMS) assert.ok(platforms.has(p), p)
  // The pure lists the settings card uses are pinned to the engines they describe.
  assert.deepEqual([...BROWSER_OPENCLI_PLATFORMS].sort(), Object.keys(OPENCLI_PLATFORMS).sort())
  assert.deepEqual([...BROWSER_SEARCH_PLATFORMS].sort(), Object.keys(PLATFORM_SEARCH_SPECS).sort())
  assert.deepEqual([...REST_PLATFORMS].sort(), ['github', 'github-code', 'github-issues'])
})

test('default chains: the order the plan fixes', () => {
  assert.deepEqual(DEFAULT_CHAINS.xiaohongshu, ['opencli', 'xhs', 'browser-opencli'])
  assert.deepEqual(DEFAULT_CHAINS.reddit, ['rdt', 'opencli', 'browser-opencli'])
  assert.deepEqual(DEFAULT_CHAINS.zhihu, ['zhihu', 'browser-search'])
  assert.deepEqual(DEFAULT_CHAINS.twitter, ['twitter', 'opencli', 'browser-opencli'])
  assert.deepEqual(DEFAULT_CHAINS.bilibili, ['bili'])
  assert.deepEqual(DEFAULT_CHAINS.youtube, ['yt-dlp'])
  for (const p of ['github', 'github-issues', 'github-code']) assert.deepEqual(DEFAULT_CHAINS[p], ['rest', 'gh'])
  assert.deepEqual(DEFAULT_CHAINS.wechat, ['omnireach', 'wx-search-cli'])
  assert.deepEqual(DEFAULT_CHAINS.omnireach, ['omnireach'])
})

test('docs do not drift: README and the skill name every built-in spec, every default chain platform and the verification of each', () => {
  const readme = fs.readFileSync(new URL('../README.md', import.meta.url), 'utf8')
  const skill = fs.readFileSync(new URL('../assets/skills/dsh-web-search-pro/references/sources.md', import.meta.url), 'utf8')
  for (const s of BUILTIN_CLI_SPECS) {
    assert.ok(readme.includes('`' + s.bins[0] + '`'), 'README names ' + s.bins[0])
    assert.ok(skill.includes('`' + s.id + '`') || skill.includes(s.id), 'skill names ' + s.id)
    assert.match(readme, new RegExp('\\| [^\\n]*`' + s.bins[0]!.replace(/[-]/g, '\\-') + '`[^\\n]*\\| ' + s.verification!.version!.replace(/\./g, '\\.') + ' \\|'), 'README table row of ' + s.id + ' carries the verified version')
  }
  for (const platform of CHAIN_PLATFORMS) assert.ok(skill.includes(platform), 'skill names platform ' + platform)
  for (const id of ['platformBackends', 'cliAdapters']) { assert.ok(readme.includes(id)); assert.ok(skill.includes(id)) }
})

// ── guards against the class of bug of issue #38: a parser tied to a tool's default (human / TTY-dependent) output ──

/** Flags that ask a tool for a machine-readable output, by the format the spec then parses. */
function explicitFormat(argv: readonly string[]): 'json' | 'yaml' | 'print' | undefined {
  if (argv.includes('--json')) return 'json'
  if (argv.includes('--yaml')) return 'yaml'
  if (argv.includes('--print')) return 'print'
  for (const flag of ['-f', '--format', '--output-format']) {
    const value = argv[argv.indexOf(flag) + 1]
    if (argv.includes(flag) && (value === 'json' || value === 'yaml')) return value
  }
  return undefined
}

/** Tools whose only output IS the machine-readable one (no flag exists), each backed by the captured help text. */
const MACHINE_ONLY: Readonly<Record<string, { help: string; proof: RegExp }>> = {
  'wx-search-cli': { help: 'help/wx-search-cli.txt', proof: /search <query>[^\n]*\(JSON to stdout\)/ },
}

/** Problems of one search command with respect to the rule (empty = fine). */
function outputRuleProblems(where: string, command: CliAdapterSpec['search'], machineOnly: { help: string; proof: RegExp } | undefined): string[] {
  const problems: string[] = []
  const output = command.output
  if (output.lines?.mode === 'url-lines') problems.push(where + ': url-lines parses whatever the tool prints')
  const flag = explicitFormat(command.argv)
  if (!flag) {
    if (!machineOnly) problems.push(where + ': argv has no explicit machine-readable output flag (' + command.argv.join(' ') + ')')
    else assert.match(read(machineOnly.help), machineOnly.proof, where + ' is exempt only because its help says its output is JSON')
  } else if (output.format === 'json' || output.format === 'yaml') {
    // The flag and the parser agree (JSON is YAML, so a `--json` command may be read as yaml; not the other way round).
    if (flag !== output.format && !(flag === 'json' && output.format === 'yaml')) problems.push(where + ': argv asks for ' + flag + ' but the output is parsed as ' + output.format)
  } else if (output.format === 'text' && flag !== 'print') problems.push(where + ': text output is only allowed with an explicit --print template (' + flag + ')')
  return problems
}

test('guard: no built-in spec parses a tool\'s default output - url-lines is not used, and every command asks for json / yaml / --print explicitly', () => {
  const opencliSites = parseOpencliList(read('opencli-list.json'))
  const generated = [...opencliSites].flatMap(([site, entry]) => { const s = opencliSearchSpec(site, entry); return s ? [s] : [] })
  assert.ok(generated.length >= 5, 'the generated opencli specs are covered too')
  const failures: string[] = []
  for (const s of [...BUILTIN_CLI_SPECS, ...generated]) {
    const commands: [string, CliAdapterSpec['search']][] = [['search', s.search], ...Object.entries(s.searches ?? {}), ...s.read ? [['read', s.read] as [string, CliAdapterSpec['search']]] : []]
    for (const [name, command] of commands) failures.push(...outputRuleProblems(s.id + '.' + name, command, MACHINE_ONLY[s.id]))
  }
  assert.deepEqual(failures, [])
  // The rule has teeth: the 0.2.1 twitter spec (default output, url-lines) fails it, and so do a mismatched flag and an unproven exemption.
  const old = { argv: ['search', '{query}', '-n', '{count}'], output: { format: 'text', lines: { mode: 'url-lines' }, fields: { url: 'url' } } } as unknown as CliAdapterSpec['search']
  assert.deepEqual(outputRuleProblems('twitter-0.2.1', old, undefined).length, 2)
  assert.equal(outputRuleProblems('x', { argv: ['x', '--json'], output: { format: 'text', lines: { mode: 'tsv', columns: ['a', 'b'] }, fields: { url: 'a' } } }, undefined).length, 1)
  assert.deepEqual(outputRuleProblems('x', { argv: ['x', '-f', 'json'], output: { format: 'json', fields: { url: 'url' } } }, undefined), [])
  assert.equal(explicitFormat(['x', '-f', 'table']), undefined)
  assert.throws(() => outputRuleProblems('x', { argv: ['x'], output: { format: 'json', fields: { url: 'url' } } }, { help: 'help/bili-search.txt', proof: /JSON to stdout/ }))
})
