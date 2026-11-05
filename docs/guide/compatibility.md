# 兼容范围与 peer 范围

> 适用版本：dsh-web-search-pro 0.2.3 · [返回 README](../../README.md) · [文档索引](../README.md)

## 当前版本一览

| 项 | 范围 |
|---|---|
| dsh-web-search-pro | `0.2.3` |
| DSH 宿主（peer） | `>=0.2.0-rc.2 <0.2.1-0 \|\| >=0.2.1-rc.2 <0.2.2-0 \|\| >=0.2.2-rc.1 <0.2.3-0`；实测 `0.2.0-rc.2`、`0.2.1-rc.3`、`0.2.1-rc.4`、`0.2.1-rc.5`、`0.2.2-rc.1` |
| cordis（peer） | `~4.0.4 \|\| ~4.1.0`（0.2.0 线宿主带 4.0.4、0.2.1 线带 4.0.5、0.2.2 线带 4.1.x） |
| 可选配套 `@anweat/dsh-browser` | `^0.2.0`：0.2.0 线宿主上用 `0.2.0` / `0.2.1` / `0.2.2`，0.2.1 与 0.2.2 线宿主上必须是 `0.2.2` 起 |
| 仍在 DSH 0.1.x 宿主或 dsh-browser 0.1.x 的用户 | 固定使用 `dsh-web-search-pro@0.1.15`（不再更新） |

