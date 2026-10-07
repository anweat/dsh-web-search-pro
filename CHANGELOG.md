# 更新记录

## 0.2.1（2026-10-07）

独立 CLI 适配层。兼容范围与 0.2.0 相同（DSH `>=0.2.0-rc.2 <0.2.1-0`，可选 `@anweat/dsh-browser ^0.2.0`），没有破坏性变更。


- 新增声明式 CLI 适配层（`src/cli/`）：规格校验（只读保证：子命令白名单 + 全局拒绝表 + 拒绝读取 Cookie / 带凭据的 flag）、不经 shell 的执行器（最小环境、UTF-8、超时 / 取消 / 输出上限、结构化错误）、本地带缓存的契约探测（同名但契约不同的程序报 `incompatible`）。
- 内置规格：bili、yt-dlp、twitter 迁到规格执行器；新增 xhs、zhihu、rdt、omnireach、独立 opencli（按 `opencli list` 的 search 命令）、gh，以及按文档的 wx-search-cli、tanso；每个规格记录已验证版本与验证程度（live / contract-only / docs-only）。
- 每个平台是一条有序后端链（独立 CLI → 独立 OpenCLI → dsh-browser），新增 `platformBackends`、`cliAdapters` 设置；新增平台 `wechat`（公众号）与多源 `omnireach`、`tanso`；`sources.deps` / `sources.status` 显示每个 CLI 的安装状态与每条后端的就绪 / 跳过原因。
- 默认值写入 README 快速使用并有测试固定：Jev 默认关闭，博查只在配置了 Key 时使用。
- 平台搜索结果标明实际使用的后端（`Platform: bilibili (via bili)`，输出新增可选字段 `backend`，历史与证据包同样记录）；后端链顺延时在说明里列出被跳过的后端与原因。
- `sources.status` 的平台摘要按后端链的真实状态显示：`ready`（有后端现在就能运行）、`login unverified`（只能依赖你自己的浏览器会话，本地无法确认）、`needs login`、`unavailable`，并给出下一步（例如自行运行 `xhs login`）。
- `bili` 返回的无视频号条目改用条目自带的链接；没有任何链接的条目跳过并在说明里注明数量。
- 需要登录的 CLI（xhs、zhihu、rdt）只在本地已有保存的登录信息时才运行（只检查文件是否存在）；插件不会触发登录，也不会让 CLI 读取浏览器 Cookie。
- 验证：774 项插件测试、94 项 bench 测试、类型检查、peer 范围、构建与客户端 bundle 检查通过；真实宿主（DSH 0.2.0-rc.2）上全默认配置可用，`bili` 与 `omnireach` 两条后端实测通过。xhs、zhihu、rdt、twitter、独立 opencli 的搜索只核对了命令契约，未用真实登录态验证。

## 0.2.0（2026-10-05）

正式发布 0.2.0 基线。继承下方 rc.1 的工具面、来源、证据管线与兼容范围；真实验证的宿主仍为 DSH 0.2.0-rc.2，可选 Browser 0.2.0。

- 修复同一原文块支持多个需求时只保留一处摘录的问题：按需求保留不同窗口，覆盖统计只承认实际被选入的需求；不同窗口使用不同证据 ID，`history.expand` 可分别展开。
- 底层选择器增加可选的渲染后 token 预算回调、按原文块计算每 URL 配额、每块窗口上限与按需求定位锚点；默认行为仍使用字符预算。这些选项尚未接入宿主设置，冻结样本不支持把它们整体切为默认策略。
- 增加仅检查交付摘录的支持度评测，区分整块金标命中与摘录实际保留的事实。
- 修复测试隔离：来源路由的模拟请求同时模拟 DNS，超时场景显式保留测试事件循环；发布工作流同时执行 bench 类型检查与测试。
- 本地完整验证：711 项插件测试、94 项 bench 测试、类型检查、peer 范围、构建与客户端 bundle 检查通过。真实 DeepSeek 对比采用 API 返回的 token 用量；节省幅度只适用于已记录样本。

仍适用 rc.1 下方列出的已知限制。规则评分与覆盖为启发式，整块评分或自定义 judge 的高分不保证摘录包含所有条件；有精确条件、数字或否定的任务应展开原文核验。严格 token 上限尚不是用户配置的默认保证。

## 0.2.0-rc.1（预发布）

0.2.0 线的第一个版本。基线是 DSH 0.2.0-rc.2，与 `@anweat/dsh-browser 0.2.0` 一致。

### 兼容性与基线

- 只支持 DSH `>=0.2.0-rc.2 <0.2.1-0`；可选配套浏览器插件为 `@anweat/dsh-browser ^0.2.0`。
- **不再支持 DSH 0.1.x 宿主线，也不再支持旧的 dsh-browser 0.1.x 线；仍在这两条线上的用户请停留在 dsh-web-search-pro 0.1.15。** 本插件去掉了为旧宿主保留的兼容分支。
- 检测到旧版 dsh-browser 0.1.x 服务时，本插件不会驱动它：`read.snapshot`、`read.fetch mode=playwright`、浏览器平台与 OpenCLI 平台返回 `CAPABILITY_UNAVAILABLE`（`dsh-browser 0.1.x is not supported by web-search-pro 0.2+; upgrade to @anweat/dsh-browser ^0.2.0`）；`read.fetch mode=auto` 跳过浏览器；`sources.status` 显示 `browser: legacy (unsupported)`；其余功能照常。判定方式是服务形状（不带 `observe` / `listTargets` / `sessionState` 中任何一个即为旧线），因为服务没有版本字段。

