/**
 * The settings of the WeChat integration, in one place. Phase A needs only a few: the notice mode and the built-in Sogou leg
 * (enabled, how many results get their signed link resolved, the pause between Sogou requests). They are read from an OPTIONAL
 * `wechat` object of the configuration that the schema does not declare yet: unknown keys survive `resolveConfig`, so a profile
 * can already set them, and every missing or malformed value is its default.
 *
 * TODO(phase B): declare the top-level `wechat` group in config.ts / config-groups.ts (settings card, text view, dictionaries),
 * add `wsa` and `history`, and replace {@link wechatSettings}'s cast by the resolved field. Nothing else in the integration
 * reads the raw config.
 * @module web-search-pro/wechat/settings
 */

import { noticeModeOf, type NoticeMode } from './notices.ts'

export interface WechatSettings {
  notices: NoticeMode
  sogou: { enabled: boolean; resolveLinks: number; minIntervalMs: number }
}

export const WECHAT_DEFAULTS: WechatSettings = { notices: 'once', sogou: { enabled: true, resolveLinks: 3, minIntervalMs: 1500 } }

const isRecord = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value)
const intIn = (value: unknown, min: number, max: number, fallback: number): number => (typeof value === 'number' && Number.isFinite(value) ? Math.min(Math.max(Math.trunc(value), min), max) : fallback)

/** The WeChat settings of a (resolved) configuration. */
export function wechatSettings(config: unknown): WechatSettings {
  const raw = isRecord(config) && isRecord(config.wechat) ? config.wechat : {}
  const sogou = isRecord(raw.sogou) ? raw.sogou : {}
  return {
    notices: noticeModeOf(raw.notices),
    sogou: {
      enabled: sogou.enabled !== false,
      resolveLinks: intIn(sogou.resolveLinks, 0, 10, WECHAT_DEFAULTS.sogou.resolveLinks),
      minIntervalMs: intIn(sogou.minIntervalMs, 0, 60_000, WECHAT_DEFAULTS.sogou.minIntervalMs),
    },
  }
}
