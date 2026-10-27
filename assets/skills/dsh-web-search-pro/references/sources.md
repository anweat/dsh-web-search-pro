# Sources, the catalog, and keyed-source setup

`search.recommend` answers "which source for this task" from the shipped catalog (`catalog/sources.v1.json`) plus what is actually ready on this machine. Ask it; do not read this list to choose.

## 来源策略 (source policy and cost tiers)

Every source has a cost tier, shown by `search.recommend` and `sources.status`:

- `anonymous`: no key, account or money (rate limits aside): `ddg`, `bing`, `exa` over its keyless MCP route (needs `mcporter` and an `exa` MCP server), `wikipedia`, `hackernews`, `stackexchange`, `openalex`, `semanticscholar`, `anysearch`, `github`, `arxiv`, `pubmed`, `v2ex`, `rss`, `searxng`.
- `free-quota`: needs a key, account or login and is free to use: `tavily` (1000 credits a month), `brave` ($5 of credits a month, a card for identity), `linkup`, `serper` (2500 queries at sign-up, once), `jina` (10M tokens per new key, once), `baidu-qianfan` (100 calls a day), `exa` with an API key ($10 a month), `github-code` (a free token), login platforms.
- `paid`: `deepseek` ($0.75 per 1,000 successful requests), `bocha`, `metaso`, `zhipu` (no free allowance on the official pages).

Order of precedence for the automatic plan: (1) `engines` / `platform` in the call; (2) the user's `priority` list (setting `sources:`); (3) sources the user configured with a key, promoted for their language and profile (at most two, one per family; `deepseek`, the 常用 source, goes first of them in both languages, and leads a plain search's default chain while `engines` is the default list); (4) otherwise the anonymous / free defaults. A paid source is used only when the user configured its key; `evidence.sourcePolicy: anonymous-only` never uses a source that needs a key, account or login. `budget: { <id>: {total, daily} }` under `sources:` (optional, nothing is capped by default) caps a source; a used-up one is skipped with a note and the plan falls back to free sources. `sources.status` shows used and remaining requests. Example for a Bocha account with 1000 requests: `sources: { budget: { bocha: { total: 1000, daily: 50 } } }`. These are the user's settings: do not change them, tell the user.

## Kinds

- **Anonymous APIs** (no setup): `ddg`, `bing`, `wikipedia` (zh/en), `hackernews`, `stackexchange` (daily quota), `openalex`, `semanticscholar`, `arxiv`, `pubmed`, `github` (a token only raises the rate limit), `v2ex`, `rss`, `anysearch` (per-IP limit).
- **Key-based** (inactive until a key exists; shown as `credential: missing` in `sources.status`):

| id | language | key variable |
|---|---|---|
| `deepseek` | zh + en, 常用 | `DEEPSEEK_API_KEY` (DeepSeek Search API; verified live 2026-10-26; billed, see below) |
| `exa` | en | `EXA_API_KEY` |
| `bocha` | zh | `BOCHA_SEARCH_API_KEY` (falls back to `BOCHA_JEV_API_KEY`; verified live 2026-10-04) |
| `tavily` | en | `TAVILY_API_KEY` |
| `brave` | en | `BRAVE_API_KEY` |
| `linkup` | en | `LINKUP_API_KEY` |
| `serper` | any (a Google SERP wrapper, not independent corroboration) | `SERPER_API_KEY` |
| `metaso` | zh | `METASO_API_KEY` |
| `zhipu` | zh | `ZHIPU_API_KEY` |
| `baidu-qianfan` | zh | `QIANFAN_API_KEY` |
| `jina` | any | `JINA_API_KEY` |

- **Self-hosted**: `searxng` needs `searxngUrl` in settings (no public instance is built in).
- **CLI** (`sources.deps` lists them with `installation`: missing / detected / incompatible; `sources.install` installs one when the user asks): `bili`, `yt-dlp`, `twitter` (twitter-cli, an optional fallback; also needs `TWITTER_AUTH_TOKEN` and `TWITTER_CT0` in DSH credentials or the Host process environment, not just a shell profile), `xhs`, `zhihu`, `rdt` (optional fallbacks), `omnireach`, `gh`, `wx-search-cli`, `tanso`, standalone `opencli`, the user's own `cliAdapters`, `mcporter`, `agent-reach` (optional helper). See "Backend chains" below.
- **Browser-based** (need dsh-browser and a saved login): `weibo`, `douban`, `tieba`, `douyin`, `kuaishou`, and the dsh-browser OpenCLI legs of `instagram` / `facebook` (and the last legs of `xiaohongshu`, `reddit`, `twitter`, `zhihu`).

## Backend chains (CLI adapters)

Every platform is ONE source with an ordered chain of backends; the first usable one answers, empty or failing ones fall through. `sources.status` shows each platform's `chain` (order, state, why a backend is skipped). Defaults: `xiaohongshu`: opencli (standalone) > xhs > browser-opencli; `reddit`: opencli > rdt > browser-opencli; `zhihu`: opencli > zhihu > browser-search; `twitter`: opencli > twitter > browser-opencli (the four login platforms try the standalone OpenCLI first: it uses the login of the user's own day-to-day Chrome); `bilibili`: bili; `youtube`: yt-dlp; `github`, `github-issues`, `github-code`: rest > gh; `wechat` (公众号): omnireach > wx-search-cli; `omnireach` (multi-source, never planned on its own). The user can reorder with `platformBackends: { <platform>: [ids] }` (an explicit order is used as written) and add read-only adapters in `cliAdapters` (platform `custom-cli:<id>`); an invalid entry is ignored and explained in `sources.status` `notes`.

