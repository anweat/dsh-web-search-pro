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
/**
 * The OpenCLI versions this adapter supports: 1.8.0 up to, not including, 3.0.0 (1.8 and 2.x). The tested surfaces are 1.8.8 (searches
 * run on the user's Chrome for twitter and zhihu, the failure shapes measured) and 2.0.3 (the `list`, `<site> search --help -f json`,
 * `--version` and pre-browser failure shapes run for real, 2026-11-25; NO site command was run: a 2.x CLI stops the running 1.8.8
 * daemon, so the success and login-failure shapes of 2.x are pinned by constructed fixtures that follow its source). A 3.x was never
 * looked at, so it is reported `incompatible` with the command that installs a supported version, and the chain moves on.
 */
export declare const OPENCLI_MIN_VERSION = "1.8.0";
export declare const OPENCLI_MAX_VERSION = "3.0.0";
export declare const OPENCLI_SUPPORTED_INSTALL = "npm i -g @jackwener/opencli@2";
export declare const OPENCLI_TESTED_VERSIONS: {
    readonly '1.8': "1.8.8";
    readonly '2.x': "2.0.3";
};
/** The command that proves this is the OpenCLI the adapter understands (`list --help` offers `--format` with json): the same on 1.8.8 and 2.0.3. */
export declare const OPENCLI_PROBE: ProbeSubject;
/**
 * The browser options every browser-backed site command of OpenCLI accepts (read from `opencli <site> search --help` and
 * dist/src/execution.js of 1.8.8): the command runs in a background window (no focus is taken from the user's Chrome), with an
 * ephemeral site session whose tab is released when it finishes. These are also its defaults; the plugin passes them
 * explicitly so a changed `OPENCLI_WINDOW` / `OPENCLI_SITE_SESSION` environment cannot bring a window to the front, and only
 * when the command itself lists the three options (a command without a browser rejects unknown options).
 */
export declare const OPENCLI_SILENT_ARGS: readonly string[];
/**
 * The text probe of one site's search command: it must list the three silent browser options (`opencli <site> search --help`).
 * Only the FALLBACK for an OpenCLI whose `search --help -f json` is not JSON (an older 1.8.x); the JSON help carries the same
 * options and replaces this probe ({@link discoverOpencliSite}). Local, cached, no browser.
 */
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
    /** Whether the command lists `--window`, `--site-session` and `--keep-tab` (known from the JSON help; unset when it came from `list`, which does not say). */
    silent?: boolean;
}
/**
 * Sites with a read `search` command taking a positional query, from the JSON of `opencli list -f json`. Pure.
 *
 * Only a 1.8.x list says enough: a bare array whose rows carry `args`, `strategy`, `browser`. A 2.x list is a paged object
 * (`{ ok, data: { commands, total, nextOffset } }`, 25 rows a page, rows with only command / description / access): it is read
 * without error but yields NO site, because without the argument details a positional query cannot be told from a flag. So the list
 * is the fallback for an old 1.8.x only; {@link discoverOpencliSite} (the JSON `search --help`) is the path that works on both.
 */
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
/** `opencli <site> search --help -f json` carries no strategy: these sites need no login (the 1.8.8 command table lists `weixin` and `hackernews` as `public`, every other site the plugin knows as `cookie`). */
export declare const OPENCLI_PUBLIC_SITES: readonly string[];
export interface SiteDiscovery {
    entry?: OpencliSite;
    /** Why the site cannot be used (no search command, not a read command, no launcher). */
    problem?: string;
    /** `unsupported`: the OpenCLI answered and has no usable search command for the site (as opposed to not being runnable at all). */
    unsupported?: boolean;
    /** The help call itself failed (it did not start, timed out, printed too much): asked again next time instead of being cached. */
    transient?: boolean;
    hint?: string;
}
/**
 * Read one site's `search --help -f json` (the same fields on 1.8.8 and 2.0.3: access, browser, domain, positionals, command_options,
 * browser_common_options, columns). `notJson` is an OpenCLI that does not print JSON help (an older 1.8.x): the caller falls back to `list`.
 * A site without a search command prints a site overview (`{ site, commands: [...] }`), an unknown site the top-level help or a failure
 * envelope: all of them are `unsupported`. Pure.
 */
export declare function parseSiteSearchHelp(output: string, site: string): SiteDiscovery & {
    notJson?: true;
};
export interface DiscoverOptions {
    run?: typeof runCli;
    now?: () => number;
    force?: boolean;
    version?: string | undefined;
}
/**
 * Whether the installed OpenCLI can search one site, and how: ONE local help call (no browser, no login), cached 5 minutes per
 * (launcher, version, site), concurrent calls share the run, at most {@link MAX_DISCOVERY_PROCESSES} run at a time. An OpenCLI whose
 * help is not JSON falls back to the `list` table and the text probe of the site's `--help`.
 */
export declare function discoverOpencliSite(site: string, options?: DiscoverOptions): Promise<SiteDiscovery>;
/**
 * The failure format of OpenCLI: 1.8.8 prints `ok: false` / `error: { code, message, help?, exitCode }` as YAML on stderr whatever `-f`
 * says (dist/src/errors.js `toEnvelope`); 2.x prints the same envelope as ONE JSON line on stdout (measured on 2.0.3 for the failures that
 * happen before any browser work; the others follow its source). The runner reads both, and an `ok: false` envelope on stdout counts as a
 * failure even with exit code 0. Codes, from that file and the site adapters:
 *  - AUTH_REQUIRED (exit 77): the Chrome has no login for the site -> not logged in (measured on xiaohongshu);
 *  - SECURITY_BLOCK (2.x gives Reddit's block its own code and says it is not an expired login; xiaohongshu uses it for request-frequency
 *    controls): the site's risk control -> CLI_FAILED, not retryable, kept apart from the login wall below;
 *  - LOGIN_WALL (77), RATE_LIMITED, FORBIDDEN: an HTML page where JSON was expected, a block -> blocked;
 *    UNKNOWN with a JSON parse error on an HTML body (`Unexpected token '<'`) is the same thing from an adapter that does not
 *    check (measured on reddit through a proxy);
 *  - EMPTY_RESULT (66), EMPTY_RESPONSE, NOT_FOUND: an empty answer whose cause is not known. OpenCLI's own hint for EMPTY_RESULT is "the page structure
 *    may have changed, or you may need to log in", and weibo search throws NOT_FOUND for a page without cards: measured 2026-11-25, 4 of 4 NOT_FOUND
 *    without a login and 2 of 2 results right after logging in. Reported as `empty_unconfirmed`, never as a plain "no results". NO_DATA: nothing found;
 *    BROWSER_CONNECT (69): no
 *    Chrome / bridge; TIMEOUT (75); SESSION_BUSY (also 75, errors.js `SessionBusyError`): another opencli process holds the site's browser
 *    session. The two share an exit code, so they are told apart by their code only: a busy session is retryable and says it is not a login problem;
 *  - ARGUMENT, INVALID_ARGUMENT, ... and, in 2.x, `usage_error`, `unknown_command` and every `commander.*` (the argument parser's own failures):
 *    the arguments of this adapter are not accepted by that version -> CLI_CONTRACT_MISMATCH, not retryable.
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
 * `--help -f json`, never a search): the site's entry, whether its command takes the silent browser options, and the generated spec.
 */
export declare function planOpencliSearch(platform: string, site: string, version?: string): Promise<OpencliSearchPlan>;
