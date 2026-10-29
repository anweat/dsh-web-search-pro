# 调研记录：增强型、可持久化的扩展网页搜索插件（web-search-pro）

> 工作区子文件夹，记录本插件的调研结果与实现依据。
> 插件源码位于仓库：`D:\codeproject\deepseek-harness\scratch-plugin\web-search-pro\`
> 本文件夹的 [IMPLEMENTATION.md](./IMPLEMENTATION.md) 记录具体实现。

---

## 1. 灵感来源调研

### 1.1 MediaCrawler（NanmiCoder/MediaCrawler）

- **定位**：多平台自媒体数据采集（小红书/抖音/快手/B站/微博/贴吧/知乎），核心是 **Playwright 浏览器自动化 + 登录态缓存**（storageState），"无需 JS 逆向，利用保留登录态的浏览器上下文，通过 JS 表达式获取签名参数"。
- **借鉴点**：
  - 登录态缓存 → 本插件 `playwright.storageStatePath`（复用已登录浏览器会话抓取受限内容）。
  - 多平台模块化（`store/xhs/`、`store/weibo/` 等 per-platform 目录）→ 本插件 `engines.ts` 的 per-engine 后端。
  - 持久化到 sqlite/csv/json → 本插件 `store.ts`（node:sqlite）。
  - 关键词搜索 + 指定内容爬取 → `web_search_pro` + `web_fetch_pro`/web_snapshot。
- **注意**：MediaCrawler 偏"批量爬虫"，本插件定位是"模型按需检索 + 缓存"——不批量爬取、遵守站点条款、结果落 SQLite 供复用。

### 1.2 Agent-Reach（Panniantong/agent-reach）

- **定位**：15 平台的"互联网能力路由器"，多后端（OpenCLI / 平台 CLI / API），`agent-reach doctor --json` 体检 + 按平台选命令组 + 失败重试链。
- **借鉴点**：
  - 多后端路由 + 可用性检测（`available()` 便宜检查）→ 本插件 `engines.ts` 的 `Engine` 接口。
  - 平台 CLI 复用：`gh search`、`bili search`、`yt-dlp`、`opencli <platform> search -f yaml`、`mcporter call exa.web_search_exa` → 本插件的 github/bilibili/youtube/opencli 后端。
  - Jina Reader（`curl https://r.jina.ai/URL`）→ 本插件 fetch 管线第一级。
  - doctor 语义 → 本插件 `web_search_stats` / 引擎 `available()`。
- **注意**：Agent-Reach 是"技能/CLI 集合"，本插件把它沉淀为 DSH 插件内的工具化后端，且不读取浏览器 Cookie（遵从其边界）。

### 1.3 脚本猫 / 油猴（ScriptCat / Tampermonkey userscripts）

- **定位**：声明式 `@match` + `@run-at` + 注入脚本，按站点增强页面。
- **借鉴点**：
  - **声明式按 hostname 的提取规则**（contentSelectors / removeSelectors）→ 本插件 `extract.ts` 的 `ExtractRule` + 内置规则表（zhihu/bilibili/xiaohongshu/github/juejin/csdn/…）。
  - **用户可编辑、可持久化的规则**（油猴用户可自己写脚本）→ `web_rule` 工具 + SQLite `rules` 表，运行时增删，重启不丢。
  - 注入式页面增强 → Playwright 内 `page.evaluate` 按规则抽取（`web_snapshot`/fetch 的 playwright 后端）。
- **安全边界**：不执行任意用户 JS（避免注入风险），只支持选择器级规则——文档中明示。

### 1.4 opencli 与 playwright

- **opencli**：桌面浏览器会话复用（Chrome/Edge 扩展 + CDP）。`opencli list` 显示大量适配器（antigravity/chatgpt-app/codex/cursor/discord-app 等），平台类（xiaohongshu/twitter/reddit/instagram/facebook）通过扩展连接浏览器登录态工作。本机 doctor 显示扩展文件存在但当前未连接 → 插件运行时探测、失败给结构化提示。
- **playwright 1.60.0（全局 npm）**：chromium 已装；系统 Edge 存在（`channel: 'msedge'`）。本插件通过 `npm root -g` + createRequire 定位模块，不引入本地依赖。

### 1.5 DSH 插件架构机制（动手验证的结论）

