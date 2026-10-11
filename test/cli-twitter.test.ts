import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { builtinSpecById } from '../src/cli/builtin-specs.ts'
import { evaluateCliContract } from '../src/cli/probe.ts'
import { CliAdapterError, parseCliOutput, runCliSearch, structuredKind } from '../src/cli/runner.ts'
import { validateCliAdapterSpec } from '../src/cli/spec.ts'
import { posix, withCommands } from './cli-helpers.ts'

const dir = new URL('./fixtures/cli/', import.meta.url)
const read = (name: string): string => fs.readFileSync(new URL(name, dir), 'utf8')
const twitter = builtinSpecById('twitter')!

test('issue #38: the YAML twitter-cli prints without --json is no longer parsed as results by the old url-lines parser', () => {
  const yaml = read('constructed-twitter-search-default-yaml.txt')
  // What 0.2.1 did: every YAML line holding a URL became a "result" (avatars, videos, key labels as titles).
  const old = { ...twitter.search, output: { format: 'text' as const, lines: { mode: 'url-lines' as const }, titleMax: 200, requireTitle: true, fields: { url: 'url', title: 'title' } } }
  // The runner now refuses a structured dump for any text parser, instead of returning that garbage.
  assert.throws(() => parseCliOutput(twitter, old, yaml), (e: unknown) => e instanceof CliAdapterError && e.code === 'CLI_CONTRACT_MISMATCH' && /printed YAML output/.test(e.message) && /--json/.test(e.hint ?? ''))
  // The current spec reads JSON: YAML on stdout (an older / env-overridden tool) is a contract mismatch, never rows.
  assert.throws(() => parseCliOutput(twitter, twitter.search, yaml), (e: unknown) => e instanceof CliAdapterError && e.code === 'CLI_CONTRACT_MISMATCH')
})

test('probe: a twitter-cli whose search help has no --json is incompatible, and the reason names the known-good version', () => {
  const version = { code: 0, output: 'twitter, version 0.8.5\n' }
  assert.equal(evaluateCliContract(twitter, 'twitter', version, { code: 0, output: read('help/twitter-search.txt') }).state, 'detected')
  const old = evaluateCliContract(twitter, 'twitter', { code: 0, output: 'twitter, version 0.7.0\n' }, { code: 0, output: 'Usage: twitter search [OPTIONS] [QUERY]\n  -n, --max INTEGER  Max number of tweets to fetch.\n' })
  assert.equal(old.state, 'incompatible')
  assert.match(old.reason!, /contract missing --json/)
  assert.match(old.reason!, /0\.8\.5/)
})

test('a user spec may carry a probe contractHint and a template join part; malformed ones are refused', () => {
  const base = { ...twitter, verification: undefined }
  assert.deepEqual(validateCliAdapterSpec(base, 'user').errors, [])
  assert.match(validateCliAdapterSpec({ ...base, probe: { ...twitter.probe, contractHint: '' } }, 'user').errors.join(';'), /contractHint/)
  const bad = { ...base, search: { ...twitter.search, output: { ...twitter.search.output, fields: { url: 'url', snippet: { join: [{ template: '{a' }] } } } } }
  assert.match(validateCliAdapterSpec(bad, 'user').errors.join(';'), /unbalanced brace|unknown placeholder/)
})

test('text modes refuse a structured dump; url-lines drops key labels; tsv skips lines that are not records', () => {
  const urlLines = { format: 'text' as const, lines: { mode: 'url-lines' as const }, fields: { url: 'url', title: 'title' } }
  const parse = (output: typeof urlLines | { format: 'text'; lines: { mode: 'tsv'; columns: string[] }; fields: { url: string; title: string } }, stdout: string) => parseCliOutput({ bins: ['x'] }, { argv: ['{query}'], output }, stdout)
  const tsv = { format: 'text' as const, lines: { mode: 'tsv' as const, columns: ['url', 'title'] }, fields: { url: 'url', title: 'title' } }
  assert.equal(structuredKind('{"a":1}'), 'JSON')
  assert.equal(structuredKind('[{"a":1}]'), 'JSON')
  assert.equal(structuredKind('"just a string"'), undefined)
  assert.equal(structuredKind('{not json'), undefined)
  assert.equal(structuredKind('ok: true\nitems:\n- id: 1\n  name: x\n'), 'YAML')
  assert.equal(structuredKind(' 1  @alice hello https://x.com/a/status/1\n 2  @bob hi https://x.com/b/status/2\n3 x\n'), undefined)
  assert.throws(() => parse(urlLines, '{"url":"https://a.test"}'), (e: any) => e.code === 'CLI_CONTRACT_MISMATCH' && /printed JSON output/.test(e.message))
  assert.throws(() => parse(tsv, 'ok: true\ndata:\n- id: a\n  url: https://a.test\n'), (e: any) => e.code === 'CLI_CONTRACT_MISMATCH' && /explicit output flag/.test(e.message))
  // Plain lines are fine, and a lone `key:` title is not a row even when the output is not recognised as YAML.
  assert.deepEqual(parse(urlLines, 'profileImageUrl: https://pbs.twimg.com/a.jpg\n hello https://x.com/a/status/1\n'), [{ url: 'https://x.com/a/status/1', title: 'hello' }])
  // tsv: a notice without a tab is skipped, a record is kept.
  assert.deepEqual(parse(tsv, 'Deprecated Feature: Python 3.10\nhttps://a.test\tTitle A\n'), [{ url: 'https://a.test', title: 'Title A' }])
})

test('error payloads: a failed run is quoted by the tool message; the auth codes of twitter-cli mean "not logged in"', { skip: !posix }, async () => {
  const tokens = { TWITTER_AUTH_TOKEN: 'tok-aaaaaaaa', TWITTER_CT0: 'ct0-bbbbbbbb' }
  // PATH is read when the command runs, inside withCommands.
  const env = new Proxy({} as NodeJS.ProcessEnv, { get: (_t, key: string) => (key in tokens ? tokens[key as keyof typeof tokens] : process.env[key]) })
  const emit = (name: string, code: number): string => "cat '" + new URL(name, dir).pathname + "'; exit " + code
  await withCommands({ twitter: emit('constructed-twitter-error.json', 1) }, async () => {
    await assert.rejects(runCliSearch(twitter, { query: 'q', count: 3 }, { env }), (e: any) => e.code === 'CLI_NOT_LOGGED_IN' && !/tok-aaaaaaaa|ct0-bbbbbbbb/.test(e.message + e.hint))
  })
  const rate = JSON.stringify({ ok: false, schema_version: '1', error: { code: 'rate_limited', message: 'Twitter API error (HTTP 429): slow down' } })
  await withCommands({ twitter: "printf '%s' '" + rate + "'; exit 1" }, async () => {
    await assert.rejects(runCliSearch(twitter, { query: 'q', count: 3 }, { env }), (e: any) => e.code === 'CLI_FAILED' && /slow down/.test(e.message) && !/"ok"/.test(e.message))
  })
  // The argv the tool gets: --json is always there, the query is a single token.
  await withCommands({ twitter: 'printf "%s\\n" "$@" > "$0.args"; cat \'' + new URL('constructed-twitter-search.json', dir).pathname + "'" }, async bin => {
    const out = await runCliSearch(twitter, { query: 'deepseek local', count: 2 }, { env })
    assert.equal(out.length, 2)
    assert.equal(fs.readFileSync(bin + '/twitter.args', 'utf8'), 'search\ndeepseek local\n-n\n2\n--json\n')
  })
})
