import test from 'node:test'
import assert from 'node:assert/strict'
import {
  BILI_CLI_INSTALLS,
  BILI_CLI_REVISION,
  BILI_CLI_SOURCE,
  BILI_CLI_VERSION,
  evaluateBiliCli,
} from '../src/deps.ts'
import { biliSearchArgs, parseBilibiliSearchOutput } from '../src/engines.ts'

test('bili installs are pinned to the reviewed public-clis revision', () => {
  assert.equal(BILI_CLI_VERSION, '0.6.2')
  assert.match(BILI_CLI_REVISION, /^[0-9a-f]{40}$/)
  assert.equal(BILI_CLI_SOURCE, `git+https://github.com/public-clis/bilibili-cli@${BILI_CLI_REVISION}`)
  assert.deepEqual(BILI_CLI_INSTALLS.map(item => item.installer), ['uv', 'pipx', 'pip'])
  for (const install of BILI_CLI_INSTALLS) {
    assert.match(install.command, /--force|--force-reinstall/)
    assert.ok(install.command.endsWith(BILI_CLI_SOURCE))
    assert.doesNotMatch(install.command, /(?:^|\s)bili-cli(?:\s|$)/)
  }
})

test('bili dependency probe requires version 0.6.2 and the structured search contract', () => {
  assert.deepEqual(
    evaluateBiliCli('bili, version 0.6.2', 'Options: --type --max --json --yaml'),
    { available: true, version: '0.6.2' },
  )
  assert.deepEqual(
    evaluateBiliCli('bili, version 0.6.1', 'Options: --type --max --json'),
    { available: false, version: '0.6.1', diagnostic: 'bili 0.6.1 is older than required 0.6.2' },
  )
  assert.match(
    evaluateBiliCli('bili, version 0.6.2', 'Options: --type --max').diagnostic ?? '',
    /--json/,
  )
})

test('bili search uses explicit JSON output and preserves argv boundaries', () => {
  assert.deepEqual(
    biliSearchArgs('DeepSeek Harness & 中文', 30),
    ['search', 'DeepSeek Harness & 中文', '--type', 'video', '--max', '10', '--json'],
  )
})

test('bili JSON envelope preserves UTF-8 Chinese metadata', () => {
  const sources = parseBilibiliSearchOutput(JSON.stringify({
    ok: true,
    schema_version: '1',
    data: [{
      bvid: 'BV1VkgK6NEZS',
      title: 'DeepSeek <em>实测</em>',
      author: '程序员鱼皮',
      play: 1360362,
      duration: '16:33',
    }],
  }))
  assert.deepEqual(sources, [{
    url: 'https://www.bilibili.com/video/BV1VkgK6NEZS',
    title: 'DeepSeek 实测',
    snippet: 'UP: 程序员鱼皮 | 播放: 1360362 | 16:33',
  }])
})

test('bili parser rejects unrelated or failed envelopes', () => {
  assert.throws(() => parseBilibiliSearchOutput('not json'), /UTF-8 JSON/)
  assert.throws(
    () => parseBilibiliSearchOutput(JSON.stringify({ ok: false, schema_version: '1', error: 'rate limited' })),
    /rate limited/,
  )
})
