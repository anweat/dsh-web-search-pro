/**
 * Lexical helpers shared by the S3/S4 rule gate, query compilation, the bench
 * rule judge, the block pre-ranker and the labeler: Chinese via character
 * bigrams, Latin via lowercase word tokens. Ported from bench/judges/lexical
 * (the r1 experiment); thresholds calibrated on it only hold while this
 * tokenisation stays unchanged, so edit with `bench/src/eval-gate.ts` at hand.
 * @module web-search-pro/pipeline/lexical
 */
const HAN_RUN = /\p{Script=Han}+/gu;
const LATIN_WORD = /[a-z0-9][a-z0-9_.:+#/-]*[a-z0-9+#]|[a-z0-9]/g;
const SPLIT_PARTS = /[._:/-]+/;
/** Chinese function characters; bigrams containing them carry no topical signal. */
export const HAN_STOP = new Set('的了是在和与及或吗呢么就也都而把被让对从向为有要能会可以这那个些什如何怎么样请问'.split(''));
export const LATIN_STOP = new Set(('the a an of to in for and or is are was were be been how what which who when where why with on by from as at it its this that these those do does did can could ' +
    'use using used should would will i you we they your my our not no vs via about into than then there here also more most some any all if but so').split(' '));
/** Distinct terms of a text with intrinsic weights (longer / digit-bearing terms weigh more). */
export function termsOf(text) {
    const out = new Map();
    const add = (term, weight) => {
        if (!out.has(term) || out.get(term) < weight)
            out.set(term, weight);
    };
    for (const run of text.match(HAN_RUN) ?? []) {
        const chars = [...run];
        if (chars.length === 1) {
            if (!HAN_STOP.has(chars[0]))
                add(chars[0], 0.5);
            continue;
        }
        for (let i = 0; i + 1 < chars.length; i++) {
            if (HAN_STOP.has(chars[i]) || HAN_STOP.has(chars[i + 1]))
                continue;
            add(chars[i] + chars[i + 1], 1);
        }
    }
    for (const word of text.toLowerCase().match(LATIN_WORD) ?? []) {
        const weightOf = (w) => (/\d/.test(w) ? 1.5 : Math.min(2, 0.5 + w.length / 6));
        if (!LATIN_STOP.has(word) && (word.length >= 2 || /\d/.test(word)))
            add(word, weightOf(word));
        const parts = word.split(SPLIT_PARTS).filter(p => p && (p.length >= 2 || /\d/.test(p)) && !LATIN_STOP.has(p));
        if (parts.length > 1)
            for (const p of parts)
                add(p, weightOf(p) * 0.7);
    }
    return out;
}
/** Merged query terms: the best `intrinsic weight * part weight` per term. */
export function mergedTerms(parts) {
    const merged = new Map();
    for (const part of parts) {
        for (const [term, w] of termsOf(part.text)) {
            const weight = w * part.weight;
            if ((merged.get(term) ?? 0) < weight)
                merged.set(term, weight);
        }
    }
    return merged;
}
/** Weighted fraction of query terms present in `doc` (0..1). Term weight = part weight * intrinsic weight. */
export function weightedOverlap(parts, doc) {
    const docTerms = termsOf(doc);
    const merged = mergedTerms(parts);
    let total = 0;
    let hit = 0;
    for (const [term, weight] of merged) {
        total += weight;
        if (docTerms.has(term))
            hit += weight;
    }
    return total === 0 ? 0 : hit / total;
}
/** Floor of the IDF factor: a term present in every block still counts this much of its weight. */
export const IDF_FLOOR = 0.2;
/** A matched term is distinctive when its normalised IDF (0..1, as used for the weight) reaches this: at most about 14% of the blocks of a 117-block page, 25% of 12. */
export const DISTINCT_IDF = 0.45;
/** Share of a rare term's weight that still counts when the term only occurs inside code (samples), not in prose. */
export const CODE_ONLY_CREDIT = 0.5;
/** ...and of a term that nearly every block has (an identifier every code sample repeats says nothing about the section). */
export const CODE_COMMON_CREDIT = 0.1;
/** Normalised IDF (0..1) of a term found in `df` of `n` blocks, the BM25-style log used by the pre-rank. */
export function idfNorm(df, n) {
    const idf = Math.log(1 + (n - df + 0.5) / (df + 0.5)) / Math.log(1 + (n - 0.5) / 1.5);
    return Math.min(Math.max(idf, 0), 1);
}
/** Credit of a term found only in code: CODE_COMMON_CREDIT when every block has it, rising to CODE_ONLY_CREDIT as it gets rarer. */
export function codeCredit(df, n) {
    return df <= 0 ? CODE_ONLY_CREDIT : CODE_COMMON_CREDIT + (CODE_ONLY_CREDIT - CODE_COMMON_CREDIT) * idfNorm(df, n);
}
/** IDF factor in [IDF_FLOOR, 1] for a term found in `df` of `n` blocks; a term no block contains (`df` = 0) keeps its full weight (it can only ever be a miss). */
export function idfFactor(df, n) {
    if (df <= 0 || n <= 1)
        return 1;
    return IDF_FLOOR + (1 - IDF_FLOOR) * idfNorm(df, n);
}
/** A term that occurs on the page, but in few of its blocks: matching it says something about WHICH block answers. */
export function isDistinctive(df, n) {
    return df >= 1 && n > 1 && idfNorm(df, n) >= DISTINCT_IDF;
}
const FENCE = /^\s{0,3}(`{3,}|~{3,})/;
const CODE_LINE = /^\s*(?:(?:const|let|var|import|export|from|await|async|function|return|class|new|def|fn|use|package)\s|\/\/|\$ |>>> |#include\b)|[;{}]\s*$/;
/**
 * Split block text into prose and code: fenced code blocks plus unfenced
 * lines that look like code (keyword-led, `//` comments, shell prompts, or a
 * line ending in `;` / `{` / `}`). Inline `code` spans inside prose stay prose.
 */
export function splitProseCode(text) {
    const prose = [];
    const code = [];
    let fence;
    for (const line of text.split('\n')) {
        const open = FENCE.exec(line);
        if (fence !== undefined) {
            if (open && open[1][0] === fence[0] && open[1].length >= fence.length && line.trim() === open[1])
                fence = undefined;
            else
                code.push(line);
            continue;
        }
        if (open) {
            fence = open[1];
            continue;
        }
        ;
        (CODE_LINE.test(line) ? code : prose).push(line);
    }
    return { prose: prose.join('\n'), code: code.join('\n') };
}
/**
 * `weightedOverlap` with page statistics: every term's weight is scaled by its
 * IDF factor (terms no block contains keep their weight), and a term found only
 * in code counts {@link CODE_ONLY_CREDIT} of its weight.
 */
export function statsOverlap(parts, doc, stats) {
    const anchors = new Set();
    for (const part of parts)
        if (!part.context)
            for (const term of termsOf(part.text).keys())
                anchors.add(term);
    const { prose, code } = splitProseCode(doc);
    const inProse = termsOf(prose);
    const inCode = termsOf(code);
    let total = 0;
    let hit = 0;
    let distinctiveHit = false;
    let distinctiveAvailable = false;
    for (const [term, base] of mergedTerms(parts)) {
        const df = stats.dfLexical(term);
        const weight = base * idfFactor(df, stats.n);
        const distinct = isDistinctive(df, stats.n) && anchors.has(term);
        total += weight;
        if (distinct)
            distinctiveAvailable = true;
        if (inProse.has(term)) {
            hit += weight;
            if (distinct)
                distinctiveHit = true;
        }
        else if (inCode.has(term)) {
            hit += weight * codeCredit(df, stats.n);
            if (distinct)
                distinctiveHit = true;
        }
    }
    return { relevance: total === 0 ? 0 : hit / total, distinctiveHit, distinctiveAvailable };
}
export function hostOf(url) {
    if (!url)
        return undefined;
    try {
        return new URL(url).hostname.toLowerCase();
    }
    catch {
        return undefined;
    }
}
/** Share of Han characters among letters/ideographs: a cheap zh/en detector. */
export function hanRatio(text) {
    const han = (text.match(/\p{Script=Han}/gu) ?? []).length;
    const latin = (text.match(/[A-Za-z]/g) ?? []).length;
    return han + latin === 0 ? 0 : han / (han + latin);
}
//# sourceMappingURL=lexical.js.map