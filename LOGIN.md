# 中文社区平台登录态（复用你已登录的浏览器）

知乎 / 微博 / 豆瓣 / 贴吧 / 抖音 / 快手 / 小红书的搜索页都有反爬与登录墙，
免登录的公开接口基本都被风控。所以这些平台走 **Playwright 驱动登录态浏览器** 的路径：
在你已登录的浏览器里打开搜索页、读渲染结果——不需要逆向任何签名。

## 方式一：登录一次保存登录态（推荐）

运行插件包里的脚本，按提示逐个平台登录一次（扫码/账号密码），
脚本会把所有 cookies 合并保存成一个 storageState JSON：

```bash
cd dsh-web-search-pro
node scripts/save-login.mjs all login-state.json
# 或只登录一个平台：
node scripts/save-login.mjs zhihu login-state.json
```

然后在 dsh-browser 的部署配置中创建命名、按域名授权的 AuthProfile：

```yaml
# cordis.yml 中的 dsh-browser 插件行
- id: browser
  name: '@anweat/dsh-browser'
  config:
    authProfiles:
      china-community:
        storageStatePath: 'D:/secrets/login-state.json'
        allowedDomains: [zhihu.com, weibo.com, douban.com, baidu.com, douyin.com, kuaishou.com]
        persistState: false

# $DSH_HOME/settings.yaml
---
web-search-pro:
  browserBindings:
    zhihu: { authProfile: china-community }
    weibo: { authProfile: china-community }
```

> storageState 是 Playwright 的标准登录态文件（cookies + origins），
> 同一份文件可含多个站点登录态，但每个 AuthProfile 必须显式给出 `allowedDomains`；访问其他域名会被拒绝。`persistState` 默认 false，只有明确开启才会原子回写新 Cookie/localStorage。
> `scripts/save-login.mjs` 优先复用 `@anweat/dsh-browser` 自带的 Playwright；默认启动其 bundled Chromium。如需显式使用已安装的 Chrome，可临时设置 `DSH_BROWSER_CHANNEL=chrome`。

## 方式二：用 Cookie 插件导出

如果你更习惯手动导出：

1. 在浏览器装 Cookie-Editor（或 EditThisCookie）。
2. 在目标站点导出 cookies（JSON）。
3. 组装成 storageState 格式：

```json
{ "cookies": [ ...导出的 cookies... ], "origins": [] }
```

每个 cookie 至少需要 `name` `value` `domain` `path`（可补 `expires` `httpOnly` `secure`）。

不要把 Cookie JSON 作为模型工具参数传入；导入到本地 storageState 文件后只在配置中引用路径。

## 受控脚本增强（RulePack）

dsh-browser 可配置命名 RulePack。它适合由部署者长期维护的站点增强，支持有界的 `waitFor` / `click` / `scroll` / `wait` 步骤；可选 init script 只能引用本地文件，必须提供 SHA-256，且文件不超过 64KB。RulePack 同样按 `matches` 限域。

```yaml
rulePacks:
  zhihu-enhanced:
    matches: [zhihu.com]
    initScriptPath: 'D:/dsh/rules/zhihu-init.js'
    initScriptSha256: '<64位sha256>'
    steps:
      - { type: waitFor, selector: '.SearchResult-Card', timeoutMs: 10000 }
      - { type: scroll, deltaY: 1600, repeat: 2, waitMs: 300 }
```

## 模型生成 Recipe

临时、多步骤操作不必先写持久 RulePack。模型可调用 `browser_recipe_run`，每次最多 25 步：

```json
{
  "url": "https://example.com",
  "steps": [
    { "type": "wait", "condition": "selector", "value": "h1" },
    { "type": "extract", "selector": "h1", "mode": "text" }
  ]
}
```

`wait`、`extract`、`assert`、`screenshot` 是只读路径；一旦包含 `click`、`fill`、`type`、`press`、`select`、`check`、`hover` 或 `scroll`，DSH 会在执行前发起一次性审批。

## 外部模型生成 UserScript

外部模型可以输出油猴格式脚本，但需要走“先验证、后执行”两步：

```text
browser_script_validate({ url, source })
browser_userscript_run({ url, source, authProfile? })
```

```javascript
// ==UserScript==
// @name Read page heading
// @match https://example.com/*
// @grant none
// ==/UserScript==
return { heading: document.querySelector('h1')?.textContent || '' }
```

限制与边界：

- 必须声明 HTTP(S) `@match`，`@exclude` 生效；目标 URL 不匹配时拒绝。
- 只允许 `@grant none`，拒绝 `@require`，源码上限 64KB，输出与运行时间有界。
- 验证结果包含 SHA-256 和静态能力提示，但能力提示不是安全证明。
- 脚本运行在目标页主世界，能读写页面并使用该页已有登录态；因此 `browser_userscript_run` 每次都进入 DSH 原生一次性审批。不要批准未检查的源码，也不要让脚本回传 Cookie、令牌、表单值等秘密。

常见只读任务优先用 `browser_script_catalog` 中的内置 `article-clean`、`links`、`jsonld`、`forms`，无需提交任意脚本。

## OpenCLI 社区平台

Reddit / 小红书 / Twitter / Instagram / Facebook 走 OpenCLI Browser Bridge，使用当前 Chrome 扩展会话，不读取或导出 Cookie。`dsh-browser` 已包含 OpenCLI CLI，但 Chrome 扩展必须已安装并连接：

```bash
opencli doctor
opencli reddit search "DeepSeek Harness" -f yaml
opencli browser research open https://example.com --window background
opencli browser research state
opencli browser research extract
opencli browser research close
```

每个 `opencli browser` 子命令都必须显式给出 session 名（上例为 `research`），同名会话复用标签页状态。优先使用已有站点 adapter；没有 adapter 时优先 `network` / `extract`，最后再使用 `state` / `find` / `click` / `fill` 等 DOM 操作。

模型内先用 `browser_opencli_status` 检查 daemon、扩展和 profile；高级调用使用 `browser_opencli_run({ args: [...] })`。argv 示例：`["browser", "research", "state"]`。这个通用入口可能触发发帖、删除等站点 adapter，所以无论看起来是否只读都要求一次性审批。

若 `doctor` 显示 daemon 正常但 extension disconnected，请显式启动安装了 OpenCLI Browser Bridge 的 Chrome；不要把 Quark 或禁用扩展的 Playwright 临时 profile 当作替代。只有需要在终端独立诊断时，才需要额外全局安装 `@jackwener/opencli`。

## 结果选择器可配置

站点改版后如果提取不到结果，不用改代码——在 `settings.yaml` 按平台覆盖选择器：

```yaml
web-search-pro:
  platformRules:
    zhihu:
      item: '.SearchResult-Card'
      title: '.ContentItem-title'
      link: '.ContentItem-title a'
      text: '.Highlight'
    weibo:
      item: '.card-wrap'
      title: '.txt'
      link: '.from a'
```

## 安全与合规提醒

- 仅做**单次、低频**的搜索调用，不要批量爬取；遵守目标平台的服务条款与 robots.txt。
- 登录态文件包含你的登录凭据，请勿提交到公开仓库或分享给他人。
- 本能力借鉴 MediaCrawler 的思路（登录态浏览器驱动搜索页），
  但为 MIT 许可的独立实现，未使用其 NON-COMMERCIAL 许可下的签名算法代码。
