/**
 * Metaso (秘塔) search API (keyed, Chinese). First scope: `webpage` only; the `/reader` endpoint (page text as markdown) is
 * left for later. Contract sources: the official playground / docs entry https://metaso.cn/search-api/playground is a
 * script-rendered page that could not be read from here, so the contract comes from two MIT DSH / MCP reference
 * implementations that agree on it: `TZHR-invest/dsh-plugins` packages/dsh-web-search-metaso (index.js) and
 * `HundunOnline/mcp-metaso` (server.py), checked 2026-10-03.
 *
 * `POST https://metaso.cn/api/v1/search`, `Authorization: Bearer <key>`, JSON `{ q, scope: "webpage", includeSummary, size }`.
 * 200: `webpages[]` of `{ title, link, snippet, summary?, date | displayDate }` (`summary` only appears when `includeSummary`
 * is asked for; it is not requested here, so the raw `snippet` is used). Metaso also answers questions and returns generated
 * summaries; none of that is requested or read.
 *
 * Ambiguous / left out: the two references disagree on the `size` ceiling (100 vs 20) and on whether it is sent as a number or
 * a string, so the adapter asks for at most 20 and sends a number; the date key is `date` in one and `displayDate` in the other
 * (both are read); the error envelope and quota semantics are not documented anywhere readable (the shared status mapping
 * applies, and a message that says balance / quota is `ENGINE_QUOTA`); no filter (site / time / language) is documented, so
 * every constraint is verified locally; other scopes (document, scholar, image, video, podcast) and `/reader` are not implemented.
 * @module web-search-pro/providers/metaso
 */
import type { WebSearchSource } from '@deepseek-ai/dsh-web';
import { EngineError } from '../engines.ts';
export declare const METASO_ROUTE_ID = "metaso";
export declare const METASO_BASE = "https://metaso.cn";
export declare const METASO_PATH = "/api/v1/search";
export declare const METASO_MAX_SIZE = 20;
export interface MetasoBody {
    q: string;
    scope: 'webpage';
    includeSummary: false;
    size: number;
}
export declare function metasoBody(query: string, count: number): MetasoBody;
export declare function mapMetaso(pages: readonly unknown[], count: number): WebSearchSource[];
export declare function parseMetaso(json: unknown, count: number): WebSearchSource[];
export declare function metasoFailure(status: number, headers: Headers, json: unknown): EngineError;
export declare const METASO_DESCRIPTOR: import("./registry.ts").ProviderDescriptor;
export declare const metasoAdapter: import("./registry.ts").ProviderAdapter;
