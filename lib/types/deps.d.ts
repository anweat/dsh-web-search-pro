/**
 * External dependency detection and install for the CLI/platform backends.
 * Most backends shell out to tools installed outside DSH (bili, yt-dlp,
 * twitter, and mcporter). This module reports which are present and how to
 * install them; the sources.deps / sources.install actions expose it to the model. Each entry probes
 * the command the backend actually executes (the twitter backend runs
 * `twitter`, so finding `agent-reach` on PATH says nothing about it).
 *
 * Install is intentionally a MODEL-FACING TOOL, not a browser settings button:
 * a browser button running winget/pip/npm would be arbitrary command execution
 * without a permission gate, whereas a tool flows through DSH's existing
 * tool-permission/approval pipeline. The card points at this tool instead.
 * @module web-search-pro/deps
 */
export interface DepInfo {
    id: string;
    label: string;
    /** Backend that needs it. */
    usedBy: string;
    available: boolean;
    path?: string;
    /** Human-readable upstream source; important when a package name is ambiguous. */
    source?: string;
    /** Minimum compatible CLI version, when the backend has a versioned contract. */
    requiredVersion?: string;
    /** Detected CLI version. */
    version?: string;
    /** Why a command found on PATH is not compatible. */
    diagnostic?: string;
    /** No backend of this plugin executes it; it is only an install helper, so its absence is not a gap. */
    optional?: boolean;
    installs: {
        installer: string;
        command: string;
    }[];
}
export declare const BILI_CLI_VERSION = "0.6.2";
export declare const BILI_CLI_REVISION = "489607468f967e0e11f3cdff6efc022d011e982a";
export declare const BILI_CLI_SOURCE = "git+https://github.com/public-clis/bilibili-cli@489607468f967e0e11f3cdff6efc022d011e982a";
export declare const BILI_CLI_INSTALLS: {
    installer: string;
    command: string;
}[];
interface DepProbeResult {
    available: boolean;
    version?: string;
    diagnostic?: string;
}
/** Validate the public-clis bili command rather than trusting an ambiguous package name. */
export declare function evaluateBiliCli(versionOutput: string, searchHelpOutput: string): DepProbeResult;
/**
 * The twitter backend runs `twitter search <query> -n N` (twitter-cli). Another program that happens to be
 * called `twitter` must not pass: require a successful `search --help` that actually describes a search command.
 */
export declare function evaluateTwitterCli(searchHelpOutput: string, exitCode: number): DepProbeResult;
export declare const TWITTER_CLI_INSTALLS: {
    installer: string;
    command: string;
}[];
/** Detect all backends. */
export declare function detectDeps(): Promise<DepInfo[]>;
/** Run the install command for one backend + installer. */
export declare function installDep(id: string, installer: string): Promise<{
    code: number;
    stdout: string;
    stderr: string;
    timedOut: boolean;
}>;
export declare const DEP_IDS: string[];
export {};
