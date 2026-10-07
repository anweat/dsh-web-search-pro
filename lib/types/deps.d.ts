/**
 * External dependency detection and install for the CLI/platform backends.
 * Backends shell out to tools installed outside DSH: the built-in CLI adapter specs (bili, yt-dlp, twitter, xhs, zhihu,
 * rdt, omnireach, gh, wx-search-cli, tanso, the standalone opencli) plus the user's own `cliAdapters`, and mcporter. This
 * module reports which are present, whether the command on PATH really has the contract the adapter needs (a same-named
 * program with another contract is `incompatible`, never `detected`), and how to install them; the sources.deps /
 * sources.install actions expose it to the model. Probes are local, cached with a TTL, and never run a search or a login.
 *
 * Install is intentionally a MODEL-FACING TOOL, not a browser settings button:
 * a browser button running winget/pip/npm would be arbitrary command execution
 * without a permission gate, whereas a tool flows through DSH's existing
 * tool-permission/approval pipeline. The card points at this tool instead.
 * @module web-search-pro/deps
 */
import { BILI_CLI_INSTALLS, BILI_CLI_REVISION, BILI_CLI_SOURCE, BILI_CLI_VERSION, TWITTER_CLI_INSTALLS } from './cli/builtin-specs.ts';
import { type CliInstallation } from './cli/probe.ts';
export { BILI_CLI_INSTALLS, BILI_CLI_REVISION, BILI_CLI_SOURCE, BILI_CLI_VERSION, TWITTER_CLI_INSTALLS };
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
    /** `missing` (not on PATH), `detected` (present with the contract the adapter needs), `incompatible` (present, wrong contract or too old). */
    installation?: CliInstallation;
    /** How far the adapter was checked against the real tool: `live`, `contract-only`, `docs-only` (absent: user-defined or not a CLI adapter). */
    verification?: string;
    /** No backend of this plugin executes it; it is only an install helper, so its absence is not a gap. */
    optional?: boolean;
    installs: {
        installer: string;
        command: string;
    }[];
}
interface ProbeResult {
    available: boolean;
    version?: string;
    diagnostic?: string;
}
/** Validate the public-clis bili command rather than trusting an ambiguous package name. */
export declare function evaluateBiliCli(versionOutput: string, searchHelpOutput: string): ProbeResult;
/**
 * The twitter backend runs `twitter search <query> -n N` (twitter-cli). Another program that happens to be
 * called `twitter` must not pass: require a successful `search --help` that actually describes a search command.
 */
export declare function evaluateTwitterCli(searchHelpOutput: string, exitCode: number): ProbeResult;
export declare const DEP_IDS: readonly string[];
/** Detect every dependency: the spec-backed CLIs through their cached contract probes, the rest by presence on PATH. */
export declare function detectDeps(options?: {
    config?: {
        cliAdapters?: unknown;
    };
    force?: boolean;
}): Promise<DepInfo[]>;
/** Run the install command for one backend + installer. */
export declare function installDep(id: string, installer: string): Promise<{
    code: number;
    stdout: string;
    stderr: string;
    timedOut: boolean;
}>;
/** The installer `sources.install` uses when none is named: the first one listed for the dependency. */
export declare function defaultInstaller(id: string): string;
