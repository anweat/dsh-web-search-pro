# dsh-web-search-pro

增强型、可持久化的扩展网页搜索插件 for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（DSH）。

一个 DSH **bundle 插件**，把多引擎网页搜索、平台搜索、持久化缓存、脚本猫式按站提取、Playwright 渲染打包成模型可直接调用的 9 个工具。灵感来自 [MediaCrawler](https://github.com/NanmiCoder/MediaCrawler)、[Agent-Reach](https://github.com/Panniantong/Agent-Reach)、脚本猫/油猴 userscript、opencli 与 playwright。

## 安装

```bash
dsh plugin --profile web add dsh-web-search-pro
# 或本地目录 / tarball：
dsh plugin --profile web add ./dsh-web-search-pro
# 重启（web profile 关闭了 HMR）：
dsh --profile web
```

> 依赖 `@deepseek-ai/*` 已发布到 npm（`^0.1.0-rc.6`，与社区 dsh-cc-tui 一致）。
> 若你的 harness 是本地源码 checkout（如 `0.1.0-rc.5`），版本号可能有出入——用
> `dsh plugin --profile web add ./<path>` 并在 profile 的 `pnpm-workspace.yaml`
> 里对齐版本后重装即可。

## 工具（9 个）

| 工具 | 作用 |
|---|---|
| `web_search_pro` | 多引擎搜索 + RRF 融合 + 内存/SQLite 双层缓存 + 历史 |
| `web_fetch_pro` | 可读化抓取（Jina → HTTP+规则抽取 → Playwright 兜底）+ 快照缓存 |
| `web_platform_search` | GitHub/B站/YouTube/V2EX/小红书/Twitter/Reddit/IG/FB/RSS |
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

## 引擎

`seam`（ctx.web/DeepSeek 原生）· `exa` · `ddg` · `bing` · `jina` · `github` · `bilibili` · `v2ex` · `youtube`。默认顺序 `ddg, bing, exa, seam, jina`（免费优先），失败自动回退；`multi` 并行融合。

## 开发

```bash
pnpm install
pnpm build        # tsc src → lib
```

源码在 `src/`；`lib/` 为发布产物（已提交）。

## License

MIT
