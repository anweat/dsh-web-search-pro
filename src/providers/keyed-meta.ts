/**
 * Which sources are keyed and the default environment variable of each key: data only, shared by the adapters and the
 * settings panel (client bundle), hence no imports.
 * @module web-search-pro/providers/keyed-meta
 */

/** Default environment variable names of each keyed source's API key, first one preferred (route id -> names). */
export const KEYED_SOURCE_ENVS: Readonly<Record<string, readonly string[]>> = Object.freeze({
  tavily: ['TAVILY_API_KEY'],
  brave: ['BRAVE_API_KEY'],
  linkup: ['LINKUP_API_KEY'],
  serper: ['SERPER_API_KEY'],
  metaso: ['METASO_API_KEY'],
  zhipu: ['ZHIPU_API_KEY'],
  // The official page says "AppBuilder API Key" without naming a variable; the MIT reference SDK (searchsuite) reads both.
  'baidu-qianfan': ['QIANFAN_API_KEY', 'BAIDU_API_KEY'],
})

export const KEYED_SOURCE_IDS: readonly string[] = Object.freeze(Object.keys(KEYED_SOURCE_ENVS))
