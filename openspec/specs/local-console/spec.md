# local-console 规格

## 域定位

`local-console` 是本地对话操作台的数据通道，也是产品唯一的运行形态。它承载 conversation、mention trigger、agent persona 与本机 CLI provider 驱动能力，输入输出落在本机 HTTP API 与 `.state/local-console.sqlite`，供 Electron 操作台或本地浏览器客户端使用。

本域规定持久化本地项目及其多会话、运行直播、中断、卡住状态、本地错误记录、agent 接力位点、主 Agent 最终控制权、本地专用 prompt、workspace diff 事实、child session orchestration 的本地子会话等价能力，以及 dead-letter / recovery 可见收敛；本地自然语言不产生验收控制事件，既有验收表只作历史只读兼容。

## 业务规则

### 持久化与兼容入口
Source: docs/adr/0004-jsonl-session-fact-log.md#决策

- MUST keep mutable local-console transition state and indexes in the existing `.state/local-console.sqlite`; the sole separate persistent record MUST be the per-session append-only jsonl fact log, which MUST NOT become a second disconnected mutable state store.
- MUST preserve the default local session and the T2 compatibility message endpoint, mapping it to the default local session.
- MUST render local session timelines from session facts restored by the store from per-session jsonl; `session_messages` MUST remain a message index rebuildable from jsonl, and the timeline MUST NOT invent GitHub issue concepts.
- MUST keep at most one primary-agent run and at most one run per specialist role in a session; different roles MAY run concurrently, while a second run for the same role MUST wait for the prior run to settle.
- MUST release the session after Codex success, failure, timeout, or user interruption so later local messages can be processed.

### 桌面操作台数据通道
- MUST expose a local console state API that returns the persisted local project list, the selected project, its sessions, the selected session timeline, global running/waiting/stuck/error counts, all active run snapshots, a primary-only compatibility projection, primary pending messages, and visible local errors.
- MUST support creating and selecting multiple local sessions under any persisted local project; session ids for new local sessions must be stable and persisted in SQLite.
- MUST preserve the project-to-session hierarchy while keeping every session row visually flat within its owning project.
- MUST expose session-scoped message submission and interrupt operations.
- MUST keep the local console API loopback-only by default.

### Requirement: 状态接口支持未改变快照的条件刷新

Source: docs/product/pages/main-conversation.md#指标与验收

local-console state API MUST 支持客户端以当前快照标识发起条件请求。快照未改变时 MUST 返回无状态体的未改变响应；快照发生任何可见状态变化时 MUST 返回完整状态，而不是让客户端沿用旧快照。

#### Scenario: 空闲会话的快照未改变

- **GIVEN** 当前选择的完整状态与上一次响应完全相同
- **WHEN** 桌面刷新通道发送当前快照标识
- **THEN** API 返回未改变响应且响应体为空
- **AND** 客户端保留当前状态，不提交新的时间线状态。

#### Scenario: 活动状态发生变化

- **GIVEN** 同一会话仍在打开且 `elapsedMs`、`liveMarkdown`、活动摘要、失败或终态中任一事实发生变化
- **WHEN** 桌面刷新通道发送旧快照标识
- **THEN** API 返回完整状态
- **AND** 客户端应用变化，不把该响应误判为 unchanged。

### 桌面启动恢复最后一次成功选择

Source: docs/product/pages/main-left-sidebar.md#入口与去向

- 桌面操作台 MUST 记住最后一次成功展示的用户根对话及其所属项目，并在下一次启动时验证两者仍然匹配后恢复。
- 只有成功提交且返回用户根对话的状态响应可以推进该记忆；失败、取消、过期响应、周期轮询的相同选择或子会话右栏展开 MUST NOT 改写它。
- 没有历史选择、历史记录损坏、项目已移除、对话已归档或返回会话不是用户根对话时，桌面操作台 MUST 清除失效记录并进入未选择项目的新建对话。
- 桌面操作台 MUST NOT 把 local-console API 为兼容请求返回的第一个项目、默认会话或相邻会话当作已经验证的历史选择。
- local-console API 的 `local/default` 兼容入口 MUST 继续可用；本规则不得删除或迁移本地项目、会话或消息。

#### Scenario: 重启恢复另一个项目中的根会话

- **GIVEN** 用户最后一次成功打开项目 B 的根会话 B2
- **WHEN** 桌面应用使用同一数据启动
- **THEN** 主内容区恢复项目 B 与会话 B2
- **AND** 项目 A 的默认或最旧会话没有被选中。

#### Scenario: 无历史选择时进入未选择项目的新建对话

- **GIVEN** 桌面应用没有合法的历史选择记录
- **WHEN** 首次可提交状态响应返回 API 兼容选择 `local/default`
- **THEN** 主内容区进入新建对话
- **AND** 项目保持未选择
- **AND** `local/default` 不被写成用户的最后选择。

#### Scenario: 历史选择不可恢复时拒绝静默回退

- **GIVEN** 历史选择指向已移除项目、已归档会话、缺失记录或子会话
- **WHEN** local-console state API 返回另一个兼容会话
- **THEN** 桌面操作台清除历史选择并进入未选择项目的新建对话
- **AND** 不把返回的兼容会话显示为恢复成功。

#### Scenario: 失败或过期响应不污染最后选择

- **GIVEN** 已记住项目 B 的根会话 B2
- **WHEN** 用户选择会话 C1 的请求失败或其响应被更新的 selection mutation 作废
- **THEN** 记忆仍然是项目 B 的根会话 B2
- **AND** 下一次启动不会恢复到未成功展示的 C1。

### Requirement: 新对话草稿跨导航保持同一上下文

Source: docs/product/pages/main-conversation.md#新对话草稿的生命周期

- 没有待恢复的新对话草稿时，桌面操作台 MUST 让从侧边栏顶部进入的新对话保持项目未选定；上一份草稿随 session 与首条消息成功创建而消费后，下一次顶部进入 MUST 重新满足该规则。
- 桌面操作台 MUST 将“当前展示新对话页”与未发送的新对话草稿分开管理；用户切到已有会话或其他页面时 MUST 只隐藏草稿，再次进入「新建对话」时 MUST 恢复仍可用的项目、会话级工作空间、团队、正文与附件。
- 隐藏或恢复新对话草稿 MUST NOT 创建侧边栏会话，MUST NOT 改写正在浏览的已有会话上下文。
- 用户在新对话中明确改选项目时，工作空间 MUST 按目标项目当前缺省模式重新选择；恢复的工作空间 MUST NOT 提升为全局或项目级偏好。
- 只有 session 与首条消息成功创建后，桌面操作台才可消费新对话草稿；创建或提交失败 MUST 保留项目、工作空间、团队、正文与附件以供重试。
- session 与首条消息已经创建后发生的 Agent 启动失败 MUST NOT 恢复已消费的新对话草稿。

#### Scenario: 浏览已有会话后恢复独立工作空间草稿

- **GIVEN** 新对话已选择项目 A、独立工作空间和团队 T，并包含未发送正文与附件
- **WHEN** 用户切到已有会话后重新进入「新建对话」
- **THEN** 项目 A、独立工作空间、团队 T、正文与附件保持不变
- **AND** 导航期间没有创建侧边栏会话，已有会话的工作空间没有被改写。

#### Scenario: 首条消息创建失败不消费草稿

- **GIVEN** 新对话已包含可发送的上下文、正文与附件
- **WHEN** session 与首条消息未能成功创建
- **THEN** 项目、工作空间、团队、正文与附件保持可重试
- **AND** 只有后续一次创建成功才消费该草稿。

#### Scenario: 成功消费后下一次顶部进入恢复空白基线

- **GIVEN** 一份新对话草稿已经成功创建 session 与首条消息
- **WHEN** 用户再次从侧边栏顶部进入「新建对话」
- **THEN** 页面展示一份项目未选定的新草稿
- **AND** 不恢复上一段对话已经消费的项目、工作空间、正文或附件。

#### Scenario: Agent 启动失败不撤销已创建对话

- **GIVEN** session 与首条消息已经成功创建且新对话草稿已经消费
- **WHEN** 随后的主 Agent 启动失败
- **THEN** 失败作为已创建会话的可见运行事实保留
- **AND** 系统不把已消费内容恢复成新对话草稿。

### Session agent team binding
- MUST persist, on each local session, the ownership and id of the agent team chosen when that conversation was created.
- MUST write the binding as part of creating the session, so a created session is never left unbound by a later failing step.
- MUST treat an absent binding as "use the shared agent directory", and MUST keep sessions created before this change working unchanged.
- MUST NOT derive a session's team from any global preference record; the last-used-team record only preselects a team for the next new conversation.
- MUST NOT change a session's binding as a side effect of browsing or editing teams.

#### Scenario: Created session carries its team

- **GIVEN** the user creates a conversation with a chosen team
- **WHEN** the session is persisted
- **THEN** the session records that team's ownership and id
- **AND** reopening the session later reports the same team.

#### Scenario: Sessions created before this change keep working

- **GIVEN** a session persisted before team binding existed
- **WHEN** the user sends a message in it
- **THEN** the run proceeds using the shared agent directory
- **AND** no error is raised for the missing binding.

### Session-scoped agent roster
- MUST resolve the agents available to a run from the session being run, not from a process-wide directory listing.
- MUST use the resolved set both for dispatching a mention to a role and for reporting which roles are available.
- MUST surface an explicit failure when the roster cannot be resolved, and MUST NOT substitute the shared directory for a session whose bound team is unavailable.

#### Scenario: Mention outside the bound team does not silently resolve

- **GIVEN** a session bound to a team that does not include a given role
- **WHEN** a message mentions that role
- **THEN** the run reports that the role is not available to this conversation
- **AND** no agent from the shared directory is used in its place.

### Project 持久化
Source: docs/adr/0004-jsonl-session-fact-log.md#决策

- MUST persist local projects in the existing `.state/local-console.sqlite` database.
- MUST associate local sessions with a persisted project id.
- MUST enforce project reference integrity for local sessions through SQLite foreign keys plus a local-session non-null constraint or an equivalent transactionally enforced strategy.
- MUST reject creating a local session for a missing project without writing a partial session or message.
- MUST migrate pre-existing local sessions into a deterministic default project without losing their messages, role handoff cursor, status, run id, run dir, or errors.
- MUST expose local project summaries with project id, real directory title, folder path, worktree mode, optional worktree unavailable reason, aggregated session counts, and child sessions.
- MUST keep each session jsonl as the durable timeline fact source and `session_messages` as a rebuildable index; project rows only describe workspace source and grouping.
- MUST restore the same local project list after local console server or desktop shell restart when using the same SQLite database.

### 兼容占位项目公开边界
Source: docs/product/pages/main-left-sidebar.md#入口与去向

- 系统 MUST 保留内部 `local/default` 项目、会话、cursor 与兼容消息入口，但当且仅当该项目仍可证明为自动初始化的未使用占位时，MUST 将它从公开项目列表及项目排序输入集合中排除。
- 未使用占位 MUST 同时满足：项目 id/source/title/SQLite 数据根目录/worktree/移除与修复状态仍为自动基线；项目只关联未归档的 `default` 会话且不存在活动或归档的额外会话；该会话的 source、project、title、status、workspace、生效及 pending 团队、归档、注意状态均为自动基线；初始 cursor 存在且 processed 为 0、active message/run 为空。
- `default` 作为父或子的 `sessions.parent_session_id`、作为父或子的 `session_edges`、effective/pending 团队成员快照，以及 `session_messages`、role threads、agent contexts、route decisions、acceptance facts、integration events、dead letters、workspace diffs 任一存在时，系统 MUST 保持该项目公开。
- 对于未移除的活动兼容记录，项目或会话任一用户可控字段偏离自动基线时，系统 MUST 保持该项目公开；项目 workspace 探测缓存、项目/会话/cursor 时间戳、项目 `sort_order` 与未绑定消息的全局附件草稿不得单独使占位公开。
- 过滤 MUST NOT 删除或迁移兼容项目、会话、cursor、关系、团队绑定或历史事实；兼容入口产生第一条历史后，项目与历史 MUST 立即重新可达。
- 当公开项目为空时，local-console 状态 MUST 返回 `projects=[]` 与 `selectedSession=null`；API 可继续携带 `local/default` 兼容 fallback id，桌面选择恢复 MUST 将其解释为“新建对话、项目未选择”，不得记为用户历史选择。

### Local workspace source
- MUST model local project workspace source as a folder path plus a worktree mode boolean.
- MUST resolve local Codex cwd from the session's project workspace source before every Codex run and pass it explicitly to the Codex driver.
- MUST NOT continue using a single runtime-level project root as the cwd for all local sessions once a session belongs to a folder project.
- MUST keep the T2 compatibility default session and default local message endpoints working by mapping them to the default project.
- MUST expose project create/list/update capabilities through the loopback local console API and allow creating a local session under a selected project.
- MUST NOT call `gh` as part of local project creation, workspace source resolution, or local Codex cwd selection.

### Git folder worktree mode
- MUST detect whether a local project folder is inside a git repository using bounded local `git` commands.
- MUST, when the folder is a git repository and worktree mode is enabled, create or reuse a temporary local worktree based on the repository's current `HEAD` and run Codex there.
- MUST derive one deterministic 12-character Git-safe short id from the full project/session identity, use `moebius/<short-id>` for newly created local branches, and place newly created worktrees at `<workdirRoot>/worktrees/<short-id>`.
- MUST probe the legacy `<workdirRoot>/local-worktrees/<safe-project-id>/<safe-session-id>` path first and, when it exists, reuse it in place with its current real branch; existing worktrees MUST NOT be moved, renamed, pruned, or recreated merely to adopt the short layout.
- MUST make repeated or concurrent preparation for the same project/session converge on the same short path and validate an already-created path with bounded Git operations before reuse.
- MUST keep changes made by Codex in the temporary worktree from dirtying the original repository directory.
- MUST use bounded git operations and surface deterministic local errors when worktree preparation fails.
- MUST release the local session after a bounded git failure, timeout, or missing folder error so later local messages can be processed.
- MUST preserve the project row and existing session timeline when folder workspace resolution fails.
- MUST NOT fetch, merge, rebase, delete the original directory, or modify GitHub issue worktree state while resolving a local folder worktree.

#### Scenario: 新独立工作空间使用稳定短标识

- **GIVEN** 同一项目下有两个不同 session 首次选择独立工作空间
- **WHEN** 系统分别准备并再次解析它们的本地 worktree
- **THEN** 每个 session 的路径和分支在重复解析时保持稳定
- **AND** 两个 session 使用不同的 12 字符短标识、短路径和 `moebius/` 分支。

#### Scenario: legacy worktree 原位优先复用

- **GIVEN** 某 session 的 legacy worktree 路径已存在且当前分支曾被用户保留或改名
- **WHEN** 系统再次解析该 session 的独立工作空间
- **THEN** cwd 仍是原 legacy 路径且状态返回该路径的真实当前分支
- **AND** 系统不创建对应短路径、不移动旧目录、不改名分支。

### Direct folder mode and non-git folders
- MUST, when the folder is a git repository and worktree mode is disabled, run Codex directly in the original repository directory.
- MUST, when the folder is not a git repository, run Codex directly in the original folder.
- MUST NOT automatically run `git init` for non-git folders or reject them merely because worktree mode is enabled.
- MUST, when worktree mode is enabled for a non-git folder, record a visible deterministic workspace status reason `not-git-repository`.

### 空白 session 项目重绑
- MUST allow a local session to change its project only while it has no session messages, no `sessions.parent_session_id` relationship in either direction, and no `session_edges` relationship in either direction.
- MUST require the target project to exist.
- MUST reject project rebinding for GitHub sessions, sessions with any message history, or sessions participating in parent/child orchestration according to either persisted relationship source.
- MUST update session project id and timestamp in one SQLite transaction.
- MUST leave the original project id, messages, cursor, session edges, and project rows unchanged when validation or update fails.
- MUST preserve the session id across a successful rebind.
- MUST keep workspace direct/worktree semantics derived from the newly bound project for the first later run.

### 空白 session 项目重绑 API
- MUST expose a loopback local-console endpoint that accepts a session id and target project id for the bounded empty-session rebind.
- MUST reject malformed input without mutation.
- MUST return HTTP 400 with a stable error code for invalid JSON or malformed rebind fields, HTTP 404 for a missing local session or target project, and HTTP 409 for a session locked by history or relationships.
- MUST NOT classify expected empty-session rebind rejection as an internal server error or map it by matching human-readable error strings.
- MUST return the updated local session summary after success.
- MUST NOT alter GitHub runner state or GitHub issue session behavior.

### 本地子会话持久化
- MUST persist parent-child session relationships in `.state/local-console.sqlite` using `sessions.parent_session_id` or an equivalent column on the existing `sessions` table.
- MUST return each session's parent session id through local session summaries and local console state APIs.
- MUST keep child sessions in the same project as their parent session.
- MUST NOT create a child session under a different project than its persisted parent session.
- MUST preserve existing root sessions with no parent reference when migrating older SQLite databases.
- MUST bound local child session creation through the existing local store timeout path so a locked database, slow worker, or hung worker cannot permanently occupy the parent session drain.

### 本地 CEO 子会话编排
- MUST map local CEO child task descriptors to local child sessions instead of GitHub child issues.
- MUST create child sessions through the existing local console SQLite store, not through GitHub APIs or a second persistence file.
- MUST derive a stable local orchestration key from parent session id, workflow id, and ledger task id before creating a child session.
- MUST recover an existing child session by hidden orchestration key before creating a new child session.
- MUST fail closed when a hidden orchestration key maps to multiple child sessions in the same parent scope.
- MUST write the child session creation and the initial child handoff message in one SQLite transaction.
- MUST write a visible parent-session progress record after child sessions are created or recovered.
- MUST NOT delete already-created child sessions as compensation after a later orchestration failure.

### 运行直播
- MUST expose active Codex run state while a local session is running: run id, role when known, runDir, elapsed time, status, a recent stdout/stderr summary, and any tail-read diagnostic.
- MUST read live output from the current runDir stdout/stderr artifacts or an equivalent Codex output stream using a bounded byte window and a bounded read timeout.
- MUST NOT let a large, missing, locked, slow, or unparseable stdout/stderr file block the state API indefinitely.
- MUST show a non-empty live summary for every running local session; when structured JSONL cannot be parsed, the UI must fall back to raw tail text or a deterministic running summary.

### 中断与失败分流
- MUST provide an interrupt operation for the current local session run.
- MUST implement interruption by aborting the active Codex run through the existing Codex driver cancellation path or an equivalent bounded termination path.
- MUST require interrupt requests to target the active run by session id and run id; a request for another session or stale run id must not abort the active run.
- MUST persist user interruption distinctly from stuck state and error failure; interrupted local messages must be distinguishable from stuck and failed local messages in SQLite, API responses, and UI.
- MUST append a visible local system record when a run is interrupted by the user.
- MUST append a visible local error record when Codex fails by non-zero exit, spawn error, or other non-timeout driver failure.
- MUST NOT classify user interruption as an error failure.
- MUST allow a local session to accept a later message after an interrupted run.

### 卡住状态
- MUST represent stuck local runs as a distinct visible state in SQLite, API responses, and UI.
- MUST classify Codex idle timeout, max-duration timeout, and stale running repair as stuck unless a more specific non-user error is available.
- MUST append a visible local system record when a run becomes stuck, including its reason.
- MUST preserve interrupted, failed, and stuck records across renderer refresh and desktop window restart.
- MUST NOT leave a session permanently running after timeout or stale running repair.

### Dead-letter 与重启恢复
- MUST keep a failure count and last failure reason for each local source message processing failure.
- MUST count failures by source session id and source message id, not by run id.
- MUST keep a failed source message retryable until the configured local failure retry limit is exhausted.
- MUST write exactly one visible local dead-letter system record when a source message exhausts the retry budget.
- MUST persist a matching `local_dead_letters` fact for the dead-lettered source message.
- MUST complete or otherwise terminally mark the dead-lettered source message so later polling does not replay the same source message.
- MUST NOT save a successful dead-letter outcome when the visible dead-letter system record cannot be written.
- MUST NOT advance the local processing cursor when the visible dead-letter system record cannot be written.
- MUST ensure visible dead-letter system records contain no legal agent mention and do not trigger another local agent run.
- MUST allow a later local message in the same session to continue processing after an earlier message has been dead-lettered.
- MUST apply the same retry budget to `recordAgentResponse` failures that happen before the agent response is durably committed.
- MUST NOT duplicate an agent response when `recordAgentResponse` fails before commit and the source message is retried until dead-letter.
- MUST migrate old SQLite databases or missing failure metadata to default failure metadata without losing pending or running message positions.
- MUST release or recover the session cursor after stuck recording so the session is not permanently running.
- MUST NOT duplicate an agent response that was already persisted before process restart.
- MUST continue startup catch-up from the next unprocessed local trigger after restart.

### 边界
- MUST keep shared conversation, trigger, stage, and CEO guardrail semantics stable while allowing local child sessions, primary-Agent closeout, and dead-letter/recovery in this domain.
- MUST allow child session orchestration only as local child session creation, `sessions.parent_session_id` persistence, and parent-timeline card aggregation.
- MUST keep existing local acceptance tables readable as legacy history, but normal local execution MUST NOT write new acceptance facts or integration events and MUST NOT use them for routing, repair, join, or status.
- MUST NOT modify `conversation`, `triggers`, agent mention parsing, stage parsing, or CEO guardrail rules solely to satisfy local-console behavior.
- MUST NOT implement unrelated GitHub parity such as artifact publishing, GitHub child issue side effects, extra worktree diff return behavior beyond the existing local store fact, or unconfirmed cross-mode behavior.

## 场景

### 场景 LC.T4.1：桌面台发起对话后看到运行直播
Given the desktop operator console is open
And it shows the persisted local project list with each session under its owning project
When the user creates or selects a local session
And sends a message that triggers a fake slow Codex run
Then the session timeline shows the user message
And it shows an in-progress run block
And the run block includes a non-empty live summary
And the UI does not show a blank running state.

### 场景 LC.T4.2：运行中断后状态如实反映
Given a local session has an active fake slow Codex run
When the user clicks interrupt
Then the Codex run is aborted through the local runtime
And the original local message is persisted as interrupted rather than failed
And a visible system record states that the run was interrupted by the user
And the session is released for a later message.

### 场景 LC.T4.3：Codex 失败形成本地错误记录
Given a local session message triggers fake Codex
And fake Codex exits non-zero or fails to spawn
When the local runtime records the result
Then the original local message is persisted as failed
And the timeline shows a visible local error record with reason
And the error is present after refresh rather than only in process logs.

### 场景 LC.T4.4：多会话导航不并发污染
Given the local project has session A and session B
And session A is running
When the user switches to session B
Then session B timeline remains readable
And session A still appears as running in the sidebar
And session B cannot accidentally interrupt session A unless the interrupt targets session A's active session id and run id.

### 场景 LC.T4.5：结构化输出缺失时降级显示
Given a Codex run has a runDir but stdout.jsonl has no parseable assistant or progress event yet
When the desktop console renders the active run
Then it still displays a deterministic non-empty running summary

### 场景 LC.T4.6：尾流读取有界
Given a Codex run has a very large stdout.jsonl
Or reading stdout/stderr is slow or fails
When the desktop console polls local state
Then the state API returns within the configured bound
And the run block displays a recent tail summary or deterministic fallback
And the session remains interruptible.

### 场景 LC.T4.7：timeout 或 stale running 显示卡住
Given a local Codex run hits idle timeout, max-duration timeout, or stale running repair
When the local runtime records the result
Then the original message is persisted as stuck
And the timeline shows a visible stuck record with reason
And the session is released for a later message.

### 场景 LC.T4.8：刷新后状态仍可见
Given a local session contains interrupted, failed, and stuck records
When the renderer refreshes or the desktop window restarts
Then the records are restored from SQLite/API
And their status and reason remain distinguishable.

### 场景 LC.T5.1：子会话保存父会话引用
Given a local parent session exists
When local child session creation runs for a CEO-orchestrated task
Then a child session row is inserted or recovered
And the child session row stores the parent session id
And listing sessions returns the child with that parent session id.

### 场景 LC.T5.2：project mismatch 不创建跨 project child
Given a local parent session is persisted under project A
When local child session creation is called with project B
Then the command fails closed or uses the persisted project A
And no child session is created under project B
And the parent session project is not silently rewritten.

### 场景 LC.T5.3：child creation 挂起有界释放
Given local child session creation never returns or exceeds the local store timeout
When the runtime handles the orchestration attempt
Then the parent session run is recorded as visible failed or stuck
And orchestration success is not saved
And the parent session can accept a later local message.

### 场景 LC.T5.4：多子任务目标创建本地子会话
Given a local parent session receives a CEO orchestration result with multiple child task descriptors
When the local child session executor runs
Then one local child session is created or recovered for each descriptor
And each child session contains an initial handoff message
And the parent session receives a visible progress record referencing the child sessions.

