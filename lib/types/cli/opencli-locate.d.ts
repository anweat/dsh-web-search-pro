/**
 * Finding the standalone `opencli` launcher (and a Node that can run it) when it is not on the PATH of the process. A desktop
 * host often starts with a PATH that holds an fnm per-shell directory (which disappears with the shell that made it) or only
 * `/usr/bin:/bin`, while the user installed OpenCLI with `npm i -g` under a version manager. After PATH has failed, the usual
 * global install places are looked at, the same ones dsh-browser's `locateOpencli` knows (the DSH_BROWSER_OPENCLI override,
 * Homebrew, ~/.npm-global, nvm, fnm, Volta, the Windows npm dir); the plugin-local copies and `npm root -g` (a spawn) are not.
 *
 * The launcher is a `#!/usr/bin/env node` script (a `.cmd` shim on Windows), so a launcher found outside PATH comes with the
 * directories to put in front of the child's PATH: its own bin directory (a version manager keeps `node` there), and, when that
 * has no node, the directory of one that was found. Pure: the machine (platform, environment, home, file system) is injected.
 * @module web-search-pro/cli/opencli-locate
 */
/** Everything the resolver reads from the machine, so a test can describe a machine instead of owning one. */
export interface LocateMachine {
    platform: NodeJS.Platform;
    env: NodeJS.ProcessEnv;
    home: string;
    /** A regular file (a launcher that can be run). */
    isFile(file: string): boolean;
    /** The names in a directory; empty when it cannot be read. */
    readdir(dir: string): string[];
    /** `process.execPath`: used as the node when it is one (an Electron host's is not). */
    execPath?: string;
}
export type OpencliSource = 'override' | 'path' | 'fallback';
export interface OpencliLocation {
    /** The launcher to run. */
    path: string;
    source: OpencliSource;
    /** Directories to put in front of the child's PATH so its `env node` finds a node; empty when the launcher came from PATH. */
    pathPrefix: string[];
}
export interface OpencliLookup {
    location?: OpencliLocation;
    /** An override that does not lead to a launcher (never silently replaced by another copy). */
    problem?: string;
}
/** The machine this process runs on. */
export declare function realMachine(env?: NodeJS.ProcessEnv): LocateMachine;
/** Version-directory names (`v22.11.0`, `22.11.0`), newest first, numerically. */
export declare function newestFirst(names: readonly string[]): string[];
/**
 * The directories a global `npm i -g` may have put a launcher in, most specific first: the npm prefix of the environment,
 * Homebrew and the usual user prefixes, then every Node of the version managers (nvm, fnm), newest first, then Volta and Bun.
 */
export declare function fallbackBinDirs(machine: LocateMachine): string[];
/**
 * Find the standalone OpenCLI: the `DSH_BROWSER_OPENCLI` override when it is set (it either leads to a launcher or is a
 * problem; another copy is never used instead), else PATH, else the usual global install places.
 */
export declare function locateOpencliBin(machine: LocateMachine): OpencliLookup;
/** `env` with `dirs` in front of its PATH (a copy; the key is always `PATH`, which is what the clean environment of a CLI run uses). */
export declare function withPathPrefix(env: Record<string, string>, dirs: readonly string[] | undefined, platform?: NodeJS.Platform): Record<string, string>;
