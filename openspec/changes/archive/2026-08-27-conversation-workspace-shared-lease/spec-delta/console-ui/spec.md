## Requirement: 已开始会话显示当前 workspace binding
Source: docs/product/pages/main-conversation.md#上下文

The conversation context row MUST keep the order project, workspace, branch, team. After a conversation has messages, project MUST remain non-editable; workspace MUST display the current binding without a permanent picker; branch MUST display the actual branch value returned by local-console and remain non-editable. A successful controlled workspace switch MUST update workspace and branch without requiring a new conversation.

### Scenario: 切换后上下文条更新

- **GIVEN** an existing conversation currently displays worktree A and branch `main`
- **WHEN** its controlled workspace switch to worktree B succeeds
- **THEN** the context row displays worktree B and B's actual branch
- **AND** project and team semantics remain unchanged

## Requirement: Project files follow workspace revision
Source: docs/product/pages/main-right-sidebar.md#项目文件标签

The project-files tab MUST reload its tree, selected file, and content snapshot when the current session workspace identity or revision changes. A stale request from the previous workspace MUST NOT overwrite the current workspace view. The diff tab MUST also resolve the current workspace binding and MUST describe changes without attributing them to a conversation or Agent when the worktree is shared.

### Scenario: 右侧文件浏览器跟随切换

- **GIVEN** the project-files tab is open on worktree A
- **WHEN** the session switches to worktree B
- **THEN** the tab clears A's selected file and reloads B's file tree
- **AND** the visible file content belongs to B

### Scenario: 共享 worktree 不显示错误归因

- **GIVEN** multiple sessions reference one worktree with changes from more than one source
- **WHEN** the user opens the diff tab
- **THEN** the tab describes the current workspace relative to the session baseline
- **AND** it does not claim that the current conversation or Agent caused every listed change
