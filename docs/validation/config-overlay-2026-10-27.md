# 设置顺序、重启项与 agent 覆盖层：单元验证与真实面板（2026-10-27）

宿主：DSH 0.2.1-rc.3 桌面端自带 CLI（`environments/desktop-020-rc1`），隔离 `DSH_HOME=environments/websearch-ui-2026-10-26/home`，profile `web-ui`，端口 3395；插件从工作区 `worktrees/dsh-web-search-pro-dev`（分支 `dev/0.2.3`）以 `link:` 装入。没有读写真实 `~/.dsh`，没有读任何凭据文件，没有关用户的桌面端，没有占 19387；验证结束后把 `cordis.patch.yml` 还原成验证前的样子（`work/cordis.patch.yml.before-023`），删掉隔离 home 里的 `overlay.json`，停掉 3395 上的宿主。

## 单元与 bench

- `pnpm run verify`（typecheck、peer 范围、build、test、client bundle 检查）通过：989 项测试，981 通过，8 项跳过（需要真实命令的 live 测试），0 失败；改动前 935 项。
- `bench:test` 94 项通过；`bench:eval-pack` v1 / v2 的 `pack-report.json` 与改动前（`overlay-base`、`overlay-base-v2`）逐字段一致（去掉运行 id 与时间戳后字符串相等）。

## 真实宿主

1. **字段顺序**：`dsh --profile web-ui --dump-config-schema` 里本插件的属性顺序就是新的分组顺序（searchMaxResults, parallelEngines, toolSurface, allowProxyFakeIp, deepseekFetch, engines, sources, platformBackends, keyedSources, …, cliAdapters, evidence, …, dbPath, verbose）。
2. **覆盖层**：用插件自己的 `OverlayStore`（Node 调用）往隔离 home 的 `data/web-search-pro/overlay.json` 写了 4 次修改（`config.upsert_cli` mytool；`config.set_order` 引擎顺序 + priority + disabled；`config.set_confidence` ddg；`config.set_order` reddit 的后端链），文件 0600。面板打开时经私有通道读到它们：状态摘要出现“agent 修改 6 项 · 查看”，“搜索顺序”里引擎链、reddit 行、ddg 的置信度框带“agent 修改”标记，悬停给出值与 reason；“agent 修改”分组列出 6 项和 4 条审计；自定义 CLI 列表下面列出只在覆盖层里的 mytool。
3. **重启项**：“网络与缓存”里 `timeoutMs`、`memoryCacheEntries`、`dbPath`、`verbose` 和“常用”里的 `toolSurface` 都带“重启插件后生效”。把 `toolSurface` 改成 flat：该行徽标变橙、保存条出现“其中 toolSurface 要重启插件后才生效。”；保存后，状态摘要出现“待重启 1 项: toolSurface”，悬停是“toolSurface: 待重启：当前生效 indexed，配置为 flat”（来自插件的 `status` 端点），并计入“1 条提示”。
4. **采纳**：点引擎顺序的“采纳到配置” → `cordis.patch.yml` 里 `web-search-pro` 条目多了 `engines: [bing, ddg, exa, seam, jina, custom-cli:mytool]`（与 `toolSurface: flat` 在同一份里），覆盖层的 `values` 不再有 `engines`，审计多一条 `5 user panel.adopt`。**撤销**：点 `sources.disabled` 的“撤销” → 覆盖层不再有它，`cordis.patch.yml` 不变，审计多一条 `6 user panel.revoke`。
5. 还原：`cordis.patch.yml` 与验证前一致，`overlay.json` 已删。

## 截图与留存文件

目录：`/Users/anweat/codeproject/dsh-dev/research/experiments/websearch-ui-redesign-2026-10-26/`

