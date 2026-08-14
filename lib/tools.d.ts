/**
 * Tool definitions for web-search-pro: 8 model-facing tools over the router,
 * fetch service, store, and playwright manager.
 * @module web-search-pro/tools
 */
import type { Context } from '@deepseek-ai/cordis';
import type { SearchRouter } from './router.ts';
import type { FetchService } from './fetch.ts';
import type { Store } from './store.ts';
import type { BrowserService } from './browser-service.ts';
import type { ResolvedConfig } from './config.ts';
export interface ToolDeps {
    ctx: Context;
    config: ResolvedConfig;
    /** Hot-reloadable config source (settings.yaml overlay). */
    dynamic: () => ResolvedConfig;
    store: Store;
    router: SearchRouter;
    fetch: FetchService;
    browser: BrowserService;
}
export declare function formatSources(sources: {
    url: string;
    title?: string;
    snippet?: string;
    publishedAt?: string;
}[]): string;
export declare function registerTools(deps: ToolDeps): void;
