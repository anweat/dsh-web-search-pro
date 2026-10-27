import assert from 'node:assert/strict'
import test from 'node:test'
import { WebSearchSettingsController } from '../src/client/form.ts'
import { createHandler, registerRpc, statusView } from '../src/rpc.ts'
import { RPC_CHANNEL, type TrialResult } from '../src/rpc-types.ts'
import { trialCli } from '../src/cli/trial.ts'
import { baseSpec, posix, withCommands } from './cli-helpers.ts'
import { routerHarness } from './custom-cli-harness.ts'
import { ScopeStub } from './settings-harness.ts'

const echoSpec = (over: Record<string, unknown> = {}) => ({
  bins: ['echo'], packageNote: 'echo', platforms: [], engine: true, probe: { versionArgs: ['--version'], helpArgs: ['--help'], mustContain: [] }, allowedSubcommands: [],
  search: { argv: ['{query}'], output: { format: 'text', lines: { mode: 'whole' } } }, env: {}, needsLogin: false, timeoutMs: 5000, maxOutputBytes: 65536, ...over,
})

test('trial: a valid spec is probed and searched once; the first results and the tool\'s own words come back', { skip: !posix }, async () => {
  await withCommands({ echo: 'if [ "$1" = "--version" ]; then echo "echo 1.0"; elif [ "$1" = "--help" ]; then echo "usage"; else printf "answer for %s\\nsecond line\\n" "$1"; fi' }, async () => {
    const result = await trialCli('echo', echoSpec(), 'rust async', { enabled: true })
    assert.equal(result.ok, true, JSON.stringify(result))
    if (!result.ok) return
    assert.equal(result.stage, 'search')
    assert.equal(result.total, 1)
    assert.deepEqual(result.sources.map(s => [s.url, s.title, s.snippet]), [['cli://echo?q=rust%20async', 'echo: rust async', 'answer for rust async\nsecond line']])
    assert.equal(result.raw, 'answer for rust async\nsecond line')
    assert.equal(result.probe.version, '1.0')
    assert.ok(result.elapsedMs >= 0)
  })
})

test('trial: nothing runs for an invalid spec, with CLI backends off, or when the command is missing or is another program; secrets stay out of the words', { skip: !posix }, async () => {
  assert.deepEqual(await trialCli('echo', echoSpec(), 'q', { enabled: false }), { ok: false, stage: 'disabled', message: 'CLI backends are disabled in settings (enableCliBackends): no custom command runs.' })
  const refused = await trialCli('evil', echoSpec({ allowedSubcommands: ['login'], search: { argv: ['login', '{query}'], output: { format: 'text', lines: { mode: 'whole' } } } }), 'q', { enabled: true })
  assert.equal(refused.ok, false)
  assert.equal((refused as { stage: string }).stage, 'validate')
  assert.match(((refused as { errors?: string[] }).errors ?? []).join('\n'), /write \/ login command/)
  assert.equal((await trialCli('x', 'not a spec', 'q', { enabled: true })).ok, false)
  await withCommands({}, async () => {
    const missing = await trialCli('ghost', echoSpec({ bins: ['no-such-tool-xyz'] }), 'q', { enabled: true })
    assert.equal(missing.ok, false)
    assert.equal((missing as { stage: string }).stage, 'probe')
    assert.match((missing as { message: string }).message, /not installed/)
  })
  await withCommands({ 'demo-cli': 'case "$1" in --version) echo "x 1.0";; *) echo "something else";; esac' }, async () => {
    const other = await trialCli('demo', baseSpec({ platforms: [], engine: true } as never), 'q', { enabled: true })
    assert.equal(other.ok, false)
    assert.equal((other as { stage: string }).stage, 'probe')
    assert.match((other as { message: string }).message, /does not match the probe/)
  })
  await withCommands({ echo: 'if [ "$1" = "--version" ] || [ "$1" = "--help" ]; then echo ok; else echo "boom: $MY_SECRET_TOKEN" >&2; exit 3; fi' }, async () => {
    const failed = await trialCli('echo', echoSpec({ env: { required: ['MY_SECRET_TOKEN'] } }), 'q', { enabled: true, env: { ...process.env, MY_SECRET_TOKEN: 'sup3r-s3cret-value' } })
    assert.equal(failed.ok, false)
    const text = JSON.stringify(failed)
    assert.doesNotMatch(text, /sup3r-s3cret-value/)
    assert.match((failed as { raw?: string }).raw ?? '', /boom: \[redacted\]/, 'the tool\'s own words, redacted')
    assert.equal((failed as { stage: string }).stage, 'search')
  })
})

