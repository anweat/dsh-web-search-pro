/**
 * Plugin configuration (schemastery) and the resolved runtime shape.
 * @module web-search-pro/config
 */

import path from 'node:path'
import os from 'node:os'
import z from '@deepseek-ai/schemastery'

/** A user-defined custom platform: search URL template + result selectors + optional login cookie. */
export interface CustomPlatformSpec {
  name: string
  /** Search-page URL template; `{query}` is replaced with the URL-encoded query. */
  url: string
  item: string
  title: string
  link: string
  text?: string
  /** Legacy raw Cookie header; prefer a domain-scoped dsh-browser AuthProfile. */
  cookie?: string
}

export interface BrowserBinding {
  /** Named dsh-browser auth profile. */
  authProfile?: string
  /** Named dsh-browser enhancement rule pack. */
  rulePack?: string
}

export interface Config {
  /** SQLite database path; defaults to $DSH_HOME/data/web-search-pro/store.db */
  dbPath?: string
  /** Cache freshness window in seconds. */
  ttlSeconds: number
  /** In-process LRU entry cap (hot queries resolve without touching SQLite). */
  memoryCacheEntries: number
  /** Reciprocal Rank Fusion constant for multi-engine merging. */
  rrfConstant: number
  /** Max recency bonus added to a source's fusion score (0..1). */
  freshnessBoost: number
  /** Days over which the recency bonus decays to zero. */
  freshnessDays: number
  /** Max authority-domain bonus added to a source's fusion score (0..1). */
  authorityBoost: number
  /** Extra authority domains (beyond the built-in .edu/.gov/.org and the curated list). */
  authorityDomains: string[]
  /** Default cap on returned sources per search. */
  searchMaxResults: number
  /** Cooperative per-call timeout budget in ms. */
  timeoutMs: number
  /** Trust Clash/TUN fake-IP DNS ranges while retaining all other SSRF checks. */
  allowProxyFakeIp: boolean
  /** Ordered engine list for web_search_pro. */
  engines: string[]
  /** Query all requested engines in parallel and merge. */
  parallelEngines: boolean
  /** Exa API key (falls back to $EXA_API_KEY / credentials ref). */
  exaApiKey?: string
  /** Credential/env reference for the Exa key; defaults to EXA_API_KEY. */
  exaApiKeyEnv?: string
  /** Jina AI API key (falls back to $JINA_API_KEY / credentials ref). */
  jinaApiKey?: string
  /** Credential/env reference for the Jina key; defaults to JINA_API_KEY. */
  jinaApiKeyEnv?: string
  /** GitHub API token for the REST search engines (falls back to $GITHUB_TOKEN / $GH_TOKEN / credentials ref). */
  githubToken?: string
  /** Credential/env reference for the GitHub token; defaults to GITHUB_TOKEN. */
  githubTokenEnv?: string
  /** Allow CLI backends (bili / yt-dlp / opencli / agent-reach). */
  enableCliBackends: boolean
  /** Allow opencli browser-session backends. */
  opencliEnabled: boolean
  /** Allow agent-reach backends. */
  agentReachEnabled: boolean
  /** Provider id registered into ctx.web for the built-in web_search tool. */
  providerId: string
  /** Register the ctx.web provider (set DSH_WEB_SEARCH_PROVIDER to use it). */
  registerProvider: boolean
  /** Per-platform search-page selector overrides (item/title/link/text). Overrides built-in specs. */
  platformRules?: Record<string, { item: string; title: string; link: string; text?: string }>
  /** User-defined custom platform search: url template + selectors + optional cookie. */
  customPlatforms?: Record<string, CustomPlatformSpec>
  /** Per-platform binding to domain-scoped dsh-browser auth/rule profiles. */
  browserBindings?: Record<string, BrowserBinding>
  /** Snapshot options. The browser runtime itself (channel/headless/storageStatePath) is provided by the dsh-browser plugin via the `browser` service. */
  playwright: {
    /** Gate the playwright fallback backend in web_fetch_pro. */
    enabled: boolean
    /** Directory for web_snapshot artifacts; defaults to <dbDir>/snapshots. */
    snapshotDir?: string
  }
  verbose: boolean
}

