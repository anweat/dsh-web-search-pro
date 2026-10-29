# 安装与首次使用

> 适用版本：dsh-web-search-pro 0.2.3 · [返回 README](../../README.md) · [文档索引](../README.md)

本插件是 DSH 的 bundle 插件。兼容的宿主与 Browser 版本见 [兼容范围](./compatibility.md)，从旧版本升级见 [CHANGELOG](../../CHANGELOG.md#从旧版本升级)。

## 用 DSH CLI 安装

```bash
# 默认安装（面向 dsh-v0.2.0-rc.2 与 dsh-v0.2.1-rc.2 ~ rc.4 宿主；浏览器插件可选，需要读取渲染页 / 浏览器平台时一起装）：
dsh plugin --profile web add @anweat/dsh-browser@0.2.2 dsh-web-search-pro@0.2.3
# 不需要浏览器能力时，只装本插件即可：
dsh plugin --profile web add dsh-web-search-pro@0.2.3
# 重启（web profile 关闭了 HMR）：
dsh --profile web
```

两个插件都必须是 profile 的**直接依赖**：DSH 只激活直接依赖的 bundle layer，且标准 profile 可能设置 `autoInstallPeers: false`。不要只安装 Web Search Pro 后依赖 peer 自动补齐。

## 用 DSH Desktop 安装

DSH Desktop 的 profile 由应用自己管理，CLI 不能操作 `desktop` profile（`dsh plugin --profile desktop …` 会报 `profile "desktop" is managed exclusively by the Electron application`）。请在应用里装：

1. 打开**插件**页，点 **Add plugin**。
2. 填包名，可以带版本，写法同 CLI 里 `dsh plugin add` 后面那段，例如 `dsh-web-search-pro@0.2.3`；要浏览器能力就再装一次 `@anweat/dsh-browser@0.2.2`（以 Desktop 0.2.1-rc.3 的界面为准）。
3. 对话框里可以选 **Registry**，然后点 Install。
4. 装完如果插件没有出现或设置卡片没有加载，重新启动应用。

注意：

- 非官方插件的升级 = 先卸载再重装。
- 国内镜像（如 npmmirror）可能比官方源晚几分钟到几小时同步，装不到新版本时，在 Registry 里换成 `https://registry.npmjs.org`。

## 本地目录或 tarball（开发用）

```bash
dsh plugin --profile web add ../dsh-browser ./dsh-web-search-pro
dsh --profile web
```

若你的 harness 是本地源码 checkout，版本号可能有出入：用 `dsh plugin --profile web add ./<path>`，并在 profile 的 `pnpm-workspace.yaml` 里对齐版本后重装。

## 新用户第一次安装

只装本插件时，`dsh plugin add` 在 pnpm 11 下退出码为 0、没有任何警告（本包没有安装脚本，也不依赖 OpenCLI 或 Playwright；约 20 个包、10 MB）。

要一起装浏览器插件，用 `@anweat/dsh-browser` **0.2.2 起**：它不再把 `@jackwener/opencli` 作为依赖，所以不会再有 `ERR_PNPM_IGNORED_BUILDS`。`0.2.1` 及更早的 Browser 会让 pnpm 11 拦下 OpenCLI 的安装脚本，`dsh plugin add` 以失败退出——**包其实装上了、插件却没有被加入 profile 的 bundles，之后再 `add` 任何包也都会同样失败**，连带的本插件也不会被启用。用 0.2.1 线宿主的用户在这点上没有选择，只能升级到 0.2.2。

## 第一次使用

1. **网页搜索、证据管线、CLI 平台不需要浏览器**，装完即用。先让模型调一次 `web_call` 的 `sources.status`，看各后端是否 ready。
2. **设置卡片**：打开 `设置 → 插件 → 插件配置 → Web Search Pro`。顶部是状态摘要（实际尝试顺序的默认引擎链、已配置 Key 的来源数、DeepSeek 是否就绪、评分模型、待重启项等），详见 [设置面板](./settings-panel.md)。
3. **`read.snapshot`、`read.fetch mode=playwright`、搜索页类平台需要浏览器插件**，且**有 Google Chrome / Microsoft Edge 就直接用**（不用下载 Playwright 的 Chromium）。都没有时 `sources.status` 的 `browser:dsh-browser` 一行会写 `loaded, no browser to launch` 和 dsh-browser 给的可照做的步骤（装 Chrome / Edge，或 `runtime.install`，或终端命令）。
4. **小红书 / 知乎 / Reddit / X** 要用你日常 Chrome 的登录态：`npm i -g @jackwener/opencli` 并装它的 Browser Bridge 扩展（`opencli doctor` 全 OK），本插件优先用 PATH 上的独立 `opencli`；没有它这几个平台会往后落到独立 CLI 或 dsh-browser 的后端，`sources.status` 写明原因。登录由你自己完成，见 [平台登录态](./platform-login.md)。OpenCLI 与浏览器的装法细节见 [dsh-browser 的 README](https://github.com/anweat/dsh-browser#readme)。
5. 有 `DEEPSEEK_API_KEY`（环境变量、DSH 凭据或设置里的密钥字段）时，默认搜索会先用**按请求计费**的 DeepSeek 搜索，见 [来源与引擎](./sources.md#deepseek-搜索--抓取常用)。不想用就在 `sources.disabled` 里写 `deepseek`。

## 排障

- `dsh plugin add` 因 peer 不满足而拒绝，或在组装期点名 `incompatible`：宿主版本不在支持范围，见 [兼容范围](./compatibility.md)。
- 装到 Browser 0.2.0 / 0.2.1 的 0.2.1 线宿主会被安装闸门拒绝，且整次安装作废（`nothing was installed`）；改装 Browser `0.2.2` 起。
- 宿主仍是 DSH 0.1.x 或浏览器插件仍是 `@anweat/dsh-browser` 0.1.x：请停留在 `dsh-web-search-pro@0.1.15`。
- 更新带客户端面板的插件版本后，需要完整停止并重新启动 profile（或应用），让 DSH 客户端模块扫描器重新装载 `client.js`；仅刷新网页不够。
- 最后一招：手改 profile 的 `package.json` 并重新 `pnpm install` 也能装上，但不推荐，优先用上面的 `dsh plugin add` 或 Desktop 的 Add plugin。
