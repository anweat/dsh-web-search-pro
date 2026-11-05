import assert from 'node:assert/strict'
import { test } from 'node:test'
import { openChannel, type ConnectionRegistrar } from '../src/rpc.ts'
import { RPC_CHANNEL } from '../src/rpc-types.ts'

const handler = async () => ({ ok: true as const, value: null })
const dispose = async (): Promise<void> => {}
const cordis41 = (): never => { throw new Error('cannot get property "webServer" without inject') }

test('rpc.handle works: it is used and register is never touched', () => {
  const calls: string[] = []
  const connection: ConnectionRegistrar = {
    rpc: { handle: (channel) => { calls.push('handle ' + channel); return dispose } },
    register: () => { calls.push('register'); return dispose },
  }
  assert.equal(openChannel({}, connection, handler), dispose)
  assert.deepEqual(calls, ['handle ' + RPC_CHANNEL])
})

test('rpc.handle throws and register exists: register gets the injecting owner, channel and handler', () => {
  const owner = { name: 'connectionCtx' }
  const seen: unknown[] = []
  const connection: ConnectionRegistrar = {
    rpc: { handle: cordis41 },
    register: (o, channel, h) => { seen.push(o, channel, h); return dispose },
  }
  assert.equal(openChannel(owner, connection, handler), dispose)
  assert.deepEqual(seen, [owner, RPC_CHANNEL, handler])
})

test('rpc.handle throws and register is missing: reported, then rethrown', () => {
  const reports: string[] = []
  const connection: ConnectionRegistrar = { rpc: { handle: cordis41 } }
  assert.throws(() => openChannel({}, connection, handler, m => reports.push(m)), /without inject/)
  assert.equal(reports.length, 1)
  assert.match(reports[0]!, /not mounted.*without inject.*no connection\.register/)
})
