/**
 * S3/S4 rule gate (dev-plan §4.3): deterministic constraint checks plus a
 * lexical relevance gate over title + snippet. Ported from the r1 bench rule
 * judge; one implementation serves the runtime and the bench.
 *
 * Policy (keep recall first, plan §4.3 "unknown -> keep"):
 *  - a hard constraint drops a candidate only on a DEFINITE violation: a site /
 *    exclude_site host mismatch, an excluded term present, or a publication year
 *    before the time window taken from a structured date (publishedAt or a
 *    dated URL path). Everything else keeps the candidate: a must_term / entity
 *    missing from a SNIPPET says little about the page (measured on the r1 data:
 *    dropping on it cut positive recall from 94.6% to ~85%), so those are only
 *    recorded in `checks` until the full text is available (`fullText` option);
 *    absent version strings, language guesses and years merely mentioned in
 *    snippet text are likewise not grounds to drop;
 *  - relevance below the threshold drops it. The default is the drop threshold
 *    calibrated in experiment r1 (rule / gate.relevance.v1, calibration split,
 *    recall of label >= 2 held at 0.95). The threshold belongs to THIS lexical
 *    function: re-derive it with `bench/src/eval-gate.ts` when lexical.ts changes.
 *    Cross-lingual pairs (the needs and the candidate text are in different
 *    languages, e.g. Chinese needs against English titles) are scored with the
 *    M3a alignment of align.ts instead, on the same scale; same-language pairs
 *    keep the calibrated lexical-v1 function untouched;
 *  - soft constraints are recorded in `checks` but never drop;
 *  - floor ({@link applyFloor}): when the gate would leave fewer than `minKeep`
 *    candidates, the best fused ones that were dropped on relevance alone come
 *    back, flagged `lowConfidence`. A pack is never empty because of the
 *    relevance heuristic alone.
 * @module web-search-pro/pipeline/gate
 */
import { alignedRelevance, languagesDiffer } from "./align.js";
import { hanRatio, hostOf, termsOf, weightedOverlap } from "./lexical.js";
/**
 * r1 rule / gate.relevance.v1 drop threshold (calibration-selected 0.12363952982150628,
 * rounded down to 4 places: rounding down can only keep more, never drop a
 * candidate the calibrated value would have kept).
 */
export const DEFAULT_RELEVANCE_THRESHOLD = 0.1236;
const yes = (prob = 1) => ({ satisfied: 'yes', prob });
const no = (prob = 0) => ({ satisfied: 'no', prob });
const unknown = (prob = 0.5) => ({ satisfied: 'unknown', prob });
export function domainOf(value) {
    return value.trim().toLowerCase().replace(/^site:/, '').replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/^www\./, '');
}
export function hostMatches(host, domain) {
    const h = host.replace(/^www\./, '');
    return h === domain || h.endsWith('.' + domain);
}
function versionNumbers(value) {
    return value.match(/\d+(?:\.\d+)*/g) ?? [];
}
function containsVersion(text, version) {
    const escaped = version.replace(/\./g, '\\.');
    return new RegExp('(?<![\\d.])' + escaped + '(?![\\d]|\\.\\d)').test(text);
}
const DATE_SHAPE = /(?<![\d])((?:19|20)\d\d)(?:[-/.](?:0?[1-9]|1[0-2])\b|\s*年\s*\d{1,2}\s*月)/g;
/**
 * Newest year evidenced by an explicit date: publishedAt, then date-shaped
 * strings in url/title/snippet. `structured` is true when the year comes from
 * publishedAt or from the URL (a dated path such as /2024/05/), false when it
 * only appears in snippet text, where it may merely mention another date.
 */
