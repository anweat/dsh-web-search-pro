# 验证记录：dsh-web-search-pro 0.2.3 — DeepSeek Search / Fetch API

日期：2026-10-26。范围：`src/providers/deepseek.ts`（Search 引擎与 Fetch 后端）对 `https://api.deepseek.com/v1/tools` 的真实调用。由开发者本人执行，不是独立验证。

## 做法与次数

- 用一个临时脚本（不在仓库里）直接调用适配器，真实 Key 只通过该进程的环境变量交给它（来自隔离验收环境的凭据文件），不打印、不写入任何文件。网络环境是 Clash/TUN fake-IP，调用时开了 `allowProxyFakeIp`。
- 共 **12 次**真实请求：**8 次 Search**（上限 10）+ **4 次 Fetch**（上限 5）。其中 6 次 Search 与 2 次 Fetch 成功返回结果（按文档会计费，合计约 $0.006）；其余 2 次 Search（失败的 401、400）和 2 次 Fetch（404）按文档不计费。没有请求被重试。
- 抓回的响应经检查不含 Key；`test/fixtures/deepseek-*.json` 是其中几次的节选（结果截到前几条、`summary` 截到 1400 字符，`request_id` 换成零），文件头写明“LIVE capture”。

## 每次请求看到的

| # | 请求 | 结果 |
|---|---|---|
| 1 | Search `PostgreSQL logical replication slot lag`，count 10，`ori_question` | 200，10 条，约 0.4 s；全部字段齐全；`content` 恒为空串（`need_content: false`） |
| 2 | Search `国内大模型备案 最新要求`，count 5，`ori_question`（中文） | 200，5 条，约 0.3 s |
| 3 | Search `DatabaseSync busy timeout site:nodejs.org`，count 5 | 200，**1 条**，来自 nodejs.org（`site:` 生效；服务没有凑满 5 条） |
| 4 | Search `rust async runtime comparison -site:medium.com after:2026-01-01`，count 8 | 200，8 条；全部 `date` 都晚于 2026-03（`after:` 生效），`-site:` 后的结果里没有 medium.com |
| 5 | Search 357 字符的英文长查询 + `site:postgresql.org`，经适配器截到 127 字符 | 200，5 条，全部来自 postgresql.org；结果说明里有 `query cut from 357 to 127 characters …` |
| 6 | Search `zzqxjv kkwpplm 99817263 qwertyuiopasdf`（乱码），count 5 | 200，**仍返回 5 条**，但 `rerank_score` 只有 0.16–0.22（相关的查询是 1.3–2.3）：服务几乎不会返回空数组，低 `rerank_score` 才是“不相关”的信号 |
| 7 | Search，故意用无效 Key（`sk-invalid…`） | **401**，`{"error":{"message":"Authentication Fails, Your api key: ****0000 is invalid (request_id: …)","type":"authentication_error","param":null,"code":"invalid_request_error"}}`，约 0.07 s |
| 8 | Search，140 字符的 `query` | **400**，`'query' must be at most 128 characters (request_id: …)`——128 字符上限是真的 |
| 9 | Fetch `https://nodejs.org/api/sqlite.html` | 200，`{title, content}`，content 为 Markdown，64,227 字符（Markdown 转义较多，如 `\#`、`\.`），约 0.12 s |
| 10 | Fetch `http://localhost/` | **404**，`failed to fetch URL (request_id: …)`，`type: not_found_error`，约 2.6 s。**不是 403**——没能触发安全策略拒绝 |
| 11 | Fetch `https://example.com/this-page-does-not-exist-xyz-404` | **404**，同上，约 3.6 s（目标页面本身是 404，服务端同样返回 404：从状态码分不出“目标 404”和“取不到”，所以插件不把它当成目标页面的状态） |
| 12 | Fetch `https://www.gov.cn/` | 200，标题正确，**只有 144 字符**正文（页面靠脚本渲染）；仍按文档计费 |

## 与文档不一致或文档没写的地方

- `summary` 文档说约 600–800 字符，**实测 300–4,685 字符**，多数在 1,000–3,500；`snippet` 文档说约 100–200 字符，**实测最长 3,018**（一条是整段文本），多数 150–550。适配器把 `summary` 截到 1,000 字符作为摘录，不依赖这个长度。
- `summary` 以 Markdown 开头，常见第一行是和 `title` 相同的一级标题（`# 标题`）；适配器去掉与标题完全相同的这一行。
- `date` 是 `…T16:00:00+00:00`（即北京时间 0 点）的 RFC 3339 字符串；约四分之一的结果为 null（样本里 10 条中 2 条）。
- `authority` 实测只出现 1–4，没有遇到 -1；`rerank_score` 是带很多小数位的浮点数。
- 错误体里带 `request_id`，适配器保留它（放在信息末尾，便于找 DeepSeek 支持）；其余疑似凭据的内容会被脱敏。

