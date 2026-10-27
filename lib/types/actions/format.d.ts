/** Text helpers shared by the action renderers. @module web-search-pro/actions/format */
type FormatSource = {
    url: string;
    title?: string;
    snippet?: string;
    publishedAt?: string;
    rerankScore?: number;
    authority?: number;
    via?: string;
    confidence?: number;
    tag?: string;
};
export declare function formatSources(sources: FormatSource[]): string;
/**
 * Per-item character limit so that `sum(min(length, limit)) <= total` and `limit <= perItem`:
 * short texts keep all they have and the room they leave over goes to the long ones.
 */
export declare function fairShareLimit(lengths: readonly number[], perItem: number, total: number): number;
/** The fallback for a character cap when the config has none. */
export declare const DEFAULT_FETCH_CHARS = 20000;
export {};
