/**
 * The default engine order of a plain search, as a pure function: the router uses it to decide the order, and the settings
 * card's status summary uses the same code to show the chain a search would try first, so the two cannot disagree.
 * No imports: the client bundle includes this file.
 * @module web-search-pro/default-chain
 */
/** The default `engines` list. A list equal to it is "not customised": the default rule for common ("常用") sources applies to it. */
export declare const DEFAULT_ENGINES: readonly string[];
export interface ChainInput {
    /** The configured `engines` (route ids). */
    engines: readonly string[];
    /** `sources.priority` (route ids). */
    priority?: readonly string[];
    /** `sources.disabled` (route ids). */
    disabled?: readonly string[];
    /** Common ("常用") sources whose key resolves, best first. */
    commonReady?: readonly string[];
    /** `evidence.sourcePolicy === 'anonymous-only'`: a paid common source is never added. */
    anonymousOnly?: boolean;
}
/**
 * Order of the configured chain: `sources.disabled` removed, `sources.priority` ids that are in the list first, then the common
 * sources whose key resolves (only while `engines` is the default list; a list the user wrote keeps its order and the position
 * it gave a common source), then the rest. Throws when everything is disabled.
 */
export declare function effectiveChain(input: ChainInput): string[];
