/**
 * Which dictionary entry names a field, which fields carry a `?` text of their own, and the facts about the sources the
 * card lists. Pure data (no imports): the rows, the text view and the tests all read it.
 * @module web-search-pro/client/field-keys
 */

import { KEYED_SOURCE_ENVS } from '../providers/keyed-meta.ts'

/** Dictionary key of the label of a field; the hint is `<key>Hint` and the `?` text `<key>Help`. */
const EXPLICIT: Readonly<Record<string, string>> = {
  'evidence.autoProviders': 'evAutoProviders', 'evidence.sourcePolicy': 'sourcePolicy', 'evidence.maxRounds': 'evMaxRounds', 'evidence.maxQueries': 'evMaxQueries',
  'evidence.judge.mode': 'judgeMode', 'evidence.hybridBorderline': 'hybridBorderline', 'evidence.judge.provider': 'judgeProvider', 'evidence.maxJevQuestions': 'maxJevQuestions',
  'evidence.judge.allowLlm': 'allowLlm', 'evidence.judge.providers': 'judgeProviders', 'evidence.coverage.mode': 'coverageMode', 'evidence.coverage.provider': 'coverageProvider',
  'evidence.coverage.thresholds.weak': 'thresholdWeak', 'evidence.coverage.thresholds.covered': 'thresholdCovered',
  'evidence.budget.perSearchInputTokens': 'budgetPerSearch', 'evidence.budget.dailyInputTokens': 'budgetDaily', 'evidence.budget.timezone': 'budgetTimezone', 'evidence.budget.providers': 'budgetProviders',
  'provider.evidence': 'providerEvidence', 'provider.deadlineMs': 'providerDeadlineMs', 'sources.priority': 'srcPriority', 'sources.disabled': 'srcDisabled',
}

export function labelKey(field: string): string {
  const named = EXPLICIT[field]
  if (named) return named
  if (/^keyedSources\..+\.apiKeyEnv$/.test(field)) return 'keyedEnv'
  if (/^keyedSources\..+\.baseUrl$/.test(field)) return 'keyedBaseUrl'
  if (/^sources\.budget\..+\.total$/.test(field)) return 'reqTotal'
  if (/^sources\.budget\..+\.daily$/.test(field)) return 'reqDaily'
  if (/^sources\.confidence\..+$/.test(field)) return 'srcConfidence'
  return field
}

/** The fields whose dictionary has a `<key>Help` text (a longer explanation behind the `?`). */
export const WITH_HELP: ReadonlySet<string> = new Set([
  'engines', 'toolSurface', 'allowProxyFakeIp', 'deepseekFetch', 'registerProvider', 'evidence.sourcePolicy', 'sources.priority', 'sources.disabled', 'evidence.judge.mode', 'evidence.hybridBorderline',
  'evidence.judge.allowLlm', 'evidence.coverage.mode', 'evidence.coverage.thresholds.weak', 'rrfConstant', 'freshnessBoost', 'authorityBoost', 'enableCliBackends', 'opencliEnabled', 'agentReachEnabled',
  'evidence.autoProviders', 'timeoutMs', 'ttlSeconds', 'sources.budget.total', 'sources.budget.daily', 'bochaSummary',
])

/** `?` text applies to the generic budget keys too. */
export const hasHelp = (field: string): boolean => WITH_HELP.has(field) || WITH_HELP.has(field.replace(/^sources\.budget\..+\.(total|daily)$/, 'sources.budget.$1'))

export type SourceTier = 'paid' | 'free-quota' | 'anonymous'

/** One source the "Sources" list shows and its edit dialog is made of. */
export interface SourceDef {
  id: string
  name: string
  tier: SourceTier
  /** "常用": the plugin's recommended source (pinned to the registry descriptors by a test). */
  common?: boolean
  /** The write-only key of the source (`CredentialId`), and the field naming the credential / variable it is stored under. */
  credential?: string
  envField?: string
  defaultEnv?: string
  baseUrlField?: string
  /** Other fields the dialog holds, in order. */
  extra?: readonly string[]
  /** The request budget of the source (`sources.budget.<id>.total|daily`). */
  budget?: boolean
}

const keyed = (id: string, name: string, tier: SourceTier, extra: Partial<SourceDef> = {}): SourceDef => ({
  id, name, tier, credential: `keyed:${id}`, envField: `keyedSources.${id}.apiKeyEnv`, defaultEnv: KEYED_SOURCE_ENVS[id]![0]!, baseUrlField: `keyedSources.${id}.baseUrl`, budget: true, ...extra,
})

