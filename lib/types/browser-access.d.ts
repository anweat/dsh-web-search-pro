/**
 * Runtime helpers for the OPTIONAL dsh-browser service. The service is read
 * lazily per call (never captured at apply) and every consumer checks the
 * exact method it needs, so a missing/incomplete/legacy browser degrades one
 * capability instead of the whole plugin. Type-only import of the provider: no
 * runtime dependency on `@anweat/dsh-browser`.
 *
 * Only dsh-browser ^0.2.0 is supported. The old 0.1.x line is recognised and
 * refused (see {@link isLegacyBrowser}) instead of being driven through an
 * interface this plugin no longer tests.
 * @module web-search-pro/browser-access
 */
import type { BrowserService } from './browser-service.ts';
/** Reads the current browser service; undefined when not installed/enabled. */
export type BrowserGetter = () => BrowserService | undefined;
export type BrowserMethod = keyof BrowserService;
/**
 * Methods that only the dsh-browser 0.2 service has (session-aware observation and targets; 0.1.x has none of them).
 * The service carries no version field, so this shape is the signal: a service that has NONE of these is the legacy
 * 0.1.x line. "None" rather than "all" on purpose: a later 0.2.x that renames one of them is still recognised as 0.2.
 */
export declare const BROWSER_020_MARKERS: readonly ["observe", "listTargets", "sessionState"];
/** Shown wherever a legacy dsh-browser is refused. */
export declare const LEGACY_BROWSER_NOTICE = "dsh-browser 0.1.x is not supported by web-search-pro 0.2+; upgrade to @anweat/dsh-browser ^0.2.0";
/** True for a service of the unsupported dsh-browser 0.1.x line (it exposes none of {@link BROWSER_020_MARKERS}). */
export declare function isLegacyBrowser(browser: BrowserService | undefined): boolean;
/** The browser service when this plugin may use it: present and not the legacy line. */
export declare function usableBrowser(browser: BrowserService | undefined): BrowserService | undefined;
export declare class BrowserUnavailableError extends Error {
    readonly code = "BROWSER_UNAVAILABLE";
    constructor(message: string);
}
/** Accept a getter, a fixed service (tests, direct callers) or nothing. */
export declare function toBrowserGetter(source: BrowserService | BrowserGetter | undefined): BrowserGetter;
/** Why `method` cannot be used right now, or undefined when it can. */
export declare function browserGap(browser: BrowserService | undefined, method: BrowserMethod, feature: string): string | undefined;
/** The browser service, or throw a clear BrowserUnavailableError. */
export declare function requireBrowser(browser: BrowserService | undefined, method: BrowserMethod, feature: string): BrowserService;
/** Browser service state for diagnostics. */
export declare function browserState(browser: BrowserService | undefined): {
    available: boolean;
    state: 'ready' | 'incomplete' | 'legacy' | 'missing';
    reason?: string;
};
