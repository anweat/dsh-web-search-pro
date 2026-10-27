/**
 * Validation of the user's source preferences (`sources.priority`, `sources.disabled`, `sources.budget`, `sources.confidence`), with no Node
 * imports so the settings panel validates them with the code the server uses; the request counters live in ./ledger.ts.
 * @module web-search-pro/pipeline/sources-spec
 */
const isCount = (n) => typeof n === 'number' && Number.isFinite(n) && n >= 0;
function idList(value, name, diagnostics, known) {
    if (value === undefined || value === null)
        return [];
    if (!Array.isArray(value)) {
        diagnostics.push('sources.' + name + ' ignored: must be a list of source ids');
        return [];
    }
    const out = [];
    for (const raw of value) {
        const id = typeof raw === 'string' ? raw.trim() : '';
        if (!id || /[\s,]/.test(id)) {
            diagnostics.push('sources.' + name + ': "' + String(raw) + '" is not a source id');
            continue;
        }
        if (known && !known(id)) {
            diagnostics.push('sources.' + name + ': "' + id + '" is not a registered source (ignored)');
            continue;
        }
        if (!out.includes(id))
            out.push(id);
    }
    return out;
}
/**
 * Validate the preferences; invalid entries are dropped and reported, never thrown. `known` (optional) tells whether an
 * id is a registered provider: unknown ids are reported and dropped, so a typo cannot silently disable nothing.
 */
export function resolveSources(input, known, knownBackend) {
    const diagnostics = [];
    const priority = idList(input?.priority, 'priority', diagnostics, known);
    const disabled = idList(input?.disabled, 'disabled', diagnostics, known);
    for (const id of priority.filter(id => disabled.includes(id)))
        diagnostics.push('sources: "' + id + '" is both prioritised and disabled: disabled wins');
    const budget = {};
    const raw = input?.budget;
    if (raw !== undefined && raw !== null && (typeof raw !== 'object' || Array.isArray(raw)))
        diagnostics.push('sources.budget ignored: must be an object keyed by source id');
    else
        for (const [id, entry] of Object.entries(raw ?? {})) {
            if (known && !known(id)) {
                diagnostics.push('sources.budget.' + id + ' ignored: not a registered source');
                continue;
            }
            if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
                diagnostics.push('sources.budget.' + id + ' ignored: not an object');
                continue;
            }
            const cap = (value, axis) => {
                if (value === undefined || value === null)
                    return undefined;
                if (isCount(value))
                    return Math.floor(value);
                diagnostics.push('sources.budget.' + id + '.' + axis + ' ignored: must be a number >= 0');
                return undefined;
            };
            const total = cap(entry.total, 'total');
            const daily = cap(entry.daily, 'daily');
            if (total !== undefined || daily !== undefined)
                budget[id] = { ...total !== undefined ? { total } : {}, ...daily !== undefined ? { daily } : {} };
        }
    const confidence = {};
    const rawConfidence = input?.confidence;
    if (rawConfidence !== undefined && rawConfidence !== null && (typeof rawConfidence !== 'object' || Array.isArray(rawConfidence)))
        diagnostics.push('sources.confidence ignored: must be an object keyed by source id');
    else
        for (const [id, value] of Object.entries(rawConfidence ?? {})) {
            if (known && !known(id) && !knownBackend?.(id)) {
                diagnostics.push('sources.confidence.' + id + ' ignored: not a registered source or platform backend');
                continue;
            }
            if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
                diagnostics.push('sources.confidence.' + id + ' ignored: must be a number 0..1');
                continue;
            }
            confidence[id] = value;
        }
    return { priority, disabled, budget, confidence, diagnostics };
}
//# sourceMappingURL=sources-spec.js.map