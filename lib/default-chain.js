/**
 * The default engine order of a plain search, as a pure function: the router uses it to decide the order, and the settings
 * card's status summary uses the same code to show the chain a search would try first, so the two cannot disagree.
 * No imports: the client bundle includes this file.
 * @module web-search-pro/default-chain
 */
/** The default `engines` list. A list equal to it is "not customised": the default rule for common ("常用") sources applies to it. */
export const DEFAULT_ENGINES = Object.freeze(['ddg', 'bing', 'exa', 'seam', 'jina']);
/**
 * Order of the configured chain: `sources.disabled` removed, `sources.priority` ids that are in the list first, then the common
 * sources whose key resolves (only while `engines` is the default list; a list the user wrote keeps its order and the position
 * it gave a common source), then the rest. Throws when everything is disabled.
 */
export function effectiveChain(input) {
    const disabled = new Set(input.disabled ?? []);
    const kept = input.engines.filter(id => !disabled.has(id));
    if (input.engines.length && !kept.length)
        throw new Error('every configured engine is disabled (sources.disabled): ' + input.engines.join(', '));
    const first = (input.priority ?? []).filter(id => kept.includes(id));
    const customised = input.engines.length !== DEFAULT_ENGINES.length || input.engines.some((id, i) => id !== DEFAULT_ENGINES[i]);
    const lead = customised || input.anonymousOnly ? [] : (input.commonReady ?? []).filter(id => !disabled.has(id) && !kept.includes(id));
    return [...new Set([...first, ...lead, ...kept.filter(id => !first.includes(id))])];
}
//# sourceMappingURL=default-chain.js.map