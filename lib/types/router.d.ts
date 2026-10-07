/**
 * Search orchestration: engine ordering/fallback (agent-reach style routing),
 * optional parallel multi-engine merging, SQLite caching, and persistence.
 * @module web-search-pro/router
 */
import type { Context } from '@deepseek-ai/cordis';
import type { WebSearchRequest, WebSearchResult } from '@deepseek-ai/dsh-web';
import type { Store } from './store.ts';
import type { ResolvedConfig } from './config.ts';
import { type EngineSearchOptions } from './engines.ts';
import type { ChainEntryReport, ChainReport } from './cli/chain.ts';
import { type CostTier, type ProviderDescriptor, type Readiness, type ProviderRegistry } from './providers/index.ts';
import { type RequestBudgetState } from './pipeline/ledger.ts';
import { LruCache } from './memory-cache.ts';
import type { BrowserService } from './browser-service.ts';
import { type BrowserGetter } from './browser-access.ts';
import { type BackendDiagnostic } from './backend-registry.ts';
import { type ExaResult } from './exa-client.ts';
import type { ProviderCall, ProviderOutcome } from './pipeline/run.ts';
import type { ProviderStatus } from './pipeline/plan.ts';
export interface RouterSearchOptions {
    query: string;
    /** Engine ids to try, in order. Defaults to config.engines. */
    engines?: string[];
    count: number;
    /** Bypass the fresh-cache lookup. */
    fresh: boolean;
    /** Run all requested engines in parallel and merge results. */
    multi: boolean;
    signal: AbortSignal | undefined;
    /** True when called from the ctx.web provider (prevents seam recursion). */
    skipSeam?: boolean;
    /** Native Exa search controls; ignored by other engines. */
    exa?: EngineSearchOptions['exa'];
    /**
     * Search ONE platform provider (`search.run platform=`): the same registry-backed run as a web engine, with the
     * platform's own cache key, history kind `platform` and an unavailable provider reported as an error. `engines`,
     * `multi` and `exa` are ignored; `query` may be empty for a feed. `authProfile` / `rulePack` fall back to `browserBindings`.
     */
    platform?: PlatformRequest;
}
export interface PlatformRequest {
    /** Platform id (route id, alias or full provider id, or a `customPlatforms` key). */
    id: string;
    /** `rss` only: the feed URL (a feed URL in `query` is accepted too). */
    url?: string;
    authProfile?: string;
    rulePack?: string;
}
export interface RouterSearchResult {
    content?: string;
    sources: {
        url: string;
        title?: string;
        snippet?: string;
        publishedAt?: string;
    }[];
    engine: string;
    enginesTried: string[];
    fromCache: boolean;
    /** Sources available before slicing to `count` (>= sources.length); drives `truncated`. */
    availableCount?: number;
    /** Human-readable explanation of why the router fell back to `engine` (P1-1). */
    fallbackNote?: string;
    /** Platform search: the backend of its chain that answered (`bili`, `browser-opencli`). */
    backend?: string;
}
/** One provider as `sources.status` reports it: the registry descriptor plus local readiness by dimension. */
export interface ProviderReport {
    id: string;
    /** Id used in tool output and history (the first alias, else `id`). */
    route: string;
    aliases: string[];
    label: string;
    /** `web` engine or `platform` (a site / community, `search.run platform=<route>`). */
    kind: 'web' | 'platform';
    /** Platform: the site domains it covers (a hard `site` constraint on one selects it). */
    domains?: string[];
    /** The dsh-browser method it runs through; absent = it does not need the browser. */
    needsBrowser?: string;
    operations: string[];
    taskProfiles: string[];
    languages: string[];
    regions: string[];
    resultKinds: string[];
    sourceFamily?: string;
    requirements: (Omit<ProviderDescriptor['requirements'][number], 'env'> & {
        env?: string[];
    })[];
    supportedFilters: string[];
    costModel: ProviderDescriptor['costModel'];
    /** What it costs the user: `anonymous`, `free-quota` or `paid`; for a provider with two routes (Exa) the tier of the route that would run now. */
    costTier: CostTier;
    /** Request budget (`sources.budget`): cap, used and remaining; only for a source that has one. */
    budget?: RequestBudgetState;
    /** Not verified against the live service (descriptor.verification). */
    unverified?: boolean;
    /** Platforms with an ordered backend chain: each backend, in order, with its readiness or the reason it is skipped. */
    chain?: ChainEntryReport[];
    readiness: Readiness & {
        state?: ChainReport['state'];
        lastLocalCheck: string;
        lastRemoteSuccess?: string;
        lastError?: string;
        cooldownUntil?: string;
    };
}
export declare class SearchRouter {
    private readonly ctx;
    private readonly config;
    private readonly store;
    private readonly dynamic;
    private readonly memory;
    readonly registry: ProviderRegistry;
    /** In-flight de-duplication of identical non-fresh requests (C3). */
    private readonly searchFlights;
    private readonly getBrowser;
    private readonly backends;
    /** Backend ids this router created from the registry (a stub a test installed under another id is never touched). */
    private readonly owned;
    private syncedRevision;
    /** Custom platforms (settings `customPlatforms`) this router registered: key -> spec signature + unregister. A key the registry refused stays here with its problem so it is not retried on every call. */
    private readonly custom;
    /** User-defined CLI adapters (settings `cliAdapters`) this router registered as `custom-cli:<id>` platforms, with the diagnostics of the entries it ignored. */
    private readonly customCli;
    private cliAdapterDiagnostics;
    /** Latest local probe per route id (read by providerStatuses for the credential dimension). */
    private readonly readiness;
    /** Last real call per route id: feeds the health dimension (never inferred from a local probe). */
    private readonly outcomes;
    constructor(ctx: Context, config: ResolvedConfig, store: Store, dynamic?: () => ResolvedConfig, browser?: BrowserService | BrowserGetter, memory?: LruCache<RouterSearchResult>, registry?: ProviderRegistry);
    /** Mirror the registry into the backend registry: new providers appear, unregistered ones stop being scheduled. */
    private syncBackends;
    /**
     * Keep the registry's custom platform providers equal to the settings: new keys register, edited ones are replaced,
     * removed ones unregister (the revision bump then makes {@link syncBackends} drop their backends). A key that clashes
     * with a provider already registered is not registered (a user platform never replaces a built-in source); see {@link customPlatformProblems}.
     */
    private syncCustomPlatforms;
    /** The same for `cliAdapters`: valid specs become `custom-cli:<id>` platforms; an invalid entry is ignored and reported. */
    private syncCustomCliAdapters;
    /** Configuration problems of the CLI adapter layer for `sources.status`: ignored `cliAdapters` entries and `platformBackends` that name nothing usable. */
    cliAdapterProblems(): string[];
    /** Custom platforms the registry could not take (key clash, bad key), for `sources.status`. */
    customPlatformProblems(): string[];
    /** Unregister what this router put into the registry (plugin unload). */
    dispose(): void;
    private backendFor;
    /** `browserBindings[id]` fills the auth profile / rule pack a call did not name itself (the call wins). */
    private withBindings;
    /** Bindings that apply to these providers, for cache keys: a rebound auth profile must not replay older results. */
    private bindingsOf;
    private probeEnv;
    /**
     * The configured `engines` list with the user's `sources.*` preferences applied: disabled sources removed, `priority` ones that are
     * already in the list moved to the front in their listed order. An explicit `engines` of a call never goes through this.
     */
    private preferred;
    /** Alias / full id -> route id; ids the registry does not know are kept as written (the backend then reports them unknown). */
    private canonicalIds;
    backendDiagnostics(cliAvailability?: ReadonlyMap<string, boolean>): Promise<BackendDiagnostic[]>;
    exaContents(urls: string[], signal?: AbortSignal): Promise<ExaResult[]>;
    /** Resolve a secret by credentials ref / environment variable name (credentials service first, then env). */
    resolveSecret(ref: string): Promise<string | undefined>;
    /**
     * Availability of engines for source planning: the registry's probe and
     * cooldown state, without running a search. Ids the registry does not know are absent.
     */
    providerStatuses(ids: readonly string[]): Promise<Map<string, ProviderStatus>>;
    /**
     * Run ONE engine through the registry (probe, cooldown, quality gate,
     * attempts) for the evidence pipeline. Not cached or persisted: the pipeline
     * persists its fused result once. Cancellation is rethrown; every other
     * outcome is a value. `skipSeam` keeps the ctx.web engine out (the caller IS the ctx.web provider: no recursion).
     */
    runProvider(call: ProviderCall, opts?: {
        skipSeam?: boolean;
    }): Promise<ProviderOutcome>;
    /** Resolve a key through credentials first, then process env. */
    private resolveKey;
    private deps;
    /** Sync key check for available() (no credential resolution — env/literal only). */
    private depsSync;
    /**
     * Keys and base URLs of the keyed search sources (dev-plan M7c): per source the config literal, then the credentials ref /
     * environment variable (`keyedSources.<id>.apiKeyEnv`, else the documented default names in order).
     */
    private keyedSources;
    private keyedSourcesSync;
    /** The configured request budgets by ROUTE id (aliases and full ids in `sources.budget` resolved; unknown ids are reported by {@link sourceDiagnostics}). */
    private budgets;
    private budgetFor;
    /** Used / remaining requests of a capped source (read-only), or undefined when no cap is set for it. */
    requestBudgetOf(route: string): RequestBudgetState | undefined;
    /** Problems of the `sources.*` settings (unknown ids, bad numbers), for `sources.status`. */
    sourceDiagnostics(): string[];
    /** Counts a metered, non-model request (Bocha search) in the usage ledger; best effort, never throws into the search. */
    private usageRecorder;
    /** Whether any configured engine is currently usable. */
    anyEngineAvailable(): boolean;
    private build;
    private buildSync;
    /**
     * Every registered search provider with its descriptor and LOCAL readiness by dimension (installation / credential /
     * health), for `sources.status`. No network. Health is only `ready` after a real call succeeded in this process,
     * `cooldown` / `error` after failures; a provider that merely passed its local probe is `unknown`, not verified.
     */
    providerReport(cliAvailability?: ReadonlyMap<string, boolean>): Promise<ProviderReport[]>;
    /** Run a full search with caching + persistence. */
    search(opts: RouterSearchOptions): Promise<RouterSearchResult>;
    /**
     * Normalise a platform request: the provider's route id; `rss` takes a feed URL from `query` when no `url` is given
     * (the old tool contract); the call's auth profile / rule pack, else the platform's `browserBindings`.
     */
    resolvePlatform(request: PlatformRequest, rawQuery: string): {
        id: string;
        query: string;
        url?: string;
        authProfile?: string;
        rulePack?: string;
    };
    private runSearch;
    /**
     * No engine failed at runtime: each returned ENGINE_EMPTY or was skipped
     * (unavailable / cooldown). Zero sources plus an explanation (never cached).
     */
    private emptyResult;
    /**
     * A platform provider that did not answer. Empty (it ran and found nothing) is a result with the provider's own hint
     * (login, selectors); anything else is the error `platform <id> unavailable (tried: ...): <reason>`.
     */
    private platformFailure;
    /**
     * ctx.web provider adapter: route the seam request through this router.
     * Returns a WebSearchResult-shaped value for the built-in web_search tool.
     */
    searchAsProvider(request: WebSearchRequest, signal?: AbortSignal): Promise<WebSearchResult>;
}
