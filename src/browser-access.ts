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

import type { BrowserService } from './browser-service.ts'

/** Reads the current browser service; undefined when not installed/enabled. */
export type BrowserGetter = () => BrowserService | undefined
export type BrowserMethod = keyof BrowserService

/**
 * Methods that only the dsh-browser 0.2 service has (session-aware observation and targets; 0.1.x has none of them).
 * The service carries no version field, so this shape is the signal: a service that has NONE of these is the legacy
 * 0.1.x line. "None" rather than "all" on purpose: a later 0.2.x that renames one of them is still recognised as 0.2.
 */
export const BROWSER_020_MARKERS = ['observe', 'listTargets', 'sessionState'] as const satisfies readonly BrowserMethod[]

/** Shown wherever a legacy dsh-browser is refused. */
export const LEGACY_BROWSER_NOTICE = 'dsh-browser 0.1.x is not supported by web-search-pro 0.2+; upgrade to @anweat/dsh-browser ^0.2.0'

/** True for a service of the unsupported dsh-browser 0.1.x line (it exposes none of {@link BROWSER_020_MARKERS}). */
export function isLegacyBrowser(browser: BrowserService | undefined): boolean {
  return browser !== undefined && !BROWSER_020_MARKERS.some(method => typeof browser[method] === 'function')
}

/** The browser service when this plugin may use it: present and not the legacy line. */
export function usableBrowser(browser: BrowserService | undefined): BrowserService | undefined {
  return isLegacyBrowser(browser) ? undefined : browser
}

export class BrowserUnavailableError extends Error {
  readonly code = 'BROWSER_UNAVAILABLE'
  constructor(message: string) {
    super(message)
    this.name = 'BrowserUnavailableError'
  }
}

/** Accept a getter, a fixed service (tests, direct callers) or nothing. */
export function toBrowserGetter(source: BrowserService | BrowserGetter | undefined): BrowserGetter {
  if (typeof source === 'function') return source
  return () => source
}

/** Why `method` cannot be used right now, or undefined when it can. */
export function browserGap(browser: BrowserService | undefined, method: BrowserMethod, feature: string): string | undefined {
  if (!browser) {
    return feature + ' requires the optional dsh-browser plugin, which is not installed or not enabled. '
      + 'Install/enable @anweat/dsh-browser (the host may need a restart to load it); all other web-search-pro actions work without it.'
  }
  if (isLegacyBrowser(browser)) return feature + ' is unavailable: ' + LEGACY_BROWSER_NOTICE + '.'
  if (typeof browser[method] !== 'function') {
    return feature + ' requires a newer dsh-browser (service has no ' + method + '()). Update @anweat/dsh-browser.'
  }
  return undefined
}

/** The browser service, or throw a clear BrowserUnavailableError. */
export function requireBrowser(browser: BrowserService | undefined, method: BrowserMethod, feature: string): BrowserService {
  const gap = browserGap(browser, method, feature)
  if (gap) throw new BrowserUnavailableError(gap)
  return browser!
}

/** Browser service state for diagnostics. */
export function browserState(browser: BrowserService | undefined): { available: boolean; state: 'ready' | 'incomplete' | 'legacy' | 'missing'; reason?: string } {
  if (!browser) return { available: false, state: 'missing', reason: 'dsh-browser is not installed or not enabled; read.snapshot and browser-only platforms are unavailable' }
  if (isLegacyBrowser(browser)) return { available: false, state: 'legacy', reason: LEGACY_BROWSER_NOTICE + '; read.snapshot and browser-only platforms are unavailable' }
  const absent = (['render', 'snapshot', 'searchResults', 'opencli'] as const).filter(m => typeof browser[m] !== 'function')
  if (absent.length) return { available: true, state: 'incomplete', reason: 'dsh-browser lacks ' + absent.join(', ') + '; update @anweat/dsh-browser' }
  return { available: true, state: 'ready' }
}
