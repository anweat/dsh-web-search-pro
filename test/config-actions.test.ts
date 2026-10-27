import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { load } from 'js-yaml'
import { describeCliSpec } from '../src/actions/approval.ts'
import { ACTIONS, findAction } from '../src/actions/registry.ts'
import { checkOutput } from '../src/actions/schema.ts'
import { renderEnvelope } from '../src/actions/run.ts'
import { callEnvelope, renderResult } from './call-helper.ts'
import { bootPlugin, type PluginHarness } from './plugin-harness.ts'
import { engineSpec } from './overlay-helpers.ts'

const CONFIG_ACTIONS = ACTIONS.filter(action => action.group === 'config')
const hookOf = (h: PluginHarness) => h.listeners.find(l => l.event === 'tools/pre-execute')!
const allow = async () => ({ kind: 'allow' as const })
const decide = (h: PluginHarness, action: string, args: unknown = {}, next: () => Promise<any> = allow): Promise<any> => hookOf(h).handler({ name: 'web_call', arguments: { action, args } }, next)

test('the config group is seven actions, in web_index, with schemas, notes and examples; only upsert_cli is marked as asking', async () => {
  assert.deepEqual(CONFIG_ACTIONS.map(action => action.name), ['config.inspect', 'config.set_order', 'config.set_confidence', 'config.upsert_cli', 'config.remove_cli', 'config.reset', 'config.export'])
  const h = bootPlugin()
  try {
    const root = (await h.tools.get('web_index').execute({}, {})).text as string
    assert.match(root, /config \(7\) read and change the search order, confidence and custom CLIs at run time \(agent overlay\): inspect\|set_order\|set_confidence\|upsert_cli\|remove_cli\|reset\|export/)
    const group = (await h.tools.get('web_index').execute({ group: 'config' }, {})).text as string
    const lines = group.split('\n')
    assert.equal(lines.filter(line => line.endsWith('| asks')).length, 1)
    assert.match(lines.find(line => line.startsWith('config.upsert_cli'))!, /\| asks$/)
    for (const name of ['config.inspect', 'config.set_order', 'config.set_confidence', 'config.remove_cli', 'config.reset', 'config.export']) assert.doesNotMatch(lines.find(line => line.startsWith(name))!, /\| asks$/, name)
    const one = (await h.tools.get('web_index').execute({ action: 'config.set_order' }, {})).text as string
    assert.match(one, /reason: string - Why the setting changes \(3-300 characters\)/)
    assert.match(one, /expectedRevision\?: number - Revision from config\.inspect/)
    assert.match(one, /platform and backends go together/)
    for (const action of CONFIG_ACTIONS) {
      assert.ok(action.examples?.length, action.name + ' has an example')
      if (action.mutating) assert.ok(action.params.reason?.required, action.name + ' needs a reason')
    }
  } finally { h.cleanup() }
})

test('config.inspect: the value in force and its source for every overridable key, the revision, the audit and the restart list', async () => {
  const h = bootPlugin({ engines: ['ddg', 'bing'], sources: { priority: ['exa'] } })
  try {
    const first = await h.run('config.inspect')
    assert.equal(first.revision, 0)
    assert.equal(first.valid, true)
    assert.deepEqual(first.engines, { value: ['ddg', 'bing'], source: 'baseline' })
    assert.deepEqual(first.priority, { value: ['exa'], source: 'baseline' })
    assert.deepEqual(first.audit, [])
    assert.deepEqual(checkOutput(findAction('config.inspect')!.output, first), [])
    await h.run('config.set_order', { engines: ['bing', 'ddg'], reason: 'bing answers faster' })
    await h.run('config.set_confidence', { id: 'exa', value: 0.8, reason: 'exa is mostly right' })
    await h.run('config.upsert_cli', { id: 'mine', spec: engineSpec({ confidence: 0.6 }), reason: 'the user asked for it' })
    h.config.toolSurface = 'flat'
    const view = await h.run('config.inspect', { limit: 2 })
    assert.equal(view.revision, 3)
    assert.deepEqual(view.engines, { value: ['bing', 'ddg'], source: 'overlay' })
    assert.deepEqual(view.confidence, [{ id: 'exa', value: 0.8, source: 'overlay' }])
    assert.deepEqual(view.cli.map((entry: any) => [entry.id, entry.source, entry.engine, entry.confidence]), [['mine', 'overlay', true, 0.6]])
    assert.match(view.cli[0].command, /^demo-cli search \{query\} --limit \{count\} --json$/)
    assert.equal(view.audit.length, 2, 'limit')
    assert.equal(view.audit[0].reason, 'the user asked for it', 'newest first')
    assert.deepEqual(view.pendingRestart, [{ field: 'toolSurface', running: 'indexed', configured: 'flat' }])
    assert.deepEqual(checkOutput(findAction('config.inspect')!.output, view), [])
    const text = renderResult('config.inspect', view)
    assert.match(text, /agent overlay: revision 3/)
    assert.match(text, /engines \[overlay\]: bing > ddg/)
    assert.match(text, /sources\.priority \[configuration\]: exa/)
    assert.match(text, /mine \[overlay\]: demo-cli search/)
    assert.match(text, /待重启：toolSurface（当前生效 indexed，配置为 flat）/)
  } finally { h.cleanup() }
})

