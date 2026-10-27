/**
 * Rank fusion for multi-provider search (design §6.2, dev-plan M2a).
 *
 *   rrf(d)   = Σ_provider 1 / (k + bestRank_provider(d))     one term per provider
 *   norm(d)  = rrf(d) / (nProviders / (k + 1))               in [0, 1]; 1 = rank 1 everywhere
 *   score(d) = norm(d) + bonus(d)                            bonus added ONCE per URL
 *   bonus(d) = (freshnessBoost·fresh(d) + authorityBoost·authority(d) + signalBoost·signal(d)) · unit
 *   unit     = 1 / (nProviders · (k + 2))                    one top-rank step of one provider, on the normalised scale
 *
 * `freshnessBoost` / `authorityBoost` (config, 0..1) are therefore FRACTIONS OF
 * ONE TOP-RANK STEP: at the defaults (0.2 / 0.25) the two bonuses together can
 * never outweigh half of one rank position, and at their maximum (1 / 1) two
 * positions. They break ties and near-ties; they cannot lift a rank-10 result
 * over a rank-1 result of the same provider. A URL returned by several
 * providers gets one bonus, not one per hit.
 *
 * `signal(d)` is the provider's OWN quality grade when it gives one (DeepSeek Search: `rerank_score` 0..3, which already folds
 * relevance, authority and freshness together, and `authority` 0..4): 0.7·rerank/3 + 0.3·authority/4 over whichever of the two
 * the URL has (the best seen over providers, see candidates.ts), 0 for a URL no provider graded. `signalBoost` (default
 * {@link PROVIDER_SIGNAL_BOOST}) is, like the others, a fraction of ONE top-rank step: with the default boosts the three
 * bonuses together can never reach one rank position (0.2 + 0.25 + 0.3 = 0.75). A provider that grades its own results already
 * orders them, so the signal mostly arbitrates between providers; it never lifts a rank-10 result over a rank-1 one.
 *
 * Source confidence (confidence.ts) scales each provider's RRF term by `factor(c)` in [0.8, 1] and the bonus of a URL by the best factor
 * among the providers that returned it; a provider without a confidence, which is every built-in source, has factor exactly 1 and the
 * scores are what they were without it.
 * @module web-search-pro/pipeline/fusion
 */
import { confidenceFactor } from "./confidence.js";
export const AUTHORITY_DOMAINS_BUILTIN = ['github.com', 'wikipedia.org', 'arxiv.org', 'pubmed.ncbi.nlm.nih.gov', 'stackoverflow.com', 'developer.mozilla.org'];
/** Default weight of the provider's own quality signal (fraction of one top-rank step); see the module comment. */
export const PROVIDER_SIGNAL_BOOST = 0.3;
/** Share of the provider signal that comes from `rerank_score` (the rest is `authority`, when the URL has one). */
export const RERANK_SIGNAL_WEIGHT = 0.7;
/**
 * The provider's own quality grade of a candidate in 0..1: `rerank_score` / 3 weighted 0.7 and `authority` / 4 weighted 0.3; with
 * only one of them present that one alone; 0 when the candidate has none. Out-of-range values are clamped.
 */
export function providerSignal(candidate) {
    const unit = (value, max) => (typeof value === 'number' && Number.isFinite(value) ? Math.min(Math.max(value / max, 0), 1) : undefined);
    const rerank = unit(candidate.signals?.rerankScore, 3);
    // A negative authority is the provider's "unknown" (-1): no grade, not the lowest one.
    const authority = (candidate.signals?.authority ?? 0) < 0 ? undefined : unit(candidate.signals?.authority, 4);
    if (rerank !== undefined && authority !== undefined)
        return RERANK_SIGNAL_WEIGHT * rerank + (1 - RERANK_SIGNAL_WEIGHT) * authority;
    return rerank ?? authority ?? 0;
}
/** The fusion factor of each provider that returned the candidate: its confidence factor (1 when it has none). */
function providerFactors(candidate) {
    const out = new Map();
    for (const { providerId, confidence } of candidate.contributions)
        out.set(providerId, confidenceFactor(confidence));
    return out;
}
/** Best (lowest) rank per provider: one RRF term per provider per URL. */
export function bestRanks(candidate) {
    const best = new Map();
    for (const { providerId, rank } of candidate.contributions) {
        const current = best.get(providerId);
        if (current === undefined || rank < current)
            best.set(providerId, rank);
    }
    return best;
}
export function isAuthorityHost(host, extraDomains = []) {
    const h = host.toLowerCase();
    return [...extraDomains, ...AUTHORITY_DOMAINS_BUILTIN].some(d => h === d || h.endsWith('.' + d))
        || /(^|\.)(edu|gov|org)$/.test(h);
}
/** 1 for a result published now, falling linearly to 0 at `freshnessDays`; 0 when undated or in the future. */
export function freshnessFactor(publishedAt, freshnessDays, now) {
    if (!publishedAt)
        return 0;
    const published = Date.parse(publishedAt);
    if (Number.isNaN(published))
        return 0;
    const ageDays = (now.getTime() - published) / 86_400_000;
    return ageDays >= 0 ? Math.max(0, 1 - ageDays / Math.max(freshnessDays, 1)) : 0;
}
/** Score and sort candidates, best first. Ties keep first-seen order. */
export function fuseCandidates(candidates, options) {
    const k = Math.max(options.k, 1);
    const now = options.now ?? new Date();
    const nProviders = Math.max(options.nProviders ?? new Set(candidates.flatMap(c => c.contributions.map(x => x.providerId))).size, 1);
    const maxRrf = nProviders / (k + 1);
    const unit = 1 / (nProviders * (k + 2));
    const freshnessBoost = Math.min(Math.max(options.freshnessBoost, 0), 1);
    const authorityBoost = Math.min(Math.max(options.authorityBoost, 0), 1);
    const signalBoost = Math.min(Math.max(options.signalBoost ?? PROVIDER_SIGNAL_BOOST, 0), 1);
    const ranked = candidates.map((candidate) => {
        let rrf = 0;
        const factors = providerFactors(candidate);
        let bestFactor = 0;
        for (const [providerId, rank] of bestRanks(candidate)) {
            const factor = factors.get(providerId) ?? 1;
            rrf += factor === 1 ? 1 / (k + rank) : factor / (k + rank);
            bestFactor = Math.max(bestFactor, factor);
        }
        const normalized = Math.min(rrf / maxRrf, 1);
        let bonus = 0;
        if (freshnessBoost > 0)
            bonus += freshnessBoost * freshnessFactor(candidate.publishedAt, options.freshnessDays, now);
        if (authorityBoost > 0) {
            let host = '';
            try {
                host = new URL(candidate.url).hostname;
            }
            catch { /* no host, no authority */ }
            if (host && isAuthorityHost(host, options.authorityDomains))
                bonus += authorityBoost;
        }
        if (signalBoost > 0)
            bonus += signalBoost * providerSignal(candidate);
        bonus *= unit;
        // A URL only doubted sources returned earns less of the tie-break bonuses; one any full-confidence source returned earns all of them.
        if (bestFactor > 0 && bestFactor < 1)
            bonus *= bestFactor;
        return { candidate, score: normalized + bonus, rrf, normalized, bonus };
    });
    // Array#sort is stable, so equal scores keep first-seen order.
    return ranked.sort((a, b) => b.score - a.score);
}
//# sourceMappingURL=fusion.js.map