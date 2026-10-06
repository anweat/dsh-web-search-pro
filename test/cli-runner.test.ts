import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  buildArgv, buildCliEnv, CliAdapterError, loginHint, missingEnv, parseCliOutput, resolveField, runCliSearch, savedLoginPresent,
} from '../src/cli/runner.ts'
import { baseSpec, posix, withCommands } from './cli-helpers.ts'

const JSON_OK = JSON.stringify({ data: [{ url: 'https://example.com/a', title: 'A <b>bold</b>', summary: 'sa' }, { url: 'ftp://nope', title: 'bad' }, { title: 'no url' }, { url: 'https://example.com/b', title: 'B' }] })
const emit = (text: string): string => "printf '%s' '" + text.replace(/'/g, "'\\''") + "'"

test('argv: placeholders are filled per token, never joined into a shell string; the count is clamped', () => {
  const s = baseSpec().search
  assert.deepEqual(buildArgv(s, { query: 'a b; rm -rf / & "x"', count: 3 }), ['search', 'a b; rm -rf / & "x"', '--limit', '3', '--json'])
  assert.equal(buildArgv(s, { query: 'q', count: 99 })[3], '5', 'maxCount')
  assert.equal(buildArgv(s, { query: 'q', count: 0 })[3], '1')
  assert.deepEqual(buildArgv({ argv: ['ytsearch{count}:{query}'], maxCount: 10 }, { query: 'x $& y', count: 4 }), ['ytsearch4:x $& y'], 'replacement text is literal')
  // A query that would read as a flag is neutralised unless a `--` precedes it.
  assert.equal(buildArgv(s, { query: '-rf', count: 1 })[1], ' -rf')
  assert.equal(buildArgv({ argv: ['search', '--', '{query}'] }, { query: '-rf', count: 1 })[2], '-rf')
})

test('the child gets a minimal environment: the spec\'s own names, UTF-8 for Python, nothing else of the process', () => {
  const source = { PATH: '/bin', HOME: '/h', MY_TOKEN: 'tok-123456', OTHER_SECRET: 'zzz-secret', HTTPS_PROXY: 'http://p', EXTRA: 'x' }
  const env = buildCliEnv(baseSpec({ env: { required: ['MY_TOKEN'], passthrough: ['EXTRA'] } }), source)
  assert.deepEqual(Object.keys(env).sort(), ['EXTRA', 'HOME', 'HTTPS_PROXY', 'MY_TOKEN', 'PATH', 'PYTHONIOENCODING', 'PYTHONUTF8'])
  assert.equal(env.PYTHONUTF8, '1')
  assert.deepEqual(missingEnv(baseSpec({ env: { required: ['MY_TOKEN', 'ABSENT'] } }), source), ['ABSENT'])
})

test('parsers: json items path, envelope expectations, field sources and caps', () => {
  const spec = baseSpec()
  const out = parseCliOutput(spec, spec.search, JSON_OK)
  assert.deepEqual(out, [{ url: 'https://example.com/a', title: 'A <b>bold</b>', snippet: 'sa' }, { url: 'https://example.com/b', title: 'B' }])
  assert.deepEqual(parseCliOutput(spec, spec.search, JSON_OK, 1).length, 1)
  const stripped = { ...spec.search, output: { ...spec.search.output, stripTags: true } }
  assert.equal(parseCliOutput(spec, stripped, JSON_OK)[0]!.title, 'A bold')
  const enveloped = { ...spec.search, output: { ...spec.search.output, expect: [{ path: 'ok', equals: true }], errorPaths: ['message'] } }
  assert.throws(() => parseCliOutput(spec, enveloped, JSON.stringify({ ok: false, message: 'rate limited' })), (e: any) => e instanceof CliAdapterError && e.code === 'CLI_FAILED' && /rate limited/.test(e.message))
  assert.throws(() => parseCliOutput(spec, enveloped, JSON.stringify({ ok: false })), (e: any) => e.code === 'CLI_CONTRACT_MISMATCH')
  assert.throws(() => parseCliOutput(spec, spec.search, 'not json'), (e: any) => e.code === 'CLI_CONTRACT_MISMATCH' && /not valid UTF-8 JSON/.test(e.message))
  assert.throws(() => parseCliOutput(spec, spec.search, JSON.stringify({ data: 'x' })), (e: any) => e.code === 'CLI_CONTRACT_MISMATCH' && /no result list/.test(e.message))
  // Without itemsPath: the root array, else the first array property, else under `data`.
  const auto = { ...spec.search, output: { ...spec.search.output, itemsPath: undefined } }
  assert.equal(parseCliOutput(spec, auto, JSON.stringify([{ url: 'https://x.test/1' }])).length, 1)
  assert.equal(parseCliOutput(spec, auto, JSON.stringify({ n: 1, results: [{ url: 'https://x.test/1' }] })).length, 1)
  assert.equal(parseCliOutput(spec, auto, JSON.stringify({ data: { rows: [{ url: 'https://x.test/1' }] } })).length, 1)
  // BOM and capped snippets.
  assert.equal(parseCliOutput(spec, spec.search, '﻿' + JSON_OK).length, 2)
  const long = JSON.stringify({ data: [{ url: 'https://x.test/1', title: 't', summary: 'y'.repeat(900) }] })
  assert.ok(parseCliOutput(spec, spec.search, long)[0]!.snippet!.length < 520)
})

test('parsers: ndjson, yaml, tsv text and url-lines text', () => {
  const spec = baseSpec()
  const base = (output: Record<string, unknown>) => ({ ...spec.search, output })
  const nd = base({ format: 'ndjson', fields: { url: 'url', title: 'title' } })
  assert.equal(parseCliOutput(spec, nd, 'progress...\n{"url":"https://x.test/1","title":"a"}\n\n{"url":"https://x.test/2","title":"b"}\n').length, 2)
  assert.throws(() => parseCliOutput(spec, nd, 'garbage only'), (e: any) => e.code === 'CLI_CONTRACT_MISMATCH')
  const yml = base({ format: 'yaml', fields: { url: 'url', title: 'name' } })
  assert.deepEqual(parseCliOutput(spec, yml, '- url: https://x.test/1\n  name: 中文标题\n'), [{ url: 'https://x.test/1', title: '中文标题' }])
  const tsv = base({ format: 'text', lines: { mode: 'tsv', columns: ['id', 'title', 'views'] }, emptyValues: ['None'], requireTitle: true, fields: { url: { template: 'https://x.test/{id}' }, title: 'title', snippet: { join: [{ path: 'views', suffix: ' views' }] } } })
  assert.deepEqual(parseCliOutput(spec, tsv, 'a1\tTitle one\t5\nb2\tTitle two\tNone\nWARNING no tabs\n\n'), [
    { url: 'https://x.test/a1', title: 'Title one', snippet: '5 views' },
    { url: 'https://x.test/b2', title: 'Title two' },
  ])
  const lines = base({ format: 'text', lines: { mode: 'url-lines' }, titleMax: 40, fields: { url: 'url', title: 'title' } })
  assert.deepEqual(parseCliOutput(spec, lines, ' 1  @alice hello world https://x.com/alice/status/1\nno url here\n').map(s => [s.url, s.title]), [['https://x.com/alice/status/1', '1 @alice hello world']])
})

test('field sources: lists, templates with when, joins, epoch and date', () => {
  const item = { a: '', b: 'B', n: 7, kind: 'answer', q: { id: 9 }, id: 5, ts: 1_700_000_000, iso: '2026-10-06T01:02:03Z', none: 'None' }
  assert.equal(resolveField(['a', 'b'], item), 'B')
  assert.equal(resolveField({ template: 'https://z/{q.id}/{id}' }, item), 'https://z/9/5')
  assert.equal(resolveField({ template: 'https://z/{missing}' }, item), undefined)
  assert.equal(resolveField([{ template: 'https://a/{id}', when: { path: 'kind', equals: 'article' } }, { template: 'https://b/{id}', when: { path: 'kind', equals: 'answer' } }], item), 'https://b/5')
  assert.equal(resolveField({ join: [{ path: 'b', prefix: 'x:' }, { path: 'n', suffix: '!' }, 'a'], sep: ' / ' }, item), 'x:B / 7!')
  assert.equal(resolveField({ epoch: 'ts' }, item), '2023-11-14T22:13:20.000Z')
  assert.equal(resolveField({ date: 'iso' }, item), '2026-10-06')
  assert.equal(resolveField('none', item, new Set(['None'])), undefined)
})

test('saved login: only the existence of the declared files is checked', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'wsp-home-'))
  try {
    const spec = baseSpec({ login: { command: 'demo login', savedCredentialPaths: ['~/.demo/cookies.json'] }, needsLogin: true })
    assert.equal(savedLoginPresent(spec, { home }), false)
    fs.mkdirSync(path.join(home, '.demo'))
    fs.writeFileSync(path.join(home, '.demo', 'cookies.json'), 'SECRET-CONTENT')
    assert.equal(savedLoginPresent(spec, { home }), true)
    assert.equal(savedLoginPresent(baseSpec(), { home }), undefined, 'a spec without paths knows nothing')
    assert.match(loginHint(spec), /run `demo login` yourself/)
    assert.match(loginHint(baseSpec({ env: { required: ['A_TOKEN'] }, needsLogin: true })), /set A_TOKEN/)
  } finally { fs.rmSync(home, { recursive: true, force: true }) }
})

