# Troubleshooting

Start with `sources.status`: it makes no search request and shows engine state, readiness, CLI health, browser state and judge settings.

| symptom | cause and fix |
|---|---|
| `resolved to proxy fake-IP ...` | Clash/TUN fake-IP DNS (`198.18.0.0/15`, `fdfe:dcba:9876::/64`, `2001:2::/48`). Ask the user to enable `allowProxyFakeIp` in the plugin's advanced settings (default off). It trusts only those DNS answers; literal fake-IP URLs, localhost and other private addresses stay blocked. |
| `quota_exhausted (HTTP 402)`, `ENGINE_QUOTA`, "no credit/quota" | The account or the anonymous tier is used up. It is not retried or cooled down. Use another source from `search.recommend`; for a keyed source tell the user to top up. Never retry in a loop. |
| DeepSeek `HTTP 402 ... 余额不足` | The DeepSeek API balance is empty (Search and Fetch share it). Tell the user to top it up at platform.deepseek.com; the plugin falls back to the next source meanwhile. 408 / 429 / 5xx from DeepSeek are retried twice after a wait before they count as a failure. |
| `ENGINE_RATE_LIMIT`, 429, a source in `cooldown` | The service said wait; the plugin respects `Retry-After`. Use a different source now; `cooldownUntil` shows when it is free. |
| 401 / 403 on a keyed source | The key is rejected: the user must check it. It does not cool the source down. |
| every engine returned nothing | Not an error. Rephrase, add a `site:` word, or try a source from `search.recommend`; a `fallbackNote` lists who was tried and skipped. |
| `unknown engine: x (available: ...)` | Use an id from the list in the message, or from `search.recommend`. |
| `platform X unavailable ... dsh-browser` | A browser-based or OpenCLI platform without the dsh-browser plugin (or with an older one). `sources.status` -> `browser` says `missing` / `incomplete`. Use a non-browser source, or ask the user to install or update it. |
| `dsh-browser 0.1.x is not supported by web-search-pro 0.2+` | Legacy browser: `sources.status` shows `browser: legacy (unsupported)`. `read.snapshot`, `read.fetch mode=playwright`, browser and OpenCLI platforms refuse; `auto` fetch skips the browser; everything else works. Tell the user to upgrade to `@anweat/dsh-browser ^0.2.0`; do not retry. |
| `CAPABILITY_UNAVAILABLE`, `platform X unavailable: ...` | A platform you named cannot run: the message says what is missing (browser, login, CLI, token, settings switch, cooldown) and the hint has the setup text. Tell the user. In evidence mode `allowFallback:true` searches the web engines instead; the pack's notes say so. |
| `opencli is not logged in`, or `the site returned a web page instead of data, or blocked the request` in a platform error or in `skipped backends` | The standalone OpenCLI uses the login of the user's own Chrome: ask the user to log in to that site in their Chrome (and check `opencli doctor` for the Browser Bridge extension). The second wording is a login wall, risk control or an IP block (Reddit blocks proxied addresses); report it, do not retry in a loop. The plugin never logs in for the user. |
| platform result is empty with `no results: ...` in `fallbackNote` | The platform ran and returned nothing; the note is the platform's own hint (usually a missing login or changed page selectors). Not an error and not cooled down. |
| login pages (`login_wall`), captcha | The text is not the content. Chinese communities need a saved, domain-scoped login (`browserBindings`). Do not try to bypass a captcha. |
| `js_shell` / empty page text | The page needs JavaScript. With dsh-browser ready, `read.fetch` already tried a render in `auto` mode; otherwise `read.snapshot`, or add a site rule (`rules.upsert` with `contentSelectors`). |
| twitter source `unavailable` | The `twitter` command (twitter-cli 0.8.5+, its `search --help` must list `--json`), `enableCliBackends`, `agentReachEnabled` and `TWITTER_AUTH_TOKEN` + `TWITTER_CT0` must all be in place; the `note` says which is missing and where it looked. The tokens belong in DSH credentials (settings `twitterAuthToken` / `twitterCt0`, or the refs `twitterAuthTokenEnv` / `twitterCt0Env`) or in the Host process environment; a shell profile alone is not enough. Twitter results that look like field names or avatar/video links mean an old plugin parsing twitter-cli's default YAML (issue #38, fixed in 0.2.2). |
| `model budget exceeded` in notes | The judge's token cap was reached; rule scores were used. Results remain valid. |
| `partial: true` | The overall time limit (`timeoutMs` + 30 s) was reached; the pack holds what was ready. Expand or search again narrower. |
| `NOT_FOUND` on an id | Ids (`history`, `evidenceId`) disappear when the query is deleted or cleared. List again with `history.list`. |
