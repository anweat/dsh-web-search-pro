# 来源与引擎

> 适用版本：dsh-web-search-pro 0.2.3 · [返回 README](../../README.md) · [文档索引](../README.md)

## 引擎总览

`seam`（ctx.web/DeepSeek 原生）· `exa` · `bocha`（博查，中文强项，需 Key）· `ddg` · `bing` · `jina` · `github`（REST 搜索 API，免 CLI；可选 `$GITHUB_TOKEN`/`githubToken` 提升限额并解锁代码搜索）· `bilibili` · `v2ex` · `youtube`。默认顺序 `ddg, bing, exa, seam, jina`（免费优先），失败自动回退；失败后短时冷却，`sources.status` 可查看原因；`multi` 并行融合。

Exa 优先使用原生 API 客户端：`search.run` 可传 `exaType`、域名包含/排除、发布时间范围和 category。若没有 API Key、但启用了 CLI 后端且 `mcporter` 里配置了 Exa MCP（`https://mcp.exa.ai/mcp`，匿名、有限额），搜索会自动通过 `mcporter` 完成——**这是匿名路线（2026-10-04 实测：无 Key 的 `exa.web_search_exa` 调用成功，结果可被插件解析），证据模式的英文任务默认先用它**；该路线只支持 query + 结果数，高级筛选和 `read.contents` 仍要求 `EXA_API_KEY`。不同选项、结果数、引擎顺序和单/多引擎模式使用不同缓存指纹。

## 博查（Bocha）与搜索 provider 注册器

博查是第一个中文搜索增量（`POST {bochaBaseUrl}/v1/web-search`，Bearer Key，默认 `https://api.bocha.cn`（官方 MIT 参考实现 `bocha-ai/dsh-web-search-bocha` 用的地址，已实测）；`https://api.bochaai.com` 用同一个 Key 也返回同样的结构，可用 `bochaBaseUrl` 切换）。引擎 id `bocha`，也可写 `builtin:bocha`。

- **配置**：Key 来自 `bochaApiKey`、凭据 / 环境变量 `BOCHA_SEARCH_API_KEY`（名称由 `bochaApiKeyEnv` 配置），找不到时回退 `BOCHA_JEV_API_KEY`（博查文档对同一账号的说明；用同一个 Key 也行）。用官方 provider 的 `BOCHA_API_KEY` 的话，把 `bochaApiKeyEnv: BOCHA_API_KEY` 即可。`bochaSummary`（默认 true）请求较长的页面摘要，更利于证据评分。
- **费用**：按请求计费（余额或套餐），插件只记录请求数（用量账本里的 `bocha-search`，token 不适用、金额未知，`sources.status` 显示当日请求数）。**账号没有搜索余额 / 套餐时服务返回 HTTP 403 “You do not have enough money or package quota”**：插件把它归为不可重试的 `ENGINE_QUOTA`（与 401 的 `ENGINE_AUTH` 一样不进冷却），先到博查控制台确认搜索额度。429 按 `Retry-After` 冷却。
- **原生过滤**（证据模式）：硬性 `site` / `exclude_site` → `include` / `exclude`，硬性 `time_window` → `freshness` 的 `起始..今天` 日期区间；其余约束（`exclude_term` 等）仍在本地校验，`verification.native / local` 如实报告。
- **验证状态**：2026-10-04 用已开通额度的搜索 Key 实测 4 次请求（`api.bocha.cn` 3 次、`api.bochaai.com` 1 次）：成功响应的结构（`code` 为数字 200、`data.webPages.value[]`、`summary` 与约 100 字的 `snippet`）、`include` / `exclude`（含子域名）、`freshness` 日期区间都按预期生效，两个域名都接受该 Key。此前（2026-10-02，Jev Key）的 403 只说明当时账号没有搜索额度。脱敏样本：`test/fixtures/bocha-web-search.json`、`bocha-filters.json`。**博查是付费来源**：只在你配置了它的 Key 时才进入中文任务的第一轮；可选地用 `sources.budget.bocha` 限制请求数（例：账号有 1000 次请求，写 `total: 1000, daily: 50`）。

