# dsh-web-search-pro

增强型、可持久化的扩展网页搜索插件 for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（DSH）。

一个 DSH **bundle 插件**，把多引擎网页搜索、平台搜索、持久化缓存、受控按站增强和 Playwright 渲染打包成模型可直接调用的 11 个工具。路由控制面借鉴 Agent-Reach 的后端探测、顺序选择和失败冷却思路，核心逻辑为本项目原生 TypeScript 实现。

## 安装

```bash
dsh plugin --profile web add @anweat/dsh-browser@^0.1.8 dsh-web-search-pro@^0.1.8
# 或本地目录 / tarball：
dsh plugin --profile web add ../dsh-browser ./dsh-web-search-pro
# 重启（web profile 关闭了 HMR）：
dsh --profile web
```

> 两个插件都必须是 profile 的直接依赖：DSH 只激活直接依赖的 bundle layer，且标准 profile 可能设置 `autoInstallPeers: false`。不要只安装 Web Search Pro 后依赖 peer 自动补齐。
> 依赖 `@deepseek-ai/*` 已发布到 npm（`^0.1.0-rc.6`，与社区 dsh-cc-tui 一致）。
> 若你的 harness 是本地源码 checkout（如 `0.1.0-rc.5`），版本号可能有出入——用
> `dsh plugin --profile web add ./<path>` 并在 profile 的 `pnpm-workspace.yaml`
> 里对齐版本后重装即可。

## 从旧版本升级

升级 Web Search Pro 时应同时升级浏览器插件。`dsh-web-search-pro >= 0.1.8` 要求 `@anweat/dsh-browser >= 0.1.8`；旧版 browser 不包含 `web_snapshot screenshot=false`、Web Search Pro 写操作的四级审批策略等本版契约。

```bash
# npm 安装：显式升级两个包，避免 profile 锁文件继续保留旧版 browser
dsh plugin --profile web add @anweat/dsh-browser@^0.1.8 dsh-web-search-pro@^0.1.8

# 本地 checkout 联调：两个目录一起重新挂载
dsh plugin --profile web add ../dsh-browser ../dsh-web-search-pro
```

升级完成后需要**完整停止并重新启动 Web profile**；仅刷新网页不会重新扫描插件的 `client.js`。随后依次检查：

1. `browser_status`：确认 OpenCLI、`playwright | patchright` 运行时、`automationMode` 与 `usagePolicy` 符合预期。
2. `web_backend_status`：确认搜索、CLI、Agent Reach 与浏览器后端是否 ready。
3. 打开 `设置 → 插件 → 插件配置`：确认“Web Search Pro”和“浏览器自动化”两张卡片都已加载；后者负责自由度、运行时、OpenCLI 与调用缓冲。

> `automationMode` 和防止过度调用的 `usagePolicy` 都属于 dsh-browser，升级不会自动改写现有配置。生产 profile 建议保留 `standard`；`unrestricted` 只用于隔离的自动化测试 profile，并且仍受并发、突发、页数/深度和 429/503 退避保护。

若 Clash/TUN 使用 fake-IP DNS，原生 HTTP 后端可能看到 `198.18.0.0/15` 或 `fdfe:dcba:9876::/96`。可在可视化面板的高级设置中启用 `allowProxyFakeIp`；默认关闭。该开关只信任这两个代理网段的 **DNS 解析结果**，字面 fake-IP URL、localhost 和其他私网地址仍会被 SSRF 防护拒绝。

## 快速使用与适用情形

安装并重启后，直接在 DSH 会话里要求模型调用工具即可：

```text
请调用 web_backend_status 检查后端，然后用 web_search_pro 搜索
"DeepSeek Harness community feedback"，指定 exa、fresh=true、返回 8 条来源。
```

| 情形 | 推荐入口 | 说明 |
|---|---|---|
| 日常网页搜索 | `web_search_pro` | 默认按配置顺序回退；需要强制刷新时传 `fresh=true` |
| 语义研究、社区观点 | `web_search_pro` + `exa` | 有 API Key 时走原生 Exa API；只有 Exa MCP 连接时自动经 `mcporter` 回退 |
| 已知 URL 的批量正文 | `web_exa_contents` | 直接调用 Exa `/contents`，必须配置 `EXA_API_KEY` |
| GitHub/B站/Reddit 等平台 | `web_platform_search` | Reddit 等 OpenCLI 平台需要 Chrome 扩展在线；中文受限站点使用 AuthProfile |
| 登录后页面或私有论坛 | `browserBindings` + AuthProfile | Cookie 保存在本地 storageState，按域名授权，默认只读 |
| 页面改版、懒加载 | `platformRules` 或 RulePack | 优先改选择器；需要等待/点击/滚动时再使用有界 RulePack |
| 模型生成多步页面操作 | `browser_recipe_run` | 只读步骤直接运行；页面交互按 dsh-browser 的 `automationMode` 决定拒绝/审批/直通 |
| 外部模型生成油猴脚本 | `browser_script_validate` → `browser_userscript_run` | 强制 `@match`、`@grant none`、禁用 `@require`；仅 `unrestricted` 跳过审批 |
| 有限泛爬取 | `browser_crawl` | 匿名、默认同源；调用参数不能突破浏览器插件的页数/深度预算 |
| OpenCLI 站点适配器或浏览器桥 | `browser_opencli_status` → `browser_opencli_catalog` → `browser_opencli_run` | 先发现精确 adapter；仅 `unrestricted` 跳过通用 argv 审批 |

