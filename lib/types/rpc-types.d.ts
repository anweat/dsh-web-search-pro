/**
 * The private RPC channel between the settings card and the running plugin: the shapes it carries. Free of imports (the card
 * bundle includes this file); the server half is src/rpc.ts. Two calls, both read-only for the user's data:
 *  - `status`: what the plugin can tell about each source and backend right now (installed, ready, why not), from the same local probes
 *    as `sources.status`; never a search, never a login;
 *  - `trial`: runs ONE search of a custom CLI spec that is still a draft in the dialog, the way a real search would run it (probe, then the
 *    spec's command through the same runner and the same read-only guard), and reports what it parsed and what the tool said.
 * @module web-search-pro/rpc-types
 */
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
