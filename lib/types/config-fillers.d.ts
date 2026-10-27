/**
 * Removal of the empty containers the Host's schema parser fills in (see the comment on `withoutFillers`). Pure and free of
 * imports: the server's config resolution and the settings card's validation (client bundle) use the same functions.
 * @module web-search-pro/config-fillers
 */
export declare function withoutFillers<T>(value: T, keys: readonly string[]): T;
export declare function normalizeJudge<T>(judge: T): T;
export declare function normalizeRubrics<T>(rubrics: T): T;
export declare function normalizeCoverage<T>(coverage: T): T;
