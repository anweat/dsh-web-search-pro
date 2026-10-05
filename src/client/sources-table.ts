/**
 * Static reference of the sources that work without a key, for the "Sources" section. It is documentation, not state:
 * live readiness (what is installed, which key is set, what answered) is `web_call sources.status`. A test pins every
 * row to the provider registry (the id exists and needs no key), so the table cannot drift from the code.
 * @module web-search-pro/client/sources-table
 */

import type { zh } from './locales.ts'

export interface AnonymousSource {
  /** Route id (the registry alias) the source is addressed by in `engines`. */
  id: string
  name: string
  /** Locale key of its one-line use. */
  use: keyof typeof zh
}

export const ANONYMOUS_SOURCES: readonly AnonymousSource[] = [
  { id: 'ddg', name: 'DuckDuckGo', use: 'srcUseDdg' },
  { id: 'bing', name: 'Bing', use: 'srcUseBing' },
  { id: 'wikipedia', name: 'Wikipedia', use: 'srcUseWikipedia' },
  { id: 'hackernews', name: 'Hacker News', use: 'srcUseHackernews' },
  { id: 'stackexchange', name: 'Stack Exchange', use: 'srcUseStackexchange' },
  { id: 'openalex', name: 'OpenAlex', use: 'srcUseOpenalex' },
  { id: 'semanticscholar', name: 'Semantic Scholar', use: 'srcUseSemanticscholar' },
  { id: 'anysearch', name: 'AnySearch', use: 'srcUseAnysearch' },
  { id: 'arxiv', name: 'arXiv', use: 'srcUseArxiv' },
  { id: 'pubmed', name: 'PubMed', use: 'srcUsePubmed' },
  { id: 'v2ex', name: 'V2EX', use: 'srcUseV2ex' },
]

/** Display names of the keyed sources by route id (proper names, shown the same in every language). */
export const KEYED_NAMES: Readonly<Record<string, string>> = {
  tavily: 'Tavily',
  brave: 'Brave Search',
  linkup: 'Linkup',
  serper: 'Serper (Google)',
  metaso: '秘塔 Metaso',
  zhipu: '智谱 Zhipu',
  'baidu-qianfan': '百度千帆 Baidu Qianfan',
}
