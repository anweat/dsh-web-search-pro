/**
 * Chinese-community platform search via Playwright (MediaCrawler's approach,
 * implemented cleanly with our own per-site rules): open each platform's search
 * page in the user's logged-in browser (storageState) and read the rendered
 * result list. The browser performs any signing the site needs — we never call
 * private APIs or reproduce sign algorithms.
 *
 * NOTE: each platform requires the user's login state (storageState). Result
 * selectors are best-effort and may need tuning per site's current markup.
 * @module web-search-pro/platform-search
 */
export interface PlatformSearchSpec {
    id: string;
    label: string;
    /** Build the search-page URL for a query. */
    url: (query: string) => string;
    /** Selector for one result item. */
    item: string;
    /** Selector for the title element inside an item (textContent). */
    title: string;
    /** Selector for the link element inside an item (href). */
    link: string;
    /** Optional selector for the snippet text inside an item. */
    text?: string;
}
/** Best-effort search-page specs for Chinese community platforms. */
export declare const PLATFORM_SEARCH_SPECS: Record<string, PlatformSearchSpec>;
/** Parse a raw Cookie header ("a=b; c=d") into Playwright cookies for the URL's domain. */
export declare function parseCookieString(cookie: string, url: string): {
    name: string;
    value: string;
    domain: string;
    path: string;
}[];
/** Drive one platform's search page and extract results. */
export declare function searchPlatformResults(page: any, spec: PlatformSearchSpec, count: number): Promise<{
    url: string;
    title: string;
    snippet?: string;
}[]>;
