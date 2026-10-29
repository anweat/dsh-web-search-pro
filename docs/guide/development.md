# 开发

> 适用版本：dsh-web-search-pro 0.2.3 · [返回 README](../../README.md) · [文档索引](../README.md)

```bash
pnpm install
pnpm test
pnpm build        # tsc src → lib
```

源码在 `src/`；`lib/` 为发布产物（已提交），改了 `src/` 要重新 `pnpm build` 并一起提交。

## 常用命令

| 命令 | 作用 |
|---|---|
| `pnpm run typecheck` | 类型检查 |
| `pnpm test` | 单元测试（`test/*.test.ts`） |
| `pnpm run test:peers` | 用两种 semver 解析模式逐个断言受管 peer 范围，见 [兼容范围](./compatibility.md#peer-范围的写法) |
| `pnpm run test:client-bundle` | 检查设置面板客户端 bundle 只依赖宿主模块表里的少数模块 |
| `pnpm run check:docs` | 检查 md 里的相对链接与锚点，以及 README 中英文二级标题数量一致 |
| `pnpm run verify` | 上面几项加构建，发布前必跑（`prepublishOnly` 也会跑） |
| `pnpm run bench:*` | 离线评测（`bench/`，不随包发布），用法见 `bench/README.md` |

## 文档与测试的对应

- `test/cli-builtin-specs.test.ts` 要求 [CLI 适配](./cli-adapters.md) 的内置规格表逐行写出每个内置 CLI 的命令名与已验证版本，并要求 skill 的 `references/sources.md` 点名每个规格与每个默认链平台。
- `test/defaults.test.ts` 要求 README 与 README.en.md 把开箱默认值（Jev 默认关闭、博查仅在配了 Key 时使用）写清楚。
- 新增配置项要在 `src/config-groups.ts` 选好分组；启动时只读一次的设置要登记到 `src/restart.ts` 的 `RESTART_FIELDS`（有测试扫描这类读取）。

## 更多开发资料

- [docs/dev/IMPLEMENTATION.md](../dev/IMPLEMENTATION.md)：具体实现（架构、设计决策、排障教训）
- [docs/dev/RESEARCH.md](../dev/RESEARCH.md)：调研记录
- [docs/dev/overlay-design.md](../dev/overlay-design.md)：agent 覆盖层设计
- [docs/validation/](../validation/)：各版本的真实验证记录（原样保留）
