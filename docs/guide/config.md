# 配置参考

> 适用版本：dsh-web-search-pro 0.2.3 · [返回 README](../../README.md) · [文档索引](../README.md)

## 配置的四层

越靠前越日常：

1. **DSH 可视化面板**：打开 `设置 → 插件 → 插件配置 → Web Search Pro`（各分组见[设置面板](./settings-panel.md)）。修改先保留为本地草稿，点击“保存”后写入 `settings.yaml` 并热更新，支持放弃修改和逐字段恢复部署值。

   - Exa、Jina、GitHub、博查、DeepSeek 与各需 Key 来源的密钥通过 DSH Credentials 写入，面板只显示“已配置/未配置”，不会把明文密钥读回浏览器，也不会把密钥值写进 `settings.yaml`。
   - `platformRules`、`customPlatforms`、`browserBindings`、Playwright、自定义评分 provider 等使用 JSON 对象编辑器；格式、数值范围或服务端校验不通过时会阻止保存，并在字段下方给出与服务端一致的错误信息。
   - 浏览器工具的审批自由度由 `dsh-browser.automationMode` 管辖，调用缓冲由 `dsh-browser.usagePolicy` 管辖；用 `browser_call` 的 `runtime.status` 查看当前状态。Web Search Pro 面板只管理搜索插件自己的后端开关，不会绕过浏览器插件的审批或资源策略。
   - 更新带客户端面板的插件版本后需要重启 Web profile，让 DSH 客户端模块扫描器重新装载 `client.js`。

2. **`$DSH_HOME/settings.yaml` → `web-search-pro:` 段**（热重载，改完即生效）：

   ```yaml
   web-search-pro:
     toolSurface: indexed # indexed（默认，只常驻 web_index / web_call）| flat（每个动作一个工具，仅对照与调试；启动时生效）
     exaApiKeyEnv: EXA_API_KEY # 推荐：运行环境或凭据服务，不把密钥写入配置
     jinaApiKeyEnv: JINA_API_KEY
     bochaApiKeyEnv: BOCHA_SEARCH_API_KEY # 博查 Key 的凭据 / 环境变量名；缺省再试 BOCHA_JEV_API_KEY
     # twitterAuthTokenEnv: TWITTER_AUTH_TOKEN # twitter-cli 的两个 Cookie 值：凭据 / 环境变量名（默认如左）；也可在设置面板写入 DSH Credentials
     # twitterCt0Env: TWITTER_CT0
     # keyedSources: # 付费来源（可选，见[付费 / 需 Key 的来源](./sources.md#付费--需-key-的来源预留接口)）：tavily / brave / linkup / serper / metaso / zhipu / baidu-qianfan
     #   tavily: { apiKeyEnv: TAVILY_API_KEY }   # 或 apiKey（字面量，不推荐）/ baseUrl；没有 Key 的来源保持不可用
     #   deepseek: { apiKeyEnv: DEEPSEEK_API_KEY } # DeepSeek 搜索 / 抓取（常用）：默认就读 DEEPSEEK_API_KEY；baseUrl 默认 https://api.deepseek.com/v1/tools
     # deepseekFetch: false # true = read.fetch 可用 DeepSeek Fetch API（按请求计费，默认关闭）
     engines: [ddg, bing, exa, seam, jina]
     parallelEngines: false
     # registerProvider: false # true = 把本插件注册为 ctx.web provider（还需在 web 条目里选中，见[内置 web 工具路由](./web-provider.md)）
     # provider: { evidence: auto, deadlineMs: 25000 } # 内置 web_search 经本插件时是否返回证据包（auto | off）与其期限
     evidence: # 证据包模式的块评分；默认完全不调用 Jev
       scorer: rule # rule | jev
       jevMode: off # off | shadow | control | hybrid
       hybridBorderline: false # 仅 hybrid：同时重评规则边界对
       maxJevQuestions: 64
       maxRounds: 2 # 证据包补搜轮数上限；1 = 关闭第二轮
       maxQueries: 4 # 单任务搜索查询总数（含第一轮；一次 provider 调用算一次）
       autoProviders: true # 按任务语言提前就绪的来源（你配置了 Key 的来源，英文无 Key 时的 Exa）；false = 只用 profile 表
       # sourcePolicy: default # default | anonymous-only（自动规划绝不用需要 Key / 账号 / 登录的来源，见[来源策略](./sources.md#来源策略)）
       # rubrics: ...   # 可选：覆盖 Jev 提示词，见[Jev 提示词（rubric）](./evidence-scoring.md#jev-提示词rubric可配置有版本)
       # judge: ...     # 可选：选择/自定义模型 provider，见[评分模型 provider 与用量上限](./evidence-scoring.md#评分模型-provider-与用量上限)
       # budget: ...    # 可选：模型输入 token 上限（单次搜索 / 每日），默认 60000 / 1000000
     # sources: # 来源偏好与请求额度（全部可选，默认什么都不设）
     #   priority: [bocha, exa] # 就绪且适合任务语言 / profile 的来源按此顺序排最前
     #   disabled: [bing]       # 自动规划与 engines 列表都不用
     #   budget: { bocha: { total: 1000, daily: 50 } } # 请求上限；用完被跳过并回退，不报错
     ttlSeconds: 3600
     searchMaxResults: 8
     browserBindings:
       zhihu:
         authProfile: china-community
         rulePack: zhihu-enhanced
   ```

   **字段顺序**：配置 schema、宿主的通用配置视图、`--dump-config` 和设置面板的文本视图按同一份分组排列（`src/config-groups.ts`，字段名、默认值和语义不变）：常用 → 搜索顺序（`engines`、`sources`、`platformBackends`）→ 来源与密钥 → 自定义 CLI（`cliAdapters`）→ 读取与证据（`evidence` 等）→ 平台与运行时 → 高级与诊断（缓存、排序加权、`dbPath`、`verbose`）。文本视图的每一段有中文 / 英文分节标题注释，需要重启的键在注释里写明。

