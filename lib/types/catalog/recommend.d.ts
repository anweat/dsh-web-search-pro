/**
 * Source recommendations (dev-plan M7): from a task / profile / language (and an optional platform hint) pick
 * AT MOST three sources so the model does not fan out to every source. Ready sources come first (registry
 * providers by their readiness; platforms by what a local scan found), then sources that are only in the
 * catalog, each with what is missing and how to set it up. A catalog-only or not-ready entry is never
 * `executable`: the catalog explains, only the registry runs. Pure: readiness comes in through the context.
 * @module web-search-pro/catalog/recommend
 */
import { type ProviderStatus } from '../pipeline/plan.ts';
import { type Profile } from '../pipeline/types.ts';
import type { CatalogEntry, SourceCatalog } from './schema.ts';
/** Most suggestions one call returns. */
export declare const MAX_RECOMMENDATIONS = 3;
/** Shown with every recommendation: the point of the feature is to NOT query everything. */
export declare const RECOMMEND_INSTRUCTION = "Use 1-2 of these; do not call all sources in parallel, and add another only if the evidence is insufficient. Sources that are not executable need setup first: tell the user what is missing instead of calling them.";
export interface RecommendInput {
    /** The goal in one sentence (also used to detect language and profile). */
    task?: string;
    query?: string;
    profile?: Profile;
    language?: 'zh' | 'en';
    /** A platform or source id the caller already leans towards (`xiaohongshu`, `reddit`). */
    platform?: string;
}
export interface RecommendContext {
    catalog: SourceCatalog;
    /** Registry readiness by provider ROUTE id; absent = no such adapter is registered. */
    providers: ReadonlyMap<string, ProviderStatus>;
    /** Local CLI scan (`sources.deps` ids); absent = not scanned. */
    cli?: ReadonlyMap<string, boolean>;
    /** The dsh-browser plugin is ready. */
    browser?: boolean;
    /** Whether an environment variable / credential of that name is configured (never read out). */
    hasEnv?: (name: string) => boolean;
    /** Whether a plugin setting is set (`searxngUrl`). */
    hasConfig?: (name: string) => boolean;
    limit?: number;
}
export type SuggestionStatus = 'ready' | 'limited' | 'needs_setup' | 'catalog_only';
export interface Suggestion {
    id: string;
    label: string;
    kind: CatalogEntry['kind'];
    status: SuggestionStatus;
    /** True only for `ready` and `limited`: something this plugin can run right now. */
    executable: boolean;
    /** The call that runs it (or why it cannot be called yet). */
    use: string;
    why: string;
    /** What is missing (not executable, or `limited`). */
    missing?: string[];
    /** Short setup text; only when something is missing. */
    setup?: string;
    /** First counter-example of the entry. */
    notFor?: string;
    verified: boolean;
    sourceFamily?: string;
}
export interface Recommendation {
    profile: Profile;
    profileInferred: boolean;
    language?: 'zh' | 'en';
    picks: Suggestion[];
    instruction: string;
    notes: string[];
}
export declare function recommendSources(input: RecommendInput, ctx: RecommendContext): Recommendation;
/** Plain text of a recommendation (the tool's render). */
export declare function renderRecommendation(r: Recommendation): string;
