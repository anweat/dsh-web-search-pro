/**
 * Source confidence (0..1): how far the user trusts what one source returns. It is an input of rank fusion and a label on results,
 * nothing else: it never removes a result, never changes what a source is asked, and every built-in source has confidence 1, so
 * with the defaults the fused order is exactly what it was before confidence existed.
 *
 *   factor(c) = 1 - STRENGTH · (1 - c)           c in [0, 1]; undefined = 1; the factor is always in [1 - STRENGTH, 1]
 *   rrf(d)    = Σ_provider factor(c_provider) / (k + bestRank_provider(d))       (fusion.ts)
 *   bonus(d)  = bonus(d) · max_provider factor(c_provider)                       a URL only a doubted source returned earns less of the tie-break bonuses
 *
 * A source of confidence c therefore ranks as if its list began ((k + 1) / factor - (k + 1)) positions lower: at k = 60 about 7
 * positions for c = 0.5 and about 16 for c = 0. Results several sources agree on lose almost nothing, a result only a doubted
 * source has sinks towards the tail, and {@link guaranteeSeats} makes sure its best one is still within the list that is shown.
 * Pure and free of imports: the settings card and the tests read it too.
 * @module web-search-pro/pipeline/confidence
 */
/** How much confidence 0 takes off the contribution of a source (0.2 = a fifth). */
export declare const CONFIDENCE_STRENGTH = 0.2;
/** Confidence of a source nothing is known about: the built-in ones. */
export declare const FULL_CONFIDENCE = 1;
/** A confidence as a number in [0, 1]; anything else (missing, NaN) is full confidence. */
export declare function clampConfidence(value: number | undefined): number;
/** The multiplier of a source's rank-fusion contribution, in [1 - STRENGTH, 1]; exactly 1 for confidence 1 or none. */
export declare function confidenceFactor(confidence: number | undefined): number;
/** A contribution of one provider to a candidate; `confidence` is present only when it is below 1. */
export interface WeightedContribution {
    providerId: string;
    confidence?: number;
}
/**
 * Keep the best result of every doubted source within the first `size` results. A source whose confidence is below 1 and which
 * answered, but has none of its results in the window, gets its best-ranked result moved to the end of the window (at most
 * `size - 1` such seats, so the window never consists of nothing else). The order of everything else is kept. With no confidence
 * below 1 anywhere the list comes back unchanged.
 */
export declare function guaranteeSeats<T>(ranked: readonly T[], size: number, contributions: (item: T) => readonly WeightedContribution[]): T[];
