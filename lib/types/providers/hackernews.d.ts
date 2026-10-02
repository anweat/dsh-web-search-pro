/**
 * Hacker News search through the Algolia HN API (anonymous): `GET https://hn.algolia.com/api/v1/search`
 * with `query`, `tags=story`, `hitsPerPage` and, for a date lower bound, `numericFilters=created_at_i>EPOCH`.
 * Hits carry `objectID`, `title`, `url` (null for Ask HN / text posts), `author`, `points`, `num_comments`,
 * `created_at`, `story_text`. Stories only: the external article is the result, the HN thread is named in the
 * snippet (comment hits are noisier and their pages are not extractable).
 * @module web-search-pro/providers/hackernews
 */
import type { WebSearchSource } from '@deepseek-ai/dsh-web';
import { type Engine, type EngineDeps } from '../engines.ts';
import type { ProviderAdapter, ProviderDescriptor } from './registry.ts';
export declare const HACKERNEWS_ROUTE_ID = "hackernews";
export declare const HACKERNEWS_USAGE_PROVIDER = "hackernews";
export interface HackerNewsHit {
    objectID?: string;
    title?: string | null;
    url?: string | null;
    author?: string;
    points?: number | null;
    num_comments?: number | null;
    created_at?: string;
    story_text?: string | null;
}
export declare function hackerNewsUrl(query: string, count: number, since?: string): string;
export declare const threadUrl: (id: string) => string;
/** Hits -> sources: the linked article when there is one, else the HN thread; the snippet shows points, comments and the thread. */
export declare function mapHackerNews(hits: readonly HackerNewsHit[], count: number): WebSearchSource[];
export declare function parseHackerNews(body: unknown, count: number): WebSearchSource[];
export declare function hackerNewsEngine(deps: EngineDeps): Engine;
export declare const HACKERNEWS_DESCRIPTOR: ProviderDescriptor;
export declare const hackerNewsAdapter: ProviderAdapter;
