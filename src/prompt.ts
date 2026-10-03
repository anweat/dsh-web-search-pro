/**
 * System prompt text for web-search-pro: one line for this plugin's tools, plus one line when the optional
 * dsh-browser service is present (evaluated at prompt-assembly time). Everything else lives in the
 * `dsh-web-search-pro` skill and in the `web_index` root, so it costs context only when it is needed.
 * @module web-search-pro/prompt
 */

const BASE = 'Web research: prefer web_call search.run (task, profile) over web_search + web_fetch: it returns filtered evidence in far less context. read.fetch reads a page (offset continues). web_index lists actions; see skill dsh-web-search-pro. Cite URLs as markdown links.'

const WITH_BROWSER = ' dsh-browser available; for interactive browsing see skill dsh-browser or browser_index.'

export function buildPromptText(hasBrowser: boolean): string {
  return BASE + (hasBrowser ? WITH_BROWSER : '')
}
