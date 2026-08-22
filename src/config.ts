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
  /** Optional raw Cookie header (`a=b; c=d`); cookies are applied to the URL's domain. */
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

export const Config: z<Config> = z.object({
  dbPath: z.string(),
  ttlSeconds: z.number().default(3600),
  memoryCacheEntries: z.number().default(128),
  rrfConstant: z.number().default(60),
  freshnessBoost: z.number().default(0.2),
  freshnessDays: z.number().default(30),
  authorityBoost: z.number().default(0.25),
  authorityDomains: z.array(z.string()).default([]),
  searchMaxResults: z.number().default(8),
  timeoutMs: z.number().default(30_000),
  engines: z.array(z.string()).default(['ddg', 'bing', 'exa', 'seam', 'jina']),
  parallelEngines: z.boolean().default(false),
  exaApiKey: z.string().role('secret'),
  exaApiKeyEnv: z.string().default('EXA_API_KEY'),
  jinaApiKey: z.string().role('secret'),
  jinaApiKeyEnv: z.string().default('JINA_API_KEY'),
  githubToken: z.string().role('secret'),
  githubTokenEnv: z.string().default('GITHUB_TOKEN'),
  enableCliBackends: z.boolean().default(true),
  opencliEnabled: z.boolean().default(true),
  agentReachEnabled: z.boolean().default(true),
  providerId: z.string().default('web-search-pro'),
  registerProvider: z.boolean().default(false),
  platformRules: z.dict(z.object({
    item: z.string(),
    title: z.string(),
    link: z.string(),
    text: z.string(),
  })),
  customPlatforms: z.dict(z.object({
    name: z.string(),
    url: z.string(),
    item: z.string(),
    title: z.string(),
    link: z.string(),
    text: z.string(),
    cookie: z.string(),
  })),
  browserBindings: z.dict(z.object({
    authProfile: z.string(),
    rulePack: z.string(),
  })),
  playwright: z.object({
    enabled: z.boolean().default(true),
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

/** Default database path under the harness home. */
export function defaultDbPath(): string {
  const home = process.env.DSH_HOME ?? path.join(os.homedir(), '.dsh')
  return path.join(home, 'data', 'web-search-pro', 'store.db')
}

/** Resolve a fully-defaulted config from user input. */
export function resolveConfig(config: Config): ResolvedConfig {
  const dbPath = config.dbPath ?? defaultDbPath()
  const pw = config.playwright ?? {}
  const snapshotDir = pw.snapshotDir ?? path.join(path.dirname(dbPath), 'snapshots')
  return {
    ...config,
    dbPath,
    exaApiKeyEnv: config.exaApiKeyEnv ?? 'EXA_API_KEY',
    jinaApiKeyEnv: config.jinaApiKeyEnv ?? 'JINA_API_KEY',
    githubTokenEnv: config.githubTokenEnv ?? 'GITHUB_TOKEN',
    playwright: {
      enabled: pw.enabled ?? true,
      snapshotDir,
    },
  }
}