### 场景 LC.T5.5：重试不重复创建子会话
Given a previous local child session was created with a hidden orchestration key
And the orchestration success state was not saved
When the same descriptor is retried
Then the existing child session is recovered
And no duplicate child session or duplicate initial handoff message is inserted.

### 场景 LC.T5.6：hidden key collision fail closed
Given two existing child sessions under the same parent contain the same hidden orchestration key
When local child session recovery retries that key
Then recovery fails closed with a visible error
And neither child session is selected as a successful recovery.

### 场景 LC.T5.DL1：连续失败只 dead-letter 一次
Given a local source message repeatedly fails with the same non-timeout processing error
When the failure count reaches the local retry limit
Then the local timeline contains one visible dead-letter system record for that source message
And `local_dead_letters` contains one matching fact
And later polling does not write another dead-letter for the same source message
And the session can process a later local message.

### 场景 LC.T5.DL2：agent response 提交前失败不会重复回复
Given `recordAgentResponse` fails before commit for the same local source message until the retry budget is exhausted
When local processing settles
Then the local timeline contains one visible dead-letter system record for that source message
And `local_dead_letters` contains one matching fact
And no agent response is duplicated
And the session can process a later local message.

### 场景 LC.T5.DL3：dead-letter 可见写失败保持可重试
Given a local source message has exhausted the local retry budget
And writing the visible dead-letter system record fails
When local processing settles
Then the local processing cursor is not advanced
And no successful `local_dead_letters` fact is saved
And a later retry can attempt the visible dead-letter write again.

### 场景 LC.T5.DL4：dead-letter reason 不会自触发
Given a local source message dead-letters with a reason that contains handoff-like text
When the visible dead-letter system record is written
Then the visible dead-letter system record contains no legal agent mention
And later local drain does not trigger an agent from the dead-letter system record.

### 场景 LC.T5.R1：重启 catch-up 不重复已完成 response
Given a local session already contains a persisted agent response
And the process restarts before the next local trigger is claimed
When the local console server starts and runs catch-up
Then the persisted agent response is not written a second time
And the next unprocessed trigger can still be processed.

### 场景 LC.T5.R2：stale running 重启后释放 session
Given a local source message is left running across process restart
When local startup stale repair marks the run stuck
Then the local timeline shows a visible stuck record with reason
And the session no longer reports a running source message
And a later local message can be accepted and processed.

### 场景 LC.T4.13：git project 开启 worktree 后不污染原目录
Given a local project points at a git repository folder
And worktree mode is enabled
When the user sends a local message that makes `dev` write a file
Then Codex runs with cwd inside the temporary local worktree
And the temporary worktree contains the file written by `dev`
And `git status --short` in the original repository folder is empty.

### 场景 LC.T4.14：git project 关闭 worktree 后原地运行
Given a local project points at a git repository folder
And worktree mode is disabled
When the user sends a local message that makes `dev` write a file
Then Codex runs with cwd equal to the original repository folder
And `git status --short` in the original repository folder shows the file written by `dev`.

### 场景 LC.T4.15：非 git project 开启 worktree 时降级原地跑
Given a local project points at a folder that is not a git repository
And worktree mode is enabled
When the user sends a local message that makes `dev` write a file
Then Codex runs with cwd equal to the original folder
And the system does not create a `.git` directory
And the project state exposes `worktreeUnavailableReason=not-git-repository`
And no `gh` command is called.

### 场景 LC.T4.16：project 列表重启后一致
Given the user has opened multiple local folders as projects
When the local console server or desktop shell restarts with the same SQLite database
Then the project list is restored
And each project title reflects the real folder basename
And each project's worktree mode is restored.

### 场景 LC.T4.16A：全新或升级空占位不公开
Given SQLite contains only the automatically initialized `local/default` project, session, and initial cursor
And the data root is either the packaged default or a custom data root
When the local console state is read before and after restart
Then the public project list is empty
And the compatibility rows still exist
And the selected session is null
And the desktop opens an unscoped new conversation without remembering `local/default`.

### 场景 LC.T4.16B：任一历史事实或用户修改使占位继续公开
Given the compatibility project differs from its automatic project or session field baseline
Or it has an additional active or archived session
Or `default` participates as parent or child in either relationship source
Or it has an effective or pending team field or snapshot
Or its cursor is missing, advanced, or active
Or any enumerated session fact table contains a `default` fact
When the public project list is read
Then the compatibility project remains visible
And no project, session, relationship, team snapshot, cursor, or fact is deleted.

### 场景 LC.T4.16C：兼容入口产生历史后重新公开
Given the unused compatibility placeholder is not in the public project list
When a client writes a message through the compatible default local message endpoint
Then the request remains supported
And the compatibility project and default session become public
And the message remains reachable after restart.

### 场景 LC.T4.16D：项目排序忽略隐藏占位
Given the unused compatibility placeholder is hidden
And two real projects are public
When the client submits a complete order containing those two public project ids
Then the reorder succeeds without requiring the hidden compatibility id
And the real projects preserve that relative order after restart
And the compatibility row remains stored.

### 场景 LC.T4.17：local session project 引用完整
Given an old local console SQLite database contains local sessions and messages but no projects table
When the local console schema migration completes
Then every local session references an existing default project
And existing messages, cursor progress, status, runDir, and error fields are preserved.

Given a client tries to create a local session for a missing project id
When the request is handled
Then it fails without inserting a partial session or message.

### 场景 LC.T4.18：workspace resolve failure releases the session
Given a local project folder has been deleted
Or a bounded local git command times out while resolving a worktree
When the user sends a local message for that project
Then the timeline records a visible local failure or stuck record
And the active run is cleared
And a later local message in the same session can be processed.

### 场景 LC.NSPS.1：空白 session 原子重绑
Given a local session has no messages, parent column relationship, child column relationship, or session edges
And the target project exists
When the rebind command runs
Then the same session id references the target project
And no message, cursor, edge, or project row is created or deleted.

### 场景 LC.NSPS.2：已有历史拒绝重绑
Given a local session has at least one message, a parent/child relationship in `sessions.parent_session_id`, or a parent/child relationship in `session_edges`
When a client requests rebinding to another project
Then the request fails
And the session project, messages, cursor, and edges remain unchanged.

### 场景 LC.NSPS.3：双事实源失配时 fail closed
Given a local session relationship exists only in `sessions.parent_session_id`
Or the relationship exists only in `session_edges`
When a client requests rebinding either related session
Then the request fails with the stable relationship-conflict code
And neither session changes project.

### 场景 LC.NSPS.4：非法目标无部分写入
Given a local empty session exists
And the requested target project does not exist
When the rebind command runs
Then the command fails
And the session still references its original project.

### 场景 LC.NSPS.5：API 业务错误分流
Given the rebind endpoint receives malformed input, a missing local resource, or a locked session
When the request is handled
Then it returns 400, 404, or 409 respectively with a stable error code
And no expected business rejection is returned as 500.

## Terminal startup isolation

### Requirement: Local default startup
Source: docs/product/prd.md#产品运行形态

`pnpm start` MUST 启动 local console，并 MUST NOT 要求 GitHub authentication、repository whitelist 或
GitHub runtime state。终端入口 MUST 拒绝任何非空未知参数；系统 MUST NOT 保留可切换到另一运行形态
的隐藏 flag。

#### Scenario: 干净环境启动唯一运行形态

- **GIVEN** 没有 GitHub auth、repository config 或历史 GitHub state
- **WHEN** 用户运行 `pnpm start`
- **THEN** local console server 成功启动
- **AND** 没有 GitHub issue adapter 或后台 child process 被调用

#### Scenario: 旧 GitHub flag fail closed

- **GIVEN** 用户运行 `pnpm start -- --github-mode`
- **WHEN** 参数被解析
- **THEN** 进程在 local server 启动前报告未知参数并退出
- **AND** 不读取或写入 local/GitHub runtime state

## 可验证行为
- `pnpm test` MUST 通过，确保本域规格归位不引入 GitHub runner 核心语义回归。

## Requirement: 验收 3 — 会话与首条消息原子创建
Source: docs/product/pages/main-conversation.md#操作与反馈

系统 MUST 允许会话创建请求携带首条消息，并在同一数据库事务内写入 session 与对应 user message 后才返回成功。系统 MUST NOT 在消息写入或事务提交失败时留下空白 session，也 MUST NOT 改变不带首条消息的既有会话及子会话创建路径。

### Scenario: 消息写入失败整体回滚
- GIVEN 创建请求同时携带项目、团队与非空首条消息
- WHEN 首条消息在事务提交前写入失败
- THEN 数据库中不存在本次请求的 session 与 message

### Scenario: 旧创建路径保持兼容
- GIVEN 调用方创建会话时没有携带首条消息
- WHEN 本地服务处理该请求
- THEN 会话仍按既有缺省标题路径创建且不产生首条 user message

## Requirement: 验收 5 — 首条消息只生成一次会话标题
Source: docs/product/pages/main-conversation.md#会话内容区

系统 MUST 从首条消息首行折叠连续空白并按显示宽度最多 32 截断生成标题，全空白或全符号内容 MUST 使用“新会话”兜底，长标题 MUST 以省略号结束。系统 MUST NOT 因后续消息重算标题，也 MUST NOT 为本行为新增标题修改接口。

### Scenario: 标题在后续消息后保持不变
- GIVEN 会话已从首条消息生成标题
- WHEN 该会话写入任意后续消息
- THEN 持久化标题与创建完成时完全相同

### Scenario: 长首行按显示宽度截断
- GIVEN 首条消息第一行的显示宽度超过 32
- WHEN 会话与首条消息创建成功
- THEN 标题显示宽度不超过 32 且以省略号结束

## Requirement: 验收 #6 运行中的团队切换在当前步骤结束后落定
Source: docs/product/pages/main-conversation.md#运行中改选团队

系统 MUST 在会话空闲时立即落定团队切换，在存在当前 effective snapshot 代次的已启动、已调度或排队工作时持久化完整待生效团队版本，并于该代次及其衍生 handoff 全部终结后落定、清空待生效值。系统 MUST 让切换请求之后的新用户消息等待新快照再解析，MUST NOT 因切换中止旧工作、重放历史、提前把旧 handoff 路由到新团队或丢弃消息。

### Scenario: 旧 run 点击后继续产生 handoff

- GIVEN 团队 A 的 Agent 正在运行且会在结束时 handoff 给 A 的另一名成员
- WHEN 用户选择团队 B
- THEN 两个 A 代次 run 都使用 A 的完整快照并依次终结
- AND B 只在 A 代次不再有活动或排队工作后生效
- AND 切换后提交的用户消息只按 B 的成员名单解析一次。

### Scenario: 待生效团队跨进程重启保留

- GIVEN 一段会话已持久化待生效的完整团队版本及等待消息
- WHEN 本地进程重启并重新打开该会话
- THEN 同一目标版本、旧代次和等待消息仍存在
- AND 旧代次清空后目标只提升一次。

## Requirement: 验收 #5 工作空间在首条消息后锁定
Source: docs/product/pages/main-conversation.md#选择工作空间与团队

系统 MUST 在会话已有消息时拒绝工作空间切换命令并返回用户可理解的原因；已有库中残留的待生效工作空间值 MUST 被视作无效并按生效值解析。系统 MUST NOT 静默忽略该命令，MUST NOT 在错误文案中暴露列名、路径或内部标识，MUST NOT 因升级使既有会话的生效工作空间发生跳变。

### Scenario: 已开始的会话拒绝切换工作空间
- GIVEN 一段会话已经有消息
- WHEN 收到该会话的工作空间切换命令
- THEN 命令被拒绝并返回可理解的原因，会话的生效工作空间不变

### Scenario: 存量待生效值降级
- GIVEN 升级前某会话持久化了待生效工作空间
- WHEN 升级后该会话触发一次运行
- THEN 解析结果取生效值，待生效值不参与解析，也不在当前步骤收尾时被提升

## Requirement: 验收 #7 工作空间模式归属于会话
Source: docs/product/pages/main-conversation.md#上下文

系统 MUST 在 session 上持久化生效工作空间模式，并在每次运行前以会话模式和所属项目文件夹解析 Codex cwd；升级时 MUST 将既有会话初始化为所属项目当时的模式且迁移幂等。系统 MUST NOT 在运行时从 project 的当前模式回退推导会话模式，也 MUST NOT 因孤儿会话阻塞迁移。

### Scenario: 同项目两段会话使用不同工作空间
- GIVEN 同一个项目下有一段默认工作空间会话和一段独立工作空间会话
- WHEN 两段会话分别触发一次 Codex 运行
- THEN 默认会话的 cwd 是项目文件夹，独立会话的 cwd 是自己的隔离副本，任一会话的模式不改变另一段会话

### Scenario: 既有会话迁移保持原行为
- GIVEN 结构升级前一个项目启用了独立工作空间且其下已有会话
- WHEN 会话工作空间列迁移执行两次
- THEN 该既有会话的生效模式均保持独立，第二次迁移不产生额外变化

## Requirement: 验收 #9 会话状态上行真实分支名
Source: docs/product/pages/main-conversation.md#上下文

系统 MUST 在会话状态中返回当前生效工作空间的 `git branch --show-current` 真值，并按工作空间路径有界缓存读取结果、在运行收尾和工作空间切换时失效；detached HEAD MUST 返回确定性 `detached`。系统 MUST NOT 以“当前分支”“会话分支”或编造的名称代替 Git 真值，也 MUST NOT 让每次状态刷新都启动 Git 进程。

### Scenario: 默认与独立工作空间分别返回真实分支
- GIVEN 同项目的默认会话位于 `main`，独立会话位于 `agent/local-session`
- WHEN 客户端分别请求两段会话的 state
- THEN 两段会话的 `branchName` 分别为 `main` 与 `agent/local-session`

## Requirement: 验收 #20 会话使用选择时载入的团队内容快照
Source: docs/product/pages/main-conversation.md#选择工作空间与团队

系统 MUST 在会话创建、明确改选团队或显式应用当前团队更新时持久化完整团队快照，至少包含团队稳定身份、历史名称与用途、来源辨认、主 Agent、有序成员身份、每名成员 `AGENT.md` 与 CLI/model/effort，以及可为空的生效载入时间。运行中改选或应用的完整版本 MUST 与团队绑定一起待生效和落定。系统 MUST NOT 因团队页之后的保存自动改变 effective 快照，MUST NOT 用当前磁盘团队回填旧快照缺失字段，也 MUST NOT 用内容快照替代团队健康实时判定。

内部 snapshot key/digest MAY 用于一致性、代次和比较，但 MUST NOT 进入面向用户的 state DTO、错误或时间线。

### Scenario: 显式应用完整更新

- GIVEN 会话 effective 版本 A 与当前有效保存版本 B 在 `AGENT.md` 和 profile 上均不同
- WHEN 用户点击任一变化提示的“应用”且没有旧代次工作
- THEN B 的完整团队身份、全部成员 Markdown 和全部 profile 一起成为 effective
- AND 不存在 Markdown 来自 B 而 profile 仍来自 A 的混合版本。

### Scenario: 旧快照字段不可证明

- GIVEN 升级前会话快照只有成员 Markdown 和部分执行配置
- WHEN 系统读取该快照
- THEN 已有内容、顺序和 profile 保持不变
- AND 未记录的团队身份或载入时间保持缺失
- AND 系统不读取当前团队目录补写历史。

## Requirement: #12 系统事实类型持久化
Source: docs/product/pages/main-conversation.md#区域与信息

系统 MUST 为每条系统记录持久化非空事件类型，覆盖没跑起来、卡住、用户按停、反复重试仍未成功和中性其他类型；旧 exception 只迁为中性类型，其他旧人工等待值清空。系统 MUST NOT 依赖正文猜测事实，也 MUST NOT 把路径或内部 id 写入面向用户的正文。

### Scenario: 旧数据库幂等升级
- GIVEN 数据库含旧 awaits_human_reason 值且尚无事件类型列
- WHEN 同一结构升级执行一次或重复执行
- THEN 每条系统记录都有非空类型、旧等待值均被清空且 exception 不触发异常红点

## Requirement: 主 Agent 控制与成员接力
Source: docs/product/pages/main-conversation.md#说话与提及

local runtime MUST 使用目标 session 的 effective 团队快照解释 composer 用户消息。代码区域外只命中一个不同的有效成员时 MUST 直接把该成员作为首位执行者；没有有效 mention、mention 全部无效或命中两个及以上不同有效成员时 MUST 运行团队主 Agent。系统 MUST 保留原始正文，MUST NOT 修改共享 GitHub mention trigger 或 Agent 回复的既有 handoff 选择规则。

同一有效成员重复出现 MUST 视为一个目标；无效 mention 与唯一有效 mention 并存时 MUST 直达该唯一有效成员。非主 Agent 回复有合法 mention 时 MUST 优先按显式交棒继续，无合法 mention 时 MUST 确定性运行主 Agent；主 Agent 回复无合法 mention 时 MUST 推进 cursor 并结束本轮。主 Agent 提及正在工作的成员时 MUST 中止该成员当前步骤，等待其进入终态后再用新指令启动同成员。系统 MUST NOT 把主 Agent 强制插入每次显式成员间交棒，MUST NOT 让主 Agent 无 mention 回复再次触发自己。

### Scenario: 唯一有效成员直达
- GIVEN effective 团队首成员为 dev-manager，另有 dev 与 qa
- WHEN 用户发送 `@qa 请直接检查`
- THEN 首个新 run 的 role 为 qa
- AND dev-manager 与 dev 不因该用户消息启动

### Scenario: 未点名与无效 mention 回主 Agent
- GIVEN effective 团队首成员为 dev-manager，另有 qa
- WHEN 用户分别发送 `请检查` 与 `@unknown 请检查`
- THEN 两条消息的首位执行者都是 dev-manager
- AND qa 不因这两条消息启动

### Scenario: 多个不同有效成员回主 Agent
- GIVEN effective 团队包含 dev-manager、dev、qa
- WHEN 用户发送 `@qa 和 @dev 一起看看`
- THEN 首位执行者是 dev-manager
- AND dev 与 qa 都不被直接启动

### Scenario: 重复同一目标仍可直达
- GIVEN effective 团队包含 dev-manager 与 qa
- WHEN 用户发送 `@qa 请检查，@qa 完成后说明结果`
- THEN 有效目标集合只有 qa
- AND 首位执行者是 qa

### Scenario: 无效 mention 不遮蔽唯一有效目标
- GIVEN effective 团队包含 dev-manager 与 qa，且不包含 unknown
- WHEN 用户发送 `@unknown 请旁听，@qa 请检查`
- THEN 有效目标集合只有 qa
- AND 首位执行者是 qa

### Scenario: 显式成员接力优先
- GIVEN 最新回复来自非主 Agent qa
- WHEN 回复包含唯一合法 mention @dev
- THEN 下一棒是 dev
- AND runtime 不提前把控制权拉回主 Agent

### Scenario: 主 Agent 无 mention 自然结束
- GIVEN 最新回复来自主 Agent
- WHEN 回复没有合法 mention
- THEN runtime 推进该消息处理位点并结束本轮
- AND 不启动新的主 Agent run

### Scenario: 未绑定存量会话继续推进
- GIVEN 存量会话没有团队绑定且共享 agents 名单可用
- WHEN 用户从本地 HTTP 入口发送消息
- THEN 消息由共享名单首成员处理且会话没有进入团队已删除状态

## Requirement: 一个主理人车道与多个成员执行车道
Source: docs/product/pages/main-conversation.md#团队推进中

每个 session MUST 同时允许最多一个主 Agent run，并允许不同专业成员各有一个活动 run。不同成员的 run MUST 可并行；同一成员的新任务 MUST 等待其旧 run 进入终态，若新任务来自主 Agent 对活动成员的重定向则 MUST 先中断旧 run。系统 MUST NOT 用 session 级单值 active run 覆盖或串行阻塞所有专业成员。

### Scenario: 主理人与两个成员并行
- GIVEN dev 与 qa 已在同一 session 运行
- WHEN 用户发送新消息且主 Agent 空闲
- THEN runtime 启动主 Agent run
- AND dev、qa 的 controller 与活动事实保持不变

### Scenario: 重定向同一成员
- GIVEN dev 的旧 run 仍在执行
- WHEN 主 Agent 的新回复合法提及 dev
- THEN runtime 中断旧 dev run 并等待其终态
- AND 之后才以新指令启动新的 dev run

## Requirement: 一个主理人 FIFO 与按成员隔离的持久 FIFO
Source: docs/product/pages/main-conversation.md#输入框

主 Agent MUST 保持既有 pending FIFO。每个专业成员 MUST 拥有按 `sessionId + role` 隔离的持久 FIFO；同 role 最多一个 active run，不同 role MAY 与主 Agent 并行。用户直达活动成员时 MUST 只入该成员 FIFO，不得并行启动第二个同 role run，也不得中断当前 run。主 Agent 对活动成员的显式 redirect MUST 保持既有“中断后带新指令重启”语义，系统 MUST 在持久事实和调度类型上区分 redirect 与 user-direct。

主 Agent 运行期间提交给主 Agent 的用户消息 MUST 以原子、可恢复的 pending 事实保存正文与附件，并 MUST 按提交顺序暴露给 state。主 Agent completed、failed、stuck 或 interrupted 后，runtime MUST 幂等唤醒并领取最早一条主 Agent pending；专业成员终态 MUST NOT 单独触发主 Agent 队列发射。进程重启且不存在真实主 Agent run 时 MUST 继续 catch-up。

### Scenario: 停下主理人后发射
- GIVEN 主 Agent 正在运行且有两条 pending 用户消息
- WHEN 用户精确停止主 Agent 且旧 run 已确认终态
- THEN runtime 领取第一条 pending 并启动新的主 Agent run
- AND 第二条保持 pending

### Scenario: 停下专业成员不发射
- GIVEN 主 Agent 正在运行、dev 也在运行且存在 pending 用户消息
- WHEN 用户停止 dev
- THEN pending 用户消息保持 pending
- AND 主 Agent run 不受影响

### Scenario: 忙碌成员只排队
- GIVEN qa 已有一个活动 run
- WHEN 用户发送唯一有效 mention `@qa 再检查第二项`
- THEN 该消息以 targetRole=qa 持久化为 pending
- AND qa 活动 runId 与 controller 未被中断
- AND session 中仍只有一个 qa active run

### Scenario: 同成员终态后发射最早一条
- GIVEN qa 正在运行且 qa FIFO 依次有消息 A、B
- WHEN 活动 qa run 进入任一已确认终态
- THEN 系统只领取 A 并启动新的 qa run
- AND B 保持 pending
- AND A 的 run 启动前 B 不得越过 A

### Scenario: 不同成员队列独立
- GIVEN qa 忙碌且 qa FIFO 有一条 pending，dev 空闲
- WHEN 用户发送唯一 `@dev`
- THEN dev 可以启动
- AND qa 的活动 run 与 pending 顺序不变

## Requirement: dispatch、团队切换与恢复使用同一持久事实
Source: docs/product/pages/main-conversation.md#选择项目与添加项目

每条 user message MUST 持久化 dispatch lane、目标 role 与判定原因，或在 pending 团队切换期间持久化为 awaiting-team。升级前没有 dispatch 字段的 pending user message MUST 兼容为主 Agent 目标，历史 completed/displayed 消息、cursor、附件与 provider links MUST NOT 被改写。

切换请求之前已经进入专业成员 FIFO 的消息 MUST 使用旧 effective 快照并阻止团队切换提升，直至这些工作进入终态；切换请求之后的用户消息 MUST 等待新快照生效，再按新团队名单解析。graceful restart MUST 先恢复同 role 活动 run，再领取其 FIFO；orphan running MUST 先形成可见 stuck 或其他真实终态，之后才可释放同 role 下一条。系统 MUST NOT 为直达消息创建 replacement provider session。

### Scenario: 重启保留忙碌成员队列
- GIVEN qa 正在运行，第二条唯一 `@qa` 消息处于 qa FIFO
- WHEN 应用正常退出并使用同一数据根重启
- THEN 原 qa run 按既有 runId/provider identity 恢复或形成真实不可恢复终态
- AND 第二条消息仍显示 targetRole=qa 且顺序不变
- AND 原 run 终态前不会启动第二个 qa run

### Scenario: 已有会话升级不重解释旧 pending
- GIVEN 升级前会话有一条包含 `@qa` 的 pending user message
- WHEN 新版本完成 schema migration 与 startup catch-up
- THEN 该旧消息仍交给主 Agent
- AND 历史时间线与既有 provider links 不变
- AND 升级后新发送的唯一 `@qa` 使用新直达规则

### Scenario: 切换前后消息使用正确团队
- GIVEN 旧团队 qa 正在运行且已有一条旧团队 qa pending
- WHEN 用户请求切换团队并在切换等待期间再发送消息
- THEN 旧 qa pending 先按旧快照完成并阻止新快照提升
- AND 切换等待期间的新消息不启动旧团队成员
- AND 新快照提升后才按新团队名单解析新消息

## Requirement: state 暴露全部待发射目标且保持主理人兼容投影
Source: docs/product/pages/main-conversation.md#团队推进中

