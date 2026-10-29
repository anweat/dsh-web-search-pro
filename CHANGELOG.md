# 更新记录

## 未发布

- 文档整理：README 精简为中文入口并新增英文版 `README.en.md`；其余内容按主题拆到 `docs/guide/`，设计与调研记录移到 `docs/dev/`；`LOGIN.md` 并入 `docs/guide/platform-login.md` 并按当前的 opencli 优先做法改写（登录由用户自己完成，插件没有登录窗口）；README 里的兼容表与升级说明移到本文件；新增 `scripts/check-docs-links.mjs`（`pnpm run check:docs`，已并入 `verify`）检查文档链接、锚点和中英文 README 的标题数量。没有改动运行时行为。

## 从旧版本升级

适用于 0.2.x 各版本之间的升级（0.1.x 宿主或 dsh-browser 0.1.x 请不要升级，停留在 `dsh-web-search-pro@0.1.15`，见[兼容与发布通道（历史）](#兼容与发布通道历史)）。DSH Desktop 用户在插件页卸载后重新 Add plugin，写法见 [安装与首次使用](docs/guide/install.md#用-dsh-desktop-安装)。

先确认宿主是 `dsh-v0.2.0-rc.2` 或 `dsh-v0.2.1-rc.2` ~ `rc.4`，浏览器插件（如果装了）是 `@anweat/dsh-browser@0.2.2`（或更新的 0.2.x；0.2.0-rc.2 宿主上 0.2.0 / 0.2.1 也可以）；两者都需要作为 profile 的直接依赖。

```bash
dsh plugin --profile web add @anweat/dsh-browser@0.2.2 dsh-web-search-pro@0.2.3
```

> **不再支持旧线**：宿主仍是 DSH 0.1.x，或浏览器插件仍是 `@anweat/dsh-browser` 0.1.x，请不要升级。只升级本插件、保留旧浏览器插件时，本插件照常工作，但所有浏览器相关能力都会返回 `CAPABILITY_UNAVAILABLE`，`sources.status` 显示 `browser: legacy (unsupported)`。

> **破坏性变更（工具面，0.2.0 起）**：旧的 `web_search_pro`、`web_fetch_pro` 等 11 个工具名不再注册，也没有兼容包装。旧会话里对它们的调用会失败；把调用改成对应动作即可，对照表见 [旧工具到新动作](docs/guide/tools-and-actions.md#旧工具到新动作)。模型在 `web_call` 里写旧工具名会得到新动作名和翻译后的参数，`web_index()` 根目录也列出同一张对照。已存储的数据（历史、页面、规则、证据、账本）与 `ctx.web` provider 不受影响。其他不兼容变化与新功能见下面各版本。

升级完成后需要**完整停止并重新启动 Web profile**；仅刷新网页不会重新扫描插件的 `client.js`。随后依次检查：

1. `browser_call({action:"runtime.status"})`：确认 OpenCLI、`playwright | patchright` 运行时、`automationMode` 与 `usagePolicy` 符合预期。
2. `web_call({action:"sources.status"})`：确认搜索、CLI、Agent Reach 与浏览器后端是否 ready（浏览器应显示 `ready`，不是 `legacy (unsupported)`）。
3. 打开 `插件 → 已安装` 中两个 bundle 各自的详情页，确认配置表单都已加载；浏览器表单负责自由度、运行时、OpenCLI 与调用缓冲。

> `automationMode` 和防止过度调用的 `usagePolicy` 都属于 dsh-browser，升级不会自动改写现有配置。生产 profile 建议保留 `standard`；`unrestricted` 只用于隔离的自动化测试 profile，并且仍受并发、突发、页数/深度和 429/503 退避保护。

升级到 0.2.3 时请特别注意：已有 `DEEPSEEK_API_KEY` 的用户，默认搜索会先走按请求计费的 DeepSeek 搜索（见下面 0.2.3 的“请先看：默认行为会变”）。
## 0.2.3（2026-10-28）

接入 **DeepSeek Search / Fetch API**（[文档](https://api-docs.deepseek.com/guides/search/)，2026-10-17 上线）并标为“**常用**”。兼容范围见下面“同时支持 DSH 0.2.0-rc.2 与 0.2.1-rc.2 ~ rc.4”（DSH `>=0.2.0-rc.2 <0.2.1-0 || >=0.2.1-rc.2 <0.2.2-0`，可选 `@anweat/dsh-browser ^0.2.0`），没有破坏性变更，Config schema 只增不改（`deepseekFetch`、`keyedSources.deepseek`；`playwright.snapshotDir` 现在声明为 volatile，见下文面板保存的修复）。

### 请先看：默认行为会变

- **已经有 `DEEPSEEK_API_KEY`（环境变量、DSH 凭据或设置里的密钥字段）的用户，升级后默认的 `search.run` 和证据模式自动规划会先用 DeepSeek 搜索，而它按请求计费**：Search 与 Fetch 各为每 1000 次成功请求 $0.75（空结果、失败、超时不计费，`count` 不影响价格）。文档写明经 DeepSeek Harness / Claude Code / Codex 的服务端工具调用在 2026-11-01 00:00（北京时间）前免费，但没写插件直接调用算不算，**所以本插件按会计费处理**。
- 不想用：在 `sources.disabled` 里加 `deepseek`；只想在需要时用：自己写一份 `engines`（自定义过的 `engines` 列表保持你写的顺序，不会被自动加入）；想限量：`sources.budget.deepseek: { total, daily }`；`evidence.sourcePolicy: anonymous-only` 也不会自动使用它。没有 Key 时行为与 0.2.2 完全一样。
- **登录类平台的默认后端顺序变了**：小红书、知乎、Reddit、X 现在先试独立 `opencli`（用你日常 Chrome 的登录态），再试独立 CLI（`xhs`、`zhihu`、`rdt`、`twitter`），最后是 dsh-browser 的后端——知乎、Reddit、Twitter 原来是独立 CLI 在前（小红书本来就是 opencli 在前）。已经登录了独立 CLI 并想继续优先用它的，在设置 `platformBackends` 里写出顺序（显式配置原样优先，不受影响）。没装独立 opencli 的用户行为不变：它被跳过并写明原因，链继续往下走。见下文“登录类平台改走 OpenCLI”。

### 同时支持 DSH 0.2.0-rc.2 与 0.2.1-rc.2 ~ rc.4（2026-10-28）

0.2.2 把 peer 移到了 0.2.1 线，留在 0.2.0-rc.2 宿主上的用户（0.2.1 的 peer 是 `<0.2.1-0`）就没有可装的新版本；DSH 又出了 0.2.1-rc.4。0.2.3 两条线都接。**运行时代码没有为此改动**——评估了插件用到的每个宿主接口，0.2.0-rc.2 上都在、语义相同，真实宿主验证也都通过：

- peer：每个受管 `@deepseek-ai/dsh-*` 改为 `>=0.2.0-rc.2 <0.2.1-0 || >=0.2.1-rc.2 <0.2.2-0`，cordis 改为 `~4.0.4`（0.2.0-rc.2 宿主依赖 `~4.0.4`，0.2.1-rc.x 依赖 `~4.0.5`，干净安装都解析到 4.0.5）。
- 对照结果（`git diff dsh-v0.2.0-rc.2 dsh-v0.2.1-rc.3`）：设置面板的原子 `mutate` 与 `.volatile()` 校验（`dsh-settings` / `dsh-client-ui-settings`）两个版本相同，只有 rc.3 去掉了远程浏览器的“内存模式”，插件不读它；私有 RPC 通道（`connection.rpc.handle`、`webServer`）的注册接口相同（rc.3 只多了 Peer 的概念，处理函数的签名不变）；凭据服务（`credentialRef`、`credentials.resolve`、面板的 `remote.credentials`）相同，只是 rc.2 在“只读来源遮蔽引用”时拒绝写入、面板会原样显示这条拒绝；`tools/pre-execute` 的 `allow | deny | ask` 与“没有审批通道的 ask 变成拒绝”（`serviceAsk`）两个版本一致；`dsh-client-ui-primitives` 的 `Button / Modal / Switch / Tag / Tooltip`、`plugins.bundle.config` 槽位、`configForms.whileServed` 都在 rc.2 里。没有需要“缺了就降级”的分支，原有的降级（没有 `connection` / `webServer` 时不注册 RPC、没有 skill 注册表时用内嵌指南）继续保留。
- 真实宿主（隔离 `DSH_HOME`，从 npm 装进 scratchpad 的 `@deepseek-ai/dsh` 0.2.0-rc.2 / 0.2.1-rc.3 / 0.2.1-rc.4，用 `pnpm pack` 出的 tgz 以 `file:` 安装）：三个宿主上 `dsh plugin add` 退出码 0、无警告；headless 下 `web_index` / `web_call` 都在，`sources.status`、`config.inspect|set_order|reset` 可用，`config.upsert_cli` 被拒绝而不是执行；Web profile 下设置卡片渲染，保存一项后 `cordis.patch.yml` 里恰好多一个键，恢复默认后移除，agent 覆盖层的“采纳到配置”（原子 `mutate`）和“撤销”（私有 RPC）、自定义 CLI 的试运行（RPC `trial`）都工作，保存之后插件**不重启**就读到新配置（`ctx.fiber.config` 热更新）。反向对照：未改 peer 的 0.2.3-dev.1 装进 0.2.0-rc.2、旧的 0.2.1 装进 rc.4，都被安装闸门以 `incompatible` 拒绝。
- `test/compat/check-peer-ranges.js`：受支持基线 `0.2.0-rc.2`、`0.2.1-rc.2` ~ `rc.4`；`0.1.7-rc.2`、`0.2.0-rc.1`、`0.2.1-alpha.5`、`0.2.1-rc.1`、`0.2.2-alpha.1` 在两种解析模式下都拒绝；cordis 4.0.4 / 4.0.5 通过、4.1.0 拒绝；`--selftest` 25 条已知行为（比之前多的 9 条是两段范围的断言），范围判定与 `semver` 7 逐版本核对一致。
- 可选 Browser peer `^0.2.0`：0.2.0 线宿主上 Browser `0.2.0` / `0.2.1`（及 0.2.2）都能装；0.2.1 线宿主上，装 Browser 0.2.0 / 0.2.1 会被安装闸门拒绝（`nothing was installed`，连同这次一起装的本插件也没装上），要用 0.2.2 起。

### 修复：新用户没有浏览器时的提示（2026-10-28）

`@anweat/dsh-browser` 装上不等于能开浏览器：新用户机器上没有 Playwright 的 Chromium。dsh-browser 0.2.2 会自己判断能否启动、有没有系统 Chrome / Edge 可用（`status().browser`）；本插件把这一点说出来，而不是一律显示“ready”：

- `sources.status` 的 `browser` 多一个 `launch: { ready, source?, path?, advice? }`；没有可启动的浏览器时那一行写成 `❌ browser:dsh-browser [loaded, no browser to launch] — <dsh-browser 的建议>`，用系统浏览器时写 `uses the system browser <路径>`。dsh-browser 没有报这个字段（旧版本）或查询失败时什么都不说。
- `read.fetch mode=auto`：浏览器渲染失败的原因原来只记成 160 个字符的 `detail`、正文里完全看不到；现在浏览器那一条保留 500 个字符，页面文字末尾多一行 `Browser render did not run: <原因>`，所有后端都失败时错误里带上 `(browser render failed: <原因>)`。

### 分发：干净安装与同装（2026-10-28）

用户原话：npm 有可能遇上 opencli 或 playwright 的分发问题，可以顺便修。

- **本插件自己**：没有 `playwright` / `patchright` / `@jackwener/opencli` 依赖，也没有安装脚本；运行时只依赖 `cross-spawn`、`js-yaml`、`node-html-parser`。pnpm 11 下 `dsh plugin add <tgz>` 在 0.2.0-rc.2 / 0.2.1-rc.3 / 0.2.1-rc.4 三个宿主上退出码 0、无警告，共 20 个包、约 10 MB、1–2 秒（pnpm 存储已有缓存；没有测冷缓存）。
- **和旧 Browser 同装会被连带失败**（复现）：`@anweat/dsh-browser` 0.2.1 及更早的 dev 版把 `@jackwener/opencli`（有 postinstall）列为依赖，pnpm 11 默认拦下它的构建脚本，`dsh plugin add` 以 `ERR_PNPM_IGNORED_BUILDS` 退出码 1 失败。包其实装上了，但宿主只把“新增依赖”加入 profile 的 `dsh.profile.bundles`，所以失败的那次里的**两个插件都没有被启用**；此后在这个 profile 里再 `add` 任何包（本插件单独装、甚至无关的 `is-odd`）都因为同一个被忽略的构建而失败，pnpm 还会往 `pnpm-workspace.yaml` 里写一条 `allowBuilds: '@jackwener/opencli': set this to true or false`。本插件不能在自己这边修这个问题；修在 Browser 0.2.2（OpenCLI 改为可选 peer，按 PATH、全局 npm 目录等找；系统 Chrome / Edge 顶替没下载过的 Playwright Chromium）。用 Browser 0.2.2 的候选包验证：三个宿主上 Browser + 本插件一起装、先本插件后 Browser、再装无关包，退出码都是 0，bundles 里两个插件都在。
- **playwright / patchright**：两个包都没有 install / postinstall 脚本，不会在安装时下载浏览器，所以不存在“脚本被忽略后怎么办”；缺的是浏览器本身，见上一节（本插件说清楚，dsh-browser 自动用系统 Chrome / Edge）。同装 74 MB（旧 Browser，含 OpenCLI）→ 50 MB（Browser 0.2.2，不含 OpenCLI）。
- **README**：新增“新用户第一次安装 / 第一次使用”两段，写明 Browser 0.2.2 起才能同装、OpenCLI 与浏览器怎么装、没有浏览器时会看到什么。

### 验证（宿主两条线与分发，2026-10-28）

见 `docs/validation/2026-10-28-host-lines-and-install.md`。

### 设置里的搜索顺序、自定义 CLI 与置信度（2026-10-27）

用户原话：“把默认搜索参考顺序和 cli 加入都做到设置中，允许自定义加入可用的 cli 软件和命令，并将结果打包返回，自定义的也可以加入置信度”。Config schema 只增不改（`sources.confidence`，volatile）；兼容范围不变。

- **搜索顺序（新分组，在“常用”之后，默认折叠）**：`engines` 是可排序列表（位置、名称、就绪、置信度、上移 / 下移 / 移除、下拉添加、“恢复默认顺序”＝ `unset engines`），下面是实际生效顺序和一句“为什么和列表不同”（新纯函数 `explainChain`，与 `effectiveChain` 同一规则）；平台后端顺序每个平台一行 + 弹窗，可选后端 = 内置后端 + 声明服务该平台的自定义 CLI，“恢复默认”删除该平台的键。`platformBackends` / `cliAdapters` 的原始 JSON 移到“高级”。
- **自定义 CLI（新分组）**：列表 + 表单弹窗（命令、参数 token、自动推出的子命令、输出格式、整段输出、结果路径、字段路径、超时、用途、置信度、高级项）+ “查看 JSON” 双向同步；服务端的校验函数实时校验，消息显示在对应控件旁。规格新增 `engine`、`confidence`、`search.output.lines: { mode: whole }`（见 README“CLI 适配”）；`platforms` 现在是声明服务的平台（只做通用引擎时可为空）。**偏离旧行为**：`platformBackends.<平台>` 里放 `custom-cli:<id>` 现在要求它的 `platforms` 声明了该平台（之前任何平台都接受）。
- **整段输出**：stdout 整体一条结果，标题“`<id>: <查询>`”、链接 `cli://<id>?q=…`、文本截断并注明；证据管线**不抓取**这种链接（只列为来源，不占读页名额）。
- **结果打包**：自定义 CLI 的结果与其他来源同一结构，另带 `via`、`confidence`（低于 1 时）、`tag`（“user-defined, not verified by the plugin (用户自定义，未经插件验证)”）；`search.run` 输出 schema、文本渲染、证据摘录行、缓存与 `sources.status` 同步（`providers[].confidence`、`chain[].confidence`、`sources.confidence`）。
- **置信度**：`factor(c) = 1 − 0.2·(1 − c)`，乘到每个来源的 RRF 项上，并乘到“只有存疑来源返回的 URL”的加分上；c = 1 不乘，所以内置来源全是 1 时融合分数与原来逐位相同（单元测试固定，`bench:eval-pack` v1 / v2 报告与改动前逐字段相同，bench 94 项测试通过）；存疑来源最好的一条仍保证留在展示的列表里。
- **试运行 / 实时就绪**：插件在宿主的连接传输上注册私有通道 `/dsh-web-search-pro`（照 dsh-browser 的做法，没有该服务的宿主上不注册，面板照常工作并提示改用 `web_call` 的 `sources.status` / `search.run` 测试）：`status`（各来源和链上各后端的就绪、原因、置信度）和 `trial`（用面板里还没保存的规格真的探测并搜一次，显示解析出的前三条和工具原话；先过同一套只读校验，不登录，不保存任何东西，受 `enableCliBackends` 控制）。
- 测试：新增 55 项（置信度公式与不变性、整段输出、规格字段、顺序编辑产生的 patch、`explainChain`、表单 ↔ JSON、面板渲染、RPC）。

### 设置顺序、重启项标注、agent 覆盖层与 `config.*` 动作（2026-10-27）

用户原话：“设置文件怎么调整下设置顺序，怎么方便用户配置也可以想想，要不要设置外置便于agent修改和实时载入，还是某些写在设置profile中需要重启插件列表。”批准的方案：profile 配置是用户的基线，留在原处并重新排序；标出要重启的项；新增一个 agent 可改、实时生效的覆盖层和 `config.*` 动作；**不做**“agent 直接改一个被监听的自由文件”。Config schema 的字段名、默认值和语义不变，兼容范围不变。

- **顺序**：`Config` 的字段按设置页的分组重排（常用 → 搜索顺序 → 来源与密钥 → 自定义 CLI → 读取与证据 → 平台与运行时 → 高级与诊断；`sources` 内为 priority、disabled、confidence、budget）。宿主的通用配置视图、`--dump-config` 和设置面板的文本视图都按这个顺序；文本视图改为按同样的分组分节，带中文 / 英文分节标题。一个测试把 schema 钉在 `src/config-groups.ts` 的分组表上，每个字段属于且只属于一个分组。
- **重启项**：查明启动时只读一次的设置有 8 个——`toolSurface`、`playwright.snapshotDir`、`providerId`、`registerProvider`、`timeoutMs`（每个动作的截止时间与宿主工具上限；搜索内部的协作超时预算是热的）、`memoryCacheEntries`、`dbPath`、`verbose`，集中在 `src/restart.ts` 的 `RESTART_FIELDS`。设置面板里这些行带“重启插件后生效”标记和原因，保存时改到了它们保存条会提示，状态摘要显示“待重启 N 项”；`sources.status` 和 `config.inspect` 写出“待重启：<字段>（当前生效 X，配置为 Y）”。一个测试扫描源码里对启动时配置副本的读取，新增而没登记会失败。
- **agent 覆盖层**：`$DSH_HOME/data/web-search-pro/overlay.json`（与 `dbPath` 同目录），含版本、`revision`（乐观锁）、sha256 校验和、`values`、50 条审计；临时文件 + 改名，0600；按 mtime 和大小缓存重读，无 fs.watch。只能覆盖 `engines`、`sources.priority` / `disabled`、`sources.confidence.<id>`、`platformBackends.<平台>`、`cliAdapters.<id>`，且只能新增或替换。`dynamic()` 返回“基线 + 覆盖层”，所有消费者下次调用就生效；加载时用与改动同一批函数严格校验，解析失败 / 校验和不符 / 值被拒 / 与基线不再一致就**整体忽略**并在 `sources.status` / `config.inspect` 报告，绝不只应用一半。做法照 `@anweat/dsh-browser` 的策略覆盖层，没有跨包 import。
- **`config.*`（新动作组，`web_index` 里出现）**：`inspect`、`set_order`、`set_confidence`、`upsert_cli`、`remove_cli`、`reset`、`export`。每次写入要有 3–300 字符的 `reason`，可带 `expectedRevision`；成功后 `revision + 1`、写审计（时间、动作、键、前后值摘要、reason、sessionId）、立即生效；没有变化的写入不落盘。审批：**`config.upsert_cli` 一律先问用户**（提示里写命令、搜索与探测参数模板、环境变量名），其余不问；`dsh-browser.automationMode=read-only` 时全部拒绝（偏离简报：简报只说“不需要审批”，这里让只读模式也拦住写入，与 `cache.clear` 等一致）。**headless 下**宿主对“询问”一律拒绝（无 `approval` 服务按插件理由拒绝；有服务但无应答者得 `unavailable` 也拒绝；策略 `never` 直接拒绝），所以 headless 的 agent 加不了 CLI；测试把宿主这几处逻辑固定住，宿主升级后若行为变了会报警。
- **设置面板**：被覆盖的行（引擎顺序、优先 / 停用、平台后端链、置信度、自定义 CLI）带“agent 修改”标记，悬停看值、reason、时间；新分组“agent 修改”列出全部覆盖项与最近审计，每项“采纳到配置”（用保存条同款的原子 `mutate` 写进 profile，成功后才经 RPC 删掉这一项覆盖）和“撤销”，另有“全部撤销”（也用来修复被忽略的坏文件）和“刷新”；只在覆盖层里的 CLI 列在自定义 CLI 列表下面。RPC 通道 `/dsh-web-search-pro` 新增 `overlay`、`overlay.revoke`，`status` 带上覆盖层摘要与待重启项。
- **测试**：新增 54 项（935 → 989，另有 8 项需真实命令的跳过）（分组顺序、覆盖层文件读写 / 损坏 / 冲突 / 审计上限 / 合并、各 `config.*` 的参数与效果、审批与 headless、重启项检测与扫描、面板标记与采纳 / 撤销的 patch 与 RPC 调用）。测试进程使用一次性的 `DSH_HOME`，不会碰真实目录。

### 审批前先校验参数（2026-10-27）

要审批的动作（`config.upsert_cli`、`cache.clear`、`history.delete`、`rules.*`、`sources.install`）现在先做和 `runAction` 同一套的参数校验（参数 schema，外加动作可选的 `precheck`；`config.upsert_cli` 的 `precheck` 就是写覆盖层时用的那套完整 `id` / `spec` 校验，一条一条列出问题），不合法就不问用户：钩子直接放行，`runAction` 在 `execute` 之前返回 `INVALID_ARGS` 和 schema，不执行、不写覆盖层、不记审计。之前真实模型会话里 `config.upsert_cli` 连 `id` 和 `spec` 都没给就进了审批，headless 下被拒（“requires approval, but no approval channel is available”），模型拿不到 schema。参数合法时审批判定不变；`automationMode=read-only` 下，合法的写入照样被拒，不合法的返回 `INVALID_ARGS`（没有东西会执行，给模型 schema 比一句拒绝更有用）。校验自身出错不会卡住调用。新增 8 项测试（含 flat 工具面与无审批渠道的宿主）。

### 修复：热重载后设置页样式丢失（2026-10-28）

宿主热重载插件时页面不刷新，旧版本注入的 `<style id="web-search-pro-settings-styles">` 还在，而注入函数见到它就直接返回，新版本的类名没有任何规则，设置卡片只剩文字、没有框（桌面端升级后出现，完全重启桌面端后恢复）。现在已有的 `<style>` 会换成当前版本的 CSS。

### DeepSeek 搜索（引擎 `deepseek`，“常用”）

- 新的原生搜索引擎，描述符 `common: true`（成本层级 `paid`，语言 `zh` + `en`）。Key 与插件其他密钥一致：设置里的密钥字段 → DSH 凭据引用（默认 `DEEPSEEK_API_KEY`，`keyedSources.deepseek.apiKeyEnv` 可改）→ 进程环境变量；`keyedSources.deepseek.baseUrl` 可改接口，默认 `https://api.deepseek.com/v1/tools`。值不进日志、状态输出、错误信息和历史。
- **“常用”的优先级**：解析到 Key 时，中英文任务都排第一——证据模式的自动规划里排在 Exa / 博查 / 其余需 Key 来源之前（规划排序：已配置 Key → 常用 → 描述符 `priority`），没有 `engines` 的普通搜索也先用它（`engines` 仍是默认列表时）。顺序规则：调用里的 `engines` / `platform` > `sources.priority` / `sources.disabled` > 默认规则；请求额度 `sources.budget.deepseek` 照常生效。`sources.status` 的“常用 (common)”行、provider 行、`search.recommend` 的“常用”标记都会显示；没有 Key 时它不进默认链，`sources.status` 写明配置方法。
- **字段映射**：`summary`（给模型看的长摘要）→ 摘录文本（截到 1000 字符，去掉与标题重复的一级标题；没有就用 `snippet`），`date` → `publishedAt`，`rerank_score`（0–3）→ `rerankScore`、`authority`（0–4，-1 视为未知不给）→ `authority`，作为来源元数据随结果输出并显示为 `[rerank 2.3/3, authority 4/4]`（`search.run` 的输出 schema 新增这两个可选字段）。不请求 `content`。
- **证据评分里的权重（保守）**：只用在候选融合（S3），与已有的新鲜度 / 权威域名加分同类：加分 = `0.3 ×（0.7 × rerank/3 + 0.3 × authority/4）` 个“排名单位”。三项加分全拿满也只有 0.75 个单位，所以只在并列时分先后，不能把第 10 名抬到第 1 名之上；一个 URL 被多个来源返回时每个字段取最大值，不叠加；其他来源不带这些字段，一分不加。块级评分不变。
- **查询**：编成服务支持的运算符——硬 `site` / `exclude_site` / `exclude_term` / `time_window` → `site:a OR site:b`、`-site:`、`-词`、`after:YYYY-MM-DD`；`ori_question` 用任务的 `goal`（没有则第一个关键 need），截到 128 字符。查询超过服务的 128 字符上限时，保留全部运算符、截掉自由文本的尾部，并在结果说明里写明（引擎的 `notes` 现在也会进入证据包的 `notes`）。
- **错误与重试**：408 / 429 / 5xx 最多共 3 次、等待取 `Retry-After`，否则 0.8 s / 1.6 s（`Retry-After` 超过 8 s 不干等，作为冷却时间）；**402 → `ENGINE_QUOTA` 并提示“余额不足”、去 platform.deepseek.com 充值**；401 / 403 → `ENGINE_AUTH`；其余 4xx 不重试；错误信息带 `request_id`，不含 Key。只有“有结果的 200”记入用量账本（`deepseek-search` / `deepseek-fetch`）。
- **抓取后端（默认关闭）**：设置 `deepseekFetch: true` 后 `read.fetch` 的 `mode: auto` 在 Jina、直连都没拿到正文时用 Fetch API（Markdown），之后才轮到浏览器渲染；`mode: deepseek` 显式指定（未开启时说明原因，不会偷偷花钱）。403 / 404 是 DeepSeek 自己的判断，不是目标页面的 HTTP 状态，错误信息这样写，`auto` 下记成失败的尝试。
- 设置面板：需 Key 的来源里第一项就是“DeepSeek Search / Fetch”，带“常用”标记，默认展开，含 `deepseekFetch` 开关；README、skill（含 `references/`）、目录（`catalog/sources.v1.json`，`common: true`）同步更新。
- 其他：`ProviderDescriptor.common`、目录条目 `common` 为新增字段；`ProviderOutcome` 的 `notes` 与 `SearchOutcome.sources` 的 `rerankScore` / `authority` 为新增可选字段；`search.recommend` 对没配置 Key 的付费来源仍按“免费的在前、付费的在后”排，所以 DeepSeek 没配置 Key 时不会被强行塞进三个推荐（直接问 `platform: deepseek` 会得到配置说明）。

### 设置面板改版（照 `@anweat/dsh-browser` 0.2.2 的做法）

用户反馈 Browser 设置页“文字和框体太多、不知道怎么配”，Web Search Pro 的面板有同样的问题（实测：10 个分组、110 个控件、119 条说明行，全部展开约 10,000 px；默认展开 3 组就是 19 个控件、20 条说明）。重做后保存结构、Config schema、运行时行为不变，现有测试继续成立。

- **信息架构**：顶部状态摘要（实际尝试顺序的默认引擎链、已配置 Key 的来源数、“常用”的 DeepSeek 是否就绪、内置 web 路由、评分模型、工具面、校验提示数）；九个手风琴分组（常用 / 来源 / 读取与证据 / 评分模型 / 内置 web 工具路由 / 运行时与后端 / 网络与缓存 / 排序加权 / 高级：文本模式），**默认只展开“常用”**（默认展开：3 个控件、6 条说明）；固定在底部的保存条（“N 项未保存的修改”、放弃、保存）。
- **控件**：下拉（工具面、来源策略、评分 / 覆盖模式、provider）、开关（带“网络 / 计费 / 调用模型”风险标注）、带单位的数字输入、引擎 / 来源 id / 域名的标签输入；每个字段一行说明，长说明在 `?` 气泡里；“已覆盖”徽标 + 就地“恢复默认”。
- **列表 + 弹窗**：来源（每行：名称、付费 / 免费额度 / 免 Key、“常用”、Key 已设 / 未设、请求上限；弹窗：Key 引用名、遮罩的写入式密钥、接口地址、请求额度）；评分 rubric（每行：生效版本、默认 / 已覆盖；弹窗：默认文本与你的覆盖左右对照，窄屏上下）；JSON 对象（自定义 provider、按 provider 上限、Playwright、平台后端顺序、CLI 适配、自定义平台、选择器覆盖、浏览器绑定：每项一个弹窗，校验信息与服务端一致）；Twitter / X 登录值（弹窗）。弹窗里的改动先留在草稿里，点保存才写入。
- **高级：文本模式**：当前草稿的设置（不含密钥）打印成每个键前都带注释的 YAML（用途、取值或范围、默认值、风险，中英文随界面语言）；只读视图，可复制；去掉 `#` 行后恰好是你覆盖的键（测试覆盖往返、嵌套、密钥不出现）。
- 新增可选 peer `@deepseek-ai/dsh-client-ui-primitives`（与其他 `dsh-client-*` 同一范围；开关、按钮、徽标、弹窗、`?` 气泡用宿主的组件），客户端 bundle 的允许清单、`minimumReleaseAgeExclude`、devDependencies 同步；新增纯模块 `default-chain.ts`（路由器与摘要共用的默认引擎链规则）和 `config-fillers.ts`（服务端与面板共用的“去掉宿主 schema 填的空容器”）。

### 修复：面板保存 `evidence` / `provider` / `sources` / `playwright` 在 rc.3 宿主上被拒绝

- 旧面板（0.2.2 与 0.2.3 开发版改版前的同一份代码）把 `evidence`、`provider`、`sources` 作为**整个容器**写回，宿主（`dsh-settings`）只接受声明了 `.volatile()` 的字段之下的编辑，整体写容器报 “Config field … is not volatile”，面板显示“Host 未接受全部修改”，同一次保存里排在后面的修改（包括密钥）也不会落盘。在 rc.3 的真实面板上复现并修复（rc.2 宿主没有测）：现在一次保存是**一个原子的 `mutate`，按字段路径逐项写**（`evidence.maxRounds`、`sources.budget.deepseek.daily`……），恢复默认 `unset` 那一项；`playwright` 逐键写（`snapshotDir` 现在声明为 volatile）。密钥只在设置写入成功之后才写。不认识的同级键原样保留；宿主不会清掉恢复默认后留下的空容器（`evidence: {}`），无害。
- 另一个老问题：宿主的 schema 解析器会在 `evidence.coverage` 下填一个空的 `thresholds: {}`，面板把它当成“给了阈值”，默认就报 “thresholds.weak must be a number in 0..1”；现在和服务端一样先去掉这些填充物再校验。
- 测试里的 Host 替身现在按宿主的规则拒绝不在 volatile 字段之下的路径，并有一条测试固定“卡片写的每个字段都在 volatile 节点之下”。

### 登录类平台改走 OpenCLI（2026-10-27 实测，opencli 1.8.8）

**原则：登录完全交给用户。** 插件不提供登录流程，不运行任何登录命令，不读浏览器 Cookie；“缺登录文件就跳过”的闸门不变。推荐在日常 Chrome 里登录小红书、知乎、Reddit、X，并装好 OpenCLI 与 OpenCLI Browser Bridge 扩展；独立 CLI 是可选后备，用工具自带的登录命令，由用户自己运行。

- **默认链**：reddit `opencli → rdt → browser-opencli`，twitter `opencli → twitter → browser-opencli`，zhihu `opencli → zhihu → browser-search`（xiaohongshu 仍是 `opencli → xhs → browser-opencli`）。前一个后端失败（未登录、被风控、opencli 不可用）就落到下一个，结果的 `notes` 写 `skipped backends: <id>: <原因>`；只有一个后端出错而其他后端被跳过时，错误现在也列出被跳过的后端（原来只有那一个错误）。用户显式配置的 `platformBackends` 不变。
- **调用参数**：opencli 的浏览器命令支持 `--window`、`--site-session`、`--keep-tab`（默认值已是后台窗口、临时会话、不保留标签页；omnireach 也显式传）。插件现在显式传 `--window background --site-session ephemeral --keep-tab false`，不抢 Chrome 焦点、用完关标签页；只对 `browser: true` 且 `opencli <site> search --help` 列出这三个参数的命令传（本地探测，不搜索），否则不传。`scripts/cli-login-check.mjs` 使用同一份计划（`planOpencliSearch`）。
- **按站点映射**：twitter（**live**）——标题是正文，摘要 `@作者 · likes · views · 时间`（照 twitter 后端），`created_at`（`Tue Oct 27 08:38:08 +0000 2026`）转成 ISO；zhihu（**live**）——`类型 · 作者 · 赞同 N`，工具本身没有摘要和时间，不编造。xiaohongshu、reddit 这次没拿到成功输出（见下），映射取自 opencli 1.8.8 适配器源码的输出列，**未实测**，仍是 contract-only，并在规格说明、`sources.status` 和目录里写明。
- **opencli 错误映射**（规格新字段 `errorCodes`，与其他规格字段同样校验）：`AUTH_REQUIRED` / 退出码 77 → `CLI_NOT_LOGGED_IN`，提示“在你的 Chrome 里登录 <站点> 后重试（opencli 使用 Chrome 的登录态）”，不再提示 `opencli <站点> login`（规格新字段 `login.hint`）；`LOGIN_WALL`、`SECURITY_BLOCK`、`RATE_LIMITED`、`FORBIDDEN` 以及 Reddit 实测的 `Unexpected token '<' … is not valid JSON` → `CLI_FAILED`，消息写“站点返回了网页而不是数据，可能是风控、IP 被拦或需要登录”并给出检查办法；`EMPTY_RESULT` → `ENGINE_EMPTY`，`BROWSER_CONNECT` → 连不上浏览器扩展，`TIMEOUT` → `ENGINE_TIMEOUT`，参数类错误 → `CLI_CONTRACT_MISMATCH`，其余保留 `[CODE] 原话`。任何 json / yaml 命令输出了 HTML 文档，对所有规格都按“站点返回了网页”报告（原来是笼统的 `CLI_CONTRACT_MISMATCH`）。
- **xhs**：规格改为 **live**（用户自己的登录实测）。`corner_tag_info` 里的 `publish_time` 映射为 `publishedAt`（新字段来源 `{ time }`：`MM-DD` 取最近一个不晚于今天的日期、`YYYY-MM-DD`、`N分钟前` / `N小时前` / `N天前`、`昨天 HH:MM`，按中国时间；认不出的不填）；结果里的 `hot_query` 建议卡片（有 id 无 `note_card`）用新的 `output.skipWhen` 丢弃，不计入“无链接被跳过”。
- **规格新增（有校验，不影响已有规格）**：`{ time: 路径 }` 字段与拼接项、路径里的 `key=value` 段（取数组里第一个字段等于该值的元素）、`output.skipWhen`、`search.errorCodes`、`login.hint`（与 `login.command` 二选一）。
- **目录与说明**：`sources.status`、`search.recommend`、`catalog/sources.v1.json`（四个平台条目、`opencli` 条目的安装说明与验证记录；新增 `twitter-cli` 条目，与 `xhs` / `zhihu-cli` / `rdt` 并列）、README、skill、`docs/validation/cli-login-checklist.md` 同步。`search.recommend` 的“未验证”标注现在跟着平台的首选后端走（Twitter 经 OpenCLI 已是 live，不再被标成未验证）。
- **夹具与测试**：`test/fixtures/cli/live-opencli-twitter-search.json`、`live-opencli-zhihu-search.json`、`live-xhs-search.json`、`live-opencli-xiaohongshu-auth-required.yaml`、`live-opencli-reddit-html-error.yaml` 按真实输出的**形状**做，内容一律是合成的占位值（仓库公开）；`constructed-opencli-reddit-search.json` 是未实测的 Reddit 形状。新增 `cli-opencli-chain`（回退顺序、被跳过的原因、调用参数）、`cli-opencli-sites`、`cli-opencli-errors`、`cli-time-text`、`cli-xhs-live` 共 20 项测试。

**实测结论（2026-10-27，用户在场，opencli 1.8.8，未升级）**：`opencli twitter search` 与 `zhihu search` 成功；`opencli xiaohongshu search` 退出码 77 `AUTH_REQUIRED`（那个 Chrome 里没有小红书登录）；`opencli reddit search` 退出码 1，Reddit 返回的是网页——这台机器的网络是代理出口，Reddit 登录页也显示“网络安全部门已屏蔽你的请求”，**Reddit 在代理 IP 下会被拦**；`xhs search` 用用户保存的登录成功，一次 22 项，其中 2 项是 `hot_query` 卡片。修复后各重跑一次：xhs 3 条带发布时间，opencli twitter 3 条（带 ISO 时间），opencli zhihu 3 条，xiaohongshu / reddit 报出新的、明确的错误。没有运行 zhihu / rdt / twitter 三个独立 CLI 的搜索（没有登录文件，闸门会跳过）。

### 验证

- 真实面板（DSH 0.2.1-rc.3 桌面端运行时，隔离 home，Web profile，端口 3395）：改版前后截图、浅 / 深色、420 px 窄宽度、来源弹窗、rubric 弹窗；真的点了一次保存：`cordis.patch.yml` 的 `web-search-pro` 条目写出 `searchMaxResults`、`deepseekFetch`、`evidence.maxRounds`、`sources.disabled`、`sources.budget.deepseek.daily`，密钥只进了凭据文件，不在 patch 里；之后把文件还原。
- 831 项插件测试（新增面板、保存路径、文本视图、列表与弹窗、状态摘要共 16 项，并重写了面板渲染测试）、94 项 bench 测试、类型检查、`test:peers`、构建与客户端 bundle 检查通过。

### 验证（DeepSeek 搜索 / 抓取）

- 真实调用 **8 次 Search + 4 次 Fetch**（`docs/validation/dsh-web-search-pro-0.2.3.md`）：结果结构与全部字段、`site:` / `-site:` / `after:` 运算符、128 字符上限（HTTP 400）、401 / 404 错误体、Fetch 的 Markdown 都按预期；与文档不一致的地方（`summary` / `snippet` 长度远超文档所写；乱码查询仍返回低 `rerank_score` 的结果而不是空数组）写在记录里。**没有亲眼验证**：403 的 Fetch 拒绝、402、408 / 429 / 5xx 与重试路径（只用模拟响应测试）。
- DeepSeek 部分新增 25 项测试（见上文总数）。

## 0.2.2（未单独发布，内容并入 0.2.3）

> 0.2.2 没有发布到 npm：它的设置面板在 rc.3 宿主上保存部分分组会被拒绝，修复依赖 0.2.3 的代码，所以直接发布 0.2.3。下面的内容都包含在 0.2.3 里。

适配 DSH 0.2.1-rc.2 / 0.2.1-rc.3 宿主，并修复 twitter 平台源返回错误结果的问题（[#38](https://github.com/anweat/dsh-web-search-pro/issues/38)，感谢 @gogososonono 的报告与根因分析）。npm 上的 0.2.1 的 peer 是 `<0.2.1-0`，在 0.2.1-rc.x 宿主上会被安装闸门拒绝；本版是第一个能装进 0.2.1-rc.x 宿主的发布（0.2.2 / 0.2.3 曾在内部分开记录，从未发布，这里合并为 0.2.2）。除下面 #38 的修复外没有功能变更，也没有破坏性变更；0.2.1 的配置与数据照常可用。

### 宿主适配（DSH 0.2.1-rc.2 / 0.2.1-rc.3）

- peer 基线：所有受管的 `@deepseek-ai/dsh-*` peer 从 `>=0.2.0-rc.2 <0.2.1-0` 移到 `>=0.2.1-rc.2 <0.2.2-0`，同时覆盖 `0.2.1-rc.2` 与 `0.2.1-rc.3`（单基线策略不变：0.2.0 线整体拒绝，0.2.2 的预发布也被上界挡掉）。`@deepseek-ai/cordis` peer `~4.0.5`、`@deepseek-ai/schemastery` peer `^3.18.5`；可选 Browser peer 仍是 `^0.2.0`（与 0.2.1-rc.x 配套的是 `@anweat/dsh-browser` 0.2.2 起）。
- devDependencies：`@deepseek-ai/dsh-*` 全部 → `0.2.1-rc.3`；cordis `^4.0.5`、schemastery `^3.18.5`、cordis-plugin-group `1.0.5`、cordis-plugin-include `1.0.10`、cosmokit `~1.8.6`、`@anweat/dsh-browser` `0.2.1`（最新已发布版）。rc.2 → rc.3 的宿主改动（导航入口自定义、菜单图标、analytics、DeepSeek API-key 路线跟随官方 /models）不涉及插件使用的 API，插件源码与 `lib/` 无需改动。
- 随宿主生态调整：`@deepseek-ai/dsh-invariants` 在 0.2.1 线不再发布，本插件也从未 import 它，从 devDependencies 移除；0.2.1 线把 `dsh-llm` / `dsh-session` 改成 peer-only，宿主 `autoInstallPeers: false` 不会自动装，故显式加入 devDependencies；新增宿主包 `dsh-working-directory`（原 `dsh-invariants` peer 位置）。不补这些时，测试在 import `@deepseek-ai/dsh-tools` 时会报 `ERR_MODULE_NOT_FOUND: @deepseek-ai/dsh-llm`。
- `pnpm-workspace.yaml` 的 `minimumReleaseAgeExclude` 改为 `@0.2.1-rc.3`。
- `test/compat/check-peer-ranges.js`：受支持基线为 `0.2.1-rc.2` 与 `0.2.1-rc.3`；`0.1.7-rc.2` / `0.2.0-rc.1` / `0.2.0-rc.2` / `0.2.2-alpha.1` 在两种解析模式下都拒绝；`--selftest` 16 条已知行为通过。

### 修复 #38（twitter）

- 修复：twitter 规格原来用 `url-lines` 解析 `twitter search` 的默认输出，而 twitter-cli 在 stdout 不是终端时默认打印 YAML，于是头像、视频、`t.co` 链接和 `profileImageUrl:` 之类的字段名都被当成结果。现在执行 `twitter search QUERY -n N --json`，按 `{ ok, schema_version, data[] }` 信封解析：永久链接由 `author.screenName` 与 `id` 拼出，标题取推文正文（折成一行），摘要含作者、赞 / 转 / 阅读数与 ISO 时间；失败信封里的 `error.message` 原样给出，未登录按工具自己的错误码判定。探测要求 `search --help` 含 `--json`，旧版 twitter-cli 报 `incompatible` 并写明已知可用的最低版本 0.8.5。
- twitter 凭据：`TWITTER_AUTH_TOKEN` / `TWITTER_CT0` 现在和插件其他密钥一样解析——设置里的 `twitterAuthToken` / `twitterCt0`（密钥角色）→ DSH 凭据引用 `twitterAuthTokenEnv` / `twitterCt0Env`（默认即这两个变量名）→ 宿主进程环境变量；值只通过子进程环境变量交给 `twitter`，不进命令行、日志，错误信息里已脱敏。缺失时 `sources.status` 写明查过哪里，并提示“只写 shell 配置文件宿主读不到”。设置面板新增两个密钥与两个引用名字段。
- 防止同类问题：内置规格不得使用 `url-lines`，且每条命令必须显式要求机器可读输出（`--json` / `-f json` / `--print` 等，测试覆盖全部内置与生成的 OpenCLI 规格；唯一例外 wx-search-cli 的帮助写明它只输出 JSON）；文本模式（`url-lines` / `tsv`，自定义适配会用到）遇到整段是 JSON 或 YAML 文档的输出时报 `CLI_CONTRACT_MISMATCH`，不再返回行；`url-lines` 丢弃只有 `key:` 标签的行，`tsv` 跳过没有制表符的行；失败时优先引用工具自己的错误信息。
- `sources.status` 与 `search.recommend` 对未经真实搜索验证的后端加一句标注（`contract-only — output parser not verified with a real search`），“已检测 + 已配置”不再容易被读成“能用”。
- yt-dlp 验证为 live：用规格的原始参数真实搜索一次并解析（夹具 `live-yt-dlp-search.txt`）。twitter 仍是 contract-only：契约来自 twitter-cli 0.8.5 源码与 issue 中的真实输出，我们自己没有用 Token 跑过搜索。

### 免登录 CLI 实测（2026-10-26，`docs/validation/cli-live-2026-10-26.md`）

对 bili、gh、omnireach、yt-dlp、wx-search-cli 和 mcporter→Exa 用插件自己的探测与运行器做了真实中文/英文/特殊字符/无结果查询，并在 rc.3 宿主上跑了 3 个 headless 会话。发现并修复：

- gh：查询原来作为一个参数交给 `gh search`，gh 会把它当精确短语，四个词以上的查询搜不到东西，`repo:x 多个词` 还是无效查询。新增占位符 `{terms}`（按词拆成多个参数，引号保持短语），gh 三条搜索都用它；issues / code 搜索首次真实运行并解析。
- yt-dlp：直播没有播放量和时长，yt-dlp 输出 `NA`，规格只把 `None` 当空值，摘要出现 “NA views | NA”；现在两者都当空值，时长改为 `H:M:S`（`duration_string` 对短视频只打印秒数 “11”）。
- omnireach：多源命令原来用工具自己的自动路由，PATH 上有 `opencli` 时它会加入走你 Chrome 的 google / twitter 源（实测确认，并用替身 `opencli` 复现）；现在显式 `--on hackernews,youtube,github,wechat,bilibili`，测试用替身 `opencli` 断言从不被调用。
- omnireach / httpx：DSH 宿主进程的 `NO_PROXY` 含 `[::1]`，httpx 因此对所有源报 “Invalid port: ':1]'”，wechat 链悄悄回退到 wx-search-cli（宿主会话里发现）；`buildCliEnv` 现在把 IPv6 条目写成不带方括号的形式。
- bili：约五分之一的条目是没有链接的课程/系列，请求 3 条只返回 2 条；规格新增 `overfetch`（多要 3 条再截取）。
- 平台链回退说明：被跳过的后端原来只写 “unavailable”，现在带原因（“the omnireach command is not installed: install it …”）。
- wx-search-cli 升为 live；规格 `live` 现为 bili、gh（repos/issues/code）、omnireach、yt-dlp、wx-search-cli。新增 `test/cli-live.test.ts`（默认用夹具离线跑；`WSP_LIVE_CLI=1 pnpm run test:live-cli` 才跑真实工具）。
- 登录类 CLI 陪测：`docs/validation/cli-login-checklist.md` 与 `scripts/cli-login-check.mjs`（由用户本人运行；默认不运行任何登录命令）。

### 验证

- 790 项插件测试、94 项 bench 测试、类型检查、`test:peers`、构建与客户端 bundle 检查通过。
- 真实宿主验收见 `docs/validation/dsh-0.2.1-rc.3.md`。

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

## 兼容与发布通道（历史）

各发布通道对应的宿主基线与兼容承诺。当前版本的兼容范围见 [README](./README.md#兼容性) 与 [兼容范围](docs/guide/compatibility.md)；0.2.x 各版本的详细变化见上面对应小节。

| 插件发布通道 | DSH 基线 | 兼容承诺 |
|---|---|---|
| `0.1.11` 及更早的维护版本 | `dsh-v0.1.1-rc.2` | 旧基线；不再维护，不与新插件混装 |
| `0.1.15` | `dsh-v0.1.7-rc.2` + Browser `0.1.15` | 精确锁定该宿主版本；**仍停留在 DSH 0.1.x 宿主或 dsh-browser 0.1.x 的用户请使用这一版**（后续不再更新） |
| `0.1.17` | `dsh-v0.1.7-rc.2` ~ `dsh-v0.2.0-rc.2` + Browser `0.1.17` | 过渡版本，已不再演进；新功能不会回到这条线（2026-10-29 核对：npm 上 `dsh-web-search-pro` 没有发布过 0.1.17，0.1.x 线实际最后一版是 0.1.15） |
| `0.2.0`（正式版） | **只支持 `dsh-v0.2.0-rc.2` 这一条线**（peer `>=0.2.0-rc.2 <0.2.1-0`）+ 可选 `@anweat/dsh-browser ^0.2.0` | 第一个 0.2.0 线版本，**破坏性变更**（见 [0.2.0-rc.1](#020-rc1预发布) 的“破坏性变更”）；711 项单元测试、94 项 bench 测试，`pnpm run test:peers` 两种解析模式检查，真实 Host（DSH 0.2.0-rc.2）验收 |
| `0.2.1` | 同 `0.2.0` | 独立 CLI 适配层与平台后端链，无破坏性变更；774 项单元测试、94 项 bench 测试，真实 Host（DSH 0.2.0-rc.2）验收 |
| `0.2.2`（未单独发布，并入 0.2.3） | **只支持 `dsh-v0.2.1-rc.2` / `dsh-v0.2.1-rc.3`（0.2.1 线）**（peer `>=0.2.1-rc.2 <0.2.2-0`）+ 可选 `@anweat/dsh-browser ^0.2.0`（配套 `0.2.2` 起，旧的 0.2.0 / 0.2.1 只适用于 0.2.0-rc.2 宿主） | 适配 DSH 0.2.1-rc.2 / rc.3 并修复 twitter 平台结果全错（[#38](https://github.com/anweat/dsh-web-search-pro/issues/38)）；无破坏性变更。npm 上的 0.2.1 在 0.2.1-rc.x 宿主上会被安装闸门拒绝。twitter 的搜索输出契约来自 twitter-cli 0.8.5 源码与 issue 里的真实输出，我们自己没有用 Token 跑过搜索。详见 [0.2.2](#022未单独发布内容并入-023) |
| `0.2.3` | **两条宿主线同时支持**：`dsh-v0.2.0-rc.2`（0.2.0 线）与 `dsh-v0.2.1-rc.2` ~ `rc.4`（0.2.1 线）；peer `>=0.2.0-rc.2 <0.2.1-0 \|\| >=0.2.1-rc.2 <0.2.2-0`，cordis `~4.0.4`；可选 `@anweat/dsh-browser ^0.2.0`（0.2.0 线配 Browser `0.2.0` / `0.2.1` / `0.2.2`，0.2.1 线配 `0.2.2` 起） | 接入 DeepSeek Search / Fetch API 并标为“常用”（按请求计费）；设置面板同步调整。无破坏性变更，但**已有 `DEEPSEEK_API_KEY` 的用户升级后默认搜索会走这个付费接口**（`sources.disabled: [deepseek]` 关闭）。宿主适配没有改任何运行时代码，验证见 `docs/validation/2026-10-28-host-lines-and-install.md`；测试数见 [0.2.3](#0232026-10-28) |