- A backend that is not installed, has another contract (`incompatible`, with the reason), is not logged in, was blocked by the site or failed is passed over; the result's notes say `skipped backends: <id>: <reason>` and the history names the backend that answered. When the whole chain is down the error names every backend and what to install or run. Report it; do not retry.
- **Login is the user's job.** Never run `xhs login`, `rdt login`, `zhihu login`, `gh auth login` or anything like them, and never pass cookie options. For `xiaohongshu`, `zhihu`, `reddit` and `twitter` the recommended path is the standalone `opencli`, which uses the login of the user's own Chrome (the user logs in to the site there and has the OpenCLI Browser Bridge extension installed): when it reports "not logged in", tell the user to log in to that site in their Chrome and retry; do not look for a login command. The CLIs `xhs`, `rdt`, `zhihu`, `twitter` are optional fallbacks the user logs in with the tool's own login; they are not run until a saved login exists (without one they read browser cookies themselves). A failure that says the site "returned a web page instead of data" is a login wall, risk control or an IP block (Reddit blocks proxied addresses): report it, do not retry in a loop.
- Verification differs per adapter (`sources.deps` shows it): `live` (bili, gh repos / issues / code, omnireach, yt-dlp, wx-search-cli, xhs, and standalone opencli for the twitter and zhihu sites), `contract-only` (help probed, output shape from the tool's source or docs, no successful search run: zhihu, rdt, twitter CLIs and standalone opencli for xiaohongshu / reddit; `sources.status` tags these backends), `docs-only` (tanso, from upstream docs). Treat contract-only and docs-only results as experimental.
- The plugin only ever runs read commands (search); posting, liking, following and the like are refused by the adapter spec itself.

## Platforms (one site or community)

Platforms are sources like any other (`sources.status` lists them with `kind: platform`, their domains and whether dsh-browser, a login or a token is in place). They are never picked for you: name one with `platform`, or put a hard `site` constraint on its domain (`zhihu.com`) and a ready platform goes first with one web engine kept as the fallback.

```json call
{"action":"search.run","args":{"query":"机械键盘 轴体 推荐","task":"了解知乎上对机械键盘轴体的真实经验","profile":"experience","platform":"zhihu","needs":"哪种轴体最适合办公;常见的踩坑"}}
```

- Evidence mode with `platform` reads the top result pages and scores them like web results. Pages that need a login may stay navigation-only.
- `platform` that cannot run (no dsh-browser, login or CLI missing, cooling down) is an error (`CAPABILITY_UNAVAILABLE`) whose hint carries the setup text. Report it to the user; do not read it as "no results". `allowFallback:true` searches the web engines instead and the pack notes it.
- A platform that ran but found nothing returns an empty list with a note (often "needs a login": see `browserBindings`); nothing is cooled down for that.
- `url` (rss only), `authProfile` and `rulePack` go with `platform`; `browserBindings` fill the last two per platform.
- The user's own `customPlatforms` appear here as platforms too, under their key.

## DeepSeek Search and Fetch (常用)

`deepseek` is the plugin's common source: `POST https://api.deepseek.com/v1/tools/search`, the same API key as the DeepSeek models (`DEEPSEEK_API_KEY`, a DSH credential, or `keyedSources.deepseek.apiKey`). $0.75 per 1,000 SUCCESSFUL requests (empty results and failures are free; `count` does not change the price); calls through the Harness's own tools are free until 2026-11-01 Beijing time, but this plugin's direct calls are treated as billed. Results carry a model-ready `summary` (used as the excerpt), `date`, and the provider's own grades `rerankScore` (0-3, 1.5+ is good) and `authority` (0-4, 3+ is high): hints, not proof. Queries are cut to 128 characters (operators kept) and the result says so. 402 means the account balance is empty: tell the user to top it up. Cap it with the `sources` setting's `budget.deepseek`; turn it off by listing `deepseek` under its `disabled`. The Fetch API is `read.fetch mode:"deepseek"` (auto mode uses it as a fallback when `deepseekFetch` is on); its 403 / 404 are DeepSeek's answer, not the page's HTTP status.

## Setting a key (the user does this; never ask for the key value)

A key is read from, in order: the literal in settings (`exaApiKey`, `keyedSources.<id>.apiKey`), a credentials reference (`...Env` / `apiKeyEnv` names a variable or credential), then the default variable above. Tell the user which variable to set, then call `sources.status` and check the source shows `credential: configured`. A key that is configured but rejected (401/403) is reported as an error, not a cooldown.

```yaml
keyedSources:
  tavily:
    apiKeyEnv: TAVILY_API_KEY
```

## Reading `sources.status`

- `engines[].state`: `ready`, `cooldown` (a recent failure or a service-supplied wait), `missing`/`unavailable` (see `reason`).
- `providers[].readiness`: `installation`, `credential`, `health` (`unknown` until a real call succeeded in this process; nothing is claimed verified before that), `cooldownUntil`.
- `unverified` / `[not verified live]`: the adapter follows the vendor docs but has never been called live; treat its results as experimental.
