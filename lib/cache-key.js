import crypto from 'node:crypto';
function canonical(value) {
    if (Array.isArray(value))
        return value.map(canonical);
    if (value && typeof value === 'object') {
        return Object.fromEntries(Object.entries(value)
            .filter(([, v]) => v !== undefined)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([k, v]) => [k, canonical(v)]));
    }
    return value;
}
function fingerprint(kind, input) {
    return kind + ':v2:' + crypto.createHash('sha256').update(JSON.stringify(canonical(input))).digest('hex');
}
export function createSearchCacheKey(input) {
    return fingerprint('search', { ...input, query: input.query.trim().replace(/\s+/g, ' ').toLowerCase() });
}
export function createPlatformCacheKey(input) {
    return fingerprint('platform', { ...input, query: input.query.trim().replace(/\s+/g, ' ').toLowerCase() });
}
//# sourceMappingURL=cache-key.js.map