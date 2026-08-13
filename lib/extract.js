/**
 * Userscript-style page extraction ("脚本猫/油猴" inspired): declarative
 * per-hostname rules (content + removal selectors) applied over a jsdom
 * parse, with generic readability fallbacks and a DOM→text walker.
 * Built-in rules cover common Chinese/global sites; users can add persistent
 * rules through the web_rule tool (stored in SQLite).
 * @module web-search-pro/extract
 */
import { jsdom } from "./util.js";
/** Backtick character (kept in a constant so fenced code blocks stay readable). */
const BT = String.fromCharCode(96);
/** Built-in extraction rules, applied after user rules (user rules win). */
export const BUILTIN_RULES = [
    { hostname: 'zhihu.com', contentSelectors: ['.RichContent-inner', '.RichText', 'article'] },
    { hostname: 'bilibili.com', contentSelectors: ['#v_desc', '.article-content', '.article-container', 'article'] },
    { hostname: 'xiaohongshu.com', contentSelectors: ['#detail-desc', '.note-content', '.note-text', 'article'] },
    { hostname: 'weibo.com', contentSelectors: ['.WB_text', '.woo-box-flex', 'article'] },
    { hostname: 'weibo.cn', contentSelectors: ['.ctt', 'article'] },
    { hostname: 'github.com', contentSelectors: ['article.markdown-body', '.markdown-body', 'main'] },
    { hostname: 'juejin.cn', contentSelectors: ['.article-content', 'article'] },
    { hostname: 'csdn.net', contentSelectors: ['#content_views', 'article'] },
    { hostname: 'medium.com', contentSelectors: ['article'] },
    { hostname: 'wikipedia.org', contentSelectors: ['#mw-content-text'] },
    { hostname: 'stackoverflow.com', contentSelectors: ['.post-text', 'article'] },
    { hostname: 'douban.com', contentSelectors: ['.note', '#link-report', 'article'] },
    { hostname: 'youtube.com', contentSelectors: ['#description-inline-expander', '#description'] },
    { hostname: 'v2ex.com', contentSelectors: ['.topic_content', '.markdown_body'] },
    { hostname: '36kr.com', contentSelectors: ['article'] },
    { hostname: 'sspai.com', contentSelectors: ['article'] },
    { hostname: 'ithome.com', contentSelectors: ['#paragraph', 'article'] },
    { hostname: 'huxiu.com', contentSelectors: ['#article_content', 'article'] },
];
/** Normalize a hostname for matching (strip www. and port). */
export function normalizeHost(hostname) {
    return hostname.replace(/^www\./i, '').toLowerCase();
}
/**
 * Find the best rule for a hostname: longest suffix match against user +
 * built-in rules.
 */
