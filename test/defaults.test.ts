import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Config, resolveConfig } from '../src/config.ts'
import { configuredDecider } from '../src/pipeline/judge-status.ts'
import { resolveCoverageSettings } from '../src/pipeline/coverage.ts'
import { createBuiltinRegistry } from '../src/providers/index.ts'
import { SearchRouter } from '../src/router.ts'
import { Store } from '../src/store.ts'

/** Out of the box (dev-plan M12, user asked): Jev and every model call are OFF, and Bocha is used only when a key is configured. */

test('defaults: Jev is off, the rule scorer decides, the coverage judge is off, and no judge provider is configured', () => {
  for (const config of [resolveConfig({} as never), resolveConfig(Config({}) as never)]) {
    assert.equal(config.evidence.jevMode, 'off')
    assert.equal(config.evidence.scorer, 'rule')
    // The schema may fill empty containers; nothing in them names a provider, a mode or a key.
    assert.equal(config.evidence.judge?.provider, undefined, 'no judge provider is selected, so there is no key to call')
    assert.equal(config.evidence.judge?.mode, undefined)
    assert.deepEqual(config.evidence.judge?.providers ?? {}, {})
    assert.equal(config.evidence.hybridBorderline, false)
    assert.deepEqual(configuredDecider(config.evidence), { mode: 'off', decides: 'rule' })
    assert.equal(resolveCoverageSettings(config.evidence.coverage).settings.mode, 'off')
    assert.equal(config.provider.evidence, 'auto', 'the host-provider route does not turn a judge on either')
  }
  // Even with a Jev key in the environment the default stays off: only an explicit mode turns it on.
  const saved = process.env.BOCHA_JEV_API_KEY
  process.env.BOCHA_JEV_API_KEY = 'present-but-unused'
  try { assert.equal(resolveConfig({} as never).evidence.jevMode, 'off') } finally { if (saved === undefined) delete process.env.BOCHA_JEV_API_KEY; else process.env.BOCHA_JEV_API_KEY = saved }
})

test('defaults: Bocha is not an engine unless configured, and it is only available with a key', async () => {
  const config = resolveConfig({} as never)
  assert.ok(!config.engines.includes('bocha'), 'not in the default engine list')
  const names = ['BOCHA_SEARCH_API_KEY', 'BOCHA_JEV_API_KEY']
  const saved = names.map(n => process.env[n])
  for (const n of names) delete process.env[n]
  try {
    const registry = createBuiltinRegistry()
    const env = (deps: object) => ({ deps: { enableCli: false, opencliEnabled: false, agentReachEnabled: false, allowProxyFakeIp: false, skipSeam: false, ...deps }, config })
    const bare = await registry.resolve('bocha')!.probeLocal(env({}) as never) as any
    assert.deepEqual([bare.available, bare.credential], [false, 'missing'])
    assert.equal(registry.resolve('bocha')!.create(env({}).deps as never, config).available(), false)
    const keyed = await registry.resolve('bocha')!.probeLocal(env({ bochaApiKey: 'k' }) as never) as any
    assert.deepEqual([keyed.available, keyed.credential], [true, 'configured'])
    // Through the router (which reads the environment): no key anywhere, so the provider is unavailable.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wsp-defaults-'))
    const store = new Store(path.join(dir, 'store.db'))
    try {
      const router = new SearchRouter({ get: () => undefined } as never, resolveConfig({ dbPath: path.join(dir, 'store.db') } as never), store, undefined, undefined, undefined, registry)
      const status = (await router.providerStatuses(['bocha'])).get('bocha')!
      assert.equal(status.state, 'unavailable')
      assert.equal(status.credential, 'missing')
      process.env.BOCHA_SEARCH_API_KEY = 'configured-by-user'
      assert.equal((await router.providerStatuses(['bocha'])).get('bocha')!.state, 'ready')
    } finally { store.close(); fs.rmSync(dir, { recursive: true, force: true }) }
  } finally { names.forEach((n, i) => { if (saved[i] === undefined) delete process.env[n]; else process.env[n] = saved[i]! }) }
})

test('defaults are stated plainly in the README quick start (zh and en)', () => {
  const readme = fs.readFileSync(new URL('../README.md', import.meta.url), 'utf8')
  assert.match(readme, /默认关闭 Jev/)
  assert.match(readme, /evidence\.jevMode: off/)
  assert.match(readme, /Jev is off by default/)
  assert.match(readme, /no model is called/i)
  assert.match(readme, /Bocha is used only when you configure a key|只有配置了博查 Key 才会使用博查/)
})