local state、session view 与 snapshot MUST 返回当前 session 的全部 `activeRuns`，每项以非空 runId、role、live Markdown 和 interruptible 区分；同时 MUST 暴露全部 pending dispatch，每项至少包含目标 lane、目标 role 或 awaiting-team 状态。迁移期 `activeRun` MAY 保留，但 MUST 只投影主 Agent run；主 Agent 空闲时 MUST 为 null，MUST NOT 随机投影专业成员。`pendingPrimaryMessages` MAY 在迁移期保留，但 MUST 只包含主 Agent 项。

`hasPendingControlWork`、running count、archive guard、session/project summary MUST 覆盖所有成员 pending、活动恢复与待主 Agent 接回结果，MUST NOT 因主 Agent 空闲而把仍有 worker FIFO 的 session 标为 idle。

### Scenario: 只有两个专业成员运行
- GIVEN dev 与 qa 正在运行且主 Agent 空闲
- WHEN 客户端读取 state
- THEN `activeRuns` 含 dev 与 qa 两项
- AND `activeRun` 为 null

### Scenario: 只有专业成员 pending
- GIVEN 主 Agent 空闲、qa 正在运行且 qa FIFO 有一条 pending
- WHEN 客户端读取 session view
- THEN pending dispatch 包含 targetRole=qa 的条目
- AND `pendingPrimaryMessages` 不包含该条目
- AND `hasPendingControlWork` 为 true

## Requirement: 中断按精确 runId 匹配
Source: docs/product/pages/main-conversation.md#停下

runtime MUST 在 session 的全部活动 run 中按 `sessionId + runId` 精确匹配中断目标，并只向命中的 controller 发出 abort。不存在或已终态的 runId MUST 返回无匹配；停止任一专业成员 MUST NOT 改变其他 run 或释放主理人 pending。

### Scenario: 并行 run 中停止一个
- GIVEN 同一 session 有 primary-run、dev-run 与 qa-run
- WHEN interrupt 请求携带 dev-run
- THEN 只有 dev-run controller 收到 abort
- AND primary-run 与 qa-run 保持活动

## Requirement: 并行控制工作事实与恢复
Source: docs/product/pages/main-conversation.md#指标与验收

`hasPendingControlWork` 与 running count MUST 覆盖全部活动 run、尚未领取的主理人或专业成员 pending、awaiting-team、活动恢复，以及已完成但尚待主理人接回的专业结果。archive guard 与 session/project summary MUST 使用同一事实。重启恢复 MUST 逐条识别持久化但已无真实进程的 running run 并写入可见 stuck 终态。系统 MUST NOT 因某一 run 完成而把仍有其他 run 或 pending 的 session 标为 idle。

### Scenario: 一个成员完成但另一个仍运行
- GIVEN dev 与 qa 并行且 dev 已完成
- WHEN session summary 刷新
- THEN qa 仍计入 runningCount
- AND session 保持进行中

### Scenario: 只有成员队列仍待发射
- GIVEN 主 Agent 空闲且没有专业成员活动，但 qa FIFO 仍有一条 pending
- WHEN session summary 与 archive guard 刷新
- THEN `hasPendingControlWork` 为 true 且会话保持进行中
- AND archive guard 不允许把该会话当作无控制工作归档

## Requirement: 会话团队快照首成员是主 Agent 单一事实
Source: docs/product/pages/agent-teams.md#主-Agent

新建、切换或继承的本地会话团队快照 MUST 把已校验团队的主 Agent 保存为首成员，runtime MUST 使用首成员作为最终控制权回交目标。系统 MUST NOT 新增第二份主 Agent 持久化事实，MUST NOT 从团队外共享 agents 补充已绑定团队。

### Scenario: 运行中切换团队后由新主 Agent 收尾
- GIVEN 旧团队成员正在运行且新团队快照处于 pending
- WHEN 旧成员完成当前步骤，pending 快照生效
- THEN runtime 只用新团队名单解析该回复之后的控制权
- AND 没有指向新团队可用成员的合法交棒时运行新团队主 Agent
- AND 不重放旧成员已经完成的步骤

## Requirement: 本地自由文本不产生验收控制事件
Source: docs/product/pages/main-conversation.md#专业判断与程序状态

本地 runtime MUST 把 Agent 正文中的“验收”“通过”“不通过”、测试结论和复核意见保留为普通时间线内容，MUST NOT 因正文关键词或发送角色运行 acceptance pre-pass、写入 acceptance fact、创建 acceptance repair、推进 parent integration progress 或吞掉同消息合法 handoff。既有 SQLite acceptance 数据 MAY 只读保留，但 MUST NOT 再驱动本地行为。

### Scenario: QA 标题包含验收仍正常交棒
- GIVEN qa 回复包含“测试与验收”“通过”或“不通过”以及合法 @dev
- WHEN local runtime 处理该回复
- THEN 下一棒是 dev
- AND 不出现 missing-acceptance-statements 或验收格式诊断系统消息
- AND 不新增 local acceptance fact

### Scenario: 无 mention 专业结论回到主 Agent
- GIVEN 非主 Agent 回复包含“验收结论：通过”但没有合法 mention
- WHEN local runtime 处理该回复
- THEN 正文不被解析为机器验收事实
- AND 下一棒回到主 Agent

### Scenario: 子会话创建不要求 formal acceptance statements
- GIVEN 本地 child descriptor 没有 taskChecks 或 acceptanceStatements
- WHEN local child executor 解析并创建子会话
- THEN 子会话仍被创建且初始正文不出现空检查章节
- AND 相同缺字段输入在 GitHub strict caller 下仍按原契约拒绝

### Scenario: 可选任务检查兼容旧字段
- GIVEN 本地 descriptor 带 1 到 3 条 taskChecks 或 legacy acceptanceStatements
- WHEN local child executor 创建子会话
- THEN 内容以“任务检查参考”展示
- AND 不建立 formal acceptance scope 或验收事实

### Scenario: 新旧检查字段冲突时拒绝
- GIVEN taskChecks 与 acceptanceStatements 同时存在且内容不同
- WHEN local orchestration parser 校验 descriptor
- THEN 明确拒绝且不创建半条 child session

## Requirement: 主 Agent 控制上下文只在本地 prompt 注入
Source: docs/product/pages/agent-teams.md#页面目标

local runtime MUST 使用本地专用 prompt 提供当前团队主 Agent、可用成员与最终回交规则，MUST 保留成员 AGENT.md 对专业职责的所有权。本地 prompt MUST NOT 声称时间线是 GitHub Issue，不得出现 GitHub comment/reaction 或 role envelope 运行指令；共享 GitHub prompt 与 runner 行为 MUST 保持不变。

### Scenario: 用户 persona 未写回交规则仍闭环
- GIVEN 用户团队成员 persona 没有写明主 Agent
- WHEN 非主 Agent 完成回复且没有合法 mention
- THEN runtime 仍依据团队快照运行主 Agent
- AND 用户团队文件不被覆盖

## Requirement: 主 Agent 收尾前接力状态保持进行中
Source: docs/product/pages/main-conversation.md#说话与提及

系统 MUST 从 cursor 尚未评估的 user/agent trigger source、主理人待发射消息、全部活动 run、active claim、真实 running message 与尚待主理人接回的专业结果派生唯一的 hasPendingControlWork，并由 session/project summary 与子会话状态消费。只要该事实为 true，会话 MUST 保持进行中；只有主 Agent 无 mention 回复完成评估、没有待发射消息、活动 run 或待接回专业结果时，该事实 MUST 变为 false。该事实只表示控制流是否仍有下一棒，MUST NOT 表示任务成功、验收通过或语义完成，也 MUST NOT 遮蔽失败、卡住、停下或不可继续事实。

### Scenario: 专业成员完成但主 Agent 尚未收尾
- GIVEN 非主 Agent 无 mention 回复已经落库
- AND 该回复尚未处理或主 Agent run 已 claim
- WHEN 读取 session、project 或 child summary
- THEN 会话仍为进行中
- AND 不显示已结束或最终结果提示

### Scenario: 主 Agent 收尾后结束
- GIVEN 主 Agent 无 mention 回复已经落库并完成 trigger 评估
- WHEN cursor 推进到该回复
- THEN hasPendingControlWork 为 false
- AND 会话可进入 idle

## Requirement: #17 不可继续状态可判定并可恢复
Source: docs/product/pages/main-conversation.md#三种不可继续状态的共同规则

系统 MUST 分别产出项目文件夹不可用、团队已删除、团队需要修复的原因和恢复动作；修复项目、改选团队或修复团队后 MUST 恢复推进并保留历史。系统 MUST NOT 把已删除团队归为需要修复，团队恢复后 MUST NOT 要求用户额外操作。

### Scenario: 团队修复自动生效
- GIVEN 会话因团队需要修复而不可继续
- WHEN 后续真实状态刷新发现该团队恢复可用
- THEN 会话自动恢复推进能力且历史消息未改变

## Requirement: #18 运行中上下文失效按工作空间安全性分流
Source: docs/product/pages/main-conversation.md#三种不可继续状态的共同规则

系统 MUST 允许已有有效隔离副本的执行完成当前步骤后停止，并 MUST 立即中止依赖已失效项目目录或团队内容的执行、写入可读系统记录。系统 MUST NOT 在执行无法继续后仍上报成员正在工作。

### Scenario: 直接工作空间在目录消失时立即停止
- GIVEN 成员正在直接工作空间执行且项目文件夹变为不可用
- WHEN 状态从 HTTP 应用入口刷新
- THEN 当前执行被中止、时间线出现可读记录且 activeRun 为空

## Requirement: 按父会话读取子任务事实
Source: docs/product/pages/main-conversation.md#子会话卡片

系统 MUST 通过父会话读接口返回每个子会话的标题、负责成员、当前状态及可读状态标签，并对空拆分返回空数组、对缺失或损坏的子会话返回确定性的不可用降级行。系统 MUST NOT 改写 `parent_session_id`、`session_edges` 或把聚合规则交给界面推导。

### Scenario: 一个子会话链损坏
- GIVEN 父会话关联三个子会话且其中一个会话记录已缺失
- WHEN 客户端通过 HTTP 请求该父会话的子任务聚合
- THEN 接口仍返回三行且缺失行的标题、成员和状态为确定性降级值

## Requirement: 拆分在父时间线持久化卡片锚点
Source: docs/product/pages/main-conversation.md#子会话卡片

系统 MUST 在 CEO 编排创建子会话并成功记录可见回复后，于父会话写入携带子会话标识的唯一卡片锚点，并在重启后保持相同消息顺序。系统 MUST NOT 为每个子会话另写侧边栏入口消息或在可见回复之前写入卡片锚点。

### Scenario: 重启后重读拆分时间线
- GIVEN 一次拆分已依次写入 CEO 可见回复和子会话卡片锚点
- WHEN local-console 进程重启后通过 HTTP 重读父会话
- THEN 同一卡片锚点仍位于 CEO 可见回复之后且只出现一次

## Requirement: 活动 run 暴露最新 Agent 可见 Markdown 而不制造消息
Source: docs/product/pages/main-conversation.md#时间线
Source: docs/adr/0004-jsonl-session-fact-log.md#决策

系统 MUST 从当前 Codex run 的完整结构化 stdout 事件中只提取 Agent 可见 Markdown，并在活动 run snapshot 中至多暴露当前最新一段；命令、reasoning、错误、usage 与 thread/turn 生命周期事件 MUST NOT 成为对话消息或活动 Markdown。活动 run snapshot 中用于原地替换的最新 Markdown 投影 MUST 只存在于当前 run 的内存/API 事实中；各段 Agent 可见进度事实 MUST 追加到会话 jsonl，但 MUST NOT 追加到 `session_messages`、推进 cursor 或改变重启恢复语义。

### Scenario: 八个运行事件不生成八条消息
- GIVEN 一次 run 依次产生 thread、turn、两条 agent message、命令开始/结束和完成事件
- WHEN local runtime 更新活动 snapshot
- THEN 同一个 run 始终只有一条活动记录且其 Markdown 从第一段原地替换为第二段
- AND run 成功后 SQLite 只新增一条最终 Agent 消息

## Requirement: run 生命周期以执行段事实记录真实耗时
Source: docs/product/pages/agent-conversation.md#运行耗时

系统 MUST 为每个 run 记录创建、执行进程启动、暂停/恢复执行段与终态事实，并只累计真实执行段；排队与暂停期间 MUST NOT 计时。未确认执行进程启动的终态 MUST NOT 产生虚假的零耗时。

### Scenario: 进程启动前失败
- GIVEN 一个 run 已离开队列但外部执行进程没有成功启动
- WHEN run 进入没跑起来终态
- THEN API 不提供已进行或耗时
- AND 完成时刻仍记录真实终态时刻

### Scenario: 执行后停止
- GIVEN 一个 run 的执行进程已经启动并运行 84 秒
- WHEN 用户精确停止该 run
- THEN 终态事实记录累计耗时 84 秒与真正停止时刻
- AND 同会话其他 run 的计时不受影响

## Requirement: 活动事实只记录单调、安全的最新投影
Source: docs/product/pages/agent-conversation.md#最新活动

系统 MUST 从当前执行引擎的结构化事件投影有界的动作与安全对象，并按 run 内单调游标原地更新最新活动。系统 MUST NOT 在较新事件完成后回退到较早工具的开始事件，也 MUST NOT 在活动 DTO 中暴露命令参数全集、输出、绝对路径、运行目录、内部 ID 或原始协议类型。

### Scenario: 较新并发工具完成
- GIVEN 较早工具 A 仍运行且较新工具 B 已开始
- WHEN B 产生完成事件
- THEN 最新活动显示 B 的完成态
- AND 后续无新事件时不闪回 A 的开始态

### Scenario: 命令活动脱敏
- GIVEN Codex 运行带绝对路径、内部 id 和多个命令参数
- WHEN runtime 投影命令活动
- THEN DTO 只包含安全的动作与命令对象
- AND 不包含绝对路径、内部 id、cwd 或命令输出

## Requirement: 步骤聚合多次用户触发的独立 run
Source: docs/product/pages/agent-conversation.md#步骤、尝试与-run

系统 MUST 为初次执行建立稳定步骤标识，并让用户重试创建同一步的新 run 与下一尝试序号；改一改重发创建新消息、新步骤和新 run。首版 MUST NOT 自动重试或产生新的 retry-exhausted 事实。

### Scenario: 用户重试
- GIVEN 同一步第 1 次 run 已进入终态
- WHEN 用户点击重试
- THEN 新 run 沿用步骤标识且 attempt 为 2
- AND 新 run 从零独立计时

### Scenario: 改一改重发
- GIVEN 用户停止原 run 并修改原消息后发送
- WHEN 新消息触发执行
- THEN 新 run 使用新的步骤标识且 attempt 为 1
- AND 原消息、原 run 与原耗时保持不变

## Requirement: JSONL 增量读取有界且不伪造 token 流
Source: docs/product/pages/main-conversation.md#时间线

系统 MUST 只向可见事件适配器提交已经换行闭合的 JSONL，并 MUST 对单条未闭合输入设置明确的有限字节上限；超限行 MUST 有界丢弃且后续完整行仍可处理。系统 MUST 容忍 chunk 断行、malformed 行、未知事件与回调异常而不终止 Codex run。当前上游未提供正式 token delta 时，系统 MUST 按完整 Agent 进度段更新，MUST NOT 人工切字或把命令输出伪装成 token stream。无可见 Agent Markdown 时 MUST 保留非空、有界的运行摘要降级。

### Scenario: 半条 JSON 后仍可恢复
- GIVEN stdout chunk 在一条 agent message JSON 中间断开且其前后夹有 malformed、超限与 command 事件
- WHEN 后续 chunk 补齐该行
- THEN 适配器只产生一次完整 Agent Markdown 更新
- AND state API 不因 malformed 或缺失可见段无限等待或返回空白 run
# 本地托管附件

## Requirement: 本地附件使用应用托管副本
Source: docs/product/pages/main-conversation.md#添加与发送附件

系统 MUST 将本地附件内容写入数据根下的专用托管目录，并在既有 `.state/local-console.sqlite` 中把不可变 blob 元数据与草稿/消息有序 refs 分开持久化。blob MUST 保存服务端判定的种类、显示名、媒体类型、实际字节数、完整性摘要和服务端生成的相对存储键；ref MUST 保存 renderer 可见的不透明 attachment id、blob 关联、draft/message 二选一归属和稳定顺序。系统 MUST NOT 把内部 blob id、原始绝对路径、托管绝对路径或本轮附件副本路径写入附件 DTO、缩略图响应、消息正文或 renderer 可见 attachment id。

附件原件写入 MUST 流式执行并受有界字节护栏约束；完成内容写入前 MUST NOT 建立可发送的附件元数据。服务端 MUST 只把 magic bytes 识别为 PNG、JPEG、GIF 或 WebP 且已经完成有界 PNG preview finalization 的附件归类为 ready 图片，preview MUST 最长边不超过 512px 且编码后不超过 2MiB。系统 MUST NOT 仅凭客户端 MIME 或扩展名把 HTML、SVG、畸形图片或其他内容提升为图片预览。renderer MUST 只读取派生缩略图，MUST NOT 通过附件端点读取完整托管原件。

### Scenario: 原文件删除后托管附件仍可用
- GIVEN 用户已把本地图片加入草稿且托管写入完成
- WHEN 原文件被移动或删除并且应用重启
- THEN 同一 draft key 仍能恢复附件元数据并读取托管内容
- AND 系统不重新访问原路径。

### Scenario: 已发送附件通过新引用复用
- GIVEN 同一 session 的一条历史 user message 已引用两个托管 blobs
- WHEN 系统为“改一改重发”目标 draft 原子克隆其附件引用
- THEN 目标 draft 获得两个新的 attachment ids 并保持原顺序
- AND 原 message refs 与两个 blobs 保持不变
- AND 系统不复制 blob 字节。

### Scenario: 伪装图片按普通文件处理
- GIVEN 一个扩展名和客户端 MIME 声称为 PNG、但内容不是受支持图片的文件
- WHEN local-console 完成服务端内容识别
- THEN 该附件不会获得图片预览或进入 Codex `imagePaths`
- AND 它至多按普通文件附件处理。

### Scenario: 上传中断不产生 ready 附件
- GIVEN 附件字节流在完成前中断或超过高位护栏
- WHEN 服务端收敛本次写入
- THEN SQLite 中不存在可发送的对应 ready 附件
- AND partial 内容被删除或由启动清理有界回收。

### Scenario: 超大尺寸或畸形图片上传失败
- GIVEN 一个具有受支持图片签名、但无法在预览预算内安全解码的附件
- WHEN renderer 无法生成有界 PNG preview，或 preview finalization 超过服务端字节上限
- THEN 系统不建立 ready 附件元数据
- AND 界面保留可重试或移除的失败项，不把它伪装成普通文件。

## Requirement: 正文与有序附件原子形成用户消息
Source: docs/product/pages/main-conversation.md#添加与发送附件

首条消息创建和已有会话消息提交 MUST 接受正文加有序 attachment ref ids，并允许“正文 trim 后非空”或“至少一个 ready ref”任一条件满足发送。系统 MUST 在一个 SQLite transaction 中创建 pending 用户消息并把全部 refs 从正确的 draft key 转为该消息的有序归属；首次发送还 MUST 在同一 transaction 中创建 session。任一 ref 或 blob 缺失、未就绪、归属错误或 ref 已经被 claim 时，系统 MUST 回滚 session、message 和全部 refs 归属。

旧的 body-only 请求 MUST 继续可用。纯附件首条消息 MUST 使用第一个附件显示名生成稳定标题，MUST NOT 因空正文拒绝创建。

### Scenario: 纯附件首条消息创建会话
- GIVEN 新对话草稿包含一个 ready 图片且正文为空
- WHEN 用户发送
- THEN 系统创建一段 session 和一条包含该图片的 pending 用户消息
- AND 标题来自第一个附件显示名
- AND local runtime 开始处理该消息。

### Scenario: 多附件有一个归属错误
- GIVEN 请求包含三个附件，其中一个不属于当前 draft key
- WHEN SQLite worker 校验并尝试提交
- THEN 不创建用户消息
- AND 其余两个附件仍属于原草稿
- AND 不启动 Codex。

### Scenario: 旧正文请求保持兼容
- GIVEN 一个旧客户端只提交非空 `body`
- WHEN 它调用既有 session-scoped message endpoint
- THEN 系统仍创建一条没有附件的 pending 用户消息
- AND 既有串行执行语义不变。

## Requirement: 本地附件端点保持 capability 与归属边界
Source: docs/product/pages/main-conversation.md#添加与发送附件

附件原件上传、图片 preview finalization、派生缩略图读取、移除和历史 refs 克隆端点 MUST 要求桌面启动时生成并通过窄 preload 能力提供的随机 capability；缺失或错误 capability MUST 在读取或写入文件前拒绝。普通文件卡片 MUST 只消费元数据，renderer MUST NOT 获得任意普通文件内容读取能力。系统 MUST 校验 attachment id、draft key、session/message 归属与所有解析后路径仍在托管根或当前 runDir 输入目录内，MUST NOT 接受客户端提供的 blob id 或文件系统目标路径。

消息和草稿的 `attachments` 字段 MUST 只暴露结构化显示元数据与不透明 id；既有 local-console 诊断字段不因本 change 扩张或重构。图片缩略图读取 MUST 使用结构化附件通道，MUST NOT 放宽 Markdown 对 `file:`、`data:`、`javascript:` 或自定义协议的禁用。

### Scenario: renderer 的附件载荷看不到本地路径
- GIVEN 已发送消息包含图片和普通文件
- WHEN renderer 读取 session view 和附件缩略图
- THEN `attachments` 字段和预览响应不包含 blob id、原始路径、托管路径、storage key 或本轮附件副本路径
- AND 图片通过有 capability 的派生缩略图读取转成临时 Blob 预览。

### Scenario: 取消在途上传不留下 ready 附件
- GIVEN 一个附件仍在流式上传
- WHEN 客户端取消请求或连接中断
- THEN local-console 不建立 ready 附件元数据
- AND partial 内容被删除或进入有界孤儿清理。

### Scenario: 跨 session 克隆附件引用被拒绝
- GIVEN source user message 属于 session A，目标 draft 属于 session B
- WHEN 客户端请求把 source refs 克隆到目标 draft
- THEN local-console 在创建任何新 ref 前拒绝请求
- AND source message refs、目标 draft 和 blobs 均不改变。

### Scenario: 路径穿越显示名
- GIVEN 文件显示名包含目录分隔符或 `..`
- WHEN 服务端持久化并准备运行副本
- THEN 真实存储路径仍只由不透明 id 和固定/清洗后的服务端片段构成
- AND 解析结果始终位于预期根目录。

## Requirement: prompt 范围附件生成本轮安全副本
Source: docs/product/pages/main-conversation.md#添加与发送附件

local runtime MUST 在调用 Codex 前按本轮 prompt 范围和消息内顺序，把托管附件复制到当前 `runDir/input-attachments/`，并为每项生成带时间线消息来源、显示名、类型、大小和受控运行路径的 prompt manifest。PNG、JPEG、GIF、WebP 图片 MUST 按相同稳定顺序传入 `CodexRunOptions.imagePaths`；普通文件 MUST NOT 进入 `imagePaths`，只通过 manifest 供 Agent 读取。

任一附件准备失败时，系统 MUST NOT 调用 Codex或静默省略失败附件；它 MUST 留下可见、可重试的本地系统事实并释放 session。重试 MUST 从托管副本重新准备，不得访问原路径。

### Scenario: 图片和普通文件进入不同输入通道
- GIVEN prompt 范围包含一张 PNG 和一个 PDF
- WHEN runtime 准备本轮输入
- THEN 两者都存在于当前 runDir 输入附件目录并出现在 prompt manifest
- AND 只有 PNG 路径出现在 Codex `imagePaths`。

### Scenario: 准备失败释放 session
- GIVEN 一条已 claim 消息的托管附件在复制到 runDir 时失败
- WHEN runtime 处理该失败
- THEN Codex driver 没有被调用
- AND session 不再占用 running claim
- AND 用户可以基于同一托管附件重试。

## Requirement: 每会话 jsonl 是历史消息唯一事实源
Source: docs/adr/0004-jsonl-session-fact-log.md#决策

系统 MUST 以每个 session 独立的 jsonl 事件流恢复会话历史，SQLite 中的 `session_messages` 仅作为可丢弃缓存。系统 MUST NOT 在 jsonl 与 SQLite 冲突时以 SQLite 覆盖 jsonl。

### Scenario: 索引内容与事实日志冲突
- GIVEN 同一会话的 jsonl 与 `session_messages` 内容不同
- WHEN store 初始化或读取该会话
- THEN 返回 jsonl 中的消息，并可由 jsonl 重建 SQLite 缓存

## Requirement: 事实日志只追加完整事件行
Source: docs/adr/0004-jsonl-session-fact-log.md#决策

系统 MUST 将每次会话事实写入编码为一条以换行结束的 JSON 事件，并保留既有完整事件行。系统 MUST NOT 就地改写或删除既有完整事件行。