### 破坏性变更

- **工具名**：原 11 个 `web_*` 工具（`web_search_pro`、`web_fetch_pro` 等）不再注册，没有兼容包装；改为常驻的 `web_index`（目录）与 `web_call`（调用）两个工具，共 20 个动作（`search.run`、`read.fetch`、`sources.status` 等，`toolSurface: flat` 仅供调试）。模型在 `web_call` 里写旧工具名会得到新动作名和翻译后的参数。已存储的数据（历史、页面、规则、证据、账本）不受影响。
- **`read.fetch` 默认只返回 20k 字符**（原 `web_fetch_pro` 为 100k，配置项 `fetchDefaultChars`），长页用 `offset` 从已存快照续读；输出带 `truncated` / `nextOffset` / `totalChars`。`read.contents`、`read.snapshot`、历史回放与 `ctx.web` 抓取出口使用同一套预算。
- **自定义平台不能与内置平台（或其他 provider）重名**：同名的键不会覆盖内置来源，会被拒绝并在 `sources.status` 的 `notes` 里列出。
- **写操作的审批**：缓存 / 历史 / 规则变更与依赖安装按动作审批。没有 dsh-browser（或检测到旧版）时，`standard` 模式下一律询问；装有 0.2 浏览器插件时仍读取它的 `automationMode`。
- **所有引擎都返回合法空结果时**，`search.run` 返回空结果和说明，不再报错。
- 融合排序的量纲有调整（按来源归一化，加分每个 URL 只加一次），结果顺序可能与 0.1.x 不同。
- 博查默认地址改为 `https://api.bocha.cn`。

### 新功能

- **证据管线与证据包**：`search.run` 传 `task` / `profile` / `needs` / `constraints` / `budget` 时输出 EvidencePack：按 profile 与语言选来源、候选合并与 URL 规范化、读取与分块、规则评分（含跨语言对齐）、预算内选择、覆盖与缺口说明、有界第二轮补搜；`history.expand` 按 ID 展开摘录原文。读取质量差的页面（空壳、JS 外壳、登录墙）在浏览器就绪时自动升级渲染。
- **来源注册表、目录与推荐**：每个引擎与平台都是“描述符 + 适配器”，探测、冷却、并发合并、历史走同一条路径；`search.recommend` 按任务推荐来源，并给出待配置来源的设置步骤；目录与描述符标注成本层级（`anonymous` / `free-quota` / `paid`）。
- **匿名来源**：Wikipedia、Hacker News、Stack Exchange、OpenAlex、Semantic Scholar、AnySearch、arXiv、PubMed、SearXNG、RSS 等，以及无 Key 的 Exa MCP 路线（经 mcporter）。
- **需 Key 来源的接口**：博查（已实测）、Tavily、Brave、Linkup、Serper、秘塔、智谱、百度千帆；未配置 Key 时只显示为待配置步骤，不会执行。密钥走 DSH Credentials。
- **来源策略与请求额度**：`sources.priority` / `sources.disabled`、`evidence.sourcePolicy: default | anonymous-only`；`sources.budget.<id>: {total, daily}` 可选请求额度（默认不设上限），用尽后跳过并退回其他来源。
- **评分模型与用量账本**：`evidence.judge.mode`（`off | shadow | control | hybrid`）；provider 协议 `systemone` / `rerank` / `llm` 与内置预设，可自定义；提示词（rubric）可配置、带版本；每次模型调用先预留后结算，记入持久化账本，受 `evidence.budget` 单次 / 每日上限约束；`sources.status` 显示 provider 与当日用量。
- **覆盖判定**（默认关闭）：`evidence.coverage` 的 `off | shadow | control`，只降级、不删证据；建议先在 `shadow` 下观察自己的分布。
- **`ctx.web` provider 路由**：`registerProvider: true` 并在 `web` 条目选中本插件后，宿主内置的 `web_search` / `web_fetch` 返回本插件的证据包与预算内正文；`sources.status` 显示选中状态。
- **设置面板**：覆盖上述全部新增配置（分组折叠，中英文），密钥只走 DSH Credentials，不回显。
- **随包 skill** `dsh-web-search-pro`（用法与排障参考）；常驻系统提示只有一行。
- **并发与可靠性**：SQLite `busy_timeout` 与事务化组合写入、相同请求的 in-flight 合并、空结果与用户取消不再触发引擎冷却、关闭后在途请求不抛错、各出口统一的输出整形与 `truncated` 标记；dsh-browser 改为按调用解析的可选依赖（未安装、未启用、运行中移除都不影响其余功能）。

### 已知限制

- 评测标注（`bench/` 的金标）全部是未经人工复核的 LLM 草稿；Jev / 覆盖判定的阈值与效果据此得出，换 provider、模型或 rubric 版本都要重新校准。
- 需 Key 来源中，只有博查做过真实调用验证；Tavily、Brave、Linkup、Serper、秘塔、智谱、百度千帆的接口依据官方文档与参考实现编写，标记为 `not verified live`，免费额度同样只读了官网页面，没有注册验证。Exa 无 Key 路线的限额未知。
- 需要登录的平台（小红书、知乎、微博、豆瓣、贴吧、抖音、快手、Twitter / X 等）需要真实登录态才能验证，尚未在真实账号下测过。
- 设置面板在桌面端的观感（折叠、暗色主题、窄屏）与保存后的热更新只做过组件渲染与内存 scope 测试，需在真实桌面界面确认。
- `toolSurface` 与 `registerProvider` 需重启 profile 才生效。