**注册器**：搜索来源是 `ProviderDescriptor`（稳定命名空间 id `builtin:ddg`、`aliases`（旧短 id `ddg`）、`operations`、`taskProfiles`、`languages`、`regions`、`resultKinds`、`sourceFamily`（未知留空，绝不假定独立）、`requirements`（Key 环境变量 / CLI）、`supportedFilters`、`costModel`）加运行时（`probeLocal()` 只做本地检查、不联网；`create(deps)` 返回 Engine）。工具参数 `engines`、配置 `engines`、历史与缓存都接受别名或完整 id，输出沿用短 id；未知 id 报错并列出可用项。重复 id / 别名冲突直接抛错，`register()` 返回注销函数（暂不做外部动态加载）。新增来源 = 一个 descriptor + adapter 文件，不改路由器和计划器。

**证据模式的来源规划（S1）按语言**：见下一节[来源策略](#来源策略)。简言之：什么都没配置时用匿名 / 免费来源（英文先 Exa 的无 Key 路线，再 `ddg`；中文 `ddg` + `bing`）；你配置了 Key 的来源按任务语言提前；`ddg` 等通用网页引擎退为一个后备（其余留给第二轮），GitHub / arXiv 等垂直来源不受影响。`academic` 保持 arxiv / openalex / pubmed。显式 `engines` 不受影响；`evidence.autoProviders: false` 关闭自动提前。`sources.status` 的 `providers` 列出每个来源的 installation / credential / health（`health` 只有真实调用成功才是 `ready`，仅通过本地探测为 `unknown`）。

## DeepSeek 搜索 / 抓取（常用）

[DeepSeek Search / Fetch API](https://api-docs.deepseek.com/guides/search/)（2026-10-17 上线）是本插件标为“**常用**”的来源：引擎 id `deepseek`，也可写 `builtin:deepseek`。`POST https://api.deepseek.com/v1/tools/search`，`Authorization: Bearer <DeepSeek API Key>`；抓取端点是同一个 base 的 `/fetch`。与宿主自带的 `deepseek-search-api` 不同，它不只映射 snippet 与日期（宿主那一路只带这两样）。

- **配置**：Key 与 DeepSeek 模型用的是同一个 `DEEPSEEK_API_KEY`，解析顺序和插件其他密钥一致：设置里的密钥字段（`keyedSources.deepseek.apiKey`，面板里的写入式输入会写进 DSH Credentials）→ DSH 凭据引用（默认名 `DEEPSEEK_API_KEY`，可用 `keyedSources.deepseek.apiKeyEnv` 改）→ 进程环境变量（“只写 shell 配置文件宿主读不到”）。值不进日志、状态输出、错误信息和历史。`keyedSources.deepseek.baseUrl` 可改接口（默认 `https://api.deepseek.com/v1/tools`）；请求的 `count` 跟调用走（证据模式每个来源要 10 条，与服务默认值一致），上限 50。
- **“常用”的含义**：解析到 Key 时，中文和英文任务的默认优先级都把它放第一位 —— 证据模式的自动规划里排在 Exa / 博查 / 其余需 Key 来源之前；没有指定 `engines` 的普通 `search.run` 也先用它（**仅当 `engines` 还是默认列表时**；你自己写过 `engines` 就按你写的，写进去的位置也尊重）。仍然服从你说的话：调用里的 `engines` / `platform` > `sources.priority` / `sources.disabled` > 这条默认规则；`evidence.sourcePolicy: anonymous-only` 不会自动使用它（它是付费来源）；`sources.budget.deepseek` 的请求额度照常生效（用完被跳过并回退）。没有 Key 时它不在默认链里，`sources.status` 的“常用 (common)”行写明去哪里配置；`search.recommend` 把它标为“常用”，已配置时排在其他已就绪的需 Key 来源之前。面板里它在“来源”分组、需 Key 的来源列表的第一项，带“常用”标记。
- **字段映射**：`summary`（给模型看的长摘要，约 600–800 字，实测有更长的；截到 1000 字符并去掉与标题重复的一级标题）→ 摘录文本（门限和评分看的就是它），没有 `summary` 时用 `snippet`；`date`（RFC 3339 或 null）→ `publishedAt`；`rerank_score`（0–3，综合相关性、权威性和时效）→ `rerankScore`，`authority`（0–4，-1 未知则不给）→ `authority`，作为**来源元数据**随结果输出（`[rerank 2.3/3, authority 4/4]`）。不请求 `content`（`need_content: false`）。
- **证据评分里的权重（保守）**：只用在候选融合（S3）这一步，和已有的新鲜度 / 权威域名加分同类 —— 加分 = `0.3 ×（0.7 × rerank/3 + 0.3 × authority/4）` 个“排名单位”（一个排名单位 = 同一来源里相邻两名的分差）。默认三项加分（新鲜度 0.2、域名权威 0.25、来源评分 0.3）全拿满也只有 0.75 个单位：能在两个来源把同几个 URL 排成并列时分出先后，**不能**把某来源的第 10 名抬到第 1 名之上；一个 URL 被多个来源返回时每个字段取最大值，不叠加。没有这些字段的来源（其余所有来源）一分不加。块级评分（S6）不使用它们。
- **查询**：服务只收 1–128 字符。硬约束 `site` / `exclude_site` / `exclude_term` / `time_window` 编成服务支持的 `site:a OR site:b`、`-site:`、`-词`、`after:YYYY-MM-DD` 写进查询；`ori_question` 用任务的 `goal`（没有就取第一个关键 need），截到 128 字符。超过 128 字符时保留全部运算符，截掉自由文本的尾部，并在结果说明里写明（普通搜索的 `fallbackNote`，证据包的 `notes`）。
- **费用**：Search 与 Fetch 各为每 1000 次**成功**请求 $0.75，空结果、失败和超时不计费，`count` 不影响价格。经 DeepSeek Harness / Claude Code / Codex 的服务端工具调用在 2026-11-01 00:00（北京时间）前免费；**文档没写插件直接调用是否在这个免费范围内，所以本插件按会计费处理**。账号级限流：Search 100 QPS，Fetch 25 QPS 另有按域名的限制。请求数记入用量账本（`deepseek-search` / `deepseek-fetch`，金额插件不知道），只记会计费的那种（有结果的 200）。
- **错误与重试**：408 / 429 / 5xx 按文档“等一会儿再试”：最多共 3 次，等待取 `Retry-After`，否则 0.8 秒、1.6 秒；`Retry-After` 超过 8 秒就不干等，直接失败并把它作为冷却时间。401 / 403 → `ENGINE_AUTH`；**402 → `ENGINE_QUOTA`，提示“余额不足”并让你去 platform.deepseek.com 充值**（不重试、不冷却）；其余 4xx 不重试。错误信息带 `request_id`（找 DeepSeek 支持用）。
- **抓取后端（默认关闭）**：设置 `deepseekFetch: true` 后，`read.fetch` 的 `mode: auto` 在 Jina 和直连都没拿到正文时，改用 Fetch API（Markdown），之后才轮到浏览器渲染；`mode: deepseek` 显式指定（关闭时会说明为什么不行，不会偷偷花钱）。它不报目标页面的状态码；**403（安全策略拒绝）/ 404（取不到可用内容）是 DeepSeek 自己的判断，不是目标页面的 HTTP 状态**，错误信息里这样写，`auto` 模式下记成一次失败的尝试（`attempts` 里 `deepseek: error`）。
- **验证状态**：2026-10-26 真实调用 8 次 Search + 4 次 Fetch（`docs/validation/dsh-web-search-pro-0.2.3.md`）：结果结构与全部字段、`site:` / `-site:` / `after:` 运算符、128 字符上限（超出 HTTP 400）、401 / 404 错误体、Fetch 的 Markdown。**没有亲眼验证的**：403 的 Fetch 拒绝（只在文档里）、402 余额不足、429 / 408 / 5xx 的重试路径（用模拟响应测试）、`localization`（没有发送）。

## 来源策略

插件主要依赖**免费 / 匿名额度**的来源；付费来源是预留接口，**不会因为存在 Key 之外的任何原因成为默认**。每个来源有成本层级（`search.recommend`、`sources.status` 与目录的 `costTier` 都显示）：

| 层级 | 含义 | 来源 |
|---|---|---|
| `anonymous` | 无需 Key、账号或付费（只有限流） | `ddg`、`bing`、`exa`（匿名 MCP 路线）、`wikipedia`、`hackernews`、`stackexchange`、`openalex`、`semanticscholar`、`anysearch`、`github`、`arxiv`、`pubmed`、`v2ex`、`rss`、`searxng`、`bilibili`、`youtube`、`seam`（成本由宿主决定） |
| `free-quota` | 需要 Key / 账号 / 登录，可免费使用（有文档可查的免费额度，或只需免费账号） | `tavily`（每月 1000 credits）、`brave`（每月 $5 额度，需绑卡验证身份）、`linkup`（专业邮箱注册送 $20，符合条件的账号每月补足）、`serper`（注册送 2500 次，一次性）、`jina`（每个新 Key 1000 万 token，一次性）、`baidu-qianfan`（每日 100 次）、`exa`（有 API Key 时每月 $10）、`github-code`（免费 Token）、各登录态平台 |
| `paid` | 需要 Key 并按次计费；官方页面未能确认免费额度 | `deepseek`（每 1000 次成功请求 $0.75，见上节）、`bocha`、`metaso`、`zhipu` |

免费额度的依据写在目录条目的 `cost` 里（带官方页面 URL，读于 2026-10-04）；确认不了的一律标 `paid`。Exa 有两条路线，按**实际会走的那条**报告层级：没有 Key 走匿名 MCP 路线（`anonymous`），配置了 Key 走 API（`free-quota`）。

**自动规划的优先顺序**（证据模式第一轮至多 3 个来源，同一 `sourceFamily` 只取一个）：

1. 调用里明确写的 `engines` / `platform`——永远最优先，不受下面任何设置影响。
2. 你的偏好 `sources.priority: [id, …]`：列出的、已就绪且适合任务 profile 和语言的来源按此顺序排最前；`sources.disabled: [id, …]` 的来源完全不用（自动规划和 `engines` 配置列表都不用）。
3. 你**配置了 Key** 的来源按任务语言 / profile 提前（最多 2 个，其余留给第二轮）：这是“排名跟着用户的需要走”——配了的可以排在前面，付费的也一样；其中“常用”的 `deepseek` 在中文和英文任务里都排最前（见上节）。
4. 什么都没配置时用匿名 / 免费默认：**英文先 Exa 的无 Key 路线**（需要 `mcporter` 且其中配置了 Exa MCP），再 `ddg`；**中文** `ddg` + `bing`（Exa 擅长英文，退到第二轮）；`academic` / `experience` / `docs_code` 的垂直来源不变。

`evidence.sourcePolicy: anonymous-only` 让自动规划**绝不**使用需要 Key、账号或登录的来源（即使配置了；`priority` 也不能把它们带回来；Exa 一旦有 API Key 走的就是付费 / 额度路线，也会被排除）。默认 `default`。

**置信度（可选）**：`sources.confidence.<id>: 0–1`，只在多来源融合时让它的权重略低并随结果标注，默认 1（内置）/ 规格里的值（自定义 CLI，默认 0.5）；公式与保证见 [CLI 适配](./cli-adapters.md#置信度01)一节的“置信度”。

**请求额度（可选）**：`sources.budget.<id>: { total?, daily? }`，**默认不设任何上限**——例如博查账号有 1000 次请求，可写 `sources: { budget: { bocha: { total: 1000, daily: 50 } } }`（这只是示例，不是插件默认值）。计数在用量账本里（持久化，重启后仍有效；发送前在立即事务里预留一次请求，两个搜索或两个进程不会同时花掉最后一次；适配器自己的计数会结算这次预留，所以一次请求只算一次；失败的请求归还预留，空结果算一次）。用完后该来源被**跳过并回退到其他来源**，记一条 “request budget used up” 的说明，**不是错误**；`web_call sources.status` 显示每个设了额度的来源的已用 / 剩余与策略一行。`daily` 的日界线取 `evidence.budget.timezone`。

## 匿名来源与来源目录

无需 Key 的官方开放接口（引擎 id 同名，也可写 `builtin:<id>`）：`wikipedia`（MediaWiki 搜索，按任务语言选 zh / en 版，事实与背景）· `hackernews`（Algolia，英文社区经验）· `stackexchange`（Stack Overflow，匿名每日配额 300 次 / IP，遵守 `backoff`）· `openalex`（学术；匿名额度较小，可选免费 `$OPENALEX_API_KEY` 提升约十倍，`openalexMailto` 写进 User-Agent）· `semanticscholar`（学术；匿名共享池常 429，可选 `$SEMANTIC_SCHOLAR_API_KEY`）· `anysearch`（匿名按 IP 限额，可选 `$ANYSEARCH_API_KEY`；匿名超额时服务的 402 响应会夹带自动生成的账号凭据，适配器**丢弃**它们，只报 `quota_exhausted` 并暂停一小时）· `searxng`（仅当设置 `searxngUrl` 指向你自己的实例且开启 JSON 格式时可用；该地址是你的配置，允许内网地址，不内置公共实例）。它们都走 SSRF 防护的 HTTP 通道（`allowProxyFakeIp` 同样适用），使用礼貌的 User-Agent，请求数记入用量账本（token 不适用）；硬 `time_window` 下推为各自的日期过滤。它们是垂直 / 补充来源，S1 不会把它们提到网页搜索之前：`academic` 为 arxiv / openalex / pubmed（semanticscholar、ddg 留给第二轮），`experience` 为 ddg / bing 加按任务语言排序的社区来源（英文任务 hackernews / stackexchange，中文 v2ex），Wikipedia 与 Stack Overflow 分别是 `news_fact` / `general` 与 `docs_code` 的第二轮补充。`semanticscholar` 的成功响应未能实测（两次匿名请求都是 429），`searxng` 从未对真实实例运行，`sources.status` 标为 `[not verified live]`。

**来源目录**：`catalog/sources.v1.json`（随包发布，纯数据，不执行任何东西）列出已知来源——API、CLI（bili、yt-dlp、twitter、OpenCLI 各站命令及“没有 search 命令”的反例、wx-search-cli、OmniReach）、MCP 与需要 Browser 的平台——每条带认证、安装 / 配置说明、许可证、成本、`sourceFamily`、核验状态与反例。`search.recommend`（可带 `task` / `profile` / `query` / `language` / `platform`）按任务至多给出 3 个来源：已就绪的在前，其次是缺什么、怎么装；目录里没有适配器的条目永远不可执行。常驻提示只加了一句“不要遍历全部来源”。设置：`searxngUrl`、`openalexMailto`（settings.yaml；设置面板“来源”分组里也有这两个字段）。

## 付费 / 需 Key 的来源（预留接口）

七个需要 Key 的搜索 API 已有“描述符 + 适配器”，**配置 Key 之前不会执行**：没有 Key 时 `sources.status` 显示 `credential: missing`，`search.recommend` 把它们列为“缺什么 + 怎么配置”的建议（永远 `executable: false`）；配置后进入可执行候选。**全部未对真实服务调用过**（没有 Key），描述符标 `verification.live=false`、`sources.status` 显示 `[not verified live]`，响应样例（`test/fixtures/*-search.json`）都在文件头声明“由文档构造，非真实抓取”。Key 解析顺序：settings 的 `keyedSources.<id>.apiKey` → 凭据引用 → 环境变量；变量名可用 `keyedSources.<id>.apiKeyEnv` 改，`baseUrl` 可改端点。

| 来源（id） | 语言 | 默认环境变量 | 官方文档 / 参考 | 原生过滤 | 说明与未采用 / 存疑字段 |
|---|---|---|---|---|---|
| Tavily（`tavily`） | en | `TAVILY_API_KEY` | docs.tavily.com 搜索 API 参考；MIT `crayonlu/dsh-web-search-tavily` | `include_domains`（≤300）/ `exclude_domains`（≤150）/ `start_date` | 不请求也不读 `answer`；432 / 433 为套餐上限（quota）；未用 `country` / `language` |
| Brave（`brave`，family `brave`） | en | `BRAVE_API_KEY` | api-dashboard.search.brave.com 文档与 API 参考、限速指南 | 查询里的 `site:` / `-site:` / `-term`；`freshness` 日期区间 | 查询按较小的文档值截断（400 字符 / 50 词，API 参考写 600 / 75）；错误体格式文档未给出；限速头 `X-RateLimit-*` 的第二个值为 0 = 月额度用尽 |
| Linkup（`linkup`） | en | `LINKUP_API_KEY` | docs.linkup.so `/search` 参考、错误页、限速页 | `includeDomains`（≤100）/ `excludeDomains` / `fromDate` | 只用 `outputType: searchResults`（排序后的 URL，从不用 `sourcedAnswer`）；429 同时表示额度不足和并发过高，按信息判断；402（x402 付款）一律不付款 |
| Serper（`serper`，family `google`） | en | `SERPER_API_KEY` | **无公开 API 参考**：取自 MIT 参考代码（LangChain `GoogleSerperAPIWrapper`、`searchsuite`） | 查询里的 Google 运算符 | 只读 `organic`；`gl` / `hl` / `tbs` 未发送（取值未经确认）；与其他 Google 系来源不算独立印证 |
| 秘塔（`metaso`） | zh | `METASO_API_KEY` | 官方页面是脚本渲染读不到；取自两个 MIT 参考（`TZHR-invest/dsh-plugins`、`HundunOnline/mcp-metaso`） | 无（全部本地核验） | 仅 `webpage` scope；`size` 取 ≤20（两个参考写 100 与 20）；reader 留待后续；不请求综合摘要 |
| 智谱（`zhipu`） | zh | `ZHIPU_API_KEY` | docs.bigmodel.cn 搜索指南、API 参考、错误码页 | `search_domain_filter`（单个域名）/ `search_recency_filter`（仅整日 / 周 / 月 / 年窗口算原生） | 只读 `search_result`（不是 GLM 生成回答）；查询 ≤70 字符；按文档的业务错误码映射（1113 / 1308–1310 quota，1302 / 1701 限速） |
| 百度千帆（`baidu-qianfan`，family `baidu`） | zh | `QIANFAN_API_KEY`，其次 `BAIDU_API_KEY` | ai.baidu.com AppBuilder「百度搜索」页；Qianfan v2 约定；MIT `searchsuite` | `search_filter.match.site`（≤20）/ `block_websites` / `range.page_time` | **官方页请求头自相矛盾**（表里同时列 `Authorization` 与 `X-Appbuilder-Authorization`，curl 只用后者）：两个头都发送同一个 Bearer 值，待真实调用确认；只读 `references`；查询按参考 SDK 截到 72 单位（汉字算 2） |

错误映射与博查一致：401 / 403 / 402 不可重试、不进冷却，信息含余额 / 额度 / credit 的归 `ENGINE_QUOTA`；429 按 `Retry-After`（Brave 用限速头）冷却；空结果 `ENGINE_EMPTY`；请求不跟随重定向（Key 不会被转发到别的域）；报错和日志不含 Key。请求数记入用量账本（provider 为来源 id，token 不适用、金额未知）。S1：就绪且有 Key 的英文来源在英文任务里、中文来源在中文任务里提前，优先级低于 Exa（10）与博查（10）（秘塔 20、智谱 30、千帆 40；Tavily 20、Brave 30、Linkup 40、Serper 60）；一次至多提前 2 个，同一 `sourceFamily` 只算一个，其余留给第二轮，所以第一轮仍至多 3 个来源且留一个免费引擎。
