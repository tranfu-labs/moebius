# 提案：fix-inactive-analysis-draft-close-confirmation

## 需求基线

| 文件 | 小节 | 变更 | 状态 |
| --- | --- | --- | --- |
| `docs/product/pages/main-right-sidebar.md` | `#标签条` | 不改产品意图；沿用“分析入口产生的未发送草稿”属于右侧栏未发送草稿标签的定义 | 无需修改 |
| `docs/product/pages/main-right-sidebar.md` | `#关闭标签` | 不改产品意图；落实按被关闭标签最终草稿中的正文、文本胶囊与普通附件裁决是否确认 | 无需修改 |
| `docs/product/pages/main-right-sidebar.md` | `#分析对话标签与跨树路由` | 保持已创建分析对话只关闭视图的既有边界，不把丢弃草稿规则扩展到已创建会话 | 无需修改 |
| `docs/product/pages/main-right-sidebar.md` | `#页面状态`（分析新对话·未发送） | 沿用该状态可关闭标签并进入草稿丢弃裁决的产品定义 | 无需修改 |
| `docs/product/pages/main-right-sidebar.md` | `#指标与验收`（验收 34） | 落实普通附件触发确认、取消后内容和焦点不变的编号验收 | 无需修改 |

PRD 覆盖本次分析草稿 tab，不存在待采访缺口：`#标签条` 明确称其为“分析入口产生的未发送草稿”，`#页面状态` 又单列“分析新对话·未发送”并允许关闭标签；它在首次发送成功前仍是右侧栏普通新会话生产组合。`#分析对话标签与跨树路由` 中“只关闭视图”的对象是已经创建的分析对话。故 `#关闭标签` 对“尚未发送的新会话标签”按最终草稿裁决的规则适用，且验收 34 明确要求普通附件触发确认、取消后内容和焦点不变。

本次是实现偏离既有产品事实的缺陷修复，不增加产品规则。`openspec/specs/console-ui/spec.md` 已规定分析入口复用右侧栏普通新对话生产组合与普通附件，并在“零标签关闭右侧栏”Requirement 中承认草稿丢弃裁决；不修改 PRD 或写 spec delta。实现并验证后仍按归档流程复核这些事实源。

## 背景

状态组合审计 R-02 已确认：关闭右侧栏分析草稿时，页面能按被关闭 draft id 读取正文与文本胶囊（代码字段 `textFragments`），却只能看到当前活动 draft key 的附件。关闭非当前草稿 A 时，附件判断被当前活动 draft B 的身份条件短路；若 A 只有附件，就跳过确认并删除草稿与附件现场。

附件 hook 内部已经按 draft key 保存全量附件记录，清理能力也接受任意 draft key。缺陷不是数据缺失，而是公开面只投影当前 key，导致页面不能按关闭目标查询。确认判定同时埋在 `app.tsx` 回调中，无法脱离 React / Electron 建立行为护栏。

## 提案

- 在 `sidebar-conversation-drafts.ts` 收敛一个纯关闭判定函数：输入目标草稿和“目标附件 key 是否存在附件”，输出是否必须询问丢弃；函数不依赖 React、Electron、网络、SQLite、JSONL 或 storage。
- 为 `useManagedAttachmentDrafts` 增加按任意 draft key 查询是否存在附件的窄公开面；它只读取 hook 已有的 keyed record，不复制状态、不暴露整张 mutable record。
- `app.tsx` 关闭回调按被关闭草稿的 `attachmentDraftKey` 查询，并把结果交给纯函数；取消确认时在任何 remove / clear 之前返回，保留标签、草稿、附件、当前选中态与焦点。
- 增加纯逻辑单测和既有 App 内存 harness 的 renderer 回归，覆盖非当前草稿、父级重渲染、回调身份变化以及附件慢返回 / 失败状态，不新增真实 I/O 测试。
- 实现验证后同步 `docs/architecture/console-state-composition-audit.md`：把 R-02 标为“已确认缺陷（部分消解）”，登记纯判定与 keyed 查询实际覆盖的同会话子集；把重启后未激活草稿的残余风险与服务端附件清理缺口分别登记为 R-14、R-15，不把局部保护误写成完整消解。

## 影响

- `desktop/src/console-page/sidebar-conversation-drafts.ts`：新增纯关闭判定，不改变草稿持久化格式。
- `desktop/src/console-page/use-managed-attachments.ts`：新增按 key 的只读 boolean 查询，不改变上传、恢复、清理或服务端 API。
- `desktop/src/console-page/app.tsx`：只替换 R-02 关闭判定接线，不重构页面，不处理 R-08 或迟到提交族。
- `desktop/tests/sidebar-conversation-drafts.test.ts` 与 `desktop/tests/console-app-sidebar-conversation-regressions.test.tsx`：增加纯规则与 renderer 接缝回归；复用内存 storage / fetch 替身。
- `docs/architecture/console-state-composition-audit.md`：R-02 部分消解登记，以及复核发现的 R-14/R-15 独立候选。
- 不修改 `packages/console-ui`、IPC、local-console API、SQLite、JSONL、PRD、spec、ADR 或 module-map。
