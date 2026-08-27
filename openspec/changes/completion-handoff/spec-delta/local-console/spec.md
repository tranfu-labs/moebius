# local-console spec delta：completion-handoff

## Requirement: 主 Agent 可显式发起完成交接

Source: docs/product/pages/main-conversation.md#完成交接表单

local runtime MUST make the completion-handoff guidance available to local Agent executions. Claude Code and Codex MUST receive the Skill through provider-standard user Skill directories, so the provider can apply metadata-first discovery and full-body-on-selection progressive disclosure. Their prompt MUST carry only the native Skill boundary and safety fallback, not a duplicate full Skill body. Kimi and Pi remain on the existing prompt fallback and their native Skill projection is TODO. The guidance MUST require an explicit closeout decision by the main Agent and actual evidence before preparing a handoff; it MUST NOT infer program state from words such as “验收”“通过” or “完成”.

### Scenario: full and resume prompt expose the handoff boundary

- GIVEN a local Agent full run or resume run is being prepared
- WHEN the runtime builds the provider prompt
- THEN the prompt includes completion-handoff guidance and the managed-process contract
- AND the guidance requires the runtime's already exposed form capability when a user decision is needed, without naming or inventing an external tool
- AND it does not authorize automatic merge, push, worktree removal, Trash moves or release
- AND Claude Code/Codex load the full Skill body through their standard progressive-disclosure path
- AND Kimi/Pi use the prompt fallback until their native projection is implemented

## Requirement: 表单能力只承载用户选择

Source: docs/product/pages/main-conversation.md#完成交接表单

The Skill MUST collect current session, worktree, changed-file, command and link facts with read-only operations before presenting a form. When a local or remote `dev` target is actually observed it MUST be preferred; otherwise an actually observed `origin/main` may be presented as the fallback. Missing or unverified facts MUST remain unavailable or `未验证`; the Skill MUST NOT invent them or mutate the repository, session history or files.

### Scenario: dev branch is preferred

- GIVEN the current workspace exposes `dev` or `origin/dev`
- WHEN the Skill prepares the Git choice
- THEN the form guidance names that dev target as the preferred merge target
- AND the guidance does not claim that a merge has occurred

### Scenario: no dev branch falls back to main

- GIVEN no local or remote dev target is available
- WHEN the Skill prepares the Git choice
- THEN the form guidance names `origin/main` only when that remote target is available
- AND an unavailable target is reported as a fact rather than invented

### Scenario: inspect failure is visible

- GIVEN the workspace is not readable, is not a repository, or an evidence command cannot be verified
- WHEN the Skill prepares the form
- THEN the affected field is marked unavailable or unverified with a reason
- AND the Skill does not fabricate a successful result

## Requirement: 表单只提交四类用户选择

Source: docs/product/pages/main-conversation.md#完成交接表单

The existing form capability MUST be used to create a user-facing form with at most these four categories: Git branch merge guidance, worktree/file handling guidance, tested links or evidence, and continue editing. All questions that require a user decision MUST be represented by this form rather than an ordinary chat question. This change MUST NOT add or modify an MCP server, tool, schema, bridge, or preflight.

### Scenario: form exposes the bounded choices

- GIVEN a valid closeout snapshot with actual evidence
- WHEN the existing form capability creates a handoff
- THEN the form exposes only the four permitted categories
- AND each category is grounded in the snapshot facts

### Scenario: no evidence blocks a false closeout

- GIVEN the closeout snapshot contains no actual command, tool, run or link evidence
- WHEN an Agent attempts to prepare a completion handoff
- THEN the operation reports that evidence is unavailable or unverified
- AND it does not present the work as successfully completed

## Requirement: v1 完成交接不得执行外发或破坏性动作

Source: docs/product/pages/main-conversation.md#完成交接表单

The completion-handoff Skill and the existing form capability MUST NOT merge, push, remove a worktree mapping, move files to Trash or publish. A user selection from the form MUST be treated as next-step intent and MUST NOT be represented as an already executed action.

### Scenario: user selects a branch or file option

- GIVEN the user selects Git branch guidance or worktree/file handling guidance
- WHEN the selection is returned
- THEN the Agent receives the selected intent and the supporting facts
- AND no merge, push, worktree removal or Trash operation is executed

## Requirement: 交接失败和选择结果回到现有会话流

Source: docs/product/pages/main-conversation.md#完成交接表单

When the existing form capability is unavailable, initialization fails or an operation fails, the Agent MUST report an explicit failure and MUST NOT substitute a fabricated tool call, ordinary chat question or background shell. After a user selection, the Agent MUST return through the existing session message or continue-editing flow and MUST preserve prior success, failure, skipped and unverified evidence.

### Scenario: closeout capability is unavailable

- GIVEN the existing form capability cannot be discovered, initialized or called
- WHEN the Agent attempts to prepare a handoff
- THEN the UI exposes the unavailable reason
- AND no fake JSON tool call or background process is used

### Scenario: user chooses continue editing

- GIVEN the existing form is pending
- WHEN the user chooses continue editing
- THEN the choice is delivered through the existing session continuation path
- AND the prior evidence and failure facts remain available
