/**
 * System prompt text for web-search-pro: one line for this plugin's tools, plus one line when the optional
 * dsh-browser service is present (evaluated at prompt-assembly time). Everything else lives in the
 * `dsh-web-search-pro` skill and in the `web_index` root, so it costs context only when it is needed.
 * @module web-search-pro/prompt
 */

const BASE = 'Web research: web_index lists actions, web_call runs them (search.run with task/profile returns an evidence pack; read.fetch reads a page); see skill dsh-web-search-pro. Cite URLs as markdown links.'

const WITH_BROWSER = ' dsh-browser available; for interactive browsing see skill dsh-browser or browser_index.'

export function buildPromptText(hasBrowser: boolean): string {
  return BASE + (hasBrowser ? WITH_BROWSER : '')
}
