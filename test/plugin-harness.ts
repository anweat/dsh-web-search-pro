import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { registerHooks } from 'node:module'
import { callAction, callEnvelope } from './call-helper.ts'

// dsh-tools is a host peer; tool definitions are identity in this isolated run.
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === '@deepseek-ai/dsh-tools') {
      return { url: 'data:text/javascript,export const defineTool = value => value', shortCircuit: true }
    }
    return nextResolve(specifier, context)
  },
})
const plugin = await import('../src/index.ts')

export interface PluginHarness {
  dir: string
  /** The entry's live configuration object (the Host updates it in place; tests do the same). */
  config: Record<string, any>
  tools: Map<string, any>
  listeners: { event: string; handler: any }[]
  rpc: Map<string, any>
  /** Optional services the fake ctx hands out by name (e.g. `browser`); tests assign them. */
  services: Record<string, unknown>
  run: (action: string, args?: Record<string, unknown>, exec?: unknown) => Promise<any>
  envelope: (action: string, args?: Record<string, unknown>, exec?: unknown) => Promise<any>
  overlayFile: string
  cleanup: () => void
}

/** Boot the real apply() against a fake ctx (no browser). `before(dir)` runs first, e.g. to put an overlay file in place. */
export function bootPlugin(extra: Record<string, unknown> = {}, before?: (dir: string) => void): PluginHarness {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wsp-plugin-'))
  before?.(dir)
  const tools = new Map<string, any>()
  const listeners: { event: string; handler: any }[] = []
  const rpc = new Map<string, any>()
  const disposers: (() => void)[] = []
  const services: Record<string, unknown> = {}
  const config: Record<string, any> = {
    engines: ['ddg'], parallelEngines: false, searchMaxResults: 8, timeoutMs: 5_000, ttlSeconds: 60,
    memoryCacheEntries: 16, rrfConstant: 60, freshnessBoost: 0, authorityBoost: 0, freshnessDays: 30,
    authorityDomains: [], enableCliBackends: false, opencliEnabled: false, agentReachEnabled: false,
    registerProvider: false, providerId: 'web-search-pro', allowProxyFakeIp: false, verbose: false,
    dbPath: path.join(dir, 'store.db'),
    playwright: { enabled: true, snapshotDir: path.join(dir, 'shots') },
    ...extra,
  }
  const connection = { rpc: { handle: (channel: string, handler: any) => { rpc.set(channel, handler); return async () => { rpc.delete(channel) } } } }
  const ctx: any = {
    fiber: { config },
    get: (name: string) => name === 'connection' ? connection : services[name],
    effect: (fn: () => () => void) => { disposers.push(fn()) },
    logger: () => ({ info() {}, warn() {}, error() {} }),
    tools: { register: (d: any) => tools.set(d.name, d) },
    systemPrompt: { section: () => {} },
    on: (event: string, handler: any) => { listeners.push({ event, handler }); return () => {} },
    // The Host injects when the services exist; the harness has the connection transport, so run the callback with a context that carries it.
    inject: (names: string[], callback: (ctx: any) => void) => { if (names.includes('connection')) callback({ root: { connection }, effect: (fn: () => () => void) => { disposers.push(fn()) } }) },
  }
  // The plugin resolves a missing dbPath to $DSH_HOME/data/web-search-pro: never the real home in a test.
  if (typeof config.dbPath !== 'string') throw new Error('bootPlugin: dbPath must stay a temp path; a missing dbPath would open the real home')
  plugin.apply(ctx, config as never)
  return {
    dir, config, tools, listeners, rpc, services,
    run: (action, args = {}, exec = { signal: undefined }) => callAction(tools, action, args, exec),
    envelope: (action, args = {}, exec = { signal: undefined }) => callEnvelope(tools, action, args, exec),
    overlayFile: path.join(dir, 'overlay.json'),
    cleanup: () => { for (const d of disposers) d(); fs.rmSync(dir, { recursive: true, force: true }) },
  }
}