export function knownDate(item, now = new Date()) {
    const published = item.publishedAt;
    if (published) {
        const ts = Date.parse(published);
        if (Number.isFinite(ts))
            return { year: new Date(ts).getUTCFullYear(), structured: true };
        const m = published.match(/(?:19|20)\d\d/);
        if (m)
            return { year: Number(m[0]), structured: true };
    }
    const maxYear = now.getUTCFullYear() + 1;
    const yearsIn = (text) => [...text.matchAll(DATE_SHAPE)].map(m => Number(m[1])).filter(y => y <= maxYear);
    const urlYears = yearsIn(item.url ?? '');
    const textYears = yearsIn((item.title ?? '') + ' ' + item.text);
    const all = [...urlYears, ...textYears];
    if (!all.length)
        return undefined;
    const year = Math.max(...all);
    return { year, structured: urlYears.length > 0 && Math.max(...urlYears) === year };
}
/** Newest year evidenced by an explicit date (see {@link knownDate}). */
export function knownYear(item, now = new Date()) {
    return knownDate(item, now)?.year;
}
/** Rule verdict for one constraint on one candidate. Semantic kinds that rules cannot decide are `unknown`. */
export function checkConstraint(c, item, now = new Date()) {
    const text = (item.title ? item.title + '\n' : '') + item.text;
    const lower = text.toLowerCase();
    const value = c.value.trim();
    switch (c.kind) {
        case 'site':
        case 'exclude_site': {
            const host = hostOf(item.url);
            if (!host)
                return unknown();
            const match = hostMatches(host, domainOf(value));
            return (c.kind === 'site') === match ? yes() : no();
        }
        case 'exclude_term':
            return lower.includes(value.toLowerCase()) ? no() : yes(0.9);
        case 'must_term':
        case 'entity': {
            if (lower.includes(value.toLowerCase()))
                return yes();
            const want = termsOf(value);
            if (want.size === 0)
                return unknown();
            const have = termsOf(text);
            let hit = 0;
            for (const t of want.keys())
                if (have.has(t))
                    hit++;
            const frac = hit / want.size;
            if (frac >= 1)
                return yes(0.95);
            return frac >= 0.5 ? unknown(frac) : no(frac);
        }
        case 'version': {
            const versions = versionNumbers(value);
            if (!versions.length)
                return unknown();
            return versions.some(v => containsVersion(text, v)) ? yes(0.9) : unknown(0.35);
        }
        case 'time_window': {
            const from = Number(value.match(/(?:19|20)\d\d/)?.[0]);
            const known = knownDate(item, now);
            if (!Number.isFinite(from) || known === undefined)
                return unknown();
            return known.year >= from ? { ...yes(0.9), structuredDate: known.structured } : { ...no(0.1), structuredDate: known.structured };
        }
        case 'language': {
            if (text.replace(/\s/g, '').length < 12)
                return unknown();
            const wantZh = /^(zh|cn|中文|汉语|简体)/i.test(value);
            const wantEn = /^(en|english|英文|英语)/i.test(value);
            if (!wantZh && !wantEn)
                return unknown();
            const isZh = hanRatio(text) > 0.2;
            return wantZh === isZh ? yes(0.9) : no(0.1);
        }
        default:
            return unknown();
    }
}
/**
 * Whether a `no` verdict is certain enough to drop on. Deterministic kinds
 * (site, exclude_site, exclude_term) always are; time_window only with a
 * structured date; must_term / entity only when `fullText` says the text
 * checked is the whole page (then: not a single term of it appears); language
 * guesses never are.
 */
export function isDefiniteViolation(c, verdict, fullText = false) {
    if (verdict.satisfied !== 'no')
        return false;
    switch (c.kind) {
        case 'site':
        case 'exclude_site':
        case 'exclude_term': return true;
        case 'time_window': return verdict.structuredDate === true;
        case 'must_term':
        case 'entity': return fullText && verdict.prob === 0;
        default: return false;
    }
}
export function relevanceContextOf(task) {
    return { goal: task.goal, query: task.query, needs: task.needs.map(n => n.text), constraints: task.constraints };
}
function docOf(item) {
    return [item.title, item.heading, item.text].filter(Boolean).join('\n');
}
/** Weighted query parts of the relevance: query, goal, needs and (optionally) entity / must_term values. */
export function relevancePartsOf(ctx, withConstraints) {
    const parts = [{ text: ctx.query, weight: 1 }, { text: ctx.goal, weight: 0.8, context: true }];
    for (const need of ctx.needs)
        parts.push({ text: need, weight: 1.6 });
    if (withConstraints) {
        for (const c of ctx.constraints) {
            if (c.kind === 'entity' || c.kind === 'must_term')
                parts.push({ text: c.value, weight: 1.5 });
        }
    }
    return parts;
}
/** Weighted lexical overlap of query / goal / needs (and optionally entity + must_term values) with the item, 0..1. */
export function lexicalRelevance(ctx, item, withConstraints) {
    return weightedOverlap(relevancePartsOf(ctx, withConstraints), docOf(item));
}
/** The needs are in one language and the item text in another (see align.ts `detectLang`): the pairs the lexical rule cannot score. */
export function isCrossLingual(ctx, item) {
    return languagesDiffer(ctx.needs.join('\n'), docOf(item));
}
/**
 * Relevance the gate compares with its threshold. Same-language pairs: exactly
 * {@link lexicalRelevance} (query + goal + needs, no constraint terms). Cross-lingual pairs
 * (dev-plan M3a applied to S4): the aligned score of align.ts over the needs, with the Latin / identifier terms of the
 * query, goal and entity / must_term values joined in (so Chinese needs inherit the English terms of
 * the query) and the Han terms of a Latin item no longer dominating the denominator.
 */