| 机制 | 结论 |
|---|---|
| 插件模块 | TS 文件导出 `name`/`inject`/`apply(ctx)`，绝对路径或包名挂载 |
| **模块解析** | **tsx 的 tsconfig paths 解析基于 cwd（仓库根），与插件文件位置无关**——插件在仓库内任意位置都可 `import '@deepseek-ai/*'`（源码级单实例）；`yaml/js-yaml/jsdom/playwright` 等非 `@deepseek-ai` 依赖用 createRequire 锚定（仓库根 / .pnpm / 全局 npm root） |
| **入口 name 解析** | patch 行 `name` 相对 **root include 的 baseUrl = profile 目录**（$DSH_HOME/profiles/<name>/）解析——跨盘需 junction；**Windows 绝对路径 `import('D:/...')` 会 ERR_UNSUPPORTED_ESM_URL_SCHEME** |
| 激活方式 | profile `cordis.patch.yml`（持久，重启生效）；**web profile 当前 `hmr: disabled`**（web-app bundle 行），无热重载 |
| 工具 | `ctx.tools.register(defineTool({name, description, parameters, output:{schema,render}, execute(args, exec), timeoutMs, isConcurrencySafe, presentCall}))`；`exec.signal` 必须转发；输出 schema 是纯 JSON Schema |
| ctx.web 能力缝 | `ctx.web.registerSearchProvider({id, available, search(req, signal)})` / `registerFetchProvider`；选中规则：配置 id 或唯一可用；web profile 现配置 `searchProvider: deepseek-official` 且 `tool-web` 被禁用 |
| SQLite | `node:sqlite`（Node 24 内置，无需 flag/依赖） |
| 本机环境 | Node v24.14.0；playwright 1.60 全局；opencli/gh/bili/yt-dlp/agent-reach 可用；Edge 已装；gh 已登录；`$DSH_HOME=C:\Users\anwea\.dsh` |

### 1.6 DSH 社区调研（github.com/topics/dsh-plugin）

代表性仓库（2026-08 检索，gh search --topic dsh-plugin）：

| 仓库 | 相关度 | 要点 |
|---|---|---|
| `taxueseek/argo` | ★★★★★ | "专门为 agent 打造的搜索工具"，多语言（中/英/学术/代码/购物/金融/新闻/百科）——与本插件定位最接近；值得后续对照其引擎划分 |
| `whiteguo233/OpenBiliClaw` | ★★★★ | 本地内容发现 Agent：B站/小红书/抖音/YouTube/X/知乎/Reddit/微博 + 开放 Web |
| `AdamPlatin123/awesome-dsh-plugins` | ★★★★ | DSH 插件目录 + 每日兼容性追踪；观察其"打包/分发"范式 |
| `0xsline/awesome-deepseek-harness` | ★★★ | DSH 生态精选，指向 dsh-external/hub |
| `awesome-dsh-plugin/awesome-dsh-plugin` | ★★★ | DSH 插件精选列表 |
| `Anionex/dsh-vision-toolkit`、`liustack/modlens` | ★★ | 视觉类插件（本插件不涉及，但示范 client 插件/技能形态） |
| `zhu1090093659/dsh-web-ui`、`ccch1mneyyy/dsh-cc-tui`、`Small-tailqwq/dsh-deep-whale` | ★ | Web UI/皮肤/TUI 类——说明社区以 npm bundle + `dsh plugin add` 分发为主 |
| `icetomoyo/dsh_workflow`、`NanmiCoder/dsh-agent-teams` | ★ | workflow/agent 编排类 |

**社区启示**：
1. 分发范式：npm 包 + `dsh.bundle` manifest + `dsh plugin --profile <name> add <pkg>`；本插件当前以源码 patch 开发，后续可打包成 npm bundle 分发（见 IMPLEMENTATION.md 的 Roadmap）。
2. 搜索/内容类插件是社区空白点（argo 是独立工具而非 DSH 插件）——本插件的"DSH 原生工具 + 持久化 + 平台后端"组合有差异化价值。
3. 兼容性追踪（awesome-dsh-plugins）提示插件应尽量少依赖内部 API——本插件只依赖 `ctx.tools`/公共 `ctx.web` 能力缝与公开导出。

### 1.6.2 MediaCrawler 中文社区平台（第三阶段核对）

