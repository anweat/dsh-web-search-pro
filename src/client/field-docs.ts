/**
 * The comment printed in front of every key of the text view ("Advanced: text mode"), in the language of the card: what the
 * setting is for, its allowed values or range, its default, and the risk when there is one. Comment lines start with `#`, so
 * the text stays valid YAML and a round trip never reads a comment as data. Pure (it imports only config-groups.ts): the text view and the
 * tests read it, and the client bundle includes it. Nothing here names a secret value: keys are only ever referenced by name.
 * @module web-search-pro/client/field-docs
 */

import { CONFIG_GROUP_TITLES } from '../config-groups.ts'

export type DocLang = 'en' | 'zh'

interface Doc { en: string; zh: string }

/** Display name of a source in the docs (proper names, the same in both languages). */
const SOURCE_NAME: Record<string, string> = {
  deepseek: 'DeepSeek Search / Fetch', bocha: 'Bocha', tavily: 'Tavily', brave: 'Brave Search', linkup: 'Linkup', serper: 'Serper',
  metaso: 'Metaso', zhipu: 'Zhipu', 'baidu-qianfan': 'Baidu Qianfan',
}

const DOCS: Record<string, Doc> = {
  engines: { en: 'Default engine chain of a plain search, tried in order: ids such as ddg, bing, exa, seam, jina. At least one. Default: ddg, bing, exa, seam, jina. While this is the default list a ready DeepSeek key puts deepseek first; a list you write is used as written.', zh: '普通搜索的默认引擎链，按顺序尝试：id 如 ddg、bing、exa、seam、jina，至少一个。默认 ddg, bing, exa, seam, jina。保持默认列表时，DeepSeek Key 就绪会把 deepseek 排最前；你自己写的列表按所写顺序。' },
  parallelEngines: { en: 'true = query every default engine at once and merge by rank fusion | false = try them one after another. Default: false', zh: 'true = 同时查询全部默认引擎并按排名融合 | false = 依次回退。默认 false' },
  searchMaxResults: { en: 'Results per search when the call gives no count, 1-20. Default: 8', zh: '调用未指定 count 时的结果数，1–20。默认 8' },
  timeoutMs: { en: 'Time budget of one enhanced search in milliseconds, at least 1000. Default: 30000', zh: '单次增强搜索的时间预算（毫秒），至少 1000。默认 30000' },
  fetchDefaultChars: { en: 'Characters one read.fetch returns, 1000-500000; longer pages continue with offset. Default: 20000', zh: 'read.fetch 单次返回的字数，1000–500000；更长的页面用 offset 续读。默认 20000' },
  exaContentsPerUrlChars: { en: 'read.contents output per URL in characters, at least 500. Default: 8000', zh: 'read.contents 每个 URL 的输出字数，至少 500。默认 8000' },
  exaContentsTotalChars: { en: 'read.contents output of one call over all URLs, at least 1000. Default: 30000', zh: 'read.contents 一次调用所有 URL 的输出字数总上限，至少 1000。默认 30000' },
  exaApiKeyEnv: { en: 'Name of the DSH credential or environment variable holding the Exa key (the key itself is never stored here). Default: EXA_API_KEY', zh: '保存 Exa Key 的 DSH 凭据或环境变量名（Key 本身从不写在这里）。默认 EXA_API_KEY' },
  jinaApiKeyEnv: { en: 'Name of the credential / environment variable holding the Jina key. Default: JINA_API_KEY', zh: '保存 Jina Key 的凭据 / 环境变量名。默认 JINA_API_KEY' },
  githubTokenEnv: { en: 'Name of the credential / environment variable holding the GitHub token (raises the rate limit). Default: GITHUB_TOKEN', zh: '保存 GitHub Token 的凭据 / 环境变量名（只用来提高限额）。默认 GITHUB_TOKEN' },
  twitterAuthTokenEnv: { en: 'Name of the credential / environment variable holding the twitter-cli auth_token cookie. Handed to the command only through its environment. Default: TWITTER_AUTH_TOKEN', zh: '保存 twitter-cli 的 auth_token 的凭据 / 环境变量名；只通过子进程环境变量交给命令。默认 TWITTER_AUTH_TOKEN' },
  twitterCt0Env: { en: 'Name of the credential / environment variable holding the twitter-cli ct0 cookie. Default: TWITTER_CT0', zh: '保存 twitter-cli 的 ct0 的凭据 / 环境变量名。默认 TWITTER_CT0' },
  bochaApiKeyEnv: { en: 'Name of the credential / environment variable holding the Bocha key; BOCHA_JEV_API_KEY is the fallback. Default: BOCHA_SEARCH_API_KEY', zh: '保存博查 Key 的凭据 / 环境变量名，找不到时回退 BOCHA_JEV_API_KEY。默认 BOCHA_SEARCH_API_KEY' },
  bochaBaseUrl: { en: 'Bocha endpoint base (an http(s) URL; /v1/web-search is appended). Default: https://api.bocha.cn', zh: '博查接口地址（http(s) URL，/v1/web-search 会自动追加）。默认 https://api.bocha.cn' },
  bochaSummary: { en: 'true = ask Bocha for its longer page summary (better for evidence scoring) | false. Default: true', zh: 'true = 请求博查较长的页面摘要（更利于证据评分）| false。默认 true' },
  deepseekFetch: { en: 'true = read.fetch may use the DeepSeek Fetch API (billed: $0.75 per 1,000 successful requests) after Jina and a direct request found no content, and mode=deepseek works | false. Risk: spends money. Default: false', zh: 'true = read.fetch 在 Jina 与直连都没拿到正文时可用 DeepSeek Fetch API（按请求计费：每 1000 次成功请求 $0.75），mode=deepseek 可用 | false。风险：会花钱。默认 false' },
  searxngUrl: { en: 'Your own SearXNG instance (JSON format enabled), http(s) URL; the searxng source exists only when this is set. Default: empty', zh: '你自己的 SearXNG 实例（需开启 JSON 格式），http(s) URL；设置后才有 searxng 来源。默认 空' },
  openalexMailto: { en: 'Contact e-mail put in the User-Agent of OpenAlex requests (etiquette, optional). Default: empty', zh: '写进 OpenAlex 请求 User-Agent 的联系邮箱（礼貌性，可留空）。默认 空' },
  enableCliBackends: { en: 'true = allow local CLI backends (bili, yt-dlp, OpenCLI, Agent Reach, ...) | false. Default: true', zh: 'true = 允许本机 CLI 后端（bili、yt-dlp、OpenCLI、Agent Reach 等）| false。默认 true' },
  opencliEnabled: { en: 'true = allow site adapters through the connected Chrome Browser Bridge | false. Default: true', zh: 'true = 允许经 Chrome Browser Bridge 使用站点适配器 | false。默认 true' },
  agentReachEnabled: { en: 'true = allow Agent Reach compatible backends | false. Default: true', zh: 'true = 允许兼容 Agent Reach 的后端 | false。默认 true' },
  providerId: { en: 'Id the plugin registers as the ctx.web provider; referenced by searchProvider / fetchProvider or DSH_WEB_SEARCH_PROVIDER. Default: web-search-pro', zh: '本插件注册为 ctx.web provider 的 id；被 searchProvider / fetchProvider 或 DSH_WEB_SEARCH_PROVIDER 引用。默认 web-search-pro' },
  registerProvider: { en: 'true = register as the ctx.web provider so the built-in web_search / web_fetch can route through this plugin (takes effect at start-up; the host also needs the profile patch shown in the card) | false. Default: false', zh: 'true = 注册为 ctx.web provider，让内置 web_search / web_fetch 可经本插件（启动时生效；宿主还需要卡片里给出的 profile patch）| false。默认 false' },
  toolSurface: { en: 'Tools the model sees: indexed = web_index + web_call only (default, least resident text) | flat = one tool per action, for comparison and debugging. Read at start-up. Default: indexed', zh: '模型看到的工具形态：indexed = 只有 web_index + web_call（默认，常驻文本最少）| flat = 每个动作一个工具，仅用于对比与调试。启动时读取。默认 indexed' },
  playwright: { en: 'JSON object {"enabled": true|false, "snapshotDir": "<absolute path>"}: the browser-render fallback of read.fetch and the screenshot directory. Default: {"enabled": true}', zh: 'JSON 对象 {"enabled": true|false, "snapshotDir": "<绝对路径>"}：read.fetch 的浏览器渲染回退与截图目录。默认 {"enabled": true}' },
  ttlSeconds: { en: 'Seconds a cached search or page stays fresh; 0 = always stale. Default: 3600', zh: '缓存的搜索与页面保持新鲜的秒数；0 = 总是过期。默认 3600' },
  memoryCacheEntries: { en: 'Capacity of the in-process LRU cache, at least 1. Default: 128', zh: '进程内 LRU 缓存容量，至少 1。默认 128' },
  rrfConstant: { en: 'Smoothing constant k of the rank fusion 1/(k + rank), at least 1. Default: 60', zh: '排名融合 1/(k + 名次) 的平滑常数 k，至少 1。默认 60' },
  freshnessBoost: { en: 'Bonus for recent results as a fraction of one rank step, 0-1; each URL gets it once. Default: 0.2', zh: '近期结果的加分，占一个排名名次的比例，0–1；每个 URL 只加一次。默认 0.2' },
  freshnessDays: { en: 'Days over which the freshness bonus decays to zero, at least 1. Default: 30', zh: '新鲜度加分衰减到 0 的天数，至少 1。默认 30' },
  authorityBoost: { en: 'Bonus for authority hosts as a fraction of one rank step, 0-1. Default: 0.25', zh: '权威域名的加分，占一个排名名次的比例，0–1。默认 0.25' },
  authorityDomains: { en: 'Extra authority domains, comma separated, no scheme or path (github.com, wikipedia.org, .edu, .gov, .org already count). Default: empty', zh: '额外的权威域名，逗号分隔，不带协议和路径（github.com、wikipedia.org、.edu、.gov、.org 已内置）。默认 空' },
  dbPath: { en: 'SQLite file of the cache and history; empty = the plugin default path. Default: empty', zh: '缓存与历史的 SQLite 文件；留空 = 插件默认路径。默认 空' },
  allowProxyFakeIp: { en: 'true = trust DNS answers in the proxy fake-IP ranges (198.18.0.0/15, fdfe:dcba:9876::/64, 2001:2::/48) | false. Turn it on only when Clash/TUN makes searches fail with "resolved to proxy fake-IP". Literal fake-IP URLs, localhost and other private addresses stay blocked. Default: false', zh: 'true = 信任代理 fake-IP 网段（198.18.0.0/15、fdfe:dcba:9876::/64、2001:2::/48）里的 DNS 结果 | false。仅在 Clash/TUN 让搜索报 “resolved to proxy fake-IP” 时打开。字面 fake-IP URL、localhost 与其他私网地址仍被拒绝。默认 false' },
  platformRules: { en: 'JSON object: per platform the selectors {item, title, link, text?} used by the browser search page. Default: empty', zh: 'JSON 对象：按平台给出浏览器搜索页用的选择器 {item, title, link, text?}。默认 空' },
  customPlatforms: { en: 'JSON object: your own platforms, each {name, url template, item, title, link, text?}; a key may not reuse a built-in source id. Logins go through browserBindings, not here. Default: empty', zh: 'JSON 对象：你自己的平台，每个 {name, url 模板, item, title, link, text?}；键不能和内置来源重名。登录态通过 browserBindings 引用，不写在这里。默认 空' },
  browserBindings: { en: 'JSON object: bind a platform to a dsh-browser login profile and rule pack. Default: empty', zh: 'JSON 对象：把平台绑定到 dsh-browser 的登录 profile 与规则包。默认 空' },
  platformBackends: { en: 'JSON object: per platform the ordered backends to try, e.g. {"xiaohongshu": ["xhs", "opencli", "browser-opencli"]}. A backend that is missing or not logged in is skipped with its reason. Default: empty (built-in chains)', zh: 'JSON 对象：按平台给出依次尝试的后端，如 {"xiaohongshu": ["xhs", "opencli", "browser-opencli"]}。缺失或未登录的后端会被跳过并说明原因。默认 空（用内置链）' },
  cliAdapters: { en: 'JSON object: your own read-only CLI adapter specs by id (argv array, output fields, probe contract, allowedSubcommands). Write actions and cookie-reading flags are refused. Default: empty', zh: 'JSON 对象：按 id 定义你自己的只读 CLI 适配规格（argv 数组、输出字段、探测契约、allowedSubcommands）。写操作与读取 Cookie 的参数会被拒绝。默认 空' },
  verbose: { en: 'true = write a load marker and more run diagnostics | false. Default: false', zh: 'true = 写入加载标记并输出更多运行诊断 | false。默认 false' },
  'evidence.autoProviders': { en: 'true = ready sources strong in the task language (Bocha, Exa, DeepSeek, ...) go ahead of the profile table | false = the table and engines as they are. Default: true', zh: 'true = 就绪且擅长任务语言的来源（博查、Exa、DeepSeek 等）排到 profile 表之前 | false = 完全按表与 engines。默认 true' },
  'evidence.sourcePolicy': { en: 'default = the usual order | anonymous-only = automatic planning never uses a source that needs a key, account or login, even a configured one (a source named in the call still runs). Default: default', zh: 'default = 通常顺序 | anonymous-only = 自动规划绝不使用需要 Key、账号或登录的来源（即使已配置；调用里明确指定的仍可用）。默认 default' },
  'evidence.maxRounds': { en: 'Search rounds per task, at least 1; 1 = no follow-up search. Default: 2', zh: '每个任务的检索轮数，至少 1；1 = 不补搜。默认 2' },
  'evidence.maxQueries': { en: 'Search requests per task over all rounds, at least 1. Default: 4', zh: '每个任务所有轮次的搜索请求数上限，至少 1。默认 4' },
  'evidence.judge.mode': { en: 'Model scoring: off | shadow (record only) | control (the model decides) | hybrid (rules first, the model re-scores cross-language pairs). Writes the legacy keys jevMode / scorer too. Calls a paid model: check the key and the usage caps first. Default: off', zh: '模型评分：off | shadow（只记录对照）| control（由模型决定）| hybrid（规则为主，模型复评跨语言对）。同时写旧键 jevMode / scorer。会调用付费模型：开启前先确认 Key 与用量上限。默认 off' },
  'evidence.hybridBorderline': { en: 'true = hybrid also hands rule-borderline pairs (grade 1) to the model; roughly doubles the cost | false. Default: false', zh: 'true = hybrid 也把规则评分为 1 的边界对交给模型；成本约翻倍 | false。默认 false' },
  'evidence.judge.provider': { en: 'Scoring provider id: a preset (bocha-jev, typesafe-jev, laya-local, jina-rerank, cohere-rerank) or one you define; empty = bocha-jev. Default: empty', zh: '评分 provider 的 id：内置预设（bocha-jev、typesafe-jev、laya-local、jina-rerank、cohere-rerank）或你定义的；留空 = bocha-jev。默认 空' },
  'evidence.maxJevQuestions': { en: 'Most (need, block) pairs asked of the model per search, at least 1. Default: 64', zh: '每次搜索向模型提的（需求, 文本块）对的上限，至少 1。默认 64' },
  'evidence.judge.allowLlm': { en: 'true = providers that speak the llm protocol may be used | false. Risk: general LLM calls cost tokens. Default: false', zh: 'true = 允许使用 llm 协议的 provider | false。风险：通用 LLM 调用消耗 token。默认 false' },
  'evidence.judge.providers': { en: 'JSON object: scoring providers by id {protocol, baseUrl, model, keyRef, ...}; a preset id overrides its fields. keyRef is only the NAME of the key: never put a key value here. Default: empty', zh: 'JSON 对象：按 id 定义评分 provider {protocol, baseUrl, model, keyRef, …}；与预设同名则覆盖字段。keyRef 只是 Key 的名字：切勿在这里写 Key 的值。默认 空' },
  'evidence.coverage.mode': { en: 'Coverage judge: off | shadow (record the probability) | control (weak support becomes a gap). Not switched on by the scoring mode. Default: off', zh: '覆盖判定：off | shadow（记录概率）| control（弱支持降级为缺口）。不随评分模式自动开启。默认 off' },
  'evidence.coverage.provider': { en: 'Coverage provider id; must speak the systemone protocol; empty = the scoring provider. Default: empty', zh: '覆盖判定的 provider id；必须是 systemone 协议；留空 = 同评分 provider。默认 空' },
  'evidence.coverage.thresholds.weak': { en: 'Probability below which a need counts as weak, 0-1; set together with the covered threshold (weak <= covered). Empty = the calibrated value shipped for bocha-jev + cover.sufficient v1', zh: '概率低于它判为弱，0–1；与覆盖阈值同时填写（弱 ≤ 覆盖）。留空 = 随插件发布的、仅对 bocha-jev + cover.sufficient v1 校准过的值' },
  'evidence.coverage.thresholds.covered': { en: 'Probability from which a need counts as covered, 0-1. Empty = the calibrated value', zh: '概率不低于它判为覆盖，0–1。留空 = 校准值' },
  'evidence.budget.perSearchInputTokens': { en: 'Most model input tokens one search may use; beyond it the search falls back to rule scoring; 0 = no model call. Default: 60000', zh: '一次搜索最多使用的模型输入 token；超限则回退规则评分；0 = 不调用模型。默认 60000' },
  'evidence.budget.dailyInputTokens': { en: 'Most model input tokens per day, counted by the time zone below. Default: 1000000', zh: '每日最多使用的模型输入 token，按下面的时区按日统计。默认 1000000' },
  'evidence.budget.timezone': { en: 'IANA time zone of the day boundary (Asia/Shanghai); empty = the system time zone. Default: empty', zh: '日界线所用的 IANA 时区（如 Asia/Shanghai）；留空 = 系统时区。默认 空' },
  'evidence.budget.providers': { en: 'JSON object: caps per provider, e.g. {"bocha-jev": {"dailyInputTokens": 200000}}; the stricter of this and the global cap applies. Default: empty', zh: 'JSON 对象：按 provider 的上限，如 {"bocha-jev": {"dailyInputTokens": 200000}}；与全局上限取更严者。默认 空' },
  'provider.evidence': { en: 'What the built-in web_search returns once routed through this plugin: auto = an evidence pack (a plain list on failure or timeout) | off = the source list only. Default: auto', zh: '内置 web_search 经本插件后返回什么：auto = 证据包（失败或超时退回普通列表）| off = 只返回来源列表。默认 auto' },
  'provider.deadlineMs': { en: 'Deadline of the evidence run inside one built-in web_search in milliseconds, at least 100; at the deadline the partial result returns. Default: 25000', zh: '一次内置 web_search 内证据管线的期限（毫秒），至少 100；到点返回已有结果。默认 25000' },
  'sources.priority': { en: 'Source ids ranked first in this order (only ready sources that fit the task language and profile); an engines list in the call still wins. Default: empty', zh: '按此顺序排最前的来源 id（仅限就绪且适合任务语言与 profile 的来源）；调用里的 engines 仍然最优先。默认 空' },
  'sources.disabled': { en: 'Source ids never used by automatic planning or the engines list (a source named in the call still runs). Put deepseek here to opt out of the billed DeepSeek default. Default: empty', zh: '自动规划与 engines 列表都不再使用的来源 id（调用里明确指定的仍可用）。想关掉按量计费的 DeepSeek 默认就把 deepseek 写在这里。默认 空' },
}

