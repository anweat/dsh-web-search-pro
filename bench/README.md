# bench：离线评测基础（dev-plan §6.2，实验步骤 E1）

本目录**不随插件发布**（不在 `package.json` 的 `files` 中，也不在主 `tsconfig` 的 `include` 中）。它为 M3 的判定器实验（规则 / Jev / Laya 对照）准备一份**固定不变的数据基础**：

1. 任务集：60 个固定任务（v1，调参用）加 40 个留出任务（v2，只做最终检验，见下文「v2 留出集」），覆盖 6 个 profile、中英文、以及计划里列出的各类陷阱；
2. 候选快照：用现有免费引擎对每个任务采集**一次**原始候选（标题、snippet、URL）和 top-K 页面正文块；
3. 标注格式：候选相关度 0–3、逐约束满足情况、每个 need 的金标准证据块（本目录只定义格式，标注本身是后续工作）。

之后所有对照实验都在同一份快照上运行，避免搜索结果漂移带来的噪声。

> 本目录不调用任何付费接口：不使用 API Key，不走 Jina / Playwright / Exa / DeepSeek / Jev / Laya。GitHub 搜索以匿名方式访问（采集脚本会忽略 `GITHUB_TOKEN`，保证快照不依赖个人令牌）。

## 目录结构

```
bench/
  README.md
  tsconfig.json            # 仅供 bench 类型检查：pnpm run bench:typecheck
  tasks/
    tasks.v1.jsonl         # 任务集 v1（调参用），每行一个任务（提交入库）
    tasks.v2.jsonl         # 任务集 v2（留出集，只用于最终检验，提交入库）
  src/
    types.ts               # TaskSpec / Need / Constraint、BenchTask、CandidateSnapshot、Label
    tasks.ts               # 任务集加载与校验、calibration/test 划分
    harvest-lib.ts         # 采集逻辑：引擎计划、礼貌限速、页面抓取、快照读写
    harvest.ts             # 命令行入口
    judges/                # E2/E3：Judge 接口与各判定器（见下文）
    label-llm.ts  run-judges.ts  report.ts  metrics.ts  data.ts  cli.ts
    eval-gate.ts           # M2a：src 规则 gate 的离线核对、查询编译预览、GitHub 实测
    eval-pack.ts           # M2b：证据包管线 S3–S8 的离线评测（基线 / 规则 / Jev 缓存）
  rubrics/                 # 题目模板（gate.*.v1、score.support.v1、profile.choice.v1）
  test/
    eval-pack.test.ts      # 证据包评测的指标、Jev 缓存适配器（与 r1 判定器同一缓存键）
    score-wording.test.ts  # 运行时 Jev 评分器的措辞与 score.support.v1 一致
    tasks.test.ts          # 任务集结构与覆盖检查
    harvest.test.ts        # URL 归一/选取、引擎计划、限速
  data/                    # 本地数据，git 忽略（见下）
    candidates.v1/<taskId>.json    # v2 对应 candidates.v2/、labels.v2/
    labels.v1/<taskId>.json        # 标注（LLM 初稿或人工）
    judge-cache/  runs/<runId>/    # 判定缓存；对照实验结果与报告
```

## 如何运行

```bash
pnpm run bench:test         # 单测（分块器、任务集、采集辅助函数）
pnpm run bench:typecheck    # bench 自己的类型检查（主 typecheck 不包含 bench）

# 采集（Node 24，无需构建，无需 DSH 宿主）
node --experimental-transform-types bench/src/harvest.ts --tasks dc-01,nf-10 --fetch-top 3
pnpm run bench:harvest -- --limit 5          # 等价写法：只跑前 5 个任务
```

参数：

| 参数 | 含义 |
|---|---|
| `--tasks id1,id2` | 只跑指定任务 |
| `--limit N` | 只取前 N 个（在 `--tasks` 过滤之后） |
| `--fetch-top K` | 每个任务抓取并分块的去重 URL 数，默认 4（0 = 只采集搜索结果） |
| `--engines ddg,bing,...` | 覆盖默认引擎选择（可选：`ddg bing github arxiv v2ex`） |
| `--force` | 已有快照也重新采集（**标注开始后不要使用**，见下） |
| `--summary-only` | 不联网，只汇总已有快照 |
| `--task-set v1\|v2` | 任务集版本，默认 v1；v2 读 `tasks/tasks.v2.jsonl`，写 `data/candidates.v2/`（见「v2 留出集」） |
| `--tasks-file` / `--out-dir` | 指定其他任务文件 / 输出目录（优先于 `--task-set` 的默认值） |

