# Jev 评分与评分模型 provider

> 适用版本：dsh-web-search-pro 0.2.3 · [返回 README](../../README.md) · [文档索引](../README.md)

块评分默认用本地词法规则。可选的博查 Jev 评分（付费，需环境变量或凭据引用 `BOCHA_JEV_API_KEY`）由 `evidence` 配置控制：`jevMode: off`（默认，不调用）、`shadow`（规则决定，Jev 评分只记录到存储 `evidence_runs.pack_json` 供对照）、`control`（且 `scorer: jev` 时由 Jev 决定；任何 Jev 失败都回退到规则并在 `notes` 里说明）、`hybrid`（规则评分全部块，Jev 只重评需求语言与块语言不一致的 (需求, 块) 对；`hybridBorderline: true` 时再加规则评分为 1 的边界对；Jev 失败保留规则评分；与 `scorer` 无关）；`maxJevQuestions`（默认 64）限制每次搜索发送的 (需求, 块) 问题数。规则评分本身对中文需求与英文块做了跨语言对齐（query / 需求 / 约束里的英文词和标识符并入匹配词），默认即生效。发给 Jev 的只有一句话目标、需求文字和页面块文本。

## Jev 提示词（rubric）：可配置、有版本

发给 Jev 的问题措辞、评分等级和长度上限是带版本的 rubric（内置 `score.support`，另有 `gate.relevance`、`gate.constraint` 备用）。默认值与离线评测（`bench/rubrics/*.v1.json`）逐字相同。要调整，在设置文件 `evidence.rubrics` 里按 rubric id 写覆盖项，无需改代码：

```yaml
evidence:
  jevMode: hybrid
  rubrics:
    score.support:
      version: v2                     # 必填；内容有改动就必须换新版本号（不能是 v1）
      instructions: |                 # 只能用 {task} {need} {candidate}；必须含 {need} 和 {candidate}（≤2000 字符）
        文本块本身是否直接陈述了需求所问的答案，而不只是提到该主题？
        需求：{need}
        文本块：{candidate}
      criteria: [无关, 只提到主题, 部分回答, 直接回答且含证据]   # 2–10 级，从低到高；不是 4 级时分数按比例换算到 0..3
      maxStateChars: 200              # 20–2000，任务描述上限
      maxCandidateChars: 1200         # 100–8000，每个文本块上限
```

- **校验与回退**：含未知变量、缺必需变量、等级数不在 2–10、长度越界、未换版本等，整条覆盖被忽略，改用内置版本；原因出现在 `sources.status` 的 `evidence.diagnostics` 和证据包的 `notes`（仅启用 Jev 时）。
- **版本规则**：改了措辞、等级或长度就换新 `version`（如 v2、v3）。每次 Jev 评分都记录 `id@version#内容哈希`：证据包 `stats.jev.rubric`、shadow 日志（`evidence_runs.pack_json` 的 `shadow.rubric`）、证据行（`evidence_blocks.rubric`）；离线评测的缓存键同样包含 id、版本和全文，所以改提示词不会复用旧分数。
- **查看**：`sources.status` 的 `evidence.rubrics` 列出每个 rubric 当前生效的版本、是否被覆盖。
- **恢复默认**：删除对应的 `evidence.rubrics.<id>` 条目即可（设置页暂不提供该项的编辑界面，只读设置文件）。
- **先离线对照再上线**：`node --experimental-transform-types bench/src/eval-pack.ts --rubric-file bench/rubrics/variants/score.support.v2-example.json`，在同一份冻结数据上评估候选版本；不带 `--allow-jev N` 时不会发出任何请求（用法见 `bench/src/eval-pack.ts` 文件头注释）。
- **不让线上模型改提示词**：rubric 只能由人通过设置文件修改；插件和任何线上模型都不会自动改写或上线新版本。

## 评分模型 provider 与用量上限

S6 的模型评分分成「协议 × provider」两层，换模型只改配置：

- **协议**：`systemone`（Jev 兼容的 `POST /v1/systemone`：博查 Jev、其他 Jev 部署、本地 Laya sidecar）；`rerank`（Jina / Cohere 风格的 `{model, query, documents, top_n}` → `results[{index, relevance_score}]`，也适用于暴露同形状接口的本地 bge / Qwen reranker）；`llm`（OpenAI 兼容 chat completions，温度 0、严格 JSON 校验，仅供参考/实验，默认关闭，需 `evidence.judge.allowLlm: true`）。`systemone` 与 `llm` 用 `score.support` rubric；`rerank` 以需求文本作 query。
- **内置 provider**：`bocha-jev`（默认；`https://jev.bocha.cn`，`bocha-jev-v1`，密钥 `BOCHA_JEV_API_KEY`，请求与旧版逐字节相同）、`typesafe-jev`（占位预设，须自行填 `baseUrl` / `model`，**未验证**）、`laya-local`（`http://127.0.0.1:8765`，无密钥；实验 r1 里在当前提示词下接近随机，用前必须自己校准）、`jina-rerank`、`cohere-rerank`（**未验证**，从未对真实服务调用过）。
- **自定义 provider**（`jevMode` / `judge.mode` 决定怎么用；`judge.mode` 是 `jevMode` 的中性写法，两者都设时前者优先，且 `control` 不再需要 `scorer: jev`）：

