/**
 * The trial run of a custom CLI spec (settings card, "Try it"): what a search with the draft spec would do, shown before it is saved.
 * It is a real run, not a simulation: the spec is validated by the rule every spec goes through (the read-only guard, no shell, no
 * credentials in argv), the command is probed (version and help only), then ONE search for the sample query runs through the same
 * runner with the spec's own timeout and output cap. The first results and the tool's own words come back; secrets are redacted,
 * a login is never run, and nothing is stored.
 * @module web-search-pro/cli/trial
 */
import { type runCli } from '../util.ts';
import type { TrialResult } from '../rpc-types.ts';
export interface TrialOptions {
    /** `enableCliBackends`: with it off no custom command runs, trial or search. */
    enabled: boolean;
    signal?: AbortSignal;
    /** Test seams. */
    run?: typeof runCli;
    env?: NodeJS.ProcessEnv;
}
export declare function trialCli(id: string, rawSpec: unknown, query: string, options: TrialOptions): Promise<TrialResult>;
