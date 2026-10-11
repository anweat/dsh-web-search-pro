import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { registerHooks } from 'node:module'
import { resolveConfig } from '../src/config.ts'
import { createBuiltinRegistry } from '../src/providers/index.ts'
import { SearchRouter } from '../src/router.ts'
import { Store } from '../src/store.ts'
import { clearProbeCache } from '../src/cli/probe.ts'
import { builtinSpecById } from '../src/cli/builtin-specs.ts'
import { loginHint } from '../src/cli/runner.ts'
import { posix, withCommands } from './cli-helpers.ts'
import { callAction, renderResult } from './call-helper.ts'

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === '@deepseek-ai/dsh-tools') return { url: 'data:text/javascript,export const defineTool = value => value', shortCircuit: true }
    return nextResolve(specifier, context)
  },
})
const { registerTools } = await import('../src/tools.ts')
const { twitterGate } = await import('../src/actions/sources.ts')

const AUTH = 'auth-token-value-0123456789'
const CT0 = 'ct0-token-value-9876543210'
const NAMES = ['TWITTER_AUTH_TOKEN', 'TWITTER_CT0', 'MY_TW_AUTH', 'MY_TW_CT0']
const dir = new URL('./fixtures/cli/', import.meta.url)

/** A `twitter` that answers like twitter-cli 0.8.5 and records what it was started with (argv and the two variables). */
const FAKE_TWITTER = [
  'case "$1" in',
  '--version) echo "twitter, version 0.8.5";;',
  'search) if [ "$2" = "--help" ]; then echo "Usage: twitter search [OPTIONS] [QUERY]"; echo "  -n, --max INTEGER  Max number of tweets"; echo "  --json  Output as JSON."; else',
  '  printf "%s\\n" "$@" > "$0.args"; printf "%s|%s\\n" "$TWITTER_AUTH_TOKEN" "$TWITTER_CT0" > "$0.env"',
  "  cat '" + new URL('constructed-twitter-search.json', dir).pathname + "'; fi;;",
  '*) echo "twitter-cli";;',
  'esac',
].join('\n')

async function isolated<T>(env: Record<string, string>, fn: () => Promise<T>): Promise<T> {
  const saved = Object.fromEntries(NAMES.map(n => [n, process.env[n]]))
  for (const n of NAMES) delete process.env[n]
  Object.assign(process.env, env)
  clearProbeCache()
  try { return await fn() } finally {
    clearProbeCache()
    for (const [n, v] of Object.entries(saved)) { if (v === undefined) delete process.env[n]; else process.env[n] = v }
  }
}

function harness(extra: Record<string, unknown> = {}, credentials?: Record<string, string>) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wsp-tw-tokens-'))
  const store = new Store(path.join(tmp, 'store.db'))
  const asked: string[] = []
  const service = credentials ? { resolve: async (ref: unknown) => { asked.push(String(ref)); const value = credentials[String(ref)]; return value === undefined ? undefined : { value } } } : undefined
  const ctx = { get: (name: string) => (name === 'credentials' ? service : undefined) }
  const config = resolveConfig({ engines: ['ddg'], dbPath: path.join(tmp, 'store.db'), enableCliBackends: true, opencliEnabled: false, agentReachEnabled: true, platformBackends: { twitter: ['twitter'] }, ...extra } as never)
  const router = new SearchRouter(ctx as never, config, store, () => config, () => undefined, undefined, createBuiltinRegistry())
  const search = (query = 'deepseek local') => router.search({ query, count: 2, fresh: true, multi: false, signal: undefined, platform: { id: 'twitter' } as never })
  return { router, store, config, asked, search, cleanup: () => { router.dispose(); store.close(); fs.rmSync(tmp, { recursive: true, force: true }) } }
}

