# CLI 适配与自定义 CLI

> 适用版本：dsh-web-search-pro 0.2.3 · [返回 README](../../README.md) · [文档索引](../README.md)

## 声明式适配规格

平台不再几乎只靠 dsh-browser 的 OpenCLI：本插件有一层声明式的 CLI 适配（`src/cli/`）。一个适配规格 `CliAdapterSpec` 写明：命令名（`bins`，包名可与命令名不同，记在 `packageNote`）、探测契约（`probe`：`--version`、最低版本、`--help` 里必须出现的子命令 / 参数）、搜索命令（`search.argv` 是**数组**，只有 `{query}`、`{count}` 两个占位符，永不经过 shell）、输出格式（`json` / `ndjson` / `yaml` / `text`）与字段映射、`emptyWhen` / `notLoggedInPatterns`、环境变量白名单（`env.required` / `passthrough`，只写名字）、超时与输出上限。执行器按 UTF-8 解码，超时 / 取消 / 输出超限都有结构化错误：`CLI_NOT_FOUND`、`CLI_CONTRACT_MISMATCH`、`CLI_NOT_LOGGED_IN`（独立 CLI 提示“请自行运行 `<cli> login`”；`opencli` 提示“在你的 Chrome 里登录 <站点> 后重试（opencli 使用 Chrome 的登录态）”）、`ENGINE_EMPTY`、`CLI_FAILED`；错误文字里不会出现环境变量的值。规格可以带 `errorCodes`，说明工具自己的失败格式：`opencli` 把失败以 YAML（`ok: false` / `error: {code, message}`）写在 stderr，`AUTH_REQUIRED`（退出码 77）映射为未登录；`LOGIN_WALL`、`SECURITY_BLOCK`、`RATE_LIMITED`，以及 Reddit 实测遇到的 `UNKNOWN: Unexpected token '<' … is not valid JSON`（站点回了网页而不是 JSON）映射为 `CLI_FAILED`，消息明确写“站点返回了网页而不是数据，可能是风控、IP 被拦或需要登录”；`EMPTY_RESULT` → 无结果，`BROWSER_CONNECT` → 连不上浏览器扩展，`TIMEOUT` → 超时，其余错误码保留工具自己的原话。任何命令输出若是 HTML 文档（而不是 JSON / YAML），同样按“站点返回了网页”报告。

## 只读保证与探测

**只读保证**（内置和用户自定义规格同样适用）：规格必须声明 `allowedSubcommands`，argv 里用到的子命令都得在其中，且不得命中全局拒绝表（`login`、`logout`、`post`、`comment`、`delete*`、`like`、`follow`、`favorite`、`upvote`、`save`、`subscribe`、`publish`、`ask`、`article`、`pin`、`setup`、`init`、`install`、`update` 等）；会读取浏览器 Cookie 或把凭据放进参数的 flag（`--cookie-source`、`--cookies-from-browser`、`--token`、`--password`……）一律拒绝。插件**永不运行任何登录命令**，也不代用户登录：需要登录的 CLI 由你自己运行它的 `login`；没有已保存登录的 xhs / rdt / zhihu 不会被运行（它们在没有登录时会自己去读浏览器 Cookie）。子进程只拿到最小环境（PATH、HOME、代理、证书，加规格点名的变量），不继承你整个环境。

**探测**只在本地：找命令、跑 `--version` 和规格里的 `--help`，检查版本与契约，缓存 60 秒；**不搜索、不登录**。同名但契约不同的程序（如 PyPI 上另一个 `bili-cli`）报 `incompatible` 并写明原因，不会被当成可用。`sources.deps` 显示每个 CLI 的 `installation`（missing / detected / incompatible）、版本、适配验证程度；`sources.status` 的每个平台带 `chain`：每条后端的顺序、状态、被跳过的原因。

## 内置规格与验证程度

