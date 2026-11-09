/**
 * The server half of the private RPC channel of the settings card (see rpc-types.ts). It uses the Host's connection transport the
 * way the dsh-browser plugin does for its panel (`connection.rpc.handle`, an authenticated absolute channel prefix); when the Host
 * has no `connection` / `webServer` service nothing is registered and the card says that "Try it" and the live readiness are
 * unavailable (everything else in the card works without them).
 * @module web-search-pro/rpc
 */
import type { Context } from '@deepseek-ai/cordis';
import type { ResolvedConfig } from './config.ts';
import type { SearchRouter } from './router.ts';
import type { OverlayStore } from './overlay.ts';
import type { PendingRestart } from './restart.ts';
import { type StatusView } from './rpc-types.ts';
type Handler = (endpoint: string, payload: unknown, context?: {
    signal?: AbortSignal;
}) => Promise<{
    ok: true;
    value: unknown;
} | {
    ok: false;
    error: {
        code: 'bad-request' | 'not-found';
        message: string;
        details: Record<string, unknown>;
    };
}>;
export interface RpcServices {
    router: Pick<SearchRouter, 'providerReport'>;
    dynamic: () => ResolvedConfig;
    /** The agent overlay (read and revoke endpoints); absent in tests of the older endpoints. */
    overlay?: OverlayStore;
    /** Settings changed in the configuration that only take effect at the next start. */
    pendingRestart?: () => PendingRestart[];
}
/** Readiness for the card, from the report `sources.status` is made of (local probes; never a search). */
export declare function statusView(router: Pick<SearchRouter, 'providerReport'>, extras?: Pick<RpcServices, 'overlay' | 'pendingRestart'>): Promise<StatusView>;
/** The handler of the channel: `status` and `trial`. A failure is a value (`ok: false`), never a throw into the transport. */
export declare function createHandler(services: RpcServices): Handler;
/** The part of the Host's `connection` service used here. */
export interface ConnectionRegistrar {
    rpc: {
        handle(channel: string, handler: Handler): () => Promise<void>;
    };
}
/** The part of a cordis Context used to reach the Host's connection transport. */
export interface ChannelContext {
    get(name: 'webServer'): unknown;
    extend(meta: {
        webServer: unknown;
    }): {
        connection: ConnectionRegistrar;
    };
}
/**
 * Mount the channel and return its disposer.
 *
 * `connection.rpc.handle` mounts the Web route with `owner.webServer`, where `owner` is the Context the `rpc` getter captured
 * (`this.ctx`; packages/client/connection/src/rpc-host.ts:274 in the Host). Under cordis 4.1 (DSH 0.2.2) a service property read is
 * checked against the `inject` list of the Context that DEFINED the service, i.e. the Connection plugin, which does not list `webServer`,
 * so the call throws `cannot get property "webServer" without inject` for every external plugin (cordis 4.0.x did not check). The throw
 * happened inside an inject callback and was never reported: the channel stayed unmounted and the settings card got HTTP 405.
 *
 * The public-API way around it (found by @shuaigekda in anweat/dsh-browser#49): read the service through a derived context that carries
 * the dependency this plugin did inject as its own property, `ctx.extend({ webServer: ctx.get('webServer') })`. `Context.extend` defines
 * those properties directly on the child, so the `rpc` getter captures the child as `owner` and `owner.webServer` resolves as an own
 * property, without the inject check. Same route, same transport and authentication; no private Host method. It is used on every Host
 * (on cordis 4.0.x the own property is simply redundant). Reading `connection` from `ctx.root` or from `ctx` itself does not help.
 */
export declare function openChannel(connectionCtx: ChannelContext, handler: Handler): () => Promise<void>;
/** The one console line for a channel that could not be mounted (exported for the test). */
export declare function channelFailureMessage(error: unknown): string;
/** Register the channel when the Host has the transport; the effect unregisters it with the plugin. */
export declare function registerRpc(ctx: Context, services: RpcServices): void;
export {};
