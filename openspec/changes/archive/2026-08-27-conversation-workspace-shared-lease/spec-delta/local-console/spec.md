## Requirement: 会话工作区支持共享绑定与受控切换
Source: docs/product/pages/main-conversation.md#选择工作空间与团队

local-console MUST maintain the selected session's current workspace binding as a persisted project-root or same-project existing worktree identity. A worktree MUST be allowed to have bindings from multiple sessions at the same time; switching MUST NOT reject a target solely because another session references it and MUST NOT transfer or revoke another session's binding.

After the first message, a session MUST be able to switch its binding through the controlled workspace action. An active provider run MUST keep the workspace context captured at run creation; a later run MUST resolve the new binding. A failed switch MUST preserve the previous binding and session history.

When a session leaves a temporary worktree, local-console MUST request Trash only when no other session references the worktree and no provider or managed process is active in it. It MUST preserve project roots, non-temporary targets, shared targets, and busy targets, and MUST return a structured reason when cleanup is not performed.

### Scenario: 已开始的会话切换到已有 worktree

- **GIVEN** a session has messages and a same-project worktree exists for branch `feature/example`
- **WHEN** the session invokes the controlled workspace switch for that branch
- **THEN** the session binding changes to that worktree and a workspace revision increases
- **AND** the next provider run uses that worktree

### Scenario: 目标 worktree 被其他会话共享

- **GIVEN** another session already references the target worktree
- **WHEN** the current session switches to that worktree
- **THEN** the switch succeeds without revoking the other session's binding

### Scenario: 活动 run 不被迁移

- **GIVEN** a provider run is active in worktree A
- **WHEN** its session switches to worktree B
- **THEN** the active run continues with worktree A
- **AND** a later run resolves worktree B

### Scenario: 共享临时 worktree 不被误清理

- **GIVEN** a temporary worktree is still referenced by another session
- **WHEN** the current session leaves it
- **THEN** local-console does not call Trash and returns the shared-reference reason

## Requirement: Workspace MCP action is bounded to the current session
Source: docs/product/pages/main-conversation.md#选择工作空间与团队

The managed MCP bridge MUST expose a typed workspace switch action for the current invocation capability. The action MUST accept only `project-root` or an existing same-project Git branch target, MUST NOT accept an absolute path, shell command, script, or caller-provided session id, and MUST resolve the target through bounded local Git operations.

The action MUST reject missing, ambiguous, unreadable, outside-project, or non-existing worktree targets without changing the current binding. It MUST NOT create, delete, fetch, merge, rebase, or switch Git branches as a side effect of resolution.

### Scenario: 任意路径和脚本被拒绝

- **GIVEN** an invocation submits an absolute path or shell-like script instead of a typed target
- **WHEN** local-console validates the workspace action
- **THEN** it rejects the request before filesystem mutation
- **AND** the session binding remains unchanged

## Requirement: Workspace revision drives current state and file queries
Source: docs/product/pages/main-conversation.md#上下文

The state projection MUST return the actual branch and workspace identity of the session's current binding. A successful binding switch MUST invalidate branch/workspace caches and advance a visible workspace revision. State and read-only file queries MUST resolve the current binding, and MUST NOT reuse a response from an older workspace revision.

### Scenario: 条件刷新看到新分支

- **GIVEN** a client holds a state snapshot from branch `main`
- **WHEN** the session switches successfully to an existing worktree on `feature/example`
- **THEN** the next conditional state request returns a changed full snapshot with `feature/example`
- **AND** the response is not `304 Not Modified` for the old revision

### Scenario: 文件查询跟随新绑定

- **GIVEN** a project-files request for worktree A is in flight
- **WHEN** the session binding changes to worktree B
- **THEN** subsequent project-files and diff queries resolve worktree B
- **AND** a late response for A MUST NOT replace B's visible content
