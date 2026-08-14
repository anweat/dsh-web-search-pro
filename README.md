# dsh-web-search-pro

增强型、可持久化的扩展网页搜索插件 for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（DSH）。

一个 DSH **bundle 插件**，把多引擎网页搜索、平台搜索、持久化缓存、脚本猫式按站提取、Playwright 渲染打包成模型可直接调用的 9 个工具。灵感来自 [MediaCrawler](https://github.com/NanmiCoder/MediaCrawler)、[Agent-Reach](https://github.com/Panniantong/Agent-Reach)、脚本猫/油猴 userscript、opencli 与 playwright。

## 安装

```bash
dsh plugin --profile web add dsh-web-search-pro   # 自动装 dsh-browser（dependency）+ 自动挂载 browser 行（本 patch）
# 或本地目录 / tarball：
dsh plugin --profile web add ./dsh-web-search-pro
# 重启（web profile 关闭了 HMR）：
dsh --profile web
```

> dsh-browser 需先发布到 npm（本地测试可用 `dsh plugin --profile web add ../dsh-browser ../dsh-web-search-pro` 一条命令显式列两个）。
> 依赖 `@deepseek-ai/*` 已发布到 npm（`^0.1.0-rc.6`，与社区 dsh-cc-tui 一致）。
> 若你的 harness 是本地源码 checkout（如 `0.1.0-rc.5`），版本号可能有出入——用
> `dsh plugin --profile web add ./<path>` 并在 profile 的 `pnpm-workspace.yaml`
> 里对齐版本后重装即可。

## 工具（9 个）

| 工具 | 作用 |
|---|---|
| `web_search_pro` | 多引擎搜索 + RRF 融合 + 内存/SQLite 双层缓存 + 历史 |
| `web_fetch_pro` | 可读化抓取（Jina → HTTP+规则抽取 → Playwright 兜底）+ 快照缓存 |
| `web_platform_search` | 20 平台：GitHub/B站/YouTube/V2EX/小红书/Twitter/Reddit/IG/FB/RSS + 知乎/微博/豆瓣/贴吧/抖音/快手（Playwright 登录态） |
| `web_snapshot` | Playwright 全页截图 + HTML + 文本落盘 |
| `web_history` / `web_cache_clear` / `web_search_stats` | 持久历史 / 清缓存 / 存储统计 |
| `web_rule` | 持久化按站提取规则（脚本猫式，list/upsert/remove） |
| `web_deps` | 检测/安装外部依赖（gh/bili/yt-dlp/opencli/agent-reach/mcporter/playwright） |

## 配置

三层，越靠前越日常：

1. **`$DSH_HOME/settings.yaml` → `web-search-pro:` 段**（热重载，改完即生效）：

   ```yaml
   web-search-pro:
     exaApiKey: 'sk-...'       # 或环境变量 EXA_API_KEY / .credentials.yaml
     jinaApiKey: 'jina_...'    # 或环境变量 JINA_API_KEY
     engines: [ddg, bing, exa, seam, jina]
     parallelEngines: false
     ttlSeconds: 3600
     searchMaxResults: 8
   ```

2. **cordis.yml `config:`**（部署级默认值，见 `cordis.patch.yml`）。
3. **环境变量 / 凭据**：`$EXA_API_KEY`、`$JINA_API_KEY`（`exaApiKeyEnv`/`jinaApiKeyEnv` 引用）。

## 外部依赖（按需）

多数后端需要系统额外安装的工具；插件提供 `web_deps` 工具检测与安装：

| 依赖 | 用途 | 安装 |
|---|---|---|
| gh | GitHub 后端 | `winget install GitHub.cli` / `choco install gh` |
| bili-cli | B站后端 | `uv tool install bili-cli` / `pipx install bili-cli` |
| yt-dlp | YouTube 后端 | `uv tool install yt-dlp` / `pip install yt-dlp` |
| opencli | 小红书/Twitter/Reddit/IG/FB | `npm i -g opencli` |
| agent-reach | agent-reach 后端 | `uv tool install agent-reach` / `pip install agent-reach` |
| playwright | 渲染/截图后端 | `npm i -g playwright && playwright install chromium` |

## 平台与引擎

`seam`（ctx.web/DeepSeek 原生）· `exa` · `ddg` · `bing` · `jina` · `github` · `bilibili` · `v2ex` · `youtube`。默认顺序 `ddg, bing, exa, seam, jina`（免费优先），失败自动回退；`multi` 并行融合。

## 开发

```bash
pnpm install
pnpm build        # tsc src → lib
```

源码在 `src/`；`lib/` 为发布产物（已提交）。

## License

MIT


## 中文社区平台登录态

zhihu / weibo / douban / tieba / douyin / kuaishou 的免登录公开接口都被风控，
所以走 **Playwright 驱动登录态浏览器**（借鉴 MediaCrawler 思路、MIT 独立实现，未用其签名算法）：

1. 登录一次保存登录态：`node scripts/save-login.mjs all login-state.json`
2. 在 `$DSH_HOME/settings.yaml` 里设 `playwright.storageStatePath`
3. 站点改版时无需改代码，用 `platformRules` 按平台覆盖结果选择器

详见 [LOGIN.md](./LOGIN.md)。


## 历史管理

web_history 支持：kind/query/engine/platform 过滤、replay（用 queryId 回放已存结果）、
export（把过滤后的历史+结果写成 JSON 文件）。

## 自定义平台（解析 cookie 去搜索）

在 settings.yaml 里定义任意站点（URL 模板 + 结果选择器 + 可选 Cookie），
web_platform_search 就能直接搜它——不需要改代码：

    web-search-pro:
      customPlatforms:
        mybili:
          name: '我的B站'
          url: 'https://search.bilibili.com/all?keyword={query}'
          item: '.bili-video-card'
          title: '.bili-video-card__info--tit'
          link: 'a'
        # 需要登录的站点补 cookie（a=b; c=d，自动应用到 url 域名）
        myforum:
          name: '某论坛'
          url: 'https://forum.example.com/search?q={query}'
          item: '.thread'
          title: '.thread-title a'
          link: '.thread-title a'
          cookie: 'sessionid=abc123; csrftoken=xyz'

