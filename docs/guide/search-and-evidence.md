# 搜索用法与证据包

> 适用版本：dsh-web-search-pro 0.2.3 · [返回 README](../../README.md) · [文档索引](../README.md)

## 快速使用与适用情形

安装并重启后，直接在 DSH 会话里要求模型调用工具即可：

```text
请先用 web_call 的 sources.status 检查后端，然后用 search.run 搜索
"DeepSeek Harness community feedback"，指定 exa、fresh=true、返回 8 条来源。
```

**开箱默认值（不改任何设置）**：默认关闭 Jev（`evidence.jevMode: off`，证据评分用本地规则，不调用任何模型，也不需要任何模型 Key）；只有配置了博查 Key（`bochaApiKey` / `BOCHA_SEARCH_API_KEY` 或凭据引用）才会使用博查，没配置时博查不在引擎列表里，也不会被自动规划选中。默认引擎链依次是 `ddg`、`bing`、`exa`、`seam`、`jina`（Exa 可走无 Key 的 MCP 回退，ddg / bing 免 Key）。**例外：DeepSeek 搜索（“常用”，按请求计费）只要能解析到 DeepSeek API Key（设置里的密钥字段、DSH 凭据 `DEEPSEEK_API_KEY` 或进程环境变量），默认搜索和自动规划都把它放第一位**；不想用就在 `sources.disabled` 里写 `deepseek`，或自己写一份 `engines`（见[DeepSeek 搜索 / 抓取](./sources.md#deepseek-搜索--抓取常用)）。

模型通常不需要先翻目录：`web_index()` 根目录直接给出搜索与读取两个最常用调用，随包的 skill `dsh-web-search-pro` 带有证据模式的工作示例；没有 skill 服务时根目录附一段精简指南。

| 情形 | 推荐入口 | 说明 |
|---|---|---|
| 日常网页搜索 | `search.run` | 默认按配置顺序回退；需要强制刷新时传 `fresh=true` |
| 语义研究、社区观点 | `search.run` + `engines=exa` | 有 API Key 时走原生 Exa API；只有 Exa MCP 连接时自动经 `mcporter` 回退 |
| 已知 URL 的批量正文 | `read.contents` | 直接调用 Exa `/contents`，必须配置 `EXA_API_KEY` |
| GitHub/B站/Reddit 等平台 | `search.run` + `platform=…` | Reddit 等 OpenCLI 平台需要 Chrome 扩展在线；中文受限站点使用 AuthProfile |
| 登录后页面或私有论坛 | `browserBindings` + AuthProfile | Cookie 保存在本地 storageState，按域名授权，默认只读 |
| 页面改版、懒加载 | `platformRules` 或 RulePack | 优先改选择器；需要等待/点击/滚动时再使用有界 RulePack |
| 模型生成多步页面操作 | `browser_call` → `automation.run_recipe` | 只读步骤直接运行；页面交互按 dsh-browser 的 `automationMode` 决定拒绝/审批/直通 |
| 外部模型生成油猴脚本 | `script.validate` → `script.run_userscript` | 强制 `@match`、`@grant none`、禁用 `@require`；仅 `unrestricted` 跳过审批 |
| 有限泛爬取 | `crawl.crawl` | 匿名、默认同源；调用参数不能突破浏览器插件的页数/深度预算 |
| OpenCLI 站点适配器或浏览器桥 | `opencli.status` → `opencli.catalog` → `opencli.run` | 先发现精确 adapter；仅 `unrestricted` 跳过通用 argv 审批 |

## 平台来源

每个平台（GitHub、GitHub 代码 / Issues、B站、YouTube、V2EX、arXiv、PubMed、小红书、Twitter / X、Reddit、Instagram、Facebook、RSS、知乎、微博、豆瓣、贴吧、抖音、快手，以及你的 `customPlatforms`）都是来源注册表里 `kind: platform` 的 provider：有描述符（语言、任务类型、站点域名、所需浏览器能力 / 登录 / CLI / Token）和适配器，与网页引擎走同一条路径（探测、冷却、并发合并、`shapeSources`、重试说明、历史）。每个平台是**一个** provider，内部是一条有序的**后端链**（独立 CLI → 独立 OpenCLI → dsh-browser 的 OpenCLI（需要装有 OpenCLI）/ 搜索页），顺序可用 `platformBackends` 改，详见下面的 [CLI 适配](./cli-adapters.md)。`sources.status` 在同一张列表里按维度报告它们的就绪状态（浏览器安装、已绑定登录、设置开关）；目录条目用 `provider` 指向同名 id。

- `search.run platform=zhihu query=…` 只搜这个平台，历史类型仍为 `platform`；`engines=zhihu` 在经典搜索里同样可用。`url`（RSS）、`authProfile`、`rulePack` 随 `platform` 传，`browserBindings` 补全后两者。
- **证据模式**：`platform` 可与 `task` / `profile` / `needs` / `constraints` 同用——该平台成为 S1 / S2 的显式来源，之后门限、读取前几页（有 Browser 时自动升级）、评分、证据包照常。
- **平台不可用**（缺浏览器 / 登录 / CLI / Token、被设置关闭、冷却中）时返回 `CAPABILITY_UNAVAILABLE`，写明缺什么，并附目录里的安装说明；**不会**悄悄改搜网页引擎。传 `allowFallback=true` 才改搜该 profile 的网页引擎，证据包的 `notes` 会写明。平台已运行但没有结果时返回空列表和平台自己的提示（多半是缺登录），不冷却。
- **自动规划**：平台从不被自动选入第一轮；只有任务带硬 `site` 约束且命中某平台域名（如 `zhihu.com`）并且该平台就绪时，它才排第一，并保留一个网页引擎做回退（同一上游家族只取一个，其余留给第二轮）。平台没就绪就沿用网页计划并在 `notes` 说明。`search.recommend` 对 `experience` 类任务可以推荐已就绪的平台（仍至多 3 个）。
- **自定义平台**随设置热更新：新增、修改、删除都会同步注册表；与已有 provider 同名的键不会覆盖内置来源，`sources.status` 的 `notes` 会列出被拒绝的键。

先运行 `sources.status` 判断后端是否 ready（要不要用哪个来源，直接问 `search.recommend`）。指定单一引擎时失败会原样返回；不指定时才会按 `engines` 顺序自动回退。所有引擎都返回空结果或不可用（没有运行时错误）时，`search.run` 返回空结果和说明，不再报错。

## 证据包模式（`search.run` 传 `task` 或 `profile`）

传 `task`（一句话目标）或 `profile`（`docs_code` / `news_fact` / `academic` / `experience` / `compare` / `general`）时，`search.run` 不返回结果列表，而是按 profile 选择来源（docs_code：ddg/bing/github；academic：arxiv/pubmed/ddg；experience：ddg/bing/v2ex；news_fact：ddg/bing；compare：ddg/bing/github；general：配置的 `engines`；显式 `engines` 优先），读取前 4 个保留候选的页面，分块并按每个需求评分，在字符预算（默认 6000，`budget` 可调）内挑出摘录，并列出未被满足的需求（`gaps`）。可选参数：`needs`（`;` 分隔或 JSON 数组）、`constraints`（JSON 数组 `{kind,value,strength}`；`strength` 缺省为 soft，`hard` 只在确定违反时才丢弃候选）。输出新增 `resultId`、`evidence`、`coveredNeeds`、`gaps`、`partial` 等可选字段，原有 `sources` 仍在；超过总时限（`timeoutMs` + 30 秒）时返回 `partial: true` 的已有结果。`history.expand` 传 `evidenceId` 可读回摘录所在块及其前后块（至多 4000 字符）。不传 `task` / `profile` 时行为和输出与以前完全相同。

**相关度门（S4）**：需求与候选标题/摘要语言不同（如中文需求对英文结果）时，门限判断改用跨语言对齐（需求、query、目标与实体/必含词里的拉丁词一并参与匹配），同语言保持原有的词法规则；若门限之后保留的候选少于 3 个而更多候选存在，则按融合排序补回最靠前的、未违反硬约束的候选，标为“低相关”（`sources[].lowConfidence` / `evidence[].lowConfidence`，渲染为 `(low relevance)`，`stats.lowConfidence` 计数，并在 `notes` 说明），不会因为相关度启发式而返回空包。

**有界第二轮（S8）**：第一轮之后若有关键需求（`critical`）没有被满足（`gaps` 里原因不是 `budget`），且轮数、查询数、时间都还有余量，管线最多再补搜一轮：以“需求文本 + 任务里的关键实体（entity / must_term / version 约束与 query 里的标识符）”为查询，按各 provider 编译（站点约束等照常下推），优先用第一轮没用过的 provider，其次复用已回答的；只读取新候选里最好的至多 2 页，只对缺口需求评分，再与第一轮结果合并（按 URL 去重）重新挑选。单任务查询总数（一次 provider 调用算一次，GitHub 的放宽重试合并算一次；允许第二轮时第一轮至多用 `maxQueries-1` 个 provider，留一次给第二轮，显式 `engines` 不裁剪）不超过 `evidence.maxQueries`（默认 4），轮数不超过 `evidence.maxRounds`（默认 2，设 1 即关闭）；剩余时间不足 15 秒或预算已用完时跳过并在 `notes` 说明。证据包 `stats.rounds` / `stats.queries` 给出实际轮数与查询数。
