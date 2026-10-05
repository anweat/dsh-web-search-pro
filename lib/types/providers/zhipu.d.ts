/**
 * Zhipu (智谱) Web Search API (keyed, Chinese). Only the raw `search_result` of the standalone search endpoint is used: GLM
 * generated answers (the chat-completions `web_search` tool) are a different product and are never mixed in. Contract sources:
 * the official guide https://docs.bigmodel.cn/cn/guide/tools/web-search, the API reference
 * https://docs.bigmodel.cn/api-reference/工具-api/网络搜索 (request fields, example, `search_result` fields, error 1701-1703) and the
 * error-code page https://docs.bigmodel.cn/cn/faq/api-code (fetched 2026-10-03).
 *
 * `POST https://open.bigmodel.cn/api/paas/v4/web_search`, `Authorization: Bearer <key>`, JSON `{ search_query (<= 70 characters),
 * search_engine (search_std | search_pro | search_pro_sogou | search_pro_quark; search_std is the cheapest), search_intent (false),
 * count (1-50), search_domain_filter (one domain), search_recency_filter (oneDay | oneWeek | oneMonth | oneYear | noLimit),
 * content_size (medium | high) }`. 200: `search_result[]` of `{ title, content, link, media, icon, refer, publish_date }`.
 * Errors `{ error: { code, message } }`: 1000-1003 auth, 1113 overdue, 1302 rate, 1308-1310 quota windows, 1701 search concurrency,
 * 1702 no search service, 1703 invalid search answer.
 *
 * Ambiguous / left out: HTTP statuses of the search-specific codes 1701-1703 are not documented, so the business code decides;
 * `search_domain_filter` takes ONE domain (a single hard `site` is native, more stay local; there is no exclude field);
 * the recency filter is native only for an exact day / week / month / year window (a wider bucket is sent as a recall hint and
 * the constraint is still verified locally); `search_intent`, `request_id`, `user_id` are not used; the pro / sogou / quark engines
 * (other prices) are not selectable.
 * @module web-search-pro/providers/zhipu
 */
import type { WebSearchSource } from '@deepseek-ai/dsh-web';
import { EngineError } from '../engines.ts';
export declare const ZHIPU_ROUTE_ID = "zhipu";
export declare const ZHIPU_BASE = "https://open.bigmodel.cn";
export declare const ZHIPU_PATH = "/api/paas/v4/web_search";
export declare const ZHIPU_MAX_COUNT = 50;
export declare const ZHIPU_QUERY_CHARS = 70;
export type ZhipuRecency = 'oneDay' | 'oneWeek' | 'oneMonth' | 'oneYear';
/** The smallest recency bucket that covers a window starting at `since`; undefined beyond a year. */
export declare function zhipuRecency(since: string, now?: number): ZhipuRecency | undefined;
/** The window is exactly one of the buckets (a translation, so it counts as native). */
export declare function zhipuExactRecency(since: string, now: number): boolean;
export interface ZhipuBody {
    search_query: string;
    search_engine: 'search_std';
    search_intent: false;
    count: number;
    content_size: 'medium';
    search_domain_filter?: string;
    search_recency_filter?: ZhipuRecency;
}
export declare function zhipuBody(query: string, count: number, options?: {
    sites?: {
        include?: string[];
    };
    since?: string;
}, now?: number): ZhipuBody;
export declare function mapZhipu(results: readonly unknown[], count: number): WebSearchSource[];
/** Failure by the business code (the HTTP status of these is not always documented), else by status. */
export declare function zhipuFailure(status: number, headers: Headers, json: unknown): EngineError;
export declare function parseZhipu(json: unknown, count: number, headers?: Headers): WebSearchSource[];
export declare const ZHIPU_DESCRIPTOR: import("./registry.ts").ProviderDescriptor;
export declare const zhipuAdapter: import("./registry.ts").ProviderAdapter;
