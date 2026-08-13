# 具体实现：web-search-pro 插件

> 源码位置：`D:\codeproject\deepseek-harness\scratch-plugin\web-search-pro\`
> 调研依据见 [RESEARCH.md](./RESEARCH.md)。本文件为"具体实现"记录，与源码同步演进。

---

## 1. 架构总览

```
web_search_pro / web_platform_search
        │  (模型调用 → ctx.tools.execute)
        ▼
   tools.ts (8 个 defineTool)
        │
        ▼
   router.ts (SearchRouter: 引擎链/并行合并/TTL 缓存/落库)
        │
        ├── engines.ts（多后端）──────────────────────────────┐
        │    seam(ctx.web) · exa · ddg · bing · jina         │
        │    github(gh) · bilibili(bili) · v2ex(sov2ex)      │
        │    youtube(yt-dlp) · rss · opencli · agent-reach   │
        └────────────────────────────────────────────────────┤
   fetch.ts (FetchService: jina → http+规则抽取 → playwright) │
   extract.ts (脚本猫式规则 + jsdom DOM→文本)                  │
   playwright.ts (PlaywrightManager: msedge/chromium,        │
                  storageState 登录态复用, snapshot)          │
        ▼
   store.ts (node:sqlite 持久化: queries/results/pages/rules)
