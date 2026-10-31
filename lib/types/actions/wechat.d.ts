/**
 * `wechat` group: the layers of the WeChat official-account integration that are not a plain search (docs/dev/wechat-design.md).
 *
 *  - `wechat.status`: which layer is ready, its access profile (login, risk, billing), today's 元宝搜索 use against the daily limit,
 *    the last failure of each layer, and optionally (`probe`) a live check of the history service. No network without `probe`.
 *  - `wechat.album`: the articles of a 合集 (album) through WeChat's login-free JSON endpoint.
 *  - `wechat.accounts` / `wechat.articles`: search an official account by name and list its articles through the user's own
 *    wechat-download-api service (`wechat.history.baseUrl`); these act through the user's WeChat account, which is why every
 *    successful use carries the `wechat.account-risk` warning.
 *
 * All four only read. They do not ask for approval: the history service is one the user configured on purpose, and the risk is
 * stated to them in a notice instead. Verification: album live (2 anonymous requests), history contract-only, 元宝搜索 docs-only.
 * @module web-search-pro/actions/wechat
 */
import { type ActionDef } from './types.ts';
export declare const WECHAT_ACTIONS: ActionDef[];
