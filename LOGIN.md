# 中文社区平台登录态（复用你已登录的浏览器）

知乎 / 微博 / 豆瓣 / 贴吧 / 抖音 / 快手 / 小红书的搜索页都有反爬与登录墙，
免登录的公开接口基本都被风控。所以这些平台走 **Playwright 驱动登录态浏览器** 的路径：
在你已登录的浏览器里打开搜索页、读渲染结果——不需要逆向任何签名。

## 方式一：登录一次保存登录态（推荐）

运行插件包里的脚本，按提示逐个平台登录一次（扫码/账号密码），
脚本会把所有 cookies 合并保存成一个 storageState JSON：

```bash
cd dsh-web-search-pro
node scripts/save-login.mjs all login-state.json
# 或只登录一个平台：
node scripts/save-login.mjs zhihu login-state.json
```

然后把文件路径填到 `$DSH_HOME/settings.yaml`：

```yaml
web-search-pro:
  playwright:
    storageStatePath: 'login-state.json'   # 绝对路径更稳
```

> storageState 是 Playwright 的标准登录态文件（cookies + origins），
> 同一份文件可同时含多个站点的登录态（脚本会依次登录并合并）。

## 方式二：用 Cookie 插件导出

如果你更习惯手动导出：

1. 在浏览器装 Cookie-Editor（或 EditThisCookie）。
2. 在目标站点导出 cookies（JSON）。
3. 组装成 storageState 格式：

```json
{ "cookies": [ ...导出的 cookies... ], "origins": [] }
```

每个 cookie 至少需要 `name` `value` `domain` `path`（可补 `expires` `httpOnly` `secure`）。

## 结果选择器可配置

站点改版后如果提取不到结果，不用改代码——在 `settings.yaml` 按平台覆盖选择器：

```yaml
web-search-pro:
  platformRules:
    zhihu:
      item: '.SearchResult-Card'
      title: '.ContentItem-title'
      link: '.ContentItem-title a'
      text: '.Highlight'
    weibo:
      item: '.card-wrap'
      title: '.txt'
      link: '.from a'
```

## 安全与合规提醒

- 仅做**单次、低频**的搜索调用，不要批量爬取；遵守目标平台的服务条款与 robots.txt。
- 登录态文件包含你的登录凭据，请勿提交到公开仓库或分享给他人。
- 本能力借鉴 MediaCrawler 的思路（登录态浏览器驱动搜索页），
  但为 MIT 许可的独立实现，未使用其 NON-COMMERCIAL 许可下的签名算法代码。
