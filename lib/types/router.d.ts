/**
 * Search orchestration: engine ordering/fallback (agent-reach style routing),
 * optional parallel multi-engine merging, SQLite caching, and persistence.
 * @module web-search-pro/router
 */
import type { Context } from '@deepseek-ai/cordis';
import type { WebSearchRequest, WebSearchResult } from '@deepseek-ai/dsh-web';
import type { Store } from './store.ts';
import type { ResolvedConfig } from './config.ts';
import { type Engine, type EngineDeps, type EngineSearchOptions } from './engines.ts';
import { type ProviderDescriptor, type Readiness, type ProviderRegistry } from './providers/index.ts';
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
}
/** One provider as `web_backend_status` reports it: the registry descriptor plus local readiness by dimension. */
export interface ProviderReport {
    id: string;
    /** Id used in tool output and history (the first alias, else `id`). */
    route: string;
    aliases: string[];
    label: string;
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
    /** Not verified against the live service (descriptor.verification). */
    unverified?: boolean;
    readiness: Readiness & {
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
    private readonly platformFlights;
    private readonly getBrowser;
    private readonly backends;
    /** Backend ids this router created from the registry (a stub a test installed under another id is never touched). */
    private readonly owned;
    private syncedRevision;
    /** Latest local probe per route id (read by providerStatuses for the credential dimension). */
    private readonly readiness;
    /** Last real call per route id: feeds the health dimension (never inferred from a local probe). */
    private readonly outcomes;
    constructor(ctx: Context, config: ResolvedConfig, store: Store, dynamic?: () => ResolvedConfig, browser?: BrowserService | BrowserGetter, memory?: LruCache<RouterSearchResult>, registry?: ProviderRegistry);
    /** Mirror the registry into the backend registry: new providers appear, unregistered ones stop being scheduled. */
    private syncBackends;
    private backendFor;
    private probeEnv;
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
     * outcome is a value.
     */
    runProvider(call: ProviderCall): Promise<ProviderOutcome>;
    /** Resolve a key through credentials first, then process env. */
    private resolveKey;
    private deps;
    /** Sync key check for available() (no credential resolution — env/literal only). */
    private depsSync;
    /** Counts a metered, non-model request (Bocha search) in the usage ledger; best effort, never throws into the search. */
    private usageRecorder;
    /** Whether any configured engine is currently usable. */
    anyEngineAvailable(): boolean;
    private build;
    private buildSync;
    /**
     * Every registered search provider with its descriptor and LOCAL readiness by dimension (installation / credential /
     * health), for `web_backend_status`. No network. Health is only `ready` after a real call succeeded in this process,
     * `cooldown` / `error` after failures; a provider that merely passed its local probe is `unknown`, not verified.
     */
    providerReport(cliAvailability?: ReadonlyMap<string, boolean>): Promise<ProviderReport[]>;
    /** Run a full search with caching + persistence. */
    search(opts: RouterSearchOptions): Promise<RouterSearchResult>;
    private runSearch;
    /**
     * No engine failed at runtime: each returned ENGINE_EMPTY or was skipped
     * (unavailable / cooldown). Zero sources plus an explanation (never cached).
     */
    private emptyResult;
    /** Platform search (web_platform_search tool) with the same cache+persist flow. */
    platformSearch(platform: string, query: string, url: string | undefined, count: number, opts: {
        signal?: AbortSignal;
        fresh?: boolean;
        authProfile?: string;
        rulePack?: string;
    }): Promise<RouterSearchResult>;
    /** Platform engine list; a seam so tests can inject fakes without network. */
    protected platformEngineList(platform: string, feedUrl: string | undefined, deps: EngineDeps): Engine[];
    private runPlatformSearch;
    /**
     * ctx.web provider adapter: route the seam request through this router.
     * Returns a WebSearchResult-shaped value for the built-in web_search tool.
     */
    searchAsProvider(request: WebSearchRequest, signal?: AbortSignal): Promise<WebSearchResult>;
}
