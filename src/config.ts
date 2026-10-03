/**
 * Plugin configuration (schemastery) and the resolved runtime shape.
 * @module web-search-pro/config
 */

import path from 'node:path'
import os from 'node:os'
import z from '@deepseek-ai/schemastery'
import type { JudgeSettings } from './pipeline/judges/providers.ts'
import type { BudgetInput } from './pipeline/ledger.ts'
import type { RubricOverride } from './pipeline/rubrics.ts'

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

/** Evidence-pipeline settings (search.run with `task` / `profile`; dev-plan M2b). */
export interface EvidenceConfig {
  /**
   * Scorer for S6 decisions. `jev` only takes effect with `jevMode: 'control'`:
   * Jev is a paid hosted service, so it needs both keys turned.
   */
  scorer: 'rule' | 'jev'
  /**
   * `off`: never call Jev. `shadow`: the rule scorer decides, Jev scores are recorded for comparison.
   * `control`: Jev decides when `scorer` is `jev`; any Jev failure falls back to the rule scorer.
   * `hybrid`: the rule scorer grades everything and Jev re-scores only the (need, block) pairs whose languages differ
   * (plus rule-borderline ones with `hybridBorderline`), within `maxJevQuestions`; a Jev failure keeps the rule grades. Ignores `scorer`.
   */
  jevMode: 'off' | 'shadow' | 'control' | 'hybrid'
  /** `hybrid` only: also let Jev re-score pairs whose rule grade is 1 (borderline), after the language-mismatch pairs. */
  hybridBorderline: boolean
  /** Upper bound of (need, block) questions sent to Jev per search. */
  maxJevQuestions: number
  /**
   * S1 promotes registry providers that are strong in the task's language (Bocha for Chinese, Exa for English) and ready
   * (key configured) ahead of the profile table. Default true; false keeps the profile table / configured `engines` as they are.
   */
  autoProviders: boolean
  /** Retrieval rounds per task (S8 bounded re-search): 1 disables the second round. Default 2. */
  maxRounds: number
  /** Search requests per task over all rounds (a second round only runs while this is not used up). Default 4. */
  maxQueries: number
  /**
   * Per-rubric overrides of the judge prompts, keyed by rubric id (`score.support`, `gate.relevance`, `gate.constraint`).
   * Each carries its own `version`; an override that fails validation is ignored and the built-in used (see pipeline/rubrics.ts).
   * Remove the entry to restore the default.
   */
  rubrics?: Record<string, RubricOverride>
  /**
   * Which model judge S6 uses and where it lives (dev-plan M5). Absent = the built-in `bocha-jev` preset.
   * `mode` is the provider-neutral name of `jevMode` (it wins when both are set; `control` then needs no `scorer`).
   */
  judge?: JudgeSettings & { mode?: EvidenceConfig['jevMode'] }
  /** Model usage caps (input tokens) per search and per day, with per-provider overrides. Absent = 60k per search, 1M per day. */
  budget?: BudgetInput
}

/** `indexed` registers web_index + web_call; `flat` registers one tool per action (comparison and debugging only). */
export const TOOL_SURFACES = ['indexed', 'flat'] as const
export type ToolSurface = typeof TOOL_SURFACES[number]

