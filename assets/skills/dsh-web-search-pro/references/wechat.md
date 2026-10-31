# WeChat official accounts (公众号)

Four layers, from free and safe to risky. The plugin never logs anyone in: what needs a login or a key is set up by the user, in the settings card ("微信 / 公众号") or the configuration (`wechat.*`).

| layer | how | login | cost | risk |
|---|---|---|---|---|
| search | `search.run platform=wechat` (chain: `omnireach` > `wx-search-cli` > `sogou`, the plugin's own Sogou client) | none | free | medium: Sogou shows captchas, the IP gets blocked for a while |
| search, paid | `tencent-wsa` (元宝搜索, Tencent Cloud), first in the chain only while `wechat.wsa.enabled` and a key | API key | per call: lite 14 / standard 20 / flagship 26 CNY per 1000 (a new account may have a free quota) | low; capped by `wechat.wsa.dailyLimit` (default 100 a day) |
| read | `read.fetch` on an `mp.weixin.qq.com` link | none | free | low |
| album | `wechat.album` (a 合集 page) | none | free | low |
| account history | `wechat.accounts`, `wechat.articles` through the user's own wechat-download-api (`wechat.history.baseUrl`) | WeChat QR scan, about 4 days | free | **high**: it uses the user's own official-account back end |

`wechat.status` shows which layer is ready now, its access line (login / risk / billing), today's 元宝搜索 use, and each layer's last failure. `probe: true` also asks the history service whether it is up and logged in.

```json call
{"action":"wechat.status","args":{}}
```

## Search and read

- `search.run platform=wechat` (add `task` for an evidence pack). Links carry a **signature** that expires within minutes to hours; the first 3 are resolved, later ones keep a `weixin.sogou.com/link` URL that `read.fetch` resolves. Read an article soon after finding it. A bare `mp.weixin.qq.com/s?__biz=...` link without `signature` normally gets a verification page: use the signed link from the search, never guess links.
- `read.fetch` reads `mp.weixin.qq.com` over HTTP first and puts `公众号 · 发布时间` above the body. `pageClass` `captcha` / `shell` = no article text; `error` = the article was removed (the text says why).
- Sogou is rate limited. A captcha makes the search fail or come back partly unresolved with a `wechat.antispider` notice: do not retry in a loop; the user can lower the rate or set up 元宝搜索.
- 元宝搜索 is paid: a `wechat.paid` notice says so with today's count. At the daily limit the leg refuses (`wechat.wsa-limit`) and the chain moves on. `wechat.wsa-setup` (action) = not activated, wrong key, no permission or arrears: the user must fix it in the Tencent console.

## Album (no login)

An album page link (`mp.weixin.qq.com/mp/appmsgalbum?__biz=…&album_id=…`) or `biz` + `albumId`; an article of an album links to it. The newest article comes first; page with `nextCursor`. The reply keeps to WeChat's pace, so do not fire many calls at once.

```json call
{"action":"wechat.album","args":{"url":"https://mp.weixin.qq.com/mp/appmsgalbum?__biz=MzA3MDM3NjE5NQ==&action=getalbum&album_id=1375870284640911361","count":5}}
```

## Account history (the user's own service)

Needs `wechat.history.baseUrl` (typically `http://127.0.0.1:5000`) and a service the user runs and scans a QR code into. Without the setting these two answer `CAPABILITY_UNAVAILABLE`: tell the user, do not look for another way.

```json call
{"action":"wechat.accounts","args":{"query":"机器之心"}}
```

```json call
{"action":"wechat.articles","args":{"fakeid":"MzA1MjM1ODk2MA==","count":10}}
```

- **One request at a time, a page at a time, no loops over names or pages.** WeChat rate-limits the user's back end (`ret=200013`, per account, can last days and a new scan does not lift it) and can ban an account for heavy use.
- `begin` / `count` count publish batches; one batch can hold several articles. Continue with `nextBegin`, not with the number of articles. Read a body with `read.fetch` (a verification page then means: say so, do not retry).
- Failures and their notices: `wechat.login-expired` (action: the user scans the QR code again on the service's admin page, about every 4 days), `wechat.rate-limited` (stop, wait), `wechat.account-risk` (the first use says what the account risks). "服务器内部错误" from `wechat.articles` usually means the service is not logged in: `wechat.status` with `probe: true`. An unreachable service: the user has to start it.

## Notices

A result may contain `notices` (rendered as "提醒用户 / Tell the user"): each is `{level, code, message}`. Pass them on in your answer, in the user's language; an `action` notice needs the user to do something and must be said plainly. By default each code is shown once per session (`wechat.notices`: `once`, `always`, `off`), so a notice that is absent now was already shown.
