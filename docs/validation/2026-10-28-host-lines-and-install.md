# 验证记录：两条宿主线（DSH 0.2.0-rc.2 / 0.2.1-rc.3 / 0.2.1-rc.4）与 npm 分发，dsh-web-search-pro 0.2.3

日期：2026-10-28。执行者：开发者侧代理（非独立验证者）。只写亲眼看到的结果。原始日志、探针输出和截图在仓库外的 `research/experiments/release-0.2.x-2026-10-28/`（截图 `*.png`，日志 `wsp-logs/`）。

## 被测对象与环境

- 插件：`worktrees/dsh-web-search-pro-dev`，分支 `dev/0.2.3`；用 `pnpm pack` 打出 tgz，以 `file:` 安装（和 npm 用户一样走宿主的安装闸门）。
- 宿主：从 npm 官方源装进 scratchpad 的隔离目录（不碰任何现有环境的宿主）：`@deepseek-ai/dsh` 0.2.0-rc.2、0.2.1-rc.3、0.2.1-rc.4。三个宿主干净安装后顶层 cordis 都是 4.0.5、schemastery 3.18.5（rc.2 宿主声明 `~4.0.4`，rc.3 / rc.4 声明 `~4.0.5`）。
- 隔离：每次测试用全新的 `DSH_HOME`（scratchpad 下），`wsp-web`（Web）与 `wsp-headless` 两个 profile 都由宿主自带模板生成（`--from-default-profile`）。没有读写 `~/.dsh`，没有占用 19387（Web 用 3399），没有碰桌面端，没有读凭据文件，没有跑模型会话，没有跑登录类 CLI。`npm_config_registry=https://registry.npmjs.org`；嵌套 pnpm 用 `npx pnpm@11.7.0` 的 shim（pnpm 11.7.0）。
- 无模型的探针：宿主不跑模型也能验证工具，所以写了一个一次性的探针插件（scratchpad，不在仓库里），在 `ready` 之后用宿主自己的 `ctx.tools.execute` 调 `web_index`、`web_call`，把结果写文件。这条路径经过宿主的 `tools/pre-execute`、审批服务和工具注册，等同于模型调用，只是没有模型。

## 一、0.2.0-rc.2 适配：评估

静态对照 `git diff dsh-v0.2.0-rc.2 dsh-v0.2.1-rc.3`（rc.4 没有源码 tag，靠真实宿主验证）。插件用到的接口逐项：

| 接口 | 0.2.0-rc.2 | 结论 |
|---|---|---|
| 设置面板原子 `mutate`、字段路径写入、`.volatile()` 校验（`ConfigForm.mutate`、`dsh-settings` 的 `isVolatilePath`） | 都在，语义相同；rc.3 只去掉了远程浏览器的“内存模式”（`persistence` 参数、`mode`），插件不读 | 无需改动 |
| 私有 RPC（`connection.rpc.handle`，`ctx.inject(['connection','webServer'])`） | 都在；处理函数签名 `(endpoint, payload, signal, peer)` 相同，rc.3 多了 Peer 的概念 | 无需改动；没有这两个服务时本来就不注册、面板提示 |
| 凭据（`credentialRef`、`credentials.resolve`、面板 `remote.credentials.describe/set`） | 都在；仅注释层面的语义差：rc.2 在只读来源遮蔽引用时 `set` 被拒绝，面板原样显示 | 无需改动 |
| `tools/pre-execute`（`allow / deny / ask`）、审批服务、没有审批通道时 `ask` → 拒绝（`serviceAsk`） | 都在，相同 | 无需改动 |
| `dsh-client-ui-primitives`（`Button / Modal / Switch / Tag / Tooltip`）、`plugins.bundle.config` 槽位、`configForms.whileServed`、`remote.credentials` | 都在 rc.2 | 无需改动 |
| `ctx.fiber.config` 热更新（`volatile` 字段） | 真实宿主验证通过（见下） | 无需改动 |
| 11 个受管 `@deepseek-ai/dsh-*` peer 包 | `npm view` 都有 0.2.0-rc.2 | peer 范围放宽即可 |

成本判断：没有任何“缺了就降级”的新分支，也没有需要另一套实现的地方，所以做了。改动只有 `package.json` 的 peer、`test/compat/check-peer-ranges.js` 与文档。运行时代码零改动。