export function matchRule(hostname, rules) {
    const host = normalizeHost(hostname);
    let best;
    let bestLen = -1;
    for (const rule of rules) {
        const r = normalizeHost(rule.hostname);
        if ((host === r || host.endsWith('.' + r)) && r.length > bestLen) {
            best = rule;
            bestLen = r.length;
        }
    }
    return best;
}
/** Elements treated as block separators during text walking. */
const BLOCK_TAGS = new Set([
    'P', 'DIV', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'LI', 'UL', 'OL', 'TABLE', 'TR',
    'BLOCKQUOTE', 'SECTION', 'ARTICLE', 'HEADER', 'FOOTER', 'FIGURE', 'FIGCAPTION',
    'PRE', 'BR', 'HR', 'TD', 'TH', 'MAIN', 'ASIDE', 'DL', 'DT', 'DD',
]);
/** Elements skipped entirely during extraction. */
const SKIP_TAGS = new Set([
    'SCRIPT', 'STYLE', 'NOSCRIPT', 'SVG', 'IFRAME', 'TEMPLATE', 'VIDEO', 'AUDIO',
    'BUTTON', 'INPUT', 'SELECT', 'TEXTAREA', 'NAV', 'FORM', 'META', 'LINK',
]);
/** Convert one DOM element subtree to readable text. */
function elementToText(node, depth) {
    if (depth > 40)
        return '';
    if (node.nodeType === 3) { // text node
        return node.textContent ?? '';
    }
    if (node.nodeType !== 1)
        return '';
    const tag = (node.tagName ?? '').toUpperCase();
    if (SKIP_TAGS.has(tag))
        return '';
    if (tag === 'PRE') {
        const code = (node.textContent ?? '').replace(/^\n+|\n+$/g, '');
        return '\n' + BT.repeat(3) + '\n' + code + '\n' + BT.repeat(3) + '\n';
    }
    if (tag === 'CODE') {
        return BT + (node.textContent ?? '') + BT;
    }
    if (tag === 'A') {
        const text = (node.textContent ?? '').trim();
        const href = node.getAttribute?.('href') ?? '';
        if (!text)
            return '';
        if (/^https?:\/\//i.test(href) && href.length < 300)
            return '[' + text + '](' + href + ')';
        return text;
    }
    if (tag === 'IMG') {
        const alt = node.getAttribute?.('alt');
        return alt ? '[图片: ' + alt + ']' : '';
    }
    let out = '';
    const children = node.childNodes ?? [];
    for (let i = 0; i < children.length; i++) {
        out += elementToText(children[i], depth + 1);
    }
    if (BLOCK_TAGS.has(tag))
        out = '\n' + out + '\n';
    return out;
}
/** Pick the main content element: rule selectors first, then generic heuristics. */
function pickContent(document, rule) {
    if (rule && rule.contentSelectors.length) {
        for (const sel of rule.contentSelectors) {
            try {
                const el = document.querySelector(sel);
                if (el && (el.textContent ?? '').trim().length > 40)
                    return el;
            }
            catch { /* invalid selector */ }
        }
    }
    const candidates = ['article', 'main', '[role="main"]', '[itemprop="articleBody"]', '.article-content', '.post-content', '.rich_media_content', '#js_content'];
    for (const sel of candidates) {
        try {
            const el = document.querySelector(sel);
            if (el && (el.textContent ?? '').trim().length > 60)
                return el;
        }
        catch { /* invalid selector */ }
    }
    const body = document.body;
    if (body) {
        const text = (body.textContent ?? '').trim();
        if (text.length > 60)
            return body;
    }
    return undefined;
}
/** Try JSON-LD articleBody as the extraction source. */
function jsonLdBody(document) {
    const scripts = document.querySelectorAll('script[type="application/ld+json"]');
    for (const s of scripts) {
        try {
            const data = JSON.parse(s.textContent ?? '');
            const list = Array.isArray(data) ? data : [data];
            for (const item of list) {
                const body = item?.articleBody;
                if (typeof body === 'string' && body.trim().length > 60)
                    return body;
            }
        }
        catch { /* not JSON */ }
    }
    return undefined;
}
/**
 * Extract readable text + title from an HTML document.
 * @param html - raw HTML.
 * @param url - page URL (for hostname rule matching).
 * @param rules - merged rule list (user rules first, built-ins appended).
 * @param maxChars - output cap.
 */
export function extractText(html, url, rules, maxChars = 200_000) {
    let dom;
    try {
        dom = new jsdom(html, { url });
    }
    catch {
        return { title: '', text: stripRough(html).slice(0, maxChars), usedRule: undefined };
    }
    const document = dom.window.document;
    let title = document.title?.trim() ?? '';
    const og = document.querySelector('meta[property="og:title"]');
    if (og?.content && og.content.trim().length > title.length)
        title = og.content.trim();
    const h1 = document.querySelector('h1');
    if (h1 && !title && (h1.textContent ?? '').trim())
        title = h1.textContent.trim();
    let host = '';
    try {
        host = new URL(url).hostname;
    }
    catch { /* ignore */ }
    const rule = matchRule(host, rules);
    let text = '';
    const ld = jsonLdBody(document);
    if (ld) {
        text = ld;
    }
    else {
        const content = pickContent(document, rule);
        if (content) {
            if (rule?.removeSelectors) {
                for (const sel of rule.removeSelectors) {
                    try {
                        content.querySelectorAll(sel).forEach((el) => el.remove());
                    }
                    catch { /* ignore */ }
                }
            }
            if (!rule) {
                for (const sel of ['nav', 'aside', 'footer', 'form', 'script', 'style']) {
                    try {
                        content.querySelectorAll(sel).forEach((el) => el.remove());
                    }
                    catch { /* ignore */ }
                }
            }
            text = elementToText(content, 0);
        }
        else {
            text = '';
        }
    }
    const cleaned = text
        .replace(/\n{3,}/g, '\n\n')
        .replace(/[ \t]+\n/g, '\n')
        .trim();
    return { title, text: cleaned.slice(0, maxChars), usedRule: rule?.hostname };
}
/** Minimal tag stripping for non-HTML fallback paths. */
function stripRough(html) {
    return html
        .replace(/<script[\s\S]*?<\/script>/gi, ' ')
        .replace(/<style[\s\S]*?<\/style>/gi, ' ')
        .replace(/<[^>]*>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}
/** Extract titles + links from HTML search result lists (generic). */
export function extractResultLinks(html) {
    const out = [];
    const anchorRe = /<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
    let m;
    while ((m = anchorRe.exec(html)) !== null) {
        const href = m[1];
        const inner = stripTags(m[2]).replace(/\s+/g, ' ').trim();
        if (!/^https?:\/\//i.test(href) || inner.length < 4)
            continue;
        out.push({ title: inner, url: href });
        if (out.length >= 50)
            break;
    }
    return out;
}
import { stripTags } from "./util.js";
//# sourceMappingURL=extract.js.map