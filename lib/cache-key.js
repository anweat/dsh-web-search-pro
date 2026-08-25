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
    return kind + ':v3:' + crypto.createHash('sha256').update(JSON.stringify(canonical(input))).digest('hex');
}
export function createSearchCacheKey(input) {
    const { count: _count, ...stable } = input;
    return fingerprint('search', { ...stable, query: input.query.trim().replace(/\s+/g, ' ').toLowerCase() });
}
export function createPlatformCacheKey(input) {
    const { count: _count, ...stable } = input;
    return fingerprint('platform', { ...stable, query: input.query.trim().replace(/\s+/g, ' ').toLowerCase() });
}
//# sourceMappingURL=cache-key.js.map