export function gateRelevance(ctx, item) {
    if (!isCrossLingual(ctx, item))
        return { relevance: lexicalRelevance(ctx, item, false), aligned: false };
    const text = [item.title, item.text].filter(Boolean).join('\n');
    return { relevance: alignedRelevance({ goal: ctx.goal, query: ctx.query, need: ctx.needs.join('\n'), constraints: ctx.constraints }, { ...item.heading ? { heading: item.heading } : {}, text }), aligned: true };
}
export function gateItemOf(c) {
    return { url: c.url, title: c.title, text: c.snippet, ...c.publishedAt ? { publishedAt: c.publishedAt } : {} };
}
/** Run every constraint check and the relevance gate for one candidate. Never mutates. */
export function gateItem(task, item, options = {}) {
    const threshold = options.relevanceThreshold ?? DEFAULT_RELEVANCE_THRESHOLD;
    const now = options.now ?? new Date();
    const checks = [];
    const violated = [];
    for (const c of task.constraints) {
        const verdict = checkConstraint(c, item, now);
        checks.push({ constraintId: c.id, satisfied: verdict.satisfied, prob: verdict.prob });
        if (c.strength === 'hard' && (options.hardConstraints ?? true) && isDefiniteViolation(c, verdict, options.fullText ?? false))
            violated.push(c.id);
    }
    const { relevance, aligned } = gateRelevance(relevanceContextOf(task), item);
    const how = aligned ? { aligned: true } : {};
    if (violated.length)
        return { checks, gate: { keep: false, relevance, threshold, reason: 'constraint', violated, ...how } };
    if (relevance < threshold)
        return { checks, gate: { keep: false, relevance, threshold, reason: 'relevance', ...how } };
    return { checks, gate: { keep: true, relevance, threshold, ...how } };
}
/** Annotate candidates with `checks` and `gate`. Returns new objects; dropped candidates stay in the list (see {@link keptCandidates}). */
export function gateCandidates(task, candidates, options = {}) {
    return candidates.map(candidate => ({ ...candidate, ...gateItem(task, gateItemOf(candidate), options) }));
}
export function keptCandidates(candidates) {
    return candidates.filter(c => c.gate?.keep !== false);
}
/** Candidates the gate must keep when it would otherwise leave fewer (default). */
export const DEFAULT_MIN_KEEP = 3;
/**
 * Floor for S4 (dev-plan §3.1, real-host run: a cross-lingual task had all 20 candidates dropped). `candidates`
 * are gated and in fused order, best first. When fewer than `minKeep` survive and more exist, the best-fused
 * ones dropped on RELEVANCE ALONE are kept up to `minKeep`, with `gate.lowConfidence = true` (and `keep` true, so
 * every later stage treats them as kept). A candidate with a definite hard-constraint violation (`reason: 'constraint'`)
 * is never brought back.
 */
export function applyFloor(candidates, minKeep = DEFAULT_MIN_KEEP) {
    const kept = keptCandidates(candidates);
    const missing = Math.floor(minKeep) - kept.length;
    if (missing <= 0 || kept.length >= candidates.length)
        return { kept, added: 0 };
    const revived = candidates
        .filter(c => c.gate?.keep === false && c.gate.reason !== 'constraint')
        .slice(0, missing)
        .map((c) => ({ ...c, gate: { ...c.gate, keep: true, lowConfidence: true } }));
    return { kept: [...kept, ...revived], added: revived.length };
}
//# sourceMappingURL=gate.js.map