先运行 `web_backend_status` 判断后端是否 ready。指定单一引擎时失败会原样返回；不指定时才会按 `engines` 顺序自动回退。

## 工具（11 个）

| 工具 | 作用 |
|---|---|
| `web_search_pro` | 多引擎搜索 + RRF 融合 + 内存/SQLite 双层缓存 + 历史 |
| `web_exa_contents` | 原生 Exa `/contents` 批量正文抓取（1-100 URL） |
| `web_fetch_pro` | 可读化抓取（Jina → HTTP+规则抽取 → Playwright 兜底）+ 快照缓存 |
| `web_platform_search` | 20 平台：GitHub/B站/YouTube/V2EX/小红书/Twitter/Reddit/IG/FB/RSS + 知乎/微博/豆瓣/贴吧/抖音/快手（Playwright 登录态） |
| `web_snapshot` | Playwright HTML + 文本落盘；`screenshot=false` 时不生成 PNG |
| `web_history` / `web_cache_clear` / `web_search_stats` | 持久历史 / 清缓存 / 存储统计 |
| `web_rule` | 持久化按站提取规则（脚本猫式，list/upsert/remove） |
| `web_backend_status` | 无副作用后端探测、失败/冷却诊断与 CLI 状态 |
| `web_deps` | 检测/安装搜索后端的外部依赖（bili/yt-dlp/agent-reach/mcporter）；浏览器依赖由 dsh-browser 管理 |

## 浏览器脚本与自动化分层

`dsh-browser >= 0.1.8` 提供三类脚本入口：

1. **内置只读脚本**：`article-clean`、`links`、`jsonld`、`forms`，适合稳定抽取；先用 `browser_script_catalog` 查看。
2. **Recipe**：最多 25 步的结构化 Playwright 操作，支持 wait/click/fill/type/press/select/check/hover/scroll/extract/assert/screenshot；交互步骤由自动化模式决定审批。
3. **外部 UserScript**：适合外部模型生成站点专项逻辑。先 `browser_script_validate` 查看 SHA-256、域名范围与能力提示，再 `browser_userscript_run`；它在页面主世界运行，并非安全沙箱。

工具自由度由 dsh-browser 的 `automationMode` 控制：`read-only` 隐藏或拒绝页面及 Web Search Pro 写操作；`standard`（默认）对交互、写 Recipe、外部脚本、OpenCLI、缓存/规则变更和安装操作审批；`autonomous` 直通页面交互、写 Recipe 以及本地缓存/规则变更，但安装、外部脚本和通用 OpenCLI 仍审批；`unrestricted` 为隔离测试 profile 提供无审批运行。所有模式仍保留域名、参数、大小和步骤上限校验，并始终应用 dsh-browser 的调用缓冲、退避与爬取预算。

OpenCLI 用于已有站点 adapter 或复用 Chrome 登录会话。推荐顺序是 **`browser_opencli_catalog` 查精确 adapter → network/extract → DOM 操作**；先运行 `browser_opencli_status`。`browser_opencli_run` 接受 argv 数组而非 shell 字符串，可覆盖 adapter、显式 session 的 `browser state/find/get/click/fill/type/select/keys/wait/extract/network` 等命令；仅 `unrestricted` 跳过审批。

更完整的 AuthProfile、脚本元数据与 OpenCLI 示例见 [LOGIN.md](./LOGIN.md)。

## 配置

三层，越靠前越日常：

1. **DSH 可视化面板**：打开 `设置 → 插件 → 插件配置 → Web Search Pro`。面板按搜索策略、服务凭据、运行时后端和高级规则分组；修改先保留为本地草稿，点击“保存”后写入 `settings.yaml` 并热更新，支持放弃修改和逐字段恢复部署值。

   - Exa、Jina、GitHub 密钥通过 DSH Credentials 写入，面板只显示“已配置/未配置”，不会把明文密钥读回浏览器。
   - `platformRules`、`customPlatforms`、`browserBindings` 与 Playwright 设置使用 JSON 对象编辑器；格式或数值范围无效时会阻止保存。
   - 浏览器工具的审批自由度由 `dsh-browser.automationMode` 管辖，调用缓冲由 `dsh-browser.usagePolicy` 管辖；用 `browser_status` 查看当前状态。Web Search Pro 面板只管理搜索插件自己的后端开关，不会绕过浏览器插件的审批或资源策略。
   - `allowProxyFakeIp` 仅用于明确采用 Clash/TUN fake-IP DNS 的环境；普通网络保持关闭。
   - 更新带客户端面板的插件版本后需要重启 Web profile，让 DSH 客户端模块扫描器重新装载 `client.js`。

