import test from 'node:test'
import assert from 'node:assert/strict'
import {
  argvProblems, commandWords, compareVersions, parseVersion, platformBackendProblems, resolveCliAdapters, searchSpecFor, validateCliAdapterSpec,
} from '../src/cli/spec.ts'
import { baseSpec } from './cli-helpers.ts'

const errorsOf = (over: Record<string, unknown>, origin: 'builtin' | 'user' = 'user'): string => validateCliAdapterSpec({ ...baseSpec(), ...over }, origin).errors.join('\n')

test('a complete spec validates; the closed schema rejects unknown fields at every level', () => {
  const ok = validateCliAdapterSpec(baseSpec())
  assert.equal(ok.ok, true, ok.errors.join('\n'))
  assert.match(errorsOf({ extra: 1 }), /extra is not a spec field/)
  assert.match(errorsOf({ probe: { ...baseSpec().probe, extra: 1 } }), /probe\.extra/)
  assert.match(errorsOf({ search: { ...baseSpec().search, extra: 1 } }), /search\.extra/)
  assert.match(errorsOf({ search: { ...baseSpec().search, output: { ...baseSpec().search.output, extra: 1 } } }), /output\.extra/)
  assert.match(errorsOf({ search: { ...baseSpec().search, output: { ...baseSpec().search.output, fields: { url: 'url', extra: 'x' } } } }), /fields\.extra/)
  assert.equal(validateCliAdapterSpec(null).ok, false)
  assert.equal(validateCliAdapterSpec([]).ok, false)
})

test('argv is an array of tokens with {query}: a shell string is refused', () => {
  assert.match(errorsOf({ search: { ...baseSpec().search, argv: 'search {query} --json' } }), /argv must be an array/)
  assert.match(errorsOf({ search: { ...baseSpec().search, argv: [] } }), /argv must be an array/)
  assert.match(errorsOf({ search: { ...baseSpec().search, argv: ['search', '--json'] } }), /placeholder/)
  assert.match(errorsOf({ search: { ...baseSpec().search, argv: ['search', '{query}', '{secret}'] } }), /unknown placeholder \{secret\}/)
  assert.match(errorsOf({ search: { ...baseSpec().search, argv: ['search', '{query', '--json'] } }), /unbalanced brace|placeholder/)
  assert.match(errorsOf({ search: { ...baseSpec().search, argv: ['search', '', '{query}'] } }), /argv must be an array/)
})

test('read-only guard: write / login subcommands are refused even when the spec allows them', () => {
  for (const word of ['login', 'logout', 'post', 'comment', 'delete', 'delete-note', 'deleteNote', 'like', 'follow', 'favorite', 'upvote', 'save', 'subscribe', 'publish', 'ask', 'article', 'pin', 'setup', 'init', 'install', 'update', 'export']) {
    const message = errorsOf({ allowedSubcommands: ['search', word], search: { ...baseSpec().search, argv: [word, '{query}'] } })
    assert.match(message, /write \/ login command/, word)
  }
  // Reads that merely look similar stay legal.
  for (const word of ['comments', 'likes', 'followers', 'following', 'posts', 'user-posts', 'saved', 'pins', 'search', 'read', 'show', 'status', 'sub', 'repos']) {
    const r = validateCliAdapterSpec(baseSpec({ allowedSubcommands: [word], probe: { versionArgs: ['--version'], helpArgs: [word, '--help'], mustContain: ['x'] }, search: { ...baseSpec().search, argv: [word, '{query}'] } }))
    assert.equal(r.ok, true, word + ': ' + r.errors.join('; '))
  }
})

test('read-only guard: a command word outside allowedSubcommands is refused (search, read, probe)', () => {
  assert.match(errorsOf({ search: { ...baseSpec().search, argv: ['query', '{query}'] } }), /"query" is not in allowedSubcommands/)
  assert.match(errorsOf({ read: { ...baseSpec().search, argv: ['fetch', '{query}'] } }), /read\.argv: command word "fetch" is not in allowedSubcommands/)
  assert.match(errorsOf({ probe: { ...baseSpec().probe, helpArgs: ['frobnicate', '--help'] } }), /probe\.helpArgs: command word "frobnicate"/)
  assert.match(errorsOf({ searches: { demo2: { ...baseSpec().search, argv: ['export', '{query}'] } } }), /searches\.demo2.*write \/ login/)
})

test('read-only guard: flags that read browser cookies or carry credentials are refused', () => {
  for (const flag of ['--cookie-source', '--cookies-from-browser', '--cookie', '--password', '--token', '--api-key', '--netrc', '--cookie-source=chrome', '--username']) {
    assert.match(errorsOf({ search: { ...baseSpec().search, argv: ['search', '{query}', flag, 'x'] } }), /reads cookies or carries credentials/, flag)
  }
  assert.deepEqual(argvProblems(['search', '{query}', '--json'], ['search'], 'x'), [])
  assert.deepEqual(commandWords(['search', 'repos', '--json', 'fullName', '--', '{query}']), ['search', 'repos'])
  assert.deepEqual(commandWords(['ytsearch{count}:{query}', '--flat-playlist']), [])
})

test('env: names only, no credentials set as literals', () => {
  assert.match(errorsOf({ env: { required: ['a b'] } }), /environment variable NAMES/)
  assert.match(errorsOf({ env: { passthrough: ['MY_TOKEN=abc'] } }), /NAMES/)
  assert.match(errorsOf({ env: { set: { API_TOKEN: 'abc' } } }), /must not set credentials/)
  assert.equal(validateCliAdapterSpec(baseSpec({ env: { required: ['MY_TOKEN'], passthrough: ['HTTPS_PROXY'], set: { PYTHONUTF8: '1' } }, needsLogin: true })).ok, true)
  assert.match(errorsOf({ needsLogin: true }), /needsLogin without login\.command or env\.required/)
})

