/**
 * Shared descriptor defaults of the built-in providers (web engines in builtin.ts, platforms in platforms.ts).
 * @module web-search-pro/providers/descriptor
 */
export const FREE = { kind: 'free' };
export function descriptor(d) {
    return {
        aliases: [d.id.replace(/^builtin:/, '')],
        adapterVersion: '1',
        contractVersion: 1,
        operations: ['search'],
        taskProfiles: [],
        languages: ['*'],
        regions: ['global'],
        resultKinds: ['web'],
        requirements: [],
        supportedFilters: [],
        costModel: FREE,
        costTier: 'anonymous',
        verification: { live: true, note: 'shipped before the registry; exercised by the plugin since 0.1' },
        ...d,
    };
}
//# sourceMappingURL=descriptor.js.map