test('resolution order: settings literal, then the DSH credentials ref (own name or default), then the process environment', async () => {
  await isolated({ TWITTER_AUTH_TOKEN: 'from-env-auth-0001', TWITTER_CT0: 'from-env-ct0-0001' }, async () => {
    const env = harness()
    const cred = harness({}, { TWITTER_AUTH_TOKEN: 'from-cred-auth-0002' })
    const own = harness({ twitterAuthTokenEnv: 'MY_TW_AUTH', twitterCt0Env: 'MY_TW_CT0' }, { MY_TW_AUTH: 'from-own-ref-auth-3', MY_TW_CT0: 'from-own-ref-ct0-3' })
    const literal = harness({ twitterAuthToken: 'literal-auth-0004', twitterCt0: 'literal-ct0-0004' }, { TWITTER_AUTH_TOKEN: 'from-cred-auth-0002' })
    try {
      assert.deepEqual(await env.router.cliEnv(), { TWITTER_AUTH_TOKEN: 'from-env-auth-0001', TWITTER_CT0: 'from-env-ct0-0001' })
      assert.deepEqual(await cred.router.cliEnv(), { TWITTER_AUTH_TOKEN: 'from-cred-auth-0002', TWITTER_CT0: 'from-env-ct0-0001' }, 'credentials beat the environment, per value')
      assert.deepEqual(await own.router.cliEnv(), { TWITTER_AUTH_TOKEN: 'from-own-ref-auth-3', TWITTER_CT0: 'from-own-ref-ct0-3' }, 'twitterAuthTokenEnv / twitterCt0Env name the refs; the tool still gets its own variable names')
      assert.deepEqual(own.asked.sort(), ['MY_TW_AUTH', 'MY_TW_CT0'])
      assert.deepEqual(await literal.router.cliEnv(), { TWITTER_AUTH_TOKEN: 'literal-auth-0004', TWITTER_CT0: 'literal-ct0-0004' }, 'a settings literal wins over the credentials service')
      assert.deepEqual(literal.asked, [], 'a literal is not looked up elsewhere')
    } finally { for (const h of [env, cred, own, literal]) h.cleanup() }
  })
  await isolated({}, async () => {
    const none = harness()
    try { assert.deepEqual(await none.router.cliEnv(), {}) } finally { none.cleanup() }
  })
})

test('the tokens reach the twitter command through its environment only; argv, the results and the status carry none of them', { skip: !posix }, async () => {
  await isolated({}, async () => {
    // The Host environment has nothing: the values come from the DSH credentials service.
    const h = harness({}, { TWITTER_AUTH_TOKEN: AUTH, TWITTER_CT0: CT0 })
    try {
      await withCommands({ twitter: FAKE_TWITTER }, async bin => {
        const out = await h.search()
        assert.equal(out.engine, 'twitter')
        assert.equal(out.sources.length, 2)
        assert.equal(fs.readFileSync(path.join(bin, 'twitter.env'), 'utf8'), AUTH + '|' + CT0 + '\n', 'the child sees both values')
        assert.equal(fs.readFileSync(path.join(bin, 'twitter.args'), 'utf8'), 'search\ndeepseek local\n-n\n2\n--json\n')
        assert.ok(!JSON.stringify(out).includes(AUTH) && !JSON.stringify(out).includes(CT0))
        const report = JSON.stringify(await h.router.providerReport())
        assert.ok(!report.includes(AUTH) && !report.includes(CT0), 'the provider report shows no value')
        const tw = (await h.router.providerReport()).find(p => p.route === 'twitter')!
        assert.equal(tw.readiness.credential, 'configured')
        assert.equal(tw.readiness.available, true)
      })
    } finally { h.cleanup() }
    // A settings literal works the same way.
    const lit = harness({ twitterAuthToken: AUTH, twitterCt0: CT0 })
    try {
      await withCommands({ twitter: FAKE_TWITTER }, async bin => {
        assert.equal((await lit.search()).sources.length, 2)
        assert.equal(fs.readFileSync(path.join(bin, 'twitter.env'), 'utf8'), AUTH + '|' + CT0 + '\n')
      })
    } finally { lit.cleanup() }
  })
})

