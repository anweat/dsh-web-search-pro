/**
 * System prompt text for web-search-pro. The base part only describes this
 * plugin's own tools; browser_* guidance is appended when the optional
 * dsh-browser service is present (evaluated at prompt-assembly time).
 * @module web-search-pro/prompt
 */

const BASE = 'Web research: prefer web_search_pro (give task/needs for an evidence pack), web_fetch_pro (long pages: read on with offset) and web_platform_search (see web_backend_status for platforms). Cite URLs as markdown links. Run web_deps action=check before relying on CLI backends. Prefer evidence mode; set engines/platform only when needed (web_backend_status action=recommend suggests up to 3 sources); never query every source.'

const NO_BROWSER = ' web_snapshot, Chinese-community (知乎/微博/豆瓣…) and OpenCLI (小红书/Twitter/Reddit…) platforms need the optional dsh-browser plugin, not available now; suggest it only when the user needs those.'

const WITH_BROWSER = ' dsh-browser is available: web_snapshot renders pages, web_platform_search also covers 知乎/微博/豆瓣/贴吧/抖音/快手 and OpenCLI platforms. Call browser_status first and obey its automationMode/usagePolicy and limits. Prefer OpenCLI (browser_opencli_catalog before browser_opencli_run; browser_opencli_status for bridge issues), then network/extract primitives (browser_script_catalog; browser_script_validate before browser_userscript_run), then DOM interaction (browser_open/click/type/scroll/read/screenshot); browser_crawl for anonymous bounded same-origin traversal, browser_recipe_run for bounded multi-step work. Chinese communities need a domain-scoped dsh-browser AuthProfile (scripts/save-login.mjs) bound via browserBindings.'

export function buildPromptText(hasBrowser: boolean): string {
  return BASE + (hasBrowser ? WITH_BROWSER : NO_BROWSER)
}
