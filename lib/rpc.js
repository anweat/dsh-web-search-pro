/**
 * The server half of the private RPC channel of the settings card (see rpc-types.ts). It uses the Host's connection transport the
 * way the dsh-browser plugin does for its panel (`connection.rpc.handle`, an authenticated absolute channel prefix); when the Host
 * has no `connection` / `webServer` service nothing is registered and the card says that "Try it" and the live readiness are
 * unavailable (everything else in the card works without them).
 * @module web-search-pro/rpc
 */
import { trialCli } from "./cli/trial.js";
import { RPC_CHANNEL } from "./rpc-types.js";
const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
/** Readiness for the card, from the report `sources.status` is made of (local probes; never a search). */
export async function statusView(router) {
    const report = await router.providerReport();
    const view = { sources: {}, legs: {} };
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
                return { ok: true, value: await statusView(services.router) };
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
/** Register the channel when the Host has the transport; the effect unregisters it with the plugin. */
export function registerRpc(ctx, services) {
    ctx.inject(['connection', 'webServer'], (connectionCtx) => {
        const connection = connectionCtx.root.connection;
        connectionCtx.effect(() => connection.rpc.handle(RPC_CHANNEL, createHandler(services)), 'web-search-pro: settings card RPC channel');
    });
}
//# sourceMappingURL=rpc.js.map