| 内置规格 | 命令 | 已验证版本（2026-10-06；yt-dlp 与 twitter 为 2026-10-11） | 验证程度 |
|---|---|---|---|
| `bili`（bilibili） | `bili` | 0.6.2 | **live**（2026-10-26：中英文与特殊字符查询实测；约五分之一的条目是没有链接的课程/系列，适配层多要 3 条以凑够 count） |
| `gh`（github / github-issues / github-code 的回退） | `gh` | 2.101.0 | **live**（2026-10-26：仓库、issues、code 搜索均实测；查询按词拆成多个参数，因为 gh 会把单个参数当精确短语） |
| `omnireach`（`wechat` 与多源 `omnireach`） | `omnireach` | 0.19.0-alpha | **live**（`--on wechat`；多源命令 2026-10-26 实测，显式 `--on hackernews,youtube,github,wechat,bilibili`——工具自带的自动路由在 PATH 上有 `opencli` 时会加入走你 Chrome 的 google / twitter 源，所以从不使用） |
| `yt-dlp`（youtube） | `yt-dlp` | 2026.08.19 | **live**：真实运行 `ytsearch2:` 搜索并解析（2026-10-11） |
| `twitter`（可选后备） | `twitter` | 0.8.5 | contract-only：`--json` 信封与字段来自已装 0.8.5 的源码和 issue #38 里的真实输出；需要你的 Token，我们没运行过搜索 |
| `xhs`（xiaohongshu，可选后备） | `xhs` | 0.6.4 | **live**（2026-10-27：用你自己保存的登录实测；一次返回 22 项，其中 `hot_query` 建议卡片被跳过，发布时间取 `note_card.corner_tag_info` 里的 `publish_time`，`MM-DD` / `YYYY-MM-DD` / `N小时前` 等保守解析，认不出的不填） |
| `zhihu`（可选后备） | `zhihu`（PyPI `pyzhihu-cli`） | 0.2.4 | contract-only（同上） |
| `rdt`（reddit，可选后备） | `rdt` | 0.4.2 | contract-only（同上） |
| 独立 `opencli`（按站点，登录类平台的**首选**后端） | `opencli` | 1.8.8 | 只用 `opencli list -f json` 里有只读 `search` 命令的站点，输出用 `-f json`。**twitter、zhihu：live**（2026-10-27 用你日常 Chrome 实测；twitter 的 `created_at` 转成 ISO，标题 / 摘要照 twitter 后端：作者 · likes · views · 时间；zhihu 只有标题 / 类型 / 作者 / 赞同数 / 链接，没有摘要和时间）。**xiaohongshu、reddit：contract-only（未实测）**——那次 Chrome 里没有小红书登录（`AUTH_REQUIRED`），Reddit 在代理出口下回了网页（见下）；字段取自 opencli 1.8.8 适配器源码里的输出列。其余站点：contract-only |
| `wx-search-cli`（wechat 第二后端） | `wx-search-cli` | 0.1.0 | **live**（2026-10-26：中英文与无结果查询实测；一页固定 10 条，适配层按 count 截取；搜狗反爬时它输出 `[]` 且退出码 0，与“无结果”无法区分） |
| `tanso` | `tanso` | 2.0.2 | docs-only：按上游 README，未安装；只选 `bocha_web` 与 `zhihu_search` |

目录里另有只列条目、没有适配的 `douyin-cli`（它的 README 没写搜索记录的字段）。contract-only 的字段映射来自工具自己的帮助 / 源码，并有标成 “constructed” 的夹具测试；它们在真实登录后的输出上还没被确认。live 的夹具（`test/fixtures/cli/live-*`）保持真实输出的**形状**，内容一律是合成的占位值（仓库公开，不放真实作者、正文、id 或 token）。

## 默认后端链

`platformBackends` 可改，未列出的平台用默认顺序：

| 平台 | 默认链 |
|---|---|
| xiaohongshu | `opencli`（独立）→ `xhs` → `browser-opencli`（dsh-browser） |
| reddit | `opencli` → `rdt` → `browser-opencli` |
| zhihu | `opencli` → `zhihu` → `browser-search`（dsh-browser 搜索页） |
| twitter | `opencli` → `twitter` → `browser-opencli` |
| bilibili / youtube | `bili` / `yt-dlp` |
| github、github-issues、github-code | `rest`（现有 REST）→ `gh` |
| wechat（公众号，新） | `omnireach` → `wx-search-cli` |
| omnireach（多源，不自动选入；只用五个免 Key 源） | `omnireach` |
| tanso | `tanso` |
| instagram / facebook | `browser-opencli`；weibo、douban、tieba、douyin、kuaishou：`browser-search` |

