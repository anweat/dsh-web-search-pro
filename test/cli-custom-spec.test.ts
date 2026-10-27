import test from 'node:test'
import assert from 'node:assert/strict'
import { formatSources } from '../src/actions/format.ts'
import { backendServes, customCliPlatformIssues, platformBackendIssues, specPlatformsOf } from '../src/cli/chains-spec.ts'
import { runCliSearchDetailed, wholeOutputSource } from '../src/cli/runner.ts'
import { DEFAULT_CUSTOM_CONFIDENCE, resolveCliAdapters, USER_DEFINED_TAG, validateCliAdapterSpec, verificationTag, WHOLE_OUTPUT_DEFAULT_CHARS } from '../src/cli/spec.ts'
import { shapeSources } from '../src/util.ts'
import { baseSpec, posix, withCommands } from './cli-helpers.ts'
import { routerHarness } from './custom-cli-harness.ts'

const errorsOf = (over: Record<string, unknown>, origin: 'builtin' | 'user' = 'user'): string => validateCliAdapterSpec({ ...baseSpec(), ...over }, origin).errors.join('\n')

/** The `echo`-style spec the settings card offers as its example: no field mapping, the whole stdout is the result. */
export function wholeSpec(over: Record<string, unknown> = {}) {
  return baseSpec({
    id: 'echo', bins: ['echo'], packageNote: 'echo (part of the OS)', platforms: [], engine: true,
    probe: { versionArgs: ['--version'], helpArgs: ['--help'], mustContain: [] }, allowedSubcommands: [],
    search: { argv: ['{query}'], output: { format: 'text', lines: { mode: 'whole' } } },
    ...over,
  })
}

test('engine and confidence: user specs only, bounded; a general engine may name no platform', () => {
  assert.equal(validateCliAdapterSpec(baseSpec({ engine: true, confidence: 0.7 })).ok, true)
  assert.match(errorsOf({ engine: 'yes' }), /engine must be a boolean/)
  for (const confidence of [-0.1, 1.2, '0.5', Number.NaN]) assert.match(errorsOf({ confidence }), /confidence must be a number 0\.\.1/, String(confidence))
  assert.equal(validateCliAdapterSpec(baseSpec({ confidence: 0 })).ok, true, '0 is a legal confidence')
  assert.match(errorsOf({ engine: true }, 'builtin'), /engine is for user-defined specs only/)
  assert.match(errorsOf({ confidence: 0.5 }, 'builtin'), /confidence is for user-defined specs only/)
  // Without the engine flag a spec must serve a platform; with it, none is needed.
  assert.match(errorsOf({ platforms: [] }), /platforms must list 1\.\.8 platform ids \(or be empty with "engine": true\)/)
  assert.equal(errorsOf({ platforms: [], engine: true }), '')
  assert.match(errorsOf({ platforms: [], engine: true }, 'builtin'), /platforms must list 1\.\.8 platform ids/)
  assert.equal(DEFAULT_CUSTOM_CONFIDENCE, 0.5)
})

test('whole-output mode validates: no field mapping needed, maxChars bounded, text only', () => {
  assert.equal(validateCliAdapterSpec(wholeSpec()).ok, true, validateCliAdapterSpec(wholeSpec()).errors.join('\n'))
  const out = (over: Record<string, unknown>) => errorsOf({ ...wholeSpec(), search: { argv: ['{query}'], output: { format: 'text', lines: { mode: 'whole' }, ...over } } })
  assert.equal(out({ lines: { mode: 'whole', maxChars: 5000 } }), '')
  assert.match(out({ lines: { mode: 'whole', maxChars: 50 } }), /lines\.maxChars must be an integer 200\.\.8000/)
  assert.match(out({ lines: { mode: 'whole', maxChars: 9000 } }), /maxChars/)
  assert.match(out({ lines: { mode: 'whole', extra: 1 } }), /lines must be/)
  assert.match(out({ format: 'json' }), /lines is only for format text/)
  // Fields are optional in this mode, and still validated when given; every other mode still needs a url.
  assert.equal(out({ fields: { title: 'title' } }), '')
  assert.match(out({ fields: { url: 'a b' } }), /not a dotted path/)
  assert.match(errorsOf({ search: { ...baseSpec().search, output: { format: 'json', itemsPath: 'data' } } }), /fields must be an object/)
  assert.match(errorsOf({ search: { ...baseSpec().search, output: { format: 'text', lines: { mode: 'url-lines' } } } }), /fields must be an object/)
})

