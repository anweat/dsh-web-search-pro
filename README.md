# dsh-web-search-pro

[English](./README.en.md) | 中文

[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（DSH）的增强型网页搜索插件：多引擎搜索、平台搜索、持久化缓存和证据包，常驻上下文只有两个工具。

- **证据包模式**：给 `search.run` 一句任务目标，返回的不是结果列表，而是按需求评分后的摘录和未满足的缺口，占用的上下文少得多。
- **多引擎 + 平台来源**：ddg / bing / Exa / Jina 等网页引擎加 GitHub、B站、YouTube、小红书、知乎、Reddit、X、RSS 等平台，统一的探测、冷却、回退与历史；DeepSeek 搜索 / 抓取是“常用”来源（按请求计费）。
- **登录由你自己完成**：需要登录的平台优先走 `opencli`（用你日常 Chrome 的登录态），插件没有登录窗口，也不读 Cookie。
- **两个常驻工具**：`web_index`（目录）→ `web_call`（执行），27 个动作按需披露，约 800 字符常驻。
- **持久化**：SQLite + 内存 LRU 双层缓存、查询历史、可再导入的站点提取规则。
- **可视化设置**：一张设置卡片管理搜索顺序、Key、自定义 CLI 和评分模型，agent 的改动以覆盖层形式出现，可一键采纳或撤销。

## 兼容性

| 项 | 范围 |
|---|---|
| dsh-web-search-pro | `0.2.3` |
| DSH 宿主（peer） | `>=0.2.0-rc.2 <0.2.1-0 \|\| >=0.2.1-rc.2 <0.2.2-0`；实测 `0.2.0-rc.2`、`0.2.1-rc.3`、`0.2.1-rc.4` |
| cordis（peer） | `~4.0.4` |
| 可选配套 `@anweat/dsh-browser` | `^0.2.0`（0.2.1 线宿主上必须是 `0.2.2` 起） |
| DSH 0.1.x 宿主或 dsh-browser 0.1.x | 固定使用 `dsh-web-search-pro@0.1.15`，不再更新 |

历史版本的兼容表见 [CHANGELOG](./CHANGELOG.md#兼容与发布通道历史)，peer 范围的写法见 [兼容范围](https://github.com/anweat/dsh-web-search-pro/blob/master/docs/guide/compatibility.md)。

## 安装

**DSH CLI**（装完重启 profile）：

```bash
# 只要搜索：
dsh plugin --profile web add dsh-web-search-pro@0.2.3
# 还要读取渲染页 / 浏览器平台：连同可选的浏览器插件一起装（两者都必须是 profile 的直接依赖）
dsh plugin --profile web add @anweat/dsh-browser@0.2.2 dsh-web-search-pro@0.2.3
dsh --profile web
```

**DSH Desktop**：Desktop 的 profile 由应用管理，CLI 不能操作它。打开**插件**页 → **Add plugin**，填包名（可带版本，如 `dsh-web-search-pro@0.2.3`，写法同上面 `add` 后面那段）→ Install；对话框里还能选 **Registry**。非官方插件升级 = 先卸载再重装；国内镜像（如 npmmirror）可能晚同步，装不到新版本时把 Registry 换成 `https://registry.npmjs.org`。

**本地目录 / tarball（开发用）**：`dsh plugin --profile web add ../dsh-browser ./dsh-web-search-pro`。

更多（新用户第一次安装的注意事项、排障）见 [安装与首次使用](https://github.com/anweat/dsh-web-search-pro/blob/master/docs/guide/install.md)；升级见 [CHANGELOG](./CHANGELOG.md#从旧版本升级)。

## 第一次使用

- **设置卡片**：`设置 → 插件 → 插件配置 → Web Search Pro`。顶部的状态摘要显示实际尝试顺序的默认引擎链、已配置 Key 的来源数、DeepSeek 是否就绪、待重启项等。
- **查看后端**：让模型调用 `web_call` 的 `sources.status`，每个来源 / 平台的就绪状态和被跳过的原因都在里面。
- **来源与密钥**：网页搜索和证据管线装完即用（ddg / bing 免 Key）。有 `DEEPSEEK_API_KEY` 时，默认搜索会先用**按请求计费**的 DeepSeek 搜索；不想用就在 `sources.disabled` 里写 `deepseek`。Exa、Jina、博查、GitHub 等 Key 在设置卡片的“来源”分组里写入（存进 DSH Credentials，不读回明文）。
- **开箱默认值**：默认关闭 Jev（`evidence.jevMode: off`，证据评分用本地规则，不调用任何模型，也不需要任何模型 Key）；只有配置了博查 Key 才会使用博查。
- **可选依赖**：浏览器插件 `@anweat/dsh-browser`（`read.snapshot`、`read.fetch mode=playwright`、搜索页类平台；有 Chrome / Edge 就直接用，不用下载 Chromium）；`npm i -g @jackwener/opencli` 加它的 Browser Bridge 扩展（小红书 / 知乎 / Reddit / X，用你日常 Chrome 的登录态，见 [平台登录态](https://github.com/anweat/dsh-web-search-pro/blob/master/docs/guide/platform-login.md)）；bili、yt-dlp、gh 等 CLI 由 `sources.deps` 检测。

## 快速示例

模型通过 `web_call({action, args})` 调用。证据包（传 `task` 或 `profile`）：

```json
{"action":"search.run","args":{"query":"node:sqlite busy timeout","task":"how to set a busy timeout in node:sqlite","profile":"docs_code"}}
```

搜单个平台（登录类平台走 opencli-first 的后端链）：

```json
{"action":"search.run","args":{"query":"机械键盘 轴体 推荐","task":"了解知乎上对机械键盘轴体的真实经验","profile":"experience","platform":"zhihu"}}
```

读页用 `read.fetch`（长页传 `offset` 续读），不知道用哪个来源就问 `search.recommend`。更多用法见 [搜索用法与证据包](https://github.com/anweat/dsh-web-search-pro/blob/master/docs/guide/search-and-evidence.md)。

## 工具与动作概览

常驻工具只有两个：`web_index({group?, action?, query?})` 渐进披露目录，`web_call({action, args})` 执行动作并返回统一信封。使用指引在随包的 skill `dsh-web-search-pro` 里。

| 组 | 动作 | 用途 |
|---|---|---|
| `search` | `run` `recommend` | 多引擎 / 平台搜索与证据包；按任务推荐至多 3 个来源 |
| `read` | `fetch` `contents` `snapshot` | 可读化抓取与续读；Exa 批量正文；浏览器快照 |
| `history` | `list` `replay` `expand` `export` `delete` | 查询历史的列出、回放、展开证据块、导出、删除 |
| `sources` | `status` `deps` `install` | 后端探测与诊断；外部依赖检测与安装 |
| `rules` | `list` `upsert` `remove` `import` `export` | 按站点提取规则 |
| `cache` | `clear` `stats` | 缓存清理与统计 |
| `config` | `inspect` `set_order` `set_confidence` `upsert_cli` `remove_cli` `reset` `export` | agent 覆盖层：运行时调整搜索顺序、置信度、自定义 CLI |

完整参数、审批规则、输出预算与旧工具映射见 [工具与动作](https://github.com/anweat/dsh-web-search-pro/blob/master/docs/guide/tools-and-actions.md)。

## 常用配置

写在 `$DSH_HOME/settings.yaml` 的 `web-search-pro:` 段，或用设置卡片；几乎都是热更新。

| 键 | 默认值 | 说明 |
|---|---|---|
| `engines` | `[ddg, bing, exa, seam, jina]` | 通用搜索的回退顺序 |
| `sources.priority` / `sources.disabled` | 空 | 提前 / 完全不用的来源 id（如 `disabled: [deepseek]`） |
| `searchMaxResults` | `8` | 普通搜索的默认结果数 |
| `evidence.jevMode` | `off` | 博查 Jev 评分：`off` \| `shadow` \| `control` \| `hybrid`（付费，默认不调用） |
| `evidence.sourcePolicy` | `default` | `anonymous-only` = 自动规划绝不用需要 Key / 账号 / 登录的来源 |
| `deepseekFetch` | `false` | `true` = `read.fetch` 可用 DeepSeek Fetch API（按请求计费） |
| `fetchDefaultChars` | `20000` | `read.fetch` 默认返回字符数 |
| `toolSurface` | `indexed` | `flat` = 每个动作一个工具（仅对照与调试）；**需重启** |
| `registerProvider` | `false` | 让宿主内置 `web_search` / `web_fetch` 经过本插件；**需重启** |

需要重启插件的只有 `toolSurface`、`registerProvider`、`providerId`、`timeoutMs`、`memoryCacheEntries`、`dbPath`、`verbose`、`playwright.snapshotDir`。全部键与默认值见 [配置参考](https://github.com/anweat/dsh-web-search-pro/blob/master/docs/guide/config.md)。

## 文档索引

详细文档（中文）在 [docs/](https://github.com/anweat/dsh-web-search-pro/blob/master/docs/README.md)：

- 使用：[安装与首次使用](https://github.com/anweat/dsh-web-search-pro/blob/master/docs/guide/install.md) · [搜索用法与证据包](https://github.com/anweat/dsh-web-search-pro/blob/master/docs/guide/search-and-evidence.md) · [工具与动作](https://github.com/anweat/dsh-web-search-pro/blob/master/docs/guide/tools-and-actions.md) · [历史管理](https://github.com/anweat/dsh-web-search-pro/blob/master/docs/guide/history.md)
- 配置：[配置参考](https://github.com/anweat/dsh-web-search-pro/blob/master/docs/guide/config.md) · [设置面板](https://github.com/anweat/dsh-web-search-pro/blob/master/docs/guide/settings-panel.md) · [来源与引擎](https://github.com/anweat/dsh-web-search-pro/blob/master/docs/guide/sources.md) · [内置 web 工具路由](https://github.com/anweat/dsh-web-search-pro/blob/master/docs/guide/web-provider.md) · [Jev 评分](https://github.com/anweat/dsh-web-search-pro/blob/master/docs/guide/evidence-scoring.md)
- 平台与 CLI：[平台登录态](https://github.com/anweat/dsh-web-search-pro/blob/master/docs/guide/platform-login.md) · [CLI 适配与自定义 CLI](https://github.com/anweat/dsh-web-search-pro/blob/master/docs/guide/cli-adapters.md) · [外部依赖](https://github.com/anweat/dsh-web-search-pro/blob/master/docs/guide/dependencies.md) · [自定义平台](https://github.com/anweat/dsh-web-search-pro/blob/master/docs/guide/custom-platforms.md) · [浏览器脚本与自动化分层](https://github.com/anweat/dsh-web-search-pro/blob/master/docs/guide/browser-scripts.md)
- 版本与开发：[兼容范围](https://github.com/anweat/dsh-web-search-pro/blob/master/docs/guide/compatibility.md) · [CHANGELOG](./CHANGELOG.md) · [开发](https://github.com/anweat/dsh-web-search-pro/blob/master/docs/guide/development.md) · [设计与调研记录](https://github.com/anweat/dsh-web-search-pro/tree/master/docs/dev) · [验证记录](https://github.com/anweat/dsh-web-search-pro/tree/master/docs/validation)

## License

MIT。路由控制面借鉴 Agent-Reach 的后端探测、顺序选择和失败冷却思路，核心逻辑为本项目原生 TypeScript 实现。
