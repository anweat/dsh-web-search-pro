/**
 * Wikipedia (MediaWiki Action API `list=search`), anonymous. Contract source: https://www.mediawiki.org/wiki/API:Search
 * (`srsearch`, `srlimit`, `srnamespace`, `srprop`; `query.search[]` with `title`, `pageid`, `snippet`, `timestamp`;
 * the snippet carries `<span class="searchmatch">` markup; failures answer `{ error: { code, info } }`).
 *
 * The edition follows the task language (`zh.wikipedia.org` for Chinese, `en.wikipedia.org` otherwise). A reference
 * source for definitions and stable facts, not a replacement for web search.
 * @module web-search-pro/providers/wikipedia
 */
import type { WebSearchSource } from '@deepseek-ai/dsh-web';
import { type Engine, type EngineDeps } from '../engines.ts';
import type { ProviderAdapter, ProviderDescriptor } from './registry.ts';
export declare const WIKIPEDIA_ROUTE_ID = "wikipedia";
export declare const WIKIPEDIA_USAGE_PROVIDER = "wikipedia";
export interface WikipediaHit {
    title?: string;
    pageid?: number;
    snippet?: string;
    timestamp?: string;
    wordcount?: number;
}
/** `zh` or `en` edition: the explicit option, else the query's own language. */
export declare function wikipediaLang(query: string, lang?: 'zh' | 'en'): 'zh' | 'en';
export declare function wikipediaUrl(lang: 'zh' | 'en', count: number, query: string): string;
export declare function articleUrl(lang: 'zh' | 'en', title: string): string;
/** `query.search[]` -> sources; snippet HTML stripped (the searchmatch spans, entities). Entries without a title are dropped. */
export declare function mapWikipedia(hits: readonly WikipediaHit[], lang: 'zh' | 'en', count: number): WebSearchSource[];
/** Parse a 2xx body: an `error` object throws (rate-limit codes are retryable), no hits is ENGINE_EMPTY. */
export declare function parseWikipedia(body: unknown, lang: 'zh' | 'en', count: number): WebSearchSource[];
export declare function wikipediaEngine(deps: EngineDeps): Engine;
export declare const WIKIPEDIA_DESCRIPTOR: ProviderDescriptor;
export declare const wikipediaAdapter: ProviderAdapter;