### Scenario: 连续产生会话事实
- GIVEN 会话日志已有一条完整事件行
- WHEN 同一会话新增一条用户或 Agent 消息事实
- THEN 文件末尾新增一条完整事件行，原有完整行字节保持不变

## Requirement: 事实事件只携带真正变更的消息
Source: docs/adr/0004-jsonl-session-fact-log.md#决策

系统 MUST 只把「相对该会话上一状态真的发生变化」的消息写进事件的 `messageUpserts`。变更判断 MUST 与对象键序无关；系统 MUST NOT 用键序敏感的序列化结果做等价比较。单条事件携带的消息数 MUST 只与本次动作实际改动的消息相关，MUST NOT 随会话已有消息总数增长。

### Scenario: 长会话连续接力
- GIVEN 一个已有多条消息的会话
- WHEN 新一轮认领、回复、标记已处理依次写入事实
- THEN 每条事件只携带本轮真正改动的消息
- AND 回放整份日志得到的消息终态与逐条 upsert 等价

### Scenario: 前后快照键序不同
- GIVEN 变更前后的同一条消息由不同构造路径产出、字段值相同但键序不同
- WHEN store 提交该会话事实
- THEN 该消息不出现在事件的 `messageUpserts` 里

## Requirement: 追加与读取的代价不随日志大小增长
Source: docs/adr/0004-jsonl-session-fact-log.md#决策

追加一条事件 MUST NOT 读取整个日志文件；判断上次是否写了半行 MUST 用文件长度与尾部字节完成。读取 MUST 支持增量：日志只变长时，系统 MUST 只解析新增字节并复用已解析结果，MUST NOT 每次读取都重新解析整份日志。同一份日志被多个读取器消费时 MUST 复用同一次解析结果。日志被整体改写或截短时，系统 MUST 丢弃缓存重新解析，MUST NOT 返回与磁盘内容不一致的结果。

### Scenario: 在大日志上追加
- GIVEN 一份数 MB 的会话日志
- WHEN 追加一条事件
- THEN 本次追加的读取量与文件大小无关
- AND 原有完整行字节保持不变

### Scenario: 轮询重复读取
- GIVEN UI 轮询在两次读取之间日志新增了若干行
- WHEN 第二次读取该日志
- THEN 只解析新增部分，已解析的历史行不再重新解析

### Scenario: 日志被压缩重写
- GIVEN 运维用压缩工具原地重写了该日志
- WHEN 下一次读取该日志
- THEN 返回重写后的内容

## Requirement: 存量日志可压缩且回放等价
Source: docs/adr/0004-jsonl-session-fact-log.md#决策

系统 MUST 提供把历史日志中重复携带的消息副本压掉的手段：压缩 MUST 保留全部事件及其类型、载荷、顺序与事件 id，MUST 只删除「与既有状态逐字段相同」的 upsert 副本。压缩结果 MUST 与压缩前回放出同一份消息终态；不等价时 MUST 报错并保留原文件，MUST NOT 落盘。

### Scenario: 压缩键序缺陷时期的日志
- GIVEN 一份每条事件都重复携带全部消息的历史日志
- WHEN 执行压缩
- THEN 事件条数与各事件载荷保持不变
- AND 压缩前后回放出的消息终态逐项相等

## Requirement: 生产写链只有一个串行写者
Source: docs/adr/0004-jsonl-session-fact-log.md#决策

系统 MUST 由持有桌面单实例锁的主进程通过 store 写漏斗串行提交会话 jsonl 与 SQLite 索引。系统 MUST NOT 允许 runtime 绕过该漏斗直接写会话消息、子会话卡片或 workspace diff。

### Scenario: runtime 产生跨模块会话事实
- GIVEN desktop 主进程已取得单实例锁并装配 local console store
- WHEN runtime 创建子会话、追加子会话卡片或记录 workspace diff
- THEN 写入请求经同一个 store 串行写漏斗提交到相应会话日志

## Requirement: 绕过事实漏斗的消息写入必须显式失败
Source: docs/adr/0004-jsonl-session-fact-log.md#决策

系统 MUST 在 SQLite worker 的顶层派发入口显式拒绝任何绕过 `local-commit-session-fact-write`、可创建或变更 `session_messages` 的命令，并且 MUST 在对应消息索引变更发生前失败。生产 store 的会话创建、消息追加、状态流转、Agent / system 回复、子会话创建与子会话卡片写入 MUST 继续通过同一事实写漏斗提交；系统 MUST NOT 因此拦截一次性 jsonl 迁移导出或从 jsonl 重建消息索引的内部命令。

### Scenario: 顶层直调旧消息命令
- GIVEN 调用方绕过 local console store，从真实 SQLite worker 入口直接提交一个可写 `session_messages` 的旧命令
- WHEN worker 派发该命令
- THEN 调用以指向 ADR-0004 与 `local-commit-session-fact-write` 的明确错误失败
- AND `session_messages` 没有该命令产生的新增或变更。

### Scenario: 生产 store 门面继续写入事实日志
- GIVEN local console 通过真实 store 装配调用任一会话消息变更门面
- WHEN store 提交该会话事实
- THEN worker 只在 `local-commit-session-fact-write` 内执行对应消息索引变更
- AND 对应 session jsonl 追加一条完整事实事件。

### Scenario: 迁移与重建内部命令不被误拦
- GIVEN 旧 `session_messages` 尚待一次性迁移，或 jsonl 对应的消息索引需要重建
- WHEN store 从最外层初始化或重建入口执行迁移导出与索引重建
- THEN 内部迁移和重建命令仍可完成
- AND 旧 SQLite 行不会反向覆盖既有 jsonl。

## Requirement: 读取容忍末尾半行且下次追加先修复
Source: docs/adr/0004-jsonl-session-fact-log.md#决策

系统 MUST 在读取时忽略并截断文件末尾未以换行结束的半行，且追加前再次校正末尾再写入完整事件。系统 MUST NOT 忽略中间或已换行闭合的非法 JSON 行。

### Scenario: 崩溃留下末尾半行
- GIVEN 会话日志包含若干完整行和一条未闭合的末尾 JSON
- WHEN 读取后再次追加事实
- THEN 读取结果只包含完整行且读取后旧半行已被截断，追加后的新事件可被完整解析

## Requirement: jsonl 持久化是 SQLite 提交的前置提交点
Source: docs/adr/0004-jsonl-session-fact-log.md#决策

系统 MUST 在同一事实写入中先持久化并 fsync jsonl 事件，再提交对应 SQLite 事务。系统 MUST NOT 在 jsonl 追加失败时提交该事实的 SQLite 消息索引变更。

### Scenario: 日志追加失败
- GIVEN 会话日志目标不可写
- WHEN store 提交一条会产生消息索引变更的事实
- THEN 操作失败且 SQLite 中不出现该次变更

## Requirement: 一次性迁移不得反向覆盖已有日志
Source: docs/adr/0004-jsonl-session-fact-log.md#决策

系统 MUST 在迁移标记缺失时仅为尚无 jsonl 的会话导出 `session_messages` 历史、校验消息数与首尾样本后写入迁移标记。系统 MUST NOT 以旧 SQLite 行覆盖已存在的会话 jsonl，且迁移标记存在后不得再次导出。

### Scenario: 已有日志与旧表并存
- GIVEN 会话已有 jsonl，同时 SQLite 留有内容不同的旧 `session_messages`，迁移标记尚未写入
- WHEN store 执行启动迁移并再次重启
- THEN 既有 jsonl 保持不变，迁移标记只在校验完成后生效，后续启动不反向导出旧表

## Requirement: SQLite 消息索引可由 jsonl 完整重建
Source: docs/adr/0004-jsonl-session-fact-log.md#决策

系统 MUST 提供从一个或全部会话 jsonl 重扫并重建 `session_messages` 的内部入口。系统 MUST NOT 要求保留旧消息索引才能恢复会话历史。

### Scenario: 消息索引被清空
- GIVEN 会话 jsonl 完整且对应 `session_messages` 已被删除
- WHEN 执行消息索引重建入口
- THEN SQLite 中恢复与 jsonl 一致的消息集合和状态

## Requirement: 子会话拥有独立日志且父会话记录创建事实
Source: docs/adr/0004-jsonl-session-fact-log.md#决策

系统 MUST 为子会话建立独立 jsonl 文件，并在父会话日志追加可关联该子会话的创建事件。系统 MUST NOT 只把子会话内容混写进父会话日志。

### Scenario: 从父会话创建子会话
- GIVEN 父会话已有独立事实日志
- WHEN runtime 从父会话创建一个子会话
- THEN 父日志包含子会话创建事实，子会话路径存在独立日志且子消息只出现在子日志

## Requirement: Agent 可见进度以追加事件保留
Source: docs/adr/0004-jsonl-session-fact-log.md#决策

系统 MUST 把同一 run 的每段 Agent 可见进度作为独立事件追加到会话 jsonl，并让界面继续只原地替换同一个活动节点。系统 MUST NOT 把进度事件插入 `session_messages` 或在完成后留下额外历史消息。

### Scenario: 一个 run 产生多段可见进度
- GIVEN 会话中的 Agent run 已开始
- WHEN Codex 依次产生两段 Agent 可见 Markdown 后返回最终消息
- THEN jsonl 按顺序包含两条进度事件，时间线运行中只更新一个节点且完成后只新增一条最终 Agent 消息

## Requirement: sessionId 稳定映射到内部记录路径
Source: docs/adr/0004-jsonl-session-fact-log.md#决策

系统 MUST 在固定 sessions 根目录下把同一 sessionId 确定性映射到同一 jsonl 路径，并提供内部查询能力支持“复制对话记录路径”。系统 MUST NOT 把该本机路径加入常驻会话或侧边栏展示 DTO。

### Scenario: 重启前后查询记录路径
- GIVEN 同一数据根和 sessionId
- WHEN 分别在 store 重启前后查询记录路径
- THEN 两次得到相同绝对 jsonl 路径，常规会话列表字段不包含该路径

## Requirement: #22 对话基线提交在会话诞生时记录为事实
Source: docs/product/pages/main-conversation.md#区域与信息

系统 MUST 在会话随首条消息创建时，通过每会话 jsonl 事实写漏斗持久化该对话开始时项目所在的提交，作为「这段对话改了什么」的唯一基线；SQLite MUST NOT 成为该基线的唯一事实源；迁移 MUST 幂等；既有会话缺少基线时 MUST 降级为「改动不可用」。系统 MUST NOT 在事后从当前 HEAD 推导基线，MUST NOT 因缺少基线使会话不可用或阻塞运行。

### Scenario: 会话诞生时记录基线
- GIVEN 用户在一个 Git 项目下发出第一条消息
- WHEN 会话被创建
- THEN 该会话持久化了此刻项目所在的提交作为基线

### Scenario: 既有会话缺基线时降级
- GIVEN 升级前创建的会话没有基线提交
- WHEN 读取该会话的改动计数
- THEN 返回「不可用」，会话其余能力不受影响

## Requirement: #22 对话级改动计数覆盖两种工作空间
Source: docs/product/pages/main-conversation.md#区域与信息

系统 MUST 以对话基线提交为起点统计这段对话期间发生改动的文件数，默认工作空间统计项目文件夹、独立工作空间统计隔离副本，两者口径一致且都包含已提交与未提交的改动；项目文件夹不是 Git 仓库时 MUST 返回不可用；会话快照 MUST 下发计数及其是否可用，前端不得自行推导。系统 MUST NOT 区分改动来自团队成员还是用户本人，MUST NOT 只在特定验证标记存在时才产出计数，MUST NOT 在本变更中新增改动文件清单路由。

### Scenario: 默认工作空间统计项目文件夹
- GIVEN 一段使用默认工作空间的会话，其基线之后项目文件夹有 2 个文件发生改动（含未提交）
- WHEN 读取该会话的改动计数
- THEN 计数为 2

### Scenario: 独立工作空间统计隔离副本
- GIVEN 一段使用独立工作空间的会话，其隔离副本相对基线有 3 个文件发生改动
- WHEN 读取该会话的改动计数
- THEN 计数为 3，且不受项目文件夹自身改动影响

### Scenario: 非 Git 项目返回不可用
- GIVEN 一段会话的项目文件夹不是 Git 仓库
- WHEN 读取该会话的改动计数
- THEN 返回不可用，而不是 0

### Scenario: 会话快照只下发计数事实
- GIVEN 一段已有对话基线的 Git 会话
- WHEN 客户端读取会话快照
- THEN 快照包含改动计数及可用性，不包含改动文件清单或清单路由

## Requirement: 孤儿运行在重启后被确定性识别为卡住
Source: docs/product/pages/main-conversation.md#三种不可继续状态的共同规则

系统 MUST 在启动 catch-up 时，把 SQLite 标记为 running、当前进程没有 activeRun、且没有未消费 `graceful-shutdown` 恢复意图的运行落成 stuck：追加带原因的可见系统记录、释放或恢复会话 cursor，**不依赖 stale running 的时长阈值**。若同一 run 存在已持久化且未消费的正常退出恢复意图，系统 MUST 将源消息释放为 pending 并自动继续，不得先写 stuck。没有恢复意图的崩溃、强杀或断电孤儿 MUST NOT 自动重跑。判定 MUST 幂等：已是 stuck、failed 或 interrupted 的记录不重复写系统记录；正在被当前进程持有 activeRun 的运行 MUST NOT 被判为孤儿。

### Scenario: 正常退出孤儿自动恢复
- GIVEN 活动 run 已建立 thread link，退出前已持久化 graceful resume intent
- WHEN 新进程执行启动 catch-up
- THEN 原源消息恢复为 pending 并自动进入同一次执行恢复
- AND 时间线不追加 orphan stuck 或 user-stopped

### Scenario: 强杀孤儿仍然卡住
- GIVEN 上一进程留下一条 running 消息但没有 graceful resume intent
- WHEN 新进程执行启动 catch-up
- THEN 该消息确定性落成 stuck 并等待用户点击重试

### Scenario: 重启后遗留的 running 被识别为卡住
- GIVEN 上一进程留下一条 SQLite 标记 running 的本地消息
- AND 新进程启动后内存中没有该 run 的 activeRun
- WHEN 启动 catch-up 执行
- THEN 该消息被落成卡住状态、追加带原因的可见系统记录、会话 cursor 被释放
- AND 界面显示「一步卡住了」与重试入口，activeRun 为空且不显示假活或空白运行态
- AND 该卡住记录在渲染刷新与桌面窗口重启后仍在

### Scenario: 正常运行不被误判为孤儿
- GIVEN 当前进程正在正常执行一条本地 run 且持有其 activeRun
- WHEN 启动 catch-up 或状态刷新执行
- THEN 该 run 保持运行中、侧边栏正常显示运行点、不被落成卡住

### Scenario: 孤儿清算幂等
- GIVEN 一条本地消息已被落成 stuck、failed 或 interrupted
- WHEN 启动 catch-up 再次执行孤儿清算
- THEN 不重复写系统记录、不改变其既有终态

## Requirement: 每个 Agent run 持久化到 Codex thread 的稳定关联
Source: docs/product/pages/main-conversation.md#agent-执行与恢复
Source: docs/product/pages/agent-conversation.md#异常终态

系统 MUST 把 provider session identity observation、所属 Agent identity 的 canonical
session link 与 attempt 的过程读取 execution link 作为可独立判定的事实。Codex
`thread.started` 继续在同一核验点提交三者。Kimi `session/new|resume` 返回并通过一致性
核验后 MUST 立即提交 observation 与 canonical link；只有当前 turn 已出现非空 Agent
可见文本或终态工具结果时，才可为该 attempt 提交 `execution_session_link`。

Kimi 空响应失败 MUST 保留 observation/canonical，使后续尝试只 resume 原 session；
MUST NOT 为该失败 run 提交 execution link、Agent 回复或 timeline cursor，也不得因为
缺少 execution link 而创建 replacement session。两阶段的 engine/external id 冲突、
trace-ready 先于 observed、或任一必要 fact 写入失败 MUST fail closed。

过程读取 link MUST 包含 `runId`、源消息 id、role、external id、startedAt 与可用的恢复
上下文指纹；canonical link MUST 满足
`Execution session links are engine and profile specific` 的身份、归属和唯一性契约。
任一 link 的同值重放 MUST 幂等，冲突 external id 或归属 MUST fail closed。系统 MUST
NOT 把 provider rollout 内容复制进 Moebius session JSONL，也不得只在 SQLite 或进程内
保存关联。

旧过程读取 link 缺少上下文指纹时 MUST 保持可读，但不得据此直接 first、full 或
resume。只有当前 Agent 身份的所有兼容旧事实归一后恰有一个 external id，系统才可追加
canonical migration fact 并 resume；没有候选或存在不同 external id 时 MUST
unavailable，provider 调用次数为零。

### Scenario: 失败 run 已建立 provider session

- **GIVEN** 一个 Agent run 已收到合法 external id S，随后失败或被用户中断
- **WHEN** 应用重启并从 session JSONL 恢复
- **THEN** 该 run 的过程读取 link 与所属 Agent 身份的 canonical link 均指向 S
- **AND** 后续运行只可 resume S，无需原 run 成功或依赖 active-run 内存状态。

### Scenario: 旧 thread link 没有上下文指纹

- **GIVEN** session JSONL 中存在旧版过程读取 link
- **WHEN** planner 为其所属 Agent 身份解析 canonical provider session
- **THEN** 系统保留该 link 的过程读取能力
- **AND** 只有兼容旧事实归一为唯一 external id S 时才迁移并 resume S
- **AND** 零候选或冲突候选返回 unavailable，且不执行 full、`session/new` 或 provider 调用。

### Scenario: Kimi 空响应保留 canonical 但没有过程 link

- **GIVEN** Kimi full 已返回并核验 session id S
- **AND** prompt 只返回裸 `end_turn`，没有非空 Agent 文本或终态工具结果
- **WHEN** invocation 收口
- **THEN** session JSONL 包含 S 的 provider observation 与 canonical Agent link
- **AND** 当前 run 不含 `execution_session_link`、Agent response 或 timeline cursor
- **AND** 下一次 retry 只调用 `session/resume S`，不调用 `session/new` 或其他 CLI。

### Scenario: Kimi 首个有效证据提交过程 link

- **GIVEN** Kimi session S 已被观察并建立 canonical link
- **WHEN** 当前 turn 首次产生非空 Agent text 或 status 为 completed/failed 的工具结果
- **THEN** 当前 run 幂等提交指向 S 的 `execution_session_link`
- **AND** 后续重复文本或同一工具 update 不建立冲突或重复身份。

### Scenario: Codex link 时机不变

- **GIVEN** Codex 到达既有 external id identity 核验点
- **WHEN** runtime 处理两阶段 callback
- **THEN** observation、canonical 与 execution link 仍在该点提交
- **AND** 本 change 不推迟其过程读取能力。

## Requirement: 恢复兼容性失败时不自动重新执行
Source: docs/product/pages/agent-conversation.md#重试与恢复

系统 MUST 校验持久 Agent identity、provider、冻结团队/角色内容和 workspace 归属。
同一身份一旦存在 provider-session creation evidence，普通消息、用户重试、成员接力、
下一步骤、改一改重发、重新运行与重启恢复都 MUST 使用 canonical external id resume。
关联缺失或冲突、归属不兼容、requested/observed id 冲突或外部会话不可用时，MUST
收口为「无法继续」并保留已有运行事实，MUST NOT 自动 full、`session/new`、切换
provider 或猜测其他会话。

只有 `session + teamSnapshotFingerprint + role` 形成从未创建过 provider session 的
新 Agent 身份时，才允许首次 `full` / `session/new`。切换团队快照可以形成新身份，但
不得重写旧身份的 frozen context、canonical link 或失败事实。

### Scenario: 同一团队快照内改一改重发

- **GIVEN** 当前团队快照中的 Agent 身份已有 canonical external id S
- **WHEN** 用户停止原 run 并执行改一改重发
- **THEN** 新消息与新 run 仍 resume S
- **AND** S 缺失、冲突或不可用时明确失败，不执行 full 或 `session/new`。

### Scenario: 团队在停下后被切换

- **GIVEN** 原 run 属于团队快照 A 的 Agent 身份并链接 external id S
- **WHEN** 会话切换到团队快照 B，且同一 role 在 B 中形成尚无 creation evidence 的新身份
- **THEN** B 中的新身份可执行自己的首次 `full` / `session/new`
- **AND** A 的身份与 S 保持不变，B 不得把这次首次创建当作 A 的 fallback。

### Scenario: 正常退出后 provider session 已丢失

- **GIVEN** 正常退出已为原 run 持久化恢复意图及 canonical external id S
- **WHEN** 重启后 provider 报告 S 不可恢复
- **THEN** 原 run 显示「原执行已经无法继续」并保留退出前累计耗时
- **AND** 本轮只有一次 resume S，用户点击「重新运行」也不得触发 full 或 replacement session。

## Requirement: 正常退出先持久化恢复意图
Source: docs/product/pages/agent-conversation.md#重试与恢复

系统 MUST 在正常退出终止已建立外部执行会话的 active run 前持久化 graceful resume intent 与暂停生命周期事实，并停止领取新消息。只有持久化成功的 run 才可在下次启动自动恢复；精确恢复 MUST 复用原 Moebius run、步骤与 attempt，新执行段继续累计原耗时且关闭期间不计时。无法写入 intent 时 MUST 保留可见终态或由 orphan stuck 收敛。

### Scenario: 正常退出正在执行的 run
- GIVEN 活动 run 已收到 thread.started
- WHEN 用户正常退出应用
- THEN session JSONL 先出现 graceful resume intent，再终止 Codex
- AND 下次启动复用原 run 与 attempt 自动恢复该执行
- AND 暂停期间不计入耗时

## Requirement: 恢复执行段与缓存用量可诊断
Source: docs/product/pages/agent-conversation.md#重试与恢复

系统 MUST 为同一 run 的暂停与恢复追加独立执行段事实，并把 first/resume/unavailable
选择、原因及 provider 返回的可用缓存用量写入 session 诊断事实。用户点击「重新运行」
后创建的新 run MUST 独立记录，但所属持久 Agent identity 已有 canonical external id 时
仍 MUST resume 该 id。系统 MUST NOT 在普通对话 state DTO 中展示 external id 或 token
cache 指标。

provider 首次报告 external id 后，canonical link 的持久化是提交成功 Agent 回复和推进
公开时间线 cursor 的前置条件。写漏斗在同步重试后仍不可用时，当前 invocation MUST
fail closed，不得提交成功回复；后续若存在 provider-session creation evidence 但缺失
稳定 id，planner MUST 返回 unavailable 且 provider 调用次数为零。

### Scenario: resume 完成并返回 cache 用量

- **GIVEN** Codex 或 Kimi resume 成功并返回可用缓存指标
- **WHEN** 运行完成
- **THEN** session 事实可关联原 run 的新执行段、同一 canonical external id 和缓存指标
- **AND** 普通对话 API 不新增 external id 或 token cache 字段。

### Scenario: thread 关联持久化暂时失败

- **GIVEN** provider 已发出合法且不冲突的 external id S
- **AND** session fact 写漏斗在同步重试后仍不可用
- **WHEN** 当前 Agent invocation 尝试继续
- **THEN** run 明确失败，成功 Agent 回复与公开时间线 cursor 均不提交
- **AND** 系统不得仅把 S 留在进程内后继续成功
- **AND** 后续 planner 在 creation evidence 已存在但稳定 link 缺失时返回 unavailable，provider 调用次数为零。

## Requirement: 每个 Agent 后续只接收未见公开时间线增量

Source: docs/product/pages/main-conversation.md#agent-执行与恢复

Agent 身份首次创建时 MUST 接收当时完整共享时间线；后续 resume MUST 只接收其公开
时间线 cursor 之后、且不是该 Agent 自己已经形成的公开回复，以及这些消息对应的附件。
Agent 回复成功成为公开事实后才可推进 cursor；provider 失败、输出无效或回复未持久化
时 MUST NOT 推进。

### Scenario: A 返回时看到 B 的回复但不重复完整历史

- **GIVEN** A 的 provider session 已包含首次完整时间线
- **AND** A 离开期间 B 形成一条公开回复
- **WHEN** A 再次运行
- **THEN** resume prompt 包含 B 的新回复与本轮触发消息
- **AND** 不重复注入 A cursor 之前的完整历史。

### Scenario: 失败不吞掉增量

- **GIVEN** A 的 resume prompt 包含 cursor 之后的两条公开消息
- **WHEN** provider 失败且没有 Agent 回复落库
- **THEN** A 的 cursor 保持不变
- **AND** 用户显式重试仍 resume 同一 ID 并重新选择这两条未确认消息。

## Requirement: local provider invocation 可审计但不进入 renderer

Source: docs/product/prd.md#desktop-持久-agent-的执行会话连续性

每次 local provider invocation MUST 以内部事实或 manifest 记录 mode、requested /
observed ID 一致性与 outcome，使测试可直接断言调用次数和无 fallback。记录 MUST NOT
包含 prompt、provider 密钥或 token，external ID MUST NOT 进入 renderer DTO 或普通
用户文案。