test('config.set_order: effect on the next call, reason and expectedRevision rules, validation errors with codes and hints', async () => {
  const h = bootPlugin({ engines: ['ddg', 'bing'] })
  try {
    const done = await h.run('config.set_order', { engines: ['bing', 'ddg'], disabled: ['jina'], reason: 'ddg is rate limited right now' })
    assert.equal(done.changed, true)
    assert.equal(done.revision, 1)
    assert.deepEqual(done.changes, [{ key: 'engines', before: 'ddg > bing', after: 'bing > ddg' }, { key: 'sources.disabled', before: '(empty)', after: 'jina' }])
    assert.deepEqual(checkOutput(findAction('config.set_order')!.output, done), [])
    assert.deepEqual((await h.run('cache.stats')).engines, ['bing', 'ddg'], 'every consumer of dynamic() sees it at once')
    assert.deepEqual((await h.run('sources.status')).sources.disabled, ['jina'])
    assert.match(renderResult('config.set_order', done), /applied, overlay revision 1; takes effect on the next call[\s\S]*engines: ddg > bing {2}→ {2}bing > ddg/)
    // The tool text a model reads for a refusal is the structured error.
    const refused = async (args: Record<string, unknown>) => (await h.envelope('config.set_order', args)).error
    assert.equal((await refused({ engines: ['ddg'] })).code, 'INVALID_ARGS')
    assert.match((await refused({ engines: ['ddg'], reason: 'ok' })).message, /reason must be 3-300 characters/)
    assert.match((await refused({ reason: 'nothing to say here' })).message, /give at least one of/)
    assert.match((await refused({ engines: ['nope'], reason: 'a typo of mine' })).message, /not a registered source/)
    const conflict = await refused({ engines: ['ddg'], reason: 'based on a stale view', expectedRevision: 0 })
    assert.equal(conflict.code, 'ACTION_FAILED')
    assert.match(conflict.message, /at revision 1, not 0/)
    assert.match(conflict.hint, /config\.inspect/)
    assert.match((await refused({ platform: 'reddit', reason: 'chain without backends' })).message, /go together/)
    assert.equal((await h.run('config.inspect')).revision, 1, 'refused writes changed nothing')
    // Unchanged: no write, same revision, a note.
    const noop = await h.run('config.set_order', { engines: ['bing', 'ddg'], reason: 'say it again please' })
    assert.equal(noop.changed, false)
    assert.equal(noop.revision, 1)
    assert.match(noop.note, /Nothing changed/)
  } finally { h.cleanup() }
})