peer：`>=0.2.0-rc.2 <0.2.1-0 || >=0.2.1-rc.2 <0.2.2-0`（11 个 dsh-* peer），cordis `~4.0.4`。用宿主自带的 `semver` 7 对 12 个版本逐个核对 runtime（`includePrerelease`）与 install（默认）两种解析：`0.2.0-rc.2`、`0.2.0`、`0.2.1-rc.2/3/4`、`0.2.1` 通过；`0.1.7-rc.2`、`0.2.0-rc.1`、`0.2.1-alpha.1`、`0.2.1-rc.1`、`0.2.2-alpha.1`、`0.3.0-rc.1` 拒绝；cordis 4.0.4 / 4.0.5 通过、4.1.0 拒绝。`test:peers` 的最小实现与它们一致。

## 二、三个宿主上的验证（只装本插件）

### 安装闸门

| 宿主 | `dsh plugin --profile <p> add file:<tgz>`（web / headless） | 备注 |
|---|---|---|
| 0.2.0-rc.2 | 退出码 0 / 0，无警告，1–2 s，`Packages: +20` | |
| 0.2.1-rc.3 | 退出码 0 / 0，无警告 | |
| 0.2.1-rc.4 | 退出码 0 / 0，无警告 | 20 个包、node_modules 9.8 MB |

反向对照（闸门是真的）：未改 peer 的 0.2.3-dev.1 装进 0.2.0-rc.2 → `installation rejected: Plugin dsh-web-search-pro@0.2.3 is incompatible with dsh 0.2.0-rc.2`，退出码 1，`nothing was installed`；旧的 0.2.1 装进 0.2.1-rc.4 → 同样 `incompatible with dsh 0.2.1-rc.4`。

### headless（探针，无模型）

三个宿主结果逐项相同：`web_index` 返回 1967 字符的根视图（compact guide 与动作分组），`web_call` 的 `sources.status`（21 787 字符，列出全部来源与 CLI）、`config.inspect`、`config.set_order`（`ddg > bing exa seam jina` → `ddg > bing`，覆盖层 revision 递增）、`config.reset` 都成功；`config.upsert_cli` 被审批拒绝（`requires approval, but the call has no agent to route it through`），没有执行。headless 下 `ctx.tools.schemas()` 里的 `web_*` 工具是 `web_index`、`web_call`，外加宿主自带的 `web_search`、`web_fetch`（Web profile 里只有前两个）。

### Web profile（Playwright 截图，端口 3399）

脚本：先让探针留下一条 agent 覆盖（`engines: [ddg, bing]`），然后在浏览器里：打开插件详情页 → 卡片渲染 → 把“默认结果数”从 8 改成 7 并保存 → 看 `cordis.patch.yml` → 对覆盖条目点“采纳到配置”（或“撤销”）→ 恢复默认再保存 → 自定义 CLI 的 echo 示例点“试运行”→ 采纳之后让探针再 `config.inspect`。两个子场景（revoke、adopt）各跑一遍。

| 检查 | 0.2.0-rc.2 | 0.2.1-rc.3 | 0.2.1-rc.4 |
|---|---|---|---|
| 卡片渲染（42 个字段行、12 个分组，状态栏“当前状态 默认引擎链 ddg › bing › exa › seam › jina …”） | 通过 | 通过 | 通过 |
| 保存一项 → `cordis.patch.yml` 里 `web-search-pro` 只多 `searchMaxResults: 7`（原子 `mutate`、字段路径） | 通过 | 通过 | 通过 |
| 恢复默认再保存 → 该键被移除 | 通过 | 通过 | 通过 |
| 私有 RPC `status`（实时就绪）、`overlay`、`overlay.revoke`、`trial` 都 HTTP 200 | 通过 | 通过 | 通过 |
| “采纳到配置”（一次 `mutate` 写 `engines`）+ 覆盖被撤销；patch 出现 `engines: [ddg, bing]` | 通过 | 通过 | 通过 |
| “撤销”：覆盖条目消失，patch 不变 | 通过 | 通过 | 通过 |
| 自定义 CLI 试运行（echo）：`运行成功：解析出 1 条 … echo: rust async runtime cli://echo?q=…` | 通过 | 通过 | 通过 |
| 保存之后插件不重启就读到新基线（`config.inspect`：`engines [configuration]: ddg > bing`） | 通过 | 通过 | 通过 |
| 浏览器控制台错误 | 0 | 0 | 0 |

