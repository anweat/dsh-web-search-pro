# 内置 web 工具路由（ctx.web provider）

> 适用版本：dsh-web-search-pro 0.2.3 · [返回 README](../../README.md) · [文档索引](../README.md)

## 两种用法

同一套证据管线有两个入口。模型是否走哪一个，取决于它看到哪些工具；第二种能在模型“顺手用内置 `web_search`”时仍然让证据管线生效。

**（a）直接调用 `web_call search.run`。** 模型加载 skill `dsh-web-search-pro`（或按常驻提示）调用 `search.run`，传 `task` / `profile` 得到证据包（见下节）。常驻提示和 skill 描述都写明：做网页研究时优先用它，而不是 `web_search` + `web_fetch`，因为它只返回过滤后的证据，占用的上下文少得多；读页用 `read.fetch`（长页用 `offset` 续读）。

**（b）让宿主内置的 `web_search` / `web_fetch` 经过本插件。** 宿主自带这两个工具，模型常常直接用它们（实测 DeepSeek 在自然任务里就是这样，绕过了 `web_index`）。把本插件注册并**选中**为 `ctx.web` 的 provider 后：

- `web_search` 的返回内容 = 本插件的证据包（与 `search.run` 同一渲染：`resultId`、缺口 `Gaps`、“覆盖是启发式的”提示，末尾一行说明可用 `web_call history.expand` / `read.fetch` 展开），`sources` 仍是来源列表；`truncated` 只在确有来源被截掉时为真。查询即任务（`task = query`，`needs = [query]`，profile 按规则推断，推断不出为 `general`，预算为默认值）。
- 证据运行有自己的期限（`provider.deadlineMs`，默认 25 秒；到点返回 `PARTIAL` 的已有结果）。超时、管线报错都**退回今天的普通来源列表**，不会让内置工具失败；只有调用方取消会原样抛出。为避免递归，这条路径不会再调用 `ctx.web` 引擎（`seam`）。
- `web_fetch` 沿用同一套抓取管线，上限是 `fetchDefaultChars` 的两倍；被截断时 `truncated` 为真，并在正文末尾追加一行 `[Continue with web_call read.fetch url=… offset=N]`。
- `provider.evidence: off` 让 `web_search` 回到只返回来源列表（与旧行为完全一致）。

## 怎么选中本插件

**宿主的规则，不是本插件的。** `@deepseek-ai/dsh-web` 只在两种情况下使用某个 provider：`web` 条目里**写明了它的 id**（`searchProvider` / `fetchProvider`，环境变量 `DSH_WEB_SEARCH_PROVIDER` / `DSH_WEB_FETCH_PROVIDER` 与它们是同一个字段，不是另一条优先级链），或它是**唯一可用**的已注册 provider。没写 id 又有两个可用 provider 时，每次 `web_search` 都会以 `WEB_PROVIDER_AMBIGUOUS` 失败。所以 `registerProvider` 默认是 `false`：只注册、不选中是无害的，但默认注册会在没有写 id 的部署里让内置工具直接报错，本插件不会悄悄接管宿主默认 provider。

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

## 和其他“联网调研”skill 并存

 用户自己安装的 skill（例如 `agent-reach`）也可能在描述里声称负责联网调研；本插件的 skill 描述只陈述自己做什么（中英文触发词：联网搜索 / 查证 / 调研 / 读取网页，web research / look up / verify / read a page），不声称对其他 skill 的优先权，也无法阻止模型选别的 skill。（b）正是为这种情形准备的：不管模型加载了哪个 skill，只要它最终调用内置 `web_search` / `web_fetch`，走的就是本插件的证据管线。
