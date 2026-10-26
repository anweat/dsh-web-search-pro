# 登录类 CLI 陪测清单（xhs、zhihu、rdt、twitter、独立 opencli）

适用：dsh-web-search-pro 0.2.2 之后的 `test/cli-live` 分支。这五个适配在源码层面核对过（flag、输出形状、登录文件位置都来自已装工具的 `--help` 与包源码），但**没有一个用真实登录态搜索过**，规格状态仍是 `contract-only`。本清单是给“你在场、用你自己的登录态”那次陪测准备的。

约定：
- 下表里的“确切命令”就是插件会执行的 argv（抄自 `src/cli/builtin-specs.ts`，`{query}`/`{count}` 由插件填）。`pnpm build` 后的 `lib/` 与之相同。
- 插件**从不**运行登录命令。xhs 和 rdt 在没有登录文件时会自己去读浏览器 Cookie，所以插件在登录文件不存在时直接跳过它们（`sources.status` 里写 “no saved login”）；脚本里的闸门与插件一致。
- 一键脚本：`scripts/cli-login-check.mjs`（已写好，**没有在真实机器上运行过**；只用假 CLI 在隔离 PATH/HOME 里验证过它的流程）。默认不运行任何登录命令，只用你已有的登录态；每个 CLI 先做插件的契约探测，再执行一次搜索，打印解析摘要并把脱敏后的原始输出存盘。

## 总览

| CLI | 登录方式（你自己做） | 登录文件 / 凭据 | 插件执行的搜索命令 | 预计耗时 |
|---|---|---|---|---|
| `xhs`（xiaohongshu-cli 0.6.4） | `xhs login`（从浏览器提取 Cookie）或 `xhs login --qrcode`（扫码） | `~/.xiaohongshu-cli/cookies.json` | `xhs search {query} --json` | 登录 1–3 分钟；检查 ≤ 1 分钟 |
| `zhihu`（pyzhihu-cli 0.2.4） | `zhihu login --qrcode`（推荐）或 `zhihu login --cookie "<含 z_c0、_xsrf、d_c0 的 cookie 串>"` | `~/.zhihu-cli/cookies.json` | `zhihu search {query} --limit {count} --answers 0 --json` | 登录 1–3 分钟；检查 ≤ 1 分钟 |
| `rdt`（rdt-cli 0.4.2） | `rdt login`（提取浏览器 Cookie） | `~/.config/rdt-cli/credential.json` | `rdt search {query} --limit {count} --compact --json` | 登录 1–2 分钟；检查 ≤ 1 分钟 |
| `twitter`（twitter-cli 0.8.5） | 没有登录命令：把 x.com 的 `auth_token`、`ct0` 两个 Cookie 的值放进环境变量（或插件设置 / DSH 凭据） | 环境变量 `TWITTER_AUTH_TOKEN`、`TWITTER_CT0`（插件还认设置 `twitterAuthToken` / `twitterCt0`，其次 DSH 凭据） | `twitter search {query} -n {count} --json` | 取 Cookie 2 分钟；检查 ≤ 1 分钟 |
| 独立 `opencli`（1.8.8） | 你的 Chrome 里登录对应网站 + 已装并连上 OpenCLI Browser Bridge 扩展（`opencli doctor` 能看到连接） | 登录态在 Chrome 里，插件无法本地检查 | `opencli <站点> search {query} [--limit {count}] -f json`，站点来自 `opencli list -f json` | 每站点 1–2 分钟（会在后台开 Chrome 窗口） |

合计：四个 CLI 约 15–20 分钟（含登录），独立 opencli 另加 5–10 分钟。已有登录态的话每个不到 1 分钟。

## 运行方式

```bash
cd worktrees/dsh-web-search-pro-cli     # 或已安装的包目录；需要 lib/（pnpm build）
# 先看会执行什么（不加 --yes 会要求你确认；非交互环境必须加 --yes）
node scripts/cli-login-check.mjs --only xhs,zhihu,rdt
# twitter：先在这个 shell 里导出两个值，脚本只把它们交给 twitter 子进程，保存的原始输出里会被替换
TWITTER_AUTH_TOKEN=... TWITTER_CT0=... node scripts/cli-login-check.mjs --only twitter
# 独立 opencli：会驱动你自己的 Chrome，必须点名站点
node scripts/cli-login-check.mjs --only "" --opencli xiaohongshu,reddit   # 站点可选 xiaohongshu、twitter、reddit、zhihu
```

