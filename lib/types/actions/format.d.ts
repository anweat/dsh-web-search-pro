/** Text helpers shared by the action renderers. @module web-search-pro/actions/format */
export declare function formatSources(sources: {
    url: string;
    title?: string;
    snippet?: string;
    publishedAt?: string;
}[]): string;
/**
 * Per-item character limit so that `sum(min(length, limit)) <= total` and `limit <= perItem`:
 * short texts keep all they have and the room they leave over goes to the long ones.
 */
export declare function fairShareLimit(lengths: readonly number[], perItem: number, total: number): number;
/** The fallback for a character cap when the config has none. */
export declare const DEFAULT_FETCH_CHARS = 20000;