### Scenario: resume 失败审计

- **GIVEN** 一次 Kimi resume 返回 Session not found
- **WHEN** run 收敛为 unavailable
- **THEN** 内部记录恰有一条 `mode=resume`
- **AND** 不存在同 run 的 `mode=full` 或 `session/new`
- **AND** renderer 只收到安全失败文案和动作。

## Requirement: 过程读取唯一定位 Codex rollout，缺失时不伪造降级
Source: docs/product/pages/main-right-sidebar.md#codex-过程记录可能不可用

系统 MUST 依据 session fact 中的 threadId 在当前 Codex sessions 根内唯一定位对应 rollout JSONL，并校验真实路径仍位于受信任根；关联缺失，或候选为零个、多个、损坏、越界、不可读时，MUST 返回结构化 unavailable。系统 MUST NOT 从 Moebius runDir / tmp 恢复关联，也不得使用 stdout / stderr tail、最终 Agent 回复、重组 prompt 或按时间 / role 猜测的其他文件冒充调试调用链。

### Scenario: rollout 已被删除
- GIVEN run-thread link 仍存在但对应 Codex rollout 文件已被删除
- WHEN 客户端请求该步骤过程或 prompt stack
- THEN 接口返回 unavailable
- AND 响应不包含 stdout tail、最终 Agent 回复或重组 prompt fallback

## Requirement: 本轮调试输入直接读取 Codex rollout
Source: docs/product/pages/main-right-sidebar.md#过程标签

系统 MUST 依据每个 attempt 的稳定 run-thread 关联，从受信任 Codex sessions 根内的唯一 rollout 读取 `session_meta.base_instructions`、有序 developer messages、实际 user messages、turn context 与 session metadata。系统 MUST 分层返回 `SYSTEM_PROMPT`、`DEVELOPER_PROMPT`、`USER_INPUT` 及实际 model / effort / provider / CLI / cwd / run / thread 元数据，MUST NOT 根据当前 Agent persona、当前团队、当前时间线或当前执行配置重组历史值。某一层未记录时 MUST 只把该层标为未记录。

### Scenario: 历史 run 的 prompt stack 与当前配置不同
- GIVEN 一个历史 Codex run 的 rollout 记录了 system、developer、user 三层 prompt 和模型 `model-a`
- AND 当前团队 persona 与模型已经改成另一组值
- WHEN 客户端请求该 attempt 的调试 invocation
- THEN 响应返回 rollout 中的三层原文与 `model-a`
- AND 响应不包含用当前配置重组的替代 prompt

### Scenario: developer 层未记录
- GIVEN rollout 有 system 与 user 层但没有 developer message
- WHEN 客户端请求调试 invocation
- THEN developer 层状态为未记录
- AND system 与 user 层仍返回自己的原文

## Requirement: rollout 调试投影保留未脱敏调用与输出
Source: docs/product/pages/main-right-sidebar.md#过程标签

系统 MUST 按顺序投影 Agent 原始输出、命令、函数、custom tool、tool search、MCP、文件、错误、诊断与生命周期事件，并保留原始协议类型、ISO 时间戳、call id、name、status、参数、结果、绝对路径、内部标识和已确认范围内的 raw payload。系统 MUST NOT 对路径或 session / run / thread / message / call id 做脱敏、摘要或头尾截断。

### Scenario: 工具事件含绝对路径与内部标识
- GIVEN rollout 工具参数包含绝对路径 `/Users/person/project/file.ts` 与 `runId=debug-marker`
- WHEN 过程 API 投影该事件
- THEN 响应保留完整绝对路径和 `runId=debug-marker`
- AND 响应未对该路径或内部标识做省略、头尾截断或任何占位替换

### Scenario: 未识别的新事件保留调试线索
- GIVEN rollout 包含一个未识别的新事件
- WHEN 过程 API 投影该记录
- THEN 新事件返回原始协议类型与可展开 raw payload
- AND 不以无信息占位静默吞掉该事件

## Requirement: token 统计可调试且 reasoning 保持过滤
Source: docs/product/pages/main-right-sidebar.md#过程标签

系统 MUST 将 Codex rollout 的 `token_count` / usage 记录投影为独立调试事件，并保留原始协议类型、时间戳以及 input、cached input、output、reasoning output、total 等实际存在的统计字段。系统 MUST 显式过滤 `reasoning`、`agent_reasoning` 与 encrypted reasoning payload，未知事件 fallback MUST NOT 绕过该过滤边界。

### Scenario: 同一 turn 同时含 token 与 reasoning
- GIVEN rollout 同时包含 token usage、reasoning 文本与 encrypted reasoning payload
- WHEN 过程 API 投影该 turn
- THEN 响应包含 token 统计事件及原始 usage 字段
- AND 响应不包含 reasoning 文本或 encrypted payload

## Requirement: attempt 元数据使用真实运行事实
Source: docs/product/pages/main-right-sidebar.md#过程标签

系统 MUST 为每个 attempt 返回 engine、实际 model / effort / provider / CLI、runId、threadId、开始时间、完成时间、耗时和完整 Moebius run status。实际模型信息优先来自该 rollout；rollout 缺字段时 MAY 使用同一 run 的 immutable execution context 并标明来源，MUST NOT 使用当前团队配置。running、completed、failed、interrupted、stuck 与 paused MUST NOT 被压扁成无法调试的单一 `settled`。

### Scenario: 失败后重试使用不同模型
- GIVEN 同一步第 1 次执行以 `model-a` failed，第 2 次执行以 `model-b` completed
- WHEN 客户端读取过程历史
- THEN 两个 attempts 分别显示自己的模型、开始 / 完成时间和 failed / completed
- AND 后一次元数据不覆盖前一次

## Requirement: prompt stack 按 attempt 惰性完整读取
Source: docs/product/pages/main-right-sidebar.md#响应式与窗口行为

系统 MUST 为 `sessionId + runId` 提供窄的 prompt stack 读取能力，并复用 rollout 真实路径、设备 / inode 身份和受信任根校验。该读取 MUST 返回完整层内容或稳定的 unavailable / malformed 结果；单个完整 prompt record 超过常规过程页字节预算时 MUST 允许其独占响应，MUST NOT 返回静默截断的半段 prompt。过程事件继续使用反向分页与 append cursor，MUST NOT 在每一页重复携带完整 prompt stack。

### Scenario: 大 prompt 超过常规过程页预算
- GIVEN 一个 prompt record 超过常规过程事件页的字节预算
- WHEN 客户端展开该层
- THEN 接口以单条完整 record 返回该层首尾全文
- AND 同 attempt 的分页事件仍可读取

### Scenario: rollout 在读取期间被替换
- GIVEN prompt 读取开始后 rollout 的设备或 inode 发生变化
- WHEN 服务端完成身份校验
- THEN 接口返回稳定 unavailable / cursor-invalid
- AND 不把两个文件的内容拼成一个 prompt stack

## Requirement: 过程 API 跨 attempts 反向分页且不截断全程
Source: docs/product/pages/main-right-sidebar.md#响应式与窗口行为

系统 MUST 以请求 run 所属的源公开消息为步骤键，从只追加 run-thread link facts 恢复该步骤的全部 attempts；系统 MUST 以不透明游标从最新 attempt 末尾反向分页，并在页内按时间正序返回，且不得改变既有 `runOutput(sessionId, runId)` 返回单一 run 尾部诊断的语义。游标 MUST 能跨 attempt 边界，活动文件 MUST 支持从 append cursor 读取新增完整行。每页 MAY 有事件数与字节数上限；单个完整事件超过字节上限时 MUST 允许其独占一页且不得截断事件字段，系统 MUST NOT 因单页边界截断整段历史。尾部半行 MUST 等待后续追加而不得误报 malformed。

### Scenario: 大记录跨三页读取到开头
- GIVEN 一个步骤包含两个 attempts 且投影事件超过三页
- WHEN 客户端从初始页连续请求 previous cursor 直到为空
- THEN 合并后的事件从第一次执行的公开输入到第二次执行的最终事件完整且无重复
- AND 初始页来自最新 attempt 的末尾

## Requirement: 累计改动清单沿用对话基线并包含增删行数
Source: docs/product/pages/main-right-sidebar.md#改动标签

系统 MUST 以会话 `baselineCommit` 为起点，为直接项目文件夹与独立工作空间返回口径一致的累计改动文件清单、每文件新增行数和删除行数，并保留既有 `fileCount` 语义。系统 MUST NOT 从当前 HEAD 重新推导基线，也 MUST NOT 把非 Git 项目返回为可用的零改动。

### Scenario: 两种工作空间读取累计清单
- GIVEN 直接工作空间与独立工作空间会话都在各自对话基线后产生已提交及未提交改动
- WHEN 客户端通过各自 session-scoped HTTP 路由读取改动
- THEN 两个响应都只包含各自工作空间相对对话基线的改动文件、增删行数与匹配的 fileCount

## Requirement: 验收 #8 选中文件返回逐行变化事实
Source: docs/product/pages/main-right-sidebar.md#改动标签

系统 MUST 把所选改动文件的 unified diff 解析为新增、删除、未改动行及其旧新行号；未跟踪文本文件 MUST 作为逐行新增返回。系统 MUST NOT 把 diff patch 原文交给 renderer 自行猜测，也 MUST NOT 省略未改动上下文。

### Scenario: 读取含增删的文本文件
- GIVEN 文件相对对话基线包含一行删除、一行新增与未改动上下文
- WHEN 客户端请求该文件内容
- THEN 响应按顺序包含 `deletion`、`addition`、`unchanged` 行及可用的旧新行号

## Requirement: 验收 #9 改动清单与项目文件树分开读取
Source: docs/product/pages/main-right-sidebar.md#项目文件标签

系统 MUST 让改动路由仅返回改动文件，并让项目文件路由返回当前工作空间中除 Git 内部元数据外的完整文件树；项目文件条目 MUST 标明是否存在累计改动。系统 MUST NOT 把未改动文件混入改动清单。

### Scenario: 项目同时存在改动与未改动文件
- GIVEN 当前工作空间包含一个改动文件和一个未改动文件
- WHEN 客户端分别读取累计改动和项目文件树
- THEN 改动响应只有改动文件，项目文件响应包含两个文件且分别标明 changed 真值

## Requirement: 项目当前源码与会话累计 diff 分开读取
Source: docs/product/pages/main-right-sidebar.md#项目文件标签

local console MUST 为项目当前文件和会话累计 diff 提供不同的只读查询契约。项目文件查询成功时 MUST 返回完整当前 UTF-8 文本与单一当前行模型，MUST NOT 因文件相对基线有改动而返回 diff。累计 diff 查询 MUST 继续返回相对会话基线的新增、删除、上下文和旧 / 新行号。

### Scenario: 已改动文件读取当前源码
- GIVEN 会话工作空间中的 `src/a.ts` 相对基线有一行删除和两行新增
- WHEN 请求项目当前文件
- THEN 响应包含当前文件的完整文本
- AND 不包含已删除行或 diff line kind
- WHEN 请求该文件的累计 diff
- THEN 响应包含一行删除、两行新增及其旧 / 新行号

## Requirement: 项目文件读取失败返回可显示原因
Source: docs/product/pages/main-right-sidebar.md#选择文件

项目文件查询 MUST 对超出大小上限、非文本、缺失、非普通文件、越出工作空间和工作空间不可用分别返回稳定原因与空行数组。系统 MUST NOT 静默返回空白内容，也 MUST NOT 通过项目文件相对路径、符号链接或路径穿越把外部文件升级为完整项目文件；正文文件引用的外部目标按下文 `external-preview` 契约处理。

### Scenario: 请求二进制与越界文件
- GIVEN 当前项目包含一个二进制文件且请求还包含一个 `../` 越界路径
- WHEN 客户端读取两个路径
- THEN 响应分别返回 `binary-file` 与 `outside-workspace`，且都不包含文件内容

## Requirement: 项目文件、文件引用与改动读取通道保持只读
Source: docs/product/pages/main-right-sidebar.md#弹层与危险操作

系统 MUST 只通过 GET 路由提供改动清单、项目树、项目当前源码、文件引用和累计 diff。每次文件引用请求 MUST 根据当前 session workspace 和 canonical 目标重新分类，MUST NOT 信任 renderer 传回的旧作用域。系统 MUST NOT 因任何读取请求修改文件、索引、会话或 git 状态，也 MUST NOT 执行还原、暂存、提交、推送、切分支或创建分支。

### Scenario: 连续读取同一文件
- GIVEN 工作空间中的文件已有确定内容与 Git 状态
- WHEN 客户端连续请求项目树和同一文件内容
- THEN 两次读取后文件字节与 Git 状态保持不变

## Requirement: 会话只投影 effective 团队的最小可见成员身份

Source: `docs/product/pages/main-conversation.md#上下文`

local-console state 与 session view MUST 从目标会话自己的 effective 团队快照投影有序成员 slug 与可读显示名，供展示层把 message / run role 映射为真实成员身份。投影 MUST NOT 包含 `AGENT.md` 正文、persona、职责、协作规则或其他 prompt 内容；单个成员的显示名缺失或无法解析时 MUST 有限降级，MUST NOT 让整段会话状态读取失败。团队目录后续修改、删除或需修复 MUST NOT 改变已持久化会话快照的历史身份投影。读取和投影 MUST NOT 重写会话 JSONL、effective snapshot 或既有 message / run role。

### Scenario: 自定义团队返回最小身份

- GIVEN 会话 effective 快照含 `plan-supervisor` 与 `plan-executor`，两者 frontmatter 各有不同显示名
- WHEN 客户端读取主 state 或该会话 view
- THEN 响应按快照顺序返回两个 slug 及对应显示名
- AND 响应不包含任一成员的 Markdown 正文或职责规则

### Scenario: 团队目录删除后历史身份仍可读

- GIVEN 会话已持久化有效团队快照
- WHEN 对应磁盘团队之后被删除且客户端读取历史会话
- THEN 历史成员身份仍从会话快照投影
- AND 会话能否继续仍服从既有团队健康门禁

### Scenario: 子会话身份不跟随父会话改选

- GIVEN 子会话已继承并持久化团队 A 的 effective 快照
- WHEN 父会话之后改选团队 B
- THEN 子会话 view 仍投影团队 A 的成员身份
- AND 不使用父会话当前团队或磁盘团队列表覆盖子会话历史身份

### Scenario: 存量会话只读投影没有持久化副作用

- GIVEN 存量会话的 JSONL、effective snapshot 与既有 message role 已持久化
- WHEN 客户端读取 state 或 session view 并据此显示成员名称
- THEN JSONL 内容、effective snapshot 与既有 message / run role 保持逐项不变
- AND 系统不需要迁移、回填或重写该会话

## Agent 执行配置与执行引擎

> Product anchors: `docs/product/pages/main-conversation.md#选择工作空间与团队` and
> `docs/product/pages/main-conversation.md#Agent-执行与恢复`. Onboarding, invalid-profile
> creation/switch gating and right-sidebar process projection remain outside this section.

### Requirement: Session team snapshot freezes each member execution profile

Source: docs/product/pages/main-conversation.md#选择工作空间与团队

New, explicitly switched and explicitly applied team snapshots MUST persist every member's effective `codex | claude | kimi` CLI, model and effort together with complete team identity, ordered member identity and Agent Markdown. Later team-page changes MUST NOT change the effective snapshot until a new conversation, an explicit switch, or an explicit full-team apply reaches its activation boundary. Legacy rows without a profile MUST preserve one legacy Codex identity, MUST NOT be populated from current team state and MUST NOT switch provider.

The schema migration MUST preserve effective and pending rows, member order, all existing profile values, NULL legacy profiles, keys and foreign keys transactionally and idempotently.

#### Scenario: Applied profile starts only new work

- **GIVEN** an old step used Kimi/K/high and the current team saves Codex/C/medium
- **WHEN** the user applies the complete current team version
- **THEN** a newly submitted ordinary message uses Codex/C/medium
- **AND** retry, rerun or resume of the old step still uses Kimi/K/high from its run context.

#### Scenario: Existing pending switch survives migration

- **GIVEN** a pre-migration session has effective team A and pending team B rows with mixed profile values
- **WHEN** schema initialization runs twice
- **THEN** both complete member sets, order and profiles are unchanged
- **AND** B retains switch semantics until the old A generation settles.

### Requirement: Local Agent run is hard-routed to the snapshotted engine

Source: docs/product/pages/main-conversation.md#Agent-执行与恢复

The local console MUST select Codex, Claude or Kimi from the immutable member/run snapshot and MUST
pass that snapshot's model and effort to full and resume. Missing executable, unsupported version,
invalid configuration, authentication, permission or driver failure MUST become an explicit failed
attempt. The system MUST NOT invoke another CLI as fallback.

For Kimi and Claude, executable discovery MUST preserve host `PATH` order and make the first existing
candidate authoritative. Only when PATH contains no candidate MAY Kimi inspect
`~/.kimi-code/bin/kimi` and Claude inspect `~/.local/bin/claude`. The selected candidate MUST be an
executable regular file and MUST be spawned by absolute path with `shell:false`. An existing invalid
authoritative candidate MUST fail rather than selecting another version. Spawn success MUST be
observed within a bounded interval before protocol input is sent.

Every Claude full/resume MUST run a bounded `--version` check against that same resolved absolute
path before print-mode/session side effects. A version below `2.1.170` MUST fail with a stable
unsupported-version reason and trusted update action. It MUST NOT invoke `-p`, create or modify an
external session link, or call Codex/Kimi.

Failures MUST retain stable engine-specific safe reasons. Raw paths, OS errors, stderr and provider
payloads MUST remain outside the normal timeline.

Kimi `session/prompt` 返回 `end_turn` 时，系统 MUST 只在当前 turn 已观察到非空
`agent_message_chunk` 文本、兼容的非空 prompt result text，或至少一个
`tool_call|tool_call_update` 到达 `completed|failed` 时判定输出有效。Whitespace 文本、
thinking、plan、usage、config、available commands、pending/in-progress 工具和裸
`end_turn` MUST NOT 单独构成成功。

无有效证据的裸 `end_turn` MUST 返回稳定 `kimi-empty-response` failed attempt，显示安全
Kimi 空响应说明，引导用户在终端直接运行 `kimi` 查看 CLI 自己的详细错误，并允许用户
重试。该引导 MUST 只提供自查动作，不断言额度、认证、模型、网络等具体成因。系统
MUST NOT 提交空白 Agent 回复、调用另一 CLI、按 prompt 文义放行“无需回答”，或从
wire/stderr/provider payload 推断具体成因。原始诊断 MUST 只留在 bounded 本地日志。

#### Scenario: Bound Claude is missing

- **GIVEN** the selected member snapshot is bound to Claude
- **AND** the Claude executable cannot be started
- **WHEN** the member run begins
- **THEN** the run fails with a safe Claude-specific reason
- **AND** Codex and Kimi drivers are never called.

#### Scenario: Claude official default location is used only after PATH

- **GIVEN** PATH contains no `claude`
- **AND** host `~/.local/bin/claude` is an executable regular file
- **WHEN** a Claude-bound run begins
- **THEN** runtime spawns that absolute path without a shell
- **AND** writes no prompt before spawn succeeds.

#### Scenario: Bound Kimi is missing

- **GIVEN** the selected member snapshot is bound to Kimi
- **AND** the Kimi executable cannot be started
- **WHEN** the member run begins
- **THEN** the run fails with a safe Kimi-specific reason
- **AND** the Codex driver is never called.

#### Scenario: Kimi is installed only at its default location

- **GIVEN** `PATH` contains no `kimi`
- **AND** the host user's `~/.kimi-code/bin/kimi` is an executable regular file
- **WHEN** a Kimi-bound run begins
- **THEN** the runtime spawns that absolute path without a shell
- **AND** it writes ACP `initialize` only after spawn succeeds.

#### Scenario: PATH candidate takes precedence

- **GIVEN** `PATH` contains a Kimi candidate
- **AND** the default Kimi location also exists
- **WHEN** a Kimi-bound run begins
- **THEN** the first existing `PATH` candidate is authoritative
- **AND** the default location is not started.

#### Scenario: Kimi startup failure remains actionable

- **GIVEN** a run is bound to Kimi
- **WHEN** Kimi is invalid, rejected by spawn, exits after spawn or times out in ACP
- **THEN** the run records the matching stable safe reason
- **AND** raw machine details do not appear in the normal timeline
- **AND** the Codex driver is never called.

#### Scenario: 额度错误被 ACP 折叠为空 end_turn

- **GIVEN** Kimi provider 请求没有产生 Agent text 或终态工具结果
- **AND** ACP adapter 仍返回 `stopReason=end_turn`
- **WHEN** Moebius 完成本轮输出校验
- **THEN** result reason 与 failure code 都是 `kimi-empty-response`
- **AND** run 显示「这一步没跑起来」而不是 completed 或空白 Agent 消息
- **AND** 普通时间线不声称额度、认证、模型或网络是成因。

#### Scenario: 无文本但工具已经终止

- **GIVEN** Kimi 没有产生非空 Agent text
- **AND** 至少一个 ACP tool call 到达 status `completed` 或 `failed`
- **WHEN** prompt 返回 `end_turn`
- **THEN** 本轮可作为合法无文本结果成功收口
- **AND** run 完成并推进 Agent timeline cursor，但不提交空白 Agent response 或触发文本 handoff
- **AND** pending/in-progress 工具、thinking 或 plan 单独出现时仍不得成功。

#### Scenario: 用户提示词要求无需回答

- **GIVEN** prompt 自然语言包含“无需回答”或等价表达
- **AND** ACP turn 没有非空 Agent text 或终态工具结果
- **WHEN** prompt 返回裸 `end_turn`
- **THEN** 系统仍返回 `kimi-empty-response`
- **AND** 不从 prompt 文义推断 intentional silence。

### Requirement: Kimi 空响应失败使用稳定安全诊断

Source: docs/product/pages/agent-conversation.md#异常终态

系统 MUST 将内部 `KIMI_EMPTY_RESPONSE` 归一为稳定
`reason/failure.code = kimi-empty-response` 与安全、可操作的 Kimi 说明及终端
`kimi` 自查引导。renderer DTO MUST NOT 包含 provider HTTP 状态、绝对路径、session
id、wire、stderr 或原始 payload。
本地诊断 MAY 记录 bounded stopReason、证据计数和内部错误码，但 MUST NOT 成为普通
时间线或过程读取 fallback。

#### Scenario: 空响应诊断留在本机

- **GIVEN** Kimi 空响应包含仅在本机日志可见的 provider 诊断
- **WHEN** API 与页面呈现 failed attempt
- **THEN** 页面只显示稳定 Kimi 空响应说明、终端 `kimi` 自查引导和重试动作
- **AND** 原始诊断不进入消息正文、错误描述或 process-trace fallback。

### Requirement: Moebius 角色运行禁用 CLI 内部 Agent 工具

Source: docs/product/pages/main-conversation.md#Agent-执行与恢复

Codex full/resume MUST continue using `agents.enabled=false`. Claude full/resume MUST pass deny
rules for `Agent`, legacy `Task`, `AskUserQuestion`, `TeamCreate`, `TeamDelete`, `SendMessage`,
`TaskCreate`, `TaskGet`, `TaskList`, `TaskUpdate`, `TaskOutput` and `TaskStop`; MUST delete
`CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS`, `CLAUDE_AUTO_BACKGROUND_TASKS` and
`CLAUDE_CODE_FORWARD_SUBAGENT_TEXT`; MUST set `CLAUDE_CODE_DISABLE_BACKGROUND_TASKS=1`; and MUST NOT
pass `--forward-subagent-text`. The observed init tool inventory MUST contain none of those
Agent/team tools or the run MUST fail before accepting any visible assistant/tool event. Moebius
MUST NOT allow an individual role run to create hidden internal delegates; role handoff MUST remain
visible on the Moebius public timeline. Kimi behavior MUST remain unchanged.

#### Scenario: Claude cannot create an internal delegate

- **GIVEN** a Claude-bound Moebius Agent needs full or resume
- **WHEN** the adapter constructs the invocation
- **THEN** required subagent/team features are disabled and Agent is disallowed
- **AND** a role handoff occurs only after a visible Moebius reply names a legal team member.

### Requirement: Messages snapshot then directly start the bound engine

Source: docs/product/pages/main-conversation.md#选择工作空间与团队
Source: docs/product/pages/main-conversation.md#Agent-执行与恢复

The first-message transaction MUST persist the session, user message, ordered attachments and complete team snapshot before starting the primary Agent. Every newly created run MUST append its immutable team/profile/workspace execution context before executable resolution, version validation, authentication or spawn. First messages, later messages, handoffs and ordinary new work MUST use the currently effective snapshot; retry, rerun, resume and single-run override MUST use the historical run context selected by their existing contract. No driver may fall back to another CLI.

#### Scenario: Team-page edit waits for explicit boundary

- **GIVEN** session A uses Kimi/K/high and the team page saves Codex/C/medium
- **WHEN** session A sends an ordinary message before applying the update
- **THEN** it still uses Kimi/K/high
- **WHEN** the complete update is applied and a later ordinary message is submitted
- **THEN** that message uses Codex/C/medium
- **AND** retrying the pre-apply step still uses Kimi/K/high.