选项：`--count N`（默认 3）、`--out DIR`、`--query-xhs "词"`（同理 `--query-zhihu/--query-rdt/--query-twitter`）、`--yes`。输出目录里有 `summary.json`、`<id>.stdout.txt`、`<id>.stderr.txt`。

脚本的闸门（与插件相同，缺任一就只打印原因、不执行搜索）：命令不在 PATH / 契约探测不符 → 跳过；xhs、zhihu、rdt 的登录文件不存在 → 跳过（只检查文件是否存在，不读内容）；twitter 缺 `TWITTER_AUTH_TOKEN`/`TWITTER_CT0` → 跳过。

## 逐个：确切命令、事先准备、检查点

### 1. xhs（小红书）

- **契约探测**（只读帮助）：`xhs --version`；`xhs search --help` 必须含 `keyword`、`--json`、`--sort`。
- **搜索**：`xhs search "<词>" --json`。（`xhs search` 另有 `--sort general|popular|latest`、`--type all|video|image`、`--page`，插件不用；`xhs` 全局选项 `--cookie-source` 插件也不传——传它就是让工具读浏览器。）
- **事先准备**：`xhs login`（工具从你的浏览器提取 Cookie 并存盘；加 `--qrcode` 则扫码）。成功后 `~/.xiaohongshu-cli/cookies.json` 存在（0600，含 `a1` 与 `saved_at`；超过 7 天工具会尝试用浏览器刷新）。可用 `xhs status` 看登录状态。**没有这个文件时 `xhs search` 会自己读浏览器 Cookie 并写文件，所以别在没登录文件时手动跑，也别指望插件会跑。**
- **检查点**：
  1. stdout 是信封 `{"ok":true,"schema_version":"1","data":{"items":[...]}}`；`items[]` 有 `id`、`xsec_token`、`note_card.display_title`、`note_card.user.nickname`、`note_card.interact_info.liked_count`。
  2. 我们的映射：URL = `https://www.xiaohongshu.com/explore/{id}?xsec_token=…&xsec_source=pc_search`；标题 = `display_title`（回退 `title`）；摘要 = `作者: … | 赞: …`。看 `summary.json` 里 `resultCount` 与 `skipped`：搜索结果里常夹杂非笔记条目（相关搜索词、推荐），它们没有 `id`/`xsec_token`，应被跳过而不是变成垃圾行。
  3. 链接能在浏览器里打开笔记（`xsec_token` 是否必需）。
  4. 没有 `publishedAt`（规格没映射；列表里是否有发布时间字段，有的话告诉我）。
  5. 未登录/过期时的原话：源码里是 `error.code = "not_authenticated"`、消息 “No 'a1' cookie found for xiaohongshu.com in any installed browser.”；插件的识别串是 `not authenticated`/`not_authenticated`/`no 'a1' cookie`。如果你的过期登录给出了别的文案（比如 `session expired`、`verification_required`、`ip_blocked`、`signature_error`），把原话给我，我补进 `notLoggedInPatterns` 或做专门的错误码。
- **失败时重点看**：`verification_required`（验证码）、`ip_blocked`、`signature_error` 是否被我们当成 `CLI_FAILED` 并带原话。

### 2. zhihu（知乎）

- **契约探测**：`zhihu --version`；`zhihu search --help` 必须含 `query`、`--json`、`--limit`、`--type`。
- **搜索**：`zhihu search "<词>" --limit <N> --answers 0 --json`（`--answers 0` 只影响终端表格；`--json` 输出原始 `search_v3` 响应）。
- **事先准备**：`zhihu login --qrcode`（推荐）或 `zhihu login --cookie "<串>"`；成功后 `~/.zhihu-cli/cookies.json` 存在（需含 `z_c0`、`_xsrf`、`d_c0`）。`zhihu status` 离线检查。工具**不会**自己读浏览器 Cookie（源码确认），没有文件时直接报 “Not authenticated — run zhihu login”。
- **检查点**：
  1. stdout 是**没有信封**的原始 JSON：`{"data":[{"type":"search_result","object":{"type":"answer|article|question|…","id":…,"title":…,"question":{"id":…,"name":…},"excerpt":…,"created_time":…}}],"paging":…}`。这是规格里最没把握的地方（只对照了源码，没见过真实响应）：看每条 `object.type` 的分布。
  2. 我们的映射：answer → `zhihu.com/question/{question.id}/answer/{id}`；article → `zhuanlan.zhihu.com/p/{id}`；question → `zhihu.com/question/{id}`；标题 = `object.title` / `question.name` / `name`（去 `<em>`）；摘要 = `excerpt` / `content`；时间 = `created_time`（秒）。其他类型（专栏、视频、话题、广告）会因没有链接被跳过——看 `skipped`，如果大部分结果都被跳过说明映射缺类型，把原始输出发我。
  3. 标题里不应残留 `<em>`；answer 的标题应是问题标题而不是空。
  4. 未登录原话：`Not authenticated — run zhihu login`（exit 1，插件识别 `not authenticated`/`zhihu login`）。被反爬时是 `Search failed: …`（我们当 `CLI_FAILED` 带原话），请记录 HTTP 状态/错误码（40362 之类）。