```

入口 `index.ts`：apply() 装配以上服务、注册工具、可选注册 ctx.web provider、
注入 systemPrompt 段落、写 apply.log 标记（verbose 时）。

## 2. 文件清单

| 文件 | 职责 |
|---|---|
| `src/index.ts` | 插件入口：`name='web-search-pro'`，`inject=['tools','systemPrompt']`，Config schema，apply() |
| `src/config.ts` | Config 接口 + Schemastery schema + `resolveConfig()` 默认值 |
| `src/store.ts` | SQLite（node:sqlite）持久化：queries/results/pages/rules 四表 + TTL 缓存 + 统计 |
| `src/extract.ts` | 内置按站规则表（zhihu/bilibili/xhs/weibo/github/juejin/csdn/medium/wikipedia/stackoverflow/douban/youtube/v2ex/36kr/sspai/ithome/huxiu）+ hostname 匹配 + jsdom 抽取 + DOM→文本 walker + JSON-LD |
| `src/engines.ts` | 12 个后端（seam/exa/ddg/bing/jina/github/bilibili/v2ex/youtube/rss/opencli/agent-reach），统一 `Engine` 接口 + `EngineError` |
| `src/router.ts` | 引擎排序/回退/并行合并、规范化查询键、缓存命中、结果落库、ctx.web provider 适配 |
| `src/fetch.ts` | fetch 管线（auto=jina→http→playwright；可按 mode 指定）、页面快照缓存、规则合并（DB 优先于内置） |
| `src/playwright.ts` | 惰性浏览器单例（msedge 通道优先，chromium 后备）、storageState 登录态、render/snapshot、字符串化 evaluate（规避 esbuild __name 注入） |
| `src/util.ts` | createRequire 锚点（js-yaml/jsdom/playwright）、httpGet（UA 轮换/超时/中止）、runCli（cmd /c 包装）、文本工具 |
| `cordis.yml` / `profile.patch.yml` | 挂载补丁（--patch 用 / 持久激活用，内容相同） |
| `test/run-tests.ts` | 15 项功能测试（store/extract/engines/router/fetch/playwright/util） |
| `test/registration.spec.ts` | 真实 Cordis 注册测试（SystemPrompt+ToolRuntime+WebRuntime 上 apply + 8 工具全执行 + provider 缝验证） |

## 3. 8 个工具

| 工具 | 参数 | 说明 |
|---|---|---|
| `web_search_pro` | query, engines?, count?, fresh?, multi? | 多引擎搜索 + 缓存 + 历史；输出 sources/engine/fromCache |
| `web_fetch_pro` | url, mode?(auto/jina/http/playwright), maxChars?, fresh?, persist? | 可读化抓取 + 快照缓存 |
| `web_platform_search` | platform(github/bilibili/youtube/v2ex/xiaohongshu/twitter/reddit/instagram/facebook/rss), query, url?, count? | 平台搜索（CLI/API/opencli 后端） |
| `web_snapshot` | url, screenshot? | Playwright 全页截图 + HTML + 文本落盘 |
| `web_history` | kind?, query?, limit? | 查询持久历史 |
| `web_cache_clear` | olderThanDays?, engine? | 清理缓存 |
| `web_rule` | action(list/upsert/remove), hostname?, contentSelectors?, removeSelectors? | 持久化脚本猫式提取规则 |
| `web_search_stats` | — | DB 大小 + 各表计数 + 引擎列表 |

## 4. 关键设计决策

1. **零本地依赖**：全部使用仓库已有包（js-yaml/jsdom 在仓库根 node_modules）或 Node 内置（node:sqlite、fetch、crypto）+ 全局 npm（playwright）+ 系统 CLI（gh/bili/yt-dlp/opencli）。插件自身不需要 pnpm install。
2. **模块解析**：插件位于仓库内任意路径均可 `import '@deepseek-ai/*'`（tsx 的 tsconfig paths 解析基于**服务器 cwd=仓库根**，与文件位置无关，且与服务器共享同一源码级模块实例）。非 @deepseek-ai 依赖用 createRequire 锚定绝对路径。
3. **持久化位置**：`$DSH_HOME/data/web-search-pro/store.db`（可配置 dbPath），WAL 模式。
4. **缓存语义**：查询缓存键 = (engine, 规范化 query)，TTL 内命中直接复用（`fromCache` 标记）；fetch 页面快照按 URL 去重。`fresh: true` 强制穿透。
5. **engine 顺序回退**：顺序尝试直至成功；`multi: true` 并行全引擎并按 URL 去重合并。默认引擎序 `['ddg','bing','exa','seam','jina']`（免费优先）。
6. **ctx.web 集成**：`registerProvider` 默认关闭（避免与 web profile 的 `searchProvider: deepseek-official` 冲突）；开启后设 `DSH_WEB_SEARCH_PROVIDER=web-search-pro` 即可让内置 `web_search` 走本插件（注册测试已验证该缝）。
7. **page.evaluate 字符串化**：esbuild 会给编译后的闭包注入 `__name`，页面上下文不存在 → 提取函数以原始字符串 IIFE 形式传入。
8. **安全边界**：不注入任意 JS，规则仅选择器级；opencli/agent-reach 后端失败时给结构化提示而非静默。

## 5. 激活步骤（已就绪）

1. 已建 junction：`C:\Users\anwea\.dsh\profiles\web\web-search-pro` → 源码目录
   （patch 行 `name` 相对 profile 目录解析，跨盘必须 junction；Windows 下不能用绝对路径 import）。
2. 持久激活 = 在 `C:\Users\anwea\.dsh\profiles\web\cordis.patch.yml` 追加（内容见 `profile.patch.yml`）。
3. **生效时机**：web profile 当前 `hmr: disabled`（web-app bundle 行），补丁在下次 `dsh web` 启动时生效；本会话内无法热重载（也不能重启承载当前会话的服务器）。

## 6. 验证结果（2026-08，本机实测）

- **类型检查**：`tsc -p scratch-plugin/web-search-pro/tsconfig.json --noEmit` 通过（strictness 放宽项与 vendor/cordis/tsconfig.json 一致，见 tsconfig 注释）。
- **功能测试**（`test/run-tests.ts`，15 项）：全部通过，含真实网络后端：
  - ddg/bing 搜索、github（gh CLI）、bilibili（bili CLI）、v2ex（sov2ex）
  - router 缓存命中 + multi 合并 + 历史落库
  - fetch http 抽取 + 页面缓存；jina 无 Key 时 401 且 auto 链自动回退
  - playwright（msedge headless）render + snapshot 文件落盘
  - 已知环境项：ddg HTML 端点偶发限流（引擎链自动回退，属无 Key 引擎固有约束）
- **注册测试**（`test/registration.spec.ts`，11 项）：在真实 Cordis（SystemPrompt+ToolRuntime+WebRuntime）上 apply 后：
  - 8 工具全部经 `ctx.tools.execute` 执行成功（含 web_snapshot 真实浏览器）
  - 持久化（history/stats/rules）与缓存清理正常
  - **ctx.web provider 缝验证通过**：`ctx.web.search()` 经 `searchProvider: 'web-search-pro'` 路由到本插件

## 7. 配置通道（三级，已实现）

| 通道 | 方式 | 生效时机 | 用途 |
|---|---|---|---|
| ① 插件配置（cordis.yml `config:`） | profile patch / --patch overlay | 下一次整树重载（热重载已实测可行） | 部署级默认值（dbPath/playwright/开关） |
| ② **settings.yaml 段落（热配置）** | `$DSH_HOME/settings.yaml` 的 `web-search-pro:` 段 | **改完即生效，无需重载**（官方 installSettingsSection + dsh-settings-file 热重载） | 钥匙/引擎顺序/并行/缓存 TTL/结果数——日常最常用 |
| ③ 环境变量 / 凭据引用 | `$EXA_API_KEY`、`$JINA_API_KEY` 或 `.credentials.yaml`（`exaApiKeyEnv`/`jinaApiKeyEnv` 引用，默认即这两个变量名） | 每次搜索时解析 | 钥匙兜底；密钥不进配置文件 |

优先级：settings 段落 > 插件配置 > 环境变量/凭据 > 内置默认值。
settings.yaml 示例（已写入本机 `C:\Users\anwea\.dsh\settings.yaml`，注释模板）：

```yaml
web-search-pro:
  exaApiKey: 'sk-...'          # 或设环境变量 EXA_API_KEY
  jinaApiKey: 'jina_...'       # 或设环境变量 JINA_API_KEY
  engines: [ddg, bing, exa, seam, jina]   # 引擎顺序
  parallelEngines: false
  ttlSeconds: 3600
  searchMaxResults: 8
