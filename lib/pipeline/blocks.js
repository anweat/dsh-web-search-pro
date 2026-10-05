/**
 * Block splitter: turns extracted page text into stable, addressable blocks
 * (dev-plan §4.3 S5: "按结构分块，保留标题层级"). Pure and dependency-free.
 *
 * Rules:
 * - Fenced code blocks and Markdown tables are atomic: never split, never
 *   merged across their boundary when that would exceed `maxChars`.
 * - Headings (Markdown `#`, setext, or — for the plain text that
 *   `extractText` emits, which carries no heading markers — a conservative
 *   heuristic) start a new section. The heading line is kept inside the first
 *   block of its section, and every block carries the heading path
 *   (`A > B`), so no text is ever dropped by a wrong heading guess.
 * - Consecutive paragraphs are packed up to `maxChars`; an oversized
 *   paragraph is cut at line, then sentence (CJK and Latin), then hard limits.
 * - Invariant: `block.text === text.slice(block.start, block.end)` (trimmed),
 *   and `blockId = 'b_' + sha1(url + ':' + start)`, so the same page text
 *   always yields the same ids.
 * @module web-search-pro/pipeline/blocks
 */
import crypto from 'node:crypto';
import { IDF_FLOOR, termsOf, weightedOverlap } from "./lexical.js";
const FENCE_OPEN = /^\s{0,3}(`{3,}|~{3,})/;
const MD_HEADING = /^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$/;
const SETEXT_UNDERLINE = /^\s{0,3}(=+|-{2,})\s*$/;
const TABLE_LINE = /^\s*\|.*\|?\s*$/;
const LIST_MARKER = /^\s*([-*+•·]|\d+[.)、])\s/;
const CJK = /[぀-ヿ㐀-䶿一-鿿가-힯豈-﫿]/g;
const TERMINAL_PUNCT = /[。.!?！？；;:：，,、]$/;
const SENTENCE_END = /(?:[。！？；]+|[.!?;]+(?=\s|$))["”'’）)]*\s*/g;
const NUMBERED_HEADING = /^(\d+(?:\.\d+)+)[.、]?\s+\S/;
const CN_HEADING = /^(第[一二三四五六七八九十百零\d]+([章节部分篇条])|[一二三四五六七八九十]+、)\s*\S/;
const sha1 = (input) => crypto.createHash('sha1').update(input).digest('hex');
/** Length where a CJK character counts double (roughly its visual width). */
function visualLen(s) {
    const cjk = s.match(CJK)?.length ?? 0;
    return s.length - cjk + cjk * 2;
}
function toLines(text) {
    const lines = [];
    let pos = 0;
    while (pos <= text.length) {
        let nl = text.indexOf('\n', pos);
        if (nl < 0)
            nl = text.length;
        let end = nl;
        if (end > pos && text[end - 1] === '\r')
            end--;
        lines.push({ start: pos, end, text: text.slice(pos, end) });
        pos = nl + 1;
    }
    return lines;
}
/** Level for a heuristic heading line, or 0 when the line does not look like one. */
function headingLevelGuess(line, below, next, prev) {
    // A heading is its own paragraph: the line after it is blank. This rejects the
    // first line of a hard-wrapped paragraph (HTML text nodes keep source newlines).
    if (below === undefined || below.trim() !== '')
        return 0;
    const t = line.trim();
    if (t.length < 2 || visualLen(t) > 80)
        return 0;
    if (TERMINAL_PUNCT.test(t))
        return 0;
    if (/[。！？]/.test(t) || /\.\s/.test(t) || t.includes('`') || t.includes('](') || /https?:\/\//.test(t))
        return 0;
    if (t.startsWith('|') || /^v\d+\.\d+/.test(t))
        return 0;
    let level = 2;
    const numbered = NUMBERED_HEADING.exec(t);
    const cn = CN_HEADING.exec(t);
    if (numbered)
        level = Math.min(6, numbered[1].split('.').length + 1);
    else if (cn)
        level = cn[2] === '章' ? 1 : 2;
    else if (LIST_MARKER.test(t))
        return 0;
    // The next paragraph must be clearly body text, and the previous line must
    // have ended (blank line or sentence punctuation).
    if (next === undefined)
        return 0;
    const nextTrim = next.trim();
    if (!FENCE_OPEN.test(next) && !nextTrim.startsWith('|') && visualLen(nextTrim) < 50)
        return 0;
    if (prev !== undefined && prev.trim() && !TERMINAL_PUNCT.test(prev.trim()))
        return 0;
    return level;
}
function buildUnits(text, inferHeadings) {
    const lines = toLines(text);
    const units = [];
    let run = [];
    const flushRun = () => {
        if (!run.length)
            return;
        units.push({ kind: 'text', start: run[0].start, end: run[run.length - 1].end, lines: run });
        run = [];
    };
    const nextNonBlank = (from) => {
        for (let j = from; j < lines.length; j++)
            if (lines[j].text.trim())
                return lines[j].text;
        return undefined;
    };
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const trimmed = line.text.trim();
        if (!trimmed) {
            flushRun();
            continue;
        }
        const fence = FENCE_OPEN.exec(line.text);
        if (fence) {
            flushRun();
            const marker = fence[1];
            let j = i + 1;
            const closer = new RegExp('^\\s{0,3}' + (marker[0] === '`' ? '`' : '~') + '{' + marker.length + ',}\\s*$');
            while (j < lines.length && !closer.test(lines[j].text))
                j++;
            const last = Math.min(j, lines.length - 1);
            units.push({ kind: 'atomic', start: line.start, end: lines[last].end });
            i = last;
            continue;
        }
        if (TABLE_LINE.test(line.text) && trimmed.startsWith('|')) {
            flushRun();
            let j = i;
            while (j + 1 < lines.length && lines[j + 1].text.trim().startsWith('|'))
                j++;
            units.push({ kind: 'atomic', start: line.start, end: lines[j].end });
            i = j;
            continue;
        }
        const md = MD_HEADING.exec(line.text);
        if (md) {
            flushRun();
            units.push({ kind: 'heading', level: md[1].length, title: md[2].trim(), start: line.start, end: line.end });
            continue;
        }
        const below = lines[i + 1];
        if (run.length === 0 && below && SETEXT_UNDERLINE.test(below.text) && !LIST_MARKER.test(line.text)) {
            units.push({ kind: 'heading', level: below.text.trim().startsWith('=') ? 1 : 2, title: trimmed, start: line.start, end: below.end });
            i++;
            continue;
        }
        if (inferHeadings) {
            const prevLine = i > 0 ? lines[i - 1].text : undefined;
            const level = headingLevelGuess(line.text, below?.text, nextNonBlank(i + 1), prevLine);
            if (level > 0) {
                flushRun();
                units.push({ kind: 'heading', level, title: trimmed, start: line.start, end: line.end });
                continue;
            }
        }
        run.push(line);
    }
    flushRun();
    return units;
}
/** Cut one oversized text unit into ranges of at most `max`: lines first, then sentences, then hard cuts. */
function splitLong(unit, text, max) {
    const pieces = [];
    let cur;
    const push = (start, end) => {
        if (cur && end - cur.start <= max)
            cur.end = end;
        else {
            if (cur)
                pieces.push(cur);
            cur = { start, end };
        }
    };
    for (const line of unit.lines) {
        if (line.end - line.start <= max) {
            push(line.start, line.end);
            continue;
        }
        // A single over-long line: sentence boundaries, then hard cuts.
        const cuts = [];
        SENTENCE_END.lastIndex = 0;
        for (let m = SENTENCE_END.exec(line.text); m; m = SENTENCE_END.exec(line.text)) {
            if (m[0].length === 0) {
                SENTENCE_END.lastIndex++;
                continue;
            }
            cuts.push(line.start + m.index + m[0].length);
        }
        if (cuts[cuts.length - 1] !== line.end)
            cuts.push(line.end);
        let from = line.start;
        for (const cut of cuts) {
            let segStart = from;
            while (cut - segStart > max) {
                let hard = segStart + max;
                const code = text.charCodeAt(hard - 1);
                if (code >= 0xd800 && code <= 0xdbff)
                    hard--;
                push(segStart, hard);
                if (cur && cur.end - cur.start >= max) {
                    pieces.push(cur);
                    cur = undefined;
                }
                segStart = hard;
            }
            push(segStart, cut);
            from = cut;
        }
    }
    if (cur)
        pieces.push(cur);
    return pieces;
}
/**
 * Split page text into blocks.
 * @param text - extracted page text (Markdown-ish or plain).
 * @param url - page URL; part of every blockId.
 */
