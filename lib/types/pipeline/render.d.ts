/**
 * Text rendering of an EvidencePack for the model (tool output `render`) and
 * for size accounting in the offline eval. Compact on purpose: one card per
 * excerpt, gaps in one line, remaining sources as bare links.
 * @module web-search-pro/pipeline/render
 */
import type { EvidencePack } from './types.ts';
export interface RenderSource {
    url: string;
    title?: string;
    snippet?: string;
    publishedAt?: string;
    rerankScore?: number;
    authority?: number;
    lowConfidence?: boolean;
    via?: string;
    confidence?: number;
    tag?: string;
}
/**
 * `[rerank 2.4/3, authority 3/4]`: the provider's own grades of a source (DeepSeek Search); for a custom CLI or a source the user gave a
 * confidence below 1 also `via custom-cli:echo, confidence 0.5` and the honest label (user-defined, not verified). Empty when there is none of it.
 */
export declare function qualityTag(s: {
    rerankScore?: number;
    authority?: number;
    via?: string;
    confidence?: number;
    tag?: string;
}): string;
/** Marker for a source / excerpt whose page only passed the S4 floor, not the relevance gate (dev-plan §3.1). */
export declare const LOW_RELEVANCE = " (low relevance)";
/** One line under the header (dev-plan M3b): "covered" is a lexical judgement, and a missing passage proves nothing. */
export declare const COVERAGE_CAVEAT = "Coverage is heuristic: no evidence here does not mean it does not exist; fetch/expand before concluding.";
export declare function renderEvidencePack(pack: Pick<EvidencePack, 'resultId' | 'profile' | 'needs' | 'evidence' | 'coveredNeeds' | 'gaps' | 'partial' | 'notes' | 'verification'> & Partial<Pick<EvidencePack, 'uncertainNeeds'>>, sources: readonly RenderSource[], engineLine: string, expandLine?: string): string;
/** The pack as `search.run` and the ctx.web provider return it (`EvidenceOutput` of pipeline/service.ts). */
type PackFields = Parameters<typeof renderEvidencePack>[0];
export interface RenderableOutput extends PackFields {
    sources: readonly RenderSource[];
    engine: string;
    enginesTried?: readonly string[] | undefined;
}
/**
 * Pack text with the engine line `search.run` shows. `omitOtherSources`: the caller lists the sources itself (the ctx.web tool does).
 * `expandLine` replaces the closing "how to read on" line (the ctx.web tool names the calls on its tool surface).
 */
export declare function renderEvidenceOutput(out: RenderableOutput, opts?: {
    omitOtherSources?: boolean;
    expandLine?: string;
}): string;
export {};
