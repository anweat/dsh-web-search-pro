/**
 * Plugin configuration (schemastery) and the resolved runtime shape.
 * @module web-search-pro/config
 */
import path from 'node:path';
import os from 'node:os';
import z from '@deepseek-ai/schemastery';
void {};
export const Config = z.object({
    dbPath: z.string(),
    ttlSeconds: z.number().default(3600).volatile(),
    memoryCacheEntries: z.number().default(128),
    rrfConstant: z.number().default(60).volatile(),
    freshnessBoost: z.number().default(0.2).volatile(),
    freshnessDays: z.number().default(30).volatile(),
    authorityBoost: z.number().default(0.25).volatile(),
    authorityDomains: z.array(z.string()).default([]).volatile(),
    searchMaxResults: z.number().default(8).volatile(),
    timeoutMs: z.number().default(30_000),
    allowProxyFakeIp: z.boolean().default(false).volatile(),
    engines: z.array(z.string()).default(['ddg', 'bing', 'exa', 'seam', 'jina']).volatile(),
    parallelEngines: z.boolean().default(false).volatile(),
    exaApiKey: z.string().role('secret').volatile(),
    exaApiKeyEnv: z.string().default('EXA_API_KEY').volatile(),
    jinaApiKey: z.string().role('secret').volatile(),
    jinaApiKeyEnv: z.string().default('JINA_API_KEY').volatile(),
    githubToken: z.string().role('secret').volatile(),
    githubTokenEnv: z.string().default('GITHUB_TOKEN').volatile(),
    enableCliBackends: z.boolean().default(true).volatile(),
    opencliEnabled: z.boolean().default(true).volatile(),
    agentReachEnabled: z.boolean().default(true).volatile(),
    providerId: z.string().default('web-search-pro'),
    registerProvider: z.boolean().default(false),
    platformRules: z.dict(z.object({
        item: z.string(),
        title: z.string(),
        link: z.string(),
        text: z.string(),
    })).volatile(),
    customPlatforms: z.dict(z.object({
        name: z.string(),
        url: z.string(),
        item: z.string(),
        title: z.string(),
        link: z.string(),
        text: z.string(),
        cookie: z.string().role('secret'),
    })).volatile(),
    browserBindings: z.dict(z.object({
        authProfile: z.string(),
        rulePack: z.string(),
    })).volatile(),
    playwright: z.object({
        enabled: z.boolean().default(true).volatile(),
        snapshotDir: z.string(),
    }),
    verbose: z.boolean().default(false),
});
/** Read a possibly-volatile config field (schemastery `Volatile<T>` wraps live fields). */
function v(value) {
    return value !== null && typeof value === 'object' && 'get' in value ? value.get() : value;
}
/** Read a volatile field, defaulting when the field is absent. */
function vOr(value, fallback) {
    if (value === undefined || value === null)
        return fallback;
    return v(value);
}
/** Default database path under the harness home. */
export function defaultDbPath() {
    const home = process.env.DSH_HOME ?? path.join(os.homedir(), '.dsh');
    return path.join(home, 'data', 'web-search-pro', 'store.db');
}
/** Resolve a fully-defaulted config from user input. Unwraps volatile fields (schemastery `Volatile<T>`) into plain values so consumers never see the wrapper. */
export function resolveConfig(config) {
    const dbPath = vOr(config.dbPath, defaultDbPath());
    const pw = config.playwright ?? {};
    const snapshotDir = vOr(pw.snapshotDir, path.join(path.dirname(dbPath), 'snapshots'));
    return {
        ...config,
        dbPath,
        ttlSeconds: vOr(config.ttlSeconds, 3600),
        memoryCacheEntries: vOr(config.memoryCacheEntries, 128),
        rrfConstant: vOr(config.rrfConstant, 60),
        freshnessBoost: vOr(config.freshnessBoost, 0.2),
        freshnessDays: vOr(config.freshnessDays, 30),
        authorityBoost: vOr(config.authorityBoost, 0.25),
        authorityDomains: vOr(config.authorityDomains, []),
        searchMaxResults: vOr(config.searchMaxResults, 8),
        allowProxyFakeIp: vOr(config.allowProxyFakeIp, false),
        engines: vOr(config.engines, ['ddg', 'bing', 'exa', 'seam', 'jina']),
        parallelEngines: vOr(config.parallelEngines, false),
        exaApiKey: config.exaApiKey !== undefined ? v(config.exaApiKey) : undefined,
        exaApiKeyEnv: vOr(config.exaApiKeyEnv, 'EXA_API_KEY'),
        jinaApiKey: config.jinaApiKey !== undefined ? v(config.jinaApiKey) : undefined,
        jinaApiKeyEnv: vOr(config.jinaApiKeyEnv, 'JINA_API_KEY'),
        githubToken: config.githubToken !== undefined ? v(config.githubToken) : undefined,
        githubTokenEnv: vOr(config.githubTokenEnv, 'GITHUB_TOKEN'),
        enableCliBackends: vOr(config.enableCliBackends, true),
        opencliEnabled: vOr(config.opencliEnabled, true),
        agentReachEnabled: vOr(config.agentReachEnabled, true),
        platformRules: config.platformRules !== undefined ? v(config.platformRules) : undefined,
        customPlatforms: config.customPlatforms !== undefined ? v(config.customPlatforms) : undefined,
        browserBindings: config.browserBindings !== undefined ? v(config.browserBindings) : undefined,
        playwright: {
            enabled: vOr(pw.enabled, true),
            snapshotDir,
        },
    };
}
//# sourceMappingURL=config.js.map