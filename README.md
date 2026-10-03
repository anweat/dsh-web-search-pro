# dsh-web-search-pro

增强型、可持久化的扩展网页搜索插件 for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（DSH）。

一个 DSH **bundle 插件**，把多引擎网页搜索、平台搜索、持久化缓存、受控按站增强和 Playwright 渲染打包成模型可调用的能力。常驻上下文只有 `web_index` / `web_call` 两个工具（原 11 个 `web_*` 工具已并入 20 个动作，见[工具面](#工具面索引--调用)）。路由控制面借鉴 Agent-Reach 的后端探测、顺序选择和失败冷却思路，核心逻辑为本项目原生 TypeScript 实现。

## 兼容与发布通道

| 插件发布通道 | DSH 基线 | 兼容承诺 |
|---|---|---|
| `0.1.11` 及更早的维护版本 | `dsh-v0.1.1-rc.2` | 旧基线；不与新插件混装 |
| `0.1.15` | `dsh-v0.1.7-rc.2` + Browser `0.1.15` | 精确锁定该宿主版本；组合安装、真实 Web profile 与设置持久化已验证 |
| `0.1.17` | `dsh-v0.1.7-rc.2` ~ `dsh-v0.2.0-rc.2` + Browser `0.1.17` | peer 收口为「实测过的两条线」（上界 `<0.2.1-0`）；在 `0.2.0-rc.2` 上完成 typecheck、构建、85 项测试与 headless 真实调用验证；新增 peer 双解析模式检查 |

`0.1.17` 把 DSH 运行时依赖从精确锁定改为范围声明（`^0.1.7-rc.2 || >=0.2.0-rc.1 <0.2.1-0`），
因此同一份包可装在 `0.1.7-rc.2` 与 `0.2.0-rc.2` 两代宿主上（两代之间的 `defineTool`、凭据引用、
配置表单与客户端槽位接口在本插件用到的范围内保持兼容）；客户端配置仍走 `configForms` 和插件 bundle 的专属配置槽位。
范围只声明**实测过的两条线**，既不写成 `>=0.1.7-rc.2 <0.3.0`，也不写成一路放行到 0.3.0 的 `^0.2.0-rc.1`：

- 宿主的组装期校验用的是 `semver.satisfies(host, range, { includePrerelease: true })`，所以「单范围能不能过宿主」不是关键。
  真正决定装机成败的是 npm/pnpm 的**默认** semver：预发布版本只有在某个比较符自带同号（同 major.minor.patch）预发布时才被判为满足。
  于是 `>=0.1.7-rc.2 <0.2.1-0` 这种写法过得了宿主校验，却会让 `dsh plugin add` 报 ERESOLVE（上界 tuple 是 0.2.1，接不住 0.2.0-rc.2）；
  而 `>=0.2.0-rc.1` 这个比较符是**承重**的，必须保留。与 `@anweat/dsh-browser` 必须声明同一套 0.2.x 策略，
  否则两者互为 peer 时会出现 ERESOLVE。
- `0.1.5 → 0.1.7` 曾一次性打断所有按 `0.1.5-alpha.1` 构建的插件。所以 `^0.2.0-rc.1`（等于说整个 0.2.x 都兼容）
  是对没测过版本的承诺；收口到 `<0.2.1-0` 后，若 0.2.1 真出现破坏，会在**组装期**直接报
  `is incompatible with dsh 0.2.1` 并点名，而不是拖到用户机器上变成运行期怪错。
- 范围只表示「测过哪些」，不等于承诺不破坏；真正的防线是每换一个 DSH 版本重跑一遍这套验证。
  `pnpm run test:peers`（已并入 `pnpm verify`）用两种解析模式逐个断言受管 peer，并自带 `--selftest` 已知行为自校验。

## 安装

```bash
dsh plugin --profile web add @anweat/dsh-browser@0.1.17 dsh-web-search-pro@0.1.17
# 或本地目录 / tarball：
dsh plugin --profile web add ../dsh-browser ./dsh-web-search-pro
# 重启（web profile 关闭了 HMR）：
dsh --profile web
```

> 两个插件都必须是 profile 的直接依赖：DSH 只激活直接依赖的 bundle layer，且标准 profile 可能设置 `autoInstallPeers: false`。不要只安装 Web Search Pro 后依赖 peer 自动补齐。
> pnpm 11 若拦截 Browser 的 OpenCLI 依赖安装脚本，会要求在 profile 的 `pnpm-workspace.yaml` 中明确决定 `allowBuilds: { '@jackwener/opencli': false }`（或在确实需要安装期下载 adapter 时自行审核后设为 `true`），再重试安装；隔离 profile 中禁用脚本后，已发布 Browser 的 OpenCLI 入口仍可运行。
> 本版支持 `dsh-v0.1.7-rc.2` ~ `dsh-v0.2.0-rc.2` 与 Browser `0.1.17`，不能混用仍声明旧 DSH peer 的 Browser `0.1.15-alpha.2`。若你的 harness 是本地源码 checkout，版本号可能有出入——用
> `dsh plugin --profile web add ./<path>` 并在 profile 的 `pnpm-workspace.yaml`
> 里对齐版本后重装即可。

## 从旧版本升级

升级 Web Search Pro 时应同时升级浏览器插件；两者都需要作为 profile 的直接依赖。

```bash
dsh plugin --profile web add @anweat/dsh-browser@0.1.17 dsh-web-search-pro@0.1.17
```

> **破坏性变更（工具面）**：旧的 `web_search_pro`、`web_fetch_pro` 等 11 个工具名不再注册，也没有兼容包装。旧会话里对它们的调用会失败；把调用改成对应动作即可，对照表见[旧工具到新动作](#旧工具到新动作)。模型在 `web_call` 里写旧工具名会得到新动作名和翻译后的参数，`web_index()` 根目录也列出同一张对照。已存储的数据（历史、页面、规则、证据、账本）与 `ctx.web` provider 不受影响。

升级完成后需要**完整停止并重新启动 Web profile**；仅刷新网页不会重新扫描插件的 `client.js`。随后依次检查：

1. `browser_call({action:"runtime.status"})`：确认 OpenCLI、`playwright | patchright` 运行时、`automationMode` 与 `usagePolicy` 符合预期。
2. `web_call({action:"sources.status"})`：确认搜索、CLI、Agent Reach 与浏览器后端是否 ready。
3. 打开 `插件 → 已安装` 中两个 bundle 各自的详情页，确认配置表单都已加载；浏览器表单负责自由度、运行时、OpenCLI 与调用缓冲。

> `automationMode` 和防止过度调用的 `usagePolicy` 都属于 dsh-browser，升级不会自动改写现有配置。生产 profile 建议保留 `standard`；`unrestricted` 只用于隔离的自动化测试 profile，并且仍受并发、突发、页数/深度和 429/503 退避保护。

若 Clash/TUN 使用 fake-IP DNS，原生 HTTP 后端可能看到 `198.18.0.0/15`、`fdfe:dcba:9876::/64` 或 `2001:2::/48`（报错信息会直接提示 `resolved to proxy fake-IP …`）。可在可视化面板的高级设置中启用 `allowProxyFakeIp`；默认关闭。该开关只信任这些代理网段的 **DNS 解析结果**，字面 fake-IP URL、localhost 和其他私网地址仍会被 SSRF 防护拒绝。

## 快速使用与适用情形

安装并重启后，直接在 DSH 会话里要求模型调用工具即可：

```text
请先用 web_call 的 sources.status 检查后端，然后用 search.run 搜索
"DeepSeek Harness community feedback"，指定 exa、fresh=true、返回 8 条来源。
```

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

### 平台来源

每个平台（GitHub、GitHub 代码 / Issues、B站、YouTube、V2EX、arXiv、PubMed、小红书、Twitter / X、Reddit、Instagram、Facebook、RSS、知乎、微博、豆瓣、贴吧、抖音、快手，以及你的 `customPlatforms`）都是来源注册表里 `kind: platform` 的 provider：有描述符（语言、任务类型、站点域名、所需浏览器能力 / 登录 / CLI / Token）和适配器，与网页引擎走同一条路径（探测、冷却、并发合并、`shapeSources`、重试说明、历史）。Twitter 是**一个** provider，内部按原顺序依次尝试 OpenCLI 与 twitter-cli。`sources.status` 在同一张列表里按维度报告它们的就绪状态（浏览器安装、已绑定登录、设置开关）；目录条目用 `provider` 指向同名 id。

- `search.run platform=zhihu query=…` 只搜这个平台，历史类型仍为 `platform`；`engines=zhihu` 在经典搜索里同样可用。`url`（RSS）、`authProfile`、`rulePack` 随 `platform` 传，`browserBindings` 补全后两者。
- **证据模式**：`platform` 可与 `task` / `profile` / `needs` / `constraints` 同用——该平台成为 S1 / S2 的显式来源，之后门限、读取前几页（有 Browser 时自动升级）、评分、证据包照常。
- **平台不可用**（缺浏览器 / 登录 / CLI / Token、被设置关闭、冷却中）时返回 `CAPABILITY_UNAVAILABLE`，写明缺什么，并附目录里的安装说明；**不会**悄悄改搜网页引擎。传 `allowFallback=true` 才改搜该 profile 的网页引擎，证据包的 `notes` 会写明。平台已运行但没有结果时返回空列表和平台自己的提示（多半是缺登录），不冷却。
- **自动规划**：平台从不被自动选入第一轮；只有任务带硬 `site` 约束且命中某平台域名（如 `zhihu.com`）并且该平台就绪时，它才排第一，并保留一个网页引擎做回退（同一上游家族只取一个，其余留给第二轮）。平台没就绪就沿用网页计划并在 `notes` 说明。`search.recommend` 对 `experience` 类任务可以推荐已就绪的平台（仍至多 3 个）。
- **自定义平台**随设置热更新：新增、修改、删除都会同步注册表；与已有 provider 同名的键不会覆盖内置来源，`sources.status` 的 `notes` 会列出被拒绝的键。

先运行 `sources.status` 判断后端是否 ready（要不要用哪个来源，直接问 `search.recommend`）。指定单一引擎时失败会原样返回；不指定时才会按 `engines` 顺序自动回退。所有引擎都返回空结果或不可用（没有运行时错误）时，`search.run` 返回空结果和说明，不再报错。

### 两种用法

同一套证据管线有两个入口。模型是否走哪一个，取决于它看到哪些工具；第二种能在模型“顺手用内置 `web_search`”时仍然让证据管线生效。

**（a）直接调用 `web_call search.run`。** 模型加载 skill `dsh-web-search-pro`（或按常驻提示）调用 `search.run`，传 `task` / `profile` 得到证据包（见下节）。常驻提示和 skill 描述都写明：做网页研究时优先用它，而不是 `web_search` + `web_fetch`，因为它只返回过滤后的证据，占用的上下文少得多；读页用 `read.fetch`（长页用 `offset` 续读）。

**（b）让宿主内置的 `web_search` / `web_fetch` 经过本插件。** 宿主自带这两个工具，模型常常直接用它们（实测 DeepSeek 在自然任务里就是这样，绕过了 `web_index`）。把本插件注册并**选中**为 `ctx.web` 的 provider 后：

- `web_search` 的返回内容 = 本插件的证据包（与 `search.run` 同一渲染：`resultId`、缺口 `Gaps`、“覆盖是启发式的”提示，末尾一行说明可用 `web_call history.expand` / `read.fetch` 展开），`sources` 仍是来源列表；`truncated` 只在确有来源被截掉时为真。查询即任务（`task = query`，`needs = [query]`，profile 按规则推断，推断不出为 `general`，预算为默认值）。
- 证据运行有自己的期限（`provider.deadlineMs`，默认 25 秒；到点返回 `PARTIAL` 的已有结果）。超时、管线报错都**退回今天的普通来源列表**，不会让内置工具失败；只有调用方取消会原样抛出。为避免递归，这条路径不会再调用 `ctx.web` 引擎（`seam`）。
- `web_fetch` 沿用同一套抓取管线，上限是 `fetchDefaultChars` 的两倍；被截断时 `truncated` 为真，并在正文末尾追加一行 `[Continue with web_call read.fetch url=… offset=N]`。
- `provider.evidence: off` 让 `web_search` 回到只返回来源列表（与旧行为完全一致）。

**怎么选中（宿主的规则，不是本插件的）。** `@deepseek-ai/dsh-web` 只在两种情况下使用某个 provider：`web` 条目里**写明了它的 id**（`searchProvider` / `fetchProvider`，环境变量 `DSH_WEB_SEARCH_PROVIDER` / `DSH_WEB_FETCH_PROVIDER` 与它们是同一个字段，不是另一条优先级链），或它是**唯一可用**的已注册 provider。没写 id 又有两个可用 provider 时，每次 `web_search` 都会以 `WEB_PROVIDER_AMBIGUOUS` 失败。所以 `registerProvider` 默认是 `false`：只注册、不选中是无害的，但默认注册会在没有写 id 的部署里让内置工具直接报错，本插件不会悄悄接管宿主默认 provider。

1. `settings.yaml` 的 `web-search-pro:` 段打开注册（启动时生效，改完重启）：

   ```yaml
   web-search-pro:
     registerProvider: true
     providerId: web-search-pro # 默认值；与下面的 id 必须一致
     provider:
       evidence: auto # auto（默认）| off
       deadlineMs: 25000
   ```

2. 在 profile 的 `cordis.patch.yml`（`$DSH_HOME/profiles/<profile>/cordis.patch.yml`）里把 `web` 条目指向它：

   ```yaml
   - id: web
     name: '@deepseek-ai/dsh-web'
     config:
       searchProvider: web-search-pro
       fetchProvider: web-search-pro # 只想换搜索、保留宿主抓取时，写宿主抓取 provider 的 id（宿主源码里内置的是 `http`，以所用宿主版本为准），不要省略
   ```

   或者只在启动环境里设 `DSH_WEB_SEARCH_PROVIDER=web-search-pro`（需要时再加 `DSH_WEB_FETCH_PROVIDER`）。配置里的值与环境变量同时存在时以配置为准。**不要只注册而不写 `fetchProvider`**：本插件会同时注册搜索与抓取两个 provider，若宿主的 `web` 条目没有固定抓取 provider，宿主自带的 `http` 与本插件的会同时可用，`web_fetch` 会报 `WEB_PROVIDER_AMBIGUOUS`。

3. 重启后用 `web_call sources.status` 检查：`ctx.web route` 一行会写明是否已注册、`web_search` / `web_fetch` 当前是否选中本插件、宿主固定的是哪个 id（未选中时还给出上面的配置提示）。宿主不暴露 provider 状态查询接口，所以本插件读的是 `web` 运行时已合并好的 id（读不到时只看环境变量，并在状态行里注明）。

**和其他“联网调研”skill 并存。** 用户自己安装的 skill（例如 `agent-reach`）也可能在描述里声称负责联网调研；本插件的 skill 描述只陈述自己做什么（中英文触发词：联网搜索 / 查证 / 调研 / 读取网页，web research / look up / verify / read a page），不声称对其他 skill 的优先权，也无法阻止模型选别的 skill。（b）正是为这种情形准备的：不管模型加载了哪个 skill，只要它最终调用内置 `web_search` / `web_fetch`，走的就是本插件的证据管线。

### 证据包模式（`search.run` 传 `task` 或 `profile`）

传 `task`（一句话目标）或 `profile`（`docs_code` / `news_fact` / `academic` / `experience` / `compare` / `general`）时，`search.run` 不返回结果列表，而是按 profile 选择来源（docs_code：ddg/bing/github；academic：arxiv/pubmed/ddg；experience：ddg/bing/v2ex；news_fact：ddg/bing；compare：ddg/bing/github；general：配置的 `engines`；显式 `engines` 优先），读取前 4 个保留候选的页面，分块并按每个需求评分，在字符预算（默认 6000，`budget` 可调）内挑出摘录，并列出未被满足的需求（`gaps`）。可选参数：`needs`（`;` 分隔或 JSON 数组）、`constraints`（JSON 数组 `{kind,value,strength}`；`strength` 缺省为 soft，`hard` 只在确定违反时才丢弃候选）。输出新增 `resultId`、`evidence`、`coveredNeeds`、`gaps`、`partial` 等可选字段，原有 `sources` 仍在；超过总时限（`timeoutMs` + 30 秒）时返回 `partial: true` 的已有结果。`history.expand` 传 `evidenceId` 可读回摘录所在块及其前后块（至多 4000 字符）。不传 `task` / `profile` 时行为和输出与以前完全相同。

**相关度门（S4）**：需求与候选标题/摘要语言不同（如中文需求对英文结果）时，门限判断改用跨语言对齐（需求、query、目标与实体/必含词里的拉丁词一并参与匹配），同语言保持原有的词法规则；若门限之后保留的候选少于 3 个而更多候选存在，则按融合排序补回最靠前的、未违反硬约束的候选，标为“低相关”（`sources[].lowConfidence` / `evidence[].lowConfidence`，渲染为 `(low relevance)`，`stats.lowConfidence` 计数，并在 `notes` 说明），不会因为相关度启发式而返回空包。

**有界第二轮（S8）**：第一轮之后若有关键需求（`critical`）没有被满足（`gaps` 里原因不是 `budget`），且轮数、查询数、时间都还有余量，管线最多再补搜一轮：以“需求文本 + 任务里的关键实体（entity / must_term / version 约束与 query 里的标识符）”为查询，按各 provider 编译（站点约束等照常下推），优先用第一轮没用过的 provider，其次复用已回答的；只读取新候选里最好的至多 2 页，只对缺口需求评分，再与第一轮结果合并（按 URL 去重）重新挑选。单任务查询总数（一次 provider 调用算一次，GitHub 的放宽重试合并算一次；允许第二轮时第一轮至多用 `maxQueries-1` 个 provider，留一次给第二轮，显式 `engines` 不裁剪）不超过 `evidence.maxQueries`（默认 4），轮数不超过 `evidence.maxRounds`（默认 2，设 1 即关闭）；剩余时间不足 15 秒或预算已用完时跳过并在 `notes` 说明。证据包 `stats.rounds` / `stats.queries` 给出实际轮数与查询数。

块评分默认用本地词法规则。可选的博查 Jev 评分（付费，需环境变量或凭据引用 `BOCHA_JEV_API_KEY`）由 `evidence` 配置控制：`jevMode: off`（默认，不调用）、`shadow`（规则决定，Jev 评分只记录到存储 `evidence_runs.pack_json` 供对照）、`control`（且 `scorer: jev` 时由 Jev 决定；任何 Jev 失败都回退到规则并在 `notes` 里说明）、`hybrid`（规则评分全部块，Jev 只重评需求语言与块语言不一致的 (需求, 块) 对；`hybridBorderline: true` 时再加规则评分为 1 的边界对；Jev 失败保留规则评分；与 `scorer` 无关）；`maxJevQuestions`（默认 64）限制每次搜索发送的 (需求, 块) 问题数。规则评分本身对中文需求与英文块做了跨语言对齐（query / 需求 / 约束里的英文词和标识符并入匹配词），默认即生效。发给 Jev 的只有一句话目标、需求文字和页面块文本。

#### Jev 提示词（rubric）：可配置、有版本 / Judge prompts: configurable and versioned

**中文**　发给 Jev 的问题措辞、评分等级和长度上限是带版本的 rubric（内置 `score.support`，另有 `gate.relevance`、`gate.constraint` 备用）。默认值与离线评测（`bench/rubrics/*.v1.json`）逐字相同。要调整，在设置文件 `evidence.rubrics` 里按 rubric id 写覆盖项，无需改代码：

```yaml
evidence:
  jevMode: hybrid
  rubrics:
    score.support:
      version: v2                     # 必填；内容有改动就必须换新版本号（不能是 v1）
      instructions: |                 # 只能用 {task} {need} {candidate}；必须含 {need} 和 {candidate}（≤2000 字符）
        文本块本身是否直接陈述了需求所问的答案，而不只是提到该主题？
        需求：{need}
        文本块：{candidate}
      criteria: [无关, 只提到主题, 部分回答, 直接回答且含证据]   # 2–10 级，从低到高；不是 4 级时分数按比例换算到 0..3
      maxStateChars: 200              # 20–2000，任务描述上限
      maxCandidateChars: 1200         # 100–8000，每个文本块上限
```

- **校验与回退**：含未知变量、缺必需变量、等级数不在 2–10、长度越界、未换版本等，整条覆盖被忽略，改用内置版本；原因出现在 `sources.status` 的 `evidence.diagnostics` 和证据包的 `notes`（仅启用 Jev 时）。
- **版本规则**：改了措辞、等级或长度就换新 `version`（如 v2、v3）。每次 Jev 评分都记录 `id@version#内容哈希`：证据包 `stats.jev.rubric`、shadow 日志（`evidence_runs.pack_json` 的 `shadow.rubric`）、证据行（`evidence_blocks.rubric`）；离线评测的缓存键同样包含 id、版本和全文，所以改提示词不会复用旧分数。
- **查看**：`sources.status` 的 `evidence.rubrics` 列出每个 rubric 当前生效的版本、是否被覆盖。
- **恢复默认**：删除对应的 `evidence.rubrics.<id>` 条目即可（设置页暂不提供该项的编辑界面，只读设置文件）。
- **先离线对照再上线**：`node --experimental-transform-types bench/src/eval-pack.ts --rubric-file bench/rubrics/variants/score.support.v2-example.json`，在同一份冻结数据上评估候选版本；不带 `--allow-jev N` 时不会发出任何请求（用法见 `bench/src/eval-pack.ts` 文件头注释）。
- **不让线上模型改提示词**：rubric 只能由人通过设置文件修改；插件和任何线上模型都不会自动改写或上线新版本。

**English**　The question wording, grade levels and length caps sent to Jev are versioned rubrics (built in: `score.support`, plus `gate.relevance` and `gate.constraint` for future use). Defaults are byte-identical to the offline-evaluated wording. Override one under `evidence.rubrics.<id>` in settings.yaml with its own `version`, optional `instructions` (variables `{task} {need} {candidate}` only; `{need}` and `{candidate}` required), `criteria` (2-10 levels, lowest first; other than 4 levels are rescaled to 0..3), `maxStateChars`, `maxCandidateChars`. An invalid override (unknown variable, bad level count, out-of-range length, changed content under the old version label) is ignored and the built-in is used; the reason shows in `sources.status` (`evidence.diagnostics`) and the pack `notes`. Bump `version` whenever the content changes. Every Jev result records `id@version#hash` (pack `stats.jev.rubric`, shadow log, `evidence_blocks.rubric`), and the offline judge-cache keys include id, version and full text, so a changed prompt never reuses old scores. Restore defaults by deleting the `evidence.rubrics.<id>` entry (there is no settings-page editor for it yet). Compare a candidate offline first with `bench/src/eval-pack.ts --rubric-file`. Online models must never rewrite or roll out rubrics by themselves: they change only through the settings file.

#### 评分模型 provider 与用量上限 / Judge providers and usage caps

**中文**　S6 的模型评分分成「协议 × provider」两层，换模型只改配置：

- **协议**：`systemone`（Jev 兼容的 `POST /v1/systemone`：博查 Jev、其他 Jev 部署、本地 Laya sidecar）；`rerank`（Jina / Cohere 风格的 `{model, query, documents, top_n}` → `results[{index, relevance_score}]`，也适用于暴露同形状接口的本地 bge / Qwen reranker）；`llm`（OpenAI 兼容 chat completions，温度 0、严格 JSON 校验，仅供参考/实验，默认关闭，需 `evidence.judge.allowLlm: true`）。`systemone` 与 `llm` 用 `score.support` rubric；`rerank` 以需求文本作 query。
- **内置 provider**：`bocha-jev`（默认；`https://jev.bocha.cn`，`bocha-jev-v1`，密钥 `BOCHA_JEV_API_KEY`，请求与旧版逐字节相同）、`typesafe-jev`（占位预设，须自行填 `baseUrl` / `model`，**未验证**）、`laya-local`（`http://127.0.0.1:8765`，无密钥；实验 r1 里在当前提示词下接近随机，用前必须自己校准）、`jina-rerank`、`cohere-rerank`（**未验证**，从未对真实服务调用过）。
- **自定义 provider**（`jevMode` / `judge.mode` 决定怎么用；`judge.mode` 是 `jevMode` 的中性写法，两者都设时前者优先，且 `control` 不再需要 `scorer: jev`）：

```yaml
evidence:
  judge:
    mode: hybrid                 # off | shadow | control | hybrid
    provider: my-reranker        # 默认 bocha-jev
    providers:
      my-reranker:
        protocol: rerank
        baseUrl: http://127.0.0.1:8080/v1   # 非本机必须 https；路径可用 path 覆盖（默认 /rerank）
        model: bge-reranker-v2-m3
        keyRef: MY_RERANK_KEY    # 可选：凭据引用或环境变量名，永远不写密钥本身
        limits: { maxDocumentsPerRequest: 50, blockChars: 1000 }
        calibration:             # rerank 必填，见下
          version: v1
          points: [[0.1, 0], [0.4, 1], [0.7, 2], [0.9, 3]]
      bocha-jev:                 # 与预设同名 = 覆盖预设的个别字段
        limits: { maxQuestionsPerRequest: 16 }
  budget:
    perSearchInputTokens: 60000  # 默认
    dailyInputTokens: 1000000    # 默认
    timezone: Asia/Shanghai      # 日界线时区，默认系统时区
    providers: { laya-local: { dailyInputTokens: 200000 } }   # 按 provider 覆盖，取更严格者
```

- **校准是硬要求**：reranker 的相关度分数不是等级，不同模型/语言差异很大。`calibration.points` 是 `[原始分, 等级0..3]` 的单调分段线性映射（原始分严格递增、等级不降；区间外取端点），版本号和内容哈希随结果记录；没有校准的 rerank provider 不会被使用（规则评分继续，并在 `notes` 说明）。不同 provider 的分数从不混用，离线缓存也按 provider+模型分开（rerank 缓存的是原始分，换校准无需重新请求）。`systemone` 也可选填 `calibration`（Laya 建议）。先用 `shadow` 观察，再考虑 `hybrid` / `control`。
- **用量账本与上限**：每次模型调用前按保守估算预留 token、调用后按服务返回的 `usage` 结算（服务不返回则按估算记账并标 `estimated`；价格未声明时金额为空，不是 0；`price` 可选声明）。预留是原子的（SQLite `usage_ledger` 表，跨搜索、跨进程，重启不清零，未结算的预留继续占用额度）。超过单次搜索或当日上限时跳过模型阶段、回退规则评分，`notes` 出现 “model budget exceeded”。`sources.status` 的 `evidence.provider` / `evidence.usage` 显示当前 provider 是否可用、今日用量与上限。注意默认单次上限 60000 输入 token 小于 `maxJevQuestions: 64` 全量发送的估算量，较大的 hybrid 搜索可能提前停在上限处。
- **离线评测**：`bench/src/eval-pack.ts --provider <id> [--providers-file providers.json]`、`bench/src/run-judges.ts --provider <id>`；文件格式同 `evidence.judge.providers`。

**English**　S6 model scoring is split into protocol x provider; switching models is configuration. Protocols: `systemone` (Jev-compatible API: Bocha Jev, other Jev deployments, the local Laya sidecar), `rerank` (Jina/Cohere-style query-documents API, also local bge/Qwen servers) and an opt-in `llm` (OpenAI-compatible chat, temperature 0, strict JSON; off unless `evidence.judge.allowLlm`). Presets: `bocha-jev` (default, requests byte-identical to before), `typesafe-jev` (placeholder, unverified), `laya-local` (no key; near random with the current prompts, calibrate first), `jina-rerank` / `cohere-rerank` (unverified, never called live). Add your own under `evidence.judge.providers` (same-id entries override a preset's fields); `evidence.judge.mode` is the neutral name of `jevMode`. A reranker's relevance score is not a grade: `calibration.points` (monotone piecewise-linear `[raw, grade 0..3]`) is mandatory, versioned and recorded with results; provider scores are never mixed and caches are per provider+model. Every model call is reserved before and settled after in a persisted ledger (actual tokens from the API, otherwise a flagged estimate; unknown price = null, never 0), under `evidence.budget` caps (default 60k input tokens per search, 1M per day, per-provider overrides, day boundary in `timezone`). Over a cap the model stage is skipped and rule grades are used ("model budget exceeded"). `sources.status` shows the provider and today's usage. Offline: `eval-pack.ts` / `run-judges.ts --provider <id>`.

## 工具面（索引 → 调用）

常驻上下文只有两个工具，常驻文本（系统提示 + 工具名、描述、参数）约 800 字符（原 11 个工具约 9300 字符）：

| 工具 | 作用 |
|---|---|
| `web_index({group?, action?, query?})` | 渐进披露目录：无参数列出能力组、两个最常用调用、旧名对照；`group` 列出该组动作；`action` 给出完整参数；`query` 按关键词检索（至多 8 条） |
| `web_call({action, args})` | 执行一个动作，返回统一信封 `{ok, action, result \| error{code,message,hint,schema?}, truncation?}`；参数校验失败（`INVALID_ARGS`）时附带该动作的精简 schema，一次即可改对；未知动作会给出相近动作名 |

使用指引放在随包提供的 skill `dsh-web-search-pro`（证据模式优先、先读 `gaps` 再下结论、`search.recommend` 只用 1–2 个来源、`read.fetch` 的 `offset` 续读、约束、预算、浏览器交接；参考文件含来源与 Key 配置、评分 provider 与 rubric、排障）。skill 通过可选的 `ctx.skills` 注册，**不写入必需的 `inject`**；宿主没有 skill 服务时，`web_index()` 根目录附一段精简指南兜底。系统提示只保留一行入口（有 dsh-browser 时再加一行指向 skill `dsh-browser` / `browser_index`）。

### 动作

| 组 | 动作 | 作用 |
|---|---|---|
| `search` | `run` | 多引擎搜索 + RRF 融合 + 内存/SQLite 双层缓存 + 历史；传 `task` / `profile` 得证据包；传 `platform` 搜单个平台（GitHub/B站/YouTube/V2EX/小红书/Twitter/Reddit/IG/FB/RSS + 知乎/微博/豆瓣/贴吧/抖音/快手，登录态走 Playwright；RSS 用 `url` 传 feed、`query` 可选过滤；平台与网页引擎走同一条注册表执行路径，可与 `task`/`profile` 同用得到证据包，见“平台来源”） |
| | `recommend` | 按任务推荐至多 3 个来源（已就绪优先，其余给出缺失条件），不发搜索请求 |
| `read` | `fetch` | 可读化抓取（Jina → HTTP+规则抽取 → Playwright 兜底）+ 快照缓存与 `offset` 续读；`auto` 按质量升级：每次结果先判为 content / shell / js_shell / login_wall / captcha / error，只有 shell、js_shell、login_wall 且 dsh-browser 就绪时才升级到 Playwright（captcha 与错误页不会，短而有实质内容的事实页不算空壳），取质量最好的一次并在 `attempts` 里记录各后端结果；不会自动安装任何东西；显式 mode 不升级，只复用同后端缓存 |
| | `contents` | 原生 Exa `/contents` 批量正文抓取（1-100 URL，需 Exa Key） |
| | `snapshot` | Playwright HTML + 文本落盘；`screenshot=false` 时不生成 PNG（需要 dsh-browser） |
| `history` | `list` / `replay` / `expand` / `export` / `delete` | 持久历史：过滤列出 / 按 id 回放 / 读回证据摘录及前后块 / 导出 JSON / 删除一条查询 |
| `sources` | `status` | 无副作用后端探测、失败/冷却诊断与 CLI 状态（Twitter 项同时检查 `twitter` 命令、设置开关和凭据环境变量，`note` 说明缺什么） |
| | `deps` / `install` | 检测 / 安装搜索后端的外部依赖（bili/yt-dlp/twitter/agent-reach/mcporter；每项探测的是后端真正执行的命令）；浏览器依赖由 dsh-browser 管理 |
| `rules` | `list` / `upsert` / `remove` / `import` / `export` | 持久化按站提取规则（脚本猫式）；export 会写出可再导入的版本化 JSON rule pack |
| `cache` | `clear` / `stats` | 按时间/引擎清缓存 / 存储统计 |

每个动作的参数与输出 schema 是封闭的（未声明字段不会出现，除必需字段外都是可选字段）。

### 旧工具到新动作

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

### 审批、并发与超时（按动作）

- **审批**：`sources.install`（安装外部命令）、`cache.clear`、`history.delete`、`rules.upsert` / `rules.remove` / `rules.import`（改本地存储）会请用户确认；其余动作直通。原先这些规则按工具名写在 dsh-browser 的 `tools/pre-execute` 钩子里，而 `web_call` 对它是不透明的，所以规则现在由本插件解析 `web_call` 的动作后施加，并在 dsh-browser 存在时读取它的 `automationMode`：`read-only` 拒绝；安装在 `unrestricted` 直通；本地写入在 `standard` 询问、`autonomous` / `unrestricted` 直通。**没有 dsh-browser 时模式未知，按 `standard` 处理（询问）**——这比旧行为（无 dsh-browser 时完全不审批）更严格。
- **并发**：`web_call` 的并发安全性由参数里的动作决定：只读动作可并行，修改状态的动作独占（`sources.install` 现在也独占，旧的 `web_deps` 因为一个标志同时覆盖 check 与 install 而全部可并行）。
- **超时**：每个动作保持旧工具的上限（搜索与快照 `timeoutMs` + 60 秒，读取与 Exa 正文 + 30 秒，依赖检测/安装 + 180 秒，历史与状态等 10–20 秒）；`web_call` 的宿主上限取其中最长者，各动作自己的截止时间到期后返回 `DEADLINE`（修改状态的动作会说明结果未知）。调用方的取消信号会传给执行器。

### 工具面形态

`toolSurface: indexed | flat`（设置文件顶层，启动时生效，默认 `indexed`）。`flat` 把同一份动作注册表投影成每个动作一个工具，名字为 `web_<组>_<动作>`（如 `web_search_run`、`web_read_fetch`），**只用于对照与调试**，不是旧工具的兼容层，常驻体积回到全部注入的量级。两种形态共用同一个分发函数，信封、错误码与审批完全一致。

### 输出预算（所有出口）

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

## 浏览器脚本与自动化分层

`dsh-browser >= 0.1.8` 提供三类脚本入口：

1. **内置只读脚本**：`article-clean`、`links`、`jsonld`、`forms`，适合稳定抽取；先用 `script.catalog`（`browser_call`）查看。
2. **Recipe**：最多 25 步的结构化 Playwright 操作，支持 wait/click/fill/type/press/select/check/hover/scroll/extract/assert/screenshot；交互步骤由自动化模式决定审批。
3. **外部 UserScript**：适合外部模型生成站点专项逻辑。先 `script.validate` 查看 SHA-256、域名范围与能力提示，再 `script.run_userscript`（均经 `browser_call`）；它在页面主世界运行，并非安全沙箱。

工具自由度由 dsh-browser 的 `automationMode` 控制：`read-only` 隐藏或拒绝页面及 Web Search Pro 写操作；`standard`（默认）对交互、写 Recipe、外部脚本、OpenCLI、缓存/规则变更和安装操作审批；`autonomous` 直通页面交互、写 Recipe 以及本地缓存/规则变更，但安装、外部脚本和通用 OpenCLI 仍审批；`unrestricted` 为隔离测试 profile 提供无审批运行。所有模式仍保留域名、参数、大小和步骤上限校验，并始终应用 dsh-browser 的调用缓冲、退避与爬取预算。

OpenCLI 用于已有站点 adapter 或复用 Chrome 登录会话。推荐顺序是 **`opencli.catalog` 查精确 adapter → network/extract → DOM 操作**；先运行 `opencli.status`。`opencli.run` 接受 argv 数组而非 shell 字符串，可覆盖 adapter、显式 session 的 `browser state/find/get/click/fill/type/select/keys/wait/extract/network` 等命令；仅 `unrestricted` 跳过审批。

更完整的 AuthProfile、脚本元数据与 OpenCLI 示例见 [LOGIN.md](./LOGIN.md)。

## 配置

三层，越靠前越日常：

1. **DSH 可视化面板**：打开 `设置 → 插件 → 插件配置 → Web Search Pro`。面板按搜索策略、服务凭据、运行时后端和高级规则分组；修改先保留为本地草稿，点击“保存”后写入 `settings.yaml` 并热更新，支持放弃修改和逐字段恢复部署值。

   - Exa、Jina、GitHub 密钥通过 DSH Credentials 写入，面板只显示“已配置/未配置”，不会把明文密钥读回浏览器。
   - `platformRules`、`customPlatforms`、`browserBindings` 与 Playwright 设置使用 JSON 对象编辑器；格式或数值范围无效时会阻止保存。
   - 浏览器工具的审批自由度由 `dsh-browser.automationMode` 管辖，调用缓冲由 `dsh-browser.usagePolicy` 管辖；用 `browser_call` 的 `runtime.status` 查看当前状态。Web Search Pro 面板只管理搜索插件自己的后端开关，不会绕过浏览器插件的审批或资源策略。
   - `allowProxyFakeIp` 仅用于明确采用 Clash/TUN fake-IP DNS 的环境；普通网络保持关闭。
   - 更新带客户端面板的插件版本后需要重启 Web profile，让 DSH 客户端模块扫描器重新装载 `client.js`。

2. **`$DSH_HOME/settings.yaml` → `web-search-pro:` 段**（热重载，改完即生效）：

   ```yaml
   web-search-pro:
     toolSurface: indexed # indexed（默认，只常驻 web_index / web_call）| flat（每个动作一个工具，仅对照与调试；启动时生效）
     exaApiKeyEnv: EXA_API_KEY # 推荐：运行环境或凭据服务，不把密钥写入配置
     jinaApiKeyEnv: JINA_API_KEY
     bochaApiKeyEnv: BOCHA_SEARCH_API_KEY # 博查 Key 的凭据 / 环境变量名；缺省再试 BOCHA_JEV_API_KEY
     # keyedSources: # 付费来源（可选，见“付费 / 需 Key 的来源”）：tavily / brave / linkup / serper / metaso / zhipu / baidu-qianfan
     #   tavily: { apiKeyEnv: TAVILY_API_KEY }   # 或 apiKey（字面量，不推荐）/ baseUrl；没有 Key 的来源保持不可用
     engines: [ddg, bing, exa, seam, jina]
     parallelEngines: false
     # registerProvider: false # true = 把本插件注册为 ctx.web provider（还需在 web 条目里选中，见“两种用法”）
     # provider: { evidence: auto, deadlineMs: 25000 } # 内置 web_search 经本插件时是否返回证据包（auto | off）与其期限
     evidence: # 证据包模式的块评分；默认完全不调用 Jev
       scorer: rule # rule | jev
       jevMode: off # off | shadow | control | hybrid
       hybridBorderline: false # 仅 hybrid：同时重评规则边界对
       maxJevQuestions: 64
       maxRounds: 2 # 证据包补搜轮数上限；1 = 关闭第二轮
       maxQueries: 4 # 单任务搜索查询总数（含第一轮；一次 provider 调用算一次）
       autoProviders: true # 按任务语言提前就绪的来源（中文博查 / 英文 Exa）；false = 只用 profile 表
       # rubrics: ...   # 可选：覆盖 Jev 提示词，见下文“Jev 提示词（rubric）”
       # judge: ...     # 可选：选择/自定义模型 provider，见下文“评分模型 provider 与用量上限”
       # budget: ...    # 可选：模型输入 token 上限（单次搜索 / 每日），默认 60000 / 1000000
     ttlSeconds: 3600
     searchMaxResults: 8
     browserBindings:
       zhihu:
         authProfile: china-community
         rulePack: zhihu-enhanced
   ```

3. **cordis.yml `config:`**（部署级默认值，见 `cordis.patch.yml`）。
4. **环境变量 / 凭据**：`$EXA_API_KEY`、`$JINA_API_KEY`、`$BOCHA_SEARCH_API_KEY`（或 `$BOCHA_JEV_API_KEY`）（`exaApiKeyEnv`/`jinaApiKeyEnv`/`bochaApiKeyEnv` 引用）。设置面板暂未提供博查与 `keyedSources` 字段，用 settings.yaml / 凭据服务 / 环境变量配置。

## 外部依赖（按需）

多数后端需要系统额外安装的工具；插件提供 `sources.deps` / `sources.install` 动作检测与安装：

| 依赖 | 用途 | 安装 |
|---|---|---|
| bili-cli `0.6.2` | B站后端 | `uv tool install --force git+https://github.com/public-clis/bilibili-cli@489607468f967e0e11f3cdff6efc022d011e982a` |
| yt-dlp | YouTube 后端 | `uv tool install yt-dlp` / `pip install yt-dlp` |
| opencli | 小红书/Twitter/Reddit/IG/FB | 由 dsh-browser 内置；扩展未连接时用 `opencli doctor` 诊断 |
| twitter-cli（命令 `twitter`） | Twitter 平台的 CLI 回退（执行 `twitter search`，另需环境变量 `TWITTER_AUTH_TOKEN` 与 `TWITTER_CT0`） | `uv tool install twitter-cli` / `pipx install twitter-cli` / `pip install twitter-cli` |
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

## 平台与引擎

`seam`（ctx.web/DeepSeek 原生）· `exa` · `bocha`（博查，中文强项，需 Key）· `ddg` · `bing` · `jina` · `github`（REST 搜索 API，免 CLI；可选 `$GITHUB_TOKEN`/`githubToken` 提升限额并解锁代码搜索）· `bilibili` · `v2ex` · `youtube`。默认顺序 `ddg, bing, exa, seam, jina`（免费优先），失败自动回退；失败后短时冷却，`sources.status` 可查看原因；`multi` 并行融合。

Exa 优先使用原生 API 客户端：`search.run` 可传 `exaType`、域名包含/排除、发布时间范围和 category。若没有裸 API Key、但启用了 CLI 后端且 Exa MCP 已连接，搜索会自动通过 `mcporter` 完成；该兼容路径只支持 query + 结果数，高级筛选和 `web_exa_contents` 仍要求 `EXA_API_KEY`。不同选项、结果数、引擎顺序和单/多引擎模式使用不同缓存指纹。

### 博查（Bocha）与搜索 provider 注册器 / Bocha and the provider registry

**中文**　博查是第一个中文搜索增量（`POST {bochaBaseUrl}/v1/web-search`，Bearer Key，默认 `https://api.bochaai.com`；官方 MIT 参考实现 `bocha-ai/dsh-web-search-bocha` 用 `https://api.bocha.cn`，可用 `bochaBaseUrl` 切换）。引擎 id `bocha`，也可写 `builtin:bocha`。

- **配置**：Key 来自 `bochaApiKey`、凭据 / 环境变量 `BOCHA_SEARCH_API_KEY`（名称由 `bochaApiKeyEnv` 配置），找不到时回退 `BOCHA_JEV_API_KEY`（博查文档对同一账号的说明；用同一个 Key 也行）。用官方 provider 的 `BOCHA_API_KEY` 的话，把 `bochaApiKeyEnv: BOCHA_API_KEY` 即可。`bochaSummary`（默认 true）请求较长的页面摘要，更利于证据评分。
- **费用**：按请求计费（余额或套餐），插件只记录请求数（用量账本里的 `bocha-search`，token 不适用、金额未知，`sources.status` 显示当日请求数）。**账号没有搜索余额 / 套餐时服务返回 HTTP 403 “You do not have enough money or package quota”**：插件把它归为不可重试的 `ENGINE_QUOTA`（与 401 的 `ENGINE_AUTH` 一样不进冷却），先到博查控制台确认搜索额度。429 按 `Retry-After` 冷却。
- **原生过滤**（证据模式）：硬性 `site` / `exclude_site` → `include` / `exclude`，硬性 `time_window` → `freshness` 的 `起始..今天` 日期区间；其余约束（`exclude_term` 等）仍在本地校验，`verification.native / local` 如实报告。
- **验证状态**：成功响应结构取自官方参考实现与文档；唯一一次真实调用（2026-10-02，Jev Key）返回了上述 403，所以成功路径、`include` / `exclude` 与日期区间尚未在真实服务上验证，`sources.status` 标注 `[not verified live]`。

**注册器**：搜索来源是 `ProviderDescriptor`（稳定命名空间 id `builtin:ddg`、`aliases`（旧短 id `ddg`）、`operations`、`taskProfiles`、`languages`、`regions`、`resultKinds`、`sourceFamily`（未知留空，绝不假定独立）、`requirements`（Key 环境变量 / CLI）、`supportedFilters`、`costModel`）加运行时（`probeLocal()` 只做本地检查、不联网；`create(deps)` 返回 Engine）。工具参数 `engines`、配置 `engines`、历史与缓存都接受别名或完整 id，输出沿用短 id；未知 id 报错并列出可用项。重复 id / 别名冲突直接抛错，`register()` 返回注销函数（暂不做外部动态加载）。新增来源 = 一个 descriptor + adapter 文件，不改路由器和计划器。

**证据模式的来源规划（S1）按语言**：任务（goal + query）为中文时，已就绪且已配置 Key 的中文来源（博查）排在 profile 表之前；英文时优先 Exa（原生 API Key 才算，仅靠 mcporter 兜底的不提前）；`ddg` 等通用网页引擎退为一个后备（其余留给第二轮），GitHub / arXiv 等垂直来源不受影响。`academic` 保持 arxiv / pubmed。显式 `engines` 不受影响；`evidence.autoProviders: false` 关闭这一规则。`sources.status` 的 `providers` 列出每个来源的 installation / credential / health（`health` 只有真实调用成功才是 `ready`，仅通过本地探测为 `unknown`）。

**English**　Bocha (`bocha` / `builtin:bocha`) is a Chinese-strong key-based search source: `POST /v1/web-search`, Bearer key from `bochaApiKey` or `$BOCHA_SEARCH_API_KEY` (env name configurable via `bochaApiKeyEnv`), falling back to `$BOCHA_JEV_API_KEY` (same account). Billed per request; the plugin counts requests in the usage ledger (`bocha-search`, tokens n/a, price unknown). HTTP 401/403 are non-retryable (no cooldown; "no balance or package" is reported as quota), 429 cools down for `Retry-After`. Hard site / exclude_site / time_window are pushed down (`include` / `exclude` / `freshness` date range); everything else is verified locally and reported. The success path is not yet verified live (the only live call answered 403 no-quota). Search sources are registry entries (descriptor + adapter, namespaced ids with legacy aliases, duplicates throw, `register` returns an unregister function); evidence-mode S1 promotes a ready, keyed provider strong in the task language (Bocha for Chinese, Exa for English) ahead of the profile table, keeping one general web fallback.

### 匿名来源与来源目录 / Anonymous sources and the source catalog

**中文**　无需 Key 的官方开放接口（引擎 id 同名，也可写 `builtin:<id>`）：`wikipedia`（MediaWiki 搜索，按任务语言选 zh / en 版，事实与背景）· `hackernews`（Algolia，英文社区经验）· `stackexchange`（Stack Overflow，匿名每日配额 300 次 / IP，遵守 `backoff`）· `openalex`（学术；匿名额度较小，可选免费 `$OPENALEX_API_KEY` 提升约十倍，`openalexMailto` 写进 User-Agent）· `semanticscholar`（学术；匿名共享池常 429，可选 `$SEMANTIC_SCHOLAR_API_KEY`）· `anysearch`（匿名按 IP 限额，可选 `$ANYSEARCH_API_KEY`；匿名超额时服务的 402 响应会夹带自动生成的账号凭据，适配器**丢弃**它们，只报 `quota_exhausted` 并暂停一小时）· `searxng`（仅当设置 `searxngUrl` 指向你自己的实例且开启 JSON 格式时可用；该地址是你的配置，允许内网地址，不内置公共实例）。它们都走 SSRF 防护的 HTTP 通道（`allowProxyFakeIp` 同样适用），使用礼貌的 User-Agent，请求数记入用量账本（token 不适用）；硬 `time_window` 下推为各自的日期过滤。它们是垂直 / 补充来源，S1 不会把它们提到网页搜索之前：`academic` 为 arxiv / openalex / pubmed（semanticscholar、ddg 留给第二轮），`experience` 为 ddg / bing 加按任务语言排序的社区来源（英文任务 hackernews / stackexchange，中文 v2ex），Wikipedia 与 Stack Overflow 分别是 `news_fact` / `general` 与 `docs_code` 的第二轮补充。`semanticscholar` 的成功响应未能实测（两次匿名请求都是 429），`searxng` 从未对真实实例运行，`sources.status` 标为 `[not verified live]`。

**来源目录**：`catalog/sources.v1.json`（随包发布，纯数据，不执行任何东西）列出已知来源——API、CLI（bili、yt-dlp、twitter、OpenCLI 各站命令及“没有 search 命令”的反例、wx-search-cli、OmniReach）、MCP 与需要 Browser 的平台——每条带认证、安装 / 配置说明、许可证、成本、`sourceFamily`、核验状态与反例。`search.recommend`（可带 `task` / `profile` / `query` / `language` / `platform`）按任务至多给出 3 个来源：已就绪的在前，其次是缺什么、怎么装；目录里没有适配器的条目永远不可执行。常驻提示只加了一句“不要遍历全部来源”。设置：`searxngUrl`、`openalexMailto`（settings.yaml，设置面板暂无字段）。

**English**　Keyless official APIs: `wikipedia` (zh/en edition from the task language), `hackernews` (Algolia), `stackexchange` (anonymous quota 300/day/IP, `backoff` honoured), `openalex` (small keyless budget; optional free key; contact address in the User-Agent), `semanticscholar` (shared pool, often 429; optional key), `anysearch` (anonymous per-IP quota; a 402 may carry auto-generated credentials which the adapter discards, reporting only `quota_exhausted` and pausing for an hour) and `searxng` (only with your own `searxngUrl`, JSON format enabled; private addresses are allowed because the URL is your configuration). All use the SSRF-safe HTTP path (`allowProxyFakeIp` applies), a polite User-Agent and count requests in the usage ledger. They are vertical / supplementary: S1 never promotes them ahead of web search (academic: arxiv/openalex/pubmed; experience: language-ordered community sources; Wikipedia and Stack Overflow are second-round supplements). `catalog/sources.v1.json` is pure data about known sources (never executed); `search.recommend` returns at most 3 sources for a task, ready ones first, then what is missing and how to set it up; catalog-only entries are never executable.

### 付费 / 需 Key 的来源（预留接口）/ Keyed sources (reserved interfaces)

**中文**　七个需要 Key 的搜索 API 已有“描述符 + 适配器”，**配置 Key 之前不会执行**：没有 Key 时 `sources.status` 显示 `credential: missing`，`search.recommend` 把它们列为“缺什么 + 怎么配置”的建议（永远 `executable: false`）；配置后进入可执行候选。**全部未对真实服务调用过**（没有 Key），描述符标 `verification.live=false`、`sources.status` 显示 `[not verified live]`，响应样例（`test/fixtures/*-search.json`）都在文件头声明“由文档构造，非真实抓取”。Key 解析顺序：settings 的 `keyedSources.<id>.apiKey` → 凭据引用 → 环境变量；变量名可用 `keyedSources.<id>.apiKeyEnv` 改，`baseUrl` 可改端点。

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

**English**　Seven keyed search APIs ship as descriptor + adapter pairs that are inactive until a key is configured: without one `sources.status` shows `credential: missing` and `search.recommend` lists them as setup steps (never executable). None was ever called live (no keys), every descriptor says `verification.live=false`, and the sample responses under `test/fixtures` state they are constructed from the docs, not captured. Key order: `keyedSources.<id>.apiKey` -> credentials ref -> environment (name via `keyedSources.<id>.apiKeyEnv`, endpoint via `baseUrl`). Defaults: `TAVILY_API_KEY`, `BRAVE_API_KEY`, `LINKUP_API_KEY`, `SERPER_API_KEY`, `METASO_API_KEY`, `ZHIPU_API_KEY`, `QIANFAN_API_KEY` (then `BAIDU_API_KEY`). Only ranked results are used (Tavily `answer`, Linkup `sourcedAnswer`, Zhipu `search_intent`, Baidu chat answers and Serper answer boxes are ignored). Serper has no public API reference (contract from MIT reference code) and is `sourceFamily: google`, so it is not independent corroboration of other Google-based sources. Metaso's docs page is script-rendered (contract from two agreeing MIT references; webpage scope only). Baidu Qianfan's page contradicts itself on the auth header, so both documented headers carry the same bearer value until a live call settles it. Errors follow Bocha: 401 / 403 / 402 are non-retryable with no cooldown (credit / quota wording is `ENGINE_QUOTA`), 429 cools down for `Retry-After`, redirects are refused, errors never contain the key. Ready keyed sources are promoted for their language below Exa / Bocha (at most two per task, one per index family) so round 1 stays at three providers with a free engine left.

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

`history.list` 支持 kind/query/engine/platform 过滤（`kind=all` 等同省略 kind），`history.replay` 与 `history.export` 回放与导出 JSON。search/platform 回放保存的来源；fetch/snapshot 回放当次持久化的正文、HTML/截图路径。旧数据库会自动迁移 pages 表；历史上无法关联 queryId 的旧页面按 URL 做兼容回放。

## 自定义平台

在 settings.yaml 里定义任意站点（URL 模板 + 结果选择器），
`search.run` 传 `platform` 就能直接搜它——不需要改代码：

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
