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
 * @module web-search-pro/pipeline/fusion
 */
import type { Candidate } from './types.ts';
export declare const AUTHORITY_DOMAINS_BUILTIN: readonly string[];
/** Default weight of the provider's own quality signal (fraction of one top-rank step); see the module comment. */
export declare const PROVIDER_SIGNAL_BOOST = 0.3;
/** Share of the provider signal that comes from `rerank_score` (the rest is `authority`, when the URL has one). */
export declare const RERANK_SIGNAL_WEIGHT = 0.7;
export interface FusionOptions {
    /** RRF smoothing constant (config rrfConstant). */
    k: number;
    /** Fraction of one top-rank step for a fully fresh result (0..1). */
    freshnessBoost: number;
    /** Days over which freshness decays to zero. */
    freshnessDays: number;
    /** Fraction of one top-rank step for an authority host (0..1). */
    authorityBoost: number;
    /** Fraction of one top-rank step for a result the provider itself graded best (0..1; default {@link PROVIDER_SIGNAL_BOOST}); 0 turns the signal off. */
    signalBoost?: number;
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
/**
 * The provider's own quality grade of a candidate in 0..1: `rerank_score` / 3 weighted 0.7 and `authority` / 4 weighted 0.3; with
 * only one of them present that one alone; 0 when the candidate has none. Out-of-range values are clamped.
 */
export declare function providerSignal(candidate: Pick<Candidate, 'signals'>): number;
/** Best (lowest) rank per provider: one RRF term per provider per URL. */
export declare function bestRanks(candidate: Pick<Candidate, 'contributions'>): Map<string, number>;
export declare function isAuthorityHost(host: string, extraDomains?: readonly string[]): boolean;
/** 1 for a result published now, falling linearly to 0 at `freshnessDays`; 0 when undated or in the future. */
export declare function freshnessFactor(publishedAt: string | undefined, freshnessDays: number, now: Date): number;
/** Score and sort candidates, best first. Ties keep first-seen order. */
export declare function fuseCandidates(candidates: readonly Candidate[], options: FusionOptions): RankedCandidate[];
