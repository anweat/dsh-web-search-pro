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
import type { Candidate } from './types.ts';
export declare const AUTHORITY_DOMAINS_BUILTIN: readonly string[];
export interface FusionOptions {
    /** RRF smoothing constant (config rrfConstant). */
    k: number;
    /** Fraction of one top-rank step for a fully fresh result (0..1). */
    freshnessBoost: number;
    /** Days over which freshness decays to zero. */
    freshnessDays: number;
    /** Fraction of one top-rank step for an authority host (0..1). */
    authorityBoost: number;
    /** Extra authority domains; the built-in list and .edu/.gov/.org always apply. */
    authorityDomains: readonly string[];
    /** Providers that took part (answered, even with few results). Defaults to the distinct providers in the candidates. */
    nProviders?: number;
    now?: Date;
}
export interface RankedCandidate {
    candidate: Candidate;
    /** Final score: normalised RRF plus the one-time bonus. */
    score: number;
    /** Raw Σ 1/(k+rank). */
    rrf: number;
    /** rrf divided by the maximum possible (nProviders / (k + 1)). */
    normalized: number;
    bonus: number;
}
/** Best (lowest) rank per provider: one RRF term per provider per URL. */
export declare function bestRanks(candidate: Pick<Candidate, 'contributions'>): Map<string, number>;
export declare function isAuthorityHost(host: string, extraDomains?: readonly string[]): boolean;
/** 1 for a result published now, falling linearly to 0 at `freshnessDays`; 0 when undated or in the future. */
export declare function freshnessFactor(publishedAt: string | undefined, freshnessDays: number, now: Date): number;
/** Score and sort candidates, best first. Ties keep first-seen order. */
export declare function fuseCandidates(candidates: readonly Candidate[], options: FusionOptions): RankedCandidate[];