3. **cordis.yml `config:`**（部署级默认值，见 `cordis.patch.yml`）。
4. **环境变量 / 凭据**：`$EXA_API_KEY`、`$JINA_API_KEY`、`$BOCHA_SEARCH_API_KEY`（或 `$BOCHA_JEV_API_KEY`）（`exaApiKeyEnv`/`jinaApiKeyEnv`/`bochaApiKeyEnv` 引用）。这些引用名与密钥都可以在面板“来源”分组里设置。

## 全部顶层配置键

按设置面板的分组排列（`src/config-groups.ts`），默认值取自 `src/config.ts`。“重启”列标 ✓ 的键启动时只读一次，改了要重启插件（见下节）。名字以 `Env` 结尾的键存放的是**凭据 / 环境变量的名字**，不是密钥本身。

| 分组 | 键 | 默认值 | 说明 | 重启 |
|---|---|---|---|---|
| 常用 | `searchMaxResults` | `8` | 普通搜索的默认结果数（每次调用的 `count` 可覆盖，1–20） | |
| | `parallelEngines` | `false` | `true` = 多个引擎并行搜索并融合 | |
| | `toolSurface` | `indexed` | `indexed`（只常驻 `web_index` / `web_call`）\| `flat`（每个动作一个工具，仅对照与调试） | ✓ |
| | `allowProxyFakeIp` | `false` | 信任代理（Clash/TUN）fake-IP 网段的 DNS 解析结果，见下文“网络” | |
| | `deepseekFetch` | `false` | `true` = `read.fetch` 可用 DeepSeek Fetch API（按请求计费） | |
| 搜索顺序 | `engines` | `[ddg, bing, exa, seam, jina]` | 通用搜索的回退顺序；自定义 CLI 写作 `custom-cli:<id>` | |
| | `sources` | 空 | `priority` / `disabled` / `confidence.<id>` / `budget.<id>.{total,daily}`，见 [来源策略](./sources.md#来源策略) | |
| | `platformBackends` | 空 | 每个平台的后端链顺序，见 [CLI 适配](./cli-adapters.md#默认后端链) | |
| 来源与密钥 | `keyedSources` | 空 | 需 Key 来源的 `apiKey` / `apiKeyEnv` / `baseUrl`，含 `deepseek` | |
| | `exaApiKey` / `exaApiKeyEnv` | — / `EXA_API_KEY` | Exa Key（推荐只配 `Env` 名） | |
| | `jinaApiKey` / `jinaApiKeyEnv` | — / `JINA_API_KEY` | Jina Key | |
| | `bochaApiKey` / `bochaApiKeyEnv` | — / `BOCHA_SEARCH_API_KEY` | 博查 Key，找不到时回退 `BOCHA_JEV_API_KEY` | |
| | `bochaBaseUrl` | `https://api.bocha.cn` | 博查接口地址 | |
| | `bochaSummary` | `true` | 请求较长的页面摘要，利于证据评分 | |
| | `githubToken` / `githubTokenEnv` | — / `GITHUB_TOKEN` | 提升 GitHub 限额并解锁代码搜索 | |
| | `searxngUrl` | 空 | 你自己的 SearXNG 实例（JSON 格式），设置后才有 `searxng` 来源 | |
| | `openalexMailto` | 空 | 写进 OpenAlex 请求 User-Agent 的联系邮箱（礼貌性） | |
| 自定义 CLI | `cliAdapters` | 空 | 用户自定义的只读 CLI 适配，见 [CLI 适配](./cli-adapters.md#自定义-cli) | |
| 读取与证据 | `evidence` | 见下 | 证据包与评分：`scorer`（`rule`）、`jevMode`（`off`）、`hybridBorderline`（`false`）、`maxJevQuestions`（`64`）、`autoProviders`（`true`）、`sourcePolicy`（`default`）、`maxRounds`（`2`）、`maxQueries`（`4`），以及 `rubrics` / `judge` / `coverage` / `budget`，见 [Jev 评分](./evidence-scoring.md) | |
| | `fetchDefaultChars` | `20000` | `read.fetch` 默认返回字符数（1000–500000） | |
| | `exaContentsPerUrlChars` | `8000` | `read.contents` 每个 URL 的字符数 | |
| | `exaContentsTotalChars` | `30000` | `read.contents` 全部 URL 合计字符数 | |
| 平台与运行时 | `enableCliBackends` | `true` | 允许本机 CLI 后端（bili、yt-dlp、OpenCLI、Agent Reach 等） | |
| | `opencliEnabled` | `true` | 允许 OpenCLI 后端 | |
| | `agentReachEnabled` | `true` | 允许 Agent Reach 后端 | |
| | `twitterAuthToken` / `twitterAuthTokenEnv` | — / `TWITTER_AUTH_TOKEN` | twitter-cli 的 Cookie 值（可选后备才需要） | |
| | `twitterCt0` / `twitterCt0Env` | — / `TWITTER_CT0` | 同上 | |
| | `playwright.enabled` | `true` | 允许经 dsh-browser 渲染（热更新） | |
| | `playwright.snapshotDir` | `<dbPath 目录>/snapshots` | `read.snapshot` 的快照目录 | ✓ |
| | `customPlatforms` | 空 | 自定义平台，见 [自定义平台](./custom-platforms.md) | |
| | `platformRules` | 空 | 按平台覆盖结果选择器 | |
| | `browserBindings` | 空 | 平台到 `authProfile` / `rulePack` 的绑定，见 [平台登录态](./platform-login.md) | |
| | `registerProvider` | `false` | `true` = 注册为 `ctx.web` provider，见 [内置 web 工具路由](./web-provider.md) | ✓ |
| | `providerId` | `web-search-pro` | 上述 provider 的 id | ✓ |
| | `provider.evidence` | `auto` | 内置 `web_search` 经本插件时是否返回证据包（`auto` \| `off`） | |
| | `provider.deadlineMs` | `25000` | 证据运行的期限 | |
| | `timeoutMs` | `30000` | 搜索与读取的超时基数；每个动作的截止时间与宿主工具上限启动时定下 | ✓ |
| 高级与诊断 | `ttlSeconds` | `3600` | 缓存有效期 | |
| | `memoryCacheEntries` | `128` | 进程内 LRU 缓存容量 | ✓ |
| | `rrfConstant` | `60` | 多来源融合的 RRF 常数 | |
| | `freshnessBoost` / `freshnessDays` | `0.2` / `30` | 时效加分（占一个排名单位的比例）与衰减天数 | |
| | `authorityBoost` / `authorityDomains` | `0.25` / 空 | 权威域名加分与额外权威域名 | |
| | `dbPath` | `$DSH_HOME/data/web-search-pro/store.db` | SQLite 路径；agent 覆盖文件放在同一目录 | ✓ |
| | `verbose` | `false` | 加载标记等诊断输出 | ✓ |

## 需要重启插件的设置

几乎所有设置都是热更新：宿主改 profile 配置时就地更新条目的配置，每次调用经 `dynamic()` 读最新值。只有下面这些在**插件启动时读一次**，改了要重启插件（`RESTART_FIELDS`，`src/restart.ts`）：

| 设置 | 为什么 |
|---|---|
| `toolSurface` | 工具（`web_index` + `web_call`，或每个动作一个）在启动时注册 |
| `playwright.snapshotDir`（`playwright.enabled` 是热的） | `read.snapshot` 的快照目录在启动时确定 |
| `providerId` / `registerProvider` | ctx.web provider 的注册与 id 在启动时给宿主 |
| `timeoutMs` | 每个动作的截止时间与宿主工具上限在启动时定下（搜索内部的协作超时预算是热的） |
| `memoryCacheEntries` | 进程内缓存按此容量在启动时创建 |
| `dbPath` | SQLite 和 agent 覆盖文件在启动时打开；旧路径里的数据不会自动搬走 |
| `verbose` | 加载标记在启动时写入 |

设置面板里这些行带“重启插件后生效”标记（`?` 里写原因）；保存时若改到了它们，保存条加一句提示；状态摘要显示“待重启 N 项”。运行时检测：插件记下启动时的值，`sources.status` 和 `config.inspect` 在配置里的值与之不同时写出“待重启：<字段>（当前生效 X，配置为 Y）”。源码里有一个测试扫描对启动时配置副本的读取，新增这类读取而没登记到 `RESTART_FIELDS` 会失败。

## agent 覆盖层与 `config.*`

profile 配置是用户的基线，**agent 不直接改它**。agent 要调整来源顺序或加一个 CLI 时用 `config` 组的动作，它们写一个单独的**覆盖层**，叠在基线上、立即生效，设置面板里能看到并一键采纳或撤销。设计说明见 [overlay-design.md](../dev/overlay-design.md)。

- **文件**：`$DSH_HOME/data/web-search-pro/overlay.json`，和 `dbPath` 同一个目录（改了 `dbPath` 就跟着走）。内容：`version`、`revision`（乐观锁）、`checksum`（sha256）、`values`、最近 50 条审计记录；先写临时文件再改名，权限 0600。按 mtime 和大小缓存，变了才重新读取并校验，不用 fs.watch。
- **能覆盖的只有这些**：`engines`（整列表）、`sources.priority` / `sources.disabled`（整列表）、`sources.confidence.<id>`（单项）、`platformBackends.<平台>`（单个平台的整条链）、`cliAdapters.<id>`（整份规格）。Key、路径、预算、开关、证据与评分设置都碰不到；覆盖层只能新增或替换，不能删除基线条目（停用基线里的 CLI 用 `sources.disabled`；`config.remove_cli` 只删覆盖层自己加的）。
- **合并**：`dynamic()` 返回“基线 + 覆盖层”，所有消费者下一次调用就看到。校验与设置面板、`sources.status` 用同一批函数（`cliIssues`、`sourcesIssues`、CLI 规格校验、来源 id 规则）；只有覆盖层**新增**的问题才算数。整个文件解析失败、校验和不符、值被校验拒绝或与基线不再一致（链里引用了用户删掉的 CLI）时，**整体忽略、按基线运行**，在 `sources.status` / `config.inspect` 报告原因，绝不只应用一半；坏文件挡住写入，直到 `config.reset {scope:"all"}`（或面板的“全部撤销”）把它挪开。
- **动作**：`config.inspect`（每个键的生效值与来源、`revision`、最近审计、覆盖层是否有效、待重启项）、`config.set_order {engines?, priority?, disabled?, platform?, backends?}`、`config.set_confidence {id, value}`（省略 `value` 删除覆盖项）、`config.upsert_cli {id, spec}`、`config.remove_cli {id}`、`config.reset {scope: all|order|confidence|cli|platform, id?}`、`config.export`（导出生效的可覆盖设置为 YAML，可贴进 profile）。每次写入必须有 3–300 字符的 `reason`，可带 `expectedRevision`（不匹配就拒绝）；成功后 `revision + 1` 并写一条审计（时间、动作、键、前后值摘要、reason、sessionId、actor）。没有变化的写入不落盘、不增加 revision。
- **审批**：见[审批、并发与超时](./tools-and-actions.md#审批并发与超时按动作)。`config.upsert_cli` 一律询问，其余不询问；headless 下 `upsert_cli` 被拒。
- **设置面板**：被覆盖的行带“agent 修改”标记（悬停看值、reason、时间）；新分组“agent 修改”列出全部覆盖项和最近的审计，每项“采纳到配置”（用与保存条相同的原子 `mutate` 写进 profile，成功后才让插件删掉这一项覆盖）和“撤销”，另有“全部撤销”和“刷新”（面板打开时读取一次）。

## 网络：代理 fake-IP DNS

若 Clash/TUN 使用 fake-IP DNS，原生 HTTP 后端可能看到 `198.18.0.0/15`、`fdfe:dcba:9876::/64` 或 `2001:2::/48`（报错信息会直接提示 `resolved to proxy fake-IP …`）。可在设置面板“常用”分组里启用 `allowProxyFakeIp`；默认关闭。该开关只信任这些代理网段的 **DNS 解析结果**，字面 fake-IP URL、localhost 和其他私网地址仍会被 SSRF 防护拒绝。
