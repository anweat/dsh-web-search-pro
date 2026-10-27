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
/** Register the channel when the Host has the transport; the effect unregisters it with the plugin. */
export declare function registerRpc(ctx: Context, services: RpcServices): void;
export {};
