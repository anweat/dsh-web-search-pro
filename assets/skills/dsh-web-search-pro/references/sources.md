# Sources, the catalog, and keyed-source setup

`search.recommend` answers "which source for this task" from the shipped catalog (`catalog/sources.v1.json`) plus what is actually ready on this machine. Ask it; do not read this list to choose.

## Kinds

- **Anonymous APIs** (no setup): `ddg`, `bing`, `wikipedia` (zh/en), `hackernews`, `stackexchange` (daily quota), `openalex`, `semanticscholar`, `arxiv`, `pubmed`, `github` (a token only raises the rate limit), `v2ex`, `rss`, `anysearch` (per-IP limit).
- **Key-based** (inactive until a key exists; shown as `credential: missing` in `sources.status`):

| id | language | key variable |
|---|---|---|
| `exa` | en | `EXA_API_KEY` |
| `bocha` | zh | `BOCHA_SEARCH_API_KEY` (falls back to `BOCHA_JEV_API_KEY`) |
| `tavily` | en | `TAVILY_API_KEY` |
| `brave` | en | `BRAVE_API_KEY` |
| `linkup` | en | `LINKUP_API_KEY` |
| `serper` | any (a Google SERP wrapper, not independent corroboration) | `SERPER_API_KEY` |
| `metaso` | zh | `METASO_API_KEY` |
| `zhipu` | zh | `ZHIPU_API_KEY` |
| `baidu-qianfan` | zh | `QIANFAN_API_KEY` |
| `jina` | any | `JINA_API_KEY` |

- **Self-hosted**: `searxng` needs `searxngUrl` in settings (no public instance is built in).
- **CLI** (`sources.deps` lists them, `sources.install` installs one when the user asks): `bili`, `yt-dlp`, `twitter` (also needs `TWITTER_AUTH_TOKEN` and `TWITTER_CT0`), `mcporter`, `agent-reach` (optional helper).
- **Browser-based** (need dsh-browser and a saved login): `zhihu`, `weibo`, `douban`, `tieba`, `douyin`, `kuaishou`, and OpenCLI platforms (`reddit`, `xiaohongshu`, `instagram`, `facebook`).

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
