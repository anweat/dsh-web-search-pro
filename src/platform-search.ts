/**
 * Chinese-community platform search via Playwright (MediaCrawler's approach,
 * implemented cleanly with our own per-site rules): open each platform's search
 * page in the user's logged-in browser (storageState) and read the rendered
 * result list. The browser performs any signing the site needs — we never call
 * private APIs or reproduce sign algorithms.
 *
 * NOTE: each platform requires the user's login state (storageState). Result
 * selectors are best-effort and may need tuning per site's current markup.
 * @module web-search-pro/platform-search
 */

export interface PlatformSearchSpec {
  id: string
  label: string
  /** Build the search-page URL for a query. */
  url: (query: string) => string
  /** Selector for one result item. */
  item: string
  /** Selector for the title element inside an item (textContent). */
  title: string
  /** Selector for the link element inside an item (href). */
  link: string
  /** Optional selector for the snippet text inside an item. */
  text?: string
}

/** Best-effort search-page specs for Chinese community platforms. */
export const PLATFORM_SEARCH_SPECS: Record<string, PlatformSearchSpec> = {
  zhihu: {
    id: 'zhihu', label: '知乎',
    url: q => 'https://www.zhihu.com/search?type=content&q=' + encodeURIComponent(q),
    item: '.SearchResult-Card', title: '.ContentItem-title', link: '.ContentItem-title a', text: '.Highlight',
  },
  weibo: {
    id: 'weibo', label: '微博',
    url: q => 'https://s.weibo.com/weibo?q=' + encodeURIComponent(q),
    item: '.card-wrap', title: '.txt', link: '.from a', text: '.txt',
  },
  douban: {
    id: 'douban', label: '豆瓣',
    url: q => 'https://www.douban.com/search?q=' + encodeURIComponent(q),
    item: '.result', title: '.title a', link: '.title a', text: '.content p',
  },
  tieba: {
    id: 'tieba', label: '百度贴吧',
    url: q => 'https://tieba.baidu.com/f/search/res?ie=utf-8&qw=' + encodeURIComponent(q),
    item: '.s_post', title: '.p_title a', link: '.p_title a', text: '.p_content',
  },
  douyin: {
    id: 'douyin', label: '抖音',
    url: q => 'https://www.douyin.com/search/' + encodeURIComponent(q),
    item: '[data-e2e="search-item"]', title: 'a', link: 'a', text: 'p',
  },
  kuaishou: {
    id: 'kuaishou', label: '快手',
    url: q => 'https://www.kuaishou.com/search/video?searchKey=' + encodeURIComponent(q),
    item: '.video-card', title: '.video-info-title', link: 'a', text: '.video-info-title',
  },
}

/** Parse a raw Cookie header ("a=b; c=d") into Playwright cookies for the URL's domain. */
export function parseCookieString(cookie: string, url: string): { name: string; value: string; domain: string; path: string }[] {
  let domain = ''
  try { domain = new URL(url).hostname } catch { /* domain stays empty; caller must handle */ }
  return cookie.split(';').map(p => p.trim()).filter(Boolean).map(p => {
    const eq = p.indexOf('=')
    const name = eq >= 0 ? p.slice(0, eq).trim() : p.trim()
    const value = eq >= 0 ? p.slice(eq + 1).trim() : ''
    return { name, value, domain, path: '/' }
  }).filter(c => c.name.length > 0 && c.domain.length > 0)
}

// (Page-side extraction moved into the dsh-browser plugin's BrowserService;
// web-search-pro now calls browser.searchResults(url, spec, opts).)
