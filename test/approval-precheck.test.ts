import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import { webCallDecision, webPolicyDecision } from '../src/actions/approval.ts'
import { findAction } from '../src/actions/registry.ts'
import { preflightArgs } from '../src/actions/schema.ts'
import { cliSpecProblems } from '../src/overlay.ts'
import { BROWSER_020 } from './browser-stub.ts'
import { bootPlugin, type PluginHarness } from './plugin-harness.ts'
import { engineSpec } from './overlay-helpers.ts'

// A call whose arguments `runAction` will refuse must reach `runAction` unasked, so the model gets INVALID_ARGS and the schema;
// asking first (or denying) is what left a headless run without the schema ("requires approval, but no approval channel is available").

const hookOf = (h: PluginHarness) => h.listeners.find(l => l.event === 'tools/pre-execute')!
const allow = async () => ({ kind: 'allow' as const })
const goodSpec = engineSpec()
const REASON = 'the user asked'

interface Outcome {
  gate: 'allow' | 'ask' | 'deny'
  reason?: string
  /** Whether the Host ran the tool. */
  ran: boolean
  envelope?: any
}

/**
 * A Host with no approval channel (headless): `allow` runs the tool, `ask` and `deny` refuse it and the tool never runs.
 * `approve` plays a user who says yes to an `ask`.
 */
async function headless(h: PluginHarness, tool: string, args: unknown, options: { approve?: boolean } = {}): Promise<Outcome> {
  const decision = await hookOf(h).handler({ name: tool, arguments: args }, allow)
  const ran = decision.kind === 'allow' || (decision.kind === 'ask' && options.approve === true)
  return { gate: decision.kind, reason: decision.reason, ran, envelope: ran ? await h.tools.get(tool).execute(args, { signal: undefined }) : undefined }
}
const viaCall = (h: PluginHarness, action: string, args: unknown, options?: { approve?: boolean }) => headless(h, 'web_call', { action, args }, options)

const EXECUTING = ['config.upsert_cli', 'config.set_order', 'cache.clear', 'history.delete', 'rules.upsert', 'rules.remove', 'rules.import', 'sources.install']

/** Count the executions of actions until `restore`. */
function spyOn(names: string[]): { counts: Map<string, number>; restore: () => void } {
  const counts = new Map<string, number>()
  const restores = names.map(name => {
    const action = findAction(name)!
    const original = action.execute
    counts.set(name, 0)
    action.execute = function (this: unknown, ...args: Parameters<typeof original>) { counts.set(name, counts.get(name)! + 1); return original.apply(this, args) }
    return () => { action.execute = original }
  })
  return { counts, restore: () => restores.forEach(restore => restore()) }
}

const untouched = async (h: PluginHarness): Promise<void> => {
  assert.equal(fs.existsSync(h.overlayFile), false, 'the overlay file was never written')
  const view = h.tools.has('web_call') ? await h.run('config.inspect') : (await h.tools.get('web_config_inspect').execute({}, { signal: undefined })).result
  assert.equal(view.revision, 0)
  assert.deepEqual(view.audit, [])
  assert.deepEqual(view.cli, [])
}

