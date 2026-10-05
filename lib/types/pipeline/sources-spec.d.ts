/**
 * Validation of the user's source preferences (`sources.priority`, `sources.disabled`, `sources.budget`), with no Node
 * imports so the settings panel validates them with the code the server uses; the request counters live in ./ledger.ts.
 * @module web-search-pro/pipeline/sources-spec
 */
/** Request caps of one source: `total` over all time, `daily` per calendar day. Absent = no cap on that axis. */
export interface SourceBudgetInput {
    total?: number;
    daily?: number;
}
/** `sources` as the user writes it. */
export interface SourcesInput {
    priority?: readonly string[];
    disabled?: readonly string[];
    budget?: Record<string, SourceBudgetInput>;
}
export interface SourcesResolved {
    priority: string[];
    disabled: string[];
    budget: Record<string, SourceBudgetInput>;
    /** Entries ignored, each saying why (surfaced by `sources.status` and the settings card). */
    diagnostics: string[];
}
/**
 * Validate the preferences; invalid entries are dropped and reported, never thrown. `known` (optional) tells whether an
 * id is a registered provider: unknown ids are reported and dropped, so a typo cannot silently disable nothing.
 */
export declare function resolveSources(input: SourcesInput | undefined, known?: (id: string) => boolean): SourcesResolved;
