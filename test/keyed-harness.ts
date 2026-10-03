/** Shared harness of the keyed-source tests (dev-plan M7c): a fake fetch + DNS, usage recording, and fixtures that say they are not live captures. */
import fs from 'node:fs'
import assert from 'node:assert/strict'
import { EngineError, type Engine, type EngineDeps } from '../src/engines.ts'

export const fixture = (name: string): any => JSON.parse(fs.readFileSync(new URL('./fixtures/' + name, import.meta.url), 'utf8'))
export const PUBLIC = async () => [{ address: '93.184.216.34', family: 4 }]
export const reply = (status: number, body: unknown, headers: Record<string, string> = {}): Response =>
  new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } })

export interface Call { url: string; init: RequestInit; headers: Record<string, string>; body?: any }

export function harness(route: string, make: (deps: EngineDeps) => Engine, respond: (call: Call) => Response | Promise<Response>, key: string | null = 'test-key-' + route + '-0001', deps: Partial<EngineDeps> = {}) {
  const calls: Call[] = []
  const usage: any[] = []
  const fetchImpl = (async (url: unknown, init: RequestInit) => {
    const headers = Object.fromEntries(Object.entries((init?.headers ?? {}) as Record<string, string>).map(([k, v]) => [k.toLowerCase(), v]))
    const call: Call = { url: String(url), init, headers, ...typeof init?.body === 'string' ? { body: JSON.parse(init.body) } : {} }
    calls.push(call)
    return respond(call)
  }) as typeof fetch
  const engine = make({ enableCli: false, opencliEnabled: false, agentReachEnabled: false, allowProxyFakeIp: false, skipSeam: false, fetchImpl, lookup: PUBLIC, usage: { record: e => { usage.push(e) } }, ...key !== null ? { sourceKeys: { [route]: key } } : {}, ...deps })
  return { engine, calls, usage, key: key as string }
}

export const fails = async (p: Promise<unknown>): Promise<EngineError> => { try { await p } catch (e) { assert.ok(e instanceof EngineError, String(e)); return e } throw new Error('expected a failure') }

/** The error says nothing of the key or of an unredacted body. */
export function assertNoKey(error: EngineError, key: string): void {
  assert.ok(!error.message.includes(key) && !String(error.stack).includes(key), 'the key never appears in an error')
}
