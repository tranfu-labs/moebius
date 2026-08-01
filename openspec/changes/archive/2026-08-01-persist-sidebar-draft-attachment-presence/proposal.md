# 提案：persist-sidebar-draft-attachment-presence

## 需求基线

| 文件 | 小节 | 变更 | 状态 |
| --- | --- | --- | --- |
| `docs/product/pages/main-right-sidebar.md` | `#页面状态`（分析新对话·未发送） | 不改产品意图；沿用未发送分析草稿可跨重启恢复并可关闭 | 无需修改 |
| `docs/product/pages/main-right-sidebar.md` | `#指标与验收`（验收 34） | 落实普通附件触发确认、重启不视为丢弃、确认后不再恢复 | 无需修改 |

R-14 是实现偏离既有产品事实的缺陷修复，不存在产品缺口。本 change 不修改 PRD，不建立 spec delta；实现归档时复核现有 `console-ui` 行为事实是否已完整覆盖。

## 背景

R-02 已让同一 renderer 生命周期内的关闭判定按目标 draft key 查询附件，但重启后附件 keyed record 初始为空，且现有恢复只加载当前活动 key。若草稿 A 只有服务端附件，重启后未激活 A 而直接关闭，页面仍会把 A 判为空草稿并无确认删除标签与本地草稿。

关闭 guard 是同步接口，不能在点击关闭时等待服务端。本次必须让关闭时已有一个与草稿同生命周期、可同步读取的保守附件存在性见证。

## 提案

- 在侧栏草稿持久化文档增加三态附件存在性：`absent`、`unknown`、`present`。新草稿从 `absent` 开始；旧文档缺字段或字段非法时迁移为 `unknown`。
- 关闭纯判定把 `unknown` 与 `present` 都视为需要确认，只允许可信的 `absent` 免确认，以 false positive 换取不再静默丢内容。
- 附件 hook 通过稳定 callback 报告存在性；使用独立的 per-key presence generation 防止迟到 list / upload / clone 覆盖更新结果，不改变现有 `draftRevisionRef` 的整集恢复作废语义。
- 上传或删除开始时先写 `unknown`；上传成功写 `present`；权威 list / clone 成功后按最终集合写 `present` 或 `absent`；失败维持 `unknown`。删除不为消除安全方向误确认而额外发起 list。
- 增加纯 store / 判定单测与 renderer 回归，覆盖重启后未激活关闭、旧文档收敛、慢返回、失败、父级重渲染和 callback identity 变化。
- 验证后同步状态组合审计，将 R-02 与 R-14 的未覆盖子集写实，并保留 R-15 服务端资源清理为独立条目。

## 影响

- `desktop/src/console-page/sidebar-conversation-drafts.ts`：持久化保守见证、旧文档迁移、按 attachment key 更新。
- `desktop/src/console-page/use-managed-attachments.ts`：存在性事件与独立 generation；不改服务端 API。
- `desktop/src/console-page/app.tsx`：把附件存在性写回对应草稿，关闭判定读取持久化见证。
- Desktop 单元测试与 renderer 内存回归；不新增真实 I/O 测试。
- `docs/architecture/console-state-composition-audit.md`：R-02/R-14 保护登记。
- 不处理 R-15，不改 `clearDraft` 的服务端资源生命周期，不重构 `app.tsx`，不改 `packages/console-ui`、IPC、SQLite 或 JSONL。
