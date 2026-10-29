# 文档索引

入口在仓库根目录的 [README.md](../README.md)（中文）和 [README.en.md](../README.en.md)（英文），版本记录在 [CHANGELOG.md](../CHANGELOG.md)。本目录放按主题拆开的详细文档。

## guide/：面向用户（中文）

| 文件 | 内容 |
|---|---|
| [install.md](./guide/install.md) | 安装（DSH CLI / Desktop / 本地目录）、新用户第一次安装与首次使用、排障 |
| [compatibility.md](./guide/compatibility.md) | 当前兼容范围、不再支持的旧线、peer 范围的写法与理由 |
| [search-and-evidence.md](./guide/search-and-evidence.md) | 适用情形、平台来源、证据包模式（相关度门、有界第二轮） |
| [evidence-scoring.md](./guide/evidence-scoring.md) | Jev 提示词（rubric）、评分模型 provider 与用量上限、覆盖判定 |
| [web-provider.md](./guide/web-provider.md) | 让宿主内置 `web_search` / `web_fetch` 经过本插件（`ctx.web` provider） |
| [tools-and-actions.md](./guide/tools-and-actions.md) | `web_index` / `web_call`、全部动作、旧工具映射、审批与超时、输出预算 |
| [config.md](./guide/config.md) | 配置的四层、全部顶层键与默认值、需要重启的设置、agent 覆盖层与 `config.*` |
| [settings-panel.md](./guide/settings-panel.md) | 设置面板的分组与字段 |
| [sources.md](./guide/sources.md) | 引擎总览、博查、DeepSeek 搜索 / 抓取、来源策略、匿名来源与目录、需 Key 来源 |
| [cli-adapters.md](./guide/cli-adapters.md) | 声明式 CLI 适配、内置规格与验证程度、默认后端链、登录类平台、自定义 CLI、置信度 |
| [dependencies.md](./guide/dependencies.md) | 外部依赖与安装命令 |
| [platform-login.md](./guide/platform-login.md) | 平台登录态：opencli 优先、AuthProfile 与 `browserBindings`（原 `LOGIN.md`） |
| [browser-scripts.md](./guide/browser-scripts.md) | 浏览器脚本与自动化分层、RulePack、Recipe、UserScript、OpenCLI |
| [custom-platforms.md](./guide/custom-platforms.md) | 自定义平台与结果选择器覆盖 |
| [history.md](./guide/history.md) | 历史管理 |
| [development.md](./guide/development.md) | 开发、测试、文档检查 |

## dev/：面向开发者

| 文件 | 内容 |
|---|---|
| [IMPLEMENTATION.md](./dev/IMPLEMENTATION.md) | 具体实现（架构 / 工具 / 设计决策 / 激活步骤 / 排障教训 / Roadmap） |
| [RESEARCH.md](./dev/RESEARCH.md) | 调研记录（MediaCrawler / Agent-Reach / 脚本猫油猴 / opencli / playwright / DSH 机制 / dsh-plugin 社区 / 中文社区平台） |
| [overlay-design.md](./dev/overlay-design.md) | agent 覆盖层设计 |

## validation/：验证记录（原样保留）

[validation/](./validation/) 下是各版本的真实宿主验证、CLI 实测与陪测清单。

## 旧章节到新位置对照

2026-10-29 的文档整理把原 `README.md`（717 行）和 `LOGIN.md` 拆开，内容没有删除；原文里与中文段落逐句对应的英文段落（`**English**` 段）已合并掉，信息以中文段落为准。

| 旧位置 | 新位置 |
|---|---|
| README 开头介绍 | [README](../README.md) 的介绍与亮点 |
| README 兼容与发布通道：历史表 | [CHANGELOG](../CHANGELOG.md#兼容与发布通道历史) |
| README 兼容与发布通道：支持范围、不再支持旧线、peer 范围的写法 | [compatibility.md](./guide/compatibility.md) |
| README 安装 | [README](../README.md#安装)（精简版）、[install.md](./guide/install.md) |
| README 从旧版本升级 | [CHANGELOG](../CHANGELOG.md#从旧版本升级) |
| README 快速使用与适用情形（含开箱默认值） | [README](../README.md#第一次使用)（默认值）、[search-and-evidence.md](./guide/search-and-evidence.md) |
| README 平台来源 | [search-and-evidence.md](./guide/search-and-evidence.md#平台来源) |
| README 两种用法 | [web-provider.md](./guide/web-provider.md) |
| README 证据包模式（含相关度门、有界第二轮） | [search-and-evidence.md](./guide/search-and-evidence.md#证据包模式searchrun-传-task-或-profile) |
| README Jev 提示词（rubric） | [evidence-scoring.md](./guide/evidence-scoring.md#jev-提示词rubric可配置有版本) |
| README 评分模型 provider 与用量上限、覆盖判定 | [evidence-scoring.md](./guide/evidence-scoring.md#评分模型-provider-与用量上限) |
| README 工具面（索引 → 调用）、动作、旧工具到新动作 | [tools-and-actions.md](./guide/tools-and-actions.md) |
| README 审批、并发与超时、工具面形态、输出预算 | [tools-and-actions.md](./guide/tools-and-actions.md#审批并发与超时按动作) |
| README 浏览器脚本与自动化分层 | [browser-scripts.md](./guide/browser-scripts.md) |
| README 配置、需要重启插件的设置、agent 覆盖层与 `config.*` | [config.md](./guide/config.md) |
| README 设置面板 | [settings-panel.md](./guide/settings-panel.md) |
| README CLI 适配 | [cli-adapters.md](./guide/cli-adapters.md) |
| README 外部依赖（按需） | [dependencies.md](./guide/dependencies.md) |
| README 平台与引擎（含博查、DeepSeek、来源策略、匿名来源与目录、需 Key 来源） | [sources.md](./guide/sources.md) |
| README 开发 | [development.md](./guide/development.md) |
| README License | [README](../README.md#license) |
| README 中文社区平台登录态 | [platform-login.md](./guide/platform-login.md) |
| README 历史管理 | [history.md](./guide/history.md) |
| README 自定义平台 | [custom-platforms.md](./guide/custom-platforms.md) |
| LOGIN.md 方式一 / 方式二（保存登录态、Cookie 导出） | [platform-login.md](./guide/platform-login.md#搜索页平台authprofile-与-browserbindings) |
| LOGIN.md 受控脚本增强（RulePack）、模型生成 Recipe、外部模型生成 UserScript、OpenCLI 社区平台 | [browser-scripts.md](./guide/browser-scripts.md) |
| LOGIN.md 结果选择器可配置 | [custom-platforms.md](./guide/custom-platforms.md#按平台覆盖结果选择器) |
| LOGIN.md 安全与合规提醒 | [platform-login.md](./guide/platform-login.md#安全与合规提醒) |
| `docs/IMPLEMENTATION.md`、`docs/RESEARCH.md`、`docs/overlay-design.md` | `docs/dev/` 下同名文件 |
