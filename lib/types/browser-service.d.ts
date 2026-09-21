/**
 * Consumer-side contract for the `browser` service provided by dsh-browser.
 * Keep this surface derived from the provider's public type so incompatible
 * browser changes fail web-search-pro's typecheck instead of drifting silently.
 * @module web-search-pro/browser-service
 */
import type { BrowserService as DshBrowserService } from '@anweat/dsh-browser';
export type BrowserService = Pick<DshBrowserService, 'render' | 'snapshot' | 'searchResults' | 'opencli' | 'close'>;
