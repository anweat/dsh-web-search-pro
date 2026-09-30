/**
 * System prompt text for web-search-pro. The base part only describes this
 * plugin's own tools; browser_* guidance is appended when the optional
 * dsh-browser service is present (evaluated at prompt-assembly time).
 * @module web-search-pro/prompt
 */

const BASE = 'For web research prefer the persistent enhanced tools: web_search_pro (multi-engine search with caching and history), web_platform_search (GitHub/B站/YouTube/V2EX/RSS/arXiv/PubMed), and web_fetch_pro (readable extraction with per-site rules). Cite relevant URLs as markdown links. Before relying on external CLI backends (bili/yt-dlp/agent-reach), run web_deps action=check.'

const NO_BROWSER = ' web_snapshot, Chinese-community platforms (知乎/微博/豆瓣/贴吧/抖音/快手), OpenCLI-backed platforms (小红书/Twitter/Reddit…) and custom selector platforms need the optional dsh-browser plugin, which is not available now; suggest installing/enabling it only when the user needs those.'

const WITH_BROWSER = ' dsh-browser is available: web_snapshot captures rendered pages, and web_platform_search also covers 知乎/微博/豆瓣/贴吧/抖音/快手 and OpenCLI platforms. For interactive browsing use browser_open/click/type/scroll/read/screenshot; browser_crawl for anonymous bounded same-origin traversal; browser_recipe_run for bounded multi-step operations. Call browser_status first and obey its automationMode/usagePolicy (read-only denies mutation; standard asks for interactions and risky tools; autonomous allows page interactions and mutating recipes but still gates dependency installs, external UserScripts and general OpenCLI; unrestricted skips approvals); concurrency, burst, page/depth, retry and backoff limits always apply. Prefer OpenCLI adapters (browser_opencli_catalog before browser_opencli_run; browser_opencli_status for bridge problems), then browser network/extract primitives (browser_script_catalog first; browser_script_validate before browser_userscript_run), then DOM interaction. Chinese communities need a named, domain-scoped dsh-browser AuthProfile (scripts/save-login.mjs) bound through browserBindings.'

export function buildPromptText(hasBrowser: boolean): string {
  return BASE + (hasBrowser ? WITH_BROWSER : NO_BROWSER)
}