MediaCrawler 覆盖 **7 个中文平台**（`media_platform/` 目录实测）：bilibili、xhs、douyin、kuaishou、
weibo、tieba、zhihu。机制：**Playwright + 登录态**（各平台 `login.py` 登录导出 cookie）；知乎额外用
JS 算 `get_sign` 签名再调 `/api/v4/search_v3`（"利用保留登录态的浏览器上下文，通过 JS 表达式获取签名参数"）。
许可：**NON-COMMERCIAL LEARNING LICENSE**（仅供学习、禁商用）——签名算法不能照搬进本插件的 MIT 许可。

实测免登录公开接口全被风控：知乎 `search_v3` → 40362；微博 `m.weibo.cn` 搜索 → 空；豆瓣 `/j/search` → 403。
因此本插件走 **纯 Playwright 驱动搜索结果页**（登录态浏览器打开搜索页、读 DOM，浏览器自己完成签名，
不碰私有 API 与签名算法）——MediaCrawler 的 spirit、MIT 独立实现。选择器 best-effort，`platformRules`
配置可覆盖；登录态用 `scripts/save-login.mjs` 一次性保存复用。详见 IMPLEMENTATION.md §7.3.4.2/7.3.4.3。

### 1.6.1 外部依赖"安装即配置"调研（第二阶段补充）

插件大多数后端需要系统额外安装的工具，本机实测 + 检索结论：

| 依赖 | 本机位置 | 安装通道 | 检测 |
|---|---|---|---|
| gh | C:\Program Files\GitHub CLI\gh.exe | winget install GitHub.cli / choco install gh | where gh |
| bili (bili-cli) | C:\Users\anwea\.local\bin\bili.exe（pipx/uv 风格） | uv tool install bili-cli / pipx install bili-cli | where bili |
| yt-dlp | venv/Scripts/yt-dlp.exe | pip install yt-dlp / uv tool install yt-dlp | where yt-dlp |
| opencli | %APPDATA%\npm\opencli | npm i -g opencli | where opencli |
| agent-reach | venv/Scripts/agent-reach.exe | pip install agent-reach / uv tool install agent-reach | where agent-reach |
| mcporter | %APPDATA%\npm\mcporter | npm i -g mcporter | where mcporter |
| playwright | 全局 npm + anaconda（chromium 已装） | npm i -g playwright && playwright install chromium | where playwright |

**"安装按钮做成配置"的取舍**：浏览器设置卡里的安装按钮 = 从浏览器触发任意命令执行，绕不开
DSH 的审批/权限闸；而 DSH 原生可被模型调用的"工具"天然走权限管线。因此安装做成 `web_deps` 工具
（check 检测 + 安装命令；install 执行包管理器命令），设置卡只做"配置值"。详见
IMPLEMENTATION.md §7.3.3。

### 1.7 Argo（taxueseek/argo，社区最接近的对照物）——补充调研

Argo v2.8 是"给 AI Agent 用的多语言搜索基础设施"（120+ 引擎、MCP 10 工具），其"证据管线"设计对本插件 Roadmap 有直接参考价值：

| Argo 设计 | 说明 | 本插件对照 |
|---|---|---|
| 语言检测 → 领域路由 → 多引擎召回 → RRF 融合 | 按领域/语言选路，混合召回后按 RRF 排序融合 | 已有引擎链 + `multi` 并行合并（按 URL 去重，后续可加 RRF） |
| 双层缓存（内存 + SQLite），热查询约 10ms | SQLite 持久缓存 + 内存层 | 已有 SQLite TTL 缓存（后续加内存 LRU 层） |
| 预算模式：免费优先，Key 全可选 | 无 Key 也能跑，配 Key 升级质量 | 默认引擎序 ddg/bing → exa/seam（Key 可选） |
| 证据可信度：selection/absorption/freshness/共识 | 结构化评分而非裸链接清单 | Roadmap：为来源加 freshness/权威域打分 |
| 交付"可吸收的证据 JSON"而非给人看的 SERP | 结果即材料（可排序、可复核、不撑爆上下文） | 输出结构化 sources + content + 引擎元数据 |
| 垂直源直连（行情/化学式等直接给答案） | 领域路由到垂直源 | 已有平台后端（github/bilibili/v2ex/rss…），可继续扩展垂直源 |

实现细节可对照其 `engines/`、`backends/`、`config.yaml` 目录结构（克隆于 `%TEMP%\dsh-refs\argo`）。

---
