/**
 * The ctx.web provider route (dev-plan M8c): this plugin as the Host's search and fetch provider, so the built-in
 * `web_search` / `web_fetch` tools the model already prefers return filtered evidence and budgeted pages.
 *
 * Selection is the Host's, not ours (`@deepseek-ai/dsh-web`): a provider is used only when the `web` entry pins its id
 * (`searchProvider` / `fetchProvider`, or `DSH_WEB_SEARCH_PROVIDER` / `DSH_WEB_FETCH_PROVIDER`, which feed the same
 * fields), or when it is the only usable provider registered. With no pinned id and two usable providers the Host fails
 * every call with `WEB_PROVIDER_AMBIGUOUS`. Registering is therefore opt-in (`registerProvider`), never a silent takeover.
 * @module web-search-pro/provider
 */
import type { WebFetchProvider, WebSearchProvider } from '@deepseek-ai/dsh-web';
import type { ResolvedConfig, ToolSurface } from './config.ts';
import type { FetchService } from './fetch.ts';
import type { SearchRouter } from './router.ts';
import type { EvidenceService } from './pipeline/service.ts';
/** How far past the pipeline's own deadline the provider waits before it gives up on the pipeline and returns plain sources. */
export declare const EVIDENCE_GUARD_MS = 3000;
/** The call a model makes for an action on the active tool surface (`web_call history.expand` / flat `web_history_expand`). */
export declare function callHint(action: string, surface: ToolSurface): string;
/** One line under the pack: how to go further from inside the built-in tool. */
export declare function expandHint(surface: ToolSurface): string;
/** Trailing line of a truncated page: where to continue (the page text already ends with the truncation marker). */
export declare function continueHint(surface: ToolSurface, url: string, nextOffset: number | undefined): string;
export interface SearchProviderDeps {
    router: Pick<SearchRouter, 'searchAsProvider' | 'anyEngineAvailable'>;
    evidence: () => Pick<EvidenceService, 'search'>;
    dynamic: () => ResolvedConfig;
    id: () => string;
    /** The tool surface registered at startup (it decides how the hints name the calls). */
    surface: ToolSurface;
    /** Test seam: wait this long past the pipeline's own deadline before giving up on it. */
    guardMs?: number;
}
/**
 * Search provider: evidence pack when `provider.evidence` is `auto`, the plain router search otherwise.
 * The evidence run has its own deadline and never fails the built-in tool: any failure returns today's plain sources.
 * Only the caller's own cancellation is rethrown.
 */
export declare function createSearchProvider(deps: SearchProviderDeps): WebSearchProvider;
export interface FetchProviderDeps {
    fetch: Pick<FetchService, 'fetchPage'>;
    dynamic: () => ResolvedConfig;
    id: () => string;
    surface: ToolSurface;
}
/** Fetch provider: the same fetch pipeline as `read.fetch`, under a fixed budget (the request carries no size). */
export declare function createFetchProvider(deps: FetchProviderDeps): WebFetchProvider;
export type SelectionKind = 'search' | 'fetch';
export interface Selection {
    /** The id the Host is pinned to, when one is. */
    pinned?: string;
    /** `host`: read from the web runtime (config or env, already merged). `env`: the runtime hides it, so only the environment variable was read. */
    via: 'host' | 'env';
    /** `selected`: this plugin's provider is pinned. `other`: another id is pinned. `unpinned`: nothing is pinned (the Host then needs exactly one usable provider). */
    state: 'selected' | 'other' | 'unpinned';
}
export interface ProviderState {
    id: string;
    registered: boolean;
    evidence: ResolvedConfig['provider']['evidence'];
    search?: Selection;
    fetch?: Selection;
}
/**
 * Which provider the Host is pinned to for one capability. `WebRuntime` keeps the pinned id (config merged with the
 * environment) in a private field; it is read defensively, and the environment variable is the fallback.
 */
export declare function readSelection(web: unknown, kind: SelectionKind, id: string, env?: NodeJS.ProcessEnv): Selection;
export declare function readProviderState(deps: {
    web: unknown;
    registered: boolean;
    id: string;
    evidence: ProviderState['evidence'];
    env?: NodeJS.ProcessEnv;
}): ProviderState;
/** Setup text for the user, shown by `sources.status` while the route is not fully active. */
export declare const SELECT_HINT = "select it in the profile patch: `- id: web` / `config: { searchProvider: <id>, fetchProvider: <id> }` (or env DSH_WEB_SEARCH_PROVIDER / DSH_WEB_FETCH_PROVIDER), then restart";
export declare function renderProviderState(state: ProviderState): string[];
