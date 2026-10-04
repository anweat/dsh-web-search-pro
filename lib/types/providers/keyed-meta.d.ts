/**
 * Which sources are keyed and the default environment variable of each key: data only, shared by the adapters and the
 * settings panel (client bundle), hence no imports.
 * @module web-search-pro/providers/keyed-meta
 */
/** Default environment variable names of each keyed source's API key, first one preferred (route id -> names). */
export declare const KEYED_SOURCE_ENVS: Readonly<Record<string, readonly string[]>>;
export declare const KEYED_SOURCE_IDS: readonly string[];
