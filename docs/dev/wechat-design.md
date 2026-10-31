# 微信公众号集成设计（feat/wechat，2026-10-31）

调研来源：`/Users/anweat/codeproject/dsh-dev/wechat-research/wechat-article-paths.md`、`wechat_poc.py`（实测于 2026-10-31）。

## 0. 目标与边界

- 把公众号的「搜索层 / 读取层 / 整号历史层」接进插件后端，零配置能力默认可用，需要账号或付费 key 的能力**单独设置、默认关闭**。
- 每个后端带一份「访问画像」（是否登录、登录有效期、风险、费用），在输出里以 `notices` 提醒用户，而不是悄悄失败。
- **插件不做任何登录流程**（沿用 2026-10-27 的决定）：扫码登录、Cookie、token 都是用户在自己的服务里完成的。
- 付费的元宝搜索**只**作为 `wechat` 平台的一级后端（`Site=mp.weixin.qq.com`），不注册成通用 web 源，避免「已配置 key 的源被提升」规则让每次中文搜索都花钱。

## 1. 访问画像与提醒（notices）

```ts
interface AccessProfile {
  login: 'none' | 'browser-session' | 'cli-login' | 'qr-scan' | 'api-key'
  loginTtl?: string            // '约 4 天'
  risk: 'low' | 'medium' | 'high'
  riskNotes: readonly string[] // 反爬、封号、版权 …
  billing?: string             // '元宝搜索 14–20 元/千次'
}
```

- 挂在 wechat 链的每个 leg 上（sogou、omnireach、wx-search-cli、tencent-wsa），以及 `wechat.*` 动作上；`sources.status` 的 chain 报告逐 leg 列出。
- `Notice = { level: 'info' | 'warn' | 'action'; code: string; message: string }`。`search.run`、`read.fetch`、`wechat.*` 的输出新增可选 `notices`，渲染为单独一段「提醒用户：…」。`action` 表示必须由用户动手（重新扫码、配 key）。
- 去重：同一 `code` 每个插件实例（会话）只提醒一次，`warn`/`action` 中出现新失败时再提醒；设置 `wechat.notices: 'once' | 'always' | 'off'`（默认 `once`）。
- 首批 code：

| code | level | 触发 |
|---|---|---|
| `wechat.antispider` | warn | 搜狗返回 antispider / 验证码；建议降频、换出口 IP，或配置元宝搜索 |
| `wechat.signed-url` | info | 结果是带签名的 mp 链接：会过期（分钟到小时），要读就尽快读 |
| `wechat.bare-url` | info | read.fetch 读到无签名裸链接 / 空壳页：改用搜索结果里的签名链接 |
| `wechat.paid` | info | 本次用了元宝搜索：计费 14–20 元/千次，附今日已用次数 |
| `wechat.login-expired` | action | 整号历史服务返回未登录 / 登录失效：请在你的服务里重新扫码（约 4 天一次） |
| `wechat.account-risk` | warn | 首次用整号历史：走的是你自己公众号的后台接口，高频会被限流甚至封号 |
| `wechat.rate-limited` | warn | 整号历史服务限流（如 `ret=200013`）：暂停一段时间 |
| `wechat.copyright` | info | 首次返回公众号正文：版权归作者，仅限个人研究、摘要引用 |

## 2. 搜索层

### 2.1 内置搜狗直连 leg `sogou`（零配置，默认开启）

- 新的固定后端 id `sogou`，只服务 `wechat` 平台；默认链 `wechat: ['omnireach', 'wx-search-cli', 'sogou']`（CLI 已实测，保持原有顺序；没装 CLI 时 sogou 兜底）。
- `GET https://weixin.sogou.com/weixin?type=2&query=<q>&page=1`，桌面 UA、`Referer: https://weixin.sogou.com/`；解析 `div.txt-box`：标题、摘要、公众号名、时间（`timeConvert('<unix>')`）。
- 还原签名链接：先访问首页拿 Cookie（SNUID 等，只存在本次请求的内存 jar），再请求 `/link?url=...`，把 `url += '...'` 片段拼接并去掉 `@`。只还原前 `wechat.sogou.resolveLinks` 条（默认 3），其余保留搜狗链接，read.fetch 能再还原。
- 节流：两次搜狗请求间隔 ≥ `wechat.sogou.minIntervalMs`（默认 1500）。antispider → `EngineError('ENGINE_RATE_LIMIT')` + `wechat.antispider` 提醒。
- 访问画像：`login: none`、`risk: medium`（反爬、出口 IP 被临时封）。