export function resolveToolSurface(value: unknown): ToolSurface {
  const surface = value ?? 'indexed'
  if (typeof surface !== 'string' || !TOOL_SURFACES.includes(surface as ToolSurface)) throw new Error('toolSurface must be one of: ' + TOOL_SURFACES.join(', '))
  return surface as ToolSurface
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
  /**
   * Recency bonus, as a fraction (0..1) of ONE TOP-RANK STEP on the normalised
   * fusion scale (pipeline/fusion.ts): added once per URL, so even at 1 a fresh
   * result gains about one rank position, and at the default it is a tie-breaker.
   */
  freshnessBoost: number
  /** Days over which the recency bonus decays to zero. */
  freshnessDays: number
  /**
   * Authority-domain bonus, same scale and once-per-URL rule as `freshnessBoost`:
   * it cannot lift a rank-10 result over a rank-1 result of the same engine.
   */
  authorityBoost: number
  /** Extra authority domains (beyond the built-in .edu/.gov/.org and the curated list). */
  authorityDomains: string[]
  /** Default cap on returned sources per search. */
  searchMaxResults: number
  /**
   * Default output cap (characters) of one `read.fetch` call. Longer pages are cut here and
   * continued with `offset`; the ctx.web fetch provider (which cannot be told a size) uses twice this.
   */
  fetchDefaultChars: number
  /** `read.contents`: output cap per URL (characters). */
  exaContentsPerUrlChars: number
  /** `read.contents`: output cap over all URLs of one call (characters); shared fairly between them. */
  exaContentsTotalChars: number
  /** Tool surface: `indexed` (default) keeps only web_index / web_call in context; `flat` registers one tool per action. Applied at startup. */
  toolSurface?: ToolSurface
  /** Cooperative per-call timeout budget in ms. */
  timeoutMs: number
  /** Trust Clash/TUN fake-IP DNS answers (198.18/15, fdfe:dcba:9876::/64, 2001:2::/48) while retaining all other SSRF checks. */
  allowProxyFakeIp: boolean
  /** Ordered engine list for search.run. */
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
  /** Bocha web-search API key (falls back to the credentials ref / $BOCHA_SEARCH_API_KEY, then $BOCHA_JEV_API_KEY of the same account). */
  bochaApiKey?: string
  /** Credential/env reference for the Bocha search key; defaults to BOCHA_SEARCH_API_KEY. */
  bochaApiKeyEnv?: string
  /** Bocha endpoint base (`/v1/web-search` is appended); defaults to https://api.bochaai.com. */
  bochaBaseUrl?: string
  /** Ask Bocha for its longer per-page summary (default true). */
  bochaSummary?: boolean
  /** Self-hosted SearXNG instance URL (JSON format enabled); the `searxng` engine is available only when set. No public instance is built in. */
  searxngUrl?: string
  /** Contact address put in the User-Agent of OpenAlex requests (etiquette; optional). */
  openalexMailto?: string
  /**
   * Keyed search sources by route id (`tavily`, `brave`, `linkup`, `serper`, `metaso`, `zhipu`, `baidu-qianfan`): the key literal,
   * the credentials ref / environment variable name (default e.g. TAVILY_API_KEY), and an optional endpoint base override.
   * A source without a key is `credential: missing` and not executable.
   */
  keyedSources?: Record<string, { apiKey?: string; apiKeyEnv?: string; baseUrl?: string }>
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
    /** Gate the playwright fallback backend in read.fetch. */
    enabled: boolean
    /** Directory for read.snapshot artifacts; defaults to <dbDir>/snapshots. */
    snapshotDir?: string
  }
  /** Evidence pipeline (S6 scoring). */
  evidence?: Partial<EvidenceConfig>
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
  dbPath: z.string().volatile(),
  toolSurface: z.string().default('indexed').volatile(),
  ttlSeconds: z.number().default(3600).volatile(),
  memoryCacheEntries: z.number().default(128).volatile(),
  rrfConstant: z.number().default(60).volatile(),
  freshnessBoost: z.number().default(0.2).volatile(),
  freshnessDays: z.number().default(30).volatile(),
  authorityBoost: z.number().default(0.25).volatile(),
  authorityDomains: z.array(z.string()).default([]).volatile(),
  searchMaxResults: z.number().default(8).volatile(),
  fetchDefaultChars: z.number().default(20_000).volatile(),
  exaContentsPerUrlChars: z.number().default(8_000).volatile(),
  exaContentsTotalChars: z.number().default(30_000).volatile(),
  timeoutMs: z.number().default(30_000).volatile(),
  allowProxyFakeIp: z.boolean().default(false).volatile(),
  engines: z.array(z.string()).default(['ddg', 'bing', 'exa', 'seam', 'jina']).volatile(),
  parallelEngines: z.boolean().default(false).volatile(),
  exaApiKey: z.string().role('secret').volatile(),
  exaApiKeyEnv: z.string().default('EXA_API_KEY').volatile(),
  jinaApiKey: z.string().role('secret').volatile(),
  jinaApiKeyEnv: z.string().default('JINA_API_KEY').volatile(),
  bochaApiKey: z.string().role('secret').volatile(),
  bochaApiKeyEnv: z.string().default('BOCHA_SEARCH_API_KEY').volatile(),
  bochaBaseUrl: z.string().default('https://api.bochaai.com').volatile(),
  bochaSummary: z.boolean().default(true).volatile(),
  searxngUrl: z.string().volatile(),
  openalexMailto: z.string().volatile(),
  keyedSources: z.dict(z.object({
    apiKey: z.string().role('secret'),
    apiKeyEnv: z.string(),
    baseUrl: z.string(),
  })).volatile(),
  githubToken: z.string().role('secret').volatile(),
  githubTokenEnv: z.string().default('GITHUB_TOKEN').volatile(),
  enableCliBackends: z.boolean().default(true).volatile(),
  opencliEnabled: z.boolean().default(true).volatile(),
  agentReachEnabled: z.boolean().default(true).volatile(),
  providerId: z.string().default('web-search-pro').volatile(),
  registerProvider: z.boolean().default(false).volatile(),
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
  evidence: z.object({
    scorer: z.union(['rule', 'jev']).default('rule').volatile(),
    jevMode: z.union(['off', 'shadow', 'control', 'hybrid']).default('off').volatile(),
    hybridBorderline: z.boolean().default(false).volatile(),
    maxJevQuestions: z.number().default(64).volatile(),
    autoProviders: z.boolean().default(true).volatile(),
    maxRounds: z.number().default(2).volatile(),
    maxQueries: z.number().default(4).volatile(),
    rubrics: z.dict(z.object({
      version: z.string(),
      instructions: z.string(),
      criteria: z.array(z.string()),
      maxStateChars: z.number(),
      maxCandidateChars: z.number(),
    })).volatile(),
    judge: z.object({
      provider: z.string(),
      mode: z.union(['off', 'shadow', 'control', 'hybrid']),
      allowLlm: z.boolean(),
      providers: z.dict(z.object({
        protocol: z.union(['systemone', 'rerank', 'llm']),
        baseUrl: z.string(),
        model: z.string(),
        keyRef: z.string(),
        path: z.string(),
        rubricId: z.string(),
        tokenModel: z.union(['expanded', 'plain']),
        label: z.string(),
        limits: z.dict(z.number()),
        calibration: z.object({ version: z.string(), points: z.array(z.array(z.number())) }),
        extraBody: z.dict(z.any()),
        price: z.object({ inputPerMTokens: z.number(), outputPerMTokens: z.number(), currency: z.string() }),
      })),
    }).volatile(),
    budget: z.object({
      perSearchInputTokens: z.number(),
      dailyInputTokens: z.number(),
      timezone: z.string(),
      providers: z.dict(z.object({ perSearchInputTokens: z.number(), dailyInputTokens: z.number() })),
    }).volatile(),
  }),
  verbose: z.boolean().default(false).volatile(),
})

