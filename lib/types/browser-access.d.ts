/**
 * Runtime helpers for the OPTIONAL dsh-browser service. The service is read
 * lazily per call (never captured at apply) and every consumer checks the
 * exact method it needs, so a missing/older browser degrades one capability
 * instead of the whole plugin. Type-only import of the provider: no runtime
 * dependency on `@anweat/dsh-browser`.
 * @module web-search-pro/browser-access
 */
import type { BrowserService } from './browser-service.ts';
/** Reads the current browser service; undefined when not installed/enabled. */
export type BrowserGetter = () => BrowserService | undefined;
export type BrowserMethod = keyof BrowserService;
export declare class BrowserUnavailableError extends Error {
    readonly code = "BROWSER_UNAVAILABLE";
    constructor(message: string);
}
/** Accept a getter, a fixed service (tests/legacy callers) or nothing. */
export declare function toBrowserGetter(source: BrowserService | BrowserGetter | undefined): BrowserGetter;
/** Why `method` cannot be used right now, or undefined when it can. */
export declare function browserGap(browser: BrowserService | undefined, method: BrowserMethod, feature: string): string | undefined;
/** The browser service, or throw a clear BrowserUnavailableError. */
export declare function requireBrowser(browser: BrowserService | undefined, method: BrowserMethod, feature: string): BrowserService;
/** Browser service state for diagnostics. */
export declare function browserState(browser: BrowserService | undefined): {
    available: boolean;
    state: 'ready' | 'incomplete' | 'missing';
    reason?: string;
};