环境变量：`BENCH_ALLOW_FAKE_IP=0` 会关闭对代理 fake-IP（198.18.0.0/15）的放行；默认放行，以便在 TUN 代理环境下运行。

`Ctrl-C` 会中止在途请求，被中断的任务不会写出半成品快照。已有快照的任务默认跳过（断点续跑）。

### 采集流程

1. **引擎**：所有任务跑 `ddg` 和 `bing`；`docs_code`、`compare` 加 `github`（仓库搜索）；`academic` 加 `arxiv`；`experience` 且非纯英文加 `v2ex`（sov2ex）。每个引擎取前 10 条。
2. **site 变体**：任务带 `site` 约束时，对 `ddg`/`bing` 额外发一次 `site:<域名> <query>`。
3. **状态**：每次引擎调用记录 `ok`（有结果）/ `empty`（引擎正常返回但无结果，含 DDG 疑似限流）/ `error`（HTTP 错误、超时、网络错误），并记录耗时。DDG 出现 empty/error 时会退避 10 秒重试一次（`attempts: 2`），并把该主机的请求间隔翻倍。
4. **选页**：按 rank 轮询各引擎（主查询优先于 `site:` 变体），URL 归一化（去 fragment、跟踪参数、尾部斜杠）后去重，跳过 pdf/压缩包/图片/视频等二进制链接，取前 K 个。`from` 字段记录该 URL 被哪些 `引擎#rank` 返回。
5. **抓取**：只走纯 HTTP 路径（`httpGet` + `extractText` + 内置提取规则，与 `FetchService.fetchHttp` 同款），页面文本上限 20 万字符。
6. **分块**：`blocks.ts` 切块，写出 `bench/data/candidates.v1/<taskId>.json`。

## 证据包离线评测（M2b）

```bash
pnpm run bench:eval-pack                          # 规则评分 + r1 Jev 缓存；不发任何 Jev 请求
pnpm run bench:eval-pack -- --run-id pack-m2b     # 写 bench/data/runs/<id>/pack-report.md（中文）和 pack-report.json
pnpm run bench:eval-pack -- --sweep               # 只在 calibration 上扫描选择参数（minGrade / maxItems / budget / 每 URL 块数）
BOCHA_JEV_API_KEY=... pnpm run bench:eval-pack -- --allow-jev 40   # 缓存缺口需要补请求时才用；每个回答都会写入缓存
```

全程离线：快照里的引擎结果代替 S2，快照里的页面和块代替 S5。对比 (a) 基线（融合前 8 个候选加其页面全文）、(a′) 截到同等大小的基线、(b) 管线 + 规则评分、(c) 管线 + Jev 评分。`--allow-jev N` 缺省为 0：此时只读 `bench/data/judge-cache/jev`（问题文本与 r1 相同才命中，缓存键与 r1 判定器一致），有缓存缺口的任务回退到规则评分并排除在 Jev 对照之外；N > 0 时最多发 N 个请求，优先补缺口最少的任务。其余参数：`--split`、`--tasks`、`--budget`、`--max-items`、`--min-grade`、`--max-per-url`、`--fetch-top-k`、`--blocks-per-need`、`--no-jev`。

## 覆盖判定评测（M9）

```bash
# 在 v1 calibration 划分上拟合阈值，并在 test 划分上报告（缓存缺口按 --allow-jev N 补请求）
BOCHA_JEV_API_KEY=... pnpm run bench:eval-pack -- --coverage --coverage-calibrate --allow-jev 100 --run-id pack-m9-v1
# v2 留出集：只接受冻结阈值（取自上面报告），不得拟合
BOCHA_JEV_API_KEY=... pnpm run bench:eval-pack -- --task-set v2 --coverage --coverage-thresholds 0.4,0.8 --allow-jev 100 --run-id pack-m9-v2
```

