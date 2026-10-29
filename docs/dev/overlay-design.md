# agent 覆盖层与 `config.*` 设计说明（0.2.3）

## 问题

用户的原话：设置文件的顺序能不能整理，要不要把设置外置以便 agent 修改和实时载入，还是某些写在 profile 里的设置需要重启插件，要列出来。

查明的事实：

- `Config` 几乎全部是 `.volatile()`：宿主改 profile 配置时就地更新 `ctx.fiber.config`，插件经 `dynamic()` 每次调用读最新值，不必重启。
- 但有 8 个设置只在插件挂载时读一次（见 `src/restart.ts`）。它们在 schema 里也标了 volatile，宿主允许改，面板却不提示，结果是“改了没反应，重启后才变”。
- agent 想调整来源顺序或加一个 CLI，目前只能让用户去改 profile。

## 决定

不做“agent 直接改一个被监听的自由文件”：自由文件没有校验、没有审计、没有乐观锁，坏了就是半个配置。采用三件事：

1. **profile 配置仍是用户的基线**，留在原处，按设置页分组重新排序（`src/config-groups.ts`）。
2. **标出启动时才读的设置**（`RESTART_FIELDS`），面板和 `sources.status` / `config.inspect` 都说明。
3. **agent 覆盖层**：一个受管文件 + `config.*` 动作。agent 的改动写在覆盖层，叠在基线上、立即生效；用户在面板里看得到、能采纳进自己的配置、能撤销。

## 覆盖层

**位置**：`$DSH_HOME/data/web-search-pro/overlay.json`，即 `dbPath` 默认值所在目录；用户改了 `dbPath`，覆盖文件跟着走（`overlayFileFor(dbPath)`）。`dbPath` 本身是重启项，所以路径在插件生命周期内固定。

**格式**（JSON，缩进 2 空格）：

```json
{
  "version": 1,
  "revision": 3,
  "updatedAt": "2026-10-27T14:35:00.000Z",
  "values": {
    "engines": ["bing", "ddg"],
    "sources": { "priority": ["exa"], "disabled": ["jina"], "confidence": { "exa": 0.8 } },
    "platformBackends": { "reddit": ["browser-opencli"] },
    "cliAdapters": { "mine": { "bins": ["mine"], "...": "整份规格，不含 id" } }
  },
  "audit": [
    {
      "revision": 3, "at": "2026-10-27T14:35:00.000Z", "actor": "agent", "action": "config.set_order",
      "sessionId": "session-…", "reason": "ddg is rate limited right now",
      "changes": [{ "key": "engines", "before": "ddg > bing", "after": "bing > ddg" }]
    }
  ],
  "checksum": "<sha256 of version, revision, updatedAt, values, audit>"
}
```

- `values` 的形状就是它覆盖的配置字段的形状，合并是字段级的：列表整体替换；`sources.confidence` 按 id 合并；`platformBackends` 按平台替换整条链；`cliAdapters` 按 id 替换整份规格。
- **能覆盖的只有这五种**。Key、路径、预算、开关、证据与评分设置不在其中；覆盖层只能新增或替换，不能删除基线条目（停用基线里的 CLI 用 `sources.disabled`；`config.remove_cli` 只删覆盖层自己加的）。值与基线相等的条目会被丢掉（相等就不是覆盖）。
- `audit` 至多 50 条，旧的被挤出；一个键的“最近一次修改”从审计里找，挤出后面板只显示值。
- 写入：先写 `overlay.json.tmp-<随机>`（0600）再 `rename`；目录 0700。每次写入前重读文件、核对 `revision`。

## 读取与合并

`dynamic()` = `overlay.effective()`：取基线（`resolveConfig(ctx.fiber.config)`），`stat` 覆盖文件，mtime 或大小变了就重读，否则用缓存；合并后返回。没有 fs.watch，没有定时器。多个进程写同一个文件时靠 `revision` 与 `expectedRevision` 发现冲突。

## 校验与“整体忽略”

校验分两层，用的都是设置面板和服务端已有的函数：

- **结构**（`checkShape`）：键、类型、大小、id 形状、CLI 规格走 `validateCliAdapterSpec`。
- **与基线合起来的语义**（`overlayErrors`）：把“基线 + 覆盖层”交给 `cliIssues`、`sourcesIssues`、`resolveSources`（带来源注册表）和引擎 id 规则，取**覆盖层新增**的问题（基线自己的问题不算覆盖层的）。

