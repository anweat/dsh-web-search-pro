/**
 * Baidu Qianfan (百度千帆) AI Search — the plain web-search endpoint (keyed, Chinese): ranked `references[]` only, never
 * the chat-completions (`/v2/ai_search/chat/completions`) generated answer. Contract sources: the official page
 * https://ai.baidu.com/ai-doc/AppBuilder/pmaxd1hvy (endpoint, header table, request fields, `references[]` fields, error
 * shape, free quota; fetched 2026-10-03), the Qianfan v2 API conventions at https://cloud.baidu.com/doc/qianfan-api/s/3m7of64lb
 * (`Authorization: Bearer bce-v3/ALTAK-…`), and the MIT reference SDK `searchsuite` (providers/baidu.js) used by the MIT DSH plugin
 * `yugasun/dsh-plugins`.
 *
 * `POST https://qianfan.baidubce.com/v2/ai_search/web_search`, JSON `{ messages: [{ role: "user", content }], search_source:
 * "baidu_search_v2", resource_type_filter: [{ type: "web", top_k (<= 50) }], search_filter?: { match: { site: [<= 20 domains] },
 * range: { page_time: { gte: "YYYY-MM-DD" } } }, block_websites?: [domains] }`. 200: `references[]` of `{ id, title, url, content
 * (<= 2000 characters), date, type, website, ... }`; errors `{ code, message, request_id }` (216003 = authentication error, 400, 500).
 * Free quota 100 calls per day, up to 100000 per account per day.
 *
 * AMBIGUITY (the page contradicts itself): its header TABLE lists both `Authorization: Bearer <AppBuilder API Key>` and
 * `X-Appbuilder-Authorization: Bearer <AppBuilder API Key>`, its curl example sends only `X-Appbuilder-Authorization`, the newer
 * Qianfan v2 pages and the reference SDK send `Authorization`. Until a live call settles it the adapter sends BOTH headers with
 * the same bearer value (each one is listed by the official table). Other left out / unconfirmed: the query length limit (the
 * reference SDK cuts at 72 units, a CJK character counting 2: followed here), the `block_websites` size limit (capped at 20 like
 * the include list, the rest stays local), quota and QPS error codes (only 216003 is documented: quota is recognised by message
 * wording, a rate limit by HTTP 429), `edition`, `search_recency_filter` and `safe_search` are not used.
 * @module web-search-pro/providers/baidu-qianfan
 */
import type { WebSearchSource } from '@deepseek-ai/dsh-web';
import { EngineError } from '../engines.ts';
export declare const BAIDU_ROUTE_ID = "baidu-qianfan";
export declare const BAIDU_BASE = "https://qianfan.baidubce.com";
export declare const BAIDU_PATH = "/v2/ai_search/web_search";
export declare const BAIDU_MAX_TOP_K = 50;
export declare const BAIDU_MAX_SITES = 20;
/** The reference SDK cuts the query at 72 units (a character outside ASCII counts 2). */
export declare const BAIDU_QUERY_UNITS = 72;
/** Cut `text` to at most `units` units, a non-ASCII character counting 2. */
export declare function limitUnits(text: string, units: number): string;
export interface BaiduBody {
    messages: {
        role: 'user';
        content: string;
    }[];
    search_source: 'baidu_search_v2';
    resource_type_filter: {
        type: 'web';
        top_k: number;
    }[];
    search_filter?: {
        match?: {
            site: string[];
        };
        range?: {
            page_time: {
                gte: string;
            };
        };
    };
    block_websites?: string[];
}
export declare function baiduBody(query: string, count: number, options?: {
    sites?: {
        include?: string[];
        exclude?: string[];
    };
    since?: string;
}): BaiduBody;
export declare function mapBaidu(references: readonly unknown[], count: number): WebSearchSource[];
/** 216003 is the documented authentication error code; other failures follow the HTTP status and the message wording. */
export declare function baiduFailure(status: number, headers: Headers, json: unknown): EngineError;
export declare function parseBaidu(json: unknown, count: number, headers?: Headers): WebSearchSource[];
export declare const BAIDU_DESCRIPTOR: import("./registry.ts").ProviderDescriptor;
export declare const baiduAdapter: import("./registry.ts").ProviderAdapter;
