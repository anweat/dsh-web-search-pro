# dsh-web-search-pro

增强型、可持久化的扩展网页搜索插件 for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（DSH）。

一个 DSH **bundle 插件**，把多引擎网页搜索、平台搜索、持久化缓存、受控按站增强和 Playwright 渲染打包成模型可直接调用的 11 个工具。路由控制面借鉴 Agent-Reach 的后端探测、顺序选择和失败冷却思路，核心逻辑为本项目原生 TypeScript 实现。

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

升级完成后需要**完整停止并重新启动 Web profile**；仅刷新网页不会重新扫描插件的 `client.js`。随后依次检查：

1. `browser_status`：确认 OpenCLI、`playwright | patchright` 运行时、`automationMode` 与 `usagePolicy` 符合预期。
2. `web_backend_status`：确认搜索、CLI、Agent Reach 与浏览器后端是否 ready。
3. 打开 `插件 → 已安装` 中两个 bundle 各自的详情页，确认配置表单都已加载；浏览器表单负责自由度、运行时、OpenCLI 与调用缓冲。

> `automationMode` 和防止过度调用的 `usagePolicy` 都属于 dsh-browser，升级不会自动改写现有配置。生产 profile 建议保留 `standard`；`unrestricted` 只用于隔离的自动化测试 profile，并且仍受并发、突发、页数/深度和 429/503 退避保护。

若 Clash/TUN 使用 fake-IP DNS，原生 HTTP 后端可能看到 `198.18.0.0/15`、`fdfe:dcba:9876::/64` 或 `2001:2::/48`（报错信息会直接提示 `resolved to proxy fake-IP …`）。可在可视化面板的高级设置中启用 `allowProxyFakeIp`；默认关闭。该开关只信任这些代理网段的 **DNS 解析结果**，字面 fake-IP URL、localhost 和其他私网地址仍会被 SSRF 防护拒绝。

## 快速使用与适用情形

安装并重启后，直接在 DSH 会话里要求模型调用工具即可：

```text
请调用 web_backend_status 检查后端，然后用 web_search_pro 搜索
"DeepSeek Harness community feedback"，指定 exa、fresh=true、返回 8 条来源。
```

| 情形 | 推荐入口 | 说明 |
|---|---|---|
| 日常网页搜索 | `web_search_pro` | 默认按配置顺序回退；需要强制刷新时传 `fresh=true` |
| 语义研究、社区观点 | `web_search_pro` + `exa` | 有 API Key 时走原生 Exa API；只有 Exa MCP 连接时自动经 `mcporter` 回退 |
| 已知 URL 的批量正文 | `web_exa_contents` | 直接调用 Exa `/contents`，必须配置 `EXA_API_KEY` |
| GitHub/B站/Reddit 等平台 | `web_platform_search` | Reddit 等 OpenCLI 平台需要 Chrome 扩展在线；中文受限站点使用 AuthProfile |
| 登录后页面或私有论坛 | `browserBindings` + AuthProfile | Cookie 保存在本地 storageState，按域名授权，默认只读 |
| 页面改版、懒加载 | `platformRules` 或 RulePack | 优先改选择器；需要等待/点击/滚动时再使用有界 RulePack |
| 模型生成多步页面操作 | `browser_recipe_run` | 只读步骤直接运行；页面交互按 dsh-browser 的 `automationMode` 决定拒绝/审批/直通 |
| 外部模型生成油猴脚本 | `browser_script_validate` → `browser_userscript_run` | 强制 `@match`、`@grant none`、禁用 `@require`；仅 `unrestricted` 跳过审批 |
| 有限泛爬取 | `browser_crawl` | 匿名、默认同源；调用参数不能突破浏览器插件的页数/深度预算 |
| OpenCLI 站点适配器或浏览器桥 | `browser_opencli_status` → `browser_opencli_catalog` → `browser_opencli_run` | 先发现精确 adapter；仅 `unrestricted` 跳过通用 argv 审批 |

先运行 `web_backend_status` 判断后端是否 ready。指定单一引擎时失败会原样返回；不指定时才会按 `engines` 顺序自动回退。所有引擎都返回空结果或不可用（没有运行时错误）时，`web_search_pro` 返回空结果和说明，不再报错。

### 证据包模式（`web_search_pro` 传 `task` 或 `profile`）

