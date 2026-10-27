/**
 * Candidate merging (dev-plan M2a S3, design §6.1): provider outputs become
 * one Candidate per canonical URL. Every (provider, rank, query) contribution
 * is kept; title and snippet are the most complete ones seen, with
 * complementary snippets joined inside a character cap.
 * @module web-search-pro/pipeline/candidates
 */
import crypto from 'node:crypto';
import { termsOf } from "./lexical.js";
import { canonicalizeUrl } from "./url.js";
/** Same cap as `shapeSources` applies to outgoing snippets (util.ts SNIPPET_MAX_CHARS). */
export const SNIPPET_JOIN_CAP = 500;
const SNIPPET_SEPARATOR = ' … ';
/** Less than this much room left: do not append a truncated stub. */
const MIN_APPEND_CHARS = 40;
/** Share of a snippet's terms already present in the other before it counts as a repeat. */
const REPEAT_OVERLAP = 0.8;
export function candidateIdOf(canonical) {
    return 'c_' + crypto.createHash('sha1').update(canonical).digest('hex').slice(0, 12);
}
const squash = (text) => text.replace(/\s+/g, ' ').trim();
function overlapOf(a, b) {
    const ta = termsOf(a);
    const tb = termsOf(b);
    if (!ta.size || !tb.size)
        return 0;
    let hit = 0;
    for (const t of ta.keys())
        if (tb.has(t))
            hit++;
    return hit / Math.min(ta.size, tb.size);
}
/** Fold snippet `next` into `current`: drop repeats, keep the longer of near-duplicates, join complements within `cap`. */
export function mergeSnippets(current, next, cap = SNIPPET_JOIN_CAP) {
    const n = squash(next ?? '');
    if (!n)
        return current;
    if (!current)
        return n;
    const cl = current.toLowerCase();
    const nl = n.toLowerCase();
    if (cl.includes(nl))
        return current;
    if (nl.includes(cl))
        return n;
    if (overlapOf(current, n) >= REPEAT_OVERLAP)
        return n.length > current.length ? n : current;
    const room = cap - current.length - SNIPPET_SEPARATOR.length;
    if (room >= n.length)
        return current + SNIPPET_SEPARATOR + n;
    if (room >= MIN_APPEND_CHARS) {
        const cut = n.slice(0, room - 1);
        const space = cut.lastIndexOf(' ');
        return current + SNIPPET_SEPARATOR + (space >= MIN_APPEND_CHARS / 2 ? cut.slice(0, space) : cut) + '…';
    }
    return current;
}
/**
 * What a result says about where it came from, for the exit: the custom CLIs that returned it (`via`) with their honest label (`tag`),
 * and `confidence` = the best confidence among the providers that returned it, only when it is below 1 (a URL a full-confidence
 * source also returned is as sure as that source). Empty for a result of built-in sources only.
 */
export function provenanceOf(candidate) {
    const best = candidate.contributions.length ? Math.max(...candidate.contributions.map(c => c.confidence ?? 1)) : 1;
    return {
        ...candidate.origin?.via.length ? { via: candidate.origin.via.join(', ') } : {},
        ...candidate.origin?.tag ? { tag: candidate.origin.tag } : {},
        ...best < 1 ? { confidence: Math.round(best * 10_000) / 10_000 } : {},
    };
}
/**
 * Merge provider outputs into candidates keyed by canonical URL, in first-seen
 * order (outputs in the given order, sources by rank). Sources without a URL
 * are skipped; their rank positions still count.
 */
export function mergeCandidates(outputs, options = {}) {
    const cap = options.snippetMaxChars ?? SNIPPET_JOIN_CAP;
    const byKey = new Map();
    for (const output of outputs) {
        output.sources.forEach((source, index) => {
            const url = source.url?.trim();
            if (!url)
                return;
            const key = canonicalizeUrl(url);
            let candidate = byKey.get(key);
            if (!candidate) {
                candidate = { candidateId: candidateIdOf(key), canonicalUrl: key, url, title: '', snippet: '', contributions: [] };
                byKey.set(key, candidate);
            }
            const confidence = typeof source.confidence === 'number' && Number.isFinite(source.confidence) && source.confidence < 1 ? Math.max(source.confidence, 0) : undefined;
            candidate.contributions.push({ providerId: output.providerId, rank: index + 1, query: output.query, ...confidence !== undefined ? { confidence } : {} });
            if (source.via) {
                const origin = candidate.origin ?? (candidate.origin = { via: [], tag: source.tag || '' });
                if (!origin.via.includes(source.via))
                    origin.via.push(source.via);
                if (!origin.tag && source.tag)
                    origin.tag = source.tag;
            }
            const title = squash(source.title ?? '');
            if (title.length > candidate.title.length)
                candidate.title = title;
            candidate.snippet = mergeSnippets(candidate.snippet, source.snippet, cap);
            if (!candidate.publishedAt && source.publishedAt)
                candidate.publishedAt = source.publishedAt;
            // Provider quality signals: the best one seen for the URL (a URL several providers return keeps the strongest grade, never a sum).
            if (typeof source.rerankScore === 'number' && Number.isFinite(source.rerankScore))
                candidate.signals = { ...candidate.signals, rerankScore: Math.max(candidate.signals?.rerankScore ?? 0, source.rerankScore) };
            if (typeof source.authority === 'number' && Number.isFinite(source.authority) && source.authority >= 0)
                candidate.signals = { ...candidate.signals, authority: Math.max(candidate.signals?.authority ?? 0, source.authority) };
        });
    }
    return [...byKey.values()];
}
//# sourceMappingURL=candidates.js.map