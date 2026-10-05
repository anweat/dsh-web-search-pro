/**
 * Test doubles for the optional `browser` service. A real dsh-browser 0.2 service has the session-aware methods below;
 * a double without any of them is (correctly) taken for the unsupported 0.1.x line, so every double that should count
 * as a working 0.2 browser spreads `BROWSER_020` in.
 */
export const BROWSER_020 = {
  observe: async () => ({}),
  listTargets: async () => ({ targets: [] }),
  sessionState: () => undefined,
}

/** What dsh-browser 0.1.x had: the five methods this plugin used, none of the 0.2 ones. */
export function legacyBrowser(): Record<string, unknown> {
  return {
    render: async () => ({ title: 'Old', text: 'rendered by a legacy browser', html: '<p>x</p>' }),
    snapshot: async () => ({ title: 'Old', text: 'legacy snapshot', htmlPath: '/tmp/x.html' }),
    searchResults: async () => [{ url: 'https://legacy.test/1', title: 'Legacy hit', snippet: 'must never be used' }],
    opencli: async () => ({ code: 0, stdout: '', stderr: '' }),
    close: async () => {},
    status: async () => ({ automationMode: 'unrestricted' }),
  }
}