截图：`rcN-wsp-only-{1-card-top,2-agent-group,3-after-save,4-agent-adopt,4-agent-revoke,5-cli-trial}.png`（N = 2、3、4）。0.2.0-rc.2 的 Web 应用首次打开会弹“预览版说明”和“添加 API Key”两个对话框（Playwright 脚本点“继续”“稍后配置”关掉；没有填任何 Key）。

## 三、可选 peer `@anweat/dsh-browser ^0.2.0` 在两条线上的表现

| 组合 | 结果 |
|---|---|
| 0.2.0-rc.2 宿主 + Browser 0.2.1（npm）+ 本插件 | 宿主闸门放行，两者都能加载，本插件看得到浏览器（`sources.status` 的浏览器平台后端出现、`read` 组多出 `snapshot`）。**但** `dsh plugin add` 因 OpenCLI 的构建脚本退出码 1，两个插件都没有被加入 bundles（下一节）。预先写好 `allowBuilds: '@jackwener/opencli': false` 后退出码 0，插件正常 |
| 0.2.1-rc.4 宿主 + Browser 0.2.1（npm）+ 本插件 | `installation rejected: Plugin @anweat/dsh-browser@0.2.1 is incompatible with dsh 0.2.1-rc.4 … nothing was installed`，退出码 1。**连同本插件一起没装上**：Browser 0.2.1 的 peer 只含 `<0.2.1-0`。这是 optional peer `^0.2.0` 偏宽的后果：它不能表达“0.2.1 线上必须 0.2.2+”，只有 README 和 Browser 自己的闸门拦；是否收紧成 `>=0.2.2` 要看 Browser 0.2.2 是否在两条线上都发（rc.2 宿主上 0.2.0 / 0.2.1 用户会因此看到 peer 警告），这里没有改 |
| 三个宿主 + Browser 0.2.2 候选包 + 本插件 | 见下一节，退出码 0 |

## 四、干净安装与同装（任务 2）

### 复现：旧 Browser 把安装搞失败

条件：全新 `DSH_HOME`，不预先写 `allowBuilds`，Browser = `artifacts/releases/anweat-dsh-browser-0.2.2-dev.4.tgz`（修复前）。

- `dsh plugin --profile wsp-web add file:<browser dev.4> file:<wsp>`（rc.4，同样 rc.2 + Browser 0.2.1）：**退出码 1**，`[ERR_PNPM_IGNORED_BUILDS] Ignored build scripts: @jackwener/opencli@1.8.8`，`dsh: plugin command failed`；web 和 headless 两个 profile 一样。
- 包已装进 node_modules 和 `package.json` 的 dependencies，但 `dsh.profile.bundles` 里只有宿主自带的两项：**两个插件都没有被启用**（`--dump-config` 里没有 web-search-pro）。
- 之后在这个 profile 里再 `add` 本插件：退出码 1；再 `add is-odd@3.0.1`（无关包）：退出码 1。同一个被忽略的构建每次都会报。pnpm 还往 profile 的 `pnpm-workspace.yaml` 写入 `allowBuilds: '@jackwener/opencli': set this to true or false`。
- 原因：`@jackwener/opencli` 的 `postinstall`（`node scripts/postinstall.js || true; node scripts/fetch-adapters.js || true`）和 `prepare` 是构建脚本，pnpm 11 默认不运行，并以 `ERR_PNPM_IGNORED_BUILDS` 失败。`playwright` 1.64.1、`patchright` 1.64.2 及其 core 包**没有** install / postinstall 脚本，不下载浏览器。
- 只装本插件：没有这个问题（上一节），因为本包不依赖 opencli、playwright。

### 修后（Browser 0.2.2 候选包，来自另一个子代理在 `worktrees/dsh-browser-dev` 的提交 `26d8355`，用 `git archive` + `npm pack --ignore-scripts` 打包）

Browser 去掉 opencli 依赖（改可选 peer，运行时找 PATH / 全局 npm 目录），并在没有 Playwright Chromium 时用系统 Chrome / Edge。

