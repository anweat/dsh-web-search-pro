/**
 * Static reference of the sources that work without a key, for the "Sources" section. It is documentation, not state:
 * live readiness (what is installed, which key is set, what answered) is `web_call sources.status`. A test pins every
 * row to the provider registry (the id exists and needs no key), so the table cannot drift from the code.
 * @module web-search-pro/client/sources-table
 */
import type { zh } from './locales.ts';
export interface AnonymousSource {
    /** Route id (the registry alias) the source is addressed by in `engines`. */
    id: string;
    name: string;
    /** Locale key of its one-line use. */
    use: keyof typeof zh;
}
export declare const ANONYMOUS_SOURCES: readonly AnonymousSource[];
/** Display names of the keyed sources by route id (proper names, shown the same in every language). */
export declare const KEYED_NAMES: Readonly<Record<string, string>>;
