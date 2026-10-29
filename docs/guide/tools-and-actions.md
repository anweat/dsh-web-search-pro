# 工具与动作

> 适用版本：dsh-web-search-pro 0.2.3 · [返回 README](../../README.md) · [文档索引](../README.md)

常驻上下文只有两个工具，所有能力（当前共 27 个动作，分 7 组）都经 `web_call` 调用。常驻文本（系统提示 + 工具名、描述、参数）约 800 字符（原 11 个工具约 9300 字符）：

| 工具 | 作用 |
|---|---|
| `web_index({group?, action?, query?})` | 渐进披露目录：无参数列出能力组、两个最常用调用、旧名对照；`group` 列出该组动作；`action` 给出完整参数；`query` 按关键词检索（至多 8 条） |
| `web_call({action, args})` | 执行一个动作，返回统一信封 `{ok, action, result \| error{code,message,hint,schema?}, truncation?}`；参数校验失败（`INVALID_ARGS`）时附带该动作的精简 schema，一次即可改对；未知动作会给出相近动作名 |

使用指引放在随包提供的 skill `dsh-web-search-pro`（证据模式优先、先读 `gaps` 再下结论、`search.recommend` 只用 1–2 个来源、`read.fetch` 的 `offset` 续读、约束、预算、浏览器交接；参考文件含来源与 Key 配置、评分 provider 与 rubric、排障）。skill 通过可选的 `ctx.skills` 注册，**不写入必需的 `inject`**；宿主没有 skill 服务时，`web_index()` 根目录附一段精简指南兜底。系统提示只保留一行入口（有 dsh-browser 时再加一行指向 skill `dsh-browser` / `browser_index`）。

## 动作