### 3. rdt（Reddit）

- **契约探测**：`rdt --version`；`rdt search --help` 必须含 `query`、`--json`、`--compact`、`--limit`。
- **搜索**：`rdt search "<词>" --limit <N> --compact --json`（`--compact` 让 `data` 变成帖子数组）。
- **事先准备**：`rdt login`（工具从浏览器提取 Reddit Cookie 存盘；这条是你自己运行的登录）。成功后 `~/.config/rdt-cli/credential.json` 存在；`rdt status` 看状态。注意 `rdt search` 本身用的是“可选认证”，**没登录文件时它会去读浏览器 Cookie**，这正是插件要求登录文件存在才执行的原因。
- **检查点**：
  1. 信封 `{"ok":true,"schema_version":"1","data":[{id,name,title,subreddit,author,score,num_comments,created_utc,permalink,url,selftext,is_self,over_18,is_video,stickied}]}`。
  2. 映射：URL = `https://www.reddit.com{permalink}`；标题 = `title`；摘要 = `r/{subreddit} | score … | … comments | selftext`；时间 = `created_utc`（秒）→ ISO。
  3. `permalink` 是否都以 `/r/` 开头；`selftext` 很长时摘要被截到 400 字符并带 “(Content truncated…)”——是否可接受；`over_18` 帖子是否出现（插件目前不过滤）。
  4. 翻页提示 “▸ More: rdt search … --after …” 应在 stderr 而不是 stdout（否则 JSON 会坏）——看 `<id>.stdout.txt` 是否是纯 JSON。
  5. 未登录/限流原话：源码里没有现成文案，错误码是 `not_authenticated`（exceptions.py）；请记录 429/403 时的原话。

### 4. twitter（X）

- **契约探测**：`twitter --version`；`twitter search --help` 必须含 `--json`、`--max`（0.8.5 是已知有 `--json` 的最旧版本；0.2.1 时代的规格解析 YAML 导致 #38）。
- **搜索**：`twitter search "<词>" -n <N> --json`。
- **事先准备**：设置 `TWITTER_AUTH_TOKEN`（x.com Cookie `auth_token` 的值）和 `TWITTER_CT0`（Cookie `ct0` 的值）。浏览器里取：登录 x.com → 开发者工具 → Application/存储 → Cookies → `https://x.com`。工具没有登录命令；**没有这两个变量时 twitter-cli 会自己尝试读浏览器 Cookie**，所以插件在缺变量时不运行它。注意：Host 进程不读 shell 配置，在 DSH 里用要放进 DSH 凭据（插件设置 `twitterAuthToken`/`twitterCt0`）或 Host 的进程环境。`twitter status --json` 可确认会话（只在两个变量都设置后再跑）。
- **检查点**：
  1. 信封 `{"ok":true,"schema_version":"1","data":[tweet]}`，tweet 有 `id`、`text`、`author{name,screenName}`、`metrics{likes,retweets,views}`、`createdAtISO`、`isRetweet`。
  2. 映射：URL = `https://x.com/{author.screenName}/status/{id}`；标题 = `text`（折成一行、≤200 字）；摘要 = `作者 (@screenName) · likes … · retweets … · views … · 时间`；时间 = `createdAtISO`。
  3. 标题里不能出现 `profileImageUrl:` 这类字段名（#38 的症状）；转推（`isRetweet`）的 `text` 是否以 `RT @` 开头；条数是否等于 `-n`。
  4. 未登录原话（源码）：code `not_authenticated`，消息 “No Twitter cookies found.” 或 “Cookie expired or invalid (HTTP 401)”；限流 `rate_limited`。请记录你实际看到的文案和 HTTP 状态。
