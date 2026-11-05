/**
 * The server half of the private RPC channel of the settings card (see rpc-types.ts). It uses the Host's connection transport the
 * way the dsh-browser plugin does for its panel (`connection.rpc.handle`, an authenticated absolute channel prefix); when the Host
 * has no `connection` / `webServer` service nothing is registered and the card says that "Try it" and the live readiness are
 * unavailable (everything else in the card works without them).
 * @module web-search-pro/rpc
 */
import { trialCli } from "./cli/trial.js";
import { RPC_CHANNEL } from "./rpc-types.js";
import { overlayKeys } from "./overlay-types.js";
const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
/** Readiness for the card, from the report `sources.status` is made of (local probes; never a search). */
export async function statusView(router, extras = {}) {
    const report = await router.providerReport();
    const view = { sources: {}, legs: {} };
    const restart = extras.pendingRestart?.() ?? [];
    if (restart.length)
        view.pendingRestart = restart;
    if (extras.overlay) {
        const problem = extras.overlay.problem;
        const current = extras.overlay.current();
        view.overlay = { revision: current.revision, count: overlayKeys(current.values).length, valid: problem === undefined, ...problem ? { problem } : {} };
    }
    for (const provider of report) {
        view.sources[provider.route] = { available: provider.readiness.available, ...provider.readiness.reason ? { reason: provider.readiness.reason } : {}, confidence: provider.confidence };
        for (const leg of provider.chain ?? [])
            view.legs[provider.route + '/' + leg.id] = { ready: leg.state === 'ready', ...leg.reason ? { reason: leg.reason } : {}, confidence: leg.confidence };
    }
    return view;
}
/** The handler of the channel: `status` and `trial`. A failure is a value (`ok: false`), never a throw into the transport. */
export function createHandler(services) {
    return async (endpoint, rawPayload, context) => {
        try {
            const payload = isRecord(rawPayload) ? rawPayload : {};
            if (endpoint === 'status')
                return { ok: true, value: await statusView(services.router, services) };
            if (endpoint === 'overlay') {
                if (!services.overlay)
                    return { ok: false, error: { code: 'not-found', message: 'the agent overlay is not available', details: {} } };
                return { ok: true, value: services.overlay.view(typeof payload.limit === 'number' ? payload.limit : 20) };
            }
            if (endpoint === 'overlay.revoke') {
                if (!services.overlay)
                    return { ok: false, error: { code: 'not-found', message: 'the agent overlay is not available', details: {} } };
                const request = payload;
                const keys = request.keys === 'all' ? 'all' : Array.isArray(request.keys) && request.keys.every(key => typeof key === 'string') && request.keys.length > 0 ? request.keys : undefined;
                if (keys === undefined)
                    return { ok: false, error: { code: 'bad-request', message: 'overlay.revoke needs keys: a list of overlay keys, or "all"', details: {} } };
                // Keys another panel (or the agent) already took away are not an error: what is left to drop is dropped.
                const present = new Set(services.overlay.items().map(item => item.key));
                const drop = keys === 'all' ? 'all' : keys.filter(key => present.has(key));
                try {
                    if (drop === 'all' || drop.length > 0) {
                        services.overlay.apply({ kind: 'revoke', keys: drop }, request.adopted === true
                            ? { actor: 'user', action: 'panel.adopt', reason: 'adopted into the configuration in the settings card' }
                            : { actor: 'user', action: keys === 'all' ? 'panel.revoke_all' : 'panel.revoke', reason: 'revoked in the settings card' });
                    }
                }
                catch (error) {
                    return { ok: false, error: { code: 'bad-request', message: String(error instanceof Error ? error.message : error).slice(0, 500), details: {} } };
                }
                return { ok: true, value: services.overlay.view(20) };
            }
            if (endpoint === 'trial') {
                const request = payload;
                if (typeof request.id !== 'string' || !request.id)
                    return { ok: false, error: { code: 'bad-request', message: 'trial needs the id of the entry', details: {} } };
                return { ok: true, value: await trialCli(request.id, request.spec, typeof request.query === 'string' ? request.query : '', { enabled: services.dynamic().enableCliBackends, ...context?.signal ? { signal: context.signal } : {} }) };
            }
            return { ok: false, error: { code: 'not-found', message: 'unknown endpoint: ' + endpoint, details: {} } };
        }
        catch (error) {
            return { ok: false, error: { code: 'bad-request', message: String(error instanceof Error ? error.message : error).slice(0, 500), details: {} } };
        }
    };
}
/**
 * Mount the channel and return its disposer.
 *
 * `connection.rpc.handle` mounts the Web route with `owner.webServer`, read inside the Host's own `HostConnectionService.register`
 * (packages/client/connection/src/rpc-host.ts:274). Under cordis 4.1 (DSH 0.2.2) a service method's property reads are checked against
 * the `inject` list of the Context that DEFINED the method, i.e. the Connection plugin, which does not list `webServer`, so the call throws
 * `cannot get property "webServer" without inject` for every external plugin (cordis 4.0.x did not check). The throw happened inside an
 * inject callback and was never reported: the channel stayed unmounted and the settings card got HTTP 405. The Host's `register(owner,
 * channel, handler)` takes the owner explicitly, so the fallback passes `owner`, the Context that did inject `webServer`: same route, same
 * transport and authentication. `rpc.handle` is tried first, so hosts where it works are unchanged. `register` is private in the Host's
 * types; if a later host drops it, the failure is logged, never swallowed.
 */
export function openChannel(owner, connection, handler, report = () => { }) {
    try {
        return connection.rpc.handle(RPC_CHANNEL, handler);
    }
    catch (error) {
        if (typeof connection.register !== 'function') {
            report('web-search-pro: settings card RPC channel not mounted: connection.rpc.handle failed (' + String(error instanceof Error ? error.message : error) + ') and the host has no connection.register fallback');
            throw error;
        }
        return connection.register(owner, RPC_CHANNEL, handler);
    }
}
/** Register the channel when the Host has the transport; the effect unregisters it with the plugin. */
export function registerRpc(ctx, services) {
    ctx.inject(['connection', 'webServer'], (connectionCtx) => {
        const connection = connectionCtx.root.connection;
        const report = (message) => { try {
            ctx.logger('web-search-pro').warn(message);
        }
        catch { /* logging is best-effort */ } };
        connectionCtx.effect(() => openChannel(connectionCtx, connection, createHandler(services), report), 'web-search-pro: settings card RPC channel');
    });
}
//# sourceMappingURL=rpc.js.map