# 浏览器脚本与自动化分层

> 适用版本：dsh-web-search-pro 0.2.3 · [返回 README](../../README.md) · [文档索引](../README.md)

这些能力由可选的配套插件 `@anweat/dsh-browser ^0.2.0` 提供，经它的 `browser_call` 工具调用（动作名见下）；本插件只负责搜索、读取与平台后端。本文原先分散在 README 的“浏览器脚本与自动化分层”和 `LOGIN.md` 里，现已合并。

## 三类脚本入口

1. **内置只读脚本**：`article-clean`、`links`、`jsonld`、`forms`，适合稳定抽取；先用 `browser_call` 的 `script.catalog` 查看。
2. **Recipe**：最多 25 步的结构化 Playwright 操作，支持 wait/click/fill/type/press/select/check/hover/scroll/extract/assert/screenshot；交互步骤由自动化模式决定审批。
3. **外部 UserScript**：适合外部模型生成站点专项逻辑。先 `script.validate` 查看 SHA-256、域名范围与能力提示，再 `script.run_userscript`（均经 `browser_call`）；它在页面主世界运行，并非安全沙箱。

常见只读任务优先用内置脚本，无需提交任意脚本。

## 自动化自由度（automationMode）

工具自由度由 dsh-browser 的 `automationMode` 控制：

| 模式 | 行为 |
|---|---|
| `read-only` | 隐藏或拒绝页面及 Web Search Pro 写操作 |
| `standard`（默认） | 对交互、写 Recipe、外部脚本、OpenCLI、缓存 / 规则变更和安装操作审批 |
| `autonomous` | 直通页面交互、写 Recipe 以及本地缓存 / 规则变更，但安装、外部脚本和通用 OpenCLI 仍审批 |
| `unrestricted` | 为隔离测试 profile 提供无审批运行 |

所有模式仍保留域名、参数、大小和步骤上限校验，并始终应用 dsh-browser 的调用缓冲、退避与爬取预算。本插件自己的动作审批也读取这个模式，见 [工具与动作](./tools-and-actions.md#审批并发与超时按动作)。

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

在本插件里用 `browserBindings.<平台>.rulePack` 把平台绑定到某个 RulePack（见 [平台登录态](./platform-login.md#搜索页平台authprofile-与-browserbindings)）。

## 模型生成 Recipe

临时、多步骤操作不必先写持久 RulePack。模型调用 `browser_call` 的 `automation.run_recipe`，每次最多 25 步：

```json
{
  "action": "automation.run_recipe",
  "args": {
    "url": "https://example.com",
    "steps": [
      { "type": "wait", "condition": "selector", "value": "h1" },
      { "type": "extract", "selector": "h1", "mode": "text" }
    ]
  }
}
```

`wait`、`goto`、`extract`、`assert`、`screenshot` 是只读路径；一旦包含 `click`、`fill`、`type`、`press`、`select`、`check`、`hover` 或 `scroll`，`standard` 会发起一次性审批，`autonomous` / `unrestricted` 直接执行，`read-only` 拒绝。`schemaVersion: 2` 的严格定位器与后置条件见 dsh-browser 的 `automation.develop`。

## 外部模型生成 UserScript

外部模型可以输出油猴格式脚本，但需要走“先验证、后执行”两步：

```text
browser_call({ action: "script.validate", args: { url, source } })
browser_call({ action: "script.run_userscript", args: { url, source, authProfile? } })
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
- 脚本运行在目标页主世界，能读写页面并使用该页已有登录态；除 `unrestricted` 外，`script.run_userscript` 会进入 DSH 原生一次性审批。无审批测试也不要让脚本回传 Cookie、令牌、表单值等秘密。

## OpenCLI

OpenCLI 用于已有站点 adapter 或复用 Chrome 登录会话（不读取或导出 Cookie）。推荐顺序是 **`opencli.catalog` 查精确 adapter → network / extract → DOM 操作**；先运行 `opencli.status` 检查 daemon、扩展和 profile。

- `opencli.run` 接受 argv 数组而非 shell 字符串（例：`["browser", "research", "state"]`），可覆盖 adapter、显式 session 的 `browser state/find/get/click/fill/type/select/keys/wait/extract/network` 等命令。
- 每个 `opencli browser` 子命令都必须显式给出 session 名（上例为 `research`），同名会话复用标签页状态。没有 adapter 时优先 `network` / `extract`，最后再用 `state` / `find` / `click` / `fill` 等 DOM 操作。
- 这个通用入口可能触发发帖、删除等站点 adapter，所以除隔离测试用的 `unrestricted` 外都要求一次性审批。
- OpenCLI 是可选依赖，dsh-browser 0.2.2 起**不再内置**：用 `npm i -g @jackwener/opencli` 安装，扩展未连接时用 `opencli doctor` 诊断。若 `doctor` 显示 daemon 正常但 extension disconnected，请显式启动装有 OpenCLI Browser Bridge 的 Chrome；不要把 Quark 或禁用扩展的 Playwright 临时 profile 当作替代。
- 本插件的登录类平台（小红书 / 知乎 / Reddit / X）直接用独立 `opencli` 做后端，不经过 `opencli.run`，见 [平台登录态](./platform-login.md)。
