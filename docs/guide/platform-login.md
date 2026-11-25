# 平台登录态

> 适用版本：dsh-web-search-pro 0.2.4 · [返回 README](../../README.md) · [文档索引](../README.md)

本文由原仓库根目录的 `LOGIN.md` 整理而来（`LOGIN.md` 已移到这里），并按当前行为核对过：

- **登录完全由你自己完成。** 插件没有登录窗口，不运行任何登录命令，不读浏览器 Cookie，也不代你输入账号密码。
- 需要登录的平台**优先走 opencli**，顺序是 `opencli → <独立 CLI> → 浏览器后备`：用你日常 Chrome 里已有的登录态，插件不保存也不接触它。
- 微博 / 贴吧 / 抖音也是 `opencli → 搜索页`；豆瓣 / 快手只有搜索页（豆瓣的 `opencli douban search` 只搜电影、图书、音乐，所以不放进它的链）。搜索页这条路需要在 dsh-browser 里声明 AuthProfile（登录态文件由你自己准备）。

## 哪个平台走哪条路

默认后端链来自 `src/cli/chains-spec.ts`，可用 `platformBackends` 改（见 [CLI 适配](./cli-adapters.md#默认后端链)）。`sources.status` 的每个平台带 `chain`，写明每条后端的顺序、状态和被跳过的原因。

| 平台 | 默认后端链 | 登录怎么办 |
|---|---|---|
| 小红书 `xiaohongshu`、Reddit `reddit`、X `twitter` | `opencli` → `xhs` / `rdt` / `twitter` → `browser-opencli` | 在日常 Chrome 里登录站点；装 OpenCLI 与 Browser Bridge 扩展。见下节 |
| 知乎 `zhihu` | `opencli` → `zhihu` → `browser-search` | 同上；最后一条后备是 dsh-browser 的搜索页，需要 AuthProfile（见下下节） |
| Instagram `instagram`、Facebook `facebook` | `browser-opencli` | 通过 dsh-browser 的 OpenCLI 用同一个 Chrome 会话；不读取或导出 Cookie |
| 微博 `weibo`、贴吧 `tieba`、抖音 `douyin` | `opencli` → `browser-search` | 同小红书：日常 Chrome 里登录即可；后备的搜索页需要 AuthProfile（见下下节）。这三个站点的 opencli 映射来自源码里的输出列，**没有对真实站点跑过** |
| 豆瓣 `douban`、快手 `kuaishou` | `browser-search` | 免登录的公开接口基本都被风控；在 dsh-browser 里声明 AuthProfile，再用 `browserBindings` 绑定。douban 不走 opencli：它的搜索只覆盖电影 / 图书 / 音乐 |
| B站、YouTube、GitHub、微信公众号、RSS 等 | 独立 CLI / REST | 不需要登录（GitHub 的 Token 只提升限额，B站 / YouTube 用本机 CLI） |

平台不可用（缺浏览器 / 登录 / CLI / Token）时 `search.run platform=…` 返回 `CAPABILITY_UNAVAILABLE`，写明缺什么；平台已运行但没有结果时返回空列表和平台自己的提示（多半是缺登录），不冷却。

## opencli 优先路线（小红书 / 知乎 / Reddit / X / 微博 / 贴吧 / 抖音）

1. 在你**日常使用的 Chrome** 里登录这些站点。
2. 安装 OpenCLI 和它的 Browser Bridge 扩展：

   ```bash
   npm i -g @jackwener/opencli@1.8.8
   opencli doctor   # 全部 OK 即连通
   ```

   适配核对过的版本是 1.8.x（1.8.0 起、2.0.0 以下）。装了 2.x 会被报告为 `incompatible`，原因里写着找到的版本和上面这条安装命令，链顺势用下一条后端；插件不去适配 2.x。

3. 就这样。插件优先用 PATH 上的独立 `opencli`；PATH 里没有时（桌面版宿主的 PATH 常常很短）再找常见的全局安装位置，见 [CLI 适配](./cli-adapters.md#找不到-opencli-时)。它直接使用那个 Chrome 的登录态；登录态过期时提示“在你的 Chrome 里登录 <站点> 后重试”。

要点：

- 调用时插件给站点命令带上 `--window background --site-session ephemeral --keep-tab false`（后台窗口、不抢焦点、用完关标签页），只对 `opencli <site> search --help` 里列出这三个参数的命令传。
- 如果 `doctor` 显示 daemon 正常但 extension disconnected，请显式启动装有 OpenCLI Browser Bridge 的 Chrome；不要拿 Quark 或禁用扩展的 Playwright 临时 profile 当替代。
- 只有只读的 `search` 命令会被运行；发帖、点赞、关注等被适配规格本身拒绝（见 [CLI 适配](./cli-adapters.md#只读保证与探测)）。
- 独立 CLI（`xhs`、`rdt`、`zhihu`、`twitter`）只是**可选后备**：想用就按它们自己的方式登录（`xhs login` 等，仍由你自己运行），插件只检查登录文件是否存在，没有就跳过。Twitter 的两个 Cookie 值通过 DSH Credentials 或宿主进程环境变量提供，详见 [CLI 适配](./cli-adapters.md#登录类平台怎么用)。
- 浏览器侧的 OpenCLI 用法（`opencli.status` / `opencli.catalog` / `opencli.run`）见 [浏览器脚本与自动化分层](./browser-scripts.md#opencli)。

## 搜索页平台：AuthProfile 与 browserBindings

适用于微博 / 豆瓣 / 贴吧 / 抖音 / 快手，以及知乎的最后一条后备。思路：在你已登录的浏览器会话里打开搜索页、读渲染结果，不逆向任何签名。登录态文件（Playwright `storageState` JSON）由你自己准备。

### 准备登录态文件

方式一：用随包的辅助脚本（可选，由你在终端里自己运行；它不是插件的一部分，也不是 DSH 里的登录窗口）。脚本会打开一个可见浏览器，你在窗口里自己登录（扫码或账号密码）后回终端按回车，脚本把登录态保存成 storageState JSON：

```bash
cd dsh-web-search-pro
node scripts/save-login.mjs all
# 或只登录一个平台：
node scripts/save-login.mjs zhihu
```

- **默认输出**是 `<DSH_HOME 或 ~/.dsh>/data/browser/auth/login-state.json`，也就是 dsh-browser 的 auth 目录（目录权限 0700、文件 0600），脚本结束时打印这个绝对路径，AuthProfile 的 `storageStatePath` 就填它。第二个参数给出路径时以它为准。
- 输出位置在 **git 工作区**里时脚本拒绝写入并说明原因（登录态等于账号权限，不能进仓库）；确实要写，加 `--force`。
- 目标文件已存在时是**合并**而不是覆盖：只替换这次登录的站点的 cookie / origin，其余站点保留；覆盖前留一份 `login-state.json.bak`（只留最近一份）。
- Playwright 1.51 起会一并导出 IndexedDB（有些站点把登录放在那里）；更老的版本不支持，脚本会在结束时说明。

脚本优先复用 `@anweat/dsh-browser` 自带的 Playwright，默认启动其 bundled Chromium；要显式用已安装的 Chrome，可临时设置 `DSH_BROWSER_CHANNEL=chrome`。

方式二：用 Cookie 插件导出。在浏览器装 Cookie-Editor（或 EditThisCookie），在目标站点导出 cookies（JSON），组装成 storageState 格式：

```json
{ "cookies": [ ...导出的 cookies... ], "origins": [] }
```

每个 cookie 至少需要 `name` `value` `domain` `path`（可补 `expires` `httpOnly` `secure`）。不要把 Cookie JSON 作为模型工具参数传入；保存为本地文件后只在配置中引用路径。

### 声明 AuthProfile 并绑定到平台

在 dsh-browser 的部署配置里创建命名、按域名授权的 AuthProfile，再在本插件的 `browserBindings` 里把平台绑定上去：

```yaml
# cordis.yml 中的 dsh-browser 插件行
- id: browser
  name: '@anweat/dsh-browser'
  config:
    automationMode: standard # read-only | standard | autonomous | unrestricted
    authProfiles:
      china-community:
        storageStatePath: '/Users/you/.dsh/data/browser/auth/login-state.json'
        allowedDomains: [zhihu.com, weibo.com, douban.com, baidu.com, douyin.com, kuaishou.com]
        persistState: false

# $DSH_HOME/settings.yaml
---
web-search-pro:
  browserBindings:
    zhihu: { authProfile: china-community }
    weibo: { authProfile: china-community }
```

- storageState 是 Playwright 的标准登录态文件（cookies + origins），同一份文件可含多个站点登录态，但每个 AuthProfile 必须显式给出 `allowedDomains`；访问其他域名会被拒绝。
- `persistState` 默认 `false`，只有明确开启才会原子回写新的 Cookie / localStorage。
- `search.run` 的 `authProfile` / `rulePack` 参数随 `platform` 传，`browserBindings` 补全你没写的那一个（调用里的优先）。
- 站点改版后取不到结果时，用 `platformRules` 覆盖选择器（见 [自定义平台](./custom-platforms.md#按平台覆盖结果选择器)），或在 dsh-browser 里配 RulePack（见 [浏览器脚本与自动化分层](./browser-scripts.md#受控脚本增强rulepack)）。

## 搜索页的结果状态

dsh-browser 提供 `searchPage` 时，搜索页平台不再只给一个“没取到结果”，而是按页面实际的状态报错，每种状态一句话说明发生了什么和下一步该做什么（错误里 `outcome` 字段是状态；后端链的 `notes` 写成 `playwright-weibo [captcha]: …`）。没有 `searchPage` 的旧版 dsh-browser 仍走 `searchResults`，只给原来那条合并的“需要登录态或选择器”提示。

| 状态 | 含义与下一步 | 错误码 / 可重试 |
|---|---|---|
| `ok` | 取到结果 | — |
| `empty` | 页面明确说没有结果：换关键词；不提登录 | `ENGINE_EMPTY` / 否 |
| `empty_unconfirmed` | 没有结果也没有任何说明（可能是登录，也可能是改版）：先在浏览器里手动打开同一搜索页看一眼 | `ENGINE_EMPTY` / 否 |
| `needs_login` | 平台要求登录。用了 AuthProfile：保存的登录已失效，重新运行 `save-login.mjs`；没有绑定：说明怎么准备（有 opencli 这条腿的平台还会说明 opencli 用日常 Chrome 的登录态） | 有 AuthProfile 或 cookie：`ENGINE_AUTH`（`sources.status` 里凭据显示 `rejected`）；没有：`CLI_NOT_LOGGED_IN` / 都不可重试 |
| `captcha` / `blocked` | 站点风控，不是登录或选择器问题：不要马上重试，先手动过验证或换网络出口 | `ENGINE_ERROR` / 否 |
| `rate_limited` | 被限流：等一会儿 | `ENGINE_RATE_LIMIT` / 是 |
| `site_error` / `network` | 站点 5xx / 打不开：稍后重试 | `ENGINE_ERROR` / 是 |
| `timeout` | 搜索页超时：稍后重试 | `ENGINE_TIMEOUT` / 是 |
| `contract_drift` | 页面上有结果列表，但选择器一个也没匹配：改 `platformRules.<平台>`（自定义平台改 `customPlatforms.<平台>` 的 item / title / link） | `ENGINE_ERROR` / 否 |

不可重试的状态不会触发冷却；一条后端的验证码也不会让整个平台冷却，链上的 opencli 仍可回答。`sources.status` 把最近一次的错误原样显示为 `lastError`，所以“绑定的 AuthProfile 登录已失效”会直接出现在那里。

## 安全与合规提醒

- 仅做**单次、低频**的搜索调用，不要批量爬取；遵守目标平台的服务条款与 robots.txt。
- 登录态文件包含你的登录凭据，请勿提交到公开仓库或分享给他人。
- 这条思路（登录态浏览器驱动搜索页）借鉴 MediaCrawler，但本插件是 MIT 许可的独立实现，未使用其 NON-COMMERCIAL 许可下的签名算法代码。
