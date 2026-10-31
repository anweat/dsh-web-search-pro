/**
 * The settings of the WeChat integration, in one place: the `wechat` group of the configuration (docs/dev/wechat-design.md section 5).
 * `notices` is the reminder mode, `sogou` the built-in Sogou leg, `wsa` the paid 元宝搜索 (Tencent WSA) leg, `history` the user's own
 * wechat-download-api service. {@link wechatSettings} reads the group from a (resolved or raw) configuration and turns every
 * missing or malformed value into its default, so nothing else reads the raw config. Pure: the client bundle includes this file.
 * @module web-search-pro/wechat/settings
 */
import { type NoticeMode } from './notices.ts';
export declare const WSA_EDITIONS: readonly ["lite", "standard", "flagship"];
export type WsaEdition = typeof WSA_EDITIONS[number];
export declare const WSA_MODES: readonly [0, 1, 2];
export type WsaMode = typeof WSA_MODES[number];
export interface WechatSettings {
    notices: NoticeMode;
    sogou: {
        enabled: boolean;
        resolveLinks: number;
        minIntervalMs: number;
    };
    wsa: {
        enabled: boolean;
        /** The key itself (a literal in the configuration); usually absent: the credentials ref / environment variable named by `apiKeyEnv` holds it. */
        apiKey?: string;
        apiKeyEnv: string;
        /** Endpoint override; the default is {@link WSA_DEFAULT_BASE_URL}. */
        baseUrl?: string;
        edition: WsaEdition;
        mode: WsaMode;
        /** Requests per calendar day the plugin allows itself; more are refused (the money guard). */
        dailyLimit: number;
    };
    history: {
        /** The user's wechat-download-api service (`http://127.0.0.1:5000`); empty = the history actions are off. */
        baseUrl: string;
        minIntervalMs: number;
    };
}
export declare const WSA_DEFAULT_BASE_URL = "https://api.wsa.cloud.tencent.com";
export declare const WSA_DEFAULT_KEY_ENV = "TENCENT_WSA_API_KEY";
export declare const WECHAT_DEFAULTS: WechatSettings;
/** The WeChat settings of a (resolved or raw) configuration. */
export declare function wechatSettings(config: unknown): WechatSettings;