export function splitBlocks(text, url, options = {}) {
    const max = Math.max(options.maxChars ?? 1200, 10);
    const min = Math.min(options.minChars ?? 300, max);
    const units = buildUnits(text, options.inferHeadings ?? true);
    const blocks = [];
    const stack = [];
    const pathOf = () => stack.length ? stack.map(h => h.title).join(' > ') : undefined;
    let cur;
    let pendingHeading;
    const emit = (start, end, heading) => {
        while (start < end && /\s/.test(text[start]))
            start++;
        while (end > start && /\s/.test(text[end - 1]))
            end--;
        if (start >= end)
            return;
        const body = text.slice(start, end);
        blocks.push({
            blockId: 'b_' + sha1(url + ':' + start).slice(0, 12),
            ...heading ? { heading } : {},
            text: body,
            start,
            end,
            hash: sha1(body).slice(0, 16),
        });
    };
    const flush = () => {
        if (cur)
            emit(cur.start, cur.end, cur.heading);
        cur = undefined;
    };
    const add = (start, end, atomic) => {
        const size = end - start;
        if (cur && cur.end - cur.start + size > max && (atomic || cur.end - cur.start >= min))
            flush();
        if (!cur) {
            cur = { start: pendingHeading?.start ?? start, end, heading: pathOf() };
            pendingHeading = undefined;
        }
        else
            cur.end = end;
    };
    for (const unit of units) {
        if (unit.kind === 'heading') {
            flush();
            while (stack.length && stack[stack.length - 1].level >= unit.level)
                stack.pop();
            stack.push({ level: unit.level, title: unit.title.slice(0, 120) });
            pendingHeading = { start: unit.start };
            continue;
        }
        if (unit.kind === 'atomic') {
            add(unit.start, unit.end, true);
            continue;
        }
        if (unit.end - unit.start > max) {
            for (const piece of splitLong(unit, text, max))
                add(piece.start, piece.end, false);
        }
        else
            add(unit.start, unit.end, false);
    }
    flush();
    if (pendingHeading) {
        // Trailing heading with no content: keep it addressable.
        const last = units[units.length - 1];
        if (last?.kind === 'heading')
            emit(last.start, last.end, pathOf());
    }
    return blocks;
}
/** The text S6 scores and the pre-ranker reads: heading path, newline, block text. */
export function blockScoringText(block) {
    return (block.heading ? block.heading + '\n' : '') + block.text;
}
/** Default blocks per need that reach S6 (the r1 setting). */
export const PRERANK_DEFAULT = 12;
/** Upper bound of the adaptive pre-rank size. */
export const PRERANK_MAX = 24;
/** Pages with more blocks than this get a larger pre-rank. */
export const PRERANK_LONG_PAGE = 80;
/**
 * Blocks per need that reach S6: 12 normally, growing by one per 10 blocks of
 * the longest page beyond 80, bounded at 24 (a long reference page has many
 * sections and the right one is easier to miss in a short list).
 */
