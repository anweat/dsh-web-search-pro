# Troubleshooting

Start with `sources.status`: it makes no search request and shows engine state, readiness, CLI health, browser state and judge settings.

| symptom | cause and fix |
|---|---|
| `resolved to proxy fake-IP ...` | Clash/TUN fake-IP DNS (`198.18.0.0/15`, `fdfe:dcba:9876::/64`, `2001:2::/48`). Ask the user to enable `allowProxyFakeIp` in the plugin's advanced settings (default off). It trusts only those DNS answers; literal fake-IP URLs, localhost and other private addresses stay blocked. |
| `quota_exhausted (HTTP 402)`, `ENGINE_QUOTA`, "no credit/quota" | The account or the anonymous tier is used up. It is not retried or cooled down. Use another source from `search.recommend`; for a keyed source tell the user to top up. Never retry in a loop. |
| `ENGINE_RATE_LIMIT`, 429, a source in `cooldown` | The service said wait; the plugin respects `Retry-After`. Use a different source now; `cooldownUntil` shows when it is free. |
| 401 / 403 on a keyed source | The key is rejected: the user must check it. It does not cool the source down. |
| every engine returned nothing | Not an error. Rephrase, add a `site:` word, or try a source from `search.recommend`; a `fallbackNote` lists who was tried and skipped. |
| `unknown engine: x (available: ...)` | Use an id from the list in the message, or from `search.recommend`. |
| `platform X unavailable ... dsh-browser` | A browser-based or OpenCLI platform without the dsh-browser plugin (or with an older one). `sources.status` -> `browser` says `missing` / `incomplete`. Use a non-browser source, or ask the user to install or update it. |
| login pages (`login_wall`), captcha | The text is not the content. Chinese communities need a saved, domain-scoped login (`browserBindings`). Do not try to bypass a captcha. |
| `js_shell` / empty page text | The page needs JavaScript. With dsh-browser ready, `read.fetch` already tried a render in `auto` mode; otherwise `read.snapshot`, or add a site rule (`rules.upsert` with `contentSelectors`). |
| twitter source `unavailable` | The `twitter` command, `enableCliBackends`, `agentReachEnabled` and `TWITTER_AUTH_TOKEN` + `TWITTER_CT0` must all be in place; the `note` says which is missing. `sources.deps` shows the install command. |
| `model budget exceeded` in notes | The judge's token cap was reached; rule scores were used. Results remain valid. |
| `partial: true` | The overall time limit (`timeoutMs` + 30 s) was reached; the pack holds what was ready. Expand or search again narrower. |
| `NOT_FOUND` on an id | Ids (`history`, `evidenceId`) disappear when the query is deleted or cleared. List again with `history.list`. |