test('run: a successful command returns shaped sources and gets a clean environment', { skip: !posix }, async () => {
  await withCommands({ 'demo-cli': 'echo "$@" > "$0.args"; env > "$0.env"; ' + emit(JSON_OK) }, async dir => {
    const saved = process.env.LEAKY_SECRET
    process.env.LEAKY_SECRET = 'must-not-reach-the-child'
    try {
      const out = await runCliSearch(baseSpec(), { query: 'rust async', count: 2 })
      assert.equal(out.length, 2)
      assert.equal(fs.readFileSync(path.join(dir, 'demo-cli.args'), 'utf8').trim(), 'search rust async --limit 2 --json')
      const childEnv = fs.readFileSync(path.join(dir, 'demo-cli.env'), 'utf8')
      assert.doesNotMatch(childEnv, /LEAKY_SECRET|must-not-reach/)
      assert.match(childEnv, /PYTHONUTF8=1/)
    } finally { if (saved === undefined) delete process.env.LEAKY_SECRET; else process.env.LEAKY_SECRET = saved }
  })
})

test('run: error mapping (not found, contract mismatch, not logged in, failed, empty, timeout, output cap)', { skip: !posix }, async () => {
  const spec = baseSpec({ search: { ...baseSpec().search, notLoggedInPatterns: ['please sign in'], emptyWhen: ['no hits'] } })
  const code = async (commands: Record<string, string>, s = spec, input = { query: 'q', count: 3 }): Promise<any> =>
    withCommands(commands, async () => { try { await runCliSearch(s, input); return undefined } catch (e) { return e } })
  const missing = await code({})
  assert.ok(missing instanceof CliAdapterError)
  assert.equal(missing.code, 'CLI_NOT_FOUND')
  assert.match(missing.message, /demo-cli command could not be started.*npm i -g demo-cli/)
  assert.equal((await code({ 'demo-cli': 'echo not json' })).code, 'CLI_CONTRACT_MISMATCH')
  const notLoggedIn = await code({ 'demo-cli': 'echo "Please Sign In first" >&2; exit 1' })
  assert.equal(notLoggedIn.code, 'CLI_NOT_LOGGED_IN')
  assert.match(notLoggedIn.hint, /run `demo-cli login` yourself/)
  const failed = await code({ 'demo-cli': 'echo "boom" >&2; exit 2' })
  assert.equal(failed.code, 'CLI_FAILED')
  assert.equal(failed.retryable, true)
  assert.match(failed.message, /boom/)
  assert.equal((await code({ 'demo-cli': 'echo "no hits"; exit 3' })).code, 'ENGINE_EMPTY')
  assert.equal((await code({ 'demo-cli': emit('{"data":[]}') })).code, 'ENGINE_EMPTY', 'a valid empty answer')
  const zero = await code({ 'demo-cli': emit('{"data":[]}') + '; echo "please sign in" >&2' })
  assert.equal(zero.code, 'CLI_NOT_LOGGED_IN', 'the not-logged-in pattern also covers an empty exit-0 answer')
  const slow = await code({ 'demo-cli': 'sleep 5' }, baseSpec({ timeoutMs: 1_000 }))
  assert.equal(slow.code, 'ENGINE_TIMEOUT')
  const big = await code({ 'demo-cli': "head -c 5000 /dev/zero | tr '\\0' 'x'" }, baseSpec({ maxOutputBytes: 1_024 }))
  assert.equal(big.code, 'CLI_FAILED')
  assert.match(big.message, /output exceeded/)
})