各版本的兼容范围变迁见 [CHANGELOG 的“兼容与发布通道（历史）”](../../CHANGELOG.md#兼容与发布通道历史)。

## 支持范围

**支持范围**：DSH `>=0.2.0-rc.2 <0.2.1-0 || >=0.2.1-rc.2 <0.2.2-0 || >=0.2.2-rc.1 <0.2.3-0`，已在真实宿主上验证 `0.2.0-rc.2`、`0.2.1-rc.3`、`0.2.1-rc.4`、`0.2.1-rc.5`、`0.2.2-rc.1`；`0.2.0-rc.1`、`0.2.1-alpha.x`、`0.2.1-rc.1`、`0.2.2-alpha.x`、`0.2.3` 及以上都被拒绝。可选配套浏览器插件 `@anweat/dsh-browser ^0.2.0`（即 0.2.x，不含 0.3）：0.2.0 线宿主上用 Browser `0.2.0` / `0.2.1` / `0.2.2`，0.2.1 线宿主上必须是 `0.2.2` 起（旧的 0.2.0 / 0.2.1 的 peer 只含 `<0.2.1-0`，会被 0.2.1 线宿主的安装闸门拒绝，并且**整次安装作废**，插件也不会装上）。

## 不再支持的旧线

**不再支持 DSH 0.1.x 宿主线，也不再支持旧的 dsh-browser 0.1.x 线；仍在这两条线上的用户请停留在 dsh-web-search-pro 0.1.15。**

- DSH 0.1.x 宿主：peer 范围不再包含它，`dsh plugin add` 会因 peer 不满足而拒绝，或在组装期点名报 `incompatible`。本插件已去掉为旧宿主保留的兼容分支。
- 旧 dsh-browser 0.1.x：浏览器是可选依赖，本插件仍会**识别**它但不会驱动它。服务对象没有版本字段，所以以形状判定：不带任何 0.2 才有的方法（`observe` / `listTargets` / `sessionState`）即视为旧线。检测到旧线时：
  - `read.snapshot`、`read.fetch mode=playwright`、浏览器平台与 OpenCLI 平台返回 `CAPABILITY_UNAVAILABLE`：`dsh-browser 0.1.x is not supported by web-search-pro 0.2+; upgrade to @anweat/dsh-browser ^0.2.0`；
  - `read.fetch mode=auto` 不再尝试浏览器渲染，静默跳过（全部后端失败时，错误说明里会写明原因）；
  - `sources.status` 显示 `browser: legacy (unsupported)`；系统提示不加浏览器那一行；旧服务上的 `automationMode` 不参与写操作审批（按没有 Browser 处理，`standard` 下询问）；
  - 其他一切（网页搜索、证据管线、非浏览器平台、缓存、历史）照常工作。

## peer 范围的写法

**peer 范围的写法**与 `@anweat/dsh-browser 0.2.x` 完全一致：每个 `@deepseek-ai/dsh-*` peer 都是三段并联的范围 `>=0.2.0-rc.2 <0.2.1-0 || >=0.2.1-rc.2 <0.2.2-0 || >=0.2.2-rc.1 <0.2.3-0`，cordis 为 `~4.0.4 || ~4.1.0`。

- 宿主的组装期校验用的是 `semver.satisfies(host, range, { includePrerelease: true })`；真正决定装机成败的是 npm/pnpm 的**默认** semver：预发布版本只有在某个比较符自带同号（同 major.minor.patch）预发布时才被判为满足。三段各自的下界（`>=0.2.0-rc.2`、`>=0.2.1-rc.2`、`>=0.2.2-rc.1`）自带同号预发布，是**承重**的，必须保留；写成 `>=0.2.0-rc.2 <0.2.2-0` 这类跨线的单段范围会过宿主校验、却让 `dsh plugin add` 报 ERESOLVE。与 `@anweat/dsh-browser` 必须声明同一套策略，否则两者互为 peer 时会出现 ERESOLVE。
- 段与段之间留了缝：`0.2.1-alpha.1` ~ `0.2.1-rc.1`、`0.2.2-alpha.x` 没有验证过，两种解析模式都拒绝。上界是 `<0.2.3-0` 而不是 `<0.2.3`：后者放行 `0.2.3-alpha.1` 这类 0.2.3 的预发布。收口后，若 0.2.3 真出现破坏，会在**组装期**直接报 `is incompatible with dsh 0.2.3` 并点名，而不是拖到用户机器上变成运行期怪错（`0.1.5 → 0.1.7` 曾一次性打断所有按 `0.1.5-alpha.1` 构建的插件）。
- cordis：0.2.0-rc.2 宿主依赖 `~4.0.4`，0.2.1-rc.x 依赖 `~4.0.5`，0.2.2-rc.1 依赖 `~4.1.0`。干净安装时前两者都解析到 4.0.5（有锁文件的 rc.2 宿主可能是 4.0.4），0.2.2-rc.1 是 4.1.0。peer 写 `~4.0.4 || ~4.1.0` 容纳这三个，挡住 4.2.0 起。schemastery 的 peer `^3.18.5` 不变：0.2.0 / 0.2.1 线宿主解析到 3.18.5，0.2.2-rc.1 解析到 3.19.0，都在范围内。
- **cordis 4.1 改了 `Fiber.config` 的含义**：4.0.x 上它是解析后的配置，4.1 上是原始输入（没写配置时为 `undefined`、表达式不求值），解析后的对象改放 `fiber.effectiveConfig`。插件读 `ctx.fiber.effectiveConfig ?? ctx.fiber.config`（`src/fiber-config.ts`），两条线都正确；不要再直接读 `ctx.fiber.config`。
- **设置卡片的私有通道（0.2.2 线）**：宿主 0.2.2-rc.1 的 `connection.rpc.handle()` 对外部插件抛错（根因：宿主 `dsh-client-connection` 的 `register()` 在 cordis 4.1 的“按定义处检查 inject”下读 `owner.webServer`）。插件先试 `handle`，失败回退到宿主的 `register(owner, channel, handler)`（`src/rpc.ts`）。回退依赖宿主的一个 TypeScript-private 方法；宿主去掉它时，插件在日志里报告通道没挂上，其余功能不受影响。0.2.0 / 0.2.1 线仍走 `handle`。
- 范围只表示「测过哪些」，不等于承诺不破坏；真正的防线是每换一个 DSH 版本重跑一遍这套验证。`pnpm run test:peers`（已并入 `pnpm verify`）用两种解析模式逐个断言受管 peer：`0.2.0-rc.2`、`0.2.1-rc.2` ~ `rc.5`、`0.2.2-rc.1` 必须通过，`0.1.7-rc.2`、`0.2.0-rc.1`、`0.2.1-alpha.5`、`0.2.1-rc.1`、`0.2.2-alpha.1`、`0.2.3-rc.1` 必须被拒绝，cordis `4.0.4` / `4.0.5` / `4.1.x` 通过、`4.2.0` 拒绝；并自带 `--selftest` 已知行为自校验（含三段范围的缝）。开发依赖固定在 `0.2.1-rc.3`（单元测试跑在这一套类型上）；其他宿主靠真实宿主验证，不靠第二套 devDependencies。把开发依赖整体换成 `0.2.2-rc.1`（并把 `@deepseek-ai/schemastery` 与 `@deepseek-ai/cosmokit` 提到 `~3.19.0` / `~1.9.0`）后，`pnpm run typecheck`、`build`、单元测试与 client bundle 检查都能通过；只提 dsh 包而不提 schemastery 会让声明文件生成报 `TS2742`（同一个包的两个版本并存）。
