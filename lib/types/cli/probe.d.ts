/**
 * Contract probes of CLI adapter specs (dev-plan M12, design §4.3 / §4.4): local only, cached with a TTL. A probe finds
 * the command on PATH and runs ONLY the spec's version and help commands, then checks the contract the spec needs: a
 * minimum version and the subcommands / flags that must appear in the help text. A same-named program with another
 * contract is `incompatible`, not `detected`. A probe never runs a search and never logs in.
 * @module web-search-pro/cli/probe
 */
import { runCli } from '../util.ts';
import { type CliAdapterSpec } from './spec.ts';
export type CliInstallation = 'missing' | 'detected' | 'incompatible';
export interface CliProbeResult {
    state: CliInstallation;
    /** The command name that matched. */
    bin?: string;
    /** Where it was found. */
    path?: string;
    version?: string;
    /** Why it is incompatible or missing. */
    reason?: string;
    checkedAt: number;
}
/** What a probe needs of a spec: where the command is, how it is checked, and the environment it runs in. */
export type ProbeSubject = Pick<CliAdapterSpec, 'id' | 'bins' | 'probe' | 'packageNote' | 'env'>;
export interface CliProbeOptions {
    run?: typeof runCli;
    /** Cache lifetime; default 60 s. */
    ttlMs?: number;
    /** Skip the cache (an explicit "check again"). */
    force?: boolean;
    now?: () => number;
}
export declare function clearProbeCache(): void;
/** The executable `cmd` resolves to on PATH (no process is spawned; Windows tries PATHEXT). */
export declare function findOnPath(cmd: string, env?: NodeJS.ProcessEnv): string | undefined;
/** The cached probe of a spec, when one is fresh (no spawn: `Engine.available()` is synchronous). */
export declare function cachedProbe(spec: ProbeSubject, ttlMs?: number, now?: () => number): CliProbeResult | undefined;
export interface ContractInput {
    code: number;
    output: string;
}
/**
 * Decide whether version and help output satisfy a spec's contract. Pure (the fixtures tests call it directly).
 * The version command may fail or print nothing unless the spec asks for a minimum version.
 */
export declare function evaluateCliContract(spec: Pick<CliAdapterSpec, 'probe'>, bin: string, version: ContractInput, help: ContractInput): {
    state: 'detected' | 'incompatible';
    version?: string;
    reason?: string;
};
/** Probe one spec (cached; concurrent calls for the same spec share one run). */
export declare function probeCli(spec: ProbeSubject, options?: CliProbeOptions): Promise<CliProbeResult>;
/** Probe many specs with a small concurrency bound (a settings refresh must not spawn dozens of processes at once). */
export declare function probeAll(specs: readonly ProbeSubject[], options?: CliProbeOptions, concurrency?: number): Promise<Map<string, CliProbeResult>>;
