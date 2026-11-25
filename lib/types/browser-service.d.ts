/**
 * Consumer-side contract for the `browser` service provided by dsh-browser.
 * Keep this surface derived from the provider's public type so incompatible
 * browser changes fail web-search-pro's typecheck instead of drifting silently.
 * @module web-search-pro/browser-service
 */
import type { BrowserService as DshBrowserService } from '@anweat/dsh-browser';
import type { SearchPageOutcome } from './engine-error.ts';
/** A state of a rendered search page (docs/session-p0-contract.md in the dev repository). */
export type SearchPageState = SearchPageOutcome;
type SearchResultsArgs = Parameters<DshBrowserService['searchResults']>;
/** The rows of a search page: the same shape `searchResults` returns. */
export type SearchPageItem = Awaited<ReturnType<DshBrowserService['searchResults']>>[number];
export interface SearchPageResult {
    state: SearchPageState;
    /** Only `ok` carries rows. */
    items: SearchPageItem[];
    tookMs: number;
    /** HTTP status of the main document. */
    status?: number;
    /** The final URL without query and hash. */
    finalUrl?: string;
    /** One English sentence saying what the verdict rests on; no cookie, token or page text. */
    detail?: string;
    /** The id of the AuthProfile the call used. */
    authProfile?: string;
}
/**
 * `searchPage` is OPTIONAL: it is written structurally here because the installed `@anweat/dsh-browser` types may not have it yet.
 * A service that has it is asked for a verdict; one that has not is driven through `searchResults` exactly as before.
 */
export interface SearchPageMethod {
    searchPage?(url: SearchResultsArgs[0], spec: SearchResultsArgs[1], opts?: NonNullable<SearchResultsArgs[2]> & {
        timeoutMs?: number;
    }): Promise<SearchPageResult>;
}
export type BrowserService = Pick<DshBrowserService, 'render' | 'snapshot' | 'searchResults' | 'opencli' | 'close' | 'observe' | 'listTargets' | 'sessionState'> & SearchPageMethod;
export {};