export interface ResolvedConfig extends Config {
  dbPath: string
  toolSurface: ToolSurface
  exaApiKey?: string
  exaApiKeyEnv: string
  jinaApiKey?: string
  jinaApiKeyEnv: string
  githubTokenEnv: string
  bochaApiKey?: string
  bochaApiKeyEnv: string
  bochaBaseUrl: string
  bochaSummary: boolean
  searxngUrl?: string
  openalexMailto?: string
  keyedSources?: Config['keyedSources']
  playwright: Required<Pick<Config['playwright'], 'enabled' | 'snapshotDir'>>
  evidence: EvidenceConfig
}

/** Read a possibly-volatile config field (schemastery `Volatile<T>` wraps live fields). */
function v<T>(value: T | { get(): T }): T {
  return value !== null && typeof value === 'object' && 'get' in value ? (value as { get(): T }).get() : (value as T)
}

/** Read a volatile field, defaulting when the field is absent. */
function vOr<T>(value: T | { get(): T } | undefined, fallback: T): T {
  if (value === undefined || value === null) return fallback
  const current = v(value)
  return current === undefined || current === null ? fallback : current
}

/** Default database path under the harness home. */
export function defaultDbPath(): string {
  const home = process.env.DSH_HOME ?? path.join(os.homedir(), '.dsh')
  return path.join(home, 'data', 'web-search-pro', 'store.db')
}