`--coverage` 在 (b′) 与 (d′) 的证据包上，对规则声称覆盖的每个需求问一道 `cover.sufficient` noul 题（shadow 模式：包不变，只记录原始概率），回答缓存在 `data/judge-cache/<provider>-cover/`，请求额度与 Jev 评分共用 `--allow-jev N`。报告第 10 节在给定阈值下读同一批概率，按 全部 / 划分 / 语言 对比“规则覆盖”和“+ 覆盖判定”：声称覆盖正确率、声称覆盖召回、需求命中（包内含金标，由构造不变）、无金标需求标缺口、误降级（真覆盖被判弱）、去掉的错误声称。`--coverage-calibrate` 只用 calibration 划分拟合（误降级 ≤ 5% 前提下去掉最多错误声称；precision ≥ 85% 的最低概率作为 covered 阈值），`--task-set v2` 下被拒绝。判定只对规则已声称覆盖的需求提问，所以它只能降级，不会新增覆盖。

## 礼貌与成本规则

- **完全顺序执行**，不并发；同主机两次请求间隔至少 1.5 秒，且从上一次请求**结束**时计时。特例：`api.github.com` 6.5 秒（匿名搜索限额 10 次/分钟）、`export.arxiv.org` 3.1 秒、`html.duckduckgo.com` 3 秒。
- 单次请求超时 20 秒；遵守 `AbortSignal`。
- 不使用任何付费服务或 API Key；不要把采集脚本改成带 Key 的版本。
- 全量 60 个任务（v2 为 40 个）、每任务抓 4 页，粗估 10–20 分钟（dry run 平均每任务约 9 秒；受 GitHub/DDG 间隔和 DDG 重试影响），无金钱成本。调试时用 `--tasks` / `--limit`，不要反复全量重跑。
- 只抓公开页面，不登录、不绕过验证。`403`/登录墙页面按 `error` 记录，不做规避。

## 数据格式

完整类型见 `src/types.ts`，下面是要点。

### 任务（`tasks/tasks.v1.jsonl`，v2 格式相同）

| 字段 | 说明 |
|---|---|
| `id` | 形如 `dc-01`（v2 为 `v2-dc-01`）；前缀对应 profile：`dc` docs_code、`nf` news_fact、`ac` academic、`ex` experience、`cp` compare、`gn` general |
| `profile` | `docs_code` / `news_fact` / `academic` / `experience` / `compare` / `general` |
| `lang` | `zh` / `en` / `mixed`（按 query 与 goal 的主要语言） |
| `goal`、`query` | 对应 TaskSpec；`query` 是送给引擎的实际查询串 |
| `needs` | `[{id, text, critical}]`；至少一个 `critical` |
| `constraints` | `[{id, kind, value, strength}]`；`kind` 取自计划 §4.2：`must_term` `exclude_term` `entity` `version` `time_window` `site` `exclude_site` `language` `region` `source_type`。任务集里手写的约束不带 `origin`，`toTaskSpec()` 会按 `param` 补齐 |
| `traps` | 任务难在哪里（词表见下） |
| `notes` | 给标注者的背景说明（不含预设答案；有时效性的事实以采集日期为准） |

`time_window` 统一写成 `20XX 年以后`，保证任务集长期可复用。

**陷阱词表**（可增补）：`同名实体`、`版本差异`、`否定条件`、`导航页`、`转载`、`冲突信息`、`替代方案满足需求但不满足字面约束`、`过期信息`、`营销内容`、`中英术语不一致`、`观点对立`、`抓取受限`、`稀疏文档`、`语言差异`、`镜像站`、`安全`。

### 候选快照（`bench/data/candidates.v1/<taskId>.json`）

```jsonc
{
  "version": 1,
  "taskId": "dc-01",
  "harvestedAt": "2026-10-01T...",
  "engineRuns": [
    { "engine": "ddg", "query": "...", "status": "ok|empty|error", "error": "CODE: message",
      "ms": 950, "attempts": 2,
      "results": [{ "rank": 1, "url": "...", "title": "...", "snippet": "...", "publishedAt": "..." }] }
  ],
  "pages": [
    { "url": "...", "fetchedAt": "...", "status": "ok|error|skipped", "source": "http",
      "httpStatus": 200, "finalUrl": "...", "contentType": "...", "title": "...",
      "text": "...", "error": "HTTP 403", "shellPage": true, "truncated": true,
      "from": ["ddg#1", "bing#2"],
      "blocks": [{ "blockId": "b_0123456789ab", "heading": "A > B", "text": "...",
                   "start": 0, "end": 123, "hash": "0123456789abcdef" }] }
  ]
}
```