传 `task`（一句话目标）或 `profile`（`docs_code` / `news_fact` / `academic` / `experience` / `compare` / `general`）时，`web_search_pro` 不返回结果列表，而是按 profile 选择来源（docs_code：ddg/bing/github；academic：arxiv/pubmed/ddg；experience：ddg/bing/v2ex；news_fact：ddg/bing；compare：ddg/bing/github；general：配置的 `engines`；显式 `engines` 优先），读取前 4 个保留候选的页面，分块并按每个需求评分，在字符预算（默认 6000，`budget` 可调）内挑出摘录，并列出未被满足的需求（`gaps`）。可选参数：`needs`（`;` 分隔或 JSON 数组）、`constraints`（JSON 数组 `{kind,value,strength}`；`strength` 缺省为 soft，`hard` 只在确定违反时才丢弃候选）。输出新增 `resultId`、`evidence`、`coveredNeeds`、`gaps`、`partial` 等可选字段，原有 `sources` 仍在；超过总时限（`timeoutMs` + 30 秒）时返回 `partial: true` 的已有结果。`web_history` 传 `action=expand` 和 `evidenceId` 可读回摘录所在块及其前后块（至多 4000 字符）。不传 `task` / `profile` 时行为和输出与以前完全相同。

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

- **校验与回退**：含未知变量、缺必需变量、等级数不在 2–10、长度越界、未换版本等，整条覆盖被忽略，改用内置版本；原因出现在 `web_backend_status` 的 `evidence.diagnostics` 和证据包的 `notes`（仅启用 Jev 时）。
- **版本规则**：改了措辞、等级或长度就换新 `version`（如 v2、v3）。每次 Jev 评分都记录 `id@version#内容哈希`：证据包 `stats.jev.rubric`、shadow 日志（`evidence_runs.pack_json` 的 `shadow.rubric`）、证据行（`evidence_blocks.rubric`）；离线评测的缓存键同样包含 id、版本和全文，所以改提示词不会复用旧分数。
- **查看**：`web_backend_status` 的 `evidence.rubrics` 列出每个 rubric 当前生效的版本、是否被覆盖。
- **恢复默认**：删除对应的 `evidence.rubrics.<id>` 条目即可（设置页暂不提供该项的编辑界面，只读设置文件）。
- **先离线对照再上线**：`node --experimental-transform-types bench/src/eval-pack.ts --rubric-file bench/rubrics/variants/score.support.v2-example.json`，在同一份冻结数据上评估候选版本；不带 `--allow-jev N` 时不会发出任何请求（用法见 `bench/src/eval-pack.ts` 文件头注释）。
- **不让线上模型改提示词**：rubric 只能由人通过设置文件修改；插件和任何线上模型都不会自动改写或上线新版本。

**English**　The question wording, grade levels and length caps sent to Jev are versioned rubrics (built in: `score.support`, plus `gate.relevance` and `gate.constraint` for future use). Defaults are byte-identical to the offline-evaluated wording. Override one under `evidence.rubrics.<id>` in settings.yaml with its own `version`, optional `instructions` (variables `{task} {need} {candidate}` only; `{need}` and `{candidate}` required), `criteria` (2-10 levels, lowest first; other than 4 levels are rescaled to 0..3), `maxStateChars`, `maxCandidateChars`. An invalid override (unknown variable, bad level count, out-of-range length, changed content under the old version label) is ignored and the built-in is used; the reason shows in `web_backend_status` (`evidence.diagnostics`) and the pack `notes`. Bump `version` whenever the content changes. Every Jev result records `id@version#hash` (pack `stats.jev.rubric`, shadow log, `evidence_blocks.rubric`), and the offline judge-cache keys include id, version and full text, so a changed prompt never reuses old scores. Restore defaults by deleting the `evidence.rubrics.<id>` entry (there is no settings-page editor for it yet). Compare a candidate offline first with `bench/src/eval-pack.ts --rubric-file`. Online models must never rewrite or roll out rubrics by themselves: they change only through the settings file.

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
- **用量账本与上限**：每次模型调用前按保守估算预留 token、调用后按服务返回的 `usage` 结算（服务不返回则按估算记账并标 `estimated`；价格未声明时金额为空，不是 0；`price` 可选声明）。预留是原子的（SQLite `usage_ledger` 表，跨搜索、跨进程，重启不清零，未结算的预留继续占用额度）。超过单次搜索或当日上限时跳过模型阶段、回退规则评分，`notes` 出现 “model budget exceeded”。`web_backend_status` 的 `evidence.provider` / `evidence.usage` 显示当前 provider 是否可用、今日用量与上限。注意默认单次上限 60000 输入 token 小于 `maxJevQuestions: 64` 全量发送的估算量，较大的 hybrid 搜索可能提前停在上限处。
- **离线评测**：`bench/src/eval-pack.ts --provider <id> [--providers-file providers.json]`、`bench/src/run-judges.ts --provider <id>`；文件格式同 `evidence.judge.providers`。

