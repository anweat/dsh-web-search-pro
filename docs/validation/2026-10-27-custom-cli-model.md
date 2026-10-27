# 2026-10-27：真实模型经 `web_call search.run` 走自定义 CLI

被测：分支 `dev/0.2.3` 的 `bae0e8e`（搜索顺序、自定义 CLI、置信度）。宿主 DSH 0.2.1-rc.3 CLI，隔离 home `environments/websearch-ui-2026-10-26/home`，profile `headless`（插件 `link:` 到本工作区），cwd 为空目录。模型：command-code 提供的 `deepseek/deepseek-v4-flash`，key 只经环境变量传入；每个会话后在证据目录里搜索 key 原文，命中 0。证据取 `--json` 的原始 `tool_result` 事件，不采信模型自述。

插件配置就是设置面板保存的那份：`cliAdapters.echo`（`echo {query}`，整段输出，`engine: true`，`confidence: 0.6`），`engines: [ddg, bing, exa, seam, custom-cli:echo, wikipedia]`，`sources.confidence.bing: 0.8`，`allowProxyFakeIp: true`。

| 会话 | 调用 | 结果（原始 tool_result） |
|---|---|---|
| s1 | `search.run {query:"rust async runtime", engines:"custom-cli:echo", count:3}`；`sources.status` | 一条结果 `echo: rust async runtime (cli://echo?q=rust%20async%20runtime) [via custom-cli:echo, confidence 0.6, user-defined, not verified by the plugin (用户自定义，未经插件验证)]`，正文为整段输出；`Engine: custom-cli:echo`。`sources.status` 里 `custom-cli:echo [ready]`，并列出 `custom-cli:echo confidence 0.6; bing confidence 0.8`。 |
| s2 | `search.run` 传了数组形式的 `engines` | `INVALID_ARGS: engines: expected string, got array`，附 schema。是提示词写错（`engines` 是逗号字符串），不是插件问题；作为参数错误提示的样例保留。 |
| s3 | `search.run {query:"tokio async runtime", engines:"ddg,bing,custom-cli:echo", multi:true, count:6}` | 6 条融合结果：前 5 条来自 ddg/bing（tokio.rs、GitHub、docs.rs 等）；只有 bing 返回的一条标 `[confidence 0.8]`；自定义 CLI 的整段输出排在最后但保留在列表内，带 `via`、`confidence 0.6` 和“未经插件验证”标注；`Engine: multi(ddg+bing+custom-cli:echo); tried: ddg, bing, custom-cli:echo`。 |

结论：模型 → `web_call search.run` → 自定义 CLI → 结果打包（`via`、`confidence`、标注）→ 返回，这条路径在真实宿主上走通；并行融合时低置信度来源排后但不被挤掉；内置来源的置信度覆盖（bing 0.8）出现在结果和状态里。

顺带看到的已有问题（与本次改动无关）：bing 返回了一条与查询无关的结果（Google 翻译首页），日期按本地化文本原样显示（`周一, 26 10月 2026 19:12:00 GMT`）。

花费：command-code `monthlyCredits` 57.2830 → 57.2742（三个会话共约 0.009）。证据：`environments/websearch-ui-2026-10-26/evidence/model-runs/s1-custom-cli`、`s2-fusion`、`s3-fusion`（`events.ndjson`、`stderr.txt`、`meta.txt`）。