### 2.2 元宝搜索 leg `tencent-wsa`（付费，单独设置）

- 腾讯云 `wsa` `SearchPro`（API 版本 2025-05-08），TC3-HMAC-SHA256 签名，`Query`、`Mode`（默认 2 混合）、`Site=mp.weixin.qq.com`、`Cnt`、`Freshness`。响应 `Pages[]` 为 JSON 字符串：`title / date / url / passage / site …`。
- 凭据：`wechat.wsa.secretId / secretKey`（字面量、DSH credentials 引用或环境变量 `TENCENTCLOUD_SECRET_ID` / `TENCENTCLOUD_SECRET_KEY`），`wechat.wsa.enabled` 默认 false；两者齐全且 enabled 才 ready。
- ready 时排在 wechat 链首（用户自己配的付费源优先，符合源策略）；显式 `platformBackends.wechat` 时按用户写的顺序。
- 每次调用计入 usage ledger；可选 `wechat.wsa.dailyLimit`（默认 100），超出拒绝并提醒。
- 访问画像：`login: api-key`、`risk: low`、`billing: 14–20 元/千次`。无 key 无法实测：`verification: docs-only`。

## 3. 读取层（read.fetch）

- `mp.weixin.qq.com` 抽取规则：正文 `#js_content`、标题 `#activity-name`、公众号 `#js_name`、发布时间 `var ct = "<unix>"`。
- 该域名在 auto 模式下先走 HTTP（iPhone UA + `Referer: https://mp.weixin.qq.com/`），失败再按原顺序 jina → playwright。
- 页面分类：无 `js_content` 的小页面 → `shell`，链接无 `signature` 时附 `wechat.bare-url`；「环境异常 / 完成验证」→ `captcha`；「已被发布者删除 / 违规无法查看 / 账号已迁移」→ `error` 并说明原因。
- `weixin.sogou.com/link?url=` 链接：先按 2.1 还原成签名链接再读，结果 `url` 用还原后的链接。

## 4. 整号历史层（新动作组 `wechat`）

动作通过 `web_index` → `web_call` 渐进披露，组名 `wechat`：

| 动作 | 依赖 | 说明 |
|---|---|---|
| `wechat.album` | 无（免登录） | `appmsgalbum?action=getalbum&__biz&album_id&f=json&count&begin_msgid&begin_itemidx`；也接受合集页 URL；分页游标 |
| `wechat.accounts` | `wechat.history.baseUrl` | 用户自托管的 wechat-download-api：按名字搜公众号 → fakeid |
| `wechat.articles` | `wechat.history.baseUrl` | 按 fakeid 列文章（分页）；正文用 read.fetch 读 |
| `wechat.status` | 无 | 列出 wechat 各层的就绪状态、访问画像、今日元宝用量、上次失败原因 |

- 整号历史服务地址由用户填（常见是 `http://127.0.0.1:<port>`）：只对**这个配置的 origin** 放开回环地址，safe-http 的其它限制不变。可选 `wechat.history.apiKey`。
- 接口契约以 tmwgsicp/wechat-download-api 源码为准（`routes/search.py`、`routes/articles.py`），标 `contract-only`；未登录 / 失效映射到 `wechat.login-expired`，限流映射到 `wechat.rate-limited`。
- 访问画像：`login: qr-scan`、`loginTtl: 约 4 天`、`risk: high`（未公开接口、限流、封号）。

## 5. 设置

新增顶层 `wechat` 设置组「微信 / 公众号」（config-groups、设置卡片、文本视图都要有）：

```yaml
wechat:
  notices: once            # once | always | off
  sogou: { enabled: true, resolveLinks: 3, minIntervalMs: 1500 }
  wsa: { enabled: false, secretId: ..., secretKey: ..., mode: 2, dailyLimit: 100 }
  history: { baseUrl: "", apiKey: ... }
```

密钥字段与其它 key 一样不回显；`config.inspect` / `config.export` 脱敏。

## 6. 验证

- 搜狗、签名链接、文章页、合集接口：匿名、低频（单次实测 ≤ 10 个请求）现场抓取后脱敏存为 fixture；单测全部离线。
- 元宝搜索：按官方文档与签名规范写，签名用官方文档的示例向量做单测；不发真实请求。
- 整号历史：读上游源码定契约，单测用本地 stub 服务；不部署、不登录。
