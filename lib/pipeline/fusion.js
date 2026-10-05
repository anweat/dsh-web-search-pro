/**
 * Rank fusion for multi-provider search (design §6.2, dev-plan M2a).
 *
 *   rrf(d)   = Σ_provider 1 / (k + bestRank_provider(d))     one term per provider
 *   norm(d)  = rrf(d) / (nProviders / (k + 1))               in [0, 1]; 1 = rank 1 everywhere
 *   score(d) = norm(d) + bonus(d)                            bonus added ONCE per URL
 *   bonus(d) = (freshnessBoost·fresh(d) + authorityBoost·authority(d)) · unit
 *   unit     = 1 / (nProviders · (k + 2))                    one top-rank step of one provider, on the normalised scale
 *
 * `freshnessBoost` / `authorityBoost` (config, 0..1) are therefore FRACTIONS OF
 * ONE TOP-RANK STEP: at the defaults (0.2 / 0.25) the two bonuses together can
 * never outweigh half of one rank position, and at their maximum (1 / 1) two
 * positions. They break ties and near-ties; they cannot lift a rank-10 result
 * over a rank-1 result of the same provider. A URL returned by several
 * providers gets one bonus, not one per hit.
 * @module web-search-pro/pipeline/fusion
 */
export const AUTHORITY_DOMAINS_BUILTIN = ['github.com', 'wikipedia.org', 'arxiv.org', 'pubmed.ncbi.nlm.nih.gov', 'stackoverflow.com', 'developer.mozilla.org'];
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
    const ranked = candidates.map((candidate) => {
        let rrf = 0;
        for (const rank of bestRanks(candidate).values())
            rrf += 1 / (k + rank);
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
        bonus *= unit;
        return { candidate, score: normalized + bonus, rrf, normalized, bonus };
    });
    // Array#sort is stable, so equal scores keep first-seen order.
    return ranked.sort((a, b) => b.score - a.score);
}
//# sourceMappingURL=fusion.js.map