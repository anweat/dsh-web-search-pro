/**
 * The static facts of the platform backend chains (dev-plan M12), free of Node imports so the settings card validates
 * `platformBackends` with the same code the server resolves it with: the default chain of each platform, which backend
 * ids exist and which platforms each can serve.
 * @module web-search-pro/cli/chains-spec
 */
/** The default chain of each platform: first usable backend answers, empty or failing ones fall through in order. */
export declare const DEFAULT_CHAINS: Readonly<Record<string, readonly string[]>>;
/** Platforms whose provider is a chain (everything in the default table). */
export declare const CHAIN_PLATFORMS: readonly string[];
/** Platform -> site of the standalone OpenCLI (`opencli <site> search`). */
export declare const OPENCLI_SITE_OF: Readonly<Record<string, string>>;
/** Platforms the dsh-browser OpenCLI bridge has a site adapter for (pinned to engines.ts by a test). */
export declare const BROWSER_OPENCLI_PLATFORMS: readonly string[];
/** Platforms with a built-in rendered-search-page spec in dsh-browser's searchResults (pinned to platform-search.ts by a test). */
export declare const BROWSER_SEARCH_PLATFORMS: readonly string[];
/** Platforms the plugin's own REST client serves. */
export declare const REST_PLATFORMS: readonly string[];
/** Backend ids that are not CLI specs. */
export declare const FIXED_BACKENDS: readonly ["opencli", "browser-opencli", "browser-search", "rest"];
export interface BackendServing {
    ok: boolean;
    why?: string;
}
/**
 * Whether backend `id` can serve `platform`. `specPlatforms` maps a CLI spec id (built-in, or `custom-cli:<id>` of the user)
 * to the platforms it lists; a user spec serves any platform its chain names.
 */
export declare function backendServes(id: string, platform: string, specPlatforms: ReadonlyMap<string, readonly string[]>): BackendServing;
/** The CLI specs a chain may name: the built-ins by id and the user's valid `cliAdapters` as `custom-cli:<id>`. */
export declare function specPlatformsOf(cliAdapters: unknown): {
    platforms: Map<string, readonly string[]>;
    diagnostics: string[];
};
/**
 * Every problem of the `platformBackends` setting (shape, unknown platform, unknown or foreign backend id) given the
 * `cliAdapters` setting. The settings card and `sources.status` both call this.
 */
export declare function platformBackendIssues(platformBackends: unknown, cliAdapters: unknown): string[];
