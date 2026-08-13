/**
 * External dependency detection and install for the CLI/platform backends.
 * Most backends shell out to tools installed outside DSH (gh, bili, yt-dlp,
 * opencli, agent-reach, playwright, mcporter). This module reports which are
 * present and how to install them; the web_deps tool exposes it to the model.
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
    installs: {
        installer: string;
        command: string;
    }[];
}
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
