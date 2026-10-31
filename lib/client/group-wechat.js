import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
/**
 * "WeChat official accounts": the reminder mode, the built-in Sogou leg, the paid 元宝搜索 (Tencent WSA) leg with its write-only
 * key, and the address of the user's own wechat-download-api service. Nothing here logs in anywhere: the key is a credential
 * (stored by reference name, never shown), the history service is one the user runs and logs in to themselves.
 * @module web-search-pro/client/group-wechat
 */
import { fill, NumberRow, SelectRow, SwitchRow, TextRow, useOverriddenCount } from "./field-rows.js";
import { SecretRow } from "./group-sources.js";
import { styles as css } from "./styles.js";
import { Badge, Group, SubHead } from "./ui-kit.js";
const FIELDS = [
    'wechat.notices', 'wechat.sogou.enabled', 'wechat.sogou.resolveLinks', 'wechat.sogou.minIntervalMs',
    'wechat.wsa.enabled', 'wechat.wsa.apiKeyEnv', 'wechat.wsa.baseUrl', 'wechat.wsa.edition', 'wechat.wsa.mode', 'wechat.wsa.dailyLimit',
    'wechat.history.baseUrl', 'wechat.history.minIntervalMs',
];
export function WechatGroup({ card }) {
    const { t } = card;
    const count = useOverriddenCount(card, FIELDS);
    return _jsxs(Group, { id: "wechat", title: t('groupWechat'), summary: t('groupWechatSub'), badges: count ? _jsx(Badge, { tone: "info", children: fill(t('overriddenCount'), { n: count }) }) : null, children: [_jsx("p", { className: css.rowHint, "data-wsp-wechat-note": true, children: t('wxNote') }), _jsx(SelectRow, { card: card, field: "wechat.notices", options: [{ value: 'once', label: t('optNoticeOnce') }, { value: 'always', label: t('optNoticeAlways') }, { value: 'off', label: t('optNoticeOff') }] }), _jsx(SubHead, { children: t('wxSogouTitle') }), _jsx(SwitchRow, { card: card, field: "wechat.sogou.enabled" }), _jsx(NumberRow, { card: card, field: "wechat.sogou.resolveLinks", unit: "count" }), _jsx(NumberRow, { card: card, field: "wechat.sogou.minIntervalMs", unit: "ms" }), _jsx(SubHead, { children: t('wxWsaTitle') }), _jsx("p", { className: css.rowHint, "data-wsp-wsa-note": true, children: t('wxWsaNote') }), _jsx(SwitchRow, { card: card, field: "wechat.wsa.enabled", risk: t('riskBilled') }), _jsx(TextRow, { card: card, field: "wechat.wsa.apiKeyEnv", code: true, placeholder: "TENCENT_WSA_API_KEY" }), _jsx(SecretRow, { card: card, id: "wechat-wsa", label: t('wxApiKey') }), _jsx(SelectRow, { card: card, field: "wechat.wsa.edition", options: [{ value: 'lite', label: t('optEditionLite') }, { value: 'standard', label: t('optEditionStandard') }, { value: 'flagship', label: t('optEditionFlagship') }] }), _jsx(SelectRow, { card: card, field: "wechat.wsa.mode", options: [{ value: '0', label: t('optMode0') }, { value: '1', label: t('optMode1') }, { value: '2', label: t('optMode2') }] }), _jsx(NumberRow, { card: card, field: "wechat.wsa.dailyLimit", unit: "count" }), _jsx(TextRow, { card: card, field: "wechat.wsa.baseUrl", code: true, placeholder: "https://api.wsa.cloud.tencent.com" }), _jsx(SubHead, { children: t('wxHistTitle') }), _jsx("p", { className: css.rowHint, "data-wsp-history-note": true, children: t('wxHistNote') }), _jsx(TextRow, { card: card, field: "wechat.history.baseUrl", code: true, placeholder: "http://127.0.0.1:5000" }), _jsx(NumberRow, { card: card, field: "wechat.history.minIntervalMs", unit: "ms" })] });
}
//# sourceMappingURL=group-wechat.js.map