**English**　S6 model scoring is split into protocol x provider; switching models is configuration. Protocols: `systemone` (Jev-compatible API: Bocha Jev, other Jev deployments, the local Laya sidecar), `rerank` (Jina/Cohere-style query-documents API, also local bge/Qwen servers) and an opt-in `llm` (OpenAI-compatible chat, temperature 0, strict JSON; off unless `evidence.judge.allowLlm`). Presets: `bocha-jev` (default, requests byte-identical to before), `typesafe-jev` (placeholder, unverified), `laya-local` (no key; near random with the current prompts, calibrate first), `jina-rerank` / `cohere-rerank` (unverified, never called live). Add your own under `evidence.judge.providers` (same-id entries override a preset's fields); `evidence.judge.mode` is the neutral name of `jevMode`. A reranker's relevance score is not a grade: `calibration.points` (monotone piecewise-linear `[raw, grade 0..3]`) is mandatory, versioned and recorded with results; provider scores are never mixed and caches are per provider+model. Every model call is reserved before and settled after in a persisted ledger (actual tokens from the API, otherwise a flagged estimate; unknown price = null, never 0), under `evidence.budget` caps (default 60k input tokens per search, 1M per day, per-provider overrides, day boundary in `timezone`). Over a cap the model stage is skipped and rule grades are used ("model budget exceeded"). `web_backend_status` shows the provider and today's usage. Offline: `eval-pack.ts` / `run-judges.ts --provider <id>`.

## 工具（11 个）

| 工具 | 作用 |
|---|---|
| `web_search_pro` | 多引擎搜索 + RRF 融合 + 内存/SQLite 双层缓存 + 历史 |
| `web_exa_contents` | 原生 Exa `/contents` 批量正文抓取（1-100 URL） |
| `web_fetch_pro` | 可读化抓取（Jina → HTTP+规则抽取 → Playwright 兜底）+ 快照缓存与 `offset` 续读；`auto` 按质量升级：每次结果先判为 content / shell / js_shell / login_wall / captcha / error，只有 shell、js_shell、login_wall 且 dsh-browser 就绪时才升级到 Playwright（captcha 与错误页不会，短而有实质内容的事实页不算空壳），取质量最好的一次并在 `attempts` 里记录各后端结果；不会自动安装任何东西；显式 mode 不升级，只复用同后端缓存 |
| `web_platform_search` | 20 平台：GitHub/B站/YouTube/V2EX/小红书/Twitter/Reddit/IG/FB/RSS + 知乎/微博/豆瓣/贴吧/抖音/快手（Playwright 登录态）；RSS 用 `url` 传 feed、`query` 可选过滤 |
| `web_snapshot` | Playwright HTML + 文本落盘；`screenshot=false` 时不生成 PNG |
| `web_history` / `web_cache_clear` / `web_search_stats` | 持久历史 / 清缓存 / 存储统计 |
| `web_rule` | 持久化按站提取规则（脚本猫式，list/upsert/remove/import/export）；export 会写出可再导入的版本化 JSON rule pack |
| `web_backend_status` | 无副作用后端探测、失败/冷却诊断与 CLI 状态（Twitter 项同时检查 `twitter` 命令、设置开关和凭据环境变量，`note` 说明缺什么） |
| `web_deps` | 检测/安装搜索后端的外部依赖（省略 action 默认 check；bili/yt-dlp/twitter/agent-reach/mcporter；每项探测的是后端真正执行的命令）；浏览器依赖由 dsh-browser 管理 |

### 输出预算（所有出口）

每个把正文交给模型的出口都有默认上限；超出部分留在本地存储，按 ID 或偏移续读，不会因为 UI 折叠而仍把全文送进上下文。

| 出口 | 默认预算 | 配置项 | 超出时 |
|---|---|---|---|
| `web_search_pro`（证据包） | 摘录总计 6000 字符，每 URL 至多 2~4 块 | 工具参数 `budget`（至多 30000） | 溢出的需求列在 `gaps`；`web_history action=expand evidenceId=…` 读回摘录所在块及前后块 |
| `web_fetch_pro` | 20000 字符 | `fetchDefaultChars`（1000–500000）；工具参数 `maxChars` | 输出 `truncated`、`nextOffset`、`totalChars`，并提示 “more: call web_fetch_pro with offset=N”；`offset` 从已存的页面快照续读，命中缓存时不重新抓取 |
| `web_exa_contents` | 每 URL 8000、全部 URL 合计 30000 字符；总量不足时较短的文本原样保留、剩余额度均分给较长的 | `exaContentsPerUrlChars`、`exaContentsTotalChars` | 每条结果带 `truncated`、`totalChars`，并给出 `web_fetch_pro offset` 的续读提示 |
| ctx.web 抓取 Provider（内置 `web_fetch`） | `fetchDefaultChars` 的两倍（默认 40000）；`WebFetchRequest` 没有大小参数 | `fetchDefaultChars` | `truncated` 如实反映是否被截断 |
| `web_snapshot` 文本、`web_history replay` 的页面文本 | `fetchDefaultChars` | `fetchDefaultChars` | 文末带截断标记；全文仍在存储里，用 `web_fetch_pro url=… offset=N` 读取 |
| `web_search_pro`（普通列表）、`web_platform_search` | 每条摘要 500 字符，条数由 `count` 限制 | `searchMaxResults` | 摘要截断 |

抓取时页面至少读取并存储 100000 字符（更大的 `offset + maxChars` 会读更多，上限 500000），所以续读来自 SQLite 快照；超过已存部分的 `offset` 会自动用更大的上限重新读取。

## 浏览器脚本与自动化分层

`dsh-browser >= 0.1.8` 提供三类脚本入口：

1. **内置只读脚本**：`article-clean`、`links`、`jsonld`、`forms`，适合稳定抽取；先用 `browser_script_catalog` 查看。
2. **Recipe**：最多 25 步的结构化 Playwright 操作，支持 wait/click/fill/type/press/select/check/hover/scroll/extract/assert/screenshot；交互步骤由自动化模式决定审批。
3. **外部 UserScript**：适合外部模型生成站点专项逻辑。先 `browser_script_validate` 查看 SHA-256、域名范围与能力提示，再 `browser_userscript_run`；它在页面主世界运行，并非安全沙箱。

工具自由度由 dsh-browser 的 `automationMode` 控制：`read-only` 隐藏或拒绝页面及 Web Search Pro 写操作；`standard`（默认）对交互、写 Recipe、外部脚本、OpenCLI、缓存/规则变更和安装操作审批；`autonomous` 直通页面交互、写 Recipe 以及本地缓存/规则变更，但安装、外部脚本和通用 OpenCLI 仍审批；`unrestricted` 为隔离测试 profile 提供无审批运行。所有模式仍保留域名、参数、大小和步骤上限校验，并始终应用 dsh-browser 的调用缓冲、退避与爬取预算。

OpenCLI 用于已有站点 adapter 或复用 Chrome 登录会话。推荐顺序是 **`browser_opencli_catalog` 查精确 adapter → network/extract → DOM 操作**；先运行 `browser_opencli_status`。`browser_opencli_run` 接受 argv 数组而非 shell 字符串，可覆盖 adapter、显式 session 的 `browser state/find/get/click/fill/type/select/keys/wait/extract/network` 等命令；仅 `unrestricted` 跳过审批。

更完整的 AuthProfile、脚本元数据与 OpenCLI 示例见 [LOGIN.md](./LOGIN.md)。

## 配置

三层，越靠前越日常：

1. **DSH 可视化面板**：打开 `设置 → 插件 → 插件配置 → Web Search Pro`。面板按搜索策略、服务凭据、运行时后端和高级规则分组；修改先保留为本地草稿，点击“保存”后写入 `settings.yaml` 并热更新，支持放弃修改和逐字段恢复部署值。

   - Exa、Jina、GitHub 密钥通过 DSH Credentials 写入，面板只显示“已配置/未配置”，不会把明文密钥读回浏览器。
   - `platformRules`、`customPlatforms`、`browserBindings` 与 Playwright 设置使用 JSON 对象编辑器；格式或数值范围无效时会阻止保存。
   - 浏览器工具的审批自由度由 `dsh-browser.automationMode` 管辖，调用缓冲由 `dsh-browser.usagePolicy` 管辖；用 `browser_status` 查看当前状态。Web Search Pro 面板只管理搜索插件自己的后端开关，不会绕过浏览器插件的审批或资源策略。
   - `allowProxyFakeIp` 仅用于明确采用 Clash/TUN fake-IP DNS 的环境；普通网络保持关闭。
   - 更新带客户端面板的插件版本后需要重启 Web profile，让 DSH 客户端模块扫描器重新装载 `client.js`。

2. **`$DSH_HOME/settings.yaml` → `web-search-pro:` 段**（热重载，改完即生效）：

   ```yaml
   web-search-pro:
     exaApiKeyEnv: EXA_API_KEY # 推荐：运行环境或凭据服务，不把密钥写入配置
     jinaApiKeyEnv: JINA_API_KEY
     engines: [ddg, bing, exa, seam, jina]
     parallelEngines: false
     evidence: # 证据包模式的块评分；默认完全不调用 Jev
       scorer: rule # rule | jev
       jevMode: off # off | shadow | control | hybrid
       hybridBorderline: false # 仅 hybrid：同时重评规则边界对
       maxJevQuestions: 64
       maxRounds: 2 # 证据包补搜轮数上限；1 = 关闭第二轮
       maxQueries: 4 # 单任务搜索查询总数（含第一轮；一次 provider 调用算一次）
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
4. **环境变量 / 凭据**：`$EXA_API_KEY`、`$JINA_API_KEY`（`exaApiKeyEnv`/`jinaApiKeyEnv` 引用）。

## 外部依赖（按需）

多数后端需要系统额外安装的工具；插件提供 `web_deps` 工具检测与安装：

| 依赖 | 用途 | 安装 |
|---|---|---|
| bili-cli `0.6.2` | B站后端 | `uv tool install --force git+https://github.com/public-clis/bilibili-cli@489607468f967e0e11f3cdff6efc022d011e982a` |
| yt-dlp | YouTube 后端 | `uv tool install yt-dlp` / `pip install yt-dlp` |
| opencli | 小红书/Twitter/Reddit/IG/FB | 由 dsh-browser 内置；扩展未连接时用 `opencli doctor` 诊断 |
| twitter-cli（命令 `twitter`） | Twitter 平台的 CLI 回退（执行 `twitter search`，另需环境变量 `TWITTER_AUTH_TOKEN` 与 `TWITTER_CT0`） | `uv tool install twitter-cli` / `pipx install twitter-cli` / `pip install twitter-cli` |
| agent-reach（可选） | 仅作安装助手，本插件不直接执行它；装了它**不代表** Twitter 搜索可用 | `uv tool install agent-reach` / `pip install agent-reach` |
| mcporter | 无裸 API Key 时的 Exa MCP 回退 | `npm i -g mcporter` |
| playwright / patchright | 渲染/截图后端 | 由 dsh-browser 内置；默认 Playwright，兼容场景可显式切 Patchright；缺 Chromium 时调用 `browser_install` |

> B站后端使用 `public-clis/bilibili-cli` 的 `bili` 命令；上述提交对应上游
> `v0.6.2`。不要安装 PyPI 上同名的 `bili-cli 0.1.1`，它是另一个项目且不提供
> `bili search` 契约。`web_deps` 会同时检查版本和 `--json` 搜索能力，避免只因
> PATH 中存在一个同名命令就误报可用。

> Windows 上这些 CLI 必须能被 `where` 解析（插件按 PATH 查找）：安装后若
> `web_deps action=check` 仍报缺失，把可执行文件所在目录加入 PATH，或直接把
> `bili.exe`/`yt-dlp.exe` 放进一个已在 PATH 的目录。用 `uv` 安装时可先重定向工具目录，
> 避免默认写入系统盘：`UV_TOOL_DIR`、`UV_TOOL_BIN_DIR`、`UV_PYTHON_INSTALL_DIR`。

## 平台与引擎

`seam`（ctx.web/DeepSeek 原生）· `exa` · `ddg` · `bing` · `jina` · `github`（REST 搜索 API，免 CLI；可选 `$GITHUB_TOKEN`/`githubToken` 提升限额并解锁代码搜索）· `bilibili` · `v2ex` · `youtube`。默认顺序 `ddg, bing, exa, seam, jina`（免费优先），失败自动回退；失败后短时冷却，`web_backend_status` 可查看原因；`multi` 并行融合。

Exa 优先使用原生 API 客户端：`web_search_pro` 可传 `exaType`、域名包含/排除、发布时间范围和 category。若没有裸 API Key、但启用了 CLI 后端且 Exa MCP 已连接，搜索会自动通过 `mcporter` 完成；该兼容路径只支持 query + 结果数，高级筛选和 `web_exa_contents` 仍要求 `EXA_API_KEY`。不同选项、结果数、引擎顺序和单/多引擎模式使用不同缓存指纹。

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

web_history 支持：kind/query/engine/platform 过滤（`kind=all` 等同省略 kind）、replay 和 JSON export。search/platform 回放保存的来源；fetch/snapshot 回放当次持久化的正文、HTML/截图路径。旧数据库会自动迁移 pages 表；历史上无法关联 queryId 的旧页面按 URL 做兼容回放。

## 自定义平台

在 settings.yaml 里定义任意站点（URL 模板 + 结果选择器），
web_platform_search 就能直接搜它——不需要改代码：

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