test('run: an error listing a required credential names the variable, never its value', { skip: !posix }, async () => {
  const spec = baseSpec({ env: { required: ['DEMO_TOKEN'] }, needsLogin: true })
  const saved = process.env.DEMO_TOKEN
  try {
    delete process.env.DEMO_TOKEN
    await withCommands({ 'demo-cli': 'echo should-not-run > "$0.ran"' }, async dir => {
      await assert.rejects(runCliSearch(spec, { query: 'q', count: 1 }), (e: any) => e.code === 'CLI_NOT_LOGGED_IN' && /DEMO_TOKEN/.test(e.message) && /set DEMO_TOKEN/.test(e.hint))
      assert.equal(fs.existsSync(path.join(dir, 'demo-cli.ran')), false, 'nothing is run without the credential')
    })
    process.env.DEMO_TOKEN = 'super-secret-value-123'
    await withCommands({ 'demo-cli': 'echo "denied for $DEMO_TOKEN" >&2; exit 1' }, async () => {
      await assert.rejects(runCliSearch(spec, { query: 'q', count: 1 }), (e: any) => e.code === 'CLI_FAILED' && /denied for \[redacted\]/.test(e.message) && !/super-secret/.test(e.message))
    })
  } finally { if (saved === undefined) delete process.env.DEMO_TOKEN; else process.env.DEMO_TOKEN = saved }
})

