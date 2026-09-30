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
}
/** One line under the header (dev-plan M3b): "covered" is a lexical judgement, and a missing passage proves nothing. */
export declare const COVERAGE_CAVEAT = "Coverage is heuristic: no evidence here does not mean it does not exist; fetch/expand before concluding.";
export declare function renderEvidencePack(pack: Pick<EvidencePack, 'resultId' | 'profile' | 'needs' | 'evidence' | 'coveredNeeds' | 'gaps' | 'partial' | 'notes' | 'verification'>, sources: readonly RenderSource[], engineLine: string): string;
