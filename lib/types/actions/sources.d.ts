/**
 * `sources` group: what is configured and ready (engines, providers, CLI dependencies, browser, evidence judge),
 * and the external CLI dependencies the plugin runs.
 * @module web-search-pro/actions/sources
 */
import type { ProviderReport } from '../router.ts';
import type { ResolvedConfig } from '../config.ts';
import { type ActionDef } from './types.ts';
/**
 * Whether the twitter platform backend can really run: the `twitter` command works (probed by detectDeps)
 * AND the backend is enabled in settings AND its credentials are available (same gates as the engine). `env` holds the values
 * the router resolved (settings literal -> DSH credentials -> process environment); without it only the process environment is read.
 */
export declare function twitterGate(cfg: Pick<ResolvedConfig, 'enableCliBackends' | 'agentReachEnabled'>, dep: {
    available: boolean;
    diagnostic?: string;
}, env?: Readonly<Record<string, string | undefined>>): {
    available: boolean;
    note?: string;
};
/**
 * The "常用" (common) sources and whether each can run now. Without a key it is not in the default chain; the line says how to configure it.
 * `providers` is the registry report; a stub router without one reports none.
 */
export declare function commonSources(providers: ProviderReport[] | undefined): {
    common?: {
        id: string;
        label: string;
        ready: boolean;
        setup?: string;
    }[];
};
export declare const SOURCES_ACTIONS: ActionDef[];