链上缺失、不兼容、未登录、被风控或出错的后端被跳过并记下原因（结果的 `notes` 里写 `skipped backends: opencli: …`，历史里记下最终回答的后端）；只有整条链都不可用时平台才不可用，错误会列出每条后端缺什么、该安装或运行什么。你显式配置的 `platformBackends` 原样优先，不会被新的默认顺序改写。M0 冷却、并发合并、输出整形、证据模式与显式 `platform` 的语义不变。

## 登录类平台怎么用

**登录类平台（小红书、知乎、Reddit、X）怎么用——登录完全交给你**：推荐的做法是在你**日常使用的 Chrome** 里登录这些站点，再装好 [OpenCLI](https://github.com/jackwener/opencli)（`npm i -g @jackwener/opencli`）和它的 **OpenCLI Browser Bridge** 扩展（`opencli doctor` 全 OK 即连通）。独立 `opencli` 是这四个平台的首选后端，直接使用那个 Chrome 的登录态：插件不提供任何登录流程、不运行任何登录命令、不读浏览器 Cookie，登录态过期时报“在你的 Chrome 里登录 <站点> 后重试”。调用时插件给站点命令带上 `--window background --site-session ephemeral --keep-tab false`（opencli 1.8.8 的浏览器命令都支持，也是它的默认值）：在后台窗口里跑、不抢你的焦点、用完关标签页；只对 `opencli <site> search --help` 里列出这三个参数的命令传（本地探测，不搜索），老版本或不开浏览器的命令不传。独立 CLI（`xhs`、`rdt`、`zhihu`、`twitter`）只是**可选后备**：想用就按它们自己的方式登录（下面），仍由你自己运行，插件只检查登录文件是否存在，没有就跳过。

**2026-10-27 的实测结论**（opencli 1.8.8，用户在场）：`opencli twitter search` 与 `zhihu search` 成功并已适配；`opencli xiaohongshu search` 退出码 77 `AUTH_REQUIRED`（那个 Chrome 里没有小红书登录），已映射为未登录；`opencli reddit search` 退出码 1，Reddit 返回的是网页（`Unexpected token '<'`）——这台机器的网络是代理出口，Reddit 的登录页也显示“网络安全部门已屏蔽你的请求”，所以 **Reddit 在代理 IP 下会被拦**，换网络出口后才能验证它；`xhs search` 用用户保存的登录成功。

**启用一个独立 CLI（可选后备）**：按 `sources.deps` 给出的命令安装（`sources.install` 需要你的审批），再**自己**运行它的登录命令（`xhs login`、`rdt login`、`zhihu login`、`gh auth login`；twitter 要 `TWITTER_AUTH_TOKEN` / `TWITTER_CT0`：在设置面板写入 DSH Credentials，或设在**宿主进程**的环境变量里，只写进 shell 配置文件（`~/.zshrc` 等）不够，宿主进程读不到。解析顺序同插件其他密钥：设置里的字面量 `twitterAuthToken` / `twitterCt0` → 凭据引用 `twitterAuthTokenEnv` / `twitterCt0Env` → 进程环境变量；值只通过子进程的环境变量交给 `twitter`，不进命令行、日志或错误信息，`sources.status` 缺失时会写明查过哪里）。想优先用它，就改链序：

    web-search-pro:
      platformBackends:
        xiaohongshu: [xhs, opencli, browser-opencli]   # 例：想让 xhs 排在 opencli 前面
      cliAdapters:                     # 自定义只读适配（同样的校验），注册为 custom-cli:mytool
        mytool:
          bins: [mytool]
          packageNote: 'mytool (npm i -g mytool)'
          engine: true                 # 通用搜索引擎：可写进 engines: [ddg, custom-cli:mytool]
          platforms: []                # 或声明它服务哪些平台（platformBackends.<平台> 里才能放它）
          confidence: 0.7              # 0–1，默认 0.5
          probe: { versionArgs: ['--version'], helpArgs: ['search', '--help'], mustContain: ['--json'] }
          allowedSubcommands: [search]
          search:
            argv: [search, '{query}', '--limit', '{count}', '--json']
            maxCount: 10
            output: { format: json, itemsPath: data, fields: { url: url, title: title, snippet: summary } }
          env: {}
          needsLogin: false
          timeoutMs: 30000
          maxOutputBytes: 1048576

无效的 `cliAdapters` 条目被忽略，原因出现在 `sources.status` 的 `notes`；设置面板里有“自定义 CLI”表单（和它的 JSON 视图），校验与服务端是同一批函数。

## 自定义 CLI

**自定义 CLI（0.2.3）**：规格新增三项（只用于用户规格，内置规格写会被拒绝）：

- `engine: true`：作为**通用搜索引擎**，`engines` 里写 `custom-cli:<id>`；它和其他引擎一样按顺序回退，`multi` / `parallelEngines` 时参与融合与去重。`platforms` 现在是它**声明服务的平台**（`platformBackends.<平台>` 里放它之前必须声明；声明了没有后端链的平台会在 `sources.status` 和面板里报问题）；只做通用引擎时可以为空。它同时仍是平台 `custom-cli:<id>`（`search.run platform=custom-cli:<id>`）。
- `confidence`（0–1，默认 0.5）：见下“置信度”。
- `search.output.lines: { mode: whole, maxChars? }`（`format: text`）：**整段输出**。不想写字段映射、只输出一段文本的工具：stdout 整体作为**一条**结果，标题是“`<id>: <查询>`”，链接是占位的 `cli://<id>?q=<查询>`，文本截到 `maxChars`（默认 2000，最大 8000）并在末尾写明“truncated: N of M characters shown”，空输出是 `ENGINE_EMPTY`。**限制**：这个链接不是网页——证据模式（`task` / `profile`）把它列为来源（它的文本就是摘要），但**不会抓取它**，也不占读页名额；它不会产生证据摘录。结果只在普通搜索结果和证据包的 `sources` 里；多来源融合时换行会折成空格。只读保证、禁用词、不经 shell、超时、输出上限对它照常生效。

**结果打包**：自定义 CLI 的结果与其他来源同一个结构（标题、链接、摘要、时间、`engine`、`backend`），另带三个可选字段：`via`（`custom-cli:<id>`）、`confidence`（低于 1 时）和 `tag`（“user-defined, not verified by the plugin (用户自定义，未经插件验证)”）；文本渲染成 `[via custom-cli:echo, confidence 0.5, user-defined, not verified by the plugin (…)]`，证据摘录行同样带上。缓存命中、历史里的结果保留这三项。

## 置信度（0–1）

**置信度（0–1）**：自定义 CLI 写在规格里（默认 0.5），任何来源或平台后端都能用 `sources.confidence.<id>` 覆盖（内置来源默认 1；平台的结果取“平台自己的 × 回答的后端的”）。作用方式很保守，只在多个来源融合排名时起作用：

    factor(c)  = 1 − 0.2 · (1 − c)                          ∈ [0.8, 1]，c = 1 时不乘（恰好 1）
    rrf(d)     = Σ_来源  factor(c_来源) / (k + 该来源给 d 的最好名次)
    bonus(d)  *= max_来源 factor(c_来源)                    只有被存疑来源返回的 URL，新鲜度 / 权威 / 评分信号的加分按比例减少

即置信度 c 的来源像是它的列表整体往后排了 (k+1)·(1/factor − 1) 位：k = 60 时 c = 0.5 约 7 位、c = 0 约 16 位；多个来源都返回的结果几乎不受影响，只有存疑来源有的结果沉向队尾，但**它最好的那条仍保证留在展示的列表里**（并行搜索的前 `count` 条；证据模式里是会被读页的前几条；最多占 `size−1` 个位置）。内置来源全是 1 时融合分数与原来**逐位相同**（单元测试固定；`bench:eval-pack` 在 v1 / v2 上的报告与改动前逐字段相同）。一次只用一个引擎（顺序回退）时没有融合，置信度只作标注。`sources.status` 显示每个来源和每个后端的置信度，设置面板的搜索顺序列表每行显示并可改。
