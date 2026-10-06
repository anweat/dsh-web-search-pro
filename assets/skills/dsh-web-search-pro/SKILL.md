---
name: dsh-web-search-pro
description: "Web research with web_call search.run (an evidence pack: only the passages that answer your questions, far less context than web_search + web_fetch) and read.fetch (read a web page, continue long pages with offset). Use when asked to search the web, look up, verify, research or compare sources, or read a page or URL. 联网搜索、联网检索、查证、核实、调研、网页研究、读取网页、读取链接时使用：证据包搜索、来源推荐、长页续读、摘录展开、站点提取规则。"
---

# dsh-web-search-pro

Two tools. `web_index` shows what exists; `web_call` runs one action and returns `{ok, action, result | error{code,message,hint,schema?}}` (you read the result as text). Actions are named `group.action`. Do not guess other tool names.

For web research prefer `search.run` over `web_search` + `web_fetch`: it returns filtered evidence, not whole result lists and pages. If the Host's own `web_search` already answers with an `Evidence pack ...` (it is routed through this plugin), treat it exactly like a `search.run` pack: read gaps, then `history.expand` or `read.fetch`.

## 1. Search: evidence mode first

Pass `task` (one sentence: your goal, not the chat) or `profile` for an evidence pack: only the passages that answer your needs, with `gaps` for unanswered needs. Profiles: `docs_code`, `news_fact`, `academic`, `experience`, `compare`, `general` (inferred when omitted). Without them you get a plain source list (fetch before answering).

```json call
{"action":"search.run","args":{"query":"node:sqlite busy timeout WAL","task":"configure busy timeout and WAL for node:sqlite","profile":"docs_code","needs":"how to set busy timeout; how to enable WAL"}}
```

```json call
{"action":"search.run","args":{"query":"量子计算 最新进展 2026","task":"了解 2026 年量子计算的最新进展","profile":"news_fact","needs":"最新的纠错进展;主要厂商的路线图","constraints":"[{\"kind\":\"time_window\",\"value\":\"2026\",\"strength\":\"soft\"}]"}}
```

`needs` are `;`-separated sub-questions (default: the task). The query may be English while task and needs are Chinese.

## 2. Read the pack before answering

- Cite the evidence URLs. Every excerpt has an `evidenceId`.
- **Coverage is heuristic.** A need listed in `gaps`, or an empty pack, does not mean the answer does not exist. Before saying "not found": expand or fetch, then try another source or phrasing (`gaps[].reason`: `no_candidates`, `no_page_content`, `weak_support`, `budget`).
- `low relevance` entries only avoid an empty pack; do not lean on them.

```json call
{"action":"history.expand","args":{"evidenceId":"e_1a2b3c"}}
```

- A promising source whose excerpt was cut or missing: fetch the page.

```json call
{"action":"read.fetch","args":{"url":"https://nodejs.org/api/sqlite.html"}}
```

A long page is capped; the reply gives `nextOffset`. Continue with `offset` (served from the stored snapshot, no re-download):

```json call
{"action":"read.fetch","args":{"url":"https://nodejs.org/api/sqlite.html","offset":20000}}
```

`shellPage` / `pageClass` (js_shell, login_wall, captcha) mean the text is not the content: follow the links the reply lists, or hand off to the browser (section 6). `read.contents` fetches up to 100 URLs through Exa (needs its key); `read.snapshot` renders a page in the browser.

## 3. Choose sources: 1 or 2, never all

```json call
{"action":"search.recommend","args":{"task":"find the official documentation for Rust async runtimes","profile":"docs_code"}}
```

returns at most 3 sources, ready ones first, with how to call each (`use`) and what is missing. Use one or two; add another only when the evidence is insufficient. Sources that need setup: tell the user what is missing (`references/sources.md`) instead of calling them.

Name sources only when you have a reason:

```json call
{"action":"search.run","args":{"query":"transformer attention survey","task":"find survey papers on attention","profile":"academic","engines":"arxiv"}}
```

- `engines` takes ids from `search.recommend` / `sources.status` (aliases like `ddg` work; an unknown id lists the valid ones). Explicit engines are tried in order.
- `platform` searches one site (`github`, `v2ex`, `bilibili`, `rss` with `url`, `zhihu`, `xiaohongshu`, `twitter`, ...). With `task`/`profile` it is the evidence source (gate, page reads and scoring as usual). If it is unavailable the call fails with what is missing: tell the user, or pass `allowFallback:true` to search the web engines instead. Platforms run a backend chain; logins are the user's job (`references/sources.md`).
- **来源策略**: nothing configured = anonymous / free sources (English: Exa's keyless route, then ddg / bing; Chinese: ddg / bing). Sources the user configured a key for are promoted for their language; the user's settings `sources: {priority, disabled, budget}` are rankings and caps (a used-up source is skipped, never an error). `engines` always wins. Tiers: `references/sources.md`.

## 4. Constraints

`constraints` is a JSON string array of `{kind,value,strength}`. Kinds: `must_term`, `exclude_term`, `entity`, `version`, `time_window`, `site`, `exclude_site`, `language`, `region`, `source_type`. `hard` drops candidates that clearly violate it; `soft` (default) only prefers. Use `hard` for what the answer is useless without (a version, an official site), `soft` for preferences. Where a source supports it the constraint is pushed down (site, date window); otherwise it is checked locally, and `verification` in the pack says which.

```json call
{"action":"search.run","args":{"query":"react 19 useActionState","task":"how useActionState works in React 19","profile":"docs_code","constraints":"[{\"kind\":\"site\",\"value\":\"react.dev\",\"strength\":\"hard\"},{\"kind\":\"version\",\"value\":\"19\",\"strength\":\"soft\"}]"}}
```

## 5. Budgets

- `budget` (evidence mode): excerpt characters, default 6000, max 30000. Gaps caused by budget say so; raise it or expand.
- `count`: max results (1-20). A page read is capped at 20000 characters by default; `maxChars` raises it per call.
- Model scoring (when enabled) has a per-search and a daily token cap; `sources.status` shows usage (`references/judges.md`).
- `cache.clear`, `history.delete`, `rules.upsert|remove|import` and `sources.install` change local state or the machine: run them only when the user asks.

## 6. Browser hand-off

For pages that need interaction, login, or a rendered DOM, use the dsh-browser plugin: see its skill `dsh-browser` or call `browser_index`. `read.snapshot` and browser-based platforms work only when it is installed and ready (`sources.status` shows `browser`).

## 7. When something fails

| code | what to do |
|---|---|
| `INVALID_ARGS` | fix the arguments using the attached `schema` (an unknown engine or profile lists the valid ones) |
| `UNKNOWN_ACTION` | take a name from `error.hint` or `web_index` |
| `CAPABILITY_UNAVAILABLE` | not set up (browser missing, key missing): `sources.status`, `references/troubleshooting.md` |
| `NOT_FOUND` | stale id: `history.list` |
| `DEADLINE` | retry narrower, fewer engines |
| `ACTION_FAILED` | read the message; empty or failed engines are listed in the result (`enginesTried`, `fallbackNote`) |

Quota, fake-IP errors, cooldowns: `references/troubleshooting.md`. Judge providers and rubrics (settings, not model-editable): `references/judges.md`. Keyed sources and the catalog: `references/sources.md`. Extraction rules for a badly read site: `rules.upsert`, then `read.fetch` with `fresh:true`.
