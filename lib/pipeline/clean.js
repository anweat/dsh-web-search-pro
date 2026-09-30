/**
 * Page-UI noise stripping for evidence excerpts (dev-plan M2c). Extracted page
 * text carries the labels of copy buttons, language tabs and collapsers as
 * standalone lines (`JS`, `COPY`, `CJS`, `复制代码`, `展开` ...). They waste
 * excerpt budget and confuse the reader, so excerpts are built from a cleaned
 * copy of the block text. `Block.text` itself stays raw: it is an exact slice of
 * the page text (see blocks.ts) and is what scorers and `expand` work with.
 *
 * Conservative by construction: a line is dropped only when, after trimming,
 * it consists solely of labels from `UI_LABELS` (so `CJS MJS` goes, a sentence
 * that merely contains the word "copy" stays); lines with digits are never
 * labels; fenced code blocks are left untouched.
 * @module web-search-pro/pipeline/clean
 */
/** Standalone UI labels, lower-cased; matching is case-insensitive and ignores surrounding whitespace / trailing colon. */
export const UI_LABELS = new Set([
    // code-block tabs and copy buttons
    'js', 'cjs', 'mjs', 'copy', 'copy code', 'copied', 'copied!', 'copy to clipboard', 'copy link', 'copy page',
    '复制', '复制代码', '复制成功', '已复制', '复制链接',
    // collapsers and pagination chrome
    'show more', 'show less', 'read more', 'expand', 'collapse', 'expand all', 'collapse all', 'view more', 'see more',
    '展开', '收起', '展开全部', '收起全部', '展开更多', '查看更多', '阅读更多', '显示更多', '更多',
    // page chrome
    'skip to content', 'skip to main content', 'back to top', 'edit this page', 'on this page', 'table of contents',
    '返回顶部', '回到顶部', '编辑此页', '本页目录',
]);
const FENCE = /^\s{0,3}(`{3,}|~{3,})/;
function isLabelLine(line) {
    const t = line.trim().replace(/[:：]$/, '').trim().toLowerCase();
    if (!t || t.length > 40)
        return false;
    if (UI_LABELS.has(t))
        return true;
    // Several labels on one line ("CJS MJS", "JS COPY"): every whitespace-separated token is a label.
    const tokens = t.split(/\s+/);
    return tokens.length > 1 && tokens.every(tok => UI_LABELS.has(tok));
}
/**
 * Drop standalone UI-label lines and collapse runs of blank lines to one.
 * Lines inside fenced code blocks are never touched. Returns trimmed text.
 */
export function stripUiNoise(text) {
    const out = [];
    let fence;
    let blank = false;
    for (const line of text.split('\n')) {
        const f = FENCE.exec(line);
        if (fence) {
            out.push(line);
            if (f && f[1][0] === fence[0] && f[1].length >= fence.length && line.trim() === f[1])
                fence = undefined;
            continue;
        }
        if (f) {
            fence = f[1];
            blank = false;
            out.push(line);
            continue;
        }
        if (isLabelLine(line))
            continue;
        if (!line.trim()) {
            if (blank)
                continue;
            blank = true;
            out.push('');
            continue;
        }
        blank = false;
        out.push(line.replace(/\s+$/, ''));
    }
    return out.join('\n').trim();
}
//# sourceMappingURL=clean.js.map