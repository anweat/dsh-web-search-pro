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
/**
 * {@link effectiveChain} plus why it differs from the list: the preview of the settings card says it in one sentence per reason, so
 * a person who sees `deepseek` first in a list that does not begin with it knows which rule did that. Same inputs, same rule.
 */
export function explainChain(input) {
    let chain;
    try {
        chain = effectiveChain(input);
    }
    catch {
        chain = undefined;
    }
    const reasons = [];
    const disabled = new Set(input.disabled ?? []);
    const removed = [...new Set(input.engines.filter(id => disabled.has(id)))];
    if (removed.length)
        reasons.push({ kind: 'disabled', ids: removed });
    if (!chain)
        return { chain, reasons };
    const customised = input.engines.length !== DEFAULT_ENGINES.length || input.engines.some((id, i) => id !== DEFAULT_ENGINES[i]);
    const ready = (input.commonReady ?? []).filter(id => !disabled.has(id));
    const led = chain.filter(id => !input.engines.includes(id));
    if (led.length)
        reasons.push({ kind: 'common', ids: led });
    const kept = input.engines.filter(id => !disabled.has(id));
    const first = (input.priority ?? []).filter(id => kept.includes(id));
    // Priority ids that actually changed place: those not already at the position priority gives them.
    const moved = first.filter((id, index) => kept.indexOf(id) !== index);
    if (moved.length)
        reasons.push({ kind: 'priority', ids: moved });
    if (input.anonymousOnly) {
        const skipped = ready.filter(id => !input.engines.includes(id));
        if (skipped.length)
            reasons.push({ kind: 'anonymous-only', ids: skipped });
    }
    else if (customised) {
        const skipped = ready.filter(id => !input.engines.includes(id));
        if (skipped.length)
            reasons.push({ kind: 'own-list', ids: skipped });
    }
    return { chain, reasons };
}
//# sourceMappingURL=default-chain.js.map