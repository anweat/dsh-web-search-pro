/**
 * What a rendered search page said (dsh-browser's optional `searchPage`, docs/session-p0-contract.md) as the result or the error a
 * platform search raises. Every state has its own message, in Chinese like the neighbours: what happened and the ONE next step that
 * fits THAT state. The old combined sentence ("login or selectors") belongs to the `searchResults` fallback only, where the browser
 * cannot tell the states apart.
 *
 * Codes, and why (they flow through `router.providerReport` and the registry's cooldown rule, which cools down only a coded error that
 * is retryable):
 *  - needs_login with an AuthProfile: ENGINE_AUTH, not retryable. A credential was supplied and the site refused it, which is what
 *    `sources.status` shows as `credential: rejected`; waiting does not help, so no cooldown.
 *  - needs_login without a profile: CLI_NOT_LOGGED_IN, not retryable. The same code the standalone OpenCLI leg of the same chain gives for
 *    the same situation, and it does NOT claim a credential was rejected (none was supplied).
 *  - captcha / blocked: ENGINE_ERROR, not retryable. It is risk control; a retry at once makes it worse, and a cooldown timer would only
 *    hide that another leg of the chain (opencli, in your own Chrome) may still answer.
 *  - rate_limited: ENGINE_RATE_LIMIT, retryable. site_error / network: ENGINE_ERROR, retryable. timeout: ENGINE_TIMEOUT, retryable.
 *  - contract_drift: ENGINE_ERROR, not retryable: the page changed, a wait does not fix it.
 *  - empty / empty_unconfirmed: ENGINE_EMPTY (a served request: it never cools a platform down).
 * @module web-search-pro/search-page
 */
import type { SearchPageResult } from './browser-service.ts';
import type { WebSearchSource } from '@deepseek-ai/dsh-web';
export interface SearchPageContext {
    /** Name shown to the user (`微博`). */
    label: string;
    /** The platform key: `weibo`, or the custom platform's key. */
    platform: string;
    /** A user-defined platform: the selectors live in `customPlatforms.<key>`, the login in its `cookie` or a binding. */
    custom?: boolean;
    /** The AuthProfile the router bound to this platform (`browserBindings.<platform>.authProfile`), when the result does not say which it used. */
    boundProfile?: string | undefined;
    /** A custom platform that carries its own `cookie`: a login was supplied, so a login wall means that cookie is no longer accepted. */
    hasCookie?: boolean;
}
/** The rows of a search page, or the error its state calls for. */
export declare function sourcesOfSearchPage(res: SearchPageResult, ctx: SearchPageContext): WebSearchSource[];
