/**
 * Tool definitions for web-search-pro: 8 model-facing tools over the router,
 * fetch service, store, and playwright manager.
 * @module web-search-pro/tools
 */
import type { Context } from '@deepseek-ai/cordis';
import type { SearchRouter } from './router.ts';
import type { FetchService } from './fetch.ts';
import type { Store } from './store.ts';
import { type BrowserGetter } from './browser-access.ts';
import type { BrowserService } from './browser-service.ts';
import type { ResolvedConfig } from './config.ts';
import { EvidenceService } from './pipeline/service.ts';
export interface ToolDeps {
    ctx: Context;
    config: ResolvedConfig;
    /** Hot-reloadable config source (settings.yaml overlay). */
    dynamic: () => ResolvedConfig;
    store: Store;
    router: SearchRouter;
    fetch: FetchService;
    /** Optional dsh-browser service, read lazily at call time (fixed service accepted for tests). */
    browser?: BrowserService | BrowserGetter;
    /** Evidence pipeline (built lazily from the other deps when omitted; tests inject doubles). */
    evidence?: Pick<EvidenceService, 'search'>;
}
export declare function formatSources(sources: {
    url: string;
    title?: string;
    snippet?: string;
    publishedAt?: string;
}[]): string;
/**
 * Per-item character limit so that `sum(min(length, limit)) <= total` and `limit <= perItem`:
 * short texts keep all they have and the room they leave over goes to the long ones.
 */
export declare function fairShareLimit(lengths: readonly number[], perItem: number, total: number): number;
export declare function registerTools(deps: ToolDeps): void;
/**
 * Whether the twitter platform backend can really run: the `twitter` command works (probed by detectDeps)
 * AND the backend is enabled in settings AND its credentials are in the environment (same gates as the engine).
 */
export declare function twitterGate(cfg: Pick<ResolvedConfig, 'enableCliBackends' | 'agentReachEnabled'>, dep: {
    available: boolean;
    diagnostic?: string;
}): {
    available: boolean;
    note?: string;
};