/** Resolve a fully-defaulted config from user input. Unwraps volatile fields (schemastery `Volatile<T>`) into plain values so consumers never see the wrapper. */
export function resolveConfig(config: Config): ResolvedConfig {
  const dbPath = vOr(config.dbPath, defaultDbPath())
  const pw: Partial<Config['playwright']> = config.playwright ?? {}
  const snapshotDir = vOr(pw.snapshotDir, path.join(path.dirname(dbPath), 'snapshots'))
  const ev: Partial<EvidenceConfig> = config.evidence ?? {}
  return {
    ...config,
    dbPath,
    toolSurface: resolveToolSurface(vOr(config.toolSurface as unknown, 'indexed')),
    ttlSeconds: vOr(config.ttlSeconds, 3600) as number,
    memoryCacheEntries: vOr(config.memoryCacheEntries, 128) as number,
    rrfConstant: vOr(config.rrfConstant, 60) as number,
    freshnessBoost: vOr(config.freshnessBoost, 0.2) as number,
    freshnessDays: vOr(config.freshnessDays, 30) as number,
    authorityBoost: vOr(config.authorityBoost, 0.25) as number,
    authorityDomains: vOr(config.authorityDomains, [] as string[]) as string[],
    searchMaxResults: vOr(config.searchMaxResults, 8) as number,
    fetchDefaultChars: vOr(config.fetchDefaultChars, 20_000) as number,
    exaContentsPerUrlChars: vOr(config.exaContentsPerUrlChars, 8_000) as number,
    exaContentsTotalChars: vOr(config.exaContentsTotalChars, 30_000) as number,
    timeoutMs: vOr(config.timeoutMs, 30_000) as number,
    allowProxyFakeIp: vOr(config.allowProxyFakeIp, false) as boolean,
    engines: vOr(config.engines, ['ddg', 'bing', 'exa', 'seam', 'jina']) as string[],
    parallelEngines: vOr(config.parallelEngines, false) as boolean,
    exaApiKey: config.exaApiKey !== undefined ? v(config.exaApiKey) : undefined,
    exaApiKeyEnv: vOr(config.exaApiKeyEnv, 'EXA_API_KEY') as string,
    jinaApiKey: config.jinaApiKey !== undefined ? v(config.jinaApiKey) : undefined,
    jinaApiKeyEnv: vOr(config.jinaApiKeyEnv, 'JINA_API_KEY') as string,
    bochaApiKey: config.bochaApiKey !== undefined ? v(config.bochaApiKey) : undefined,
    bochaApiKeyEnv: vOr(config.bochaApiKeyEnv, 'BOCHA_SEARCH_API_KEY') as string,
    bochaBaseUrl: vOr(config.bochaBaseUrl, 'https://api.bochaai.com') as string,
    bochaSummary: vOr(config.bochaSummary, true) as boolean,
    searxngUrl: config.searxngUrl !== undefined ? v(config.searxngUrl) : undefined,
    openalexMailto: config.openalexMailto !== undefined ? v(config.openalexMailto) : undefined,
    keyedSources: config.keyedSources !== undefined ? v(config.keyedSources) : undefined,
    githubToken: config.githubToken !== undefined ? v(config.githubToken) : undefined,
    githubTokenEnv: vOr(config.githubTokenEnv, 'GITHUB_TOKEN') as string,
    enableCliBackends: vOr(config.enableCliBackends, true) as boolean,
    opencliEnabled: vOr(config.opencliEnabled, true) as boolean,
    agentReachEnabled: vOr(config.agentReachEnabled, true) as boolean,
    providerId: vOr(config.providerId, 'web-search-pro') as string,
    registerProvider: vOr(config.registerProvider, false) as boolean,
    platformRules: config.platformRules !== undefined ? v(config.platformRules) : undefined,
    customPlatforms: config.customPlatforms !== undefined ? v(config.customPlatforms) : undefined,
    browserBindings: config.browserBindings !== undefined ? v(config.browserBindings) : undefined,
    playwright: {
      enabled: vOr(pw.enabled, true) as boolean,
      snapshotDir,
    },
    evidence: {
      scorer: vOr(ev.scorer, 'rule') as EvidenceConfig['scorer'],
      jevMode: vOr(ev.jevMode, 'off') as EvidenceConfig['jevMode'],
      hybridBorderline: vOr(ev.hybridBorderline, false) as boolean,
      maxJevQuestions: vOr(ev.maxJevQuestions, 64) as number,
      autoProviders: vOr(ev.autoProviders, true) as boolean,
      maxRounds: vOr(ev.maxRounds, 2) as number,
      maxQueries: vOr(ev.maxQueries, 4) as number,
      ...ev.rubrics !== undefined && v(ev.rubrics) ? { rubrics: v(ev.rubrics) as Record<string, RubricOverride> } : {},
      ...ev.judge !== undefined && v(ev.judge) ? { judge: v(ev.judge) as NonNullable<EvidenceConfig['judge']> } : {},
      ...ev.budget !== undefined && v(ev.budget) ? { budget: v(ev.budget) as NonNullable<EvidenceConfig['budget']> } : {},
    },
    verbose: vOr(config.verbose, false) as boolean,
  }
}