#### Scenario: Configuration fails before process start

- **GIVEN** a new run binds a complete team snapshot and profile
- **WHEN** executable or configuration validation fails before external process start
- **THEN** the run execution context remains persisted
- **AND** no external-start fact exists
- **AND** the failure does not rewrite the session snapshot or profile.

#### Scenario: Installed Codex is too old for the selected model

- **GIVEN** a session snapshot binds its primary Agent to a Codex model
- **AND** Codex starts a canonical thread but emits a structured error that the model requires a
  newer Codex version
- **WHEN** the first run fails
- **THEN** the run records the stable `codex-cli-upgrade-required` failure code
- **AND** the visible failed-attempt fact identifies the selected model and tells the user to
  upgrade the current Codex installation
- **AND** the raw provider payload is not copied into the normal timeline
- **AND** retry resumes the same canonical Codex thread with the same immutable run snapshot
- **AND** no alternate CLI or replacement Codex thread is started.

#### Scenario: Later messages do not repeat capability preflight

- **GIVEN** a session snapshot binds its primary Agent to Kimi/model K/effort high
- **AND** the first message has already completed
- **WHEN** the user sends a second and a third message
- **THEN** each message starts one new Kimi run with K/high
- **AND** no capability probe or Codex driver is called.

#### Scenario: Team-page edits affect only new sessions

- **GIVEN** session A snapshots its primary Agent with Kimi/model K/effort high
- **WHEN** the team page changes the same team/member to Codex/model C/effort medium
- **AND** session A sends a later message or retries an existing run
- **THEN** those actions still use their immutable Kimi/K/high snapshots
- **AND** a newly created session B snapshots and uses Codex/C/medium
- **AND** neither session invokes the other CLI as fallback.

### Requirement: Execution session links are engine and profile specific

Source: docs/product/pages/main-conversation.md#agent-执行与恢复

The system MUST freeze each run's original team content, role, engine, profile and workspace as an
immutable run execution context. A persistent local Agent identity MUST be
`session + teamSnapshotFingerprint + role`; switching to another team snapshot creates another
identity even when the role slug is unchanged.

Each Agent identity MUST own at most one canonical Codex thread, Claude session or Kimi session.
External links MUST bind session, team snapshot, role, workspace, persona, engine, profile fingerprint
and external id. A run link MAY continue to identify process output, but MUST NOT be the only source
of provider-session continuity.

Full MAY create identity only when none is bound. Once matching engine protocol evidence reveals an
id, it MUST be persisted even if the turn later fails. All later messages, handoffs back, retries,
reruns and restart recovery MUST resume that exact id.

Resume MUST validate the entire immutable identity and the provider-observed id. Missing, conflicting,
non-unique or incompatible links, provider session absence or resume failure MUST perform only that
resume attempt and enter “原执行已经无法继续”. The system MUST NOT clear the id, choose a recent
session, rebuild from history, issue a second full/session-new call or cross CLI.

Existing Codex thread links MUST remain readable as legacy facts. Legacy links filtered to the
current identity MAY migrate only when their normalized external ids contain exactly one value.
Historical execution evidence with no candidate, or two different candidates, MUST fail closed;
the system MUST NOT choose by time or success status.

#### Scenario: Same Agent continues after an ordinary later message

- **GIVEN** a local Agent identity completed its first run with external id S
- **WHEN** that identity receives a later ordinary message
- **THEN** the planner returns resume S
- **AND** it does not return first or full fallback.

#### Scenario: Old run is retried after a team switch

- **GIVEN** an unfinished run belongs to an old Kimi-bound team snapshot and links to session S
- **AND** the local conversation later switches to a Codex-bound team snapshot
- **WHEN** the old run is explicitly recovered
- **THEN** the old identity may resume only Kimi session S
- **AND** an unavailable S fails closed without calling Codex or creating a Kimi session
- **AND** a new run under the new snapshot is a distinct Agent identity.

#### Scenario: Provider id is observed before a later failure

- **GIVEN** a first Codex or Kimi invocation reports external id S
- **WHEN** prompt processing, output validation or reply persistence later fails
- **THEN** the session JSONL already contains the canonical link to S
- **AND** the next attempt resumes S.

#### Scenario: Legacy links normalize to one id

- **GIVEN** one legacy Agent identity has several run links that all name external id S
- **WHEN** the new planner resolves that identity
- **THEN** it appends one idempotent canonical migration fact
- **AND** the invocation resumes S.

#### Scenario: Legacy links conflict

- **GIVEN** one legacy Agent identity has historical execution evidence naming two external ids
- **WHEN** the new planner resolves that identity
- **THEN** it returns unavailable
- **AND** the provider invocation count is zero.

#### Scenario: Resume target no longer exists

- **GIVEN** an Agent identity has canonical external id S
- **WHEN** Codex or Kimi reports that S cannot be resumed
- **THEN** the run contains exactly one resume invocation
- **AND** the timeline shows `原执行已经无法继续`
- **AND** the explanation is `你可以重新运行，或直接说话、换一个成员接手。`
- **AND** no full or `session/new` invocation follows.

#### Scenario: Claude returns a different resume id

- **GIVEN** an Agent identity is linked to Claude session S
- **WHEN** resume reports session T
- **THEN** the attempt fails closed after exactly one resume
- **AND** S remains the canonical link
- **AND** no full, Codex or Kimi invocation follows.

### Requirement: Claude local execution uses bounded headless stream-json

Source: docs/product/pages/main-conversation.md#Agent-执行与恢复

For full, the Claude driver MUST generate a UUID S and invoke headless print mode with stream-json,
verbose output, `--include-partial-messages`, frozen model/effort, `--permission-mode auto`,
bounded internal-agent deny rules and `--session-id S`. For resume it MUST invoke `--resume S` with
the same immutable profile, cwd and policy. It MUST delete
`CLAUDE_CODE_EFFORT_LEVEL` so the frozen CLI effort cannot be overridden. It MUST NOT use
`--continue`, interactive session selection, filesystem time or “most recent” lookup.

The driver MUST parse JSONL with per-line and total bounds. It MUST observe a `system/init` session id
equal to S before persisting the canonical link or publishing success. Any observed terminal session
id MUST also equal S. Missing init id, conflicting ids, malformed/oversized protocol, unsupported
required permission controls or profile rejection MUST fail closed. Matching init is sufficient to
bind S even if the turn later fails.

The driver MUST derive incremental Markdown only from `stream_event` records whose nested event is
`content_block_delta` and delta is `text_delta`, appending the nested text in order. Thinking, tool
events, protocol metadata and records with `parent_tool_use_id` MUST NOT enter the public timeline.
Raw JSONL/stdout/stderr MUST remain in bounded local diagnostics and MUST NOT appear in renderer DTOs
or the public timeline.

Ordinary-Agent full/resume MUST leave native Claude configuration outside Moebius control. Moebius MUST NOT pass
`--safe-mode`, `--setting-sources`, `--strict-mcp-config`, `--disable-slash-commands` or `--tools`,
MUST NOT create replacement settings, and MUST NOT locate, read, parse, copy, transform or manage
user/project Claude configuration. Which CLAUDE.md, settings, hooks, MCP, skills, plugins, commands
or custom agents Claude itself loads is outside Moebius implementation and acceptance scope. The
common internal-Agent deny and environment boundary MUST remain enforced. AI-team-builder isolation
is a separate desktop execution profile and does not alter this ordinary-Agent behavior.

All attachments MUST first use the managed run copy and ordered manifest. Claude MUST receive only
managed paths and MAY use its Read capability for supported images and ordinary files. Managed-copy,
permission or attachment-read failure MUST fail the Claude attempt and MUST NOT invoke another CLI.

Cancellation MUST be idempotent and settle in finite time through the necessary prefix of
SIGINT → SIGTERM → SIGKILL. Idle and max-duration watchdogs MUST terminate the same bounded process.
Missing/non-executable, unsupported version, auth-required, invalid model/effort, permission denial,
rate-limit/billing/service, resume-unavailable/id-mismatch, malformed protocol, nonzero exit and
timeout MUST map to stable safe failures without exposing raw machine details.

#### Scenario: Specific Claude session resumes

- **GIVEN** an Agent identity has canonical Claude session S and frozen sonnet/high
- **WHEN** the next turn runs
- **THEN** invocation contains `--resume S`, sonnet and high
- **AND** matching init/result ids continue S
- **AND** no `--session-id`, `--continue`, Codex or Kimi invocation occurs.

#### Scenario: Old Claude is rejected before session creation

- **GIVEN** the authoritative Claude executable reports `2.1.169`
- **WHEN** a Claude-bound full or resume starts
- **THEN** the driver reports stable unsupported-version with a trusted update action
- **AND** print-mode invocation count and external-session-link writes are zero
- **AND** Codex and Kimi invocation counts are zero.

#### Scenario: Ordinary Claude configuration is not managed by Moebius

- **GIVEN** an ordinary Claude-bound full or resume
- **WHEN** Moebius constructs and starts the invocation
- **THEN** argv contains none of the configuration-suppression flags
- **AND** replacement-settings writes and Claude-config locate/read/parse/copy calls are zero
- **AND** exact argv/env and init inventory still prove Agent/team tools unavailable.

#### Scenario: Partial stream produces visible Markdown

- **GIVEN** Claude emits a `stream_event/content_block_delta/text_delta` sequence
- **WHEN** the bounded parser consumes the JSONL
- **THEN** public Markdown grows in the same text order before the terminal result
- **AND** thinking, tool and protocol events remain private.

#### Scenario: Internal Agent capability fails closed

- **GIVEN** a fake Claude init advertises `Agent` or a team tool despite the required argv and env
- **WHEN** the adapter validates init
- **THEN** it fails before accepting a visible assistant/tool event and publishes no subagent text
- **AND** Codex and Kimi call counts remain zero.

#### Scenario: Matching init persists identity before later failure

- **GIVEN** a first Claude run uses generated UUID S
- **WHEN** matching system/init arrives and the process later exits nonzero
- **THEN** S is persisted immediately for that Agent identity
- **AND** the next explicit retry can only resume S.

#### Scenario: Claude receives image and ordinary file

- **GIVEN** a Claude-bound run has one supported image and one ordinary attachment
- **WHEN** the adapter starts Claude
- **THEN** both are represented by managed-copy manifest paths
- **AND** Claude Read can inspect each under the run policy
- **AND** no original user path or other CLI is used.

#### Scenario: Claude cancellation is finite

- **GIVEN** a spawned Claude process ignores SIGINT and SIGTERM
- **WHEN** the run is cancelled
- **THEN** runtime sends SIGINT, then SIGTERM, then SIGKILL at most once each
- **AND** the run settles within the final bound
- **AND** no orphan process or duplicate signal remains.

### Requirement: Kimi local execution uses a bounded ACP client

Source: docs/product/pages/main-conversation.md#Agent-执行与恢复

The Kimi driver MUST obtain a specific session id from ACP session/new. For ACP session/resume it
MUST send the requested canonical id, continue using that id when a successful response omits it,
and fail closed when a response reports a different id. Before prompt it MUST treat that response's
configOptions and the subsequent config_option_update/setting responses as authoritative, set the
snapshotted model and thinking effort, and verify that both effective values exactly match the
snapshot. Missing options, rejected settings, silent CLI fallback, unconfirmed effective values or
any mismatch MUST fail the attempt before prompt. Such a failure MUST NOT modify the snapshot,
silently substitute a value or invoke another driver.
After successful verification the driver MUST stream visible Agent Markdown and support cancellation.
Supported images MUST use ACP image blocks. Ordinary files MUST continue through the managed safe
copy and prompt manifest contract rather than being represented as native Kimi file attachments.
Attachment conversion or capability failure MUST fail the Kimi attempt and MUST NOT invoke Codex.
Reverse file requests MUST be restricted to trusted workspace and managed attachment roots.
Unknown/malformed/oversized protocol input and unresolved permission requests MUST fail closed.
The driver MUST NOT identify a session through `--continue`, filesystem time or “most recent”
selection.

#### Scenario: Specific Kimi session resumes

- **GIVEN** a recovery intent names Kimi session S
- **WHEN** the Kimi driver resumes
- **THEN** it sends ACP session/resume for S and applies the saved model/effort before prompt
- **AND** a successful response without a session id continues using S
- **AND** a response that reports an id other than S fails before prompt
- **AND** it does not inspect or continue any other recent session.

#### Scenario: Kimi falls back from the saved effort

- **GIVEN** a Kimi snapshot requires model M and effort high
- **AND** session/new configOptions expose the fields but the setting response confirms effort medium
- **WHEN** the driver validates the effective profile
- **THEN** it fails before sending session/prompt
- **AND** it does not call the Codex driver or persist medium as the member profile.

#### Scenario: Kimi receives an image and an ordinary file

- **GIVEN** a Kimi-bound run has one supported image and one ordinary managed attachment
- **WHEN** the driver builds session/prompt
- **THEN** the image is an ACP image block and the ordinary file is described by the safe manifest
- **AND** no Codex invocation is used to handle either attachment.

#### Scenario: Kimi file request escapes workspace

- **GIVEN** an ACP reverse request resolves outside all allowed roots
- **WHEN** the driver validates the request
- **THEN** it rejects the request without reading or writing the target
- **AND** the run settles with a safe diagnostic.

### Requirement: 文件引用按会话工作空间和 canonical 目标分流

Source: docs/product/pages/main-conversation.md#时间线

session-scoped 文件引用端点 MUST 只接受绝对 POSIX 文件路径、正整数 line 与可选正整数 column。runtime MUST 使用该会话锁定的实际工作空间，并在每次读取时解析工作空间和目标的 canonical 真实路径。真实目标位于真实工作空间内时 MUST 返回 `workspace-file`；真实目标位于外部时 MUST 返回 `external-preview`。判定 MUST 使用路径段安全的包含关系，MUST NOT 使用字符串前缀、目录白名单或 renderer 提供的作用域结论。

路径无法解析、目录、不存在、不可读、二进制或无效 UTF-8 MUST 返回结构化不可用结果，MUST NOT 回退读取相似路径。完成 `realpath` 后，可用响应以及后续 `line-too-large`、`response-too-large`、`line-not-found`、`scan-limit`、`binary-file`、`not-file` 或读取失败响应都 MUST 携带 canonical path 和已判定作用域；只有无法取得真实路径时保留输入路径和未知作用域。

`workspace-file` 成功响应 MUST 包含整个普通 UTF-8 文本、真实行号、canonical path、工作区相对路径和 `isComplete: true`。完整文件超过项目文件整文件预算时 MUST 返回 `file-too-large`，MUST NOT 返回部分内容或降级为 `external-preview`。

`external-preview` 成功响应 MUST 只包含目标行附近固定窗口、真实行号、目标行列、前后截断事实和 `isComplete: false`，并继续受既有扫描字节、单行字节和响应总字节硬上限约束。超过单行、扫描或响应上限 MUST 返回结构化不可用结果，MUST NOT 返回部分窗口或整份外部文件。

#### Scenario: `/tmp` 普通文本

- GIVEN `/tmp` 存在普通 UTF-8 文本文件且目标为第 12 行，该文件不在会话 workspace 或 Codex sessions root 内
- WHEN renderer 请求该文件引用
- THEN 响应为 `external-preview`，只包含第 12 行附近的有界窗口与真实行号
- AND 响应路径是该文件的 canonical path

#### Scenario: 符号链接指向工作空间外

- GIVEN workspace 内路径是一个符号链接，真实目标位于任意其他本机目录
- WHEN renderer 请求该链接
- THEN 响应为 `external-preview` 且不返回整个外部文件
- AND 响应路径是链接目标的 canonical path

#### Scenario: 外部别名指回工作区

- GIVEN 输入路径位于工作区路径外但真实目标位于工作区内
- WHEN renderer 请求该文件引用
- THEN 响应为 `workspace-file`
- AND 响应携带工作区相对路径和完整文本

#### Scenario: 相似字符串前缀不是工作区

- GIVEN 工作区为 `/work/app` 且目标为 `/work/application/a.ts`
- WHEN renderer 请求该目标
- THEN 目标按 `external-preview` 处理

#### Scenario: 工作区单行 JSON 完整读取

- GIVEN 工作区内 JSON 文件只有一行且整行在完整文件上限内
- WHEN renderer 请求无显式行号的文件引用
- THEN `workspace-file` 响应包含该行的全部文本
- AND `isComplete` 为 true

#### Scenario: 工作区文件超过完整读取上限

- GIVEN 工作区内普通文本超过整文件上限
- WHEN renderer 请求该文件引用
- THEN 响应为 `file-too-large`
- AND 不返回第 1 行附近窗口

#### Scenario: 大文件目标窗口

- GIVEN 工作区外文本文件超过 2 MiB 且目标行在扫描预算内
- WHEN renderer 请求该目标行
- THEN `external-preview` 响应可用且包含目标行
- AND 不返回整份文件

#### Scenario: 目标行本身超过显示上限

- GIVEN 任意位置文本文件的目标行单行超过文件引用字节上限
- WHEN renderer 请求该目标行
- THEN 响应为 line-too-large
- AND 不返回目标行的完整或部分内容
- AND 响应路径是该文件的 canonical path

#### Scenario: 二进制文件通过别名引用

- GIVEN 含 NUL 的文件同时有真实路径和符号链接路径
- WHEN renderer 分别请求两个路径
- THEN 两次响应均为 binary-file
- AND 两次响应路径都是同一个 canonical path

#### Scenario: 读取预算继续拒绝无界内容

- GIVEN 目标文件需要超过扫描上限才能到达目标行，或目标窗口超过响应总字节上限
- WHEN renderer 请求该目标
- THEN 响应分别为 scan-limit 或 response-too-large
- AND 不返回部分窗口

### Requirement: 手动 sidebar chat 仍是普通根会话

Source: docs/product/flows/session-analysis.md#4-首次发送并创建会话

local-console MUST 把用户手动创建的 sidebar chat 保存为普通、可继续、可归档和可恢复的根 session。分析入口创建的 session MUST 按下文“分析会话持久化直接父归属”保存为直接分析子会话，不适用本 Requirement 的根会话规则。session MAY 保存可信 `originSessionId`、`entryTemplate` 与 `writePolicy` 导航/入口事实；这些字段 MUST NOT 改变普通团队快照、provider/model/effort、工作空间或消息生命周期，也 MUST NOT 从消息正文或来源 run 推断。

#### Scenario: 最终上下文创建 session

- GIVEN 手动 sidebar chat 草稿在发送瞬间选择项目 P、工作空间 W 和团队 T
- WHEN 创建与首条消息原子成功
- THEN session 属于 P 并使用 W 与 T 的冻结快照
- AND 不继承来源会话运行配置
- AND origin 仅保存为导航元数据。

### Requirement: 来源胶囊序列化为用户消息来源块

Source: docs/product/flows/session-analysis.md#2-收集来源引用

分析草稿在发送前 MUST 支持有序、可删除的来源胶囊。每个胶囊通过悬浮、键盘聚焦与辅助技术公开的完整文本 MUST 是该胶囊唯一的 Agent 输入载荷。提交时 local-console MUST 把仍存在的胶囊文本按顺序各序列化一次，形成用户消息顶部唯一的 Markdown 来源块，并与正文和普通附件在同一个 session fact 中原子提交；已发送消息 MUST NOT 继续保存或重复呈现独立胶囊。

来源块或任意正文中的 `moebius-ref:` MUST 只承担用户导航语义。runtime MUST NOT 根据该链接追加目标消息、目标对话、结构化运行记录、stdout、stderr 或完整输出，也 MUST NOT 因链接目标不可用而阻止消息提交、pending 发射或 run 创建。

#### Scenario: 对话片段只传递可见文本

- GIVEN 对话级胶囊公开文本为 T，目标对话含多条消息与大体量完整输出
- WHEN 用户发送分析问题并启动 Agent
- THEN Agent 输入中的来源片段逐字等于 T 且只出现一次
- AND 输入不含仅存在于目标时间线或运行输出中的内容。

#### Scenario: 多个片段保持顺序且各出现一次

- GIVEN 草稿按顺序包含文本 T1 与 T2 两个胶囊
- WHEN 用户提交首条消息
- THEN 来源块按 T1、T2 的顺序生成
- AND T1 与 T2 各自只序列化一次。

#### Scenario: 删除片段后发送

- GIVEN 草稿原有两个来源胶囊且用户删除第一个
- WHEN 首条消息提交成功
- THEN JSONL、SQLite 投影与消息 UI 的 Markdown 来源块只包含第二个引用
- AND 被删胶囊不形成附件、引用或隐藏 prompt。

#### Scenario: 重建保留来源块顺序

- GIVEN JSONL 用户消息包含具有三个链接的来源块
- WHEN SQLite 索引被删除并从 JSONL 重建
- THEN 三个链接的标签、目标与顺序保持
- AND 不重建独立来源胶囊。

#### Scenario: 链接目标不可用不阻塞 pending

- GIVEN 队首用户消息含指向缺失或不可访问目标的合法 `moebius-ref:`
- WHEN 主 Agent 车道可发射该消息
- THEN 消息与 run 按普通顺序创建
- AND 链接目标状态只在用户激活导航时处理。

### Requirement: reference-text 生成公开应用内来源链接

Source: docs/product/flows/session-analysis.md#2-收集来源引用

local-console reference-text API MUST 要求调用方显式声明 `message` 或 `conversation` 范围，并生成可读标签与公开 `moebius-ref:` 目标。消息级链接 MUST 使用稳定 session/message 标识并提供安全纯文本摘录；对话级链接 MUST 使用稳定 session 标识与可读标题。长文本、Markdown 特殊字符、Emoji、控制字符与空正文 MUST 经过确定性投影、转义和截断。该 API 只生成导航链接与胶囊的完整可见文本；链接 MUST NOT 触发 run 输入侧的来源读取或权限扩张。

#### Scenario: 对话级来源链接

- GIVEN 对话具有稳定 session 标识与可读标题
- WHEN 客户端请求 conversation 范围的 reference-text
- THEN 返回合法 `moebius-ref:conversation/<session-id>` Markdown link
- AND 可见标签使用对话标题且不展示文件路径或 provider 标识。

#### Scenario: 消息级来源链接

- GIVEN 消息属于稳定 session 且具有稳定 message 标识
- WHEN 客户端请求 message 范围的 reference-text
- THEN 返回合法 `moebius-ref:message/<session-id>/<message-id>` Markdown link
- AND 可见标签使用安全纯文本摘录且不展示内部路径或 provider 标识。

#### Scenario: 特殊字符安全投影

- GIVEN 消息正文含 Markdown 链接、代码、Emoji、控制字符或超长文本
- WHEN 客户端请求 message 范围的 reference-text
- THEN 可见标签是确定性转义与截断后的单行纯文本
- AND 生成链接仍可被 Markdown parser 解析为唯一来源目标。

### Requirement: 已持久化可见消息是重试与恢复的唯一来源文本

Source: docs/product/flows/session-analysis.md#用户移除文本片段

重试、重新运行、同一 run 恢复与恢复失败后的重新执行 MUST 只使用对应用户消息中已持久化的可见文本。runtime MUST NOT 刷新 `moebius-ref:` 目标，也 MUST NOT 把历史 execution context 中遗留的隐藏 `referenceContext` 拼入 provider prompt。新建或从历史 context 派生的 execution context MUST NOT 再持久化 `referenceContext`。

#### Scenario: 旧隐藏上下文不进入重试 prompt

- GIVEN 历史 run execution context 含遗留 `referenceContext`，而用户消息只含短来源片段 T
- WHEN runtime 重试或恢复该工作
- THEN provider prompt 包含用户消息中的 T
- AND prompt 不含遗留 `referenceContext` 内容
- AND 新 run 的 execution context 不含 `referenceContext`。

### Requirement: 分析入口策略在确认前强制只读

Source: docs/product/flows/session-analysis.md#5-分析并确认方案

`writePolicy=confirm-current-plan-before-write` 的 session MUST 在当前方案获得匹配确认前，把所有成员 run 限制为 provider 强制只读。提示词声明本身不足以满足此 Requirement。任意非法、模糊、过期或不匹配的确认 MUST fail closed；手动 sidebar chat 与普通会话 MUST 保持 normal policy。

#### Scenario: 未确认写入被阻止

- GIVEN session 使用确认前只读策略且没有当前版本 write lease
- WHEN 用户要求修改工作空间、团队文件或其他正常可写本地目标
- THEN Codex/Kimi run 均使用只读能力
- AND 文件与持久本地状态不变
- AND 用户获得可见说明。

#### Scenario: 当前方案确认产生一次执行

- GIVEN 主 Agent 已登记方案版本 V
- WHEN 用户自然语言确认且只读控制回合返回匹配 V 的有效控制事实
- THEN runtime 为紧接着的同一 Agent resume 建立一次性 write lease
- AND 该执行使用普通会话正常权限
- AND 终态后 lease 关闭。

#### Scenario: 方案变化使旧确认失效