test('config.set_confidence, remove_cli and reset: arguments, effect and errors', async () => {
  const h = bootPlugin()
  try {
    assert.equal((await h.run('config.set_confidence', { id: 'exa', value: 0.5, reason: 'half trusted' })).changed, true)
    assert.equal((await h.envelope('config.set_confidence', { id: 'exa', value: 2, reason: 'too much' })).error.code, 'INVALID_ARGS')
    assert.deepEqual((await h.run('sources.status')).sources.confidence, { exa: 0.5 })
    // value omitted (or null, which the argument check treats as absent) drops the overlay's entry.
    const dropped = await h.run('config.set_confidence', { id: 'exa', value: null, reason: 'trusted again' })
    assert.equal(dropped.changed, true)
    assert.equal((await h.run('sources.status')).sources.confidence, undefined)
    await h.run('config.upsert_cli', { id: 'mine', spec: engineSpec(), reason: 'first version' })
    await h.run('config.set_order', { engines: ['custom-cli:mine', 'ddg'], reason: 'try it first' })
    const blocked = await h.envelope('config.remove_cli', { id: 'mine', reason: 'drop it again' })
    assert.equal(blocked.error.code, 'INVALID_ARGS')
    assert.match(blocked.error.message, /custom-cli:mine/)
    const missing = await h.envelope('config.remove_cli', { id: 'ghost', reason: 'not there at all' })
    assert.equal(missing.error.code, 'NOT_FOUND')
    await h.run('config.reset', { scope: 'order', reason: 'back to the order in the profile' })
    await h.run('config.remove_cli', { id: 'mine', reason: 'drop it again' })
    assert.equal((await h.run('config.inspect')).cli.length, 0)
    assert.equal((await h.envelope('config.reset', { scope: 'weird', reason: 'not a scope' })).error.code, 'INVALID_ARGS')
    assert.equal((await h.envelope('config.reset', { scope: 'cli', id: 'ghost', reason: 'not there at all' })).error.code, 'NOT_FOUND')
    await h.run('config.set_confidence', { id: 'jina', value: 0.4, reason: 'a second one' })
    await h.run('config.reset', { scope: 'all', reason: 'start over from the profile' })
    const view = await h.run('config.inspect')
    assert.deepEqual(view.confidence, [])
    assert.ok(view.audit.length > 0, 'the trail survives a reset')
  } finally { h.cleanup() }
})

test('config.upsert_cli validates the spec as the settings card does, and the new CLI takes part in sources.status and engines at once', async () => {
  const h = bootPlugin({ enableCliBackends: true })
  try {
    for (const [spec, pattern] of [
      [engineSpec({ allowedSubcommands: ['login'], search: { argv: ['login', '{query}'], output: { format: 'text', lines: { mode: 'whole' } } } }), /write \/ login|read-only guard/],
      [engineSpec({ search: { argv: ['search', '{query}', '--cookies-from-browser', 'chrome'], output: { format: 'text', lines: { mode: 'whole' } } } }), /cookie|credential|flag/i],
      [engineSpec({ bins: ['/usr/bin/evil'] }), /bins/],
    ] as const) {
      const error = (await h.envelope('config.upsert_cli', { id: 'mine', spec, reason: 'try a bad spec' })).error
      assert.equal(error.code, 'INVALID_ARGS')
      assert.match(error.message, pattern)
    }
    assert.equal((await h.run('config.inspect')).revision, 0)
    await h.run('config.upsert_cli', { id: 'mine', spec: engineSpec(), reason: 'the user asked for it' })
    await h.run('config.set_order', { engines: ['custom-cli:mine', 'ddg'], reason: 'use it first' })
    assert.deepEqual((await h.run('cache.stats')).engines, ['custom-cli:mine', 'ddg'])
    const status = await h.run('sources.status')
    assert.ok(status.providers.some((provider: any) => provider.route === 'custom-cli:mine'), 'the router registered the new CLI')
  } finally { h.cleanup() }
})