test('whole output: one result with the id and query as its title, a cli:// stand-in link, the text cut with a note', () => {
  const output = { format: 'text' as const, lines: { mode: 'whole' as const } }
  const one = wholeOutputSource({ id: 'echo' }, output, 'rust  async\nruntime', 'hello\r\nworld\n')
  assert.deepEqual(one, { url: 'cli://echo?q=rust%20async%20runtime', title: 'echo: rust async runtime', snippet: 'hello\nworld' })
  assert.equal(wholeOutputSource({ id: 'echo' }, output, 'q', '  \n\t '), undefined, 'nothing printed = no result')
  const long = wholeOutputSource({ id: 'echo' }, output, 'q', 'x'.repeat(WHOLE_OUTPUT_DEFAULT_CHARS + 500))!
  assert.match(long.snippet!, /… \[truncated: 2000 of 2500 characters shown\]$/)
  assert.equal(long.snippet!.length < WHOLE_OUTPUT_DEFAULT_CHARS + 80, true)
  const wide = wholeOutputSource({ id: 'echo' }, { format: 'text', lines: { mode: 'whole', maxChars: 300 } }, 'q', 'y'.repeat(400))!
  assert.match(wide.snippet!, /\[truncated: 300 of 400 characters shown\]$/)
  // The query is encoded, so the link cannot be broken out of; a long query is cut.
  assert.equal(wholeOutputSource({ id: 'echo' }, output, 'a&b=c#d', 'x')!.url, 'cli://echo?q=a%26b%3Dc%23d')
  assert.ok(wholeOutputSource({ id: 'echo' }, output, 'z'.repeat(900), 'x')!.url.length < 230)
})

test('whole output through the runner: stdout is the result, an empty stdout is ENGINE_EMPTY, secrets are redacted, argv is never a shell string', { skip: !posix }, async () => {
  const spec = wholeSpec()
  await withCommands({ echo: 'printf "answer: %s\\n" "$1"' }, async () => {
    const { sources, skipped } = await runCliSearchDetailed(spec, { query: 'rust; rm -rf / $(id)', count: 5 })
    assert.equal(skipped, 0)
    assert.equal(sources.length, 1)
    assert.equal(sources[0]!.snippet, 'answer: rust; rm -rf / $(id)', 'the query reached the tool as one literal argument')
    assert.match(sources[0]!.url, /^cli:\/\/echo\?q=/)
  })
  await withCommands({ echo: 'true' }, async () => {
    await assert.rejects(() => runCliSearchDetailed(spec, { query: 'q', count: 5 }), (error: unknown) => (error as { code?: string }).code === 'ENGINE_EMPTY')
  })
  await withCommands({ echo: 'echo "token is $MY_SECRET_TOKEN"' }, async () => {
    const withSecret = wholeSpec({ env: { required: ['MY_SECRET_TOKEN'] } })
    const { sources } = await runCliSearchDetailed(withSecret, { query: 'q', count: 5 }, { env: { ...process.env, MY_SECRET_TOKEN: 'sup3r-s3cret-value' } })
    assert.doesNotMatch(sources[0]!.snippet!, /sup3r-s3cret-value/)
    assert.match(sources[0]!.snippet!, /\[redacted\]/)
  })
  // A tool that dumps JSON or YAML is still just text here: the user asked for the whole output.
  await withCommands({ echo: 'echo \'{"a":1,"b":[1,2]}\'' }, async () => {
    const { sources } = await runCliSearchDetailed(spec, { query: 'q', count: 5 })
    assert.equal(sources[0]!.snippet, '{"a":1,"b":[1,2]}')
  })
})

