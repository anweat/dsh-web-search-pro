import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { registerHooks } from 'node:module'
import { detectDeps, evaluateTwitterCli, DEP_IDS } from '../src/deps.ts'
import { agentReachEngine, EngineError } from '../src/engines.ts'
import { resolveConfig } from '../src/config.ts'
import { callAction, renderResult } from './call-helper.ts'

// dsh-tools is a host peer; tool definitions are identity in this isolated run.
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === '@deepseek-ai/dsh-tools') {
      return { url: 'data:text/javascript,export const defineTool = value => value', shortCircuit: true }
    }
    return nextResolve(specifier, context)
  },
})
const { registerTools } = await import('../src/tools.ts')
const { twitterGate } = await import('../src/actions/sources.ts')

const posix = process.platform !== 'win32'

/** Run `fn` with PATH limited to a temp bin dir (plus the system dirs `sh` lives in) holding the given fake commands. */
async function withCommands<T>(commands: Record<string, string>, fn: () => Promise<T>): Promise<T> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wsp-fake-bin-'))
  const original = process.env.PATH
  for (const [name, body] of Object.entries(commands)) {
    const file = path.join(dir, name)
    fs.writeFileSync(file, '#!/bin/sh\n' + body + '\n')
    fs.chmodSync(file, 0o755)
  }
  process.env.PATH = dir + path.delimiter + '/usr/bin' + path.delimiter + '/bin'
  try { return await fn() } finally {
    process.env.PATH = original
    fs.rmSync(dir, { recursive: true, force: true })
  }
}
const TWITTER_OK = 'case "$1" in search) echo "Usage: twitter search [OPTIONS] QUERY"; echo "  -n, --max INTEGER";; *) echo "twitter-cli";; esac'

test('twitter is its own dependency entry; agent-reach stays as an optional install helper', () => {
  assert.ok(DEP_IDS.includes('twitter'))
  assert.ok(DEP_IDS.includes('agent-reach'))
})

test('evaluateTwitterCli accepts a search command and rejects other programs named twitter', () => {
  assert.deepEqual(evaluateTwitterCli('Usage: twitter search [OPTIONS] QUERY', 0), { available: true })
  assert.equal(evaluateTwitterCli('', 2).available, false)
  assert.match(evaluateTwitterCli('Usage: twitter [options] <status>', 0).diagnostic!, /not twitter-cli/)
})

test('detectDeps probes the twitter command, not agent-reach', { skip: !posix }, async () => {
  const none = await withCommands({}, detectDeps)
  assert.equal(none.find(d => d.id === 'twitter')!.available, false)
  assert.equal(none.find(d => d.id === 'agent-reach')!.available, false)

  // Agent-Reach installed, `twitter` not: twitter search is NOT available.
  const reachOnly = await withCommands({ 'agent-reach': 'echo agent-reach 1.0' }, detectDeps)
  assert.equal(reachOnly.find(d => d.id === 'agent-reach')!.available, true)
  assert.equal(reachOnly.find(d => d.id === 'twitter')!.available, false)

  // `twitter` working, Agent-Reach absent: twitter IS available, with the resolved path.
  const twitterOnly = await withCommands({ twitter: TWITTER_OK }, detectDeps)
  const tw = twitterOnly.find(d => d.id === 'twitter')!
  assert.equal(tw.available, true)
  assert.match(tw.path!, /twitter$/)
  assert.equal(twitterOnly.find(d => d.id === 'agent-reach')!.available, false)
  assert.ok(tw.installs.some(i => i.command === 'uv tool install twitter-cli'))

  // A different program called `twitter` is reported with the reason.
  const wrong = await withCommands({ twitter: 'echo "not it"; exit 3' }, detectDeps)
  const bad = wrong.find(d => d.id === 'twitter')!
  assert.equal(bad.available, false)
  assert.match(bad.diagnostic!, /exit 3/)
})

test('twitterGate: executable command AND settings AND credentials decide availability', () => {
  const env = { a: process.env.TWITTER_AUTH_TOKEN, b: process.env.TWITTER_CT0 }
  try {
    process.env.TWITTER_AUTH_TOKEN = 't'
    process.env.TWITTER_CT0 = 'c'
    const on = { enableCliBackends: true, agentReachEnabled: true }
    assert.deepEqual(twitterGate(on, { available: true }), { available: true })
    assert.match(twitterGate(on, { available: false }).note!, /install twitter-cli/)
    assert.match(twitterGate(on, { available: false, diagnostic: 'exit 3' }).note!, /exit 3/)
    assert.match(twitterGate({ ...on, enableCliBackends: false }, { available: true }).note!, /enableCliBackends/)
    assert.match(twitterGate({ ...on, agentReachEnabled: false }, { available: true }).note!, /agentReachEnabled/)
    delete process.env.TWITTER_CT0
    const missing = twitterGate(on, { available: true })
    assert.equal(missing.available, false)
    assert.match(missing.note!, /TWITTER_AUTH_TOKEN \/ TWITTER_CT0/)
  } finally {
    for (const [key, value] of [['TWITTER_AUTH_TOKEN', env.a], ['TWITTER_CT0', env.b]] as const) { if (value === undefined) delete process.env[key]; else process.env[key] = value }
  }
})

