/**
 * Model-facing tool surfaces for web-search-pro.
 *
 * Every capability is an action in the registry (`src/actions/`). This module
 * only projects that registry into tools:
 *
 * - `indexed` (default): two small tools, `web_index` for progressive
 *   disclosure and `web_call` to run an action. Constant, tiny context cost.
 * - `flat`: one tool per action, named `web_<group>_<action>`. Every action
 *   is described up front; for comparison and debugging only.
 *
 * Both surfaces dispatch through the same {@link runAction}, so validation,
 * the result envelope and the error codes are identical.
 * @module web-search-pro/tools
 */
import type { Context } from '@deepseek-ai/cordis';
import type { SearchRouter } from './router.ts';
import type { FetchService } from './fetch.ts';
import type { Store } from './store.ts';
import { type BrowserGetter } from './browser-access.ts';
import type { BrowserService } from './browser-service.ts';
import type { ResolvedConfig, ToolSurface } from './config.ts';
import { EvidenceService } from './pipeline/service.ts';
import type { ProviderState } from './provider.ts';
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
    /** Overrides `config.toolSurface`. */
    toolSurface?: ToolSurface;
    /** State of the ctx.web provider route, for `sources.status`. */
    providerState?: () => ProviderState;
    /** Whether the `dsh-web-search-pro` skill is currently registered; read at call time. */
    skillAvailable?: () => boolean;
}
export declare function registerTools(deps: ToolDeps): void;