/** Doc of one `keyedSources.<id>.<key>` / `sources.budget.<id>.<axis>` / `evidence.rubrics.<id>` field. */
function family(field: string): Doc | undefined {
  let m = /^keyedSources\.(.+)\.apiKeyEnv$/.exec(field)
  if (m) {
    const name = SOURCE_NAME[m[1]!] ?? m[1]!
    return { en: `Name of the credential / environment variable holding the ${name} key (the key itself is never stored here); empty = the default name.`, zh: `保存 ${name} Key 的凭据 / 环境变量名（Key 本身从不写在这里）；留空 = 默认名。` }
  }
  m = /^keyedSources\.(.+)\.baseUrl$/.exec(field)
  if (m) {
    const name = SOURCE_NAME[m[1]!] ?? m[1]!
    return { en: `Endpoint base of ${name} (an http(s) URL); override only for a proxy or private gateway. Empty = the built-in endpoint.`, zh: `${name} 的接口地址（http(s) URL）；仅在使用代理或私有网关时覆盖。留空 = 内置地址。` }
  }
  m = /^sources\.budget\.(.+)\.(total|daily)$/.exec(field)
  if (m) {
    const name = SOURCE_NAME[m[1]!] ?? m[1]!
    return m[2] === 'total'
      ? { en: `Most requests ever sent to ${name} (counted in the usage ledger, kept across restarts); a used-up source is skipped and the plan falls back, never an error. Empty = no cap.`, zh: `${name} 累计最多请求次数（计入用量账本，重启后仍有效）；用完被跳过并回退到其他来源，不是错误。留空 = 不限。` }
      : { en: `Most requests per calendar day to ${name} (the day boundary follows the budget time zone). Empty = no cap.`, zh: `${name} 每个自然日最多请求次数（日界线取评分用量上限里的时区）。留空 = 不限。` }
  }
  m = /^sources\.confidence\.(.+)$/.exec(field)
  if (m) return { en: `Confidence of ${m[1]!} (a source or a platform backend), 0-1: it weighs a little less in the rank fusion of several sources and is printed with its results; 1 changes nothing. Empty = 1 for a built-in source, the \`confidence\` of its spec (default 0.5) for a custom CLI.`, zh: `${m[1]!}（来源或平台后端）的置信度，0–1：多个来源融合排名时权重略低，并随结果显示；1 不改变任何东西。留空 = 内置来源为 1，自定义 CLI 取其规格里的 \`confidence\`（默认 0.5）。` }
  m = /^evidence\.rubrics\.(.+)$/.exec(field)
  if (m) return { en: `JSON object overriding the built-in judge rubric ${m[1]} {version, instructions, criteria?, maxStateChars, maxCandidateChars}; the version must differ from the built-in one, an invalid override is ignored. Default: empty (the built-in rubric)`, zh: `JSON 对象，覆盖内置评分 rubric ${m[1]}：{version, instructions, criteria?, maxStateChars, maxCandidateChars}；版本号必须不同于内置，无效的覆盖会被忽略。默认 空（用内置）` }
  return undefined
}