// The volatile() modifier changes each live field's output type to
// Volatile<T> (a readonly array-like snapshot with get()), which is not
// structurally assignable to the plain input shape. Cordis only reads
// `~standard`/`toJSON` from the runtime object, so the annotation stays
// untyped and the exact volatile wrapper shape is left to inference.
// The cosmokit import below exists solely so the emitted .d.ts can name the
// inferred Volatile types without a non-portable pnpm path reference.
import type { Volatile } from '@deepseek-ai/cosmokit'
void ({} as Volatile<unknown>)
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
})

export interface ResolvedConfig extends Config {
  dbPath: string
  exaApiKey?: string
  exaApiKeyEnv: string
  jinaApiKey?: string
  jinaApiKeyEnv: string
  githubTokenEnv: string
  playwright: Required<Pick<Config['playwright'], 'enabled' | 'snapshotDir'>>
}

/** Read a possibly-volatile config field (schemastery `Volatile<T>` wraps live fields). */
function v<T>(value: T | { get(): T }): T {
  return value !== null && typeof value === 'object' && 'get' in value ? (value as { get(): T }).get() : (value as T)
}

/** Read a volatile field, defaulting when the field is absent. */
function vOr<T>(value: T | { get(): T } | undefined, fallback: T): T {
  if (value === undefined || value === null) return fallback
  return v(value)
}

/** Default database path under the harness home. */
export function defaultDbPath(): string {
  const home = process.env.DSH_HOME ?? path.join(os.homedir(), '.dsh')
  return path.join(home, 'data', 'web-search-pro', 'store.db')
}

/** Resolve a fully-defaulted config from user input. Unwraps volatile fields (schemastery `Volatile<T>`) into plain values so consumers never see the wrapper. */
export function resolveConfig(config: Config): ResolvedConfig {
  const dbPath = vOr(config.dbPath, defaultDbPath())
  const pw = config.playwright ?? {}
  const snapshotDir = vOr(pw.snapshotDir, path.join(path.dirname(dbPath), 'snapshots'))
  return {
    ...config,
    dbPath,
    ttlSeconds: vOr(config.ttlSeconds, 3600) as number,
    memoryCacheEntries: vOr(config.memoryCacheEntries, 128) as number,
    rrfConstant: vOr(config.rrfConstant, 60) as number,
    freshnessBoost: vOr(config.freshnessBoost, 0.2) as number,
    freshnessDays: vOr(config.freshnessDays, 30) as number,
    authorityBoost: vOr(config.authorityBoost, 0.25) as number,
    authorityDomains: vOr(config.authorityDomains, [] as string[]) as string[],
    searchMaxResults: vOr(config.searchMaxResults, 8) as number,
    allowProxyFakeIp: vOr(config.allowProxyFakeIp, false) as boolean,
    engines: vOr(config.engines, ['ddg', 'bing', 'exa', 'seam', 'jina']) as string[],
    parallelEngines: vOr(config.parallelEngines, false) as boolean,
    exaApiKey: config.exaApiKey !== undefined ? v(config.exaApiKey) : undefined,
    exaApiKeyEnv: vOr(config.exaApiKeyEnv, 'EXA_API_KEY') as string,
    jinaApiKey: config.jinaApiKey !== undefined ? v(config.jinaApiKey) : undefined,
    jinaApiKeyEnv: vOr(config.jinaApiKeyEnv, 'JINA_API_KEY') as string,
    githubToken: config.githubToken !== undefined ? v(config.githubToken) : undefined,
    githubTokenEnv: vOr(config.githubTokenEnv, 'GITHUB_TOKEN') as string,
    enableCliBackends: vOr(config.enableCliBackends, true) as boolean,
    opencliEnabled: vOr(config.opencliEnabled, true) as boolean,
    agentReachEnabled: vOr(config.agentReachEnabled, true) as boolean,
    platformRules: config.platformRules !== undefined ? v(config.platformRules) : undefined,
    customPlatforms: config.customPlatforms !== undefined ? v(config.customPlatforms) : undefined,
    browserBindings: config.browserBindings !== undefined ? v(config.browserBindings) : undefined,
    playwright: {
      enabled: vOr(pw.enabled, true) as boolean,
      snapshotDir,
    },
  }
}