```yaml
evidence:
  judge:
    mode: hybrid                 # off | shadow | control | hybrid
    provider: my-reranker        # 默认 bocha-jev
    providers:
      my-reranker:
        protocol: rerank
        baseUrl: http://127.0.0.1:8080/v1   # 非本机必须 https；路径可用 path 覆盖（默认 /rerank）
        model: bge-reranker-v2-m3
        keyRef: MY_RERANK_KEY    # 可选：凭据引用或环境变量名，永远不写密钥本身
        limits: { maxDocumentsPerRequest: 50, blockChars: 1000 }
        calibration:             # rerank 必填，见下
          version: v1
          points: [[0.1, 0], [0.4, 1], [0.7, 2], [0.9, 3]]
      bocha-jev:                 # 与预设同名 = 覆盖预设的个别字段
        limits: { maxQuestionsPerRequest: 16 }
  budget:
    perSearchInputTokens: 60000  # 默认
    dailyInputTokens: 1000000    # 默认
    timezone: Asia/Shanghai      # 日界线时区，默认系统时区
    providers: { laya-local: { dailyInputTokens: 200000 } }   # 按 provider 覆盖，取更严格者
```

- **校准是硬要求**：reranker 的相关度分数不是等级，不同模型/语言差异很大。`calibration.points` 是 `[原始分, 等级0..3]` 的单调分段线性映射（原始分严格递增、等级不降；区间外取端点），版本号和内容哈希随结果记录；没有校准的 rerank provider 不会被使用（规则评分继续，并在 `notes` 说明）。不同 provider 的分数从不混用，离线缓存也按 provider+模型分开（rerank 缓存的是原始分，换校准无需重新请求）。`systemone` 也可选填 `calibration`（Laya 建议）。先用 `shadow` 观察，再考虑 `hybrid` / `control`。
- **用量账本与上限**：每次模型调用前按保守估算预留 token、调用后按服务返回的 `usage` 结算（服务不返回则按估算记账并标 `estimated`；价格未声明时金额为空，不是 0；`price` 可选声明）。预留是原子的（SQLite `usage_ledger` 表，跨搜索、跨进程，重启不清零，未结算的预留继续占用额度）。超过单次搜索或当日上限时跳过模型阶段、回退规则评分，`notes` 出现 “model budget exceeded”。`sources.status` 的 `evidence.provider` / `evidence.usage` 显示当前 provider 是否可用、今日用量与上限。注意默认单次上限 60000 输入 token 小于 `maxJevQuestions: 64` 全量发送的估算量，较大的 hybrid 搜索可能提前停在上限处。
- **离线评测**：`bench/src/eval-pack.ts --provider <id> [--providers-file providers.json]`、`bench/src/run-judges.ts --provider <id>`；文件格式同 `evidence.judge.providers`。

## 覆盖判定（S8，可选，默认关闭）

规则覆盖是词法判断，分辨不出“文档里没有”。`evidence.coverage: { mode: off | shadow | control, provider?, thresholds?: { weak, covered } }`：对规则声称已覆盖的每个需求，向 systemone 模型（默认 `bocha-jev`）问一道 `cover.sufficient` noul 题——“这些摘录本身是否已明确给出答案”（一次请求，经用量账本与上限）。`shadow` 只把原始概率记入 `stats.coverage`，覆盖不变；`control`：概率低于 `weak` 的需求变成缺口 `weak_support (judge)`（关键需求可触发既有的有界第二轮，不增加轮数），介于 `weak` 与 `covered` 之间的保持覆盖并标 `(judge unsure)`。只有显式设置才启用，不随 `jevMode` 自动开启；失败、超限、超时、缺 Key、缺阈值时保留规则覆盖并在 `notes` 说明。阈值只对校准过的 provider + rubric 版本有效（内置 `bocha-jev` + `cover.sufficient@v1`：weak 0.0512，covered 0.313，取自 v1 calibration 划分）；换 provider、模型或 rubric 版本须自己配 `thresholds`。离线评测见 `bench/README.md` “覆盖判定评测”，数字见开发计划 M9：增益有限，所以默认保持关闭，建议先用 `shadow` 积累数据。
