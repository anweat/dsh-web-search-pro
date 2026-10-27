/**
 * The server half of the private RPC channel of the settings card (see rpc-types.ts). It uses the Host's connection transport the
 * way the dsh-browser plugin does for its panel (`connection.rpc.handle`, an authenticated absolute channel prefix); when the Host
 * has no `connection` / `webServer` service nothing is registered and the card says that "Try it" and the live readiness are
 * unavailable (everything else in the card works without them).
 * @module web-search-pro/rpc
 */

import type { Context } from '@deepseek-ai/cordis'
import type { ResolvedConfig } from './config.ts'
import type { SearchRouter } from './router.ts'
import type { OverlayStore } from './overlay.ts'
import type { PendingRestart } from './restart.ts'
import { trialCli } from './cli/trial.ts'
import { RPC_CHANNEL, type RevokeRequest, type StatusView, type TrialRequest } from './rpc-types.ts'
import { overlayKeys } from './overlay-types.ts'

type Handler = (endpoint: string, payload: unknown, context?: { signal?: AbortSignal }) => Promise<{ ok: true; value: unknown } | { ok: false; error: { code: 'bad-request' | 'not-found'; message: string; details: Record<string, unknown> } }>

export interface RpcServices {
  router: Pick<SearchRouter, 'providerReport'>
  dynamic: () => ResolvedConfig
  /** The agent overlay (read and revoke endpoints); absent in tests of the older endpoints. */
  overlay?: OverlayStore
  /** Settings changed in the configuration that only take effect at the next start. */
  pendingRestart?: () => PendingRestart[]
}

const isRecord = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value)

/** Readiness for the card, from the report `sources.status` is made of (local probes; never a search). */
export async function statusView(router: Pick<SearchRouter, 'providerReport'>, extras: Pick<RpcServices, 'overlay' | 'pendingRestart'> = {}): Promise<StatusView> {
  const report = await router.providerReport()
  const view: StatusView = { sources: {}, legs: {} }
  const restart = extras.pendingRestart?.() ?? []
  if (restart.length) view.pendingRestart = restart
  if (extras.overlay) {
    const problem = extras.overlay.problem
    const current = extras.overlay.current()
    view.overlay = { revision: current.revision, count: overlayKeys(current.values).length, valid: problem === undefined, ...problem ? { problem } : {} }
  }
  for (const provider of report) {
    view.sources[provider.route] = { available: provider.readiness.available, ...provider.readiness.reason ? { reason: provider.readiness.reason } : {}, confidence: provider.confidence }
    for (const leg of provider.chain ?? []) view.legs[provider.route + '/' + leg.id] = { ready: leg.state === 'ready', ...leg.reason ? { reason: leg.reason } : {}, confidence: leg.confidence }
  }
  return view
}

/** The handler of the channel: `status` and `trial`. A failure is a value (`ok: false`), never a throw into the transport. */
export function createHandler(services: RpcServices): Handler {
  return async (endpoint, rawPayload, context) => {
    try {
      const payload = isRecord(rawPayload) ? rawPayload : {}
      if (endpoint === 'status') return { ok: true, value: await statusView(services.router, services) }
      if (endpoint === 'overlay') {
        if (!services.overlay) return { ok: false, error: { code: 'not-found', message: 'the agent overlay is not available', details: {} } }
        return { ok: true, value: services.overlay.view(typeof payload.limit === 'number' ? payload.limit : 20) }
      }
      if (endpoint === 'overlay.revoke') {
        if (!services.overlay) return { ok: false, error: { code: 'not-found', message: 'the agent overlay is not available', details: {} } }
        const request = payload as unknown as Partial<RevokeRequest>
        const keys = request.keys === 'all' ? 'all' : Array.isArray(request.keys) && request.keys.every(key => typeof key === 'string') && request.keys.length > 0 ? request.keys as string[] : undefined
        if (keys === undefined) return { ok: false, error: { code: 'bad-request', message: 'overlay.revoke needs keys: a list of overlay keys, or "all"', details: {} } }
        // Keys another panel (or the agent) already took away are not an error: what is left to drop is dropped.
        const present = new Set(services.overlay.items().map(item => item.key))
        const drop = keys === 'all' ? 'all' : keys.filter(key => present.has(key))
        try {
          if (drop === 'all' || drop.length > 0) {
            services.overlay.apply({ kind: 'revoke', keys: drop }, request.adopted === true
              ? { actor: 'user', action: 'panel.adopt', reason: 'adopted into the configuration in the settings card' }
              : { actor: 'user', action: keys === 'all' ? 'panel.revoke_all' : 'panel.revoke', reason: 'revoked in the settings card' })
          }
        } catch (error) {
          return { ok: false, error: { code: 'bad-request', message: String(error instanceof Error ? error.message : error).slice(0, 500), details: {} } }
        }
        return { ok: true, value: services.overlay.view(20) }
      }
      if (endpoint === 'trial') {
        const request = payload as unknown as Partial<TrialRequest>
        if (typeof request.id !== 'string' || !request.id) return { ok: false, error: { code: 'bad-request', message: 'trial needs the id of the entry', details: {} } }
        return { ok: true, value: await trialCli(request.id, request.spec, typeof request.query === 'string' ? request.query : '', { enabled: services.dynamic().enableCliBackends, ...context?.signal ? { signal: context.signal } : {} }) }
      }
      return { ok: false, error: { code: 'not-found', message: 'unknown endpoint: ' + endpoint, details: {} } }
    } catch (error) {
      return { ok: false, error: { code: 'bad-request', message: String(error instanceof Error ? error.message : error).slice(0, 500), details: {} } }
    }
  }
}

/** Register the channel when the Host has the transport; the effect unregisters it with the plugin. */
export function registerRpc(ctx: Context, services: RpcServices): void {
  ctx.inject(['connection', 'webServer'], (connectionCtx) => {
    const connection = (connectionCtx.root as unknown as { connection: { rpc: { handle(channel: string, handler: Handler): () => Promise<void> } } }).connection
    connectionCtx.effect(() => connection.rpc.handle(RPC_CHANNEL, createHandler(services)), 'web-search-pro: settings card RPC channel')
  })
}
