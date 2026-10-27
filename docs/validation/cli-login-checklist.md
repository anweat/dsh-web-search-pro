# 登录类平台陪测清单（独立 opencli 优先；xhs、zhihu、rdt、twitter 为可选后备）

适用：dsh-web-search-pro 0.2.3。小红书、知乎、Reddit、X 这四个需要登录的平台，默认链的**第一个后端是独立 `opencli`**，它通过 OpenCLI Browser Bridge 扩展直接使用你**日常 Chrome** 的登录态；独立 CLI（`xhs`、`rdt`、`zhihu`、`twitter`）排在后面，是可选后备。本清单记录 2026-10-27 的实测结论，并给“你在场、用你自己的登录态”的陪测准备命令和检查点。

## 原则：登录完全交给你

- 插件**不提供任何登录流程**，**从不运行任何登录命令**（`xhs login`、`rdt login`、`zhihu login`、`opencli <站点> login`、`gh auth login` 都一样），**不读浏览器 Cookie**，不代你登录。
- 推荐：在你日常使用的 Chrome 里登录小红书、知乎、Reddit、X，并装好 OpenCLI（`npm i -g @jackwener/opencli`）和 **OpenCLI Browser Bridge** 扩展，`opencli doctor` 全 OK 即可。登录态过期时插件报“在你的 Chrome 里登录 <站点> 后重试（opencli 使用 Chrome 的登录态）”，不会提示任何登录命令。
- 想用独立 CLI 作后备：用它们自己的登录命令，由你自己运行（下表）。插件只检查登录文件**是否存在**（不读内容）；xhs 和 rdt 没有登录文件时会自己去读浏览器 Cookie，所以文件不存在时插件根本不运行它们，直接跳过并写明原因（现有闸门，未改动）。
- 一键脚本：`scripts/cli-login-check.mjs`（需要先 `pnpm build`）。默认只用你已有的登录态；每个 CLI 先做插件的契约探测，再执行一次搜索，打印解析摘要并把脱敏后的原始输出存盘。独立 opencli 会驱动你自己的 Chrome，必须用 `--opencli` 点名站点。

## 新的默认链

| 平台 | 默认链（`platformBackends` 显式配置的顺序原样优先） |
|---|---|
| xiaohongshu | `opencli` → `xhs` → `browser-opencli` |
| reddit | `opencli` → `rdt` → `browser-opencli` |
| twitter | `opencli` → `twitter` → `browser-opencli` |
| zhihu | `opencli` → `zhihu` → `browser-search` |

前一个后端失败（未登录、被风控、opencli 不可用、没装）就落到下一个；结果的 `notes` 写 `skipped backends: <id>: <原因>`，历史记下最终回答的后端；整条链都失败时错误按链序列出每个后端的原因。（`test/cli-opencli-chain.test.ts` 用假 opencli 覆盖了这些路径。）

## 2026-10-27 实测（opencli 1.8.8，扩展已连接，`opencli doctor` 全 OK；用户在场；未升级 opencli）

| 命令 | 结果 | 结论 |
|---|---|---|
| `xhs search … --json`（用户保存的登录） | 成功，一次返回 22 项（含 2 个 `model_type: hot_query` 建议卡片，没有 `note_card`），无垃圾行 | 规格 `live`；只留 `model_type = note`；发布时间在 `note_card.corner_tag_info[]` 里 `type == publish_time` 的 `text`（`08-26`、`2025-12-01`），现已映射 |
| `opencli twitter search -f json` | 成功，数组，每项 `id author bio text created_at likes views url has_media media_urls media_posters card quoted_tweet` | `live`；标题 = 正文，摘要 = `@作者 · likes · views · 时间`（照 twitter 后端）；`created_at`（`Tue Oct 27 08:38:08 +0000 2026`）转 ISO |
| `opencli zhihu search -f json` | 成功，数组，每项 `rank title type author votes url` | `live`；没有摘要和时间，不编造 |
| `opencli xiaohongshu search -f json` | 退出码 77，stderr YAML：`code: AUTH_REQUIRED` | 映射为 `CLI_NOT_LOGGED_IN`，提示“在你的 Chrome 里登录 www.xiaohongshu.com 后重试”；成功路径**未实测**（那个 Chrome 里没有小红书登录），映射按 1.8.8 适配器源码的输出列（`rank title author likes published_at url`），保持 contract-only |
| `opencli reddit search -f json` | 退出码 1，`code: UNKNOWN`，`SyntaxError: Unexpected token '<' … is not valid JSON`（站点返回了网页） | 映射为 `CLI_FAILED`，消息写明“站点返回了网页而不是数据，可能是风控、IP 被拦或需要登录”。这台机器的网络是代理出口，Reddit 登录页也显示“网络安全部门已屏蔽你的请求”：**Reddit 在代理 IP 下会被拦**，成功路径未实测（按 `search.json` 的字段：`id title subreddit author score comments url created_utc selftext`），contract-only |

