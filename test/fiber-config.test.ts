import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Config, resolveConfig } from '../src/config.ts'
import { liveFiberConfig } from '../src/fiber-config.ts'

// Cordis 4.1: `config` is the raw input, `effectiveConfig` the resolved object. Cordis 4.0.x: only `config`, already resolved.
const resolved = { dbPath: '/tmp/resolved.db', searchMaxResults: 3 }

test('cordis 4.1: effectiveConfig wins over the raw config', () => {
  const live = liveFiberConfig<Record<string, unknown>>({ effectiveConfig: resolved, config: { searchMaxResults: 99 } })
  assert.equal(live, resolved)
  assert.equal(resolveConfig(live as never).searchMaxResults, 3)
})

test('cordis 4.1: effectiveConfig is read live, so an in-place volatile update is seen on the next read', () => {
  const effective = { dbPath: '/tmp/x.db', searchMaxResults: 5 }
  const fiber = { effectiveConfig: effective, config: { searchMaxResults: 5 } }
  assert.equal(resolveConfig(liveFiberConfig(fiber) as never).searchMaxResults, 5)
  effective.searchMaxResults = 9
  assert.equal(resolveConfig(liveFiberConfig(fiber) as never).searchMaxResults, 9)
})

test('cordis 4.0.x: no effectiveConfig, the resolved fiber.config is used', () => {
  assert.equal(liveFiberConfig({ config: resolved }), resolved)
})

test('neither present (unconfigured 4.1 entry before activation, or a bare context): empty object, defaults apply', () => {
  for (const fiber of [{}, { config: undefined }, { effectiveConfig: undefined, config: undefined }, undefined]) {
    const live = liveFiberConfig(fiber)
    assert.deepEqual(live, {})
    assert.doesNotThrow(() => resolveConfig(live as never))
  }
})

test('the raw 4.1 config alone (what the `?? {}` fix reads) skips defaults the schema would fill in', () => {
  // Documents why effectiveConfig must come first: a partial raw object carries no nested schema defaults.
  const raw = { searchMaxResults: 4 }
  const viaSchema = Config(raw) as Record<string, unknown>
  assert.notDeepEqual(viaSchema, raw)
})
