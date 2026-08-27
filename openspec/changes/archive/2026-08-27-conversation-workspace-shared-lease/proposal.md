# 提案：conversation-workspace-shared-lease

## 需求基线

| 文件 | 小节 | 变更 | 状态 |
| --- | --- | --- | --- |
| `docs/product/pages/main-conversation.md` | `#上下文`、`#选择工作空间与团队` | 已开始的对话允许通过自然语言触发受控 workspace 切换；对话与 worktree 使用共享 lease；分支显示跟随当前绑定 | 已写入 |
| `docs/product/pages/main-right-sidebar.md` | `#改动标签`、`#项目文件标签` | 文件树和改动标签跟随当前 workspace binding；共享 worktree 下不作改动归因 | 已写入 |

本次 PRD 变更记录：用户在开发设计对话中确认“对话和 worktree 非独占”，选择 C 共享 lease；未改变项目选择、工作区范围和用户可见安全边界。

## 背景

当前对话在发出首条消息后锁定 workspace，无法通过自然语言切换到另一个已有分支对应的 worktree；状态缓存和右侧文件浏览器也不会因为 workspace 事实改变而刷新。用户需要在同一对话中继续另一分支的工作，并让分支和文件浏览器实时反映新的工作区。

## 提案

增加持久化的 session workspace binding 与共享引用模型，通过现有托管进程 MCP bridge 提供受控的 workspace 切换 action。切换只接受同一项目的项目文件夹或已有 worktree，不接受任意绝对路径或脚本；活动 provider run 保持原工作区，后续 run 使用新绑定。状态 revision 驱动上下文、分支和右侧文件标签刷新；临时 worktree 在零共享引用且空闲时移动到系统 Trash。

## 影响

- `src/local-console`：workspace binding、Git 解析、切换运行时、状态 revision、持久化兼容和 Trash port。
- MCP bridge 与 provider wiring：增加 session-scoped workspace control tool，保持既有托管进程能力边界。
- `packages/console-ui` 与 `desktop`：上下文状态、文件树刷新和 Desktop Trash 接线。
- `openspec/specs/local-console`、`openspec/specs/console-ui`：实现并验证后回流行为事实。
- 不新增外部依赖、不提供任意 shell 执行、不自动创建不存在的 worktree、不改变 GitHub 状态。
