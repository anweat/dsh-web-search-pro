/**
 * Access profiles: what a backend asks of the user and what it risks, stated once so `sources.status` can show it per chain leg
 * and the notices can refer to it. The plugin never logs anyone in: `login` says what the backend itself needs ('none' = nothing,
 * 'browser-session' = the user's own browser login, 'cli-login' = a CLI the user logged in, 'qr-scan' = a QR scan in the user's own
 * service, 'api-key' = a paid / keyed API). Pure, no imports.
 * @module web-search-pro/wechat/access
 */

export type AccessLogin = 'none' | 'browser-session' | 'cli-login' | 'qr-scan' | 'api-key'
export type AccessRisk = 'low' | 'medium' | 'high'

export interface AccessProfile {
  login: AccessLogin
  /** How long the login lasts (`约 4 天`), when it expires. */
  loginTtl?: string
  risk: AccessRisk
  /** What can go wrong: anti-bot measures, account bans, copyright. */
  riskNotes: readonly string[]
  /** What it costs (`元宝搜索 14-20 元/千次`), when it is billed. */
  billing?: string
}

const SOGOU_RISK: readonly string[] = ['搜狗对高频请求会弹出验证码（antispider），出口 IP 会被临时封锁，通常几十分钟到数小时恢复', '结果里的 mp.weixin.qq.com 链接带签名，几分钟到几小时后失效']

const WSA_BILLING = '按次计费：极速 14 / 标准 20 / 旗舰 26 元每千次（失败的请求不计费；新账号可能有每月免费额度，以控制台为准）'

/** Profiles by `<platform>:<backend id>`; `wechat:history` is the user's own wechat-download-api service (not a chain leg: the wechat.* actions use it). */
export const ACCESS_PROFILES: Readonly<Record<string, AccessProfile>> = {
  'wechat:sogou': { login: 'none', risk: 'medium', riskNotes: SOGOU_RISK },
  'wechat:omnireach': { login: 'none', risk: 'medium', riskNotes: ['经 omnireach 查询搜狗，同样会遇到验证码和 IP 封锁', '结果里的 mp.weixin.qq.com 链接带签名，几分钟到几小时后失效'] },
  'wechat:tencent-wsa': { login: 'api-key', risk: 'low', billing: WSA_BILLING, riskNotes: ['每次请求都花钱，插件按 wechat.wsa.dailyLimit 限制每日次数', '按官方文档实现，没有 Key 无法实测（docs-only）'] },
  'wechat:history': { login: 'qr-scan', loginTtl: '约 4 天', risk: 'high', riskNotes: ['走你自己公众号后台的未公开接口，高频会被限流（ret=200013，账号级，可能持续数天）甚至封号', '服务的 REST 接口本身没有鉴权，不要暴露到公网', '登录约 4 天过期，需要你在服务的管理页重新扫码'] },
  'wechat:wx-search-cli': { login: 'none', risk: 'medium', riskNotes: ['经 wx-search-cli 查询搜狗；被反爬时它只返回空数组（退出码 0），看起来与「没有命中」相同', '结果里的 mp.weixin.qq.com 链接带签名，几分钟到几小时后失效'] },
}

/** The access profile of a backend as a leg of a platform chain, when it has one. */
export function accessProfileOf(platform: string, backend: string): AccessProfile | undefined {
  return ACCESS_PROFILES[platform + ':' + backend]
}

const LOGIN_TEXT: Record<AccessLogin, string> = { none: '免登录', 'browser-session': '用你自己的浏览器登录态', 'cli-login': '需要你自己登录该 CLI', 'qr-scan': '需要扫码登录', 'api-key': '需要 API key' }
const RISK_TEXT: Record<AccessRisk, string> = { low: '风险低', medium: '风险中', high: '风险高' }

/** One line for `sources.status`: login, risk, billing, and the first reasons. */
export function renderAccess(profile: AccessProfile): string {
  return LOGIN_TEXT[profile.login] + (profile.loginTtl ? '（' + profile.loginTtl + '）' : '') + ' · ' + RISK_TEXT[profile.risk]
    + (profile.billing ? ' · ' + profile.billing : '') + (profile.riskNotes.length ? ': ' + profile.riskNotes.join('；') : '')
}

/** Output schema node of an access profile (closed). */
export const ACCESS_SCHEMA = {
  type: 'object' as const, additionalProperties: false,
  properties: {
    login: { type: 'string' as const, required: true as const }, loginTtl: { type: 'string' as const }, risk: { type: 'string' as const, required: true as const },
    riskNotes: { type: 'array' as const, required: true as const, items: { type: 'string' as const } }, billing: { type: 'string' as const },
  },
}