test('a whole-output cli:// result keeps its text past the 500 character snippet cap of the other results, and still marks a cut', () => {
  const text = 'line\n'.repeat(300).trim()
  const [row] = shapeSources([{ url: 'cli://echo?q=q', title: 'echo: q', snippet: text }, { url: 'https://e.test/a', title: 'a', snippet: 'z'.repeat(900) }], 5)
  assert.equal(row!.snippet, text, 'a 1499 character result text is not cut by the generic cap')
  const other = shapeSources([{ url: 'https://e.test/a', snippet: 'z'.repeat(900) }], 5)[0]!
  assert.match(other.snippet!, /\(Content truncated at 500 characters\.\)$/)
})

test('a custom CLI serves exactly the platforms it declares (and its own custom-cli:<id> platform)', () => {
  const adapters = { good: { ...baseSpec({ platforms: ['weibo', 'douban'] }), id: 'good' }, eng: { ...wholeSpec(), id: 'eng' } }
  const { platforms } = specPlatformsOf(adapters)
  assert.deepEqual(backendServes('custom-cli:good', 'weibo', platforms), { ok: true })
  assert.deepEqual(backendServes('custom-cli:good', 'custom-cli:good', platforms), { ok: true })
  const refused = backendServes('custom-cli:good', 'twitter', platforms)
  assert.equal(refused.ok, false)
  assert.match(refused.why!, /does not serve platform twitter \(it serves weibo, douban\)/)
  const none = backendServes('custom-cli:eng', 'weibo', platforms)
  assert.match(none.why!, /declares no platform: add weibo to its "platforms"/)
  assert.deepEqual(platformBackendIssues({ weibo: ['custom-cli:good', 'browser-search'], twitter: ['custom-cli:good'] }, adapters).map(m => m.replace(/ \(it serves.*/, '')), ['platformBackends.twitter: "custom-cli:good" does not serve platform twitter'])
})

test('declared platforms need a backend chain to sit in', () => {
  assert.deepEqual(customCliPlatformIssues({ ok: { ...baseSpec({ platforms: ['reddit'] }), id: 'ok' } }), [])
  const issues = customCliPlatformIssues({ odd: { ...baseSpec({ platforms: ['reddit', 'mysite'] }), id: 'odd' } })
  assert.equal(issues.length, 1)
  assert.match(issues[0]!, /^cliAdapters\.odd\.platforms: no backend chain exists for mysite \(platforms with a chain: /)
  assert.deepEqual(customCliPlatformIssues(undefined), [])
  assert.deepEqual(customCliPlatformIssues({ bad: { id: 'bad' } }), [], 'an invalid entry is reported by its own diagnostic')
})

test('the user-defined verification word reads as the honest tag', () => {
  assert.equal(verificationTag('user-defined'), USER_DEFINED_TAG)
  assert.match(USER_DEFINED_TAG, /用户自定义，未经插件验证/)
  assert.equal(verificationTag('live'), undefined)
  assert.equal(resolveCliAdapters({ echo: wholeSpec() }).specs.get('echo')!.engine, true)
})

test('a whole-output result is printed as a heading with its text indented below, not squeezed into one bullet line', () => {
  const text = formatSources([{ url: 'cli://echo?q=q', title: 'echo: q', snippet: 'line one\nline two' }, { url: 'https://e.test/a', title: 'A', snippet: 'plain' }])
  assert.equal(text, '- echo: q (cli://echo?q=q)\n    line one\n    line two\n- [A](https://e.test/a) — plain')
})

test('a general-engine custom CLI is searched through `engines` like any other engine; a whole-output tool answers with one cli:// result', { skip: !posix }, async () => {
  await withCommands({ echo: 'printf "echoed: %s\\n" "$1"' }, async () => {
    const h = routerHarness({ cliAdapters: { echo: wholeSpec() } })
    try {
      const result = await h.search('rust async', { engines: ['custom-cli:echo'] })
      assert.equal(result.engine, 'custom-cli:echo')
      assert.equal(result.sources.length, 1)
      assert.equal(result.sources[0]!.url, 'cli://echo?q=rust%20async')
      assert.equal(result.sources[0]!.title, 'echo: rust async')
      assert.equal(result.sources[0]!.snippet, 'echoed: rust async')
      assert.deepEqual(h.router.cliAdapterProblems(), [])
    } finally { h.cleanup() }
  })
})