test('run: a tool without a saved login is not run (it could read browser cookies by itself)', { skip: !posix }, async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'wsp-home-'))
  try {
    const spec = baseSpec({ needsLogin: true, login: { command: 'demo login', savedCredentialPaths: ['~/.demo/cookies.json'], readsBrowserCookiesWithoutLogin: true } })
    await withCommands({ 'demo-cli': 'echo ran > "$0.ran"; ' + emit(JSON_OK) }, async dir => {
      await assert.rejects(runCliSearch(spec, { query: 'q', count: 1 }, { home }), (e: any) => e.code === 'CLI_NOT_LOGGED_IN' && /browser cookies/.test(e.message) && /run `demo login` yourself/.test(e.hint))
      assert.equal(fs.existsSync(path.join(dir, 'demo-cli.ran')), false)
      fs.mkdirSync(path.join(home, '.demo'))
      fs.writeFileSync(path.join(home, '.demo', 'cookies.json'), '{}')
      assert.equal((await runCliSearch(spec, { query: 'q', count: 1 }, { home })).length, 1)
    })
  } finally { fs.rmSync(home, { recursive: true, force: true }) }
})

test('run: abort ends the call with the abort reason, not as a tool failure', { skip: !posix }, async () => {
  await withCommands({ 'demo-cli': 'sleep 5' }, async () => {
    const controller = new AbortController()
    const run = runCliSearch(baseSpec({ timeoutMs: 20_000 }), { query: 'q', count: 1, signal: controller.signal })
    setTimeout(() => controller.abort(), 100)
    await assert.rejects(run, (e: any) => e.name === 'AbortError' || /abort/i.test(String(e)))
    const pre = new AbortController(); pre.abort()
    await assert.rejects(runCliSearch(baseSpec(), { query: 'q', count: 1, signal: pre.signal }), /abort/i)
  })
})

test('run: UTF-8 output stays UTF-8 (Chinese titles survive)', { skip: !posix }, async () => {
  await withCommands({ 'demo-cli': emit(JSON.stringify({ data: [{ url: 'https://x.test/1', title: '深度求索 DeepSeek 实测', summary: '摘要' }] })) }, async () => {
    const out = await runCliSearch(baseSpec(), { query: 'q', count: 1 })
    assert.equal(out[0]!.title, '深度求索 DeepSeek 实测')
  })
})
