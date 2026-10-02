/**
 * Search-provider registry (design §4, dev-plan M6): a descriptor (what a source
 * is: id, languages, task profiles, filters, requirements, cost) plus a runtime
 * (`probeLocal`: local readiness without network; `create`: the Engine). Built-in
 * engines and any later adapter use the same shape; adding a source is one
 * descriptor + adapter file and a `register` call, not an edit of the core.
 *
 * Ids are namespaced and stable (`builtin:ddg`, `vendor:name`); `aliases` keep the
 * short legacy ids (`ddg`) working. The id that appears in tool output, history,
 * cache keys and backend state is the ROUTE id: the first alias when there is one,
 * else the full id, so existing records and tests keep their names.
 * Nothing here loads code dynamically: only adapters handed to `register` exist.
 * @module web-search-pro/providers/registry
 */
import type { Engine, EngineDeps } from '../engines.ts';
import type { ResolvedConfig } from '../config.ts';
import type { CompiledQuery } from '../pipeline/compile.ts';
import type { TaskSpec } from '../pipeline/types.ts';
export type Operation = 'search';
/** A thing a provider needs before it can run. `env` lists credential / environment names, tried in order. */
export interface Requirement {
    kind: 'key' | 'cli' | 'browser' | 'service';
    /** Stable name: `bocha-key`, `mcporter`, `dsh-browser`. */
    id: string;
    /** `key`: credentials refs / environment variables, first configured one wins. */
    env?: readonly string[];
    /** Not needed for the provider to run (a fallback path exists). */
    optional?: boolean;
    note?: string;
}
export interface CostDescriptor {
    kind: 'free' | 'metered' | 'subscription' | 'unknown';
    /** What one billed unit is (`request`). */
    unit?: string;
    note?: string;
}
export interface ProviderDescriptor {
    /** Namespaced, stable: `builtin:ddg`. */
    id: string;
    /** Legacy / short ids accepted wherever an engine id is (`ddg`). The first one is the route id used in outputs. */
    aliases: readonly string[];
    label: string;
    adapterVersion: string;
    contractVersion: 1;
    operations: readonly Operation[];
    /** Profiles (docs_code, news_fact, academic, experience, compare, general) the provider is a sensible source for. */
    taskProfiles: readonly string[];
    /**
     * Languages (ISO 639-1: `zh`, `en`) the provider is STRONG in. `*` = language-agnostic. The planner prefers a
     * provider that names the task's language over language-agnostic ones.
     */
    languages: readonly string[];
    /** Regions it covers or is tuned for (`cn`, `global`); informational. */
    regions: readonly string[];
    /** What it returns (`web`, `code`, `paper`, `video`, `forum`). */
    resultKinds: readonly string[];
    /**
     * Shared upstream index (`google` for Serper and SerpAPI). Absent = unknown: never read as independent, and
     * providers with the same family do not count as independent evidence.
     */
    sourceFamily?: string;
    requirements: readonly Requirement[];
    /**
     * Constraint kinds the provider enforces NATIVELY (`site`, `exclude_site`, `exclude_term`, `time_window`, `category`).
     * A hard constraint outside this list is verified locally and reported as such, never silently ignored.
     */
    supportedFilters: readonly string[];
    costModel: CostDescriptor;
    /** Order among providers promoted for a language (lower first, default 100). */
    priority?: number;
    /** Only a recorded live check (version, date, result) sets `live`; absent / false = not verified against the real service. */
    verification?: {
        live: boolean;
        note?: string;
    };
}
export type InstallationState = 'missing' | 'detected' | 'incompatible' | 'not_required';
export type CredentialState = 'not_required' | 'missing' | 'configured' | 'rejected';
export type Health = 'unknown' | 'ready' | 'degraded' | 'cooldown' | 'error';
/**
 * Local readiness, by dimension (design §4.3). `available` is the only field the router acts on: false = do not
 * run it. Everything else explains or refines: a `configured` credential is a local fact, not proof the service accepts it.
 */
export interface Readiness {
    available: boolean;
    installation?: InstallationState;
    credential?: CredentialState;
    health?: Health;
    reason?: string;
    diagnosticCode?: string;
}
/** What `probeLocal` may look at: resolved dependencies and settings, plus CLI presence when the caller scanned it. No network. */
export interface ProbeEnv {
    deps: EngineDeps;
    config: ResolvedConfig;
    cli?: ReadonlyMap<string, boolean> | undefined;
}
export interface ProviderAdapter {
    descriptor: ProviderDescriptor;
    /** Local readiness: declared services, keys, commands. No network, no login, no model call. */
    probeLocal(env: ProbeEnv): Readiness | Promise<Readiness>;
    create(deps: EngineDeps, config: ResolvedConfig): Engine;
    /** Optional native query compilation (constraints -> provider options); absent = the core compiler's rules / plain query. */
    compile?(task: Pick<TaskSpec, 'goal' | 'query' | 'needs' | 'constraints'>, now: Date): CompiledQuery;
}
/** The id under which a provider appears in tool output, history, cache keys and backend state. */
export declare function routeIdOf(descriptor: Pick<ProviderDescriptor, 'id' | 'aliases'>): string;
export declare class ProviderRegistry {
    private readonly adapters;
    /** Every accepted spelling (full id and aliases) -> full id. */
    private readonly names;
    private readonly listeners;
    private version;
    /**
     * Add an adapter. A duplicate id, or an alias / id that another provider already owns, throws: nothing is
     * replaced silently. Returns the unregister function (stops new scheduling; in-flight calls finish).
     */
    register(adapter: ProviderAdapter): () => void;
    /** The adapter for a full id or alias (case-sensitive, trimmed), or undefined. */
    resolve(idOrAlias: string): ProviderAdapter | undefined;
    /** Route id for a full id or alias; undefined when unknown. */
    routeId(idOrAlias: string): string | undefined;
    list(filter?: {
        operation?: Operation;
    }): ProviderAdapter[];
    /** Route ids of every provider that can search, registration order. */
    searchIds(): string[];
    /** Normalise a list of ids (aliases, full ids) to route ids, dropping repeats; unknown ids are returned apart. */
    normalize(ids: readonly string[]): {
        ids: string[];
        unknown: string[];
    };
    /** Message for ids the registry does not know, listing what is available. */
    unknownMessage(unknown: readonly string[]): string;
    /** Throws the "unknown engine" error when any id is unknown; otherwise returns the route ids (aliases accepted). */
    validate(ids: readonly string[]): string[];
    /** Called after every register / unregister (the router syncs its backends). Returns the unsubscribe function. */
    onChange(listener: () => void): () => void;
    /** Bumped on every change, so a consumer can tell whether its copy is stale. */
    get revision(): number;
    private touch;
}