- GIVEN 当前方案从 V1 更新为 V2
- WHEN 用户确认或控制事实仍指向 V1
- THEN runtime 不建立 write lease
- AND 继续以只读能力等待 V2 的确认。

### Requirement: 搜索与恢复活动项目内根会话

Source: docs/product/pages/search.md#操作与反馈

local-console MUST 支持按规范化标题搜索活动项目内的活动或可选归档根用户会话，并返回足以完成普通/组合路由的 project、session、archived 与 origin 状态。空查询 MUST NOT 返回全部会话。恢复 MUST 复用既有 session 事实且保持标题、消息、工作空间、团队、运行历史、origin 和 write policy。

#### Scenario: 恢复归档 sidebar chat

- GIVEN 一段归档 sidebar chat 仍属于活动项目
- WHEN 恢复操作成功
- THEN 恰好一个原 session 回到活动列表
- AND 不创建替代 session
- AND origin 与入口策略保持。

### Requirement: 手动 sidebar chat 的归档与来源失效保持独立

Source: docs/product/pages/main-left-sidebar.md#归档

归档手动 sidebar chat MUST 只归档目标 session；归档或移除来源项目 MUST NOT 自动归档属于其他项目的手动 sidebar chat。来源可用性变化 MUST 只改变 presentation route，不改变手动 sidebar chat 历史、团队、工作空间、权限或运行状态。分析会话及其后代适用下文“归档和项目移除按分析后代闭包提交”，不得套用本 Requirement 的独立归档语义。

#### Scenario: 来源项目被移除

- GIVEN 手动 sidebar chat B 属于项目 P2 且来源 A 属于项目 P1
- WHEN P1 被移除
- THEN A 随 P1 归档
- AND B 保持活动且事实不变
- AND presentation 层可把 B 降级到主内容。

### Requirement: 分析会话持久化直接父归属

Source: docs/product/flows/session-analysis.md#5-分析并确认方案

local-console MUST 为已创建分析会话持久化直接父会话标识；该关系 MUST NOT 进入团队子任务投影，具有直接分析父关系的会话 MUST NOT 进入根会话列表。

#### Scenario: 分析会话首次发送成功

- GIVEN 分析草稿从会话 A 创建
- WHEN 首条消息与分析会话 B 创建成功
- THEN B 的直接分析父会话为 A
- AND 根会话列表不包含 B
- AND A 的直接分析子项只包含 B，不包含 B 的后代。

#### Scenario: 旧分析会话安全迁移

- GIVEN 旧会话具有有效 `entryTemplate=session-analysis` 与现存 `originSessionId`
- WHEN store 执行幂等迁移
- THEN 直接分析父关系回填为该来源会话
- AND 缺失、自指或非法来源不得导致会话从所有入口消失。

### Requirement: 归档和项目移除按分析后代闭包提交

Source: docs/product/pages/main-left-sidebar.md#归档

归档根会话或因项目移除归档任一会话时，local-console MUST 递归处理其全部分析后代；普通操作遇到范围内运行中或待接回控制工作 MUST 被拒绝。

#### Scenario: 根会话归档

- GIVEN 根会话具有多层分析后代且全部静止
- WHEN 归档提交成功
- THEN 根会话与全部分析后代在同一提交结果中隐藏。

#### Scenario: 项目移除命中中间分析会话

- GIVEN 分析会话 B 使用待移除项目且 B 有使用其他项目的后代 C
- WHEN 项目移除提交成功
- THEN B 与 C 均隐藏
- AND B 的父会话及子树外兄弟保持可见。

#### Scenario: 强制移除前置步骤失败

- GIVEN 待隐藏范围存在运行中或待接回工作
- WHEN 停止或放弃待接回任一步失败
- THEN 项目移除事务不提交
- AND 会话归档状态保持不变。
# 运行监督、结构化终局与一次性执行配置重跑

## Requirement: 三引擎共享结构化终局

Source: docs/product/pages/agent-conversation.md#指标与验收

local console MUST 让 Codex、Claude 与 Kimi 的执行结果通过穷尽的结构化终局进入 runtime，至少区分 completed、user/system interrupted、idle/tool/max timeout、quota exhausted、retryable rate limited、auth 和 crashed。每个 engine-specific terminal MUST 显式映射；未知 payload MUST 安全落为 crashed/unknown。runtime MUST NOT 通过 reason 字符串前缀、中文错误文本或 CLI 名称特例推断终局。

completed MUST 要求 provider 成功终局和通过现有 Agent 回复契约的非空完整正文。进程退出成功、Kimi `stopReason=end_turn`、空正文或不完整回复本身 MUST NOT 形成成功 Agent message 或推进 Agent 公开时间线 cursor。

原始 provider code/message/data、stderr、路径和内部异常 MAY 进入有界 run-local 诊断，但 MUST NOT 进入普通时间线或 renderer DTO。Kimi ACP JSON-RPC error MUST 保留其原始 code/message/data 到受信任诊断；系统 MUST NOT 依赖 `~/.kimi-code` 内部诊断文件才能形成安全失败。

### Scenario: Kimi 空 end_turn 不冒充成功

- **GIVEN** Kimi `session/prompt` 返回 `stopReason=end_turn`
- **AND** 没有通过 Agent 回复契约的完整非空正文
- **WHEN** local runtime 收束该 run
- **THEN** 它写入 no-complete-result/crashed 终局
- **AND** 不写成功 Agent message、不推进公开回复 cursor
- **AND** 原输入仍可由用户显式重试或换执行配置重跑。

### Scenario: Kimi 中断是用户动作

- **GIVEN** 用户精确停止一个活动 Kimi run
- **WHEN** Kimi adapter 收到 abort 并结束
- **THEN** 终局为 `interrupted{user}`
- **AND** 不得落成 run-not-started、crashed 或 completed。

### Scenario: 未知错误安全降级

- **GIVEN** 任一引擎返回未登记 payload
- **WHEN** adapter 映射终局
- **THEN** 它形成 crashed/unknown 与受信任诊断
- **AND** raw payload 不进入 renderer
- **AND** 编译期穷尽检查覆盖所有已登记联合成员。

## Requirement: 真实进展驱动监督

Source: docs/product/pages/agent-conversation.md#最新活动
Source: docs/product/pages/agent-conversation.md#运行耗时

只有新增非空 Agent 正文、非空 reasoning、唯一工具调用 started/finished 和明确文件改动 MUST 刷新 local run 的 progress idle deadline。provider retry、配置更新、usage、状态心跳、空 delta、重复或已消费事件 MUST NOT 刷新该 deadline；其中可识别 provider retry 进入下述独立 busy phase，不能识别为结构化 retry 的普通文本回显仍由 progress idle 收敛。Codex/Claude stdout 字节与 Kimi 任意 `session/update` 到达 MUST NOT 自身构成进展。

工具调用从唯一 started 到匹配 finished/result 之间 MUST 被视为已知在途工作，并暂停通用 progress idle、启动独立且更宽的工具执行 deadline；该 deadline 默认两小时（`7_200_000` 毫秒），覆盖 open-tool 集合从空变为非空到再次清空的连续在途区间，同一区间新增或结束部分并行工具 MUST NOT 重置它。local console MUST centrally resolve this deadline: when `MOEBIUS_LOCAL_TOOL_IN_FLIGHT_TIMEOUT_MS` is absent or empty, it MUST use exactly `7_200_000` milliseconds; when the variable contains a positive integer, it MUST use that integer exactly. Existing validation for non-integer, zero, or negative values MUST remain fail-fast, and MUST NOT produce an unlimited deadline. 匹配结束且集合清空后 MUST 撤销工具 deadline 并从结束时刻重新计时。Claude 的 streamed `content_block_stop` 只表示模型输出块闭合，MUST NOT 被当成工具完成；系统必须等待对应 `tool_result`，并正确处理一轮中的并行工具结果。provider 缺失 tool id 时，adapter MUST 以本地发生次序稳定配对同类 start/finish；同一 provider id 在前一实例结束后再次出现 MUST 被视为新生命周期，不能被永久去重。没有匹配 started 的 completed/finished MUST 安全降级为非进展 status，不能误删其他在途工具或刷新 idle。工具在途期间 MAY 继续显示当前工具活动，但 local runtime MUST NOT 仅因该工具静默超过普通 idle 窗口而终结 run；工具 deadline 到期 MUST 停止 run 并形成 `timeout{tool}`。

local console MUST NOT 因总墙钟达到固定上限而停止仍有真实进展的 run。长运行报告阈值 MAY 生成一次可见监督提示，但 MUST NOT 终结 run 或刷新 progress idle。其他运行模式或 provider 自身产生的 max timeout 仍 MUST 被结构化表达，不得与 local long-run report 混同。

识别到 retryable provider/service retry 后，系统 MUST 建立独立 busy phase，在活动投影中显示服务繁忙和观察到的重试次数；次数不可可靠取得时 MUST 省略次数。busy phase 从首个可识别 retry 起使用 `src/config.ts` 集中的独立闸，默认五分钟；到期 MUST 停止该 run 并写 rate-limited 终局。真实进展 MUST 结束当前 busy phase。没有可靠 retry 信号时系统 MUST NOT 猜服务繁忙，而应继续由 progress idle 负责无进展收敛。

### Scenario: 伪活动不能延长 idle

- **GIVEN** Kimi 持续发送配置更新、心跳或无法形成结构化 provider-retry 的普通文本回显
- **AND** 没有正文、reasoning、工具起止或文件改动
- **WHEN** progress idle deadline 到达
- **THEN** run 进入 idle timeout 终局
- **AND** 伪活动没有移动 deadline。

### Scenario: 真实进展刷新监督

- **GIVEN** run 尚未达到 progress idle deadline
- **WHEN** adapter 发出新的非空 reasoning 或唯一 tool-finished 事件
- **THEN** lastProgressAt 更新为该事件时刻
- **AND** 重复同一事件不会再次更新。

### Scenario: 长工具执行不被普通 idle 误杀

- **GIVEN** adapter 已发出唯一 tool-started
- **AND** 对应工具执行时间超过普通 progress idle 窗口
- **AND** 尚未达到独立工具执行 deadline
- **WHEN** 期间没有正文、reasoning 或其他协议事件
- **THEN** 通用 idle 保持暂停且 provider 进程继续运行
- **AND** 匹配 tool-finished/tool-result 到达后重新开始 idle 计时
- **AND** 随后的完整 Agent 回复仍可形成 completed 终局。

### Scenario: 挂死工具由独立 deadline 收束

- **GIVEN** adapter 已发出 tool-started
- **AND** 没有收到匹配 finished/result
- **WHEN** 独立工具执行 deadline 到达
- **THEN** provider 进程被有界停止
- **AND** 终局为 `timeout{tool}`，文案说明工具执行过久
- **AND** run 不会因普通 idle 被提前误杀，也不会无限保持活动。

### Scenario: 缺失与复用 tool id 仍正确配对

- **GIVEN** provider 的一组工具事件缺失 id，或结束后的下一工具复用了相同 id
- **WHEN** adapter 投影这些 start/finish 生命周期
- **THEN** 缺失 id 的同类事件按发生次序配对
- **AND** 复用 id 的第二次 start 建立新的在途实例
- **AND** open-tool 集合最终不会泄漏，也不会在工具仍运行时提前清空。

### Scenario: 长运行只报告

- **GIVEN** run 持续产生真实进展
- **WHEN** local long-run report 阈值到达
- **THEN** 活动投影显示长运行提醒
- **AND** provider 进程保持活动
- **AND** local runtime 不产生 max-duration timeout。

### Scenario: 服务繁忙闸独立收束

- **GIVEN** provider 连续发出可识别 retryable service retry
- **WHEN** busy phase 达到默认五分钟且期间没有真实进展
- **THEN** 活动行在运行中显示观察到的 retry 次数
- **AND** run 以 rate-limited 终局停止
- **AND** 系统不自动调用其他 CLI。

### Scenario: 默认工具 deadline 为两小时

- **GIVEN** local console 未设置 `MOEBIUS_LOCAL_TOOL_IN_FLIGHT_TIMEOUT_MS`
- **WHEN** runtime 解析连续工具在途区间的工具 deadline
- **THEN** deadline 为精确的 `7_200_000` 毫秒
- **AND** open-tool 集合的连续区间和并行工具计时语义保持不变。

### Scenario: 正数环境覆盖按原值使用

- **GIVEN** local console 将 `MOEBIUS_LOCAL_TOOL_IN_FLIGHT_TIMEOUT_MS` 设置为正整数
- **WHEN** runtime 解析连续工具在途区间的工具 deadline
- **THEN** deadline 使用该整数
- **AND** Codex、Claude 与 Kimi 的 ordinary tool execution paths 收到相同值
- **AND** idle、provider busy、long-run report 与 managed-process 语义不变。

## Requirement: 异常终局持久保留可见正文

Source: docs/product/pages/agent-conversation.md#停下
Source: docs/product/pages/agent-conversation.md#页面状态

任一非成功终局 MUST 在移除 active snapshot 前，先尝试把该 run 最后已经对用户可见的安全 Agent Markdown 与 terminal kind、safe code、content-incomplete、elapsed、step/attempt/run 关联原子写入 session JSONL。SQLite MAY 保存可重建投影，但 MUST NOT 成为该正文的唯一事实源。写入失败 MUST NOT 推进 source cursor、提交成功 Agent message 或把 lifecycle 报告为 completed，并 MUST 保留可由启动恢复识别的未收束 source/lifecycle。

刷新、重启、主会话与 embedded 子任务投影 MUST 恢复同一 partial Markdown 和终局。partial Markdown MUST NOT 同时作为 completed Agent message 出现。升级前没有 partial 字段的旧终局 MUST 兼容为空，不得重写历史。

### Scenario: 中断前正文跨重启保留

- **GIVEN** Kimi 已产生一段可见 Markdown
- **WHEN** 用户停止 run 并重启应用
- **THEN** 时间线仍显示该 Markdown、content-incomplete 和 user-interrupted 终局
- **AND** 没有成功 Agent message 副本。

### Scenario: terminal 提交失败不丢 active

- **GIVEN** runtime 正在把 partial Markdown 写入 terminal fact
- **WHEN** JSONL 或 store 事务失败
- **THEN** runtime 不推进公开 cursor
- **AND** 不把该 run 报告为 completed
- **AND** 恢复路径仍可确定性识别未收束 run。

## Requirement: 一次性执行配置使用派生 provider 身份

Source: docs/product/pages/agent-conversation.md#重试与恢复
Source: docs/product/pages/main-conversation.md#重试

已停下、timeout、quota/rate-limit、auth 或 no-complete-result 终局 MUST 允许用户以受信任 registry 中的 CLI/model/effort 创建同一步的新 run。override MUST 明确为 single-run，MUST NOT 修改团队成员配置、会话冻结快照、base Agent identity 或其 canonical provider link。

服务端 MUST 在创建 run 前校验 override，并把 override intent、source message、step、attempt 和新 run 原子持久化。合法 override MUST 使用由 base Agent identity、override id 和 override profile fingerprint 派生的独立 provider identity；该 identity 首次允许 full，观察到 external ID 后必须立即固化，正常退出恢复同一 run 时只能 resume 该 ID。

override run 终局后，后续没有 override 的普通 run MUST 继续使用 base profile 和 base canonical external ID。普通 engine/profile mismatch MUST 继续 fail closed，MUST NOT 因本 Requirement 变成 full fallback。任何 override MUST NOT 自动回滚已有文件改动或自动调用第二个引擎。

### Scenario: Kimi 终局临时改用 Codex

- **GIVEN** base Agent identity 绑定 Kimi external session K
- **AND** 用户在该 run 终局选择合法 Codex profile C
- **WHEN** 系统创建同一步下一 attempt
- **THEN** 新 run 以 derived identity full 启动 Codex
- **AND** base snapshot 与 Kimi canonical link K 不变
- **AND** Kimi 不在该 override run 中被调用。

### Scenario: override 后回到基础身份

- **GIVEN** 上一次 single-run Codex override 已终局
- **WHEN** 同一成员收到没有 override 的下一条普通消息
- **THEN** runtime 使用 base Kimi profile resume K
- **AND** 不 resume override Codex session
- **AND** 公开时间线仍包含 override run 的可见结果。

### Scenario: 同次提交幂等而再次确认形成新意图

- **GIVEN** renderer 因重复点击、迟到响应或 callback 变化重复发送同一 submission nonce
- **WHEN** local API 处理这些请求
- **THEN** 同一 nonce 最多创建一个新 run/attempt
- **AND** 不创建第二个 derived provider identity
- **BUT WHEN** 用户在终局卡片再次显式确认同一执行配置
- **THEN** renderer 生成新 nonce，runtime 接纳新的重跑意图而不是静默吞掉。

### Requirement: 会话侧栏元数据独立持久化

Source: docs/product/pages/main-left-sidebar.md#标记为已读与未读

local-console MUST 独立持久化 attention 确认、Agent 未读、手动未读、read-state revision、置顶时间和标题 revision。确认 attention MUST NOT 删除或改写时间线事实；同一事实经刷新或重启 MUST NOT 再次提醒，后来形成的新事实 MUST 再次提醒。

#### Scenario: 同类异常恢复后再次发生

- GIVEN 用户已经确认一次卡住事实且该会话随后恢复
- WHEN 后来产生一条新的卡住事实
- THEN 新事实拥有更高 attention revision
- AND 会话再次显示未确认 attention。

### Requirement: 阅读状态 mutation 校验最新事实

Source: docs/product/pages/main-left-sidebar.md#标记为已读与未读

阅读状态 mutation MUST 以服务端最新可见状态、attention revision、read-state revision 与 title revision 为准。Agent 未读或手动未读的建立、推进、离开 gate 或清除 MUST 推进 read-state revision。红点已读 MUST 只确认当前 attention；蓝点已读 MUST 清除 Agent 与手动未读；运行点 MUST 拒绝手动改变阅读状态。陈旧操作 MUST 不写入并返回可判定冲突。

#### Scenario: 菜单打开后会话开始运行

- GIVEN 用户在无点状态打开菜单
- WHEN 会话开始运行后才提交标记未读
- THEN mutation 返回陈旧状态冲突
- AND 会话不产生手动未读。

#### Scenario: 蓝点菜单打开后到达新结果

- GIVEN 用户在蓝点对应 read-state revision R 打开“标记为已读”
- WHEN 新 Agent 结果到达并把 read-state revision 推进到 R+1 后才提交旧菜单
- THEN mutation 返回陈旧状态冲突
- AND 新结果的未读时间保持不变。

### Requirement: 当前会话手动未读需要一次离开

Source: docs/product/pages/main-left-sidebar.md#标记为已读与未读

当前已展示会话被标记未读后 MUST 先成功选择另一段会话，之后再次显式成功展示时才清除。自动恢复、刷新和重复激活当前行 MUST NOT 清除；非当前会话的手动未读在下一次显式成功展示时清除。

#### Scenario: 重启不消费当前会话提醒

- GIVEN 当前会话被标记未读且用户尚未离开
- WHEN 应用重启并自动恢复该会话
- THEN 手动未读仍存在。

### Requirement: 置顶与标题是原子会话 mutation

Source: docs/product/pages/main-left-sidebar.md#置顶与取消置顶

置顶和重命名 MUST 在 SQLite 事务提交后返回新 session 摘要。置顶 MUST 保留创建时间与项目归属；重命名 MUST 只改变 trim 后的非空标题和 title revision。归档 MUST 清除置顶状态。失败 MUST 保留提交前元数据。

#### Scenario: 重命名后搜索只使用新标题

- GIVEN 会话标题 A 成功改为不包含 A 的 B
- WHEN 分别搜索 A 和 B
- THEN A 不命中该会话
- AND B 命中同一 session。

### Requirement: 托管运行项使用会话级结构化能力

Source: docs/product/pages/main-conversation.md#托管运行项

local console MUST 为 Codex、Claude 与 Kimi 的每次 full 和 resume invocation 临时提供同一版本的 `managed_process_start/list/inspect/read_logs/stop` MCP schema。capability MUST 绑定当前 session、workspace identity 和 provider run；公开工具参数 MUST NOT 接受 sessionId、workspace root、PID、PGID、env、shell 或 capability。invocation 结束后 capability MUST 撤销，已经创建的运行项 MUST 继续归属 session 并可由下一回合的新 capability 查询和停止。

`start` MUST 只接受受限 kind、label、单个 executable、args 数组、workspace-relative cwd、可选 readiness 与可选 loopback HTTP endpoint。local console MUST 解析当前会话的真实 workspace root，拒绝绝对 cwd、`..`、symlink escape、外部 host、非法协议、shell 字符串、过量 payload 和其他 session 的 processId。Darwin ownership wrapper MUST 通过 `spawn(executable,args[])` 与 `shell:false` 启动目标。普通 renderer API MUST NOT 提供 start。

`task` MUST 只表示有自然终点、但明确需要跨当前 Provider invocation 存活或由用户持续监督的有限进程。预期在当前 Provider 原生工具调用内结束、结果立即被 Agent 消费的 Python、测试与构建 MUST 继续以前台普通命令执行；运行数分钟本身 MUST NOT 把它升级为 managed task。意图不明确时 Agent MUST 保持前台且不得自行后台化。

#### Scenario: 三家 full 与 resume 获得同一工具

- **GIVEN** 同一会话分别绑定 Codex、Claude 与 Kimi
- **WHEN** 每家执行一次首次创建和一次 resume
- **THEN** 每次 invocation 都发现相同名称、版本与 JSON Schema 的 managed-process 工具
- **AND** 新一轮能 list/inspect 前一轮创建的同一 processId
- **AND** invocation 临时 capability 不出现在 Agent prompt、时间线或 renderer DTO。

#### Scenario: 越界启动 fail closed

- **GIVEN** Agent 请求绝对 cwd、workspace 外相对路径、symlink escape、外部 endpoint、shell 字符串或伪造 sessionId
- **WHEN** bridge 提交 start
- **THEN** local console 返回稳定结构化拒绝
- **AND** spawn 调用次数为零
- **AND** 注册表和 ownership manifest 均没有新增条目。

#### Scenario: 普通命令不被自动认领

- **GIVEN** Agent 正文包含约定 JSON、localhost 链接或 Provider 原生终端使用 `nohup`/后台符号
- **WHEN** 没有成功调用 managed-process MCP start
- **THEN** local console 不创建运行项
- **AND** 不从正文、终端文本或进程扫描猜测所有权。

#### Scenario: 有限 task 与普通前台命令边界

- **GIVEN** 一个测试命令预期在当前工具调用内返回结果，另一个训练命令被明确要求跨本轮继续并允许用户随时停止
- **WHEN** Agent 选择执行能力
- **THEN** 测试命令继续使用 Provider 原生前台工具且不出现在运行项注册表
- **AND** 训练命令 MAY 以 kind=task 调用 managed-process start
- **AND** 两者都不得使用后台 shell 绕过各自生命周期。

### Requirement: Supervisor 持有进程组、状态、readiness 与有界日志

Source: docs/product/pages/main-conversation.md#托管运行项入口与面板

local console MUST 以不可预测 processId 建立 session/workspace 所有权。Darwin 生产 adapter MUST 用固定 Moebius wrapper 建立 `launchd` job 和 job process group；wrapper 才能以校验后的 `spawn(executable,args[])`、`shell:false` 启动目标。非 Darwin 首版 MUST 不注入该能力或返回稳定 unsupported，target spawn 为零，MUST NOT 退化为 direct child、裸 PID/PGID 租约或后台 shell。每个条目 MUST 结构化区分 starting、running、ready、unhealthy、stopping、exited；spawn 成功 MUST NOT 直接表示 readiness 成功。readiness MUST 支持 none、loopback tcp、loopback http 和有界 stdout literal contains，所有 deadline/interval/threshold MUST 来自集中配置。

supervisor MUST 持续 drain stdout/stderr 到有界 ring，记录 dropped/truncated 事实，并限制单次 MCP/HTTP 读取字节。日志 DTO MUST 转义控制字符，MUST NOT 包含 bridge token、环境变量、Provider 原始 payload 或用户全局配置正文。进程自行退出 MUST 进入 exited 并保存安全 exit code/signal；MUST NOT 从 stderr 文本猜测业务状态或自动重启。

stop MUST session-scoped 且幂等：第一次请求使目标进入 stopping，并由经认证的 wrapper 或精确 launchd service target 对整个 job process group 执行有界 SIGTERM→SIGKILL→bootout/reap；重复请求等待同一 promise。supervisor 和 startup reconciliation MUST NOT 对 manifest 里的裸 PID/PGID 发信号。一个条目的 stop MUST NOT abort Agent run、其他运行项或其他 session 的进程。

#### Scenario: HTTP 服务经过 readiness 后可用

- **GIVEN** start 创建一个延迟监听 loopback 端口的服务并声明 HTTP readiness
- **WHEN** launchd wrapper 已启动但端口尚未响应
- **THEN** 状态保持 starting 而不是 ready
- **AND** 探针成功后同一 processId 转为 ready
- **AND** endpoint DTO 与真实可访问 URL 一致。

#### Scenario: readiness 失败不自动重启