没有运行：`zhihu`、`rdt`、`twitter` 三个独立 CLI 的搜索（没有登录文件 / Token，闸门会跳过）。修复后用同一命令各重跑一次（输出目录由 `--out` 指定）：xhs 3 条带发布时间，opencli twitter 3 条（作者 · likes · views · ISO 时间），opencli zhihu 3 条，xiaohongshu 报未登录并给出新提示，reddit 报“站点返回了网页”。

### opencli 的调用参数

`opencli <site> search --help` 与 `dist/src/execution.js`（1.8.8）显示，所有浏览器命令都接受 `--window <foreground|background>`、`--site-session <ephemeral|persistent>`、`--keep-tab <true|false>`，默认值已经是后台窗口、临时会话、不保留标签页（omnireach 也显式传 `--window background --site-session ephemeral --keep-tab false`）。插件现在同样显式传这三个参数：Chrome 不被抢焦点、标签页用完关闭，也不受环境变量 `OPENCLI_WINDOW` / `OPENCLI_SITE_SESSION` 影响。只在两个条件都满足时传：`opencli list -f json` 里该命令 `browser: true`，且本地探测 `opencli <site> search --help` 的输出里列出这三个参数（探测只看帮助，不搜索、不开浏览器，缓存 60 秒）；不满足就不传，避免老版本把未知参数当错误。

### opencli 的错误码

失败以 YAML（`ok: false` / `error: {code, message, help, exitCode}`）写在 stderr。插件的映射：

| `error.code`（退出码） | 映射 |
|---|---|
| `AUTH_REQUIRED`（77）；无可读载荷时退出码 77 | `CLI_NOT_LOGGED_IN`，提示“在你的 Chrome 里登录 <站点> 后重试” |
| `LOGIN_WALL`（77）、`SECURITY_BLOCK`、`RATE_LIMITED`、`FORBIDDEN`；消息含 `Unexpected token '<'` / `is not valid JSON` / `<!DOCTYPE` | `CLI_FAILED`：站点返回了网页而不是数据，可能是风控、IP 被拦或需要登录（带 opencli 的原话） |
| `EMPTY_RESULT`（66）、`NO_DATA`、`EMPTY_RESPONSE` | `ENGINE_EMPTY` |
| `BROWSER_CONNECT`（69） | `CLI_FAILED`：连不上浏览器扩展（检查 Chrome 在运行、OpenCLI Browser Bridge 已连接，`opencli doctor`） |
| `TIMEOUT`（75） | `ENGINE_TIMEOUT` |
| `ARGUMENT`、`INVALID_ARGUMENT`… | `CLI_CONTRACT_MISMATCH` |
| 其他（`COMMAND_EXEC`、`FETCH_ERROR`、`HTTP_ERROR`、`UNKNOWN`…） | `CLI_FAILED`，保留 `[CODE] 原话` |

## 独立 CLI（可选后备）

约定：下表“确切命令”就是插件会执行的 argv（抄自 `src/cli/builtin-specs.ts`，`{query}`/`{count}` 由插件填）。

