# dsh-web-search-pro

English | [中文](./README.md)

An enhanced web search plugin for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (DSH): multi-engine search, platform search, a persistent cache and evidence packs, with only two tools resident in the model's context.

> The detailed guides linked below are written in Chinese. This page covers install, first use and the everyday settings in English.

- **Evidence-pack mode**: give `search.run` a one-sentence task and it returns scored excerpts plus the gaps that remain, instead of a result list. It uses far less context.
- **Multi-engine plus platform sources**: web engines (ddg, bing, Exa, Jina ...) and platforms (GitHub, Bilibili, YouTube, Xiaohongshu, Zhihu, Reddit, X, RSS ...) share one probing, cooldown, fallback and history path. DeepSeek Search / Fetch is the "common" source (billed per request).
- **You do the logging in**: platforms that need a login go opencli-first (your everyday Chrome's session). The plugin has no login window and never reads cookies.
- **Two resident tools**: `web_index` (catalog) then `web_call` (execute). 27 actions are disclosed on demand, about 800 characters resident.
- **Persistence**: SQLite plus in-memory LRU cache, query history, re-importable per-site extraction rules.
- **Visual settings**: one settings card for search order, keys, custom CLIs and the scoring model. Changes an agent makes appear as an overlay you can adopt or revert with one click.

## Compatibility

| Item | Range |
|---|---|
| dsh-web-search-pro | `0.2.3` |
| DSH host (peer) | `>=0.2.0-rc.2 <0.2.1-0 \|\| >=0.2.1-rc.2 <0.2.2-0`; verified on `0.2.0-rc.2`, `0.2.1-rc.3`, `0.2.1-rc.4` |
| cordis (peer) | `~4.0.4` |
| Optional companion `@anweat/dsh-browser` | `^0.2.0` (on 0.2.1-line hosts it must be `0.2.2` or later) |
| DSH 0.1.x hosts or dsh-browser 0.1.x | Stay on `dsh-web-search-pro@0.1.15`; it is no longer updated |

The compatibility table of earlier versions is in the [CHANGELOG](./CHANGELOG.md#兼容与发布通道历史); how the peer range is written is explained in [Compatibility](https://github.com/anweat/dsh-web-search-pro/blob/master/docs/guide/compatibility.md) (Chinese).

## Installation

**DSH CLI** (restart the profile afterwards):

```bash
# Search only:
dsh plugin --profile web add dsh-web-search-pro@0.2.3
# Plus rendered pages / browser platforms: install the optional browser plugin together (both must be direct dependencies of the profile)
dsh plugin --profile web add @anweat/dsh-browser@0.2.2 dsh-web-search-pro@0.2.3
dsh --profile web
```

**DSH Desktop**: Desktop manages its profile itself and the CLI cannot operate it. Open the **Plugins** page, click **Add plugin**, enter the package name (a version may be appended, for example `dsh-web-search-pro@0.2.3`, the same text as after `add` above), then Install. The dialog also lets you pick a **Registry**. Upgrading a non-official plugin means uninstalling and reinstalling it. Mirrors such as npmmirror can lag the official registry by minutes to hours; if a new version cannot be installed, switch the Registry to `https://registry.npmjs.org`.

**Local directory / tarball (development)**: `dsh plugin --profile web add ../dsh-browser ./dsh-web-search-pro`.

More (first-install notes and troubleshooting) in [Install and first use](https://github.com/anweat/dsh-web-search-pro/blob/master/docs/guide/install.md) (Chinese); upgrading is covered in the [CHANGELOG](./CHANGELOG.md#从旧版本升级).

## First use

- **Settings card**: `Settings -> Plugins -> Plugin config -> Web Search Pro`. The status summary at the top shows the default engine chain in the order it is actually tried, how many sources have a key, whether DeepSeek is ready, and pending restarts.
- **Check the backends**: have the model call `web_call` with `sources.status`; the readiness of every source and platform, and why a backend was skipped, are listed there.
- **Sources and keys**: web search and the evidence pipeline work right after install (ddg / bing need no key). With a `DEEPSEEK_API_KEY` the default search leads with DeepSeek Search, which is **billed per request**; put `deepseek` under `sources.disabled` to opt out. Exa, Jina, Bocha, GitHub and other keys are entered in the card's "Sources" group (stored in DSH Credentials and never read back).
- **Defaults out of the box:** Jev is off by default (`evidence.jevMode: off`; evidence scoring uses the local rules and no model is called, no model key is needed); Bocha is used only when you configure a key. **Exception:** DeepSeek Search (the common, 常用, source; billed per request) leads the default order as soon as a DeepSeek API key resolves (settings key field, DSH credential `DEEPSEEK_API_KEY`, or the process environment); put `deepseek` under `sources.disabled` or write your own `engines` list to opt out.
- **Optional dependencies**: the browser plugin `@anweat/dsh-browser` (`read.snapshot`, `read.fetch mode=playwright`, search-page platforms; an installed Chrome / Edge is used directly, no Chromium download); `npm i -g @jackwener/opencli` plus its Browser Bridge extension (Xiaohongshu / Zhihu / Reddit / X, using your everyday Chrome's login, see [Platform login](https://github.com/anweat/dsh-web-search-pro/blob/master/docs/guide/platform-login.md)); CLIs such as bili, yt-dlp and gh are detected by `sources.deps`.

## Quick examples

The model calls `web_call({action, args})`. An evidence pack (pass `task` or `profile`):

```json
{"action":"search.run","args":{"query":"node:sqlite busy timeout","task":"how to set a busy timeout in node:sqlite","profile":"docs_code"}}
```

Search one platform (login platforms use the opencli-first backend chain):

```json
{"action":"search.run","args":{"query":"机械键盘 轴体 推荐","task":"了解知乎上对机械键盘轴体的真实经验","profile":"experience","platform":"zhihu"}}
```

Read a page with `read.fetch` (pass `offset` to continue a long page); ask `search.recommend` when you do not know which source to use. More in [Search and evidence](https://github.com/anweat/dsh-web-search-pro/blob/master/docs/guide/search-and-evidence.md) (Chinese).

## Tools and actions

Only two tools are resident: `web_index({group?, action?, query?})`, a progressive-disclosure catalog, and `web_call({action, args})`, which runs an action and returns a uniform envelope. Usage guidance ships in the skill `dsh-web-search-pro`.

| Group | Actions | Purpose |
|---|---|---|
| `search` | `run` `recommend` | Multi-engine / platform search and evidence packs; recommend at most 3 sources for a task |
| `read` | `fetch` `contents` `snapshot` | Readable fetch with continuation; Exa batch contents; browser snapshot |
| `history` | `list` `replay` `expand` `export` `delete` | List, replay, expand evidence blocks, export and delete query history |
| `sources` | `status` `deps` `install` | Backend probing and diagnostics; external dependency check and install |
| `rules` | `list` `upsert` `remove` `import` `export` | Per-site extraction rules |
| `cache` | `clear` `stats` | Cache cleanup and statistics |
| `config` | `inspect` `set_order` `set_confidence` `upsert_cli` `remove_cli` `reset` `export` | Agent overlay: adjust search order, confidence and custom CLIs at runtime |

Full parameters, approval rules, output budgets and the old tool mapping are in [Tools and actions](https://github.com/anweat/dsh-web-search-pro/blob/master/docs/guide/tools-and-actions.md) (Chinese).

## Common settings

Set them under `web-search-pro:` in `$DSH_HOME/settings.yaml`, or use the settings card. Almost all are hot-reloaded.

| Key | Default | Meaning |
|---|---|---|
| `engines` | `[ddg, bing, exa, seam, jina]` | Fallback order of general search |
| `sources.priority` / `sources.disabled` | empty | Source ids to move first / never use (for example `disabled: [deepseek]`) |
| `searchMaxResults` | `8` | Default number of results of a plain search |
| `evidence.jevMode` | `off` | Bocha Jev scoring: `off` \| `shadow` \| `control` \| `hybrid` (paid, not called by default) |
| `evidence.sourcePolicy` | `default` | `anonymous-only` = automatic planning never uses a source that needs a key, account or login |
| `deepseekFetch` | `false` | `true` = `read.fetch` may use the DeepSeek Fetch API (billed per request) |
| `fetchDefaultChars` | `20000` | Default characters returned by `read.fetch` |
| `toolSurface` | `indexed` | `flat` = one tool per action (for comparison and debugging only); **restart required** |
| `registerProvider` | `false` | Route the host's built-in `web_search` / `web_fetch` through this plugin; **restart required** |

Only these need a plugin restart: `toolSurface`, `registerProvider`, `providerId`, `timeoutMs`, `memoryCacheEntries`, `dbPath`, `verbose`, `playwright.snapshotDir`. All keys and defaults are in the [configuration reference](https://github.com/anweat/dsh-web-search-pro/blob/master/docs/guide/config.md) (Chinese).

## Documentation

The detailed guides (Chinese) are under [docs/](https://github.com/anweat/dsh-web-search-pro/blob/master/docs/README.md):

- Usage: [Install and first use](https://github.com/anweat/dsh-web-search-pro/blob/master/docs/guide/install.md) · [Search and evidence](https://github.com/anweat/dsh-web-search-pro/blob/master/docs/guide/search-and-evidence.md) · [Tools and actions](https://github.com/anweat/dsh-web-search-pro/blob/master/docs/guide/tools-and-actions.md) · [History](https://github.com/anweat/dsh-web-search-pro/blob/master/docs/guide/history.md)
- Configuration: [Configuration reference](https://github.com/anweat/dsh-web-search-pro/blob/master/docs/guide/config.md) · [Settings panel](https://github.com/anweat/dsh-web-search-pro/blob/master/docs/guide/settings-panel.md) · [Sources and engines](https://github.com/anweat/dsh-web-search-pro/blob/master/docs/guide/sources.md) · [Built-in web tool routing](https://github.com/anweat/dsh-web-search-pro/blob/master/docs/guide/web-provider.md) · [Jev scoring](https://github.com/anweat/dsh-web-search-pro/blob/master/docs/guide/evidence-scoring.md)
- Platforms and CLIs: [Platform login](https://github.com/anweat/dsh-web-search-pro/blob/master/docs/guide/platform-login.md) · [CLI adapters and custom CLIs](https://github.com/anweat/dsh-web-search-pro/blob/master/docs/guide/cli-adapters.md) · [External dependencies](https://github.com/anweat/dsh-web-search-pro/blob/master/docs/guide/dependencies.md) · [Custom platforms](https://github.com/anweat/dsh-web-search-pro/blob/master/docs/guide/custom-platforms.md) · [Browser scripts and automation tiers](https://github.com/anweat/dsh-web-search-pro/blob/master/docs/guide/browser-scripts.md)
- Versions and development: [Compatibility](https://github.com/anweat/dsh-web-search-pro/blob/master/docs/guide/compatibility.md) · [CHANGELOG](./CHANGELOG.md) · [Development](https://github.com/anweat/dsh-web-search-pro/blob/master/docs/guide/development.md) · [Design and research notes](https://github.com/anweat/dsh-web-search-pro/tree/master/docs/dev) · [Validation records](https://github.com/anweat/dsh-web-search-pro/tree/master/docs/validation)

## License

MIT. The routing control plane borrows the backend probing, ordered selection and failure-cooldown ideas of Agent-Reach; the core logic is this project's own TypeScript.
