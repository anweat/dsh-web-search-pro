/**
 * The progressive-disclosure views behind `web_index`.
 *
 * L1 is the group list (root) and one group's actions; L2 is one action's full
 * schema. Actions that cannot run right now (read.snapshot without dsh-browser)
 * collapse into one line with the reason.
 * @module web-search-pro/actions/index-view
 */
import { type ActionDef } from './types.ts';
export declare const SKILL_NAME = "dsh-web-search-pro";
export interface IndexEnvironment {
    /** True when the `dsh-web-search-pro` skill is registered with the Host. */
    skillAvailable: boolean;
    /** The dsh-browser service is present and complete. */
    browserReady: boolean;
}
/** The fallback guide shown at the root when no skill service is present (kept under ~300 tokens). */
export declare const COMPACT_GUIDE: string;
export declare function renderRoot(env: IndexEnvironment): string;
export declare function renderGroup(group: string, env: IndexEnvironment): string;
export declare function renderAction(name: string, env: IndexEnvironment): string;
export declare function searchActions(query: string, env: IndexEnvironment): ActionDef[];
export declare function renderSearch(query: string, env: IndexEnvironment): string;
/** Resolve a `web_index` call to text. `action` wins over `group`, which wins over `query`. */
export declare function renderIndex(args: {
    group?: string;
    action?: string;
    query?: string;
}, env: IndexEnvironment): {
    level: 'root' | 'group' | 'action' | 'search';
    text: string;
};
