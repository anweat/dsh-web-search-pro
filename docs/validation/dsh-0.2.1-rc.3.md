# 验证记录：dsh-web-search-pro 0.2.2 × DSH 0.2.1-rc.3

日期：2026-10-26。范围：宿主 `0.2.1-rc.3`（同时保留 `0.2.1-rc.2` 的支持）。验证由适配者本人执行，不是独立验证；完整证据在仓库外的验收环境里保留。

## 仓库门禁

- `pnpm verify`：typecheck、`test:peers`、构建、790 项测试、客户端 bundle 检查全部通过；重建的 `lib/` 与已提交内容一致。
- bench：类型检查通过，94 项测试通过。
- `test:peers`：`0.2.1-rc.2`、`0.2.1-rc.3` 在 runtime / install 两种解析模式下通过；`0.1.7-rc.2`、`0.2.0-rc.1`、`0.2.0-rc.2`、`0.2.2-alpha.1` 被拒绝；`--selftest` 16 条已知行为通过。
- rc.2 → rc.3 的宿主改动（导航入口自定义、菜单图标、analytics、API-key 路线跟随官方 /models）没有改变插件使用的 API；除 `@deepseek-ai/dsh-*` 自身版本外，第三方依赖版本不变。插件源码与 `lib/` 无改动，仅升级 devDependencies、`minimumReleaseAgeExclude` 与 peer 矩阵。

## 真实宿主（隔离 DSH_HOME，headless profile）

- `dsh --version` = `0.2.1-rc.3`。`dsh plugin add` 打包后的 `dsh-web-search-pro-0.2.2.tgz`：闸门接受（exit 0），`--dump-config` 组合正常，无 incompatible / ERESOLVE / 加载错误。
- 一次真实 headless 会话（`deepseek-flash`，reasoningEffort low）：`web_index` → `web_call search.run`（返回 3 条结果，引擎 ddg）→ `web_call read.fetch https://example.com/`（`Title: Example Domain`，来源 jina），三次调用均 completed。
- 与 `@anweat/dsh-browser@0.2.2` 同装：闸门接受，组合正常；`web_index` 的 read 组出现 `snapshot`，`browser_call runtime.status` 返回 `ok:true`（未打开页面）。
- 负对照：npm 上的 `dsh-web-search-pro@0.2.1`（peer `>=0.2.0-rc.2 <0.2.1-0`）被同一宿主拒绝：`incompatible with dsh 0.2.1-rc.3`。
- 联网测试配置需要 `allowProxyFakeIp: true`（Clash/TUN fake-IP 环境）；DeepSeek key 需导出为环境变量 `DEEPSEEK_API_KEY`；装 Browser 需要 profile 的 `pnpm-workspace.yaml` 里决定 `allowBuilds: '@jackwener/opencli'`。

## 未验证

- Browser 的端到端页面渲染（本机缺少 Playwright 固定版本的 Chromium，未下载）。
- rc.3 桌面 / web UI 中插件设置面板与新导航入口 slot 下的渲染（只验证了 headless 路径与客户端 bundle 检查）。
- twitter（#38）仍是 contract-only，没有用登录态真实搜索。
