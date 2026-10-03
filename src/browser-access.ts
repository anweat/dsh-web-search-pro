/**
 * Runtime helpers for the OPTIONAL dsh-browser service. The service is read
 * lazily per call (never captured at apply) and every consumer checks the
 * exact method it needs, so a missing/older browser degrades one capability
 * instead of the whole plugin. Type-only import of the provider: no runtime
 * dependency on `@anweat/dsh-browser`.
 * @module web-search-pro/browser-access
 */

import type { BrowserService } from './browser-service.ts'

/** Reads the current browser service; undefined when not installed/enabled. */
export type BrowserGetter = () => BrowserService | undefined
export type BrowserMethod = keyof BrowserService

export class BrowserUnavailableError extends Error {
  readonly code = 'BROWSER_UNAVAILABLE'
  constructor(message: string) {
    super(message)
    this.name = 'BrowserUnavailableError'
  }
}

/** Accept a getter, a fixed service (tests/legacy callers) or nothing. */
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
export function browserState(browser: BrowserService | undefined): { available: boolean; state: 'ready' | 'incomplete' | 'missing'; reason?: string } {
  if (!browser) return { available: false, state: 'missing', reason: 'dsh-browser is not installed or not enabled; read.snapshot and browser-only platforms are unavailable' }
  const absent = (['render', 'snapshot', 'searchResults', 'opencli'] as const).filter(m => typeof browser[m] !== 'function')
  if (absent.length) return { available: true, state: 'incomplete', reason: 'dsh-browser lacks ' + absent.join(', ') + '; update @anweat/dsh-browser' }
  return { available: true, state: 'ready' }
}
