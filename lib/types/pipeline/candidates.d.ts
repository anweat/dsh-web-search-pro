/**
 * Candidate merging (dev-plan M2a S3, design §6.1): provider outputs become
 * one Candidate per canonical URL. Every (provider, rank, query) contribution
 * is kept; title and snippet are the most complete ones seen, with
 * complementary snippets joined inside a character cap.
 * @module web-search-pro/pipeline/candidates
 */
import type { Candidate } from './types.ts';
/** Same cap as `shapeSources` applies to outgoing snippets (util.ts SNIPPET_MAX_CHARS). */
export declare const SNIPPET_JOIN_CAP = 500;
export interface ProviderSource {
    url: string;
    title?: string | null;
    snippet?: string | null;
    publishedAt?: string | null;
}
/** One provider's ordered result list for one query (index 0 = rank 1). */
export interface ProviderOutput {
    providerId: string;
    query: string;
    sources: readonly ProviderSource[];
}
export interface MergeOptions {
    /** Cap for joined snippets; a single snippet longer than the cap is kept whole (shaping is the exit's job). */
    snippetMaxChars?: number;
}
export declare function candidateIdOf(canonical: string): string;
/** Fold snippet `next` into `current`: drop repeats, keep the longer of near-duplicates, join complements within `cap`. */
export declare function mergeSnippets(current: string, next: string | null | undefined, cap?: number): string;
/**
 * Merge provider outputs into candidates keyed by canonical URL, in first-seen
 * order (outputs in the given order, sources by rank). Sources without a URL
 * are skipped; their rank positions still count.
 */
export declare function mergeCandidates(outputs: readonly ProviderOutput[], options?: MergeOptions): Candidate[];
