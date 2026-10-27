import assert from 'node:assert/strict'
import test from 'node:test'
import { RPC_CHANNEL } from '../src/rpc-types.ts'
import type { OverlayView } from '../src/overlay-types.ts'
import { bootPlugin, type PluginHarness } from './plugin-harness.ts'
import { engineSpec } from './overlay-helpers.ts'

const call = async (h: PluginHarness, endpoint: string, payload: unknown = {}): Promise<any> => h.rpc.get(RPC_CHANNEL)(endpoint, payload)

test('the plugin registers the channel on the Host transport and the status endpoint reports the overlay and the settings waiting for a restart', async () => {
  const h = bootPlugin()
  try {
    assert.ok(h.rpc.get(RPC_CHANNEL), 'registered')
    const clean = await call(h, 'status')
    assert.equal(clean.ok, true)
    assert.deepEqual(clean.value.overlay, { revision: 0, count: 0, valid: true })
    assert.equal(clean.value.pendingRestart, undefined)
    await h.run('config.set_order', { engines: ['bing'], disabled: ['jina'], reason: 'the agent changes the order' })
    h.config.registerProvider = true
    h.config.verbose = true
    const status = (await call(h, 'status')).value
    assert.deepEqual(status.overlay, { revision: 1, count: 2, valid: true })
    assert.deepEqual(status.pendingRestart.map((entry: any) => entry.field), ['registerProvider', 'verbose'])
  } finally { h.cleanup() }
})

test('the overlay endpoint returns the keys with their reason and time, the baseline value beside them, and the newest audit first', async () => {
  const h = bootPlugin({ engines: ['ddg'] })
  try {
    assert.deepEqual((await call(h, 'overlay')).value.items, [])
    await h.run('config.set_order', { engines: ['bing', 'ddg'], reason: 'bing first' })
    await h.run('config.upsert_cli', { id: 'mine', spec: engineSpec(), reason: 'the user asked for mine' })
    const view = (await call(h, 'overlay')).value as OverlayView
    assert.equal(view.valid, true)
    assert.equal(view.revision, 2)
    assert.equal(view.file, h.overlayFile)
    assert.deepEqual(view.items.map(item => [item.key, item.kind, item.target, item.summary, item.baseline, item.reason, item.actor]), [
      ['engines', 'engines', undefined, 'bing > ddg', 'ddg', 'bing first', 'agent'],
      ['cliAdapters.mine', 'cli', 'mine', 'demo-cli search {query} --limit {count} --json', '(none)', 'the user asked for mine', 'agent'],
    ])
    assert.deepEqual(view.audit.map(entry => entry.reason), ['the user asked for mine', 'bing first'])
    assert.equal((await call(h, 'overlay', { limit: 1 })).value.audit.length, 1)
  } finally { h.cleanup() }
})

test('overlay.revoke drops entries as the user: audited with actor user, effective at once, unknown keys ignored, bad payloads refused', async () => {
  const h = bootPlugin({ engines: ['ddg'] })
  try {
    await h.run('config.set_order', { engines: ['bing', 'ddg'], disabled: ['jina'], reason: 'the agent changes the order' })
    await h.run('config.set_confidence', { id: 'exa', value: 0.5, reason: 'half trusted' })
    const one = await call(h, 'overlay.revoke', { keys: ['sources.disabled', 'sources.priority'] })
    assert.equal(one.ok, true)
    assert.deepEqual(one.value.items.map((item: any) => item.key), ['engines', 'sources.confidence.exa'])
    const last = one.value.audit[0]
    assert.deepEqual([last.actor, last.action, last.reason], ['user', 'panel.revoke', 'revoked in the settings card'])
    assert.deepEqual(last.changes, [{ key: 'sources.disabled', before: 'jina', after: '(empty)' }])
    assert.deepEqual((await h.run('config.inspect')).disabled, { value: [], source: 'baseline' })
    const adopted = await call(h, 'overlay.revoke', { keys: ['engines'], adopted: true })
    assert.equal(adopted.value.audit[0].action, 'panel.adopt')
    // Nothing left to drop: not an error, nothing written.
    const revision = adopted.value.revision
    assert.equal((await call(h, 'overlay.revoke', { keys: ['engines'] })).value.revision, revision)
    const all = await call(h, 'overlay.revoke', { keys: 'all' })
    assert.deepEqual(all.value.items, [])
    assert.equal(all.value.audit[0].action, 'panel.revoke_all')
    assert.equal((await call(h, 'overlay.revoke', {})).ok, false)
    assert.equal((await call(h, 'overlay.revoke', { keys: [] })).ok, false)
    assert.equal((await call(h, 'overlay.revoke', { keys: [1] })).ok, false)
    // An agent write after a user revoke sees the new revision.
    const next = await h.run('config.set_order', { engines: ['bing'], reason: 'again after the user revoked', expectedRevision: all.value.revision })
    assert.equal(next.revision, all.value.revision + 1)
  } finally { h.cleanup() }
})

test('a broken overlay is visible to the card (valid: false with the reason) and "Revoke all" repairs it', async () => {
  const h = bootPlugin()
  try {
    await h.run('config.set_order', { engines: ['bing'], reason: 'one good change' })
    const fs = await import('node:fs')
    fs.writeFileSync(h.overlayFile, '{"broken": true')
    const view = (await call(h, 'overlay')).value as OverlayView
    assert.equal(view.valid, false)
    assert.match(view.problem ?? '', /not valid JSON/)
    assert.equal((await call(h, 'status')).value.overlay.valid, false)
    const repaired = await call(h, 'overlay.revoke', { keys: 'all' })
    assert.equal(repaired.ok, true)
    assert.equal(repaired.value.valid, true)
    assert.deepEqual(repaired.value.audit[0].changes.map((change: any) => change.key), ['(overlay file)'])
  } finally { h.cleanup() }
})

test('the overlay endpoints say so when the store is absent, and status still answers', async () => {
  const { createHandler } = await import('../src/rpc.ts')
  const handler = createHandler({ router: { providerReport: async () => [] } as never, dynamic: () => ({}) as never })
  assert.equal((await handler('overlay', {})).ok, false)
  assert.equal((await handler('overlay.revoke', { keys: 'all' })).ok, false)
  assert.equal((await handler('status', {})).ok, true)
})
