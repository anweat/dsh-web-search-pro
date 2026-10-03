/**
 * `sources` group: what is configured and ready (engines, providers, CLI dependencies, browser, evidence judge),
 * and the external CLI dependencies the plugin runs.
 * @module web-search-pro/actions/sources
 */
import type { ResolvedConfig } from '../config.ts';
import { type ActionDef } from './types.ts';
/**
 * Whether the twitter platform backend can really run: the `twitter` command works (probed by detectDeps)
 * AND the backend is enabled in settings AND its credentials are in the environment (same gates as the engine).
 */
export declare function twitterGate(cfg: Pick<ResolvedConfig, 'enableCliBackends' | 'agentReachEnabled'>, dep: {
    available: boolean;
    diagnostic?: string;
}): {
    available: boolean;
    note?: string;
};
export declare const SOURCES_ACTIONS: ActionDef[];
