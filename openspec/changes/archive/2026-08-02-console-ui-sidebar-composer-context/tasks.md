# 任务：console-ui-sidebar-composer-context

- [x] 读取 `conversation-console` 的 design、wireframes、ui-design 与 `accept-card.tsx` 活参考。
- [x] 在 issue 时间线采访并由需求侧确认三项实现边界，保留三条原始验收语句。
- [x] 落盘 proposal、design、tasks 与 `console-ui` spec delta，保持 `spec-delta/` 事实文件和 `specs/` CLI 兼容镜像一致，并完成方案自审。
- [x] 新增 `ConversationSidebar`、测试与 Story：目录名、稳定四档排序、选中态、已完成默认折叠与展开。
- [x] 新增 `RoleComposer`、测试与 Story：七角色面板、鼠标 / 键盘选择、合法句柄插入、第二个角色插入阻止。
- [x] 新增 `ConversationEmptyState`、测试与 Story：邀请文案、角色 composer、单个实心主操作。
- [x] 新增 `SessionContextHeader`、测试与 Story：父会话面包屑、任务状态、进展摘要及非目标能力缺失。
- [x] 视觉走查四组 Story：方角细边、紧凑布局、扁平按钮、仅补全面板使用阴影、深浅模式无裸色值。
- [x] 运行 `pnpm --filter @moebius/console-ui test`、`typecheck`、`build-storybook` 与根级 `pnpm typecheck`。
- [x] 按三条已确认验收语句逐条留存实现证据，并确认没有修改 `operator-console.tsx` 或 `src/index.ts`。
- [x] 实现收尾时比较 `spec-delta/console-ui/spec.md` 与 `specs/console-ui/spec.md`，确认兼容镜像未分叉。
