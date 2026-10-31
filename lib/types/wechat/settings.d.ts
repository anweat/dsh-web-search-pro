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
import { type NoticeMode } from './notices.ts';
export interface WechatSettings {
    notices: NoticeMode;
    sogou: {
        enabled: boolean;
        resolveLinks: number;
        minIntervalMs: number;
    };
}
export declare const WECHAT_DEFAULTS: WechatSettings;
/** The WeChat settings of a (resolved) configuration. */
export declare function wechatSettings(config: unknown): WechatSettings;
