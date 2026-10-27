/**
 * Which sources are keyed and the default environment variable of each key: data only, shared by the adapters and the
 * settings panel (client bundle), hence no imports.
 * @module web-search-pro/providers/keyed-meta
 */
/** Default environment variable names of each keyed source's API key, first one preferred (route id -> names). */
export const KEYED_SOURCE_ENVS = Object.freeze({
    // DeepSeek Search / Fetch API (the account's API key, the same variable the host's own DeepSeek access uses).
    deepseek: ['DEEPSEEK_API_KEY'],
    tavily: ['TAVILY_API_KEY'],
    brave: ['BRAVE_API_KEY'],
    linkup: ['LINKUP_API_KEY'],
    serper: ['SERPER_API_KEY'],
    metaso: ['METASO_API_KEY'],
    zhipu: ['ZHIPU_API_KEY'],
    // The official page says "AppBuilder API Key" without naming a variable; the MIT reference SDK (searchsuite) reads both.
    'baidu-qianfan': ['QIANFAN_API_KEY', 'BAIDU_API_KEY'],
});
export const KEYED_SOURCE_IDS = Object.freeze(Object.keys(KEYED_SOURCE_ENVS));
/**
 * The "常用" (common) sources: a test pins this list to the registry descriptors that set `common: true`. Data only, for the
 * settings panel (client bundle), which cannot import the descriptors.
 */
export const COMMON_SOURCE_IDS = Object.freeze(['deepseek']);
//# sourceMappingURL=keyed-meta.js.map