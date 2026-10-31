/**
 * "WeChat official accounts": the reminder mode, the built-in Sogou leg, the paid 元宝搜索 (Tencent WSA) leg with its write-only
 * key, and the address of the user's own wechat-download-api service. Nothing here logs in anywhere: the key is a credential
 * (stored by reference name, never shown), the history service is one the user runs and logs in to themselves.
 * @module web-search-pro/client/group-wechat
 */
import { type Card } from './field-rows.tsx';
export declare function WechatGroup({ card }: {
    card: Card;
}): import("react").JSX.Element;