改动在写入前过这两层；文件在加载时过同样两层，基线变了（用户删了一个被覆盖层引用的 CLI）也会重算。任何一层失败，**整个覆盖层被忽略**，插件按基线运行，`sources.status` 和 `config.inspect` 报告原因，面板在“agent 修改”里显示；不会只应用一半。文件损坏时拒绝新写入，直到 `config.reset {scope:"all"}`（或面板的“全部撤销”）把坏文件改名为 `overlay.json.corrupt-<时间>` 后重新开始。

## 动作

见 [配置参考](../guide/config.md#agent-覆盖层与-config)“agent 覆盖层与 `config.*`”。设计上的几点：

- 写入动作的错误：参数问题是 `INVALID_ARGS`（消息写明被拒的 id 或值，什么都没写）；`expectedRevision` 不符是 `ACTION_FAILED`，提示先 `config.inspect`；文件坏了或与基线不一致是 `CAPABILITY_UNAVAILABLE`，提示 `config.reset`；找不到可删的项是 `NOT_FOUND`。
- 无变化的写入不落盘，`changed: false`。
- `config.set_confidence` 的 `value` 省略（或 `null`，参数检查把 `null` 当作缺省）就是删除覆盖项。

## 审批

沿用插件“按动作审批”的机制（`tools/pre-execute` → `webPolicyDecision`），新增两个审批类：

| 类 | 动作 | 规则 |
|---|---|---|
| `config` | `set_order`、`set_confidence`、`remove_cli`、`reset` | 不询问；`automationMode=read-only` 拒绝 |
| `run-program` | `upsert_cli` | 除 `read-only`（拒绝）外任何模式都询问，提示写明命令、搜索与探测的参数模板、读取的环境变量名 |

`inspect` 与 `export` 只读，不审批。

**headless**：宿主的 `tools/pre-execute` 返回 `ask` 后交给 `approval` 服务（`dsh-tools` 的 `serviceAsk`）。没有该服务：按插件给的理由拒绝；有服务但没有应答者（headless 没有界面）：`approval/request` 的默认值是 `unavailable`，同样拒绝（fail closed）；会话策略 `never`：直接拒绝；只有 `allowed-once` 才执行。所以 headless 的 agent 不能加 CLI，这是预期。`test/config-actions.test.ts` 把宿主这几处字符串钉住，宿主升级后行为变了会报警。

## 设置面板

- 行标记：`agent 修改`（悬停：agent 设的值、配置里的值、reason、时间、谁）出现在引擎顺序、`sources.priority` / `disabled`、平台后端行、置信度框、自定义 CLI 行。
- 分组“agent 修改”：全部覆盖项 + 审计；每项“采纳到配置”“撤销”，加“全部撤销”“刷新”。面板打开时经 RPC `overlay` 读取一次。
- **采纳**：先用保存条同款的原子 `mutate` 把值写进 profile（落在 `engines`、`sources.priority`、`sources.confidence.<id>`、`platformBackends.<平台>`、`cliAdapters.<id>` 这些 volatile 节点之下），成功后才经 RPC `overlay.revoke {adopted:true}` 删掉这一项覆盖（审计 actor `user`，动作 `panel.adopt`）。写入被宿主拒绝则两边都不变；写入成功而撤销失败则面板明说“值已在你的配置里，覆盖没删掉”。
- **撤销**：`overlay.revoke`，审计 `panel.revoke` / `panel.revoke_all`。另一个面板或 agent 已经删掉的键会被忽略，不报错。
- 端点 `status` 也带覆盖层摘要和待重启项，状态摘要据此显示。

## 取舍

- 覆盖层不是第二份配置：它只放“路由偏好”这五种，且都是 agent 有理由在运行时改、改错了代价小（最坏是搜得差，用户能一键撤销）的。会花钱、会放宽权限或会改路径的设置一个也不在里面。
- 唯一会让插件运行本地程序的 `upsert_cli` 每次都问人，哪怕 `automationMode` 很宽松；spec 仍过只读守卫（没有登录 / 写入 / 删除词、没有 cookie 或凭据参数、环境变量只列名字）。
- 面板里的行显示的是**基线**，不是合并后的值（面板写的也是基线）；覆盖层的值通过标记和“agent 修改”分组给出，避免用户在面板里看到的“原值”和保存时写的值对不上。
