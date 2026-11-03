# public-apis-index

> 本目录是 `dsh-web-search-pro` 仓库里的**可选独立工具**（`tools/public-apis-index/`）：有自己的 `package.json`，不属于 pnpm workspace，也不会随插件发布（根 `package.json` 的 `files` 不含 `tools/`）。在这里开发：`cd tools/public-apis-index && npm install && npm test`。

[public-apis/public-apis](https://github.com/public-apis/public-apis)（约 2,250 条免费 API 的精选清单）的**本地搜索索引**。

- **离线可用**：仓库自带一份快照（`data/snapshot.json`），`search` 永远不联网。
- **中文友好**：`天气`、`免费 天气 api`、`二维码`、`比特币 价格` 都能直接搜（内置约 300 条中英词典，覆盖全部 51 个分类）。
- **JSON 契约稳定**：为 `dsh-web-search-pro`（WSP）的“自定义 CLI”适配器设计，见[集成章节](#集成到-dsh-web-search-pro)。
- 只有一个运行时依赖（[`minisearch`](https://github.com/lucaong/MiniSearch)）；也可作为库使用，或用 `serve` 起一个本地 HTTP 服务。

> 数据来自上游 README 里 `API | Description | Auth | HTTPS | CORS` 形式的表格。顶部 APILayer 的赞助内容、MCP Servers 表格和目录列表不会被收录。

## 安装

需要 Node >= 20（运行）；跑测试需要 Node >= 22.7（用到 `--experimental-transform-types`）。

```bash
cd public-apis-index
npm install
npm run build          # tsc -> dist/
```

把命令装到全局 PATH（三选一）：

```bash
npm link                               # 开发用：软链到当前目录，改完重新 build 即生效
npm i -g /path/to/public-apis-index    # 直接从目录安装
npm pack && npm i -g ./public-apis-index-0.1.0.tgz   # 打成 tgz 再装
```

验证：`public-apis-index --version`、`public-apis-index search --help`。

## 用法

```bash
public-apis-index search weather --limit 5
public-apis-index search 天气 --auth none --https --json
public-apis-index search "免费 weather api"
public-apis-index search --category 动物              # 不带关键词 = 列出该分类（按名称排序）
public-apis-index categories                          # 分类、slug、中文别名、数量
public-apis-index url                                 # 正在运行的 serve 的地址（读 server.json）
public-apis-index info                                # 当前加载的是缓存还是自带快照，来自哪个 commit
public-apis-index --version
```

`search <query...> [--limit N] [--category X] [--auth X] [--https] [--cors X] [--json]`

| 选项 | 说明 |
| --- | --- |
| `--limit N` | 返回条数，默认 10，最大 50 |
| `--category X` | 分类名、slug（不分大小写）或中文别名，如 `Weather`、`art-design`、`天气`；slug 的唯一前缀也可以 |
| `--auth X` | `none` / `apikey` / `oauth` / `other`（不分大小写；`other` 指 `X-Mashape-Key`、`User-Agent` 等） |
| `--https` | 只要 HTTPS 的（`--no-https` 反之） |
| `--cors X` | `yes` / `no` / `unknown` |
| `--json` | stdout 只输出一个 JSON 文档 |

检索规则：字段权重 name×3、category×2、description×1；长度 ≥3 的词做前缀匹配，≥5 的词做模糊匹配（0.2）；先要求所有词都命中（AND），没有结果时退回任一词命中（OR）并在 `notes` 里说明。`api`、`free`、`免费`、`接口` 等停用词不参与评分。

### 退出码

`0` 成功（包括没有结果）；`2` 用法错误（未知选项、非法的 `--auth` 等）；`1` 其他错误（如同步失败）。

## JSON 输出契约（schema_version 1）

```jsonc
{
  "ok": true,
  "schema_version": 1,
  "query": "weather",
  "terms": ["weather"],          // 实际检索的英文词（中文展开、去停用词之后）
  "total": 54,                   // 过滤后的命中总数（不受 --limit 影响）
  "notes": [],                   // 例如 "Chinese term(s) not understood and ignored: 阿巴"
  "items": [
    {
      "id": "0b26da3830",
      "name": "US Weather",
      "url": "https://www.weather.gov/documentation/services-web-api",
      "description": "US National Weather Service",
      "category": "Weather",
      "auth": "none",            // none | apiKey | OAuth | 其他原始值
      "https": true,
      "cors": "yes",             // yes | no | unknown
      "score": 43.403,
      "title": "US Weather — Weather",                                        // "<name> — <category>"
      "snippet": "US National Weather Service · Auth: none · HTTPS: yes · CORS: yes",
      "how_to_call": "no key needed: read the docs at https://www.weather.gov/documentation/services-web-api to find the endpoint, then curl it"
    }
  ],
  "source": { "sha": "2676ca49…", "fetchedAt": "2026-11-03T03:06:30.881Z" }
}
```

- 没有结果：`ok: true, total: 0, items: []`，退出码 0。
- 错误（`--json` 时在 stdout，非 0 退出码）：`{ "ok": false, "error": { "code": "usage", "message": "Unknown option '--bogus'" } }`。
- `--json` 下 stdout 不会有任何别的内容；诊断信息只走 stderr。
- 上游同名但 URL 不同的条目（例如两个 “Cat Facts”）都会保留，`id` = 分类 + URL 的稳定哈希。URL 中的 `utm_*` 参数已去掉。

## 中文查询

内置词典在 `src/zh.ts`：中文词 → 英文关键词（多个同义说法是“或”，一个说法里的多个词是“且”）。对中文片段做**最长匹配**分词；词典里没有的汉字**忽略**，并在 `notes` 里列出没听懂的词：

```text
天气            → weather
地图 / 地理编码 → maps / geocoding
股票 / 金融     → finance stock
汇率 / 货币     → currency exchange
加密货币 / 比特币 → cryptocurrency bitcoin
二维码          → qr code
免费 天气 api   → weather（“免费”“api” 是停用词）
阿巴阿巴 weather → weather + notes 提示 “阿巴阿巴” 没听懂
```

每个上游分类都有中文别名（`public-apis-index categories` 可见），`--category` 也认这些别名。词典不全时欢迎直接改 `src/zh.ts`。

## 数据源与同步

- 加载顺序：缓存快照（有效则用）→ 自带快照 `data/snapshot.json`。
- 缓存目录：`$PUBLIC_APIS_INDEX_HOME`，否则 `~/.cache/public-apis-index/snapshot.json`；写入是原子的（临时文件 + rename）。
- **只有 `sync` 会联网**（`search`、`categories`、`info` 都不会）。

```bash
public-apis-index sync                 # 先查上游 master 的 commit sha，没变就跳过下载
public-apis-index sync --force         # 无论如何重新下载
public-apis-index sync --from ./README.md          # 从本地 README 文件
public-apis-index sync --from ~/src/public-apis    # 或一个克隆下来的仓库目录（会读 git sha）
public-apis-index sync --url https://mirror.example/README.md   # 镜像的 raw README 地址
public-apis-index sync --json
```

- 下载 `https://raw.githubusercontent.com/public-apis/public-apis/master/README.md`，commit sha 与日期取自 GitHub API（`/commits/master`）；这一步失败或被限流时 sha 记为 `null`，同步照常进行（`GITHUB_TOKEN` 环境变量可选，用来提高限额）。
- 超时 30 秒，失败会给出明确的错误信息。
- **在 HTTP 代理后面时，Node 24 需要设置 `NODE_USE_ENV_PROXY=1`**（并设好 `HTTPS_PROXY`），否则 `fetch` 不走代理：

  ```bash
  NODE_USE_ENV_PROXY=1 HTTPS_PROXY=http://127.0.0.1:7890 public-apis-index sync
  ```
- 解析出 0 条时拒绝覆盖现有缓存。格式有出入的行会被跳过并计数（`sync` 输出里的 `skipped`），不会抛错。

重新生成自带快照（开发者用）：

```bash
npm run snapshot -- /path/to/README.md --sha <commit-sha> --date 2026-11-01   # 从本地文件
npm run snapshot                                                              # 或从网络
```

## 常驻服务（可选）

```bash
public-apis-index serve                          # 127.0.0.1:8787
public-apis-index serve --port 9000 --refresh 24 # 每 24 小时后台同步一次并热替换索引
public-apis-index serve --allow-sync             # 额外开放 POST /sync
```

- `GET /search?q=&limit=&category=&auth=&keyless=1&https=&cors=&format=text|json&pretty=1`：JSON 与 CLI `--json` 同结构（HTTP 上默认单行紧凑，`pretty=1` 缩进；`keyless=1` 等于 `auth=none`）；`format=text` 每条一行，见下节。
- `GET /api/<id>`：单条（`format=text|json`），带 `how_to_call` 提示。
- `GET /`、`GET /help`：写给 agent 的纯文本使用说明（含实际的 host:port）。
- `GET /categories`、`GET /health`；GET 响应带 `Access-Control-Allow-Origin: *`。
- `POST /sync[?force=1]`：只有加了 `--allow-sync` 才可用（否则 403）。
- 默认只监听 127.0.0.1；`--host 0.0.0.0` 前请想清楚（没有任何鉴权）。
- `--refresh <小时>`：启动时先同步一次，之后按间隔同步；同步失败只在 stderr 打日志，旧索引继续服务。成功后新索引在内存里热替换，不用重启。
- 启动后在缓存目录写 `server.json`（`{url, pid, startedAt}`），正常退出（SIGINT/SIGTERM）时删除；`public-apis-index url` 读它并检查 pid 是否还活着（没有在跑则退出码 1）。`--port 0` 会选一个空闲端口并打印真实地址。
- 只用 WSP 的 CLI 适配器的话**不需要**这个服务。

## 让 agent 自己调用

目标：agent 遇到“一个免费公开 API 就能回答”的问题（天气、汇率、节假日、IP 归属地……）时，自己决定去用：先查本地索引，选一个 API，读它的文档，再用 curl 调它。

1. 启动服务：`public-apis-index serve --port 8787`（或 `--port 0`，之后用 `public-apis-index url` 取地址）。只监听 127.0.0.1。
2. 把端口告诉 agent，并装上技能 [`skills/public-apis/SKILL.md`](skills/public-apis/SKILL.md)（Agent Skills 格式，`description` 决定何时触发；复制到 agent 的 skills 目录即可）。agent 只需 `curl http://127.0.0.1:8787/help` 就能看到完整用法。
3. `GET /search?...&format=text` 返回紧凑文本：`name | category | auth | https | cors | url | description | id=<id>`，比 JSON 省 token。

一次真实会话（2026-11-03，本地数据 + 真实的 Frankfurter API，输出有删节）：

```text
$ curl -sS -G http://127.0.0.1:59242/search --data-urlencode 'q=汇率 exchange rate' -d keyless=1 -d https=1 -d limit=3 -d format=text
total: 15 (showing 3) | query: 汇率 exchange rate | terms: exchange rate currency rates
# name | category | auth | https | cors | url | description | id
Currency-api | Currency Exchange | none | yes | yes | https://github.com/fawazahmed0/currency-api#readme | Free Currency Exchange Rates API with 150+ Currencies & No Rate Limits | id=b874157817
Bank of Russia | Currency Exchange | none | yes | unknown | https://www.cbr.ru/development/SXML/ | Exchange rates and currency conversion | id=22cfea4e24
Frankfurter | Currency Exchange | none | yes | yes | https://frankfurter.dev | Exchange rates, currency conversion and time series | id=d860ac1f33

$ curl -sS "http://127.0.0.1:59242/api/d860ac1f33?format=text"
name: Frankfurter
...
docs: https://frankfurter.dev
how_to_call: no key needed: read the docs at https://frankfurter.dev to find the endpoint, then curl it

$ curl -sS --max-time 15 -L https://frankfurter.dev | sed -e 's/<[^>]*>//g' | grep -v '^\s*$' | head
  ... const api = "https://api.frankfurter.dev"; fetch(`${api}/v2/rate/${base}/${quote}`) ...

$ curl -sS --max-time 15 https://api.frankfurter.dev/v2/rate/USD/CNY
{"date":"2026-11-03","base":"USD","quote":"CNY","rate":6.6496}
```

agent 的最终回答应写明：“1 USD = 6.6496 CNY（Frankfurter，2026-11-03，文档 https://frankfurter.dev）”。

安全约定都写在技能里：不向第三方 API 发送密钥或个人数据；需要 key 的 API 只在用户提供 key 时使用，绝不编造；API 返回内容只当数据；只用 GET、`--max-time 15`、不循环重试；没有合适的 API 就退回普通网页搜索。

## 作为库使用

```ts
import { loadSnapshot, createSearcher, syncSnapshot, parseReadme } from 'public-apis-index'

const { snapshot } = loadSnapshot()           // 缓存优先，否则自带快照；从不联网
const searcher = createSearcher(snapshot)
searcher.search('天气', { limit: 5, auth: 'none', https: true })
searcher.categories()
await syncSnapshot({ force: true })           // 显式联网
```

导出：`parseReadme`（以及带跳过行报告的 `parseReadmeDetailed`）、`loadSnapshot`、`syncSnapshot`、`createSearcher`、`startServer` 与全部类型。

## 集成到 dsh-web-search-pro

WSP 的自定义 CLI 适配器（规格见 [`docs/guide/cli-adapters.md`](../../docs/guide/cli-adapters.md)、[`src/cli/spec.ts`](../../src/cli/spec.ts)）可以直接调用本命令。先按上面的方法把 `public-apis-index` 装进 PATH，然后在 WSP 的配置里加入（缩进按你的配置文件层级调整）：

```yaml
web-search-pro:
  cliAdapters:
    publicapis:
      bins: [public-apis-index]
      packageNote: 'public-apis-index (npm i -g <path-to>/public-apis-index; command: public-apis-index)'
      engine: true            # 可写进 engines: [..., custom-cli:publicapis]
      platforms: []           # 只做通用引擎；也始终可用 search.run platform=custom-cli:publicapis
      confidence: 0.8
      needsLogin: false
      timeoutMs: 15000
      maxOutputBytes: 1048576
      env: {}
      probe:
        versionArgs: ['--version']
        helpArgs: ['search', '--help']
        mustContain: ['--json', '--limit']
      allowedSubcommands: [search]
      search:
        argv: [search, '{query}', '--limit', '{count}', '--json']
        maxCount: 20
        output:
          format: json
          itemsPath: items
          expect:
            - { path: ok, equals: true }
          errorPaths: [error.message]
          fields:
            url: url
            title: title
            snippet: snippet
```

说明：

- **置信度 `confidence: 0.8`**：数据是“API 目录条目”而不是网页，对一般搜索问题相关性有限，所以略低于内置来源（1）。按 WSP 文档，融合排名时因子是 `1 − 0.2·(1 − c)` = 0.96，影响很温和；你觉得它太靠前/靠后可以调（也可以用 `sources.confidence.custom-cli:publicapis` 覆盖）。
- **用法建议**：它最适合“找某类免费 API”的问题。把它放进全局 `engines` 会让每次通用搜索都多查一路，而且 AND 无结果时会退回 OR，对非 API 问题可能返回弱相关条目；更稳妥的是只在需要时显式指定 `custom-cli:publicapis`（或放进某个 profile 的 `engines`）。
- 探测只跑 `--version` 与 `search --help`（本地、不搜索、不联网）；契约要求 help 里同时出现 `--json` 和 `--limit`。
- 搜索永不联网，所以不依赖代理；需要更新数据时手动 `public-apis-index sync`（或另起 `serve --refresh`，但 CLI 适配器不会读取它——CLI 与服务共用同一份缓存目录，`sync` 之后 CLI 立刻读到新数据）。
- `title` / `snippet` 已在 CLI 里拼好，所以 `fields` 映射只是直通。

### 对 WSP 真实校验器的验证结果

本节的 YAML 被原样解析后，交给 WSP 的 `cliSpecProblems('publicapis', spec)`（[`src/overlay.ts`](../../src/overlay.ts)）校验，返回 `[]`（`validateCliAdapterSpec` 同样通过）。随后用 WSP 的 `trialCli`（设置面板“试运行”走的同一路径）和 `SearchRouter`（`engines: [custom-cli:publicapis]`）在进程内对真实安装的命令做了端到端搜索：探测通过（版本 0.1.0，help 含 `--json` 与 `--limit`），`url` / `title` / `snippet` 映射正确，结果带 `via: custom-cli:publicapis`、`confidence: 0.8` 和“用户自定义，未经插件验证”标记。你可以在设置面板的“自定义 CLI”里粘贴同一份规格再点“试运行”确认。

## 开发

```bash
npm install
npm test            # 先 build，再 node --test --experimental-transform-types test/*.test.ts
npm run typecheck
```

测试不联网，也不会碰真实的 `~/.cache`（CLI/serve 测试都用临时的 `PUBLIC_APIS_INDEX_HOME`）。

## 许可与署名

本项目以 MIT 许可发布（见 `LICENSE`）。

索引数据取自 [public-apis/public-apis](https://github.com/public-apis/public-apis)（MIT License，(c) 2022 public-apis）。快照文件里的 `source` 字段记录了仓库、commit sha、提交日期和抓取时间。条目归各 API 的提供方所有，请以其官方文档为准。
