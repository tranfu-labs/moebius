# 提案：workspace-preference-direct-selection

## 需求基线

| 文件 | 小节 | 变更 | 状态 |
| --- | --- | --- | --- |
| `docs/product/pages/main-conversation.md` | `选择独立工作空间的说明` | 移除独立工作空间确认弹窗，改为菜单项内说明并直接选择 | 已写入 |
| `docs/product/pages/main-conversation.md` | `上下文` / `选择工作空间与团队` | 增加项目级新对话默认偏好；显式选择立即保存，已有会话不变 | 已写入 |
| `docs/product/pages/main-conversation.md` | `验收标准` #7 | 明确项目偏好按项目隔离且不改写已有会话 | 已写入 |

## 背景

新建会话中的独立工作空间选择当前需要额外确认弹窗，打断了本来已经明确的菜单选择。与此同时，新会话入口把工作空间作为单一默认值处理，不能记住不同项目的工作方式偏好。

现有项目模型已经持久化 `worktreeMode`，local-console 已有项目更新接口，并在创建会话时使用项目模式作为默认值；缺口主要位于 UI 交互和 desktop application 的偏好写入接线。

## 提案

1. 移除新对话工作空间确认弹窗，保留菜单内的独立工作空间边界说明；选择动作直接更新当前草稿。
2. 用户在首条消息前显式选择工作空间时，立即将选择写入当前项目的 `worktreeMode`；项目切换读取目标项目自己的偏好，不使用全局默认值。
3. 保持会话级 `workspaceMode` 为实际工作现场；项目偏好变化不修改已有会话，首条消息后继续锁定项目与工作空间。
4. 沿用现有项目 mutation、刷新和错误处理边界，并覆盖主新对话草稿、侧栏新对话草稿及 local-console 持久化行为。

## 影响

- `packages/console-ui`：新对话工作空间菜单移除确认状态和弹窗，更新交互测试。
- `desktop`：增加项目工作空间偏好 mutation，接入主/侧栏新对话草稿，并保持按项目默认解析。
- `src/local-console`：复用现有 `projects.worktree_mode`、项目 PATCH 和会话默认逻辑，不新增数据格式。
- `openspec/specs`：本 change 通过 `spec-delta/` 暂存行为变更，归档时回流事实规格。
- 验收：真实 Electron 必须从用户入口验证直接选择、项目间偏好隔离、重启持久化和已有会话不受影响。