test('bins are command names, never paths; ids, timeouts and output caps are bounded', () => {
  assert.match(errorsOf({ bins: ['/usr/bin/demo'] }), /bins must be 1\.\.4 command names/)
  assert.match(errorsOf({ bins: ['..\\demo'] }), /bins must be/)
  assert.match(errorsOf({ bins: [] }), /bins must be/)
  assert.match(errorsOf({ id: 'Bad Id' }), /id must match/)
  assert.match(errorsOf({ timeoutMs: 10 }), /timeoutMs/)
  assert.match(errorsOf({ timeoutMs: 10_000_000 }), /timeoutMs/)
  assert.match(errorsOf({ maxOutputBytes: 10 ** 9 }), /maxOutputBytes/)
  assert.match(errorsOf({ packageNote: '' }), /packageNote/)
  assert.match(errorsOf({ platforms: [] }), /platforms/)
})

test('output spec: formats, text needs lines, field sources, items path', () => {
  const out = (over: Record<string, unknown>) => errorsOf({ search: { ...baseSpec().search, output: { ...baseSpec().search.output, ...over } } })
  assert.match(out({ format: 'xml' }), /format must be one of/)
  assert.match(out({ format: 'text' }), /lines is required for format text/)
  assert.match(out({ lines: { mode: 'url-lines' } }), /lines is only for format text/)
  assert.match(out({ itemsPath: 'a..b' }), /itemsPath/)
  assert.match(out({ fields: {} }), /fields\.url is required/)
  assert.match(out({ fields: { url: 'a b' } }), /not a dotted path/)
  assert.match(out({ fields: { url: { template: 'https://x/{id' } } }), /unbalanced|placeholder/)
  assert.match(out({ fields: { url: { join: [] } } }), /join needs 1\.\.8 parts/)
  assert.match(out({ expect: [{ path: 'ok' }] }), /expect entries/)
  assert.equal(validateCliAdapterSpec(baseSpec({ search: { ...baseSpec().search, output: { format: 'text', lines: { mode: 'tsv', columns: ['id', 'title'] }, fields: { url: { template: 'https://x/{id}' }, title: 'title' } } } })).ok, true)
  assert.equal(validateCliAdapterSpec(baseSpec({ search: { ...baseSpec().search, output: { format: 'json', fields: { url: [{ template: 'https://x/{a}', when: { path: 'type', equals: 'x' } }, 'link'], snippet: { join: ['a', { path: 'b', prefix: 'B: ' }], sep: ' - ' }, publishedAt: { epoch: 'ts' } } } } })).ok, true)
})

test('verification belongs to built-in specs only; live needs a version and a date', () => {
  assert.match(errorsOf({ verification: { status: 'live', version: '1.0.0', date: '2026-10-06' } }), /verification is for built-in specs only/)
  assert.equal(validateCliAdapterSpec(baseSpec({ verification: { status: 'contract-only', note: 'from help' } }), 'builtin').ok, true)
  assert.match(errorsOf({ verification: { status: 'live' } }, 'builtin'), /live needs the verified version/)
  assert.match(errorsOf({ verification: { status: 'verified' } }, 'builtin'), /verification must be/)
})

test('resolveCliAdapters: valid entries load, invalid ones are ignored with a diagnostic, never fatal', () => {
  const { specs, diagnostics } = resolveCliAdapters({
    good: { ...baseSpec(), id: 'good' },
    bad: { ...baseSpec(), id: 'bad', allowedSubcommands: ['login'] },
    mismatch: { ...baseSpec(), id: 'other' },
    junk: 'x',
  })
  assert.deepEqual([...specs.keys()], ['good'])
  assert.equal(diagnostics.length, 3)
  assert.match(diagnostics.join('\n'), /cliAdapters\.bad ignored.*write \/ login/)
  assert.match(diagnostics.join('\n'), /cliAdapters\.mismatch ignored: its id "other" must equal its key/)
  assert.match(diagnostics.join('\n'), /cliAdapters\.junk ignored/)
  assert.deepEqual(resolveCliAdapters(undefined), { specs: new Map(), diagnostics: [] })
  assert.match(resolveCliAdapters([]).diagnostics[0]!, /must be an object/)
})

test('searchSpecFor prefers the per-platform override', () => {
  const spec = baseSpec({ searches: { other: { ...baseSpec().search, argv: ['search', '{query}', '--other'] } } })
  assert.deepEqual(searchSpecFor(spec, 'demo').argv.slice(-1), ['--json'])
  assert.deepEqual(searchSpecFor(spec, 'other').argv.slice(-1), ['--other'])
})

test('version helpers and platformBackends shape', () => {
  assert.equal(parseVersion('bili, version 0.6.2'), '0.6.2')
  assert.equal(parseVersion('0.19.0-alpha'), '0.19.0')
  assert.equal(parseVersion('twitter-cli'), undefined)
  assert.ok(compareVersions('0.6.10', '0.6.2') > 0)
  assert.ok(compareVersions('1.8', '1.8.0') === 0)
  assert.deepEqual(platformBackendProblems({ xiaohongshu: ['opencli', 'xhs'], 'custom-cli:x': ['x'] }), [])
  assert.match(platformBackendProblems([])[0]!, /must be an object/)
  assert.match(platformBackendProblems({ a: 'xhs' })[0]!, /list of backend ids/)
  assert.match(platformBackendProblems({ a: ['x', 'x'] })[0]!, /twice/)
  assert.match(platformBackendProblems({ 'a b': ['x'] })[0]!, /not a platform id/)
})