/** The doc of a config field in a language; undefined only for a field the card does not know. */
export function fieldDoc(field: string, lang: DocLang | string = 'en'): string | undefined {
  const doc = DOCS[field] ?? family(field)
  return doc ? (lang === 'zh' ? doc.zh : doc.en) : undefined
}

/** The docs of the groups of keys and the header of the text view. */
export function textViewDocs(lang: DocLang | string = 'en'): { header: readonly string[]; group: Readonly<Record<string, string>> } {
  return lang === 'zh'
    ? {
      header: [
        'Web Search Pro 的设置，写在 settings.yaml 的 web-search-pro: 段（也是 profile 的 cordis.patch.yml 里 web-search-pro 条目的 config）。',
        '`键: 值` 表示覆盖默认值；以 # 开头的行是注释，被读取时忽略；每个键上面的注释说明用途、取值、默认值与风险。',
        '被注释的 `# 键: 值` 行是未覆盖的键（显示当前生效的值）；密钥从不出现在这里，只有保存密钥的凭据引用名。这份文本是面板里控件的只读视图：修改请用控件。',
      ],
      group: CONFIG_GROUP_TITLES.zh,
    }
    : {
      header: [
        'Web Search Pro settings, as written in the web-search-pro: section of settings.yaml (the config of the web-search-pro entry in a profile\'s cordis.patch.yml).',
        '`key: value` overrides the default. A line starting with # is a comment and is ignored when read; the comment above each key says what it is for, the allowed values, the default and any risk.',
        'A commented `# key: value` line is a key you have not overridden (it shows the value in force). Secrets never appear here, only the names of the credentials that hold them. This text is a read-only view of the controls in the panel: edit the controls.',
      ],
      group: CONFIG_GROUP_TITLES.en,
    }
}
