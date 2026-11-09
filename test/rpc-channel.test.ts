import assert from 'node:assert/strict'
import { test } from 'node:test'
import { channelFailureMessage, openChannel, type ChannelContext, type ConnectionRegistrar } from '../src/rpc.ts'
import { RPC_CHANNEL } from '../src/rpc-types.ts'

const handler = async () => ({ ok: true as const, value: null })
const dispose = async (): Promise<void> => {}

/** A context like cordis': `extend` makes a child that inherits from it and gets the given properties as its own. */
function fakeContext(connectionOf: (child: object) => ConnectionRegistrar, webServer: unknown) {
  const children: object[] = []
  const root: Record<string, unknown> = {
    get: (name: string) => (name === 'webServer' ? webServer : undefined),
    extend(meta: Record<string, unknown>) {
      const child = Object.create(root)
      for (const key of Reflect.ownKeys(meta)) Object.defineProperty(child, key, Reflect.getOwnPropertyDescriptor(meta, key)!)
      Object.defineProperty(child, 'connection', { get: () => connectionOf(child) })
      children.push(child)
      return child
    },
  }
  return { ctx: root as unknown as ChannelContext, children }
}

test('handle is called on a derived context that owns the injected webServer, with the channel and the handler', () => {
  const webServer = { name: 'webServer' }
  const calls: unknown[][] = []
  let owner: any
  const { ctx, children } = fakeContext(child => ({
    rpc: { handle: (channel, h) => { owner = child; calls.push([channel, h]); return dispose } },
  }), webServer)
  assert.equal(openChannel(ctx, handler), dispose)
  assert.equal(children.length, 1)
  assert.equal(owner, children[0])
  assert.ok(Object.hasOwn(owner, 'webServer'), 'webServer is an own property of the owner the host captures')
  assert.equal(owner.webServer, webServer)
  assert.deepEqual(calls, [[RPC_CHANNEL, handler]])
})

test('the connection context itself is not given the property (the parent is not mutated)', () => {
  const { ctx } = fakeContext(() => ({ rpc: { handle: () => dispose } }), {})
  openChannel(ctx, handler)
  assert.ok(!Object.hasOwn(ctx as object, 'webServer'))
})

test('a throw from handle propagates, so registerRpc can warn and keep the plugin running', () => {
  const { ctx } = fakeContext(() => ({ rpc: { handle: () => { throw new Error('route already registered') } } }), {})
  assert.throws(() => openChannel(ctx, handler), /route already registered/)
})

test('the failure line names the channel and the reason, says what stops working, and carries no ANSI', () => {
  const line = channelFailureMessage(new Error('\u001b[31mcannot get property "webServer"\u001b[39m'))
  assert.ok(line.includes(RPC_CHANNEL))
  assert.ok(line.includes('cannot get property "webServer"'))
  assert.ok(!line.includes('\u001b'))
  assert.match(line, /live status.*agent-edits panel.*custom-CLI dry-run/)
})
