# 设置面板

> 适用版本：dsh-web-search-pro 0.2.3 · [返回 README](../../README.md) · [文档索引](../README.md)

0.2.3 起设置面板按“状态摘要 + 手风琴分组 + 列表与弹窗 + 固定保存条”重做（风格与 `@anweat/dsh-browser` 0.2.2 的设置页一致）；保存结构、Config schema 与运行时行为不变。顶部是**状态摘要**：实际尝试顺序的默认引擎链、已配置 Key 的来源数、“常用”的 DeepSeek 是否就绪、内置 web 工具是否经本插件、评分模型、工具面，以及校验提示的数量（点开看详情）；agent 改过设置时多一个“agent 修改 N 项”入口，插件有设置要重启才生效时多一个“待重启 N 项”徽标。下面是十二个分组（常用 · 搜索顺序 · 来源 · 自定义 CLI · 读取与证据 · 评分模型 · 内置 web 工具路由 · 运行时与后端 · 网络与缓存 · 排序加权 · agent 修改 · 高级），**默认只展开“常用”**；每个字段是“标签 + 一行说明”，长说明放在 `?` 气泡里，被覆盖的字段带“已覆盖”徽标和就地“恢复默认”，未覆盖的显示当前值（灰色）。底部的保存条一直可见，显示“N 项未保存的修改”，有“放弃修改”和“保存”。

| 分组 | 内容 |
|---|---|
| 常用（默认展开） | 它**实际**会怎么排的一行预览（与路由器用同一个函数，带“编辑顺序”链接）、默认结果数、并行融合、工具面（下拉）、`allowProxyFakeIp`（带“网络”标注）、DeepSeek 搜索 / 抓取（“常用”）一行和 `deepseekFetch` 开关（带“计费”标注） |
| 搜索顺序 | **通用搜索顺序**：`engines` 是一个可排序的列表（每行：位置、名称、就绪状态——Key 或地址是否已设，已保存的自定义 CLI 用插件自己的本地探测——置信度和一个置信度输入框，上移 / 下移 / 移除），下拉框里是还能加入的来源（内置引擎，加上标记为“通用引擎”的自定义 CLI），“恢复默认顺序”删掉 `engines` 这个键；列表下面是**实际生效顺序**预览和一句“为什么和列表不同”（DeepSeek 因为有 Key 排最前、`sources.disabled` 去掉了谁、`sources.priority` 提前了谁、只用免费来源时没加谁、你自己写的顺序不自动加 DeepSeek）；一段说明三者的关系：调用里显式给的 `engines` > `sources.priority` / `sources.disabled` > 默认规则，并链接到“来源”。**平台后端顺序**：每个有后端链的平台一行（没改过的灰色显示内置默认链并标“默认”），弹窗里用同样的列表编辑；可选后端 = 该平台的内置后端加上**声明服务该平台**的自定义 CLI；“恢复默认”删除 `platformBackends.<平台>` 这一项（最后一项删掉时整个字段 `unset`） |
| 来源 | 来源策略（`evidence.sourcePolicy` 下拉、`sources.priority` / `sources.disabled` 标签）；**来源列表**：DeepSeek（常用）、博查、Tavily、Brave、Linkup、Serper、秘塔、智谱、百度千帆、Exa、Jina、GitHub、SearXNG，每行显示层级（付费 / 有免费额度 / 免 Key）、Key 是否已设和请求上限，点“编辑”在**弹窗**里改 Key 引用名、写入式密钥（遮罩，只显示“已配置”）、接口地址、请求额度（`sources.budget.<id>.total` / `daily`）；匿名来源参考表和 `openalexMailto` 在折叠区 |
| 读取与证据 | `fetchDefaultChars`、`exaContentsPerUrlChars` / `TotalChars`、`evidence.autoProviders` / `maxRounds` / `maxQueries`（带单位的数字输入）。`minKeep` 与证据包字符预算没有配置项 |
| 评分模型 | `evidence.judge.mode` 下拉（off / shadow / control / hybrid，同时写旧键 `jevMode` / `scorer`）、provider 下拉、`hybridBorderline`、`maxJevQuestions`、`allowLlm`；折叠区：覆盖判定（模式、provider、阈值）与用量上限；自定义 provider / 按 provider 上限是 JSON 列表（弹窗里编辑，校验与服务端共用，拒绝在定义里放密钥）；**提示词（rubric）列表**：每行显示名称、生效版本、默认 / 已覆盖，“编辑”打开弹窗，左边是默认文本、右边是你的覆盖，“从默认文本开始覆盖”“恢复默认” |
| 内置 web 工具路由 | `registerProvider` 开关；打开后才出现 `providerId`、`provider.evidence`、`provider.deadlineMs`；折叠区给出选中本插件所需的 profile patch（随 `providerId` 变化） |
| 自定义 CLI | 列表（id、命令行、用途——通用引擎 / 服务的平台、置信度、规格合法或问题数）和新增 / “用 echo 做示例” / 编辑 / 复制 / 删除；**编辑弹窗是表单**：命令、参数模板（一格一个 token，`{query}` `{count}` `{terms}` 提示，允许的子命令从模板自动推出并显示）、输出格式、“整段输出”开关、结果数组路径、四个字段路径、超时、用途、置信度；折叠区有高级项（安装说明、帮助命令、帮助里必须出现的内容、输出上限）、**试运行**和**查看 JSON**（直接编辑整份规格，与表单双向同步；服务端的校验函数实时校验，每条消息显示在对应的控件旁；规格有问题时“完成”不可点） |
| 运行时与后端 | CLI / OpenCLI / Agent Reach 开关；Twitter / X 登录值（弹窗：两个引用名与两个写入式密钥）；JSON 对象列表：Playwright、自定义平台、平台选择器覆盖、浏览器绑定（每项一个弹窗） |
| 网络与缓存 | `timeoutMs`、`ttlSeconds`、`memoryCacheEntries`、`dbPath`、`verbose` |
| 排序加权（高级） | `rrfConstant`、`freshnessBoost` / `freshnessDays`、`authorityBoost` / `authorityDomains` |
| agent 修改 | agent 经 `config.*` 做的修改：每项显示类型、生效值与你配置里的值、reason、时间、sessionId，带“采纳到配置”和“撤销”；“全部撤销”（也用来修复被忽略的坏文件）、“刷新”、覆盖文件路径与版本、最近的审计记录（折叠） |
| 高级：文本模式与原始 JSON | 折叠区“原始 JSON”：`platformBackends` 与 `cliAdapters` 的整段 JSON（不再是主要入口）；当前草稿的设置（不含密钥）打印成**每个键前都带注释**的 YAML：用途、取值或范围、默认值、风险，中英文随界面语言；只读视图，可复制；去掉 `#` 行后剩下的恰好是你覆盖的键 |

