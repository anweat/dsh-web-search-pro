import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { resolveConfig } from '../src/config.ts'

test('rc.2 loader receives Config on the default plugin object', () => {
  const source = readFileSync(new URL('../src/index.ts', import.meta.url), 'utf8')
  assert.match(source, /export default \{\s*name,\s*inject,\s*Config,\s*apply\s*\}/)
  const patch = readFileSync(new URL('../cordis.patch.yml', import.meta.url), 'utf8')
  assert.doesNotMatch(patch, /^\s+config:/m)
})

test('rc.2 volatile form values are unwrapped at the runtime boundary', () => {
  const live = <T>(value: T) => ({ get: () => value })
  const config = {
    dbPath: live('/tmp/dsh-web-search-pro-rc2-test.db'),
    timeoutMs: live(45_000),
    providerId: live('custom-search'),
    registerProvider: live(true),
    playwright: { enabled: live(false), snapshotDir: '/tmp/dsh-web-search-pro-rc2-shots' },
    verbose: live(true),
  }
  const resolved = resolveConfig(config as never)
  assert.equal(resolved.dbPath, '/tmp/dsh-web-search-pro-rc2-test.db')
  assert.equal(resolved.timeoutMs, 45_000)
  assert.equal(resolved.providerId, 'custom-search')
  assert.equal(resolved.registerProvider, true)
  assert.deepEqual(resolved.playwright, { enabled: false, snapshotDir: '/tmp/dsh-web-search-pro-rc2-shots' })
  assert.equal(resolved.verbose, true)
})

test('an unset rc.2 volatile field falls back after unwrapping', () => {
  const resolved = resolveConfig({ dbPath: { get: () => undefined } } as never)
  assert.match(resolved.dbPath, /web-search-pro[\\/]store\.db$/)
  assert.equal(resolved.playwright.enabled, true)
})

test('evidence settings default to the rule scorer with Jev off, and unwrap volatile values', () => {
  assert.deepEqual(resolveConfig({} as never).evidence, { scorer: 'rule', jevMode: 'off', hybridBorderline: false, maxJevQuestions: 64, autoProviders: true, sourcePolicy: 'default', maxRounds: 2, maxQueries: 4 })
  const live = <T>(value: T) => ({ get: () => value })
  const resolved = resolveConfig({ evidence: { scorer: live('jev'), jevMode: live('hybrid'), hybridBorderline: live(true), maxJevQuestions: live(24), maxRounds: live(1), maxQueries: live(3) } } as never)
  assert.deepEqual(resolved.evidence, { scorer: 'jev', jevMode: 'hybrid', hybridBorderline: true, maxJevQuestions: 24, autoProviders: true, sourcePolicy: 'default', maxRounds: 1, maxQueries: 3 })
})
