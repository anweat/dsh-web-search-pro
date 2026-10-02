/**
 * Query compilation (dev-plan §4.1 step 2): turn a TaskSpec into one query per
 * provider, pushing constraints to the provider natively where it can enforce
 * them and reporting which constraints are left for local verification.
 *
 *  - ddg / bing: `site:`, `-site:` and `-term` operators for HARD site /
 *    exclude_site / exclude_term constraints (the first hard `site` only: two
 *    `site:` operators are ANDed into nothing);
 *  - exa: includeDomains / excludeDomains / startPublishedDate options for HARD
 *    site / exclude_site / time_window (Exa omits undated pages when a date
 *    bound is set, hence hard only);
 *  - github*: the natural-language query returns nothing on repository search
 *    (E1: 0 of 20), so it is replaced by a short keyword query;
 *  - everything else: the plain query.
 * Soft constraints are never pushed down (a preference must not shrink recall);
 * they are verified locally like every constraint the provider cannot express.
 * The gate re-checks rule-checkable constraints on every candidate regardless,
 * so a provider silently ignoring an operator costs nothing but precision.
 * @module web-search-pro/pipeline/compile
 */
import type { Need, TaskSpec } from './types.ts';
export interface CompiledExaOptions {
    includeDomains?: string[];
    excludeDomains?: string[];
    startPublishedDate?: string;
}
export interface CompiledQuery {
    providerId: string;
    /** Text to send to the provider. */
    query: string;
    /** Provider-native options, shaped like `EngineSearchOptions` (only Exa has any today). */
    options?: {
        exa: CompiledExaOptions;
    };
    /** Broader variants to try, in order, when the provider answers ENGINE_EMPTY for `query` (GitHub: fewer keywords). */
    fallbacks?: string[];
    /** Ids of constraints the provider enforces natively. */
    native: string[];
    /** Ids of constraints that still need local verification (the rest of the task's constraints). */
    local: string[];
}
type TaskLike = Pick<TaskSpec, 'goal' | 'query' | 'needs' | 'constraints'>;
/**
 * Lower bound (ISO 8601, UTC) of a time_window value, in the same sense the rule
 * gate uses: a year ("2025 年以后", "since 2025", "2025") means "published in or
 * after that year"; relative spans ("最近一周", "past 30 days") count back from
 * `now`. Upper bounds are not expressed by the constraint vocabulary. Returns
 * undefined when the value is not understood (the constraint then stays local).
 */
export declare function parseTimeWindow(value: string, now?: Date): string | undefined;
export declare const GITHUB_MAX_TERMS = 5;
/**
 * Short keyword query for repository search: entities, then must_terms, then a
 * few salient Latin tokens of the query; Chinese terms only from entities /
 * must_terms, or from the query when fewer than two terms were found. At most
 * {@link GITHUB_MAX_TERMS} terms, version-like numbers dropped.
 */
export declare function githubKeywordTerms(task: TaskLike): string[];
export declare function githubKeywordQuery(task: TaskLike): string;
/** Repository search ANDs every keyword, so one rare token empties the result: retry with the leading 3 and 2 terms. */
export declare const GITHUB_FALLBACK_TERM_COUNTS: readonly number[];
/** Compile the task for one provider id (`ddg`, `bing`, `exa`, `github*`; anything else gets the plain query). */
export declare function compileQuery(task: TaskLike, providerId: string, now?: Date): CompiledQuery;
export declare function compileQueries(task: TaskLike, providerIds: readonly string[], now?: Date): CompiledQuery[];
/** Identifier-like tokens (`node:sqlite`, `DatabaseSync`, `busy_timeout`, `v22.5`): the entities of a query worth repeating in a follow-up. */
export declare function keyTokens(text: string): string[];
/** Longest follow-up query (characters); search engines gain nothing from more. */
export declare const GAP_QUERY_MAX_CHARS = 200;
/**
 * Query for a follow-up round targeted at one unsupported need: the need text plus the task's key entities
 * (entity / must_term / version constraints, then identifier-like tokens of the original query) that the
 * need does not already mention. Provider-specific shaping (site: operators, Exa options, GitHub keywords)
 * is left to {@link compileQuery} over a task whose `query` is this text.
 */
export declare function gapQueryText(task: Pick<TaskSpec, 'query' | 'constraints'>, need: Pick<Need, 'text'>): string;
export {};