test('the RPC handler: status lists every source with its readiness and confidence, trial runs the draft, anything else is a value, never a throw', { skip: !posix }, async () => {
  await withCommands({ echo: 'if [ "$1" = "--version" ] || [ "$1" = "--help" ]; then echo ok; else echo "hello $1"; fi' }, async () => {
    const h = routerHarness({ cliAdapters: { echo: echoSpec({ confidence: 0.6 }) }, sources: { confidence: { 'browser-search': 0.5 } } })
    try {
      const handler = createHandler({ router: h.router, dynamic: () => h.config })
      const status = await handler('status', {})
      assert.equal(status.ok, true)
      const view = (status as { value: Awaited<ReturnType<typeof statusView>> }).value
      assert.equal(view.sources.ddg!.confidence, 1)
      assert.equal(view.sources['custom-cli:echo']!.confidence, 0.6)
      assert.equal(typeof view.sources.ddg!.available, 'boolean')
      assert.ok(view.legs['weibo/browser-search'], 'the legs of a platform chain are keyed platform/backend')
      assert.equal(view.legs['weibo/browser-search']!.confidence, 0.5)
      const trial = await handler('trial', { id: 'echo', spec: echoSpec(), query: 'hi' })
      assert.equal(trial.ok, true)
      assert.equal((trial as { value: TrialResult }).value.ok, true)
      assert.equal(((await handler('trial', { spec: echoSpec() })) as { ok: boolean }).ok, false, 'the id is required')
      assert.deepEqual(await handler('nope', {}), { ok: false, error: { code: 'not-found', message: 'unknown endpoint: nope', details: {} } })
      assert.equal((await handler('trial', null)).ok, false)
    } finally { h.cleanup() }
  })
})

test('the handler is registered on the Host transport under the plugin\'s own channel, only when the services exist', () => {
  const channels: string[] = []
  const injected: string[][] = []
  let effectName = ''
  const connectionCtx = { root: { connection: { rpc: { handle: (channel: string) => { channels.push(channel); return async () => {} } } } }, effect: (fn: () => unknown, name: string) => { effectName = name; fn() } }
  const ctx = { inject: (services: string[], callback: (ctx: unknown) => void) => { injected.push(services); callback(connectionCtx) } }
  registerRpc(ctx as never, { router: {} as never, dynamic: () => ({}) as never })
  assert.deepEqual(injected, [['connection', 'webServer']])
  assert.deepEqual(channels, [RPC_CHANNEL])
  assert.equal(RPC_CHANNEL, '/dsh-web-search-pro')
  assert.match(effectName, /RPC channel/)
})

function controllerWith(rpc: unknown) {
  const scope = new ScopeStub({ engines: ['ddg'] })
  const ctx = { remote: { credentials: { describe: async (refs: string[]) => ({ ok: true, value: Object.fromEntries(refs.map(ref => [ref, { configured: false, writable: true }])) }), set: async () => ({ ok: true, value: {} }) } }, get: (name: string) => (name === 'connection' && rpc ? { rpc } : undefined) }
  return new WebSearchSettingsController(scope, ctx as never)
}

test('the card controller: live readiness and the trial go through the Host RPC when there is one; without it the card says so and nothing breaks', async () => {
  const calls: [string, string, unknown][] = []
  const rpc = {
    call: async (channel: string, endpoint: string, payload: unknown) => {
      calls.push([channel, endpoint, payload])
      if (endpoint === 'status') return { ok: true, value: { sources: { ddg: { available: true, confidence: 1 } }, legs: {} } }
      if (endpoint === 'trial') return { ok: true, value: { ok: true, stage: 'search', probe: {}, sources: [], total: 0, raw: '', elapsedMs: 1 } }
      return { ok: false, error: { message: 'nope' } }
    },
  }
  const controller = controllerWith(rpc)
  await controller.refreshStatus()
  assert.equal(controller.snapshot().server.available, true)
  assert.deepEqual(controller.snapshot().server.status, { sources: { ddg: { available: true, confidence: 1 } }, legs: {} })
  await controller.runTrial({ id: 'echo', spec: { bins: ['echo'] }, query: 'q' })
  assert.equal(controller.snapshot().server.trial.state, 'done')
  assert.equal(controller.snapshot().server.trial.id, 'echo')
  assert.deepEqual(calls.filter(call => call[1] === 'trial')[0], [RPC_CHANNEL, 'trial', { id: 'echo', spec: { bins: ['echo'] }, query: 'q' }])
  controller.clearTrial()
  assert.equal(controller.snapshot().server.trial.state, 'idle')
  controller.dispose()
  // A call that fails is a state, not an exception.
  const failing = controllerWith({ call: async () => { throw new Error('transport down') } })
  await failing.refreshStatus()
  assert.equal(failing.snapshot().server.failed, true)
  await failing.runTrial({ id: 'x', spec: {}, query: 'q' })
  assert.deepEqual([failing.snapshot().server.trial.state, failing.snapshot().server.trial.error], ['failed', 'transport down'])
  failing.dispose()
  // No transport at all.
  const bare = controllerWith(undefined)
  await bare.refreshStatus()
  assert.equal(bare.snapshot().server.available, false)
  await bare.runTrial({ id: 'x', spec: {}, query: 'q' })
  assert.deepEqual([bare.snapshot().server.trial.state, bare.snapshot().server.trial.error], ['failed', 'unavailable'])
  bare.dispose()
})