test('config.export: the settings in force as YAML (baseline + overlay), parseable, with no keys or paths', async () => {
  const h = bootPlugin({ engines: ['ddg', 'bing'], sources: { disabled: ['jina'] }, exaApiKey: 'literal-secret-value' })
  try {
    await h.run('config.set_order', { engines: ['bing', 'ddg'], platform: 'reddit', backends: ['opencli'], reason: 'ordering for the export' })
    await h.run('config.set_confidence', { id: 'exa', value: 0.8, reason: 'exa is mostly right' })
    await h.run('config.upsert_cli', { id: 'mine', spec: engineSpec(), reason: 'the user asked for it' })
    const out = await h.run('config.export')
    assert.deepEqual(checkOutput(findAction('config.export')!.output, out), [])
    assert.equal(out.revision, 3)
    assert.deepEqual(out.keys, ['engines', 'sources.confidence.exa', 'platformBackends.reddit', 'cliAdapters.mine'])
    const data = load(out.yaml) as any
    assert.deepEqual(data.engines, ['bing', 'ddg'])
    assert.deepEqual(data.sources, { disabled: ['jina'], confidence: { exa: 0.8 } }, 'baseline values are exported too: the YAML is the whole effective setting')
    assert.deepEqual(data.platformBackends, { reddit: ['opencli'] })
    assert.equal(data.cliAdapters.mine.bins[0], 'demo-cli')
    assert.doesNotMatch(out.yaml, /literal-secret-value|store\.db|exaApiKey|dbPath/)
    assert.match(out.yaml, /^# Web Search Pro:/)
    assert.equal(renderResult('config.export', out), out.yaml)
  } finally { h.cleanup() }
})

test('every config action returns a result that fits its closed output schema', async () => {
  const h = bootPlugin()
  try {
    const results: [string, unknown][] = []
    for (const [action, args] of [
      ['config.set_order', { engines: ['bing'], reason: 'schema check one' }], ['config.set_confidence', { id: 'exa', value: 0.5, reason: 'schema check two' }],
      ['config.upsert_cli', { id: 'mine', spec: engineSpec(), reason: 'schema check three' }], ['config.remove_cli', { id: 'mine', reason: 'schema check four' }],
      ['config.reset', { scope: 'all', reason: 'schema check five' }], ['config.set_order', { engines: ['bing'], reason: 'schema check six' }], ['config.set_order', { engines: ['bing'], reason: 'schema check seven' }],
    ] as const) results.push([action, await h.run(action, args)])
    for (const [action, result] of results) assert.deepEqual(checkOutput(findAction(action)!.output, result), [], action)
  } finally { h.cleanup() }
})

test('the overlay file lives beside dbPath and is created 0600 at the first write', async () => {
  const h = bootPlugin()
  try {
    assert.equal(fs.existsSync(h.overlayFile), false, 'no file until something is overridden')
    await h.run('config.set_order', { engines: ['bing'], reason: 'create the file' })
    assert.equal(h.overlayFile, path.join(path.dirname(h.config.dbPath), 'overlay.json'))
    assert.equal(fs.statSync(h.overlayFile).mode & 0o777, 0o600)
    const raw = JSON.parse(fs.readFileSync(h.overlayFile, 'utf8'))
    assert.equal(raw.audit[0].sessionId, undefined, 'no session in this harness: none recorded')
    // A call from a session records it.
    await callEnvelope(h.tools, 'config.set_confidence', { id: 'exa', value: 0.5, reason: 'from a session' }, { signal: undefined, agent: { session: { id: 'session-42' } } })
    assert.equal(JSON.parse(fs.readFileSync(h.overlayFile, 'utf8')).audit.at(-1).sessionId, 'session-42')
  } finally { h.cleanup() }
})

// -- approval ----------------------------------------------------------------------------------------------------------------

test('approval: config.upsert_cli always asks, with the command and argument templates in the prompt; the other config actions never ask', async () => {
  const h = bootPlugin()
  try {
    const spec = engineSpec({ bins: ['mytool', 'mytool2'], env: { required: ['MYTOOL_TOKEN'] } })
    const upsert = await decide(h, 'config.upsert_cli', { id: 'mytool', spec, reason: 'asked' })
    assert.equal(upsert.kind, 'ask')
    assert.match(upsert.reason, /^config\.upsert_cli id=mytool: Let Web Search Pro run a local program as a search source — command mytool or mytool2; search: search \{query\} --limit \{count\} --json; probe: --version ; search --help; reads environment variables MYTOOL_TOKEN/)
    for (const action of ['config.set_order', 'config.set_confidence', 'config.remove_cli', 'config.reset', 'config.inspect', 'config.export']) assert.equal((await decide(h, action, { id: 'x', scope: 'all', reason: 'whatever' })).kind, 'allow', action)
    // The same through a flat tool name, and a decision made by an earlier hook stands.
    assert.equal((await hookOf(h).handler({ name: 'web_config_upsert_cli', arguments: { id: 'mytool', spec } }, allow)).kind, 'ask')
    assert.equal((await decide(h, 'config.upsert_cli', { id: 'mytool', spec }, async () => ({ kind: 'deny', reason: 'no' }))).kind, 'deny')
    // The prompt carries a bounded text even for a hostile spec.
    const long = describeCliSpec({ bins: ['x'.repeat(10)], search: { argv: ['y'.repeat(500)] }, probe: { versionArgs: ['z'.repeat(500)], helpArgs: [] }, env: { passthrough: ['A'.repeat(300)] } })
    assert.ok(long.length < 600, 'bounded: ' + long.length)
    assert.equal(describeCliSpec('not a spec'), 'command (none); search: ; probe:  ; ')
  } finally { h.cleanup() }
})

test('approval follows dsh-browser\'s automationMode when it is present: read-only denies every config write, the others keep the rules above', async () => {
  const h = bootPlugin()
  try {
    // The browser service is read through ctx.get at decision time; this harness has none, so reach the same function directly.
    const { webPolicyDecision } = await import('../src/actions/approval.ts')
    const spec = engineSpec()
    for (const mode of ['standard', 'autonomous', 'unrestricted'] as const) {
      assert.equal(webPolicyDecision('config.upsert_cli', { id: 'a', spec }, mode).kind, 'ask', mode + ': a new program is always the user\'s decision, even when unrestricted')
      assert.equal(webPolicyDecision('config.set_order', { engines: ['ddg'] }, mode).kind, 'allow', mode)
      assert.equal(webPolicyDecision('config.reset', { scope: 'all' }, mode).kind, 'allow', mode)
    }
    for (const action of ['config.upsert_cli', 'config.set_order', 'config.set_confidence', 'config.remove_cli', 'config.reset']) {
      const decision = webPolicyDecision(action, { id: 'a', spec }, 'read-only')
      assert.equal(decision.kind, 'deny', action)
      assert.match((decision as { reason: string }).reason, /automationMode=read-only/)
    }
    for (const action of ['config.inspect', 'config.export']) assert.equal(webPolicyDecision(action, {}, 'read-only').kind, 'allow', action)
    assert.equal(webPolicyDecision('config.set_order', { engines: ['ddg'] }, undefined).kind, 'allow', 'unknown mode: the ordinary rule')
    assert.equal(webPolicyDecision('config.upsert_cli', { id: 'a', spec }, undefined).kind, 'ask')
  } finally { h.cleanup() }
})

test('headless: an "ask" the Host cannot put to a person is refused, never run — the Host\'s own approval seam says so', () => {
  // dsh-tools (0.2.1-rc.3) `serviceAsk`: an `ask` from tools/pre-execute goes to the `approval` service. Without that service the call is denied with the
  // reason the plugin gave; with it but without an answerer (a headless run has no UI) the request comes back `unavailable` and is denied ("fail
  // closed"); a session policy of `never` rejects it at once. Only `allowed-once` runs the tool. This test pins those strings in the installed Host
  // so an upgrade that changes the behaviour is noticed here; test/config-actions.test.ts checks the plugin half (upsert_cli asks in every mode).
  const host = fs.readFileSync(path.resolve(import.meta.dirname, '..', 'node_modules', '@deepseek-ai', 'dsh-tools', 'lib', 'index.js'), 'utf8')
  assert.match(host, /const gate = await this\.ctx\.waterfall\(carrier, "tools\/pre-execute"[\s\S]{0,200}gate\.kind === "ask" \? await this\.serviceAsk\(exec, gate\)/)
  assert.match(host, /const approval = this\.ctx\.get\("approval"\);\s*if \(approval === void 0\) return \{\s*decision: \{\s*kind: "deny",\s*reason: ask\.reason \?\? `tool "\$\{exec\.name\}" requires approval \(not yet supported\)`/)
  assert.match(host, /case "allowed-once": return \{\s*decision: \{ kind: "allow" \}/)
  assert.match(host, /case "unavailable": return \{[\s\S]{0,120}requires approval, but no approval channel is available/)
  const approvalPkg = fs.readFileSync(path.resolve(import.meta.dirname, '..', 'node_modules', '@deepseek-ai', 'dsh-user-approval', 'lib', 'index.js'), 'utf8')
  assert.match(approvalPkg, /"approval\/request", req, \(\) => Promise\.resolve\("unavailable"\)/, 'no answerer: unavailable, which the tool layer denies')
  assert.match(approvalPkg, /actions that require approval are rejected automatically/, 'policy never: rejected')
})