function statusTool() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wsp-deps-tool-'))
  const config = resolveConfig({ dbPath: path.join(dir, 'store.db'), engines: ['ddg'], enableCliBackends: true, agentReachEnabled: true } as never)
  const definitions = new Map<string, any>()
  registerTools({
    ctx: { tools: { register: (d: any) => definitions.set(d.name, d) } } as any,
    config, dynamic: () => config, store: {} as any,
    router: { backendDiagnostics: async () => [] } as any, fetch: {} as any,
  })
  return { definitions, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) }
}

test('sources.status and sources.deps reflect whether the twitter command can really run', { skip: !posix }, async () => {
  const h = statusTool()
  const saved = { a: process.env.TWITTER_AUTH_TOKEN, b: process.env.TWITTER_CT0 }
  try {
    process.env.TWITTER_AUTH_TOKEN = 't'
    process.env.TWITTER_CT0 = 'c'
    // Only Agent-Reach installed: both tools say twitter is unavailable.
    await withCommands({ 'agent-reach': 'echo ok' }, async () => {
      const status = await callAction(h.definitions, 'sources.status')
      const tw = status.cli.find((c: any) => c.id === 'twitter')
      assert.equal(tw.available, false)
      assert.match(tw.note, /install twitter-cli/)
      assert.equal(status.cli.find((c: any) => c.id === 'agent-reach').available, true)
      const deps = await callAction(h.definitions, 'sources.deps')
      assert.equal(deps.backends.find((b: any) => b.id === 'twitter').available, false)
    })
    // `twitter` works and credentials are set: available everywhere.
    await withCommands({ twitter: TWITTER_OK }, async () => {
      const status = await callAction(h.definitions, 'sources.status')
      assert.equal(status.cli.find((c: any) => c.id === 'twitter').available, true)
      assert.match(renderResult('sources.status', status), /✅ cli:twitter — .*twitter/)
      // agent-reach is only an optional helper: its absence is not a gap in the check summary.
      const deps = await callAction(h.definitions, 'sources.deps')
      const ar = deps.backends.find((b: any) => b.id === 'agent-reach')
      assert.equal(ar.optional, true)
      // Credentials missing: the command is there but the backend cannot run.
      delete process.env.TWITTER_CT0
      const noEnv = await callAction(h.definitions, 'sources.status')
      const tw = noEnv.cli.find((c: any) => c.id === 'twitter')
      assert.equal(tw.available, false)
      assert.match(tw.note, /TWITTER_CT0/)
    })
  } finally {
    for (const [key, value] of [['TWITTER_AUTH_TOKEN', saved.a], ['TWITTER_CT0', saved.b]] as const) { if (value === undefined) delete process.env[key]; else process.env[key] = value }
    h.cleanup()
  }
})

test('sources.install installs twitter-cli through a package manager entry, never agent-reach for twitter', async () => {
  const h = statusTool()
  try {
    const deps = await callAction(h.definitions, 'sources.deps')
    const tw = deps.backends.find((b: any) => b.id === 'twitter')
    assert.deepEqual(tw.installs.map((i: any) => i.installer), ['uv', 'pipx', 'pip'])
    await assert.rejects(callAction(h.definitions, 'sources.install', { backend: 'twitter', installer: 'npm' }), /unknown installer npm for twitter/)
  } finally { h.cleanup() }
})

test('the twitter engine explains a missing command instead of a bare exit code', { skip: !posix }, async () => {
  const engine = agentReachEngine('twitter', { enableCli: true, agentReachEnabled: true } as never)
  await withCommands({}, async () => {
    await assert.rejects(engine.search('dsh', 5), (error: unknown) => {
      assert.ok(error instanceof EngineError)
      assert.equal(error.code, 'ENGINE_UNAVAILABLE')
      assert.equal(error.retryable, false)
      assert.match(error.message, /install twitter-cli/)
      return true
    })
  })
})