export const SOURCE_DEFS: readonly SourceDef[] = [
  keyed('deepseek', 'DeepSeek Search / Fetch', 'paid', { common: true }),
  { id: 'bocha', name: '博查 Bocha', tier: 'paid', credential: 'bocha', envField: 'bochaApiKeyEnv', defaultEnv: 'BOCHA_SEARCH_API_KEY', baseUrlField: 'bochaBaseUrl', extra: ['bochaSummary'], budget: true },
  keyed('tavily', 'Tavily', 'free-quota'),
  keyed('brave', 'Brave Search', 'free-quota'),
  keyed('linkup', 'Linkup', 'free-quota'),
  keyed('serper', 'Serper (Google)', 'free-quota'),
  keyed('metaso', '秘塔 Metaso', 'paid'),
  keyed('zhipu', '智谱 Zhipu', 'paid'),
  keyed('baidu-qianfan', '百度千帆 Baidu Qianfan', 'free-quota'),
  { id: 'exa', name: 'Exa', tier: 'free-quota', credential: 'exa', envField: 'exaApiKeyEnv', defaultEnv: 'EXA_API_KEY' },
  { id: 'jina', name: 'Jina AI', tier: 'free-quota', credential: 'jina', envField: 'jinaApiKeyEnv', defaultEnv: 'JINA_API_KEY' },
  { id: 'github', name: 'GitHub', tier: 'anonymous', credential: 'github', envField: 'githubTokenEnv', defaultEnv: 'GITHUB_TOKEN' },
  { id: 'searxng', name: 'SearXNG', tier: 'anonymous', extra: ['searxngUrl'] },
]

/** Fields of a source dialog in display order (the key itself is a credential, not a field). */
export function sourceFields(def: SourceDef): string[] {
  return [
    ...def.envField ? [def.envField] : [], ...def.baseUrlField ? [def.baseUrlField] : [], ...def.extra ?? [],
    ...def.budget ? [`sources.budget.${def.id}.total`, `sources.budget.${def.id}.daily`] : [],
  ]
}

/** Fields shown as JSON objects, each in its own dialog: the field, the group it sits in. */
export const JSON_FIELDS: readonly { field: string; group: 'judge' | 'runtime' | 'platform' | 'advanced' }[] = [
  { field: 'evidence.judge.providers', group: 'judge' }, { field: 'evidence.budget.providers', group: 'judge' },
  { field: 'playwright', group: 'runtime' }, { field: 'platformBackends', group: 'advanced' }, { field: 'cliAdapters', group: 'advanced' },
  { field: 'customPlatforms', group: 'platform' }, { field: 'platformRules', group: 'platform' }, { field: 'browserBindings', group: 'platform' },
]

/** Group of the text view each plain field is printed under (the others are listed explicitly where they are built). */
export const TEXT_GROUP: Readonly<Record<string, string>> = {
  engines: 'search', parallelEngines: 'search', searchMaxResults: 'search', toolSurface: 'search', allowProxyFakeIp: 'network', timeoutMs: 'network',
  'evidence.sourcePolicy': 'sources', 'sources.priority': 'sources', 'sources.disabled': 'sources', openalexMailto: 'sources', deepseekFetch: 'sources',
  fetchDefaultChars: 'reading', exaContentsPerUrlChars: 'reading', exaContentsTotalChars: 'reading', 'evidence.autoProviders': 'reading', 'evidence.maxRounds': 'reading', 'evidence.maxQueries': 'reading',
  registerProvider: 'route', providerId: 'route', 'provider.evidence': 'route', 'provider.deadlineMs': 'route',
  enableCliBackends: 'runtime', opencliEnabled: 'runtime', agentReachEnabled: 'runtime', twitterAuthTokenEnv: 'runtime', twitterCt0Env: 'runtime', playwright: 'runtime', platformBackends: 'runtime', cliAdapters: 'runtime',
  customPlatforms: 'platform', platformRules: 'platform', browserBindings: 'platform',
  ttlSeconds: 'network', memoryCacheEntries: 'network', dbPath: 'network', verbose: 'network',
  rrfConstant: 'ranking', freshnessBoost: 'ranking', freshnessDays: 'ranking', authorityBoost: 'ranking', authorityDomains: 'ranking',
}

/** Group of the text view of any field (judge, budget, keyed and rubric families included). */
export function textGroupOf(field: string): string {
  const named = TEXT_GROUP[field]
  if (named) return named
  if (/^evidence\.(judge|coverage|budget|rubrics)\./.test(field)) return 'judge'
  if (/^keyedSources\.|^sources\.budget\.|^bocha/.test(field) || /^(exa|jina|github)ApiKeyEnv$|^githubTokenEnv$|^searxngUrl$/.test(field)) return 'sources'
  return 'search'
}