2. **`$DSH_HOME/settings.yaml` → `web-search-pro:` 段**（热重载，改完即生效）：

   ```yaml
   web-search-pro:
     exaApiKeyEnv: EXA_API_KEY # 推荐：运行环境或凭据服务，不把密钥写入配置
     jinaApiKeyEnv: JINA_API_KEY
     engines: [ddg, bing, exa, seam, jina]
     parallelEngines: false
     ttlSeconds: 3600
     searchMaxResults: 8
     browserBindings:
       zhihu:
         authProfile: china-community
         rulePack: zhihu-enhanced
   ```

3. **cordis.yml `config:`**（部署级默认值，见 `cordis.patch.yml`）。
4. **环境变量 / 凭据**：`$EXA_API_KEY`、`$JINA_API_KEY`（`exaApiKeyEnv`/`jinaApiKeyEnv` 引用）。

## 外部依赖（按需）

多数后端需要系统额外安装的工具；插件提供 `web_deps` 工具检测与安装：

| 依赖 | 用途 | 安装 |
|---|---|---|
| bili-cli | B站后端 | `uv tool install bili-cli` / `pipx install bili-cli` |
| yt-dlp | YouTube 后端 | `uv tool install yt-dlp` / `pip install yt-dlp` |
| opencli | 小红书/Twitter/Reddit/IG/FB | 由 dsh-browser 内置；扩展未连接时用 `opencli doctor` 诊断 |
| agent-reach | agent-reach 后端 | `uv tool install agent-reach` / `pip install agent-reach` |
| mcporter | 无裸 API Key 时的 Exa MCP 回退 | `npm i -g mcporter` |
| playwright / patchright | 渲染/截图后端 | 由 dsh-browser 内置；默认 Playwright，兼容场景可显式切 Patchright；缺 Chromium 时调用 `browser_install` |

## 平台与引擎

`seam`（ctx.web/DeepSeek 原生）· `exa` · `ddg` · `bing` · `jina` · `github`（REST 搜索 API，免 CLI；可选 `$GITHUB_TOKEN`/`githubToken` 提升限额并解锁代码搜索）· `bilibili` · `v2ex` · `youtube`。默认顺序 `ddg, bing, exa, seam, jina`（免费优先），失败自动回退；失败后短时冷却，`web_backend_status` 可查看原因；`multi` 并行融合。

Exa 优先使用原生 API 客户端：`web_search_pro` 可传 `exaType`、域名包含/排除、发布时间范围和 category。若没有裸 API Key、但启用了 CLI 后端且 Exa MCP 已连接，搜索会自动通过 `mcporter` 完成；该兼容路径只支持 query + 结果数，高级筛选和 `web_exa_contents` 仍要求 `EXA_API_KEY`。不同选项、结果数、引擎顺序和单/多引擎模式使用不同缓存指纹。

## 开发

```bash
pnpm install
pnpm test
pnpm build        # tsc src → lib
```

源码在 `src/`；`lib/` 为发布产物（已提交）。

## License

MIT


## 中文社区平台登录态

zhihu / weibo / douban / tieba / douyin / kuaishou 的免登录公开接口都被风控，
所以走 **Playwright 驱动登录态浏览器**（借鉴 MediaCrawler 思路、MIT 独立实现，未用其签名算法）：

1. 登录一次保存登录态：`node scripts/save-login.mjs all login-state.json`
2. 在 dsh-browser 配置中声明按域名隔离的 `authProfiles`
3. 在 `browserBindings` 把平台绑定到 profile；站点改版时用 `platformRules` 或 dsh-browser `rulePacks`

详见 [LOGIN.md](./LOGIN.md)。


## 历史管理

web_history 支持：kind/query/engine/platform 过滤、replay 和 JSON export。search/platform 回放保存的来源；fetch/snapshot 回放当次持久化的正文、HTML/截图路径。旧数据库会自动迁移 pages 表；历史上无法关联 queryId 的旧页面按 URL 做兼容回放。

## 自定义平台

在 settings.yaml 里定义任意站点（URL 模板 + 结果选择器），
web_platform_search 就能直接搜它——不需要改代码：

    web-search-pro:
      customPlatforms:
        mybili:
          name: '我的B站'
          url: 'https://search.bilibili.com/all?keyword={query}'
          item: '.bili-video-card'
          title: '.bili-video-card__info--tit'
          link: 'a'
        # 需要登录时优先通过 browserBindings 绑定命名 authProfile。
        myforum:
          name: '某论坛'
          url: 'https://forum.example.com/search?q={query}'
          item: '.thread'
          title: '.thread-title a'
          link: '.thread-title a'
      browserBindings:
        myforum:
          authProfile: forum

旧版 `customPlatforms.*.cookie` 仍兼容，但会让 Cookie 明文进入配置；新配置应使用 dsh-browser 的命名 AuthProfile，状态文件不要提交到仓库。

