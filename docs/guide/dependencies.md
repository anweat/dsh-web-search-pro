# 外部依赖（按需）

> 适用版本：dsh-web-search-pro 0.2.3 · [返回 README](../../README.md) · [文档索引](../README.md)

多数后端需要系统额外安装的工具；插件提供 `sources.deps` / `sources.install` 动作检测与安装：

| 依赖 | 用途 | 安装 |
|---|---|---|
| bili-cli `0.6.2` | B站后端 | `uv tool install --force git+https://github.com/public-clis/bilibili-cli@489607468f967e0e11f3cdff6efc022d011e982a` |
| yt-dlp | YouTube 后端 | `uv tool install yt-dlp` / `pip install yt-dlp` |
| opencli（经 dsh-browser） | 小红书/Twitter/Reddit/IG/FB 的 `browser-opencli` 后备后端 | dsh-browser 0.2.2 起**不再内置**，在 PATH、全局 npm 目录等位置找同一份 `opencli`（`npm i -g @jackwener/opencli`，见 dsh-browser 的说明）；扩展未连接时用 `opencli doctor` 诊断 |
| 独立 `opencli` | 小红书 / 知乎 / Reddit / Twitter 的首选后端，用你日常 Chrome 的登录态（需 OpenCLI Browser Bridge 扩展） | `npm i -g @jackwener/opencli`；站点登录由你在 Chrome 里完成 |
| 其余适配 CLI（`xhs`、`zhihu`、`rdt`、`omnireach`、`gh`、`wx-search-cli`、`tanso`） | 见 [CLI 适配](./cli-adapters.md) | `sources.deps` 列出安装命令；登录由你自己完成 |
| twitter-cli（命令 `twitter`） | Twitter 平台的可选后备（排在独立 OpenCLI 之后；执行 `twitter search … --json`，需要 0.8.5 或更新；另需 `TWITTER_AUTH_TOKEN` 与 `TWITTER_CT0`，见上） | `uv tool install twitter-cli` / `pipx install twitter-cli` / `pip install twitter-cli` |
| agent-reach（可选） | 仅作安装助手，本插件不直接执行它；装了它**不代表** Twitter 搜索可用 | `uv tool install agent-reach` / `pip install agent-reach` |
| mcporter | 无裸 API Key 时的 Exa MCP 回退 | `npm i -g mcporter` |
| playwright / patchright | 渲染/截图后端 | 由 dsh-browser 内置；默认 Playwright，兼容场景可显式切 Patchright；缺 Chromium 时调用 `runtime.install`（`browser_call`） |

> B站后端使用 `public-clis/bilibili-cli` 的 `bili` 命令；上述提交对应上游
> `v0.6.2`。不要安装 PyPI 上同名的 `bili-cli 0.1.1`，它是另一个项目且不提供
> `bili search` 契约。`sources.deps` 会同时检查版本和 `--json` 搜索能力，避免只因
> PATH 中存在一个同名命令就误报可用。

> Windows 上这些 CLI 必须能被 `where` 解析（插件按 PATH 查找）：安装后若
> `sources.deps` 仍报缺失，把可执行文件所在目录加入 PATH，或直接把
> `bili.exe`/`yt-dlp.exe` 放进一个已在 PATH 的目录。用 `uv` 安装时可先重定向工具目录，
> 避免默认写入系统盘：`UV_TOOL_DIR`、`UV_TOOL_BIN_DIR`、`UV_PYTHON_INSTALL_DIR`。