- **弹窗里的改动**先留在草稿里，点底部“保存”才写入；“放弃修改”丢掉全部草稿。
- **写入方式**：保存是一次原子的 `mutate`，按字段路径逐项写入（`evidence.maxRounds`、`sources.budget.deepseek.daily`、`playwright.enabled` …），而不是整体写回 `evidence` / `sources` 容器；宿主只接受声明了 `.volatile()` 的字段之下的编辑，整体写容器会被拒绝（0.2.2 的面板在 rc.3 宿主上保存这些字段会失败，见 [CHANGELOG](../../CHANGELOG.md)）。恢复默认会 `unset` 那一项，宿主不会清掉留下的空容器（`evidence: {}` 之类，无害）；不认识的同级键原样保留。
- 密钥通过 DSH Credentials 写入，页面只显示“已配置 / 未配置”，不读回明文，也不写进 `settings.yaml`；写密钥发生在设置写入成功之后。

校验与服务端共用同一批纯函数（`pipeline/rubrics-spec.ts`、`judges/providers-spec.ts`、`judges/calibration-spec.ts`、`coverage.ts`、`budget-spec.ts`、`default-chain.ts`、`config-fillers.ts`），它们不引入 Node 模块，客户端 bundle 只依赖宿主模块表里的少数模块（`react`、`@deepseek-ai/dsh-client-ui-slots`、`dsh-client-store`、cordis 与 `@deepseek-ai/dsh-client-ui-primitives`；`pnpm run test:client-bundle` 检查）。0.2.3 新增 peer `@deepseek-ai/dsh-client-ui-primitives`（可选，与其他 `dsh-client-*` peer 同一范围）：开关、按钮、徽标、弹窗和 `?` 气泡用宿主自己的组件，下拉、标签输入、手风琴、列表行宿主没有，用原生元素搭，颜色全部来自宿主的 `--dsw-alias-*` 变量，浅色 / 深色 / 窄宽度都跟随。
