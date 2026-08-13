/**
 * Plugin configuration (schemastery) and the resolved runtime shape.
 * @module web-search-pro/config
 */
import path from 'node:path';
import os from 'node:os';
import z from '@deepseek-ai/schemastery';
export const Config = z.object({
    dbPath: z.string(),
    ttlSeconds: z.number().default(3600),
    memoryCacheEntries: z.number().default(128),
    rrfConstant: z.number().default(60),
    searchMaxResults: z.number().default(8),
    timeoutMs: z.number().default(30_000),
    engines: z.array(z.string()).default(['ddg', 'bing', 'exa', 'seam', 'jina']),
    parallelEngines: z.boolean().default(false),
    exaApiKey: z.string().role('secret'),
    exaApiKeyEnv: z.string().default('EXA_API_KEY'),
    jinaApiKey: z.string().role('secret'),
    jinaApiKeyEnv: z.string().default('JINA_API_KEY'),
    enableCliBackends: z.boolean().default(true),
    opencliEnabled: z.boolean().default(true),
    agentReachEnabled: z.boolean().default(true),
    providerId: z.string().default('web-search-pro'),
    registerProvider: z.boolean().default(false),
    playwright: z.object({
        enabled: z.boolean().default(true),
        headless: z.boolean().default(true),
        channel: z.string().default('msedge'),
        storageStatePath: z.string(),
        modulePath: z.string(),
        snapshotDir: z.string(),
    }),
    verbose: z.boolean().default(false),
});
/** Default database path under the harness home. */
export function defaultDbPath() {
    const home = process.env.DSH_HOME ?? path.join(os.homedir(), '.dsh');
    return path.join(home, 'data', 'web-search-pro', 'store.db');
}
/** Resolve a fully-defaulted config from user input. */
export function resolveConfig(config) {
    const dbPath = config.dbPath ?? defaultDbPath();
    const pw = config.playwright ?? {};
    const snapshotDir = pw.snapshotDir ?? path.join(path.dirname(dbPath), 'snapshots');
    return {
        ...config,
        dbPath,
        exaApiKeyEnv: config.exaApiKeyEnv ?? 'EXA_API_KEY',
        jinaApiKeyEnv: config.jinaApiKeyEnv ?? 'JINA_API_KEY',
        playwright: {
            enabled: pw.enabled ?? true,
            headless: pw.headless ?? true,
            channel: pw.channel ?? 'msedge',
            snapshotDir,
            ...pw.storageStatePath !== undefined ? { storageStatePath: pw.storageStatePath } : {},
            ...pw.modulePath !== undefined ? { modulePath: pw.modulePath } : {},
        },
    };
}
//# sourceMappingURL=config.js.map