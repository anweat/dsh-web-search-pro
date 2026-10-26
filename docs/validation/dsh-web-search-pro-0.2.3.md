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