| 编号 | 内容 |
|---|---|
| `50-order-group-agent-marks-{light,dark}.png` | 带覆盖层的“搜索顺序”分组 |
| `51-agent-changes-{light,dark}.png`、`51b-agent-changes-audit-open-{light,dark}.png` | “agent 修改”分组（审计展开） |
| `52-network-group-restart-marks-light.png` | “网络与缓存”里的重启标记 |
| `53-restart-edit-save-bar-light.png` | 改了 toolSurface：行徽标变橙，保存条提示 |
| `54-pending-restart-summary-light.png` | 保存后状态摘要的“待重启 1 项”和“agent 修改 6 项” |
| `55-custom-cli-agent-added-{light,dark}.png` | 自定义 CLI 分组里 agent 添加的 CLI |
| `56-card-top-narrow-420-dark.png`、`57-order-group-agent-marks-narrow-420-dark.png`、`58-agent-changes-narrow-420-dark.png` | 窄屏 420px |
| `60-agent-changes-after-adopt-revoke-light.png`、`61-order-group-after-adopt-light.png` | 采纳与撤销之后 |
| `62-saved-cordis.patch.yml`、`62-overlay-after.json` | 采纳 + 撤销之后的 `cordis.patch.yml` 与覆盖文件 |

## 验证中发现并修掉的问题

- 面板里的“实际尝试顺序”只反映配置，和 agent 改过之后插件真正用的顺序对不上：现在加一行“加上 agent 的修改后实际尝试顺序”（同一个 `effectiveChain` 规则）。
- 420px 下 agent 行的说明被截断、引擎行的按钮跑出卡片：改成换行。
- 只在覆盖层里的 CLI 被引擎顺序引用时，单独采纳引擎顺序会让配置引用一个它没有定义的 CLI：该项上提示“连这个 CLI 一起采纳”。

## 没有做的

- 没有跑真实模型会话（由主会话另外跑）；headless 下“询问被拒”靠固定宿主源码里的 `serviceAsk` 字符串验证，没有在 headless 宿主里实际触发一次 `config.upsert_cli`。

## 真实模型会话（主会话补跑，2026-10-27 23:10）

宿主 DSH 0.2.1-rc.3 CLI，隔离 home `environments/websearch-ui-2026-10-26/home`，profile `headless`，模型 command-code `deepseek/deepseek-v4-flash`。key 只经环境变量传入，证据目录里搜不到 key 原文。证据取 `--json` 的原始 tool_result，在 `environments/websearch-ui-2026-10-26/evidence/model-runs/s4-config`、`s5-after-overlay`。

- **s4**：`config.inspect` → `config.set_order` → `config.upsert_cli` → `config.inspect`。
  - `config.inspect`：revision 0，各项都标 `[configuration]`。
  - `config.set_order`：模型第一次传了不存在的参数 `order`，得到 `INVALID_ARGS`，附 schema。改传 `engines` 后得到 `applied, overlay revision 1`，并显示前后顺序。
  - `config.upsert_cli`：两次调用都被宿主拦下，原话 `tool "web_call" requires approval, but no approval channel is available`。headless 没有审批渠道，所以拒绝，没有写入。
  - 第二次 `config.inspect`：`engines [overlay]: bing > ddg > …`，并有一条审计 `#1 … agent session-… config.set_order: "用户希望中文查询先用 bing"`。
  - 覆盖层文件：0600，`revision 1`，`values` 里只有 `engines`。
- **s5**（新会话，不传 engines）：`search.run` 的结果以 `Engine: bing` 结尾，说明覆盖层的顺序在下一个会话里生效了。
- **发现的问题**：
  - 审批在参数校验之前进行。第一次 `upsert_cli` 连 `id` 和 `spec` 都没给，也直接进入审批。在有审批界面的会话里，用户会被要求批准一个本来就会失败的请求，模型也拿不到 schema。
  - 与本次改动无关：bing 对 “tokio runtime” 返回了贴吧之类无关的中文结果，此前也见过返回 Google 翻译首页。
- **花费**：两个会话 command-code `monthlyCredits` 共约 0.008。
- **清理**：验证后已删除隔离 home 里的 `overlay.json`。