- 完成后如果通过：#38 可以回复“已用真实登录态验证”，规格改 `live`。

### 5. 独立 opencli（xiaohongshu / twitter / reddit / zhihu 站点）

- **契约探测**：`opencli --version`（要求 ≥ 1.8.0）；`opencli list --help` 必须含 `--format`、`json`；然后 `opencli list -f json`（本地命令表，不碰浏览器）决定哪些站点有只读 `search`：本机 1.8.8 的表里 xiaohongshu、twitter、reddit、zhihu、weixin、hackernews、douyin 有，v2ex、xiaoyuzhou 没有。
- **搜索**：`opencli <站点> search "<词>" [--limit <N>] -f json`（`--limit` 只在该站点的 search 有 `limit` 参数时传；四个站点都有）。
- **事先准备**：Chrome 里已登录该站点；OpenCLI Browser Bridge 扩展已装并连上（`opencli doctor` 看连接；它是诊断命令，由你运行）。登录命令是 `opencli <站点> login`（插件从不运行）。
- **检查点**：
  1. `-f json` 的输出是数组还是 `{data:[…]}`；每行的 URL 字段叫什么（插件依次找 `url`、`link`、`href`、`projectUrl`、`item_url`）。**最大风险**：某个站点的 search 行里根本没有 URL 字段，所有结果会因没有链接被跳过——`summary.json` 的 `skipped` 会暴露。
  2. 标题（`title`/`name`/`text`/`desc`/`label`）、摘要、时间字段的实际列名；
  3. 站点未登录时 opencli 的原话（插件识别 `not logged in`、`login required`、`please log in`、`sign in`、`auth_required`、`未登录`、`请先登录` 等）；
  4. 运行过程中 Chrome 是否弹出窗口/标签、是否在后台关闭（我们看到的 omnireach 调用 opencli 用的是 `--window background --site-session ephemeral --keep-tab false`；插件自己调用没有传这些）。
  5. 按站点把原始输出发我，我据此把通用映射改成每站点精确映射。

## 通过后我们做的事

| 结果 | 动作 |
|---|---|
| 某个 CLI 的搜索返回合理结果、无垃圾行 | 保存脱敏后的原始输出为 `test/fixtures/cli/live-<id>-*`，写离线回归测试，规格 `contract-only` → `live`，README/skill/catalog 同步 |
| 解析出垃圾或条数为 0 | 对照原始输出改规格 flag / 映射 / 错误识别，单独提交并加测试 |
| 登录/限流文案与我们的识别串不符 | 补 `notLoggedInPatterns` 或新增错误码；`sources.status` 的说明同步 |

## 在 DSH 里再跑一遍（可选，约 5 分钟）

CLI 通过后，在隔离 home 或你自己的 profile 里让模型调用一次 `web_call search.run platform=xiaohongshu`（及 reddit/zhihu/twitter）：`sources.status` 里该平台链应从 “no saved login (run `xhs login` yourself)” 变为 `ready`，搜索结果行末尾的 `Platform: … (via xhs)` 应显示 `xhs` 而不是 `opencli`/`browser-opencli`（默认链序：xiaohongshu 是 `opencli → xhs → browser-opencli`，reddit 是 `rdt → opencli → browser-opencli`，twitter 是 `twitter → opencli → browser-opencli`，zhihu 是 `zhihu → browser-search`；想单测某个后端，用设置 `platformBackends` 把它放第一位）。

## 已知前提（别被它们绊住）

- 本机现状（2026-10-26 检查）：`~/.xiaohongshu-cli/cookies.json`、`~/.zhihu-cli/cookies.json`、`~/.config/rdt-cli/credential.json` 均不存在，`TWITTER_AUTH_TOKEN`/`TWITTER_CT0` 未设置——所以现在运行脚本，四个都会被闸门跳过，什么也不会执行。
- omnireach 的自动路由会在 PATH 上有 `opencli` 时加入走你 Chrome 的 google/twitter 源（已修：插件现在只用显式 `--on` 的免登录源）；如果你手动运行 `omnireach search …` 不带 `--on`，同样会触发这个行为。
