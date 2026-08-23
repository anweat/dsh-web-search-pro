/**
 * web-search-pro — 增强型、可持久化的扩展网页搜索插件 for DeepSeek Harness.
 *
 * - Multi-backend search routing with automatic fallback (agent-reach style):
 *   ctx.web seam / Exa / DuckDuckGo / Bing / Jina + platform backends
 *   (bili-cli, yt-dlp, sov2ex, opencli, agent-reach).
 * - Persistent SQLite store (MediaCrawler style): search queries + results,
 *   page snapshots, and user-extended per-site extraction rules survive
 *   restarts and are reused within a configurable TTL.
 * - Userscript-style per-site extraction rules ("脚本猫/油猴" style) applied
 *   by the fetch pipeline (Jina Reader → HTTP+extraction → Playwright).
 * - Optional ctx.web provider registration so the built-in web_search /
 *   web_fetch tools can route through this plugin.
 *
 * @module web-search-pro
 */
import type { Context } from '@deepseek-ai/cordis';
import { Config } from './config.ts';
export declare const name = "web-search-pro";
export declare const inject: string[];
export { Config };
export type { Config as WebSearchProConfig } from './config.ts';
export { ExaClient } from './exa-client.ts';
export type { ExaSearchRequest, ExaSearchType, ExaResult } from './exa-client.ts';
export { BackendRegistry } from './backend-registry.ts';
export type { Backend, BackendDiagnostic, BackendProbe } from './backend-registry.ts';
export declare function apply(ctx: Context, config: Config): void;