| 场景 | rc.2 | rc.3 | rc.4 |
|---|---|---|---|
| `dsh plugin add <browser> <wsp>`（web / headless），不预写 allowBuilds | 0 / 0 | 0 / 0 | 0 / 0 |
| 先本插件，再 Browser，再无关包（rc.4 序列测试） | — | — | 0 / 0 / 0，bundles 含 `dsh-web-search-pro` 与 `@anweat/dsh-browser` |
| 安装后的包数 / node_modules 大小 | 25 个 / 50 MB（修前同装 40 个 / 74 MB；只装本插件 20 个 / 9.8 MB） | 同 | 同 |

同装之后再跑一遍第二节的 Web profile 脚本（revoke / adopt 两个子场景，端口 3399，截图 `fin-rcN-*`，日志 `wsp-logs/web-combined-browser-candidate-3hosts.out`）：三个宿主上卡片渲染、保存与恢复默认、采纳 / 撤销、RPC（`status`、`overlay`、`overlay.revoke`、`trial`）、热更新都和只装本插件时一致，控制台错误 0。

安装耗时 1–2 s 都是在 pnpm 存储已有缓存的情况下测的，冷缓存没有测到（`npm_config_store_dir` 指到空目录时没有观察到变化，不能当作冷缓存数据）。

### Playwright 浏览器（新用户没有下载过 Chromium）

条件：rc.4，Browser 候选包 + 本插件，`PLAYWRIGHT_BROWSERS_PATH` 指向空目录，机器上有 Google Chrome（`/Applications/Google Chrome.app`）。

- Browser 修前（dev.4）：`read.fetch mode=playwright` 与 `read.snapshot` 都返回 `ACTION_FAILED`，消息 `dsh-browser: chromium is not installed for playwright. Run the runtime.install action, or: node ".../playwright/cli.js" install chromium`（本插件原样转出）。
- Browser 修后：同样的两个调用成功，用系统 Chrome 渲染 `https://example.com/`，没有下载任何东西；`status().browser` = `{ ready: true, source: 'system-browser', path: '/Applications/Google Chrome.app/…', note: 'Playwright Chromium is not installed, so Google Chrome is used (nothing to download).' }`。
- 本插件的 `sources.status`（本次新增）：`✅ browser:dsh-browser [ready] — uses the system browser /Applications/Google Chrome.app/Contents/MacOS/Google Chrome (no Playwright Chromium needed)`。
- “什么浏览器都没有”的情形没有在真机上复现（这台机器装有 Chrome）。该分支由单元测试覆盖：Browser 报 `browser.ready=false` 时 `sources.status` 写 `❌ … [loaded, no browser to launch] — <installAdvice>`；`read.fetch mode=auto` 浏览器渲染失败时页面末尾有 `Browser render did not run: <原因>`，全部后端失败的错误里有 `(browser render failed: <原因>)`。`installAdvice` 的内容与可照做性是 Browser 一侧负责并验证的。

## 五、本插件自己的测试

- `pnpm run verify`：类型检查、`test:peers`（4 个受支持基线、5 个被拒绝基线、cordis 三条、`--selftest` 25 条）、构建、1002 项测试（994 通过、0 失败、8 跳过，跳过的是需要真实 CLI / 登录的 live 测试）、客户端 bundle 检查，全部通过。比改动前多 3 项：`sources.status` 浏览器可启动性、auto 模式渲染失败的页面文字、attempt 详情与最终错误。
- `pnpm run bench:typecheck` 通过，`pnpm run bench:test` 94 项全过。bench 的评分与管线没有改动（没有重跑数据集评测）。

## 没有验证的部分

- `0.2.1-rc.2`、`0.2.1-rc.1`、`0.2.1-alpha.x`、`0.2.0-rc.1` 宿主没有装（只靠范围检查）。
- 没有测与旧 profile 就地升级（已在 profile 里的旧 Browser 0.2.1）的路径。
- 没有在 Electron 桌面端里验证，Web 面板用的是 Playwright 的 Chrome for Testing 1243，宽度 1100。
- 没有触发“没有任何浏览器”的真机场景；没有测 Windows / Linux 的系统 Chrome 探测（那是 Browser 的代码）。
- 冷缓存安装时间。
- 验证者是同一开发代理，不是独立验证。