| 组 | 动作 | 作用 |
|---|---|---|
| `search` | `run` | 多引擎搜索 + RRF 融合 + 内存/SQLite 双层缓存 + 历史；传 `task` / `profile` 得证据包；传 `platform` 搜单个平台（GitHub/B站/YouTube/V2EX/小红书/Twitter/Reddit/IG/FB/RSS + 知乎/微博/豆瓣/贴吧/抖音/快手，登录态走 Playwright；RSS 用 `url` 传 feed、`query` 可选过滤；平台与网页引擎走同一条注册表执行路径，可与 `task`/`profile` 同用得到证据包，见[平台来源](./search-and-evidence.md#平台来源)） |
| | `recommend` | 按任务推荐至多 3 个来源（已就绪优先，其余给出缺失条件），不发搜索请求 |
| `read` | `fetch` | 可读化抓取（Jina → HTTP+规则抽取 → Playwright 兜底）+ 快照缓存与 `offset` 续读；`auto` 按质量升级：每次结果先判为 content / shell / js_shell / login_wall / captcha / error，只有 shell、js_shell、login_wall 且 dsh-browser 就绪时才升级到 Playwright（captcha 与错误页不会，短而有实质内容的事实页不算空壳），取质量最好的一次并在 `attempts` 里记录各后端结果；不会自动安装任何东西；显式 mode 不升级，只复用同后端缓存 |
| | `contents` | 原生 Exa `/contents` 批量正文抓取（1-100 URL，需 Exa Key） |
| | `snapshot` | Playwright HTML + 文本落盘；`screenshot=false` 时不生成 PNG（需要 dsh-browser） |
| `history` | `list` / `replay` / `expand` / `export` / `delete` | 持久历史：过滤列出 / 按 id 回放 / 读回证据摘录及前后块 / 导出 JSON / 删除一条查询 |
| `sources` | `status` | 无副作用后端探测、失败/冷却诊断与 CLI 状态（Twitter 项同时检查 `twitter` 命令、设置开关和凭据环境变量，`note` 说明缺什么） |
| | `deps` / `install` | 检测 / 安装搜索后端的外部依赖（bili/yt-dlp/twitter/agent-reach/mcporter；每项探测的是后端真正执行的命令）；浏览器依赖由 dsh-browser 管理 |
| `rules` | `list` / `upsert` / `remove` / `import` / `export` | 持久化按站提取规则（脚本猫式）；export 会写出可再导入的版本化 JSON rule pack |
| `cache` | `clear` / `stats` | 按时间/引擎清缓存 / 存储统计 |
| `config` | `inspect` / `set_order` / `set_confidence` / `upsert_cli` / `remove_cli` / `reset` / `export` | agent 覆盖层：读取生效值与来源，运行时改搜索顺序、来源优先 / 停用、置信度、平台后端顺序、自定义 CLI；改动即时生效，用户可在设置面板采纳或撤销（见[agent 覆盖层与 `config.*`](./config.md#agent-覆盖层与-config)） |

每个动作的参数与输出 schema 是封闭的（未声明字段不会出现，除必需字段外都是可选字段）。

## 旧工具到新动作

旧的 `web_*` 工具名**已不存在**，也没有兼容包装；模型调用旧名会得到新动作名与翻译后的参数。映射表在 `src/actions/legacy.ts`，测试逐项验证每个旧参数仍可达。

| 旧工具（参数） | 新动作 |
|---|---|
| `web_search_pro` | `search.run`（`query`、`task`、`profile`、`needs`、`constraints`、`budget`、`engines`、`count`、`fresh`、`multi`、Exa 选项原样保留） |
| `web_platform_search` | `search.run`，传 `platform`（另有 `url`、`authProfile`、`rulePack`；现在也支持 `fresh`） |
| `web_fetch_pro` | `read.fetch` |
| `web_exa_contents` | `read.contents` |
| `web_snapshot` | `read.snapshot` |
| `web_history`（过滤） | `history.list` |
| `web_history replay=<id>` | `history.replay {id}` |
| `web_history action=expand evidenceId=<id>` | `history.expand {evidenceId}` |
| `web_history export=true` | `history.export`（同样的过滤参数） |
| `web_cache_clear`（`olderThanDays` / `engine`） | `cache.clear` |
| `web_cache_clear queryId=<id>` | `history.delete {id}` |
| `web_rule action=list\|upsert\|remove\|import\|export` | `rules.list` / `rules.upsert` / `rules.remove` / `rules.import` / `rules.export` |
| `web_search_stats` | `cache.stats` |
| `web_backend_status`（默认） | `sources.status` |
| `web_backend_status action=recommend` | `search.recommend` |
| `web_deps`（默认 / `action=check`） | `sources.deps` |
| `web_deps action=install` | `sources.install` |

迁移说明：

- 没有 dsh-browser 的会话里，`web_*` 旧名的调用会报“工具不存在”（宿主层错误，插件无法拦截）；新会话的模型通过系统提示、skill 或 `web_index()` 找到新名字。
- 用户在宿主里对旧工具名设置的“总是允许”规则不再生效；`web_index` 无副作用，`web_call` 的审批由本插件按**动作**判断（见下）。
- `web_history` 的 `replay` / `export` / `action=expand` 不再与列表过滤混在一次调用里，每个动作只做一件事。
- 输出路径变化：`search.recommend` 直接返回推荐本身（不再包在 `recommend` 字段里）；`sources.install` 返回 `install` 结果（不再带空的 `backends`）。

## 审批、并发与超时（按动作）

- **审批**：`sources.install`（安装外部命令）、`cache.clear`、`history.delete`、`rules.upsert` / `rules.remove` / `rules.import`（改本地存储）会请用户确认；`config.upsert_cli`（让插件能运行一个本地程序）**一律先问用户**，提示里写明命令、搜索与探测的参数模板和读取的环境变量名；其余 `config.*` 写入不询问（`dsh-browser.automationMode=read-only` 时全部拒绝）；其余动作直通。原先这些规则按工具名写在 dsh-browser 的 `tools/pre-execute` 钩子里，而 `web_call` 对它是不透明的，所以规则现在由本插件解析 `web_call` 的动作后施加，并在 dsh-browser 存在时读取它的 `automationMode`：`read-only` 拒绝；安装在 `unrestricted` 直通；本地写入在 `standard` 询问、`autonomous` / `unrestricted` 直通；`config.upsert_cli` 除 `read-only`（拒绝）外**任何模式都询问**。**headless 没有人可问时，宿主对“询问”一律拒绝**（`dsh-tools` 的 `serviceAsk`：没有 `approval` 服务时按插件给的理由拒绝，有服务但没有应答者时返回 `unavailable` 同样拒绝，会话策略为 `never` 时直接拒绝），所以 headless 的 agent 加不了 CLI，只能改顺序、置信度等不询问的项。**没有 dsh-browser 时模式未知，按 `standard` 处理（询问）**——这比旧行为（无 dsh-browser 时完全不审批）更严格。
- **并发**：`web_call` 的并发安全性由参数里的动作决定：只读动作可并行，修改状态的动作独占（`sources.install` 现在也独占，旧的 `web_deps` 因为一个标志同时覆盖 check 与 install 而全部可并行）。
- **超时**：每个动作保持旧工具的上限（搜索与快照 `timeoutMs` + 60 秒，读取与 Exa 正文 + 30 秒，依赖检测/安装 + 180 秒，历史与状态等 10–20 秒）；`web_call` 的宿主上限取其中最长者，各动作自己的截止时间到期后返回 `DEADLINE`（修改状态的动作会说明结果未知）。调用方的取消信号会传给执行器。

## 工具面形态

`toolSurface: indexed | flat`（设置文件顶层，启动时生效，默认 `indexed`）。`flat` 把同一份动作注册表投影成每个动作一个工具，名字为 `web_<组>_<动作>`（如 `web_search_run`、`web_read_fetch`），**只用于对照与调试**，不是旧工具的兼容层，常驻体积回到全部注入的量级。两种形态共用同一个分发函数，信封、错误码与审批完全一致。

## 输出预算（所有出口）

每个把正文交给模型的出口都有默认上限；超出部分留在本地存储，按 ID 或偏移续读，不会因为 UI 折叠而仍把全文送进上下文。

| 出口 | 默认预算 | 配置项 | 超出时 |
|---|---|---|---|
| `search.run`（证据包） | 摘录总计 6000 字符，每 URL 至多 2~4 块 | 参数 `budget`（至多 30000） | 溢出的需求列在 `gaps`；`history.expand` 传 `evidenceId` 读回摘录所在块及前后块 |
| `read.fetch` | 20000 字符 | `fetchDefaultChars`（1000–500000）；参数 `maxChars` | 输出 `truncated`、`nextOffset`、`totalChars`，并提示 “more: call read.fetch with offset=N”；`offset` 从已存的页面快照续读，命中缓存时不重新抓取 |
| `read.contents` | 每 URL 8000、全部 URL 合计 30000 字符；总量不足时较短的文本原样保留、剩余额度均分给较长的 | `exaContentsPerUrlChars`、`exaContentsTotalChars` | 每条结果带 `truncated`、`totalChars`，并给出 `read.fetch offset` 的续读提示 |
| ctx.web 抓取 Provider（内置 `web_fetch`） | `fetchDefaultChars` 的两倍（默认 40000）；`WebFetchRequest` 没有大小参数 | `fetchDefaultChars` | `truncated` 如实反映是否被截断，正文末尾追加 `[Continue with web_call read.fetch url=… offset=N]` |
| ctx.web 搜索 Provider（内置 `web_search`，`provider.evidence: auto`） | 证据包同上（默认摘录 6000 字符）；来源条数取宿主给的 `maxResults`（1–20） | `provider.evidence`、`provider.deadlineMs` | 期限到点返回 `PARTIAL` 的已有证据包；失败退回普通来源列表；`truncated` 仅在确有来源被截掉时为真 |
| `read.snapshot` 文本、`history.replay` 的页面文本 | `fetchDefaultChars` | `fetchDefaultChars` | 文末带截断标记；全文仍在存储里，用 `read.fetch url=… offset=N` 读取 |
| `search.run`（普通列表与平台搜索） | 每条摘要 500 字符，条数由 `count` 限制 | `searchMaxResults` | 摘要截断 |

抓取时页面至少读取并存储 100000 字符（更大的 `offset + maxChars` 会读更多，上限 500000），所以续读来自 SQLite 快照；超过已存部分的 `offset` 会自动用更大的上限重新读取。