- **GIVEN** 目标进程存活但 readiness 在截止内未成功
- **WHEN** deadline 到达
- **THEN** 状态进入 unhealthy
- **AND** PID/PGID 保持不变
- **AND** supervisor 不执行命令第二次
- **AND** logs 与 stop 仍可用。

#### Scenario: 日志洪泛有界

- **GIVEN** 目标持续写出超过配置上限的 stdout/stderr
- **WHEN** Agent 或 renderer 读取日志
- **THEN** 响应只包含允许的尾部与 truncated/dropped 事实
- **AND** supervisor 继续 drain 子进程管道
- **AND** 内存和单次响应不随总输出无界增长。

#### Scenario: 精确停止整棵进程树

- **GIVEN** 两个运行项都处于 ready，目标项还派生了子进程并监听端口
- **WHEN** 当前 session 对目标 processId 调用 stop
- **THEN** 只有目标项进入 stopping 后 exited
- **AND** 目标 PGID、子进程与端口全部消失
- **AND** 另一运行项保持 ready 且端口仍可访问。

### Requirement: 已退出记录由用户确认后清除

Source: docs/product/pages/main-conversation.md#托管运行项入口与面板

local console MUST 提供 session-scoped `acknowledge-exited` renderer intent，只删除当前 session 已 settled 的 exited 内存条目。它 MUST NOT 停止或删除 active/stopping 条目，MUST NOT 改写 session JSONL/SQLite，也 MUST NOT 暴露为 Agent 可启动或清理进程的 MCP 工具。重复确认 MUST 幂等；失败 MUST 保留原条目和日志供重试。

#### Scenario: 确认只清理当前会话的退出记录

- **GIVEN** 当前 session 有两个 exited 条目、一个 active 条目，另一 session 也有 exited 条目
- **WHEN** renderer 对当前 session 确认清除已退出
- **THEN** 只删除当前 session 的两个 exited 内存条目
- **AND** 当前 active 条目与另一 session 条目保持不变
- **AND** 没有进程信号、会话事实写入或 Provider 调用发生。

### Requirement: 运行项跨 Agent 回合但不跨应用恢复

Source: docs/product/pages/main-conversation.md#退出应用与恢复执行

managed-process 注册表 MUST 跨同一应用生命周期内的 Provider invocation 与 Agent 回合保持，但 MUST NOT 作为可恢复 session fact 写入 JSONL/SQLite，也 MUST NOT 在应用重启后重建或自动执行旧命令。目标退出后的条目 MAY 留在当前进程内供查看；应用重启时注册表 MUST 为空。

supervisor MUST 为每项写入版本化、0600、HMAC 认证且最小化的 ownership manifest，绑定 installation identity、当前 `gui/<uid>` domain、不可预测 service label、processId、session/workspace identity hash 与 plist digest，但不保存目标命令、环境、endpoint 或日志。manifest MUST 在 bootstrap 前原子持久化；bootstrap 失败 MUST 撤销 service 并删除 manifest/plist/start payload，使任何已启动 job 都先有可认证清理身份。Darwin wrapper MUST 作为 launchd job main process 启动目标且显式设置 `AbandonProcessGroup=false`、`KeepAlive=false`、`RunAtLoad=true`，使 job 在本次 bootstrap 启动但退出后不自动重启；旧 start payload 在 wrapper 接收后删除。`gui/<uid>` 不可用时 MUST 返回稳定 unavailable 且 target spawn 为零。

启动 reconciliation MUST 先验证 manifest 的 version/HMAC/UID/domain/label namespace/plist digest，再只按精确 launchd service target 的 registration 执行有界 kill/bootout。它 MUST NOT 调用 bootstrap/kickstart、读取或执行旧 start payload、按同名 executable/端口搜索、或对 manifest 中的 PID/PGID 发信号。每个 manifest MUST 独立收敛；无法证明 service 归属、身份冲突或 plist 缺失的条目 MUST 保留并报告 cleanup blocked，保持目标进程不受影响，同时继续清理其他有效条目并允许应用以空注册表启动。无关同名进程 MUST 保持存活。

normal close MUST 先持久化活动 Agent run 的既有 graceful resume intent，再停止并 reap 全部 managed process，最后关闭 store/server。任一 managed group 未在清理 deadline 内确认退出时 close MUST reject，调用方 MUST NOT 声称安全退出。

#### Scenario: Agent 回合结束后服务仍存活

- **GIVEN** Agent 通过 MCP start 得到 ready 运行项
- **WHEN** Provider invocation 正常完成且下一回合开始
- **THEN** 同一 processId、PID/PGID 和 endpoint 仍存在
- **AND** 下一回合能 list/inspect/read_logs/stop
- **AND** Provider invocation cleanup 没有停止目标组。

#### Scenario: 正常关闭停止而不恢复

- **GIVEN** local console 有多个 active managed process 和一个可恢复 Agent run
- **WHEN** runtime close 完成并再次启动
- **THEN** Agent run 仍按既有 graceful resume 规则处理
- **AND** 所有 managed PGID 与端口在 close 返回前消失
- **AND** 新注册表为空且旧命令执行次数不增加。

#### Scenario: 崩溃残留只清理已证明归属的 service

- **GIVEN** 上次 owner 异常消失后留下 HMAC 有效 manifest 对应的 live launchd service、另一个 wrapper 已消失但 registration 尚待 bootout 的 job、一个伪造 manifest 和一个无关同名进程
- **WHEN** local console 再次启动 reconciliation
- **THEN** live service 的精确 target 被停止、bootout 并 reap
- **AND** wrapper 已消失的 job 由 launchd process-group 规则确认无残留后按精确 service target bootout
- **AND** 旧命令没有再次执行
- **AND** 无关进程保持存活
- **AND** 伪造、冲突或 plist 缺失的 manifest 产生 blocked 事实而不触发任何 PID/PGID kill，也不阻止应用启动或其他有效 manifest 清理。

### Requirement: Runtime Contract 只引导托管工具选择

Source: docs/product/pages/main-conversation.md#托管运行项

local console MUST 从单一版本化 builder 将 managed-process Runtime Contract 组合进 initial、delta、graceful resume、retry 与 edit-resend prompt。contract MUST 指明需要跨工具调用／回合存活的进程使用 managed-process 工具，并禁止自行后台化；MUST NOT 包含 token、bridge endpoint、内部路径或会话标识。进程注册、状态与停止 MUST 只来自结构化工具调用和 supervisor 事实，MUST NOT 解析 Agent 正文 JSON。

任一 Provider 的临时 MCP 配置生成、bridge 启动、MCP 初始化或工具发现失败 MUST 撤销 capability 并使本次 invocation 进入可理解 setup failure。该路径 MUST NOT 接受 managed-process start、MUST NOT 新增 registry/manifest、target spawn MUST 为零，也 MUST NOT 写 completed Agent 成功消息。Runtime Contract MUST 要求 Agent 报告能力不可用，MUST NOT 回退到 `nohup`、`&`、double-fork、自建 daemon 或正文 JSON。

#### Scenario: resume 重新收到运行时契约

- **GIVEN** Agent 已有 canonical Provider session
- **WHEN** 新消息通过 delta 或 graceful resume 启动下一轮
- **THEN** 本轮 prompt 仍包含同一版本的 Runtime Contract
- **AND** 工具 capability 为本轮新签发
- **AND** 不依赖首次 full prompt 的历史残留。

#### Scenario: MCP 注入或发现失败时不后台回退

- **GIVEN** Codex、Claude 或 Kimi 的本轮 MCP 注入、初始化或工具发现被故障注入为失败
- **WHEN** 用户要求启动一个需跨回合存活的服务
- **THEN** invocation 以 managed-process capability setup failure 收束且没有 completed Agent 成功消息
- **AND** target spawn、registry 新增与 manifest 新增均为零
- **AND** Provider 原生终端没有执行 `nohup`、后台符号、double-fork 或等价逃逸命令
- **AND** 用户全局 Provider 配置内容与元数据保持不变。

### Requirement: Kimi 托管工具完成后有界收束 Provider 回合

Source: docs/product/pages/agent-conversation.md#验收标准

bridge MUST 按 providerRunId/toolCallId 向对应 execution adapter 提供结构化 managed-tool completion 事实，不暴露请求参数、token 或日志。Kimi 在该工具已经返回后 MUST 启动独立、集中可配的滑动 settlement deadline；后续普通工具调用在途时 MUST 暂停该 deadline，工具结束或新的非空 Agent 正文／reasoning 到达时 MUST 从该真实进展重新计时，`session/prompt` 终局 MUST 撤销该 deadline。配置更新、心跳与重复工具状态 MUST NOT 刷新。

deadline 到达时 Kimi adapter MUST 复用既有 ACP cancel 与有界 signal escalation，并返回可重试 `timeout{basis:"provider-turn"}`。它 MUST NOT 写 completed Agent message、推进公开 cursor、重放 managed tool 或停止已经托管的进程。已观察 external session ID MUST 继续按 canonical resume 规则使用。

#### Scenario: 工具返回但 Kimi prompt 不终结

- **GIVEN** managed-process stop 已返回 stopped，且 Kimi `session/prompt` 此后没有终局或真实进展
- **WHEN** settlement deadline 到达
- **THEN** Kimi invocation 有界结束为 provider-turn timeout
- **AND** 时间线没有 completed Agent message且提供重试
- **AND** stop 副作用保持已提交，不重复调用工具
- **AND** 其他 managed process 仍可由下一回合查询和停止。

#### Scenario: 工具返回后 Kimi 正常回复

- **GIVEN** managed-process start 已返回 ready
- **WHEN** Kimi 在 deadline 内产生非空 Agent 正文并返回正常终局
- **THEN** settlement timer 被撤销
- **AND** Agent run 按既有 completed 规则收束
- **AND** managed process 跨回合继续存活。

## Team snapshot traceability and apply

### Requirement: Current saved team changes are classified without exposing values

Source: docs/product/pages/main-conversation.md#团队按钮展开

The local console MUST compare the selected session's effective snapshot with a newly loaded complete, valid saved version of the same stable team. It MUST independently report `agent-definition`, `execution-profile` and `team-information` categories with affected-member counts. Any change to a member's complete saved `AGENT.md`, including frontmatter, MUST count as Agent definition. A change to the identity parsed from that Markdown MUST additionally count as team information, so an identity-frontmatter-only edit MUST produce both categories.

The comparison MUST ignore unsaved drafts, paths, mtimes, health state and onboarding orchestration. It MUST NOT return content hashes, previous/current values, Markdown, profile details or a diff to the normal session state.

#### Scenario: Definition and profile change together

- **GIVEN** an effective snapshot and a valid saved version whose one persona and one profile changed
- **WHEN** update inspection completes
- **THEN** the result contains one Agent-definition category and one execution-profile category
- **AND** it contains no Markdown, model value, fingerprint, path or mtime.

#### Scenario: Identity-frontmatter-only edit reports two categories

- **GIVEN** an effective snapshot and a valid saved version whose member Markdown body is unchanged but whose `display_name` or `description` frontmatter changed
- **WHEN** update inspection completes
- **THEN** the result contains one Agent-definition category and one team-information category for the affected member
- **AND** it contains no execution-profile category.

#### Scenario: Invalid external edit is not an update

- **GIVEN** the current team directory contains an invalid or unreadable `AGENT.md`
- **WHEN** update inspection runs
- **THEN** no valid candidate replaces the last valid candidate or effective snapshot
- **AND** the team health/error channel reports the invalid state.

### Requirement: Applying a team update is a durable full-version state machine

Source: docs/product/pages/main-conversation.md#团队按钮展开

Any update-category apply intent MUST target one complete valid saved team version. The system MUST persist the target before accepting post-click waiting messages, MUST keep old-generation work on the old snapshot, and MUST route post-click messages to `awaiting-team` until promotion. Promotion MUST be atomic and MUST occur only after no active, scheduled, queued or inherited-handoff work remains for the old snapshot key.

On promotion failure the old effective snapshot and frozen target MUST remain, waiting messages MUST remain editable/removable and MUST NOT run. Retry MUST use the same frozen target without re-reading a later saved version. Cancel MUST discard the target, resolve waiting messages against the old effective snapshot in FIFO order and recalculate changes. Waiting/failed state MUST survive restart. If the initial target cannot be durably stored, the request MUST fail before entering waiting state or accepting waiting messages.

#### Scenario: Later save does not move a retry target

- **GIVEN** version B is frozen, promotion fails, and the team later saves version C
- **WHEN** the user retries application
- **THEN** the retry uses B and never C
- **AND** C can become a target only after the current intent is cancelled or B succeeds and a new apply is requested.

#### Scenario: Cancel releases messages on the old snapshot

- **GIVEN** an update intent failed and two post-click messages are waiting
- **WHEN** the user cancels application and continues with the current version
- **THEN** both messages are resolved and dispatched once in original FIFO order against the old effective team
- **AND** current valid saved changes are classified again.

### Requirement: Dispatch and handoff preserve their team snapshot generation

Source: docs/product/pages/main-conversation.md#说话与提及

Every primary/worker dispatch and run MUST bind an internal snapshot key before execution. A handoff produced by a run MUST inherit that run's key even when a newer snapshot is pending. A user message accepted after an update intent MUST remain unbound in `awaiting-team` until target promotion or cancellation. Internal keys MUST NOT be user-visible.

#### Scenario: Old handoff cannot cross the apply boundary

- **GIVEN** an old-generation Agent finishes after an update request and names another old-team member
- **WHEN** the handoff is scheduled
- **THEN** the new run binds the old snapshot key
- **AND** target promotion waits for that run to settle.

### Requirement: Agent run audit uses persisted historical facts

Source: docs/product/pages/main-conversation.md#Agent-头像与当时信息

The local console MUST expose a read-only, run-scoped audit projection containing the historical Agent identity, distinguishable team identity, nullable CLI/model/effort, nullable snapshot loaded time and one evidence class: `executed`, `planned-not-started` or `bound-start-unknown`. A dedicated external-process/provider fact or equivalent persisted proof MUST establish `executed`; ordinary lifecycle `startedAt` alone MUST NOT.

The complete historical `AGENT.md` MUST be available only through a second explicit run-scoped read. Both reads MUST use persisted run/session facts, MUST validate session/run/role ownership, and MUST NOT accept a file path or read the current team directory. Missing legacy facts MUST remain missing and MUST NOT be guessed.

#### Scenario: Started and pre-start failures are distinct

- **GIVEN** run A has a persisted process-start fact and run B has only a context plus a pre-start terminal fact
- **WHEN** their audit projections are read
- **THEN** A is `executed` and B is `planned-not-started`
- **AND** both profiles come from their own run contexts.

#### Scenario: Historical Markdown ignores current disk

- **GIVEN** a completed run froze member Markdown A and the current team file now contains B
- **WHEN** the user explicitly reads that run's Agent Markdown
- **THEN** the response is exactly A
- **AND** B is not read or returned.

#### Scenario: Cross-run read is rejected

- **GIVEN** a run belongs to session A
- **WHEN** a request addresses that run through session B or supplies an unrelated role
- **THEN** the request fails without returning identity, profile or Markdown.
## Requirement: Pi API 是第四种冻结执行配置

Source: `docs/product/flows/byok-agent-runtime.md#主流程`

local-console MUST 将 Pi API 与 Codex、Claude Code、Kimi 作为四种显式执行引擎；Pi 配置 MUST 冻结 Provider 档案 ID、服务商 ID、模型和实际思考程度，MUST NOT 冻结或复制 API Key。存量 CLI 配置 MUST 原位兼容，未知执行配置 MUST fail closed 而不得静默换引擎、档案或模型。

### Scenario: Key 轮换不改变会话身份

- **GIVEN** 一个 Pi 会话已冻结档案 P、模型 M 和思考程度 E
- **WHEN** P 的 Key 完成原子轮换
- **THEN** 后续 run 继续使用同一 Agent identity、execution generation 与 Pi native session
- **AND** session JSONL、SQLite snapshot 和 renderer DTO 都不出现新旧 Key。

### Scenario: 存量 CLI 会话升级

- **GIVEN** 数据根含有升级前的 `{cli, model, effort}` 配置和既有 Provider link
- **WHEN** 新版本读取并继续该会话
- **THEN** 它保持原 CLI、模型、effort、workspace 和 canonical link
- **AND** 不创建 Pi 配置或第二个 Provider session。

## Requirement: Pi Provider 原生会话严格连续

Source: `docs/product/pages/main-conversation.md#agent-执行与恢复`

Pi full/resume MUST 使用与其他 Provider 相同的 canonical identity 原则，并额外校验 Provider 档案、服务商、模型、effort、execution generation、workspace 和 Pi session ID。Moebius session JSONL MUST 保持公开事实源；Pi session/trace MUST 只作为 mode `0600` 的 Provider 原生记录。存在 creation evidence 但 link 缺失、冲突、不唯一或不可恢复时 MUST 零 Provider 调用并形成可操作的不可继续状态。

### Scenario: 正常退出后恢复 Pi 原生上下文

- **GIVEN** Pi run 已观察并持久化唯一 native session ID
- **WHEN** 应用正常退出后用户继续同一 Agent
- **THEN** runtime 只 resume 该 ID，并在页面延续同一原生上下文
- **AND** 不执行 full fallback。

### Scenario: 历史档案缺失

- **GIVEN** 会话保留冻结 Provider 标识但档案记录已缺失
- **WHEN** 用户尝试继续
- **THEN** Provider 调用次数为零
- **AND** 系统只允许迁移到另一已就绪档案或结束继续能力，不提供原配置重建。

## Requirement: Pi Host 使用一次性私有协议且有界退出

Source: `docs/product/flows/byok-agent-runtime.md#参与者与职责`

每个 Pi Provider turn MUST 以前台短生命周期 Host 执行。API Key MUST 仅通过一次性私有 stdin frame 注入 Host 内存，MUST NOT 出现在 argv、env、Pi auth/config 文件、stdout、stderr、manifest、普通诊断或会话事实。Host 终结后 MUST 有界 reap 自身普通子进程，不得 detached、unref、double-fork 或跨 turn 存活。

### Scenario: Host 启动失败

- **GIVEN** runtime 已在主进程内解析凭据
- **WHEN** Host 在读取首帧前崩溃
- **THEN** run 形成安全 `crashed` 终态且不提交 Agent 回复
- **AND** 进程参数、环境、日志与 renderer DTO 均不含 Key。

### Scenario: Host 结束时仍有普通子进程

- **GIVEN** Pi 工具启动了属于当前 invocation 的前台普通子进程
- **WHEN** invocation 完成、失败或取消
- **THEN** Host 在退出 deadline 内停止并 reap 该进程树
- **AND** 零 helper 在 invocation 结束后继续运行。

## Requirement: Pi 工具与插件只能使用显式受控能力

Source: `docs/product/pages/main-conversation.md#agent-执行与恢复`

Pi MUST 只加载 Moebius 显式提供的 ResourceLoader、工具与插件配置。文件工具 MUST 绑定当前 workspace；命令工具 MUST 接受结构化 command/args/cwd 并使用 `shell:false`。MCP MUST 禁止配置自动扫描、`!command`、script MCP 和任意环境注入；Web MUST 不读取 Pi 明文配置；子 Agent MUST 只允许 depth 1、有界并发、当前 turn 内 join/cancel。全局或项目任意 extension 自动发现 MUST 被禁用。

### Scenario: 项目尝试注入扩展

- **GIVEN** workspace 含 Pi extension 配置或可执行脚本
- **WHEN** Pi run 启动
- **THEN** runtime 只加载 Moebius allowlist 中的资源与工具
- **AND** 项目扩展、脚本和环境指令不被执行。

### Scenario: 外部能力未配置

- **GIVEN** Web、MCP 或 Skills 中一项没有可信配置
- **WHEN** 用户执行基础编码任务
- **THEN** 缺失能力被如实投影为不可用
- **AND** read/edit/structured command 等已就绪基础能力仍可继续。

## Requirement: Pi 跨回合服务只使用 Moebius 托管进程

Source: `docs/product/flows/byok-agent-runtime.md#主流程`

Pi invocation MUST 获得与三套 CLI 相同版本、同一 session/workspace/run capability 绑定的 managed process tools。公开参数 MUST NOT 接受 session ID、workspace root、env、shell、PID 或 PGID。Pi Host、MCP adapter、Web adapter 与 subagent adapter MUST NOT 建立另一套跨回合后台进程。

### Scenario: Pi 启动需跨回合保留的服务

- **GIVEN** Agent 需要启动开发服务器并在下一轮继续检查
- **WHEN** 它调用托管进程工具
- **THEN** 运行项登记到既有 session managed-process 事实并在下一回合可查询/停止
- **AND** Pi Host 本身按当前 turn 正常退出。

## Requirement: Provider 错误只形成安全分类

Source: `docs/product/pages/agent-conversation.md#完整输出`

Pi adapter MUST 将 Provider 结果归类为 auth、model-unavailable、rate-limited、quota、network、provider-unavailable、no-complete-result、crashed 或 cancelled。普通时间线、完整输出和 renderer DTO MUST NOT 包含原始 Provider error body、请求/响应载荷、Authorization、Key、内部协议对象、stderr 或绝对路径；完整输出只能展示更详细的安全投影。

### Scenario: Provider 返回含秘密的错误

- **GIVEN** DeepSeek error body 回显请求头或 Key 片段
- **WHEN** run 失败并打开完整输出
- **THEN** 页面只显示安全原因和匹配恢复入口
- **AND** 原始正文只可进入受信任且经过秘密清洗的有界本机诊断。

## Requirement: 执行代际诚实表达重跑与迁移

Source: `docs/product/pages/main-conversation.md#pi-配置异常与会话迁移`

session member 的执行配置变化 MUST 以 append-only generation 记录。一次性换配置重跑 MUST 使用 derived Provider identity，且不得改变团队配置、base generation 或其 canonical link。永久换模型或跨档案迁移 MUST 封存旧 generation、建立新 Pi session 并明确记录上下文重建；MUST NOT 伪装成原生 resume。

### Scenario: 一次性换配置成功

- **GIVEN** 原 Pi attempt 已进入可重试终态
- **WHEN** 用户选择另一已就绪配置只重跑该步
- **THEN** 新 run 使用独立 derived identity 与 native session
- **AND** 下一条普通消息仍回到 base generation。

### Scenario: 永久迁移当前会话

- **GIVEN** 冻结模型或服务商已经下架
- **WHEN** 用户确认迁移到新档案和模型
- **THEN** 旧 generation 被封存，新 generation 使用安全可见历史摘要建立新 Pi session
- **AND** 页面显示上下文已重建而不是"已恢复原会话"。

## Requirement: 结束继续能力释放队列阻塞

Source: `docs/product/pages/main-conversation.md#三种不可继续状态的共同表现`

用户结束某 Agent 的继续能力后，runtime MUST 将其待发射项持久化为未发送且原目标不可继续；这些项目 MUST 保留正文、附件与原目标，MUST NOT 阻塞团队切换或自动转派。用户只能编辑后重新提交或移除。

### Scenario: 结束后切换团队

- **GIVEN** Agent A 有两条 pending 消息且其 generation 已结束
- **WHEN** 用户选择另一团队
- **THEN** 两条消息成为不阻塞切换的未发送项目
- **AND** 新团队不自动收到它们。

## Requirement: Pi 上下文压缩与附件形成统一事实

Source: `docs/product/pages/agent-conversation.md#完整输出`

Pi MUST 复用托管附件与 prompt 副本边界；图片只进入目录明确支持图片的模型输入，普通文件进入受控读取。首版 DeepSeek V4 为文本输入模型，收到图片时 MUST 在请求 Provider 前以 `model-incompatible` fail closed，并向用户显示可执行的移除图片提示；MUST NOT 静默换模型或声称已经理解图片。上下文压缩后 MUST 在公开时间线追加唯一"已整理较早上下文"系统事实，并继续当前 Pi native session；不得制造第二种用户事件名称或把原始压缩载荷写入 renderer。

### Scenario: 长会话自动压缩后继续

- **GIVEN** Pi session 到达压缩阈值并有较早上下文
- **WHEN** runtime 完成压缩并继续回答
- **THEN** 时间线出现一次"已整理较早上下文"且后续 run resume 同一 native session
- **AND** 完整输出只显示安全摘要与时点。

## Requirement: DeepSeek 真实验证不接触用户项目

Source: `docs/product/flows/byok-agent-runtime.md#3-真实能力验证`

Provider 档案保存前 MUST 在隔离 fixture workspace 发起真实模型请求，要求非空回复并正确调用受控无副作用工具。验证 MUST 可取消、可按 operation ID 丢弃迟到结果，并在用户开始前告知模型数和少量 API 用量。验证失败 MUST 不创建半档案、不修改旧有效 revision。

### Scenario: 多模型 Key 轮换中途失败

- **GIVEN** 档案有两个已验证模型和仍有效的旧 Key
- **WHEN** 新 Key 在第二个模型验证失败
- **THEN** 档案继续使用完整旧 revision 和旧 Key
- **AND** 新 Key、部分验证结果和半档案不可用于运行。
