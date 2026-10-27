/**
 * Standalone OpenCLI (dev-plan M12): the `opencli` command the user installed themselves, which drives their own Chrome
 * through its Browser Bridge, independent of the dsh-browser plugin. It has one command per site and the plugin only
 * calls `<site> search`, and only for sites that `opencli list -f json` itself reports with a read-access `search`
 * command taking a positional query (the catalog is the tool's own, so a site without search, such as douyin or v2ex,
 * is never assumed to have one). The list is a local call: no browser, no login.
 * @module web-search-pro/cli/opencli
 */
import { runCli } from '../util.ts';
import { type ProbeSubject } from './probe.ts';
import { type CliAdapterSpec, type CliErrorCodesSpec } from './spec.ts';
import { opencliSiteVerification } from './opencli-sites.ts';
export { OPENCLI_SITE_OF } from './chains-spec.ts';
export { opencliSiteVerification };
/** The command that proves this is the OpenCLI whose `list` output the adapter understands. Verified on 1.8.8. */
export declare const OPENCLI_PROBE: ProbeSubject;
/**
 * The browser options every browser-backed site command of OpenCLI accepts (read from `opencli <site> search --help` and
 * dist/src/execution.js of 1.8.8): the command runs in a background window (no focus is taken from the user's Chrome), with an
 * ephemeral site session whose tab is released when it finishes. These are also its defaults; the plugin passes them
 * explicitly so a changed `OPENCLI_WINDOW` / `OPENCLI_SITE_SESSION` environment cannot bring a window to the front, and only
 * when the command itself lists the three options (a command without a browser rejects unknown options).
 */
export declare const OPENCLI_SILENT_ARGS: readonly string[];
/** The probe of one site's search command: it must list the three silent browser options (`opencli <site> search --help`). Local, cached, no browser. */
export declare function opencliSiteProbe(site: string): ProbeSubject;
export interface OpencliSite {
    site: string;
    /** `cookie` sites use the user's logged-in Chrome; `public` sites need no login. */
    strategy: string;
    /** Whether the command drives the browser at all. */
    browser: boolean;
    hasLimit: boolean;
    /** The site's domain as the command table gives it (`www.zhihu.com`), for the "log in to ..." hint. */
    domain?: string;
}
/** Sites with a read `search` command taking a positional query, from the JSON of `opencli list -f json`. Pure. */
export declare function parseOpencliList(json: string): Map<string, OpencliSite>;
export declare function clearOpencliCache(): void;
/** The searchable sites of the installed OpenCLI (cached 5 minutes); `undefined` when the command cannot be listed. */
export declare function listOpencliSites(options?: {
    run?: typeof runCli;
    ttlMs?: number;
    now?: () => number;
    force?: boolean;
}): Promise<{
    sites?: Map<string, OpencliSite>;
    problem?: string;
}>;
/**
 * The failure format of OpenCLI 1.8.8 (dist/src/errors.js `toEnvelope`, printed as YAML on stderr whatever `-f` says):
 * `ok: false` / `error: { code, message, help?, exitCode }`. Codes, from that file and the site adapters:
 *  - AUTH_REQUIRED (exit 77): the Chrome has no login for the site -> not logged in (measured on xiaohongshu);
 *  - LOGIN_WALL (77), SECURITY_BLOCK, RATE_LIMITED, FORBIDDEN: an HTML page where JSON was expected, a risk-control block -> blocked;
 *    UNKNOWN with a JSON parse error on an HTML body (`Unexpected token '<'`) is the same thing from an adapter that does not
 *    check (measured on reddit through a proxy);
 *  - EMPTY_RESULT (66), NO_DATA, EMPTY_RESPONSE: nothing found; BROWSER_CONNECT (69): no Chrome / bridge; TIMEOUT (75);
 *  - ARGUMENT, INVALID_ARGUMENT, ...: the arguments of this adapter are not accepted by that version.
 * Anything else (COMMAND_EXEC, FETCH_ERROR, HTTP_ERROR, ...) keeps OpenCLI's own message.
 */
export declare const OPENCLI_ERROR_CODES: CliErrorCodesSpec;
/** The spec that runs `opencli <site> search` for one platform, or undefined when the generated spec is invalid (a site named like a write command). */
export declare function opencliSearchSpec(platform: string, entry: OpencliSite, options?: {
    silent?: boolean;
}): CliAdapterSpec | undefined;
export interface OpencliSearchPlan {
    spec?: CliAdapterSpec;
    entry?: OpencliSite;
    problem?: string;
    hint?: string;
    silent: boolean;
}
/**
 * Everything a search of one platform through the standalone OpenCLI needs, checked locally (the command table and the site's
 * `--help`, never a search): the site's entry, whether its command takes the silent browser options, and the generated spec.
 */
export declare function planOpencliSearch(platform: string, site: string): Promise<OpencliSearchPlan>;
