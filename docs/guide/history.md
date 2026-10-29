# 历史管理

> 适用版本：dsh-web-search-pro 0.2.3 · [返回 README](../../README.md) · [文档索引](../README.md)

`history.list` 支持 kind/query/engine/platform 过滤（`kind=all` 等同省略 kind），`history.replay` 与 `history.export` 回放与导出 JSON。search/platform 回放保存的来源；fetch/snapshot 回放当次持久化的正文、HTML/截图路径。旧数据库会自动迁移 pages 表；历史上无法关联 queryId 的旧页面按 URL 做兼容回放。

历史类动作的参数与审批见 [工具与动作](./tools-and-actions.md)：`history.delete` 会请用户确认，其余历史动作只读。证据包里的摘录用 `history.expand` 传 `evidenceId` 读回所在块及其前后块（至多 4000 字符）。
