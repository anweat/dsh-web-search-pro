/**
 * The groups the configuration is laid out in, and the order of its fields. One definition serves four readers: the order of
 * the keys of the `Config` schema (what the Host's generic configuration view and `--dump-config` print), the sections of the
 * settings card's text view, the group a field belongs to in the card's tests, and the docs. A test pins the schema to this
 * list, so a new field cannot be added without choosing its group.
 *
 * The groups follow the settings page, most used first: common, search order, sources and keys, custom CLI, reading and
 * evidence, platforms and runtime, advanced and diagnostics. Only top-level `Config` keys are listed; a key that is an object
 * (`sources`, `evidence`, `provider`, `keyedSources`, `playwright`) takes all of its nested options with it.
 *
 * Pure and free of imports: the client bundle includes this file.
 * @module web-search-pro/config-groups
 */

export const CONFIG_GROUP_IDS = ['common', 'order', 'sources', 'cli', 'evidence', 'runtime', 'advanced'] as const
export type ConfigGroupId = typeof CONFIG_GROUP_IDS[number]

/** Top-level `Config` keys by group, in display order. */
export const CONFIG_GROUPS: Readonly<Record<ConfigGroupId, readonly string[]>> = {
  common: ['searchMaxResults', 'parallelEngines', 'toolSurface', 'allowProxyFakeIp', 'deepseekFetch'],
  order: ['engines', 'sources', 'platformBackends'],
  sources: [
    'keyedSources', 'exaApiKey', 'exaApiKeyEnv', 'jinaApiKey', 'jinaApiKeyEnv', 'bochaApiKey', 'bochaApiKeyEnv', 'bochaBaseUrl', 'bochaSummary',
    'githubToken', 'githubTokenEnv', 'searxngUrl', 'openalexMailto',
  ],
  cli: ['cliAdapters'],
  evidence: ['evidence', 'fetchDefaultChars', 'exaContentsPerUrlChars', 'exaContentsTotalChars'],
  runtime: [
    'enableCliBackends', 'opencliEnabled', 'agentReachEnabled', 'twitterAuthToken', 'twitterAuthTokenEnv', 'twitterCt0', 'twitterCt0Env',
    'playwright', 'customPlatforms', 'platformRules', 'browserBindings', 'providerId', 'registerProvider', 'provider', 'timeoutMs',
  ],
  advanced: ['ttlSeconds', 'memoryCacheEntries', 'rrfConstant', 'freshnessBoost', 'freshnessDays', 'authorityBoost', 'authorityDomains', 'dbPath', 'verbose'],
}

/** Titles of the groups, as the text view prints them (the card's own group titles live in its dictionary). */
export const CONFIG_GROUP_TITLES: Readonly<Record<'en' | 'zh', Readonly<Record<ConfigGroupId, string>>>> = {
  en: {
    common: 'Common', order: 'Search order', sources: 'Sources and keys (API keys by reference name only)', cli: 'Custom CLI',
    evidence: 'Reading and evidence', runtime: 'Platforms and runtime', advanced: 'Advanced and diagnostics',
  },
  zh: {
    common: '常用', order: '搜索顺序', sources: '来源与密钥（API Key 只写引用名）', cli: '自定义 CLI',
    evidence: '读取与证据', runtime: '平台与运行时', advanced: '高级与诊断',
  },
}

/** Every top-level key in display order. */
export const CONFIG_FIELD_ORDER: readonly string[] = CONFIG_GROUP_IDS.flatMap(id => CONFIG_GROUPS[id])

const GROUP_OF = new Map<string, ConfigGroupId>(CONFIG_GROUP_IDS.flatMap(id => CONFIG_GROUPS[id].map(key => [key, id] as const)))

/** The group of a top-level key, or of a dotted field (`sources.priority`, `evidence.judge.mode`) by its first segment. */
export function groupOf(field: string): ConfigGroupId | undefined {
  return GROUP_OF.get(field.split('.')[0]!)
}