- `pages` 只包含被抓取的 top-K URL；其余候选只有标题和 snippet（S4 阶段本来也只看这些）。
- `publishedAt` 是引擎给出的原始字符串（Bing 返回本地化 RFC 822 文本，未做解析）。
- 块：`text === page.text.slice(start, end)`；`blockId = 'b_' + sha1(url + ':' + start)` 的前 12 位，同一页面文本得到相同 id；`hash` 是块文本 sha1 前 16 位，用于页面重抓后的漂移检测。

### 分块规则（`src/pipeline/blocks.ts`，M2b 起属于运行时代码，测试在 `test/pipeline-blocks.test.ts`）

- 围栏代码块（```` ``` ````）与 Markdown 表格是原子单元：不会被切开，超过 `maxChars`（默认 1200）时单独成块。
- 标题启动新的小节，标题行保留在该小节第一个块里；每个块带标题路径 `A > B > C`。`extractText` 输出的纯文本没有标题标记，所以对纯文本使用保守的启发式（短行、无句末标点、后面跟空行和较长正文）；启发式误判只会影响块边界与 `heading` 注释，**不会丢文字**。HTML 表格被 `extractText` 拍平成单元格行，无法识别为表格。
- 相邻段落合并到 `maxChars` 以内（最小目标 300）；超长段落依次按行、句子（中英文标点）、硬切（不拆代理对）切分。

### 标注（`bench/data/labels.v1/<taskId>.json`，格式由 `Label` 定义）

```jsonc
{
  "version": 1,
  "taskId": "dc-01",
  "snapshotHarvestedAt": "...",              // 所依据快照的 harvestedAt
  "labeler": { "kind": "human", "id": "anweat" },   // 或 { "kind": "llm", "id": "deepseek-..." }
  "labeledAt": "...",
  "candidates": [
    { "url": "...", "relevance": 0,           // 0 无关 / 1 仅定位 / 2 部分支持 / 3 直接支持且含条件（同 §4.3 S6）
      "constraintChecks": [{ "constraintId": "c1", "satisfied": "yes|no|unknown" }],
      "navPage": false, "note": "" }
  ],
  "gold": [
    { "needId": "n1", "evidence": [{ "url": "...", "blockId": "b_...", "hash": "..." }] }
  ]
}
```

- `gold[].evidence` 为空数组表示快照内没有页面支持该 need；它是有意义的结果（覆盖判定 S8 的负例）。
- `evidence` 同时记录 `blockId` 与块 `hash`，页面重抓或分块规则变化后可以据此重新对齐。
- **calibration/test 划分**（仅 v1；v2 全部为 `heldout`）：`assignSplits()`（`src/tasks.ts`）按 profile 分层、按 `sha1(id)` 排序、前一半为 calibration，确定且可复现。任务集有增删时分配会变化，所以开始标注前把划分结果固化到文件。阈值与提示词只在 calibration 上调。

## v2 留出集（dev-plan §3.2、§6.2）

**为什么有 v2**：v1 的 60 个任务的 calibration 与 test 都参与过调参（IDF 下限、等级边缘缩放、区分度阈值、每 URL 块数等常数是在同一批任务上选出来的），test 上的数字已经偏乐观。v2 是 40 个**从未参与调参**的新任务，用来对已冻结的参数做最终检验。

**政策（务必遵守）**

1. **只用于最终检验，永远不用于调参。** 不在 v2 上扫描阈值、不改提示词、不改评分常数、不据 v2 的失败样例改规则；v2 的结果出来之后若要改参数，只能回到 v1 上改，并且该参数此后不能再算“冻结”，需要新建 v3 才能再做留出检验。
2. **参数先冻结，再看 v2。** 运行 v2 评测前，把要检验的参数（`DEFAULT_RELEVANCE_THRESHOLD`、选择参数、评分常数、`jevMode` 等）与对应提交写进评测记录；评测期间 `src/` 的相关常数不得改动。
3. **划分**：v2 的全部 40 个任务的 split 都是 `heldout`（没有 calibration 一半，`assignSplits(tasks, 'v2')`）。凡是“在 calibration 上选参数”的步骤，在 v2 上都不适用：`eval-pack --sweep` 在 `--task-set v2` 下直接报错；`report` 的 drop 阈值必须用 `--thresholds-from <v1 的 report.json>` 提供（冻结阈值），不会从 v2 数据里推导；`eval-gate` 只在 v2 上评估默认阈值，不再对比 r1 的一致性。
4. **标注**：标注（DeepSeek 初稿或人工）与 v1 同一套流程，但先采集、再标注，标注后快照同样视为冻结。v2 标注同样是 LLM 初稿，报告里的“未复核”提示保持不变。

**组成**：40 个任务（id 形如 `v2-dc-01`），docs_code 7 / news_fact 7 / academic 7 / experience 7 / compare 6 / general 6；中文 21、英文 13、中英混合 6。与 v1 不重复库、产品、论文与事件。除了 v1 已有的陷阱，还刻意加入：

- **中文需求、英文一手来源**（跨语言）：如 Go 循环变量语义、LoRA、思维链、Scaling Laws；
- **版本相关的 API 问题**：FastAPI lifespan、Next.js 15 异步请求 API、Tailwind v4 配置、Zod 4、Docker Compose watch；
- **“缺席型”问题**，诚实回答可能是“不支持 / 没有文档”：Redis Cluster 跨槽事务、标准 JSON 是否允许注释、ruff 能否完全替代 pylint、UTF-8 BOM 是否被推荐；
- **冲突报道、转载与镜像、导航页**：Windows 10 ESU、CrowdStrike 事故、npmmirror 域名变更、RFC 索引页与厂商文档目录页。

任务只涉及公开页面，不含登录后才能访问的来源，也不含敏感或个人话题。

**命令**（与 v1 相同，加 `--task-set v2`；`harvest` / `label` / `eval-pack` / `judges` / `report` / `eval-gate` 都支持）

```bash
# 采集（免费引擎 + 纯 HTTP，礼貌限速不变）
node --experimental-transform-types bench/src/harvest.ts --task-set v2 --fetch-top 4
# 标注（DeepSeek 草稿，付费；写入 data/labels.v2/）
node --experimental-transform-types bench/src/label-llm.ts --task-set v2 --effort low --max-spend-cny 2 --min-balance-cny 41
# 对已冻结参数的最终检验（不要加 --sweep）
pnpm run bench:eval-pack -- --task-set v2 --run-id pack-v2-final
pnpm run bench:eval-gate -- --task-set v2
node --experimental-transform-types bench/src/run-judges.ts --task-set v2 --split heldout --judges rule --run-id v2-rule
node --experimental-transform-types bench/src/report.ts --task-set v2 --run v2-rule --thresholds-from bench/data/runs/e3-1/report.json
```

备份：采集完成后打包 `candidates.v2/` 到仓库之外（`experiments/bench-data/candidates.v2-<日期时间>.tgz`），标注完成后同样备份 `labels.v2/`，之后视为冻结，不要 `--force` 重采。

## E2/E3：LLM 标注初稿与判定器对照（dev-plan §6.3、§6.5）

新增目录：`src/judges/`（Judge 接口、rule / jev / laya / deepseek、缓存、预算守卫）、`rubrics/*.json`（带版本的题目模板）、`src/label-llm.ts`、`src/run-judges.ts`、`src/report.ts`、`src/metrics.ts`。

```bash
# 1. DeepSeek 标注初稿（付费；余额守卫强制开启）。key 来自环境变量 DEEPSEEK_API_KEY，不要打印
node --experimental-transform-types bench/src/label-llm.ts --tasks dc-01 --effort low \
  --max-spend-cny 2 --min-balance-cny 41            # 也可 --limit N、--force、--dry-run
# 2. 判定器对照（rule 离线；laya 需先 experiments/laya/start.sh；jev 需 BOCHA_JEV_API_KEY）
node --experimental-transform-types bench/src/run-judges.ts --judges rule,laya,jev \
  --split all --max-jev-requests 50 --run-id e3-1     # --groups s4,s6,s1  --gates single,relevance,constraint,nav
# 3. 报告（中文 report.md + report.json，同目录）
node --experimental-transform-types bench/src/report.ts --run e3-1
```

- **标注**：写入 `data/labels.v1/<taskId>.json`（`labeler.reviewed: false`），每次请求的 token 与余额写入 `data/labels.v1/_ledger.jsonl`。每次请求之后都会读 `GET /user/balance`；花费 ≥ `--max-spend-cny` 或余额 < `--min-balance-cny` 立即停止。余额接口只有 0.01 元精度且可能滞后，所以另有 `--max-total-tokens`（默认 300 万）兜底。`reasoning_effort` 被 API 接受（取值 none/minimal/low/medium/high/xhigh/ultra/max，非法值 422）；推理 token 计入输出，`low` 在长提示上可能把 `max_tokens` 用光而内容为空，此时脚本对该请求自动降级为 `none` 重试。site / exclude_site 约束由程序按 URL 主机判定，不问模型。
- **判定器**：`rule` 为确定性词法基线；`jev` 硬上限 `--max-jev-requests`（含重试，默认 50），429/503/529 按 Retry-After 重试最多 2 次，401/413/422 不重试；`laya` 默认 multilingual（`--laya-model english|router`）；`deepseek` 只有加 `--with-deepseek` 才运行（与标注同源，存在泄漏）。每个判定调用按条目缓存到 `data/judge-cache/<judge>/<sha256>.json`，重跑不重复计费。
- **S6 输入**：每个 need 取词法初排前 `--blocks-per-need`（默认 12）个块，所有判定器用同一批块。
- **报告**：Gate 用标注相关度 ≥ 2 为正例（另报 ≥ 1），drop 阈值在 calibration 上取「正例召回 ≥ 0.95 的最高阈值」，在 test 上报召回、丢弃比例和含金标准块候选的召回；另有 Brier / ECE、Spearman、混淆矩阵、nDCG@5、请求数 / token / p50 / p95。标注是 LLM 初稿，报告头部会标明未经人工复核。

### 规则 gate 离线核对（M2a）

`src/pipeline/lexical.ts`（词法相关度）、`src/pipeline/gate.ts`（硬约束核验 + 相关度 gate）是运行时与 bench 共用的唯一实现；`bench/src/judges/rule.ts` 只保留 bench 专有部分（分档、导航页、profile 猜测）。

```bash
pnpm run bench:eval-gate                     # 在已标注数据上跑 src gate，与 r1 报告对照（±1pt 内为通过）
pnpm run bench:eval-gate -- --compile        # 60 个任务按 provider 编译查询，并列出 GitHub 关键词查询
pnpm run bench:eval-gate -- --github-live 5  # 另发 5 次匿名 GitHub 仓库搜索（间隔 7 s，忽略 GITHUB_TOKEN）
```

默认相关度阈值 `DEFAULT_RELEVANCE_THRESHOLD = 0.1236` 来自 r1 的 rule / gate.relevance.v1 calibration 选取值；修改 `lexical.ts` 后必须重跑本命令并重新选阈值。

## 哪些进 git，哪些不进

| 路径 | 是否入库 |
|---|---|
| `bench/README.md`、`bench/src/`、`bench/test/`、`bench/tasks/`、`bench/tsconfig.json` | 入库 |
| `bench/data/`（候选快照、标注，含 v1 与 v2） | **`.gitignore` 忽略**，仅本地保存 |

快照是本地数据（含第三方页面正文，体积也会增长）。注意两点：

1. 搜索结果**不可复现**：同一查询两次采集的结果会不同（dry run 已观察到）。因此快照一旦用于标注就应视为冻结，**标注开始后不要 `--force` 重采**，否则标注与候选对不上。
2. 标注是人工成本，放在被忽略的目录里有丢失风险。建议标注开始后把 `bench/data/` 定期备份到仓库之外；需要共享冻结数据集时，作为单独的发布物打包，而不是提交进本仓库。

## 已知限制

- Bing RSS 端点对中文查询有时返回与主题无关的结果（按 IP 地区给出日文/其他站点），偶发返回空（同一查询两次采集结果不同）；这是引擎现状，采集不做修正，标注时照常标低分。
- GitHub 仓库搜索对长自然语言查询经常无结果（`empty`）。
- DDG 偶发 `empty`（疑似限流），脚本会退避重试一次，重试后仍空则如实记录。
- 纯 HTTP 抓取拿不到动态渲染页，会得到壳页面（`shellPage: true`）或 `403`（知乎、百度百科等）；这些如实保留，不做额外规避。
