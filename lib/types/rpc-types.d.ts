/**
 * The private RPC channel between the settings card and the running plugin: the shapes it carries. Free of runtime imports (the card
 * bundle includes this file); the server half is src/rpc.ts. The calls:
 *  - `status`: what the plugin can tell about each source and backend right now (installed, ready, why not), from the same local probes
 *    as `sources.status`; never a search, never a login;
 *  - `trial`: runs ONE search of a custom CLI spec that is still a draft in the dialog, the way a real search would run it (probe, then the
 *    spec's command through the same runner and the same read-only guard), and reports what it parsed and what the tool said;
 *  - `overlay`: what the agent overlay holds (the settings an agent changed with `config.*`) and its newest audit entries;
 *  - `overlay.revoke`: drop overlay entries (one or several keys, or all), as the user: the card's "Revoke" and the second half of
 *    "Adopt" (the card writes the value into the profile first, then asks the plugin to drop the entry). Audited with actor `user`.
 * @module web-search-pro/rpc-types
 */
import type { OverlayView } from './overlay-types.ts';
import type { PendingRestart } from './restart.ts';
/** The channel prefix this plugin registers with the Host transport (Browser registers `/dsh-browser-assets` the same way). */
export declare const RPC_CHANNEL = "/dsh-web-search-pro";
/** `status`: readiness by source route id and by the backend legs of each platform chain (`<platform>/<backend>`). */
export interface StatusView {
    sources: Record<string, {
        available: boolean;
        reason?: string;
        confidence: number;
    }>;
    legs: Record<string, {
        ready: boolean;
        reason?: string;
        confidence: number;
    }>;
    /** Settings the configuration holds that the running plugin only reads at start-up (the card shows "restart the plugin"). */
    pendingRestart?: PendingRestart[];
    /** The agent overlay in one line: how many keys it overrides and whether it is being ignored. */
    overlay?: {
        revision: number;
        count: number;
        valid: boolean;
        problem?: string;
    };
}
export type { OverlayView, PendingRestart };
/** `overlay.revoke`: the keys to drop (`OverlayItem.key`), or `'all'`; `adopted` says the value was first written into the configuration. */
export interface RevokeRequest {
    keys: string[] | 'all';
    adopted?: boolean;
}
export interface TrialRequest {
    /** The key of the entry (`cliAdapters.<id>`). */
    id: string;
    /** The spec as the dialog has it now (validated by the server with the rule every spec goes through). */
    spec: unknown;
    /** The sample query; the dialog proposes one. */
    query: string;
}
/** What a trial found: the first results (as the runner mapped them) and the tool's own words, or the stage it stopped at and why. */
export type TrialResult = {
    ok: true;
    stage: 'search';
    probe: {
        version?: string;
        path?: string;
    };
    sources: {
        url: string;
        title?: string;
        snippet?: string;
        publishedAt?: string;
    }[];
    total: number;
    raw: string;
    elapsedMs: number;
} | {
    ok: false;
    stage: 'disabled' | 'validate' | 'probe' | 'search';
    message: string;
    errors?: string[];
    code?: string;
    hint?: string;
    raw?: string;
    elapsedMs?: number;
};