test('config.upsert_cli with arguments that cannot run is not put to the user: INVALID_ARGS with the schema, nothing written', async () => {
  const h = bootPlugin()
  const spy = spyOn(EXECUTING)
  try {
    const cases: [string, Record<string, unknown>, RegExp][] = [
      ['no id and no spec', { reason: REASON }, /id: required; spec: required/],
      ['no spec', { id: 'mytool', reason: REASON }, /spec: required/],
      ['no id', { spec: goodSpec, reason: REASON }, /id: required/],
      ['spec is not an object', { id: 'mytool', spec: 'demo-cli', reason: REASON }, /spec: expected object, got string/],
      ['unknown argument', { id: 'mytool', spec: goodSpec, reason: REASON, extra: 1 }, /extra: unknown argument/],
      ['id is not an id', { id: 'Bad Id', spec: goodSpec, reason: REASON }, /id must be an id such as "my-tool"/],
      ['spec.id differs from id', { id: 'mytool', spec: { ...goodSpec, id: 'other' }, reason: REASON }, /spec\.id must equal id \("mytool"\)/],
      ['spec is empty', { id: 'mytool', spec: {}, reason: REASON }, /spec: cliAdapters\.mytool\.bins must be 1\.\.4 command names/],
    ]
    for (const [label, args, message] of cases) {
      const outcome = await viaCall(h, 'config.upsert_cli', args)
      assert.equal(outcome.gate, 'allow', label + ': nothing to approve')
      assert.equal(outcome.ran, true, label)
      assert.equal(outcome.envelope.ok, false, label)
      assert.equal(outcome.envelope.error.code, 'INVALID_ARGS', label)
      assert.match(outcome.envelope.error.message, message, label)
      assert.match(outcome.envelope.error.schema, /^config\.upsert_cli\(id: string, spec: object, reason: string/, label + ': the schema comes with the error')
    }
    assert.equal(spy.counts.get('config.upsert_cli'), 0, 'execute never ran')
    await untouched(h)
  } finally { spy.restore(); h.cleanup() }
})

test('config.upsert_cli: an unusable spec is refused with every problem listed, before any prompt', async () => {
  const h = bootPlugin()
  const spy = spyOn(EXECUTING)
  try {
    const spec = engineSpec({ allowedSubcommands: ['login'], search: { argv: ['search', '{query}', '--cookie', 'x'], output: { format: 'json', itemsPath: 'data', fields: { url: 'url' } } } })
    const outcome = await viaCall(h, 'config.upsert_cli', { id: 'mytool', spec, reason: REASON })
    assert.equal(outcome.gate, 'allow')
    const error = outcome.envelope.error
    assert.equal(error.code, 'INVALID_ARGS')
    const lines = error.message.split('; ')
    assert.ok(lines.length >= 3, 'one entry per problem: ' + error.message)
    assert.ok(lines.every((line: string) => line.startsWith('spec: ')), error.message)
    assert.match(error.message, /"login" is a write \/ login command/)
    assert.match(error.message, /flag "--cookie" reads cookies or carries credentials/)
    assert.match(error.schema, /^config\.upsert_cli\(/)
    assert.equal(spy.counts.get('config.upsert_cli'), 0)
    await untouched(h)
    // One set of rules: the check the hook runs is the one the overlay applies when it writes.
    assert.deepEqual(error.message.split('; '), cliSpecProblems('mytool', spec))
  } finally { spy.restore(); h.cleanup() }
})

test('config.upsert_cli with valid arguments is decided exactly as before: asks (no approval channel: refused, unrun); once approved it runs', async () => {
  const h = bootPlugin()
  const spy = spyOn(EXECUTING)
  try {
    const args = { id: 'mytool', spec: goodSpec, reason: REASON }
    const refused = await viaCall(h, 'config.upsert_cli', args)
    assert.equal(refused.gate, 'ask')
    assert.match(refused.reason!, /^config\.upsert_cli id=mytool: Let Web Search Pro run a local program as a search source — command demo-cli;/)
    assert.equal(refused.ran, false)
    assert.equal(spy.counts.get('config.upsert_cli'), 0)
    await untouched(h)

    const approved = await viaCall(h, 'config.upsert_cli', args, { approve: true })
    assert.equal(approved.gate, 'ask')
    assert.equal(approved.envelope.ok, true)
    assert.equal(approved.envelope.result.revision, 1)
    assert.equal(spy.counts.get('config.upsert_cli'), 1)
  } finally { spy.restore(); h.cleanup() }
})

test('other asking actions: missing or mistyped arguments go to INVALID_ARGS unasked; valid ones still ask', async () => {
  const h = bootPlugin()
  const spy = spyOn(EXECUTING)
  try {
    const invalid: [string, Record<string, unknown>, RegExp][] = [
      ['cache.clear', { olderThanDays: '30' }, /olderThanDays: expected number, got string/],
      ['cache.clear', { engine: 5 }, /engine: expected string, got number/],
      ['cache.clear', { all: true }, /all: unknown argument/],
      ['history.delete', {}, /id: required/],
      ['rules.upsert', { hostname: 'a.test' }, /contentSelectors: required/],
      ['rules.remove', {}, /hostname: required/],
      ['rules.import', { rulesJson: 5 }, /rulesJson: expected string/],
      ['sources.install', {}, /backend: required/],
    ]
    for (const [action, args, message] of invalid) {
      const outcome = await viaCall(h, action, args)
      assert.equal(outcome.gate, 'allow', action + ' ' + JSON.stringify(args))
      assert.equal(outcome.envelope.error.code, 'INVALID_ARGS', action)
      assert.match(outcome.envelope.error.message, message, action)
      assert.ok(outcome.envelope.error.schema.startsWith(action + '('), action)
    }
    for (const name of EXECUTING) assert.equal(spy.counts.get(name), 0, name + ' never executed')
    const valid: [string, Record<string, unknown>][] = [
      ['cache.clear', { olderThanDays: 30 }], ['cache.clear', {}], ['history.delete', { id: 'q1' }], ['rules.upsert', { hostname: 'a.test', contentSelectors: 'article' }],
      ['rules.remove', { hostname: 'a.test' }], ['rules.import', { rulesJson: '[]' }], ['sources.install', { backend: 'bili' }],
    ]
    for (const [action, args] of valid) {
      const outcome = await viaCall(h, action, args)
      assert.equal(outcome.gate, 'ask', action)
      assert.equal(outcome.ran, false, action + ': refused without an approval channel')
    }
    // No approval class: the hook does not look at the arguments (runAction answers its own INVALID_ARGS).
    const search = await viaCall(h, 'search.run', {})
    assert.equal(search.gate, 'allow')
    assert.equal(search.envelope.error.code, 'INVALID_ARGS')
  } finally { spy.restore(); h.cleanup() }
})

test('read-only mode: an invalid call gets INVALID_ARGS (nothing runs, so nothing to forbid); a valid one is still denied', async () => {
  const h = bootPlugin()
  const spy = spyOn(EXECUTING)
  try {
    h.services.browser = { ...BROWSER_020, status: async () => ({ automationMode: 'read-only' }) }
    // Invalid: the model needs the schema more than a refusal; runAction fails before execute, so no write can happen.
    const invalid: [string, Record<string, unknown>][] = [
      ['config.upsert_cli', { reason: REASON }], ['config.upsert_cli', { id: 'mytool', spec: {}, reason: REASON }], ['config.set_order', { engines: ['ddg'] }],
      ['cache.clear', { olderThanDays: '30' }], ['sources.install', {}],
    ]
    for (const [action, args] of invalid) {
      const outcome = await viaCall(h, action, args)
      assert.equal(outcome.gate, 'allow', action)
      assert.equal(outcome.envelope.error.code, 'INVALID_ARGS', action)
    }
    // Valid: denied as before, never run.
    const valid: [string, Record<string, unknown>][] = [
      ['config.upsert_cli', { id: 'mytool', spec: goodSpec, reason: REASON }], ['config.set_order', { engines: ['ddg'], reason: REASON }], ['cache.clear', {}],
      ['sources.install', { backend: 'bili' }], ['history.delete', { id: 'q' }],
    ]
    for (const [action, args] of valid) {
      const outcome = await viaCall(h, action, args)
      assert.equal(outcome.gate, 'deny', action)
      assert.match(outcome.reason!, /disabled by automationMode=read-only/, action)
      assert.equal(outcome.ran, false, action)
    }
    for (const name of EXECUTING) assert.equal(spy.counts.get(name), 0, name)
    await untouched(h)
  } finally { spy.restore(); h.cleanup() }
})

test('the flat tool surface takes the same path', async () => {
  const h = bootPlugin({ toolSurface: 'flat' })
  const spy = spyOn(EXECUTING)
  try {
    assert.ok(h.tools.has('web_config_upsert_cli') && !h.tools.has('web_call'))
    const bad = await headless(h, 'web_config_upsert_cli', { id: 'mytool' })
    assert.equal(bad.gate, 'allow')
    assert.equal(bad.envelope.error.code, 'INVALID_ARGS')
    assert.match(bad.envelope.error.message, /spec: required/)
    assert.match(bad.envelope.error.schema, /^config\.upsert_cli\(/)
    const badSpec = await headless(h, 'web_config_upsert_cli', { id: 'mytool', spec: {}, reason: REASON })
    assert.equal(badSpec.gate, 'allow')
    assert.equal(badSpec.envelope.error.code, 'INVALID_ARGS')
    assert.match(badSpec.envelope.error.message, /spec: cliAdapters\.mytool\.bins/)
    const badClear = await headless(h, 'web_cache_clear', { olderThanDays: 'a month' })
    assert.equal(badClear.gate, 'allow')
    assert.equal(badClear.envelope.error.code, 'INVALID_ARGS')
    assert.equal(spy.counts.get('config.upsert_cli'), 0)
    assert.equal(spy.counts.get('cache.clear'), 0)
    await untouched(h)

    const good = await headless(h, 'web_config_upsert_cli', { id: 'mytool', spec: goodSpec, reason: REASON })
    assert.equal(good.gate, 'ask')
    assert.equal(good.ran, false)
    assert.equal((await headless(h, 'web_cache_clear', {})).gate, 'ask')
    await untouched(h)

    h.services.browser = { ...BROWSER_020, status: async () => ({ automationMode: 'read-only' }) }
    assert.equal((await headless(h, 'web_config_upsert_cli', { id: 'mytool' })).envelope.error.code, 'INVALID_ARGS')
    assert.equal((await headless(h, 'web_config_upsert_cli', { id: 'mytool', spec: goodSpec, reason: REASON })).gate, 'deny')
    await untouched(h)
  } finally { spy.restore(); h.cleanup() }
})

test('a precheck that crashes never blocks a call and never throws out of the hook; hostile argument shapes do not throw', async () => {
  const action = findAction('config.upsert_cli')!
  const original = action.precheck
  const h = bootPlugin()
  try {
    action.precheck = () => { throw new Error('boom') }
    const good = { id: 'mytool', spec: goodSpec, reason: REASON }
    assert.equal(preflightArgs(action, good).ok, true, 'a crashed precheck counts as passed')
    assert.equal(webCallDecision('config.upsert_cli', good, undefined).kind, 'ask', 'decided as for a valid call')
    assert.equal((await viaCall(h, 'config.upsert_cli', good)).gate, 'ask')
    // Schema errors are found before the precheck runs.
    assert.equal((await viaCall(h, 'config.upsert_cli', { id: 'mytool' })).envelope.error.code, 'INVALID_ARGS')
    action.precheck = original
    for (const args of [null, undefined, 'x', 5, [], { id: {}, spec: [] }, { id: 'a', spec: { toString: 1 }, reason: REASON }]) {
      assert.doesNotThrow(() => webCallDecision('config.upsert_cli', args, 'standard'))
      assert.equal(webCallDecision('config.upsert_cli', args, 'standard').kind, 'allow', JSON.stringify(args))
    }
  } finally { action.precheck = original; h.cleanup() }
})

test('webCallDecision: valid arguments get exactly webPolicyDecision\'s answer in every mode', () => {
  const calls: [string, unknown][] = [
    ['config.upsert_cli', { id: 'mytool', spec: goodSpec, reason: REASON }], ['config.set_order', { engines: ['ddg'], reason: REASON }], ['config.reset', { scope: 'all', reason: REASON }],
    ['cache.clear', { olderThanDays: 3 }], ['history.delete', { id: 'q' }], ['rules.import', { rulesJson: '[]' }], ['sources.install', { backend: 'bili' }], ['search.run', { query: 'q' }], ['nope.nothing', {}],
  ]
  for (const mode of [undefined, 'read-only', 'standard', 'autonomous', 'unrestricted'] as const) {
    for (const [action, args] of calls) assert.deepEqual(webCallDecision(action, args, mode), webPolicyDecision(action, args, mode), `${action} / ${mode}`)
  }
})
