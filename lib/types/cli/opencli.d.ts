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
import { type CliAdapterSpec } from './spec.ts';
export { OPENCLI_SITE_OF } from './chains-spec.ts';
/** The command that proves this is the OpenCLI whose `list` output the adapter understands. Verified on 1.8.8. */
export declare const OPENCLI_PROBE: ProbeSubject;
export interface OpencliSite {
    site: string;
    /** `cookie` sites use the user's logged-in Chrome; `public` sites need no login. */
    strategy: string;
    /** Whether the command drives the browser at all. */
    browser: boolean;
    hasLimit: boolean;
    loginCommand?: string;
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
/** The spec that runs `opencli <site> search` for one platform, or undefined when the generated spec is invalid (a site named like a write command). */
export declare function opencliSearchSpec(platform: string, entry: OpencliSite): CliAdapterSpec | undefined;
