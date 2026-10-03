/**
 * Runtime helpers for the OPTIONAL dsh-browser service. The service is read
 * lazily per call (never captured at apply) and every consumer checks the
 * exact method it needs, so a missing/older browser degrades one capability
 * instead of the whole plugin. Type-only import of the provider: no runtime
 * dependency on `@anweat/dsh-browser`.
 * @module web-search-pro/browser-access
 */
export class BrowserUnavailableError extends Error {
    code = 'BROWSER_UNAVAILABLE';
    constructor(message) {
        super(message);
        this.name = 'BrowserUnavailableError';
    }
}
/** Accept a getter, a fixed service (tests/legacy callers) or nothing. */
export function toBrowserGetter(source) {
    if (typeof source === 'function')
        return source;
    return () => source;
}
/** Why `method` cannot be used right now, or undefined when it can. */
export function browserGap(browser, method, feature) {
    if (!browser) {
        return feature + ' requires the optional dsh-browser plugin, which is not installed or not enabled. '
            + 'Install/enable @anweat/dsh-browser (the host may need a restart to load it); all other web-search-pro actions work without it.';
    }
    if (typeof browser[method] !== 'function') {
        return feature + ' requires a newer dsh-browser (service has no ' + method + '()). Update @anweat/dsh-browser.';
    }
    return undefined;
}
/** The browser service, or throw a clear BrowserUnavailableError. */
export function requireBrowser(browser, method, feature) {
    const gap = browserGap(browser, method, feature);
    if (gap)
        throw new BrowserUnavailableError(gap);
    return browser;
}
/** Browser service state for diagnostics. */
export function browserState(browser) {
    if (!browser)
        return { available: false, state: 'missing', reason: 'dsh-browser is not installed or not enabled; read.snapshot and browser-only platforms are unavailable' };
    const absent = ['render', 'snapshot', 'searchResults', 'opencli'].filter(m => typeof browser[m] !== 'function');
    if (absent.length)
        return { available: true, state: 'incomplete', reason: 'dsh-browser lacks ' + absent.join(', ') + '; update @anweat/dsh-browser' };
    return { available: true, state: 'ready' };
}
//# sourceMappingURL=browser-access.js.map