| CLI | 登录方式（你自己做） | 登录文件 / 凭据 | 插件执行的搜索命令 | 验证程度 |
|---|---|---|---|---|
| `xhs`（xiaohongshu-cli 0.6.4） | `xhs login`（从浏览器提取 Cookie）或 `xhs login --qrcode`（扫码） | `~/.xiaohongshu-cli/cookies.json` | `xhs search {query} --json` | **live**（2026-10-27） |
| `zhihu`（pyzhihu-cli 0.2.4） | `zhihu login --qrcode`（推荐）或 `zhihu login --cookie "<含 z_c0、_xsrf、d_c0 的 cookie 串>"` | `~/.zhihu-cli/cookies.json` | `zhihu search {query} --limit {count} --answers 0 --json` | contract-only |
| `rdt`（rdt-cli 0.4.2） | `rdt login`（提取浏览器 Cookie） | `~/.config/rdt-cli/credential.json` | `rdt search {query} --limit {count} --compact --json` | contract-only |
| `twitter`（twitter-cli 0.8.5） | 没有登录命令：把 x.com 的 `auth_token`、`ct0` 两个 Cookie 的值放进环境变量（或插件设置 / DSH 凭据） | 环境变量 `TWITTER_AUTH_TOKEN`、`TWITTER_CT0`（插件还认设置 `twitterAuthToken` / `twitterCt0`，其次 DSH 凭据） | `twitter search {query} -n {count} --json` | contract-only |

## 运行方式

```bash
cd worktrees/dsh-web-search-pro-dev     # 或已安装的包目录；需要 lib/（pnpm build）
# 独立 opencli：会驱动你自己的 Chrome（后台窗口），必须点名站点；站点可选 xiaohongshu、twitter、reddit、zhihu
node scripts/cli-login-check.mjs --only "" --opencli xiaohongshu,twitter,reddit,zhihu --count 3 --yes
# 后备 CLI：没有登录文件 / Token 的会被闸门跳过
node scripts/cli-login-check.mjs --only xhs,zhihu,rdt
# twitter-cli：先在这个 shell 里导出两个值，脚本只把它们交给 twitter 子进程，保存的原始输出里会被替换
TWITTER_AUTH_TOKEN=... TWITTER_CT0=... node scripts/cli-login-check.mjs --only twitter
```

选项：`--count N`（默认 3）、`--out DIR`、`--query-xhs "词"`（同理 `--query-zhihu/--query-rdt/--query-twitter`）、`--yes`。输出目录里有 `summary.json`、`<id>.stdout.txt`、`<id>.stderr.txt`。脚本打印每个 opencli 站点实际带的参数（是否带后台窗口三件套）。

脚本的闸门（与插件相同，缺任一就只打印原因、不执行搜索）：命令不在 PATH / 契约探测不符 → 跳过；xhs、zhihu、rdt 的登录文件不存在 → 跳过（只检查文件是否存在，不读内容）；twitter 缺 `TWITTER_AUTH_TOKEN`/`TWITTER_CT0` → 跳过。独立 opencli 的登录态在 Chrome 里，无法本地检查，由你点名即运行。

## 还可以继续验证的

1. **opencli xiaohongshu 成功路径**：在日常 Chrome 里登录小红书后重跑，看 `rank title author likes published_at url` 是否如源码所述（`url` 是带 `xsec_token` 的 `search_result` 链接，`published_at` 来自笔记 id 的日期）。
2. **opencli reddit 成功路径**：换一个不被 Reddit 拦截的网络出口，或在 Chrome 里先打开 reddit.com 通过检查后再试；看 `id title subreddit author score comments url created_utc selftext` 的真实形状。
3. **zhihu / rdt / twitter 独立 CLI**：登录后各跑一次，通过则保存脱敏后的原始输出为 `test/fixtures/cli/live-<id>-*`，写离线回归测试，规格 `contract-only` → `live`。
4. **后台窗口是否真的不抢焦点**：脚本带了 `--window background`，但“不抢焦点”只能靠你在场观察，这次没有逐项记录。
5. 登录/限流文案与识别串不符的，把原话发出来，补进 `notLoggedInPatterns` 或 `errorCodes`。

## 在 DSH 里再跑一遍（可选，约 5 分钟）

在隔离 home 或你自己的 profile 里让模型调用一次 `web_call search.run platform=twitter`（及 zhihu、xiaohongshu、reddit）：`sources.status` 里该平台链应是 `opencli → … `，搜索结果行末尾的 `Platform: … (via opencli)` 显示最终回答的后端；被前面跳过的后端在 `notes` 的 `skipped backends` 里。想单测某个后端，用设置 `platformBackends` 把它放第一位。

## 已知前提

- omnireach 的自动路由会在 PATH 上有 `opencli` 时加入走你 Chrome 的 google/twitter 源（已修：插件现在只用显式 `--on` 的免登录源）；如果你手动运行 `omnireach search …` 不带 `--on`，同样会触发这个行为。
- opencli 有 2.0.2 可升级；本次实测与适配都针对 1.8.8，没有升级。
