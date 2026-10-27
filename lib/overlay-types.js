/**
 * The agent overlay, pure half: the shapes the overlay file, the `config.*` actions and the settings card's RPC channel carry, and
 * the small helpers that name an overlay entry. The store that reads and writes the file is overlay.ts (Node); the card bundle
 * includes only this file. No imports.
 *
 * The overlay is a small managed file next to the plugin's database. It sits on top of the configuration the user owns (the
 * profile) and can hold only the settings an agent may change at run time: the engine order, the source priority and disabled
 * lists, the confidence of a source, the backend chain of a platform, and custom CLI adapter specs. Everything else stays
 * the user's: an agent cannot reach a key, a path, a switch or a budget through it.
 * @module web-search-pro/overlay-types
 */
export const OVERLAY_VERSION = 1;
export const OVERLAY_FILE = 'overlay.json';
/** The audit trail is cut to the newest entries, so the file stays small however long it lives. */
export const MAX_AUDIT_ENTRIES = 50;
export const MIN_REASON = 3;
export const MAX_REASON = 300;
/** What `config.reset` can drop. */
export const RESET_SCOPES = ['all', 'order', 'confidence', 'cli', 'platform'];
/** The keys an overlay holds, in a stable order. */
export function overlayKeys(values) {
    const keys = [];
    if (values.engines !== undefined)
        keys.push('engines');
    if (values.sources?.priority !== undefined)
        keys.push('sources.priority');
    if (values.sources?.disabled !== undefined)
        keys.push('sources.disabled');
    for (const id of Object.keys(values.sources?.confidence ?? {}))
        keys.push('sources.confidence.' + id);
    for (const platform of Object.keys(values.platformBackends ?? {}))
        keys.push('platformBackends.' + platform);
    for (const id of Object.keys(values.cliAdapters ?? {}))
        keys.push('cliAdapters.' + id);
    return keys;
}
/** Kind and target of an overlay key; undefined for a name that is not one. */
export function describeKey(key) {
    if (key === 'engines')
        return { kind: 'engines' };
    if (key === 'sources.priority')
        return { kind: 'priority' };
    if (key === 'sources.disabled')
        return { kind: 'disabled' };
    let match = /^sources\.confidence\.(.+)$/.exec(key);
    if (match)
        return { kind: 'confidence', target: match[1] };
    match = /^platformBackends\.(.+)$/.exec(key);
    if (match)
        return { kind: 'platform', target: match[1] };
    match = /^cliAdapters\.(.+)$/.exec(key);
    if (match)
        return { kind: 'cli', target: match[1] };
    return undefined;
}
export function clipText(text, max) {
    return text.length > max ? text.slice(0, max - 1) + '…' : text;
}
/**
 * Short text of a value for the audit trail and the card: a list is its items joined with `>` (order matters), a number is itself,
 * a CLI spec is its command and search arguments (what the program is and what it is asked), nothing is `(none)`.
 */
export function summarizeValue(key, value, max = 160) {
    if (value === undefined || value === null)
        return '(none)';
    if (Array.isArray(value))
        return clipText(value.length ? value.map(String).join(' > ') : '(empty)', max);
    if (typeof value === 'number' || typeof value === 'boolean')
        return String(value);
    if (typeof value === 'string')
        return clipText(value, max);
    if (typeof value === 'object' && key.startsWith('cliAdapters.'))
        return clipText(cliCommandLine(value), max);
    try {
        return clipText(JSON.stringify(value), max);
    }
    catch {
        return '(unprintable)';
    }
}
/** `<bins[0]> <search.argv...>`: the command a custom CLI spec would run for a search, with the placeholders as written. */
export function cliCommandLine(spec) {
    const bins = Array.isArray(spec.bins) ? spec.bins.filter((bin) => typeof bin === 'string') : [];
    const search = spec.search !== null && typeof spec.search === 'object' ? spec.search : {};
    const argv = Array.isArray(search.argv) ? search.argv.filter((token) => typeof token === 'string') : [];
    return [bins.join('|') || '(no command)', ...argv].join(' ');
}
//# sourceMappingURL=overlay-types.js.map