## 没有亲眼验证的

- **403**（Fetch 被安全策略拒绝）：只按文档实现，没有触发过；`localhost` 返回的是 404。
- **402**（余额不足）、**408**、**429**、**5xx** 以及重试路径：没有真实触发（不能也不应该去制造），只用模拟响应测试（`test/deepseek.test.ts`）。重试的等待时间（`Retry-After`，否则 0.8 s / 1.6 s，超过 8 s 不干等）是插件自己的选择，不是服务给的。
- `localization`（不发送）、`need_content: true`（不请求）、`lang:` / `before:` 运算符（没有发送）。
- 免费窗口：文档写 2026-11-01 前经 Harness 服务端工具的调用免费，没写插件直接调用是否算；本次调用发生在窗口内，**我们不知道它们是否被计费**，插件仍按会计费处理。
- 没有测多个 URL 的并发、限流（100 / 25 QPS）。

## 真实宿主验收（DSH 0.2.1-rc.3，2026-10-27）

范围：把 `npm pack` 出的 0.2.3（HEAD `648490e`，SHA-256 `bf8fc248…b246b`）经宿主 `dsh plugin add` 装进隔离 home，用 headless 会话（模型 `deepseek-flash`、low）和 Web profile（端口 3396）验收 DeepSeek 搜索路径与设置面板“恢复默认”。执行者仍是开发者本人，不是独立验证。完整报告与原始证据：`environments/websearch-023-verify/REPORT.md`（仓库外，在开发工作区）。

| 项 | 结果 |
|---|---|
| 安装闸门（rc.3） | 接受，exit 0；`--dump-config` 391 行无错误 |
| 默认配置 + 有 key：普通 `search.run` | 先走 `deepseek`（`Engine: deepseek`），结果带 `[rerank 2.26/3, authority 4/4]` 等元数据与 summary 摘录；`sources.status` 列为“常用 (common)”且 `ready` |
| 证据模式 | `Engine: pipeline(deepseek+exa+ddg)`，10 条摘录里有 deepseek 来源，needs 2/2 覆盖，内容合理；rerank/authority 只用于融合，摘录不显示 |
| key 只在 DSH 凭据引用里（环境里没有） | 通过（headless 默认禁用凭据服务，需在补丁里 `credentials: disabled: false`） |
| `sources.disabled: [deepseek]` | 普通搜索 `Engine: ddg`，证据模式 `exa+ddg+github`，无 deepseek |
| `evidence.sourcePolicy: anonymous-only` | 证据模式与（新查询的）普通搜索都不用 deepseek |
| 没有 key | `sources.status`：`❌ deepseek [unavailable] — no DeepSeek API key (…)` 与“不在默认链”的配置说明；普通搜索 `Engine: ddg`；显式 `engines:"deepseek"` 给出 `skipped: deepseek (no DeepSeek API key …)` |
| `deepseekFetch: true` + `mode: deepseek` | `https://example.com/` 取回 Markdown，`Source: deepseek` |
| `deepseekFetch` 关闭 + `mode: deepseek` | `DeepSeek Fetch is off: it is billed …`；URL 已有 deepseek 缓存快照时返回 `cache:deepseek` 而不是该提示 |
| 设置面板（rc.3 Web profile） | 改“默认结果数”和“并行融合”并保存 → `cordis.patch.yml` 写出 `searchMaxResults: 10`、`parallelEngines: true`；对结果数点“恢复默认”并保存 → 该键被移除；嵌套键 `evidence.maxRounds` 恢复默认后留下 `evidence: {}`（已知，无害）；JSON 对象弹窗与 Twitter 弹窗可打开，修改只留在草稿里。验收后 patch 与凭据文件已还原 |

直接调用：插件账本里 6 次 Search + 1 次 Fetch 成功，无失败。DeepSeek 余额（CNY）5.03 → 4.88，含模型 token 与搜索，无法拆分。

观察（未改代码）：
- `keyedSources.deepseek.apiKeyEnv` 是在默认名之外追加的候选，不能用来“关掉 key”。
- `sources.disabled` 含 `deepseek` 时，`sources.status` 仍写 `✅ deepseek [ready]` 和 “key found, leads the default order …”，只有最后的 `source strategy` 行说明已停用。
- `engines:"deepseek"` 缺 key 时，输出末尾的“换种写法重试”建议对缺 key 没有帮助（引擎行已写明原因）。

没有验证：真实桌面窗口、面板里写 DeepSeek 密钥、`mode: auto` 的回落顺序、`sources.budget.deepseek`、`sources.priority`、`keyedSources.deepseek.baseUrl`、402/403/429/5xx 与重试路径、与 `@anweat/dsh-browser` 同装。