```

钥匙字段带 `role('secret')`（settings 系统的红action描述），为将来前端表单（client 插件配置卡）做好了密文回显基础。

### 7.1 插件配置参考（通道①）

```yaml
- insert:
    - id: web-search-pro
      name: './web-search-pro/src/index.ts'
      config:
        dbPath: 'C:/Users/anwea/.dsh/data/web-search-pro/store.db'   # 默认值
        ttlSeconds: 3600
        engines: ['ddg', 'bing', 'exa', 'seam', 'jina']
        parallelEngines: false
        exaApiKey: ''        # 或 settings 段落 / $EXA_API_KEY
        jinaApiKey: ''       # 或 settings 段落 / $JINA_API_KEY
        enableCliBackends: true
        opencliEnabled: true
        agentReachEnabled: true
        registerProvider: false   # true + DSH_WEB_SEARCH_PROVIDER=web-search-pro
        providerId: web-search-pro
        playwright:
          enabled: true
          headless: true
          channel: msedge          # 或 chromium（playwright 内置）
          storageStatePath: ''     # 可选：已登录会话 JSON（MediaCrawler 式登录态复用）
        verbose: false             # true 时写 apply.log 标记
```

## 7.2 关于"前端可视化配置"（结论与路径）

- **现状**：没有 GUI 表单。配置 = ①/②/③ 三通道，②是最接近"可视化"的日常通道（改文件即生效）。
- **DSH 原生的 GUI 表单机制**（仓库已具备）：client 插件（`packages/client/**`，`dsh.client` manifest + tsdown client 构建）在
  `settings.plugins.tab` 的 `settings.plugin.item` 插槽注册配置卡片；卡片读写走 settings RPC（Models 页同款通道）。
  钥匙字段已标 `role('secret')`，前端可密文回显。
- **要做 GUI 表单需要**：① 在 `packages/client/` 新增一个 client 包（含 React 配置卡 + dsh.client manifest）；
  ② 在 `packages/client/tsdown.client.ts` 注册构建入口并跑 `pnpm run dev:web`/build:web；③ cordis.yml 增加 client 行。
  这是"仓库内开发"路径（client 包必须在仓库内构建），已列入 Roadmap；当前 settings.yaml 通道可先行满足"填 key"需求。

## 7.3 第二阶段能力（RRF + LRU + web_deps + 设置卡）

### 7.3.1 RRF 多引擎融合排序
`multi: true` 时不再按引擎顺序去重，而是 **Reciprocal Rank Fusion**：每个来源得分 =
Σ 1/(k + rank)，k 由 `rrfConstant`（默认 60）控制，按得分降序取前 `searchMaxResults`
条。被多个引擎同时排在高位的来源胜出（对齐 Argo 的融合思路）。

### 7.3.2 内存 LRU 缓存
在 SQLite 之上加了一层进程内 LRU（`memory-cache.ts`，Map + 最近使用前移），
键 = (engine, 规范化 query) / (url)。热查询/热页面在微秒级命中，不触盘；
条目上限 `memoryCacheEntries`（默认 128），TTL 复用 `ttlSeconds`。三层缓存：
内存 LRU → SQLite → 实网。

### 7.3.3 web_deps 依赖检测/安装工具（"安装即配置"的结论）
外部依赖（gh/bili/yt-dlp/opencli/agent-reach/mcporter/playwright）大多需要系统额外安装。
**提前检索的结论**：
- 检测：`where.exe`（win）/ `command -v`（posix），8 秒超时，返回路径。
- 安装通道：npm 全局（opencli/mcporter/playwright）、pip/uv（yt-dlp/agent-reach/bili）、winget/choco（gh）。
- **"安装按钮做成配置"的取舍**：浏览器设置卡里的"安装"按钮本质是"从浏览器触发任意命令执行"，
  没有走 DSH 的审批/权限闸。因此**安装做成模型可调用的 `web_deps` 工具**（`action=check` 列出可用性
  + 安装命令；`action=install` 对单后端执行包管理器命令，走 DSH 既有工具权限管线），
  设置卡只负责"配置值"，并用提示指向该工具。若后续要真正的卡片内安装按钮，需走 @Remote+typert
  暴露 host 命名空间并经 apiproxy 放行（改动更大，暂缓）。

### 7.3.4 设置卡内配置页（client 插件）
在现有"设置 → 插件 → 插件配置"页新增 **Web search (pro)** 卡片（复用 `ui-settings-plugins`
的 BashCard/WebSearchCard 框架）：
- 字段：Exa key / Jina key（SecretField，走 credentials 域，明文不落设置响应）、
  engines（逗号分隔）、parallelEngines（true/false）、ttlSeconds、searchMaxResults。
- 实现改动：① `packages/host/apiproxy/src/api-proxy.ts` 的 `WEB_SETTINGS_NAMESPACES` 加
  `web-search-pro`（允许浏览器读写该 namespace）；② `ui-settings-plugins` 新增
  `WebSearchProCard.tsx` + `web-search-pro-card-controller.ts` + card-form 的 `booleanField`/`listField`；
  ③ 注册第 4 张卡 + locales。
- 构建：`pnpm --filter @deepseek-ai/dsh-client-ui-settings-plugins run bundle`（已成功，lib/client.js 59KB）。

### 7.3.4.3 登录态复用 + 选择器可配置（第三阶段补）

- `scripts/save-login.mjs`：交互式登录一次，把浏览器登录态存成 Playwright storageState
  JSON（多站点 cookies 合并到一份），填 `playwright.storageStatePath` 即可复用。
- `platformRules` 配置（settings.yaml / cordis config）：按平台覆盖搜索结果选择器
  （item/title/link/text），站点改版不用改代码。
- 提示语已补：`web_platform_search` 工具描述 + systemPrompt 段落都写明"中文社区需登录一次
  （scripts/save-login.mjs）/ 选择器可 platformRules 覆盖"；引擎空结果错误文案指向登录脚本与 platformRules。
- LOGIN.md 教程 + README「中文社区平台登录态」小节已发布到公开仓库。

### 7.3.4.2 中文社区平台搜索（MediaCrawler 补齐，第三阶段）

核对 MediaCrawler：其覆盖 **7 个中文平台**（bilibili/xhs/douyin/kuaishou/weibo/tieba/zhihu），
全部走 **playwright + 登录态**；zhihu 额外用 JS 算 `get_sign` 签名再调 `/api/v4/search_v3`
（该签名算法在其 NON-COMMERCIAL 许可内，不能照搬）。实测知乎/微博/豆瓣的**免登录公开接口全被风控**
（40362/空/403），印证必须走登录态浏览器。

本插件补齐（MediaCrawler 的 spirit、自己的干净实现，MIT）：
- 新增 `platform-search.ts`：per-platform 搜索页 URL + 结果选择器（best-effort，可在源码里改），
  字符串化页内提取器（规避 esbuild `__name` 注入）。
- `playwright.ts` 新增 `searchResults()`：登录态浏览器打开搜索页 → 滚动触发懒加载 → 提取列表。
- `engines.ts` 新增 `playwrightPlatformEngine`，platform 表扩到 16 个：
  github/bilibili/youtube/v2ex/xiaohongshu/twitter/reddit/instagram/facebook/rss +
  **zhihu/weibo/douban/tieba/douyin/kuaishou**。
- **依赖用户登录态**：`playwright.storageStatePath`（复用 MediaCrawler 式登录态复用）；选择器为
  best-effort，站点改版需在 `platform-search.ts` 微调。基础设施已用 bilibili 搜索页冒烟验证（5 条结果）。

### 7.3.4.1 排障教训：内置 host 包改动必须重建 lib（本次实锤）

现象：设置卡在 apiproxy 源码允许清单加了 `web-search-pro`、client bundle 也重编并被服务后，卡片仍不出现
（headless 实导航验证只有 3 张卡、无 console 错误）。

根因：**运行中的服务器解析内置 host 包（`@deepseek-ai/dsh-host-apiproxy` 等）用的是编译后的
`lib/index.js`，不是源码**（`import.meta.resolve` 在新进程里显示 source 有迷惑性；服务器 loader 对
bundle 行按包 main 解析到 lib）。我只改了 `api-proxy.ts` 源码、没跑 `pnpm run build:lib:host`，
所以 `lib/index.js` 一直是旧产物（不含 `web-search-pro`），重启也白搭。

修复：`pnpm run build:lib:host`（tsc -b + tsdown）重建所有 host bundle，`apiproxy/lib/index.js`
随即包含 `web-search-pro`。**结论：改动 `packages/**` 源码后，若该包是内置 bundle 行，必须重建 lib 再重启。**
（scratch-plugin 这类"相对路径源码"入口不受此限——走 tsx source，重启即生效。）

另：settings.yaml 里我之前加的注释模板使 `web-search-pro:` 段成为 YAML `null`，已改为 `{}`。

### 7.3.5 激活边界（重要）
- **主机侧**：本 profile 的 HMR 是 config-only（`root: []`，无模块热替换）；profile patch 改动只触发
  "整树重载 + 旧模块 re-apply"，**不重新 import 插件源码**（ESM 模块缓存）。因此源码级新能力
  （web_deps/RRF/LRU/settings 热配置/allowlist）需 **重启 `dsh web`** 才会进入运行中的服务器；
  这些能力均已通过 typecheck + 12 项真实 Cordis 注册测试（独立进程）。
- **浏览器侧**：client 卡需在重启后**刷新页面**加载新的 `lib/client.js`（dev:web 未运行）。

## 7.4 发布（DSH 社区格式公开仓库）

按社区 bundle 格式发布为公开仓库：**<https://github.com/anweat/dsh-web-search-pro>**
（topics: dsh-plugin / deepseek-harness / web-search / plugin，MIT）。

- 结构：`package.json`（`dsh.bundle.patch: ./cordis.patch.yml`，`main: lib/index.js`，
  `files: [lib, cordis.patch.yml, README, LICENSE]`）+ `cordis.patch.yml`（`name: dsh-web-search-pro`）
  + `src/` + 已构建 `lib/` + README/LICENSE/tsconfig。
- 依赖：`@deepseek-ai/cordis` peerDep `^4.0.1`；`schemastery ^3.18.1` +
  `dsh-tools/dsh-settings/dsh-credentials ^0.1.0-rc.6`（npm 已发布，与 dsh-cc-tui 一致）；
  `js-yaml`/`jsdom` 为普通依赖（发布版把 createRequire 锚点改成了正常 import）。
- 安装：`dsh plugin --profile <name> add dsh-web-search-pro`（或 `add ./<path>`/tarball）。
- **注意①**：公开 bundle 是 **host-only**——client 设置卡是 harness 仓库内特性（apiproxy
  allowlist 是 harness 决定），社区插件无法随包分发；发布版通过 settings.yaml / cordis config / env 配置。
- **注意②**：npm 最新是 rc.6，本机源码 checkout 是 rc.5；装进本机 profile 若版本冲突，用本地
  `add ./<path>` 并在 profile 的 `pnpm-workspace.yaml` 对齐版本。
- 源码与 harness 内 `scratch-plugin/web-search-pro` 同步（发布版 util.ts 的 js-yaml/jsdom 用正常 import）。

## 8. 局限与 Roadmap

**局限**
- ddg/bing 为无 Key 引擎，DDG 偶发限流、Bing 结果偏英文——中文高质量检索建议配 Exa/DeepSeek key 或把 seam 前移。
- opencli 平台后端依赖浏览器扩展会话在线；未连接时给明确错误。
- jina 无 Key 401（r.jina.ai / s.jina.ai 已收紧），自动回退 http/playwright。
- 无 client 侧 UI（搜索历史面板）；可通过 `web_history`/stats 工具访问。

**Roadmap（对照 Argo 与社区）**
- [x] RRF 融合排序（7.3.1）
- [x] 内存 LRU 缓存层（7.3.2）
- [x] web_deps 依赖检测/安装工具（7.3.3）
- [x] 设置卡内配置页（7.3.4）
- [x] 中文社区平台搜索（7.3.4.2）+ 登录态复用 + 选择器可配置（7.3.4.3）
- [x] freshness/权威域打分（RRF 之上；`freshnessBoost/freshnessDays/authorityBoost/authorityDomains`）
- [x] 更多垂直源：学术 arXiv（Atom API）/ PubMed（E-utilities，已实测）
- [x] 更多垂直源：GitHub 代码（gh search code）/ GitHub issues（gh search issues，已实测）
- [x] `web_rule` 升级为"规则包"（export/import JSON）
- [x] npm bundle 分发（<https://github.com/anweat/dsh-web-search-pro>）
- [ ] 发布到 npm registry（需 npm 账号/token，待确认）
- [ ] 搜索历史/缓存管理 Web 面板（client 插件 slot）
- [ ] 更多垂直源：雪球（需 cookie）/ 豆瓣读书电影（JS 渲染，需 playwright 登录态细化）
- [ ] 卡片内"安装"按钮（需 @Remote+typert+apiproxy 放行，见 7.3.3）

---
