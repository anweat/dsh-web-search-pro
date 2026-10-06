/**
 * The Engine of a CLI adapter spec (dev-plan M12): one search leg that probes the command's contract (cached), then runs
 * the spec through the shared runner. `available()` is synchronous and local (settings gates plus the probe cache);
 * every failure reaches the caller as a structured error naming what to install or run.
 * @module web-search-pro/cli/engine
 */
import type { Engine, EngineDeps } from '../engines.ts';
import { CliAdapterError } from './runner.ts';
import { type CliProbeResult } from './probe.ts';
import type { CliAdapterSpec } from './spec.ts';
import type { runCli } from '../util.ts';
/** Why a spec is switched off by settings, or undefined when it may run. */
export declare function disabledBySettings(spec: Pick<CliAdapterSpec, 'id'>, deps: Pick<EngineDeps, 'enableCli' | 'agentReachEnabled'>): string | undefined;
export interface CliLegOptions {
    /** Engine id (default: the spec id). */
    id?: string;
    label?: string;
    /** Test seam: replaces the process runner; the contract probe is then skipped (the caller controls the command). */
    run?: typeof runCli;
    env?: NodeJS.ProcessEnv;
    home?: string;
    /** The credentials are checked by the caller (the legacy twitter engine). */
    skipCredentialGate?: boolean;
}
/** The probe verdict as the structured error a search would raise, or undefined when the command is usable. */
export declare function probeError(spec: Pick<CliAdapterSpec, 'bins' | 'packageNote'>, probe: CliProbeResult): CliAdapterError | undefined;
export declare function cliSpecEngine(spec: CliAdapterSpec, platform: string, deps: Pick<EngineDeps, 'enableCli' | 'agentReachEnabled'>, options?: CliLegOptions): Engine;
export interface SpecReadiness {
    ready: boolean;
    installation: 'missing' | 'detected' | 'incompatible';
    version?: string;
    path?: string;
    /** Absent when the tool needs a login that cannot be checked from here (a keyring, a browser session). */
    credential?: 'not_required' | 'missing' | 'configured';
    /** Why it cannot run, naming what to install or run. */
    reason?: string;
    code: 'ok' | 'disabled' | 'cli_missing' | 'cli_incompatible' | 'not_logged_in';
}
/** Local readiness of one spec: settings, contract probe, then the credentials it needs. Never runs a search. */
export declare function specReadiness(spec: CliAdapterSpec, deps: Pick<EngineDeps, 'enableCli' | 'agentReachEnabled'>, options?: {
    env?: NodeJS.ProcessEnv;
    home?: string;
}): Promise<SpecReadiness>;
