/**
 * S7 budgeted selection and S8 coverage (dev-plan §4.3, design §6.4).
 *
 * S7 is deterministic: every block gets an excerpt (an intact run of sentences
 * of at most `maxExcerptChars`, chosen for the best need), then blocks are
 * picked in two phases under a total excerpt-character budget:
 *   A. reservation - each critical need that any block supports at grade >= 2
 *      gets its best block first (so a greedy fill cannot starve it);
 *   B. greedy by gain / cost, where a block's gain counts the needs it newly
 *      covers fully, corroboration of covered needs at a discount, and weak
 *      (grade 1) support only for still-uncovered needs; `maxPerUrl` blocks per
 *      URL, repeated hashes and near-duplicate texts are skipped, and further
 *      blocks of a URL already in the pack count less.
 * S8: a need is covered when a selected block has grade >= `coverGrade`; the
 * others become gaps with the reason. Grades are NOT comparable across scorers
 * (rule buckets vs Jev expectation), so all thresholds apply to one scorer's
 * output at a time.
 * @module web-search-pro/pipeline/select
 */
import { termsOf, weightedOverlap } from "./lexical.js";
export const DEFAULT_SELECT_OPTIONS = {
    charBudget: 6000, maxExcerptChars: 600, maxPerUrl: 2, maxItems: 10, minGrade: 1, coverGrade: 2, overheadChars: 80,
};
// ── excerpts ────────────────────────────────────────────────────────────────
const SENTENCE_END = /(?:[。！？；]+|[.!?;]+(?=\s|$))["”'’）)」』]*/g;
const CLAUSE_BREAK = /[,，、;；:：]/;
const NEGATION_TAIL = /(?:不|没有?|无|非|未|别|勿|\b(?:not|no|never|without|cannot|can't|don't|doesn't|isn't|won't))\s*$/i;
/** Ranges of sentences (and lines) of `text`, in order; whitespace between them is not part of any range. */
export function sentenceRanges(text) {
    const ranges = [];
    let pos = 0;
    const push = (start, end) => {
        while (start < end && /\s/.test(text[start]))
            start++;
        while (end > start && /\s/.test(text[end - 1]))
            end--;
        if (end > start)
            ranges.push({ start, end });
    };
    for (const line of text.split('\n')) {
        const lineStart = pos;
        let from = 0;
        SENTENCE_END.lastIndex = 0;
        for (let m = SENTENCE_END.exec(line); m; m = SENTENCE_END.exec(line)) {
            if (m[0].length === 0) {
                SENTENCE_END.lastIndex++;
                continue;
            }
            push(lineStart + from, lineStart + m.index + m[0].length);
            from = m.index + m[0].length;
        }
        push(lineStart + from, lineStart + line.length);
        pos += line.length + 1;
    }
    return ranges;
}
const isDigit = (ch) => ch !== undefined && ch >= '0' && ch <= '9';
/** Cut an oversized single sentence to `max`, preferring a clause boundary, then whitespace; never inside a number, never right after a negation. */
function cutSentence(text, max) {
    let cut = max;
    const window = text.slice(0, max);
    const floor = Math.floor(max * 0.55);
    for (let i = window.length - 1; i >= floor; i--)
        if (CLAUSE_BREAK.test(window[i])) {
            cut = i + 1;
            break;
        }
    if (cut === max) {
        const space = window.lastIndexOf(' ');
        if (space >= floor)
            cut = space;
    }
    while (cut > 1 && isDigit(text[cut - 1]) && isDigit(text[cut]))
        cut--;
    while (cut > 1 && /[0-9.]/.test(text[cut - 1]) && /[0-9]/.test(text[cut] ?? ''))
        cut--;
    let out = text.slice(0, cut).trimEnd();
    for (let guard = 0; guard < 3 && NEGATION_TAIL.test(out); guard++) {
        const m = NEGATION_TAIL.exec(out);
        if (m.index < floor / 2)
            break;
        out = out.slice(0, m.index).trimEnd();
    }
    return out;
}
/**
 * Excerpt of a block text: the whole text when it fits, else the run of
 * consecutive sentences (<= `max` characters) with the most need overlap
 * (earliest on ties); an over-long single sentence is cut at a clause boundary.
 * `…` marks the side(s) that were cut.
 */
export function excerptOf(text, parts, max) {
    const clean = text.trim();
    if (clean.length <= max)
        return clean;
    const ranges = sentenceRanges(clean);
    const scores = ranges.map(r => weightedOverlap(parts, clean.slice(r.start, r.end)));
    let best;
    for (let i = 0; i < ranges.length; i++) {
        let score = 0;
        for (let j = i; j < ranges.length; j++) {
            if (ranges[j].end - ranges[i].start > max)
                break;
            score += scores[j];
            if (!best || score > best.score + 1e-12)
                best = { i, j, score };
        }
    }
    if (!best) {
        // Every single sentence exceeds the cap: take the most relevant one and cut it.
        const i = scores.indexOf(Math.max(...scores, 0));
        const r = ranges[Math.max(i, 0)] ?? { start: 0, end: clean.length };
        return cutSentence(clean.slice(r.start, r.end), max - 1) + '…';
    }
    const start = ranges[best.i].start;
    const end = ranges[best.j].end;
    return (start > 0 ? '…' : '') + clean.slice(start, end) + (end < clean.length ? '…' : '');
}
export function selectEvidence(task, blocks, options = {}) {
    const opt = { ...DEFAULT_SELECT_OPTIONS, ...options };
    const order = new Map(task.needs.map((n, i) => [n.id, i]));
    const entries = [];
    const seenHash = new Map();
    for (const block of blocks) {
        const grades = new Map();
        let best = -1;
        let bestNeed;
        let rank = 0;
        for (const need of task.needs) {
            const g = block.grades.get(need.id);
            if (!g)
                continue;
            grades.set(need.id, g.grade);
            if (g.grade > best || (g.grade === best && need.critical && !bestNeed?.critical)) {
                best = g.grade;
                bestNeed = need;
                rank = g.rank ?? g.grade;
            }
        }
        if (!bestNeed || best < opt.minGrade)
            continue;
        const parts = [{ text: bestNeed.text, weight: 1.6 }, { text: task.query, weight: 1 }];
        const excerpt = excerptOf(block.block.text, parts, opt.maxExcerptChars);
        const needIds = [...grades].filter(([, g]) => g >= opt.minGrade).sort((a, b) => b[1] - a[1] || (order.get(a[0]) ?? 0) - (order.get(b[0]) ?? 0)).map(([id]) => id);
        const entry = { block, excerpt, grades, best, rank, needIds, cost: excerpt.length + opt.overheadChars };
        const twin = seenHash.get(block.block.hash);
        if (twin) {
            // Mirror / repost: keep the better-graded copy only.
            if (entry.best > twin.best) {
                entries[entries.indexOf(twin)] = entry;
                seenHash.set(block.block.hash, entry);
            }
            continue;
        }
        seenHash.set(block.block.hash, entry);
        entries.push(entry);
    }
    const selected = [];
    const chosen = new Set();
    const perUrl = new Map();
    const covered = new Set();
    let used = 0;
    const fits = (e) => !chosen.has(e) && selected.length < opt.maxItems && used + e.excerpt.length <= opt.charBudget && (perUrl.get(e.block.url) ?? 0) < opt.maxPerUrl;
    const duplicate = (e) => {
        const terms = termsOf(e.excerpt);
        if (!terms.size)
            return false;
        for (const s of selected) {
            const other = termsOf(s.excerpt);
            let hit = 0;
            for (const t of terms.keys())
                if (other.has(t))
                    hit++;
            if (hit / Math.min(terms.size, other.size || 1) >= 0.85)
                return true;
        }
        return false;
    };
    const take = (e, reason) => {
        chosen.add(e);
        used += e.excerpt.length;
        perUrl.set(e.block.url, (perUrl.get(e.block.url) ?? 0) + 1);
        selected.push({ block: e.block, excerpt: e.excerpt, needIds: e.needIds, grade: e.best, reason });
        for (const [needId, g] of e.grades)
            if (g >= opt.coverGrade)
                covered.add(needId);
    };
    const gainOf = (e) => {
        let gain = 0;
        for (const need of task.needs) {
            const g = e.grades.get(need.id);
            if (g === undefined)
                continue;
            let c = 0;
            if (covered.has(need.id))
                c = g >= opt.coverGrade ? 0.3 * g / 3 : 0;
            else
                c = g >= opt.coverGrade ? g / 3 : g >= opt.minGrade ? 0.35 * g / 3 : 0;
            gain += c * (need.critical ? 1.5 : 1);
        }
        return gain * 0.85 ** (perUrl.get(e.block.url) ?? 0);
    };
    // A. reservation for critical needs.
    for (const need of task.needs) {
        if (!need.critical || covered.has(need.id))
            continue;
        const uncoveredCritical = task.needs.filter(n => n.critical && !covered.has(n.id));
        const pool = entries
            .filter(e => (e.grades.get(need.id) ?? 0) >= opt.coverGrade && fits(e))
            .sort((a, b) => (b.grades.get(need.id) - a.grades.get(need.id))
            || (uncoveredCritical.filter(n => (b.grades.get(n.id) ?? 0) >= opt.coverGrade).length - uncoveredCritical.filter(n => (a.grades.get(n.id) ?? 0) >= opt.coverGrade).length)
            || (b.rank - a.rank) || (a.cost - b.cost));
        const pick = pool.find(e => !duplicate(e));
        if (pick)
            take(pick, 'reserved');
    }
    // B. greedy by gain / cost.
    for (;;) {
        let bestEntry;
        let bestEff = 0;
        for (const e of entries) {
            if (!fits(e))
                continue;
            const gain = gainOf(e);
            if (gain <= 0)
                continue;
            const eff = gain / e.cost;
            if (eff > bestEff + 1e-12 && !duplicate(e)) {
                bestEntry = e;
                bestEff = eff;
            }
        }
        if (!bestEntry)
            break;
        take(bestEntry, 'greedy');
    }
    return { selected, usedChars: used };
}
export function computeCoverage(input) {
    const cover = input.coverGrade ?? DEFAULT_SELECT_OPTIONS.coverGrade;
    const covered = [];
    const gaps = [];
    for (const need of input.needs) {
        if (input.selected.some(s => (s.block.grades.get(need.id)?.grade ?? 0) >= cover)) {
            covered.push(need.id);
            continue;
        }
        const bestGrade = Math.max(0, ...input.scored.map(b => b.grades.get(need.id)?.grade ?? 0));
        let reason;
        if (!input.keptCandidates)
            reason = 'no_candidates';
        else if (!input.scored.length)
            reason = 'no_page_content';
        else
            reason = bestGrade >= cover ? 'budget' : 'weak_support';
        gaps.push({ needId: need.id, text: need.text, critical: need.critical, reason, ...input.scored.length ? { bestGrade: Number(bestGrade.toFixed(2)) } : {} });
    }
    return { covered, gaps };
}
//# sourceMappingURL=select.js.map