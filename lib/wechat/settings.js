/**
 * The settings of the WeChat integration, in one place: the `wechat` group of the configuration (docs/dev/wechat-design.md section 5).
 * `notices` is the reminder mode, `sogou` the built-in Sogou leg, `wsa` the paid 元宝搜索 (Tencent WSA) leg, `history` the user's own
 * wechat-download-api service. {@link wechatSettings} reads the group from a (resolved or raw) configuration and turns every
 * missing or malformed value into its default, so nothing else reads the raw config. Pure: the client bundle includes this file.
 * @module web-search-pro/wechat/settings
 */
import { noticeModeOf } from "./notices.js";
export const WSA_EDITIONS = ['lite', 'standard', 'flagship'];
export const WSA_MODES = [0, 1, 2];
export const WSA_DEFAULT_BASE_URL = 'https://api.wsa.cloud.tencent.com';
export const WSA_DEFAULT_KEY_ENV = 'TENCENT_WSA_API_KEY';
export const WECHAT_DEFAULTS = {
    notices: 'once',
    sogou: { enabled: true, resolveLinks: 3, minIntervalMs: 1500 },
    wsa: { enabled: false, apiKeyEnv: WSA_DEFAULT_KEY_ENV, edition: 'standard', mode: 2, dailyLimit: 100 },
    history: { baseUrl: '', minIntervalMs: 2000 },
};
const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const intIn = (value, min, max, fallback) => (typeof value === 'number' && Number.isFinite(value) ? Math.min(Math.max(Math.trunc(value), min), max) : fallback);
const str = (value) => (typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined);
/** Unwrap schemastery `Volatile` leaves (`{ get() }`) anywhere below `value`. */
function plain(value) {
    if (value !== null && typeof value === 'object' && 'get' in value && typeof value.get === 'function')
        return plain(value.get());
    if (isRecord(value))
        return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, plain(entry)]));
    return value;
}
/** The WeChat settings of a (resolved or raw) configuration. */
export function wechatSettings(config) {
    const raw = plain(isRecord(config) ? config.wechat : undefined);
    const group = isRecord(raw) ? raw : {};
    const sogou = isRecord(group.sogou) ? group.sogou : {};
    const wsa = isRecord(group.wsa) ? group.wsa : {};
    const history = isRecord(group.history) ? group.history : {};
    const edition = WSA_EDITIONS.find(e => e === wsa.edition) ?? WECHAT_DEFAULTS.wsa.edition;
    const mode = WSA_MODES.find(m => m === wsa.mode) ?? WECHAT_DEFAULTS.wsa.mode;
    const apiKey = str(wsa.apiKey);
    const baseUrl = str(wsa.baseUrl);
    return {
        notices: noticeModeOf(group.notices),
        sogou: {
            enabled: sogou.enabled !== false,
            resolveLinks: intIn(sogou.resolveLinks, 0, 10, WECHAT_DEFAULTS.sogou.resolveLinks),
            minIntervalMs: intIn(sogou.minIntervalMs, 0, 60_000, WECHAT_DEFAULTS.sogou.minIntervalMs),
        },
        wsa: {
            enabled: wsa.enabled === true,
            ...apiKey ? { apiKey } : {},
            apiKeyEnv: str(wsa.apiKeyEnv) ?? WSA_DEFAULT_KEY_ENV,
            ...baseUrl ? { baseUrl } : {},
            edition, mode,
            dailyLimit: intIn(wsa.dailyLimit, 1, 1_000_000, WECHAT_DEFAULTS.wsa.dailyLimit),
        },
        history: {
            baseUrl: str(history.baseUrl) ?? '',
            minIntervalMs: intIn(history.minIntervalMs, 0, 600_000, WECHAT_DEFAULTS.history.minIntervalMs),
        },
    };
}
//# sourceMappingURL=settings.js.map