test('without tokens nothing is started; the error and the status say where the plugin looked and never print a value', { skip: !posix }, async () => {
  await isolated({}, async () => {
    const h = harness()
    try {
      await withCommands({ twitter: FAKE_TWITTER }, async bin => {
        await assert.rejects(h.search(), (error: unknown) => {
          const text = String((error as Error).message)
          assert.match(text, /TWITTER_AUTH_TOKEN \/ TWITTER_CT0 not set/)
          assert.match(text, /DSH credentials/)
          assert.match(text, /Host process environment; a shell profile alone is not enough/)
          return true
        })
        assert.equal(fs.existsSync(path.join(bin, 'twitter.args')), false, 'the tool was not started')
        // sources.status: the cli line says where it looked.
        const defs = new Map<string, any>()
        registerTools({ ctx: { tools: { register: (d: any) => defs.set(d.name, d) } } as any, config: h.config, dynamic: () => h.config, store: {} as any, router: h.router as any, fetch: {} as any })
        const status = await callAction(defs, 'sources.status')
        const line = status.cli.find((c: any) => c.id === 'twitter')
        assert.equal(line.available, false)
        assert.match(line.note, /TWITTER_AUTH_TOKEN \/ TWITTER_CT0 are not set \(looked in the plugin settings twitterAuthToken \/ twitterCt0, the DSH credentials refs twitterAuthTokenEnv \/ twitterCt0Env and the process environment\): set them in DSH credentials or in the Host process environment; a shell profile alone is not enough/)
      })
    } finally { h.cleanup() }
    const withCred = harness({}, { TWITTER_AUTH_TOKEN: AUTH, TWITTER_CT0: CT0 })
    try {
      await withCommands({ twitter: FAKE_TWITTER }, async () => {
        const defs = new Map<string, any>()
        registerTools({ ctx: { tools: { register: (d: any) => defs.set(d.name, d) } } as any, config: withCred.config, dynamic: () => withCred.config, store: {} as any, router: withCred.router as any, fetch: {} as any })
        const status = await callAction(defs, 'sources.status')
        assert.equal(status.cli.find((c: any) => c.id === 'twitter').available, true, 'sources.status sees tokens held by DSH credentials, not only the process environment')
        const text = renderResult('sources.status', status)
        assert.ok(!text.includes(AUTH) && !text.includes(CT0))
        const rec = await callAction(defs, 'search.recommend', { task: 'what do people say on twitter about deepseek', platform: 'twitter' })
        assert.ok(!JSON.stringify(rec).includes(AUTH))
        assert.ok(!(rec.picks.find((p: any) => p.id === 'twitter')?.missing ?? []).some((m: string) => /credentials: set/.test(m)), 'search.recommend counts credentials held by DSH as present')
      })
    } finally { withCred.cleanup() }
  })
})

test('a failing twitter command: its own stderr is redacted of the token values before it reaches the error', { skip: !posix }, async () => {
  await isolated({}, async () => {
    const h = harness({}, { TWITTER_AUTH_TOKEN: AUTH, TWITTER_CT0: CT0 })
    try {
      const noisy = 'case "$1" in --version) echo "twitter, version 0.8.5";; search) if [ "$2" = "--help" ]; then echo "--json -n, --max"; else echo "boom: cookie ' + AUTH + ' and ct0=' + CT0 + ' rejected" >&2; exit 1; fi;; esac'
      await withCommands({ twitter: noisy }, async () => {
        await assert.rejects(h.search(), (error: unknown) => {
          const text = String((error as Error).message) + String((error as Error).stack)
          assert.ok(!text.includes(AUTH) && !text.includes(CT0), text)
          assert.match(text, /\[redacted\]/)
          return true
        })
      })
    } finally { h.cleanup() }
  })
})

test('twitterGate reads the resolved values and names the missing ones; loginHint names where to set them', () => {
  const on = { enableCliBackends: true, agentReachEnabled: true }
  assert.deepEqual(twitterGate(on, { available: true }, { TWITTER_AUTH_TOKEN: 'a', TWITTER_CT0: 'b' }), { available: true })
  const half = twitterGate(on, { available: true }, { TWITTER_AUTH_TOKEN: 'a' })
  assert.equal(half.available, false)
  assert.match(half.note!, /^twitter command found, but TWITTER_CT0 is not set \(looked in the plugin settings/)
  assert.match(half.note!, /a shell profile alone is not enough/)
  const hint = loginHint(builtinSpecById('twitter')!)
  assert.match(hint, /DSH credentials \(plugin settings twitterAuthToken \/ twitterCt0\) or in the Host process environment; a shell profile alone is not enough/)
  assert.match(loginHint({ bins: ['x'], env: { required: ['MY_KEY'] } }), /^set MY_KEY in the Host process environment \(a shell profile alone is not enough\)$/, 'other tools are only read from the environment')
})
