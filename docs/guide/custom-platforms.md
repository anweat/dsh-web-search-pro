# 自定义平台

> 适用版本：dsh-web-search-pro 0.2.3 · [返回 README](../../README.md) · [文档索引](../README.md)

## 定义自定义平台

在 settings.yaml 里定义任意站点（URL 模板 + 结果选择器），
`search.run` 传 `platform` 就能直接搜它——不需要改代码：

    web-search-pro:
      customPlatforms:
        mybili:
          name: '我的B站'
          url: 'https://search.bilibili.com/all?keyword={query}'
          item: '.bili-video-card'
          title: '.bili-video-card__info--tit'
          link: 'a'
        # 需要登录时优先通过 browserBindings 绑定命名 authProfile。
        myforum:
          name: '某论坛'
          url: 'https://forum.example.com/search?q={query}'
          item: '.thread'
          title: '.thread-title a'
          link: '.thread-title a'
      browserBindings:
        myforum:
          authProfile: forum

旧版 `customPlatforms.*.cookie` 仍兼容，但会让 Cookie 明文进入配置；新配置应使用 dsh-browser 的命名 AuthProfile，状态文件不要提交到仓库。

自定义平台随设置热更新：新增、修改、删除都会同步注册表；与已有 provider 同名的键不会覆盖内置来源，`sources.status` 的 `notes` 会列出被拒绝的键。登录态的准备方式见 [平台登录态](./platform-login.md#搜索页平台authprofile-与-browserbindings)。

## 按平台覆盖结果选择器

站点改版后如果提取不到结果，不用改代码——在 `settings.yaml` 按平台覆盖选择器（设置面板“运行时与后端”分组里也有对应的 JSON 编辑器）：

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

需要等待、点击、滚动才能出结果的页面，改用 dsh-browser 的有界 RulePack（见 [浏览器脚本与自动化分层](./browser-scripts.md#受控脚本增强rulepack)）。
