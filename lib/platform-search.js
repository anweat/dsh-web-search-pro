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
/** Best-effort search-page specs for Chinese community platforms. */
export const PLATFORM_SEARCH_SPECS = {
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
};
/** Serialize a spec for the in-page extractor (page.evaluate arg). */
function specArg(spec) {
    return { item: spec.item, title: spec.title, link: spec.link, text: spec.text ?? '' };
}
/**
 * In-page result-list extractor (raw string: esbuild would inject a __name
 * helper into a closure, which does not exist in the page context).
 */
const EXTRACTOR = `(spec) => {
  const items = []
  const nodes = document.querySelectorAll(spec.item)
  for (let i = 0; i < nodes.length && items.length < 20; i++) {
    const el = nodes[i]
    const titleEl = spec.title ? el.querySelector(spec.title) : null
    const linkEl = spec.link ? el.querySelector(spec.link) : null
    const textEl = spec.text ? el.querySelector(spec.text) : null
    const title = (titleEl ? titleEl.textContent : el.textContent || '').trim().replace(/\s+/g, ' ')
    let url = linkEl ? (linkEl.href || linkEl.getAttribute('href') || '') : ''
    if (url && url.startsWith('/')) url = location.origin + url
    if (!url && linkEl === null && titleEl) { const a = titleEl.closest ? titleEl.closest('a') : null; if (a) url = a.href }
    const snippet = textEl ? (textEl.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 300) : ''
    if (!url || !title || title.length < 2) continue
    items.push({ url, title, snippet })
  }
  return items
}`;
/** Drive one platform's search page and extract results. */
export async function searchPlatformResults(page, spec, count) {
    const data = await page.evaluate('(' + EXTRACTOR + ')(' + JSON.stringify(specArg(spec)) + ')');
    return (Array.isArray(data) ? data : []).slice(0, Math.min(Math.max(count, 1), 20)).map((r) => ({
        url: String(r.url ?? ''),
        title: String(r.title ?? ''),
        ...r.snippet ? { snippet: String(r.snippet) } : {},
    }));
}
//# sourceMappingURL=platform-search.js.map