export function adaptivePreRankLimit(longestPageBlocks) {
    if (longestPageBlocks <= PRERANK_LONG_PAGE)
        return PRERANK_DEFAULT;
    return Math.min(PRERANK_MAX, PRERANK_DEFAULT + Math.ceil((longestPageBlocks - PRERANK_LONG_PAGE) / 10));
}
/**
 * Pre-rank blocks for one need: weighted lexical overlap of the need (x1.6) and
 * the query (x1.0) with heading + text, best first, ties in input order. Each
 * term's weight is scaled by an IDF-like factor over the ranked blocks, so a
 * term that nearly every block contains (`DatabaseSync` on the node:sqlite
 * page) counts much less than a distinctive one (`timeout`, `options`).
 * Terms no block contains carry no information and are left out of the score.
 * With fewer than 4 blocks there is no statistics to speak of and the plain
 * r1 overlap is used.
 */
export function preRankBlocks(need, query, blocks, limit) {
    const parts = [{ text: need.text, weight: 1.6 }, { text: query, weight: 1 }];
    const scored = blocks.length < 4
        ? blocks.map((item, pos) => ({ item, pos, score: weightedOverlap(parts, blockScoringText(item)) }))
        : idfScores(parts, blocks);
    return scored
        .sort((a, b) => b.score - a.score || a.pos - b.pos)
        .slice(0, Math.max(limit, 0))
        .map(({ item, score }) => ({ item, score }));
}
function idfScores(parts, blocks) {
    const docs = blocks.map(b => termsOf(blockScoringText(b)));
    const query = new Map();
    for (const part of parts) {
        for (const [term, w] of termsOf(part.text)) {
            const weight = w * part.weight;
            if ((query.get(term) ?? 0) < weight)
                query.set(term, weight);
        }
    }
    const n = docs.length;
    const idfMax = Math.log(1 + (n - 0.5) / 1.5);
    const weights = new Map();
    let total = 0;
    for (const [term, base] of query) {
        let df = 0;
        for (const d of docs)
            if (d.has(term))
                df++;
        if (df === 0)
            continue;
        const idf = Math.log(1 + (n - df + 0.5) / (df + 0.5)) / idfMax;
        const w = base * (IDF_FLOOR + (1 - IDF_FLOOR) * idf);
        weights.set(term, w);
        total += w;
    }
    return blocks.map((item, pos) => {
        let hit = 0;
        for (const [term, w] of weights)
            if (docs[pos].has(term))
                hit += w;
        return { item, pos, score: total === 0 ? 0 : hit / total };
    });
}
//# sourceMappingURL=blocks.js.map