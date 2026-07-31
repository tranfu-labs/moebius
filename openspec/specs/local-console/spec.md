# local-console 规格

## 域定位

`local-console` 是默认本地对话操作台的数据通道。它复用 GitHub issue runner 已有的 conversation、mention trigger、agent persona 与 Codex driver 能力，但输入输出落在本机 HTTP API 与 `.state/local-console.sqlite`，供 Electron 操作台或本地浏览器客户端使用。本域同时承载辅助只读 observer 的诊断与呈现事实；observer 运行时仍是独立旁路，不并入本地会话状态机。

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
- MUST keep GitHub runner semantics untouched while allowing local child sessions, primary-Agent closeout, and dead-letter/recovery in this domain.
- MUST allow child session orchestration only as local child session creation, `sessions.parent_session_id` persistence, and parent-timeline card aggregation.
- MUST keep existing local acceptance tables readable as legacy history, but normal local execution MUST NOT write new acceptance facts or integration events and MUST NOT use them for routing, repair, join, or status.
- MUST NOT modify `conversation`, `triggers`, agent mention parsing, stage parsing, CEO guardrail, goal-ledger business rules, GitHub issue timeline normalization, GitHub issue intake scheduling, GitHub comment publication, reaction targets, release artifact publication, issue media handling, issue worktree behavior, GitHub driver pool semantics, or other GitHub issue runner semantics to satisfy local-console behavior.
- MUST NOT implement unrelated GitHub parity such as artifact publishing, GitHub child issue side effects, extra worktree diff return behavior beyond the existing local store fact, or unconfirmed cross-mode behavior.

### 辅助只读 observer 入口
- MUST 提供本地只读观察页入口 `pnpm observer`。
- MUST 让观察页进程独立于 runner 进程：observer 启动、崩溃、退出或被强杀不得影响 runner heartbeat、issue processing、driver pool、role thread state、intake state、artifact publishing 或 CEO guardrail 行为。
- MUST NOT 让 runner import、调用或依赖 `src/observer/` 模块。
- MUST 让 observer 只读本地 `config.toml`、`config.local.toml`、`.state/goal-ledger.json`、`.state/github-response-intake.json`、`.state/role-threads.json`、`.state/agent-contexts.json` 与 `.state/run-manifests.jsonl`。
- MUST NOT 让 observer 调用 GitHub、Codex、release upload、artifact publisher 或任何状态 save helper。
- MUST NOT 让 observer 写 `.state/*.json`、`.state/run-manifests.jsonl`、run manifest 副本、release asset、worktree 文件或 runner state。
- MUST 让 observer 只展示本地 watched repository 白名单内的 repository；非白名单 repository 的本地记录 MUST 被忽略。
- MUST 在白名单 repository 没有本地 issue 记录时显示独立空态。
- MUST 在 observer 输入文件存在但不可读、不可解析或 shape 校验失败时显示独立读取失败诊断。
- MUST 让“没有记录”和“读取失败”在文案与视觉状态上可区分。
- MUST 从 GitHub response intake state、role thread state、agent context state 与 run manifest records 聚合 issue 记录，且 MUST NOT 新增业务状态机。
- MUST 标注每个 issue 状态来源，包括 intake mode / failure data、role thread `lastSeenIndex`、agent context worktree data，以及可用时的最新 run manifest stage。
- MUST 逐行解析 `.state/run-manifests.jsonl`，跳过坏行或不完整 record，并保留被跳过行号的诊断。
- MUST 把无换行结尾的截断 JSONL 尾行视为坏 manifest line，跳过该行并保留此前完整 records。
- MUST 诊断 manifest 缺少 `issue` 或 `artifacts` 等必填字段的 record，且不得丢弃其他有效 manifest records。
- MUST 在 `.state` 文件缺失、JSON state 文件损坏、JSONL 行损坏或 manifest record 不完整时继续渲染观察页。
- MUST 把缺失 `.state` 文件分类为 missing diagnostic，而不是读取失败。
- MUST 把损坏的 `config.toml` 或 `config.local.toml` 分类为配置读取失败，而不是空白白名单。
- MUST 从 run manifest records 展示 artifact；`publishedUrl` 存在时显示链接，且 URL 看起来是图片时渲染图片预览。
- MUST 在 `publishedUrl = null` 时把 staged artifact `path` 显示为“未发布”；observer MUST NOT 伪造 URL 或发布 artifact。
- MUST NOT 在 observer UI 提供操作按钮或写动作。
- MUST 在浏览器刷新或新 HTTP 请求时重新读取本地文件；v0 MUST NOT 要求 file watcher。
- MUST 在 observer 启动、页面刷新、artifact 区域查看与 observer 停止后，保持 watched config files、`.state/*.json`、`.state/run-manifests.jsonl`、artifact directories 与 release directories 无新增、无修改。
- MUST 在 `PATH` 前置 fake `gh` 与 fake `codex` 时仍能渲染 observer 页面，且这些 fake command 在 observer request 期间 MUST 没有调用记录。

### Ledger-first 诊断呈现
- MUST upgrade the local observer main view from issue/run-first to ledger-first when `.state/goal-ledger.json` is available and valid.
- MUST let observer read `.state/goal-ledger.json` as a local read-only input; observer MUST NOT write the ledger, call ledger save helpers, or expose a ledger write API.
- MUST bound observer's `.state/goal-ledger.json` read with an observer-local configurable timeout; if the read never settles or exceeds the timeout, observer MUST return an HTTP response with a ledger timeout diagnostic and keep the legacy issue/run section visible.
- MUST keep observer read-only: no GitHub comment writes, no runner write endpoint, no `gh` / `codex` invocation, no release upload, no file watcher, and no operation or confirmation buttons.
- MUST continue rendering the existing issue/run observer section when `.state/goal-ledger.json` is missing, malformed, or shape-invalid.
- MUST render a distinct ledger empty / read-failure state without turning the whole observer page unavailable.
- MUST display only ledger goals related to the local watched repository whitelist in the primary tree. A goal is related when any goal, milestone, task, or phase provenance or issue reference points to a watched repository.
- MUST count fully un-watched ledger goals in diagnostics rather than rendering them in the primary tree.
- MUST display non-whitelisted issue references inside an included goal as disabled or muted references labeled `not watched / no live poll status`; observer MUST NOT hide those references.
- MUST render ledger hierarchy as goal -> milestone -> task, and MUST place tasks without `milestoneId` under a fixed `未归属里程碑任务` group.
- MUST render phase summaries under their owner nodes, where owners are goals, milestones, or tasks.
- MUST highlight the active phase for each owner and keep pending / completed phases collapsed or visually secondary.
- MUST display `no active phase` when an owner has no active phase and MUST display an owner-level ledger error when an owner has multiple active phases; observer MUST NOT infer a substitute global active phase and MUST NOT turn this owner-local condition into a global ledger read-failure fallback.
- MUST display task readiness, quality baseline, dependencies, scope summary, acceptance statement count/results, parent issue ref, child issue refs, latest child acceptance fact, integration acceptance event, runManifestRefs, active phase projection, and blocked/waiting reason when present.
- MUST NOT display full issue/comment bodies, full run manifest JSON records, raw hidden orchestration keys, raw hidden integration keys, raw hidden roundtable keys, tokens, secrets, or unrelated local machine details.
- MUST render human gate visibility without operation capability: who is expected to act, what they are expected to confirm, which ledger fact / issue ref / integration event is the basis, and which GitHub issue should receive the next human comment.
- MUST render `闸口不可定位：ledger 缺 parent/child issue reference` when a gate cannot identify the next GitHub issue from ledger parent/child issue references.
- MUST use only `TaskRecord.runManifestRefs` explicit references as task evidence.
- MUST place run manifest records not explicitly referenced by a task into an `Unlinked local runs` or equivalent legacy diagnostics section; observer MUST NOT count inferred child-issue runs as task evidence.
- MUST detect T6 roundtable child references from bounded child ref notes only when the note contains an exact `moebius-roundtable-key:[a-f0-9]{32}` key shape, show a `roundtable child` badge, and MUST NOT reveal the hidden roundtable key.
- MUST NOT show a roundtable badge for ordinary provenance text or near-miss text that resembles but does not match the exact roundtable key shape.
- MUST NOT treat roundtable completion as child acceptance pass or integration acceptance pass.
- MUST keep the existing observer diagnostics for config, intake state, role threads, agent contexts, run manifests, artifact publish links, unpublished artifact paths, missing files, malformed JSON, malformed JSONL lines, and fake `gh` / `codex` zero invocation.

## 场景

### 场景 LC.OBS.1：白名单 issue 与阶段状态可见
Given `config.local.toml` 包含 `tranfu-labs/moebius`
And 本地状态包含 `tranfu-labs/moebius#50` 的记录
When 用户运行 `pnpm observer` 并打开本地页面
Then 页面显示 issue `50`
And 页面按来源标注 intake、role thread、agent context 与 run manifest 中可用的阶段 / 状态数据

### 场景 LC.OBS.2：有发布截图的 issue 显示预览或链接
Given `.state/run-manifests.jsonl` 包含 `tranfu-labs/moebius#50` 的 record
And 该 record 包含 `publishedUrl` 非空且看起来是图片 URL 的 artifact
When observer 页面渲染该 issue
Then 页面显示该 published URL
And 页面为该 artifact 渲染图片预览

### 场景 LC.OBS.3：未发布 artifact 显示只读路径
Given `.state/run-manifests.jsonl` 包含 `path = "output-artifacts/t4.png"` 的 artifact
And `publishedUrl = null`
When observer 页面渲染该 run
Then 页面把该 artifact 标为“未发布”
And 页面显示 `output-artifacts/t4.png`
And observer 不尝试发布或 serve 该本地文件

### 场景 LC.OBS.4：坏 JSONL 行不让页面崩溃
Given `.state/run-manifests.jsonl` 包含一行损坏 JSON
And 后续行包含有效 manifest records
When observer 页面渲染
Then 有效 records 仍被显示
And 诊断区指出被跳过的损坏行

### 场景 LC.OBS.5：没有记录与读取失败可区分
Given 一个白名单 repository 没有本地 issue 记录
And `.state/role-threads.json` 存在但内容损坏
When observer 页面渲染
Then 空 repository 显示“没有记录”状态
And 诊断区单独显示 `role-threads.json` 读取或解析失败

### 场景 LC.OBS.6：观察页进程被强杀不影响 runner
Given observer server 正在运行
When observer 进程被强杀
And 随后触发一轮 runner heartbeat
Then runner heartbeat 与 issue processing 不 import 或依赖 observer modules
And runner 日志没有 observer 相关错误

### 场景 LC.OBS.7：缺失状态文件是 missing 而不是读取失败
Given 本地配置中存在一个白名单 repository
And `.state/github-response-intake.json`、`.state/role-threads.json`、`.state/agent-contexts.json` 与 `.state/run-manifests.jsonl` 均缺失
When observer 页面渲染
Then 页面成功返回
And 该 repository 显示“没有记录”状态
And 诊断区把这些 state files 分类为 missing，而不是读取失败

### 场景 LC.OBS.8：损坏状态与缺字段 manifest 保留合法记录
Given 一个 state JSON 文件损坏
And `.state/run-manifests.jsonl` 包含一个有效 record、一行损坏 JSON、一个缺少 `issue` 或 `artifacts` 的 record
When observer 页面渲染
Then 有效 manifest record 被显示
And 诊断区指出损坏文件、损坏行与缺失 manifest 字段

### 场景 LC.OBS.9：尾行截断不丢弃此前完整 run
Given `.state/run-manifests.jsonl` 包含一个完整有效 run record
And 最后一行是没有结尾换行的截断 JSON
When observer 页面渲染
Then 完整 run record 被显示
And 诊断区指出截断尾行已跳过

### 场景 LC.OBS.10：只读边界无文件修改
Given observer fixture 目录已记录初始文件列表与内容哈希
When observer 启动、页面刷新三次、artifact 区域被查看且 observer 停止
Then watched config files、`.state/*.json`、`.state/run-manifests.jsonl`、artifact directories 与 release directories 没有新增或修改文件

### 场景 LC.OBS.11：不调用 gh 或 codex
Given fake `gh` 与 fake `codex` commands 被放到 `PATH` 前面
And 这些 fake commands 会记录调用并在被调用时失败
When observer 页面渲染
Then 页面仍可用
And fake invocation logs 为空

### 场景 LC.OBS.12：配置损坏不是空白白名单
Given `config.local.toml` 存在但无法解析
When observer 页面渲染
Then 诊断区显示配置读取失败
And 页面不把所有 repository 误报为“没有记录”

### 场景 LC.OBS.T7.1：目标树展示 watched goal
Given `.state/goal-ledger.json` contains a goal whose task child issue reference points to `tranfu-labs/moebius`
And `config.local.toml` watches `tranfu-labs/moebius`
When the observer page renders
Then the primary view shows that goal as a goal -> milestone -> task tree
And diagnostics do not classify that goal as filtered out

### 场景 LC.OBS.T7.2：完全无白名单关联 goal 不进主树
Given `.state/goal-ledger.json` contains one goal with no provenance or issue reference in a watched repository
When the observer page renders
Then that goal is not shown in the primary tree
And diagnostics count it as not watched

### 场景 LC.OBS.T7.3：非白名单 ref 在 included goal 内置灰
Given a watched goal contains a child issue ref to `other/repo issue 9`
When the observer page renders the task refs
Then `other/repo issue 9` is visible
And it is labeled `not watched / no live poll status`

### 场景 LC.OBS.T7.4：未归属任务固定分组
Given a task has `goalId` but no `milestoneId`
When the observer page renders its goal
Then the task appears under `未归属里程碑任务`
And it is not attached to the first milestone

### 场景 LC.OBS.T7.5：phase owner 映射可信
Given a goal, milestone, and task each have phases
When the observer page renders the tree
Then each phase summary appears under its owner node
And active phases are highlighted
And pending/completed phases are secondary or collapsed

### 场景 LC.OBS.T7.6：无 active 与多个 active 不推断
Given an otherwise valid ledger has owner A with no active phase
And owner B with multiple active phases
When the observer page renders
Then the primary tree still renders
And owner A shows `no active phase`
And owner B shows an owner-level ledger error
And observer does not infer a replacement active phase
And the page does not switch to a global ledger read-failure fallback

### 场景 LC.OBS.T7.7：task detail 显示核心状态映射
Given a task has readiness, quality baseline, dependencies, scope, acceptance statements, parent issue ref, child issue refs, acceptance facts, integration events, and runManifestRefs
When the observer page renders that task
Then those fields are visible as summarized task detail
And full issue/comment bodies, raw hidden keys, and full run manifest JSON are not visible

### 场景 LC.OBS.T7.8：gate 可见但不可操作
Given a task child ref is missing a passed acceptance fact
When the observer page renders the task
Then it shows who is expected to act, what acceptance is waiting, the child issue ref basis, and the next GitHub issue to comment on
And the page contains no confirmation button or write action

### 场景 LC.OBS.T7.9：闸口无法定位时清晰诊断
Given a gate condition exists but the ledger lacks a required parent or child issue reference
When the observer page renders
Then it shows `闸口不可定位：ledger 缺 parent/child issue reference`

### 场景 LC.OBS.T7.10：roundtable child badge 不计入验收
Given one task child ref bounded note contains an exact roundtable hidden key
And another child ref bounded note contains ordinary provenance text
And another child ref bounded note contains near-miss text that is not an exact roundtable key
When the observer page renders the child ref
Then only the exact roundtable child shows a `roundtable child` badge
And the raw hidden key text is not rendered
And ordinary or near-miss notes are not mislabeled as roundtable
And roundtable children are not counted as child acceptance pass or integration acceptance pass

### 场景 LC.OBS.T7.11：explicit runManifestRefs 才是 task evidence
Given a task has one explicit runManifestRef to `.state/run-manifests.jsonl` line 12
And another run manifest record exists for the same child issue but is not explicitly referenced by the task
When the observer page renders
Then line 12 appears as task evidence
And the unreferenced run appears under `Unlinked local runs`

### 场景 LC.OBS.T7.12：坏 ledger fallback 保留 legacy observer
Given `.state/goal-ledger.json` contains malformed JSON
And existing intake/run manifest state is valid
When the observer page renders
Then the ledger tree shows a read-failure empty state
And the existing issue/run observer section still shows valid records

### 场景 LC.OBS.T7.13：ledger read timeout 保留 legacy observer
Given `.state/goal-ledger.json` readFile never settles through an injected reader or fake file system
And existing intake/run manifest state is valid
When the observer page is requested
Then the HTTP response returns within the configured timeout
And the page shows a ledger timeout diagnostic
And the existing issue/run observer section still shows valid records
And fake `gh` and fake `codex` invocation logs are empty

### 场景 LC.OBS.T7.14：observer 零写入零外部命令
Given fixture files are hashed before observer requests
And fake `gh` and fake `codex` commands record invocations
When the observer page renders and local details are expanded
Then watched config files, `.state/*.json`, `.state/run-manifests.jsonl`, artifact directories, and release directories are unchanged
And fake invocation logs are empty

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

### Requirement: Local and GitHub runtime isolation

The local-console domain MUST keep GitHub runner semantics untouched while allowing local equivalents for CEO routing, child sessions, primary-Agent closeout, dead-letter recovery, local role threads, local evidence, worktree diff return, and the terminal startup selection that makes local mode the default.

The local-console domain MUST NOT modify GitHub issue timeline normalization, mention trigger rules, GitHub CEO orchestration, issue intake scheduling, GitHub comment publication, reaction targets, release artifact publication, issue media handling, issue worktree behavior, observer behavior, or GitHub driver pool semantics.

The local-console domain MUST NOT migrate local console session data into GitHub mode, mirror local session data into GitHub runner state, or share runtime writes between local mode and GitHub mode.

The GitHub-mode one-time extraction of existing GitHub runner state from a previously shared SQLite file is owned by the GitHub issue runner startup path and MUST NOT include local console session tables.

#### Scenario: Local startup selection does not change GitHub runner semantics

- **Given** terminal startup selection makes local mode the default
- **When** local-console behavior is implemented
- **Then** GitHub issue timeline normalization, mention trigger rules, issue intake scheduling, GitHub comment publication, reaction targets, release artifact publication, issue media handling, issue worktree behavior, and GitHub driver pool semantics remain governed by their existing GitHub runner specifications
- **And** observer behavior remains governed by the local-console observer specifications

### Requirement: Local default startup

The default terminal `pnpm start` command without `--github-mode` MUST start local console / local mode.

The default local mode startup path MUST use the local console SQLite data chain and MUST NOT start GitHub issue scanning.

The default local mode startup path MUST NOT read GitHub issue bodies, GitHub comments, or GitHub issue lists.

The default local mode startup path MUST NOT require GitHub authentication as a precondition for starting the local console server.

The default local mode startup path MUST start successfully in a clean environment with no configured repositories and no GitHub authentication.

Local mode runtime data MUST remain in the local console SQLite data chain and MUST NOT be mirrored into GitHub response intake, role-thread, agent-context, or goal-ledger state as part of terminal startup selection.

Local mode and GitHub mode MAY use the same data root, but they MUST NOT use the same runtime store tables or state channel for local session messages and GitHub issue runner state.

#### Scenario: Default start enters local mode

- **Given** the user runs `pnpm start` without `--github-mode`
- **When** startup mode is resolved
- **Then** the local console server starts
- **And** GitHub issue scanning does not start
- **And** GitHub issue read adapters are not called

#### Scenario: Clean environment starts local mode without GitHub authentication

- **Given** no repository is configured
- **And** GitHub authentication is unavailable
- **When** the user runs `pnpm start` without `--github-mode`
- **Then** the local console server starts without error
- **And** no GitHub heartbeat is created
- **And** no GitHub issue adapter is called

#### Scenario: Local and GitHub state remain separate

- **Given** local mode writes a representative local session message
- **And** GitHub mode writes a representative GitHub intake or role-thread state entry
- **When** the two state stores are inspected
- **Then** the local session message is visible only through the local SQLite data chain
- **And** the GitHub intake or role-thread state entry is visible only through the GitHub mode state channel
- **And** neither startup mode mirrors the representative data into the other mode

### Requirement: Operational startup documentation

The local-console domain MUST document the mutually exclusive local and GitHub startup modes.

The operational documentation MUST name the GitHub-mode flag as `--github-mode` and state its startup command as `pnpm start -- --github-mode`.

The operational documentation MUST state that bare `pnpm start` enters the default local mode, while the explicit GitHub-mode command starts the pure GitHub runner without the local console SQLite session write path.

The operational documentation MUST state that local mode uses `.state/local-console.sqlite` and GitHub mode uses `.state/github-runner.sqlite`, and that the two runtime data channels are mutually invisible, not mirrored, and not run concurrently.

The operational documentation MUST instruct operators of a persistent GitHub runner to use `pnpm start -- --github-mode` instead of bare `pnpm start`.

#### Scenario: Operator selects a runtime mode

- **Given** an operator reads the startup documentation
- **When** the operator selects a runtime mode
- **Then** `AGENTS.md` documents `--github-mode` and `pnpm start -- --github-mode`
- **And** `AGENTS.md` states that bare `pnpm start` enters local mode
- **And** `AGENTS.md` states that local mode and GitHub mode use isolated data paths
- **And** `AGENTS.md` tells persistent GitHub runner operators to use the explicit GitHub-mode command

## 可验证行为
- `pnpm vitest run tests/observer.test.ts` MUST 通过，覆盖 observer 的白名单聚合、状态来源标注、artifact 发布链接 / 图片预览、未发布 artifact 路径、缺 `.state` 文件、坏 state JSON、坏 JSONL、JSONL 尾行截断、manifest 缺字段、损坏 config 诊断、无写入边界、fake `gh` / `codex` 零调用，以及 observer 被强杀后 runner 测试不受影响。
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
Source: docs/product/pages/main-conversation.md#选择工作空间与团队

系统 MUST 在会话空闲时立即落定团队切换，在会话运行时持久化待生效团队并于当前步骤收尾后落定、清空待生效值，且后续步骤使用新团队。系统 MUST NOT 因团队切换中止当前步骤、重放已完成步骤或丢弃既有对话历史，MUST NOT 为工作空间保留任何待生效路径。

### Scenario: 运行中改选团队
- GIVEN 一段会话正在执行当前步骤
- WHEN 用户改选团队
- THEN 当前执行继续且生效团队保持不变，待生效团队持久化；当前执行结束后待生效值成为生效值并被清空，已完成步骤只出现一次

### Scenario: 待生效团队跨进程重启保留
- GIVEN 一段会话已持久化待生效的团队
- WHEN 本地进程重启并重新打开该会话
- THEN 待生效团队仍存在，并可在当前步骤收尾时正常落定

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
Source: docs/product/pages/main-conversation.md#上下文

系统 MUST 在会话创建或改选团队时持久化当下成员 slug 与 `AGENT.md` 内容，并在后续推进时使用该会话 effective 快照；运行中改选的快照 MUST 与团队绑定一起待生效和落定。系统 MUST NOT 因用户之后在 Agent 团队页修改成员文件而改变已有会话已载入的 prompt 内容，也 MUST NOT 用内容快照替代团队当前健康状态的实时判定。

### Scenario: 团队页后续修改不改变已有会话
- GIVEN 会话已载入团队成员内容版本 A
- WHEN 用户在团队页把同一成员修改为版本 B 后继续该会话
- THEN 下一步仍使用版本 A，且不会从当前团队目录重读版本 B

### Scenario: 运行中改选团队冻结选择时版本
- GIVEN 会话正使用团队 A 执行当前步骤
- WHEN 用户改选团队 B，随后在当前步骤结束前又修改团队 B 的成员文件
- THEN 当前步骤继续使用团队 A，结束后团队 B 的选择时快照生效，下一步使用该快照而非后改版本

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

系统 MUST 在 Codex 发出 `thread.started` 或 Kimi 成功返回 session id 后，通过 session
fact 写漏斗为对应 run 追加过程读取 link，并同步建立或幂等确认所属持久 Agent 身份的
canonical provider-session link。过程读取 link MUST 包含 `runId`、源消息 id、role、
external id、startedAt 与可用的恢复上下文指纹；canonical link MUST 满足
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

## Requirement: 文件读取失败返回可显示原因
Source: docs/product/pages/main-right-sidebar.md#选择文件

系统 MUST 对超出大小上限、非文本、缺失、非普通文件、越出工作空间和工作空间不可用分别返回稳定原因与空行数组。系统 MUST NOT 静默返回空白内容，也 MUST NOT 通过符号链接或路径穿越读取工作空间外的文件。

### Scenario: 请求二进制与越界文件
- GIVEN 当前项目包含一个二进制文件且请求还包含一个 `../` 越界路径
- WHEN 客户端读取两个路径
- THEN 响应分别返回 `binary-file` 与 `outside-workspace`，且都不包含文件内容

## Requirement: 项目文件与改动读取通道保持只读
Source: docs/product/pages/main-right-sidebar.md#弹层与危险操作

系统 MUST 只通过 GET 路由提供改动清单、项目树和文件内容。系统 MUST NOT 因任何读取请求修改文件、执行还原、暂存、提交、推送、切分支或创建分支。

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

New and explicitly switched team snapshots MUST persist each member's effective
`codex | claude | kimi` CLI, model and effort with slug and Agent Markdown. Later team-page changes
MUST NOT change an existing snapshot. Legacy rows without a profile MUST preserve one legacy Codex
identity across first and resume attempts, MUST NOT be populated from current team state and MUST NOT
switch to Claude or Kimi.

The schema migration that admits Claude MUST preserve all existing snapshot rows and relationships
transactionally and idempotently.

#### Scenario: Claude profile is frozen

- **GIVEN** a session snapshot captured `@dev` with Claude/sonnet/high
- **WHEN** the team page later changes `@dev` to Kimi
- **THEN** the existing session still runs Claude/sonnet/high
- **AND** a later new session can capture Kimi.

#### Scenario: Team profile changes after session creation

- **GIVEN** a session snapshot captured `@dev` with Kimi model K and effort high
- **WHEN** the team page later changes `@dev` to Codex model C
- **THEN** the existing session still runs `@dev` with Kimi/K/high
- **AND** a later new session can capture Codex/C.

#### Scenario: Pending switch preserves pre-switch runs

- **GIVEN** a session has multiple started or scheduled runs on team A
- **WHEN** the user selects team B
- **THEN** every pre-switch run keeps its team-A content and profile until terminal
- **AND** team B's complete content/profile snapshot becomes effective only after all of them settle
- **AND** pending handbacks and user messages are then routed to team B's primary Agent.

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

The first-message transaction MUST persist the session, user message, ordered attachments and complete
team snapshot before starting the primary Agent. First messages, later messages, handoffs and retries
MUST directly invoke the driver selected by immutable CLI/model/effort without separate runtime
readiness or model-enumeration preflight; the selected driver's minimum-version gate still runs.
Spawn, authentication, profile application, permission or driver failure MUST become an explicit
“这一步没跑起来” fact while preserving session, message and snapshot. No other CLI may
be invoked.

Recognized structured errors MUST reduce to stable safe codes and actionable explanations. Unknown
failures MUST retain generic failed-attempt presentation and local diagnostic evidence; raw provider
payload and machine-only reasons MUST not enter the timeline.

#### Scenario: First-message Claude authentication fails

- **GIVEN** a new conversation snapshots a Claude-bound primary Agent
- **AND** Claude reports authentication required
- **WHEN** the first message is submitted
- **THEN** session, message and Claude profile remain persisted
- **AND** the run becomes failed with safe login guidance
- **AND** Codex and Kimi call counts are zero.

#### Scenario: First-message bound CLI is missing

- **GIVEN** a valid new-conversation draft snapshots a primary Agent bound to Kimi
- **AND** Kimi cannot be spawned
- **WHEN** the first message is submitted
- **THEN** the session, first user message and Kimi/model/effort snapshot are persisted
- **AND** the primary run becomes failed with a safe Kimi-specific reason
- **AND** the Codex driver is never called.

#### Scenario: First-message configuration is rejected

- **GIVEN** a valid new-conversation draft snapshots a non-empty model/effort combination
- **AND** the bound driver rejects that configuration before prompt
- **WHEN** the first run starts
- **THEN** the submitted user message is not returned to draft state or deleted
- **AND** the run exposes a retryable failed fact using the same immutable snapshot
- **AND** neither the team binding nor snapshot is silently rewritten.

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

### Requirement: 文件引用读取不受位置根限制并保持窗口预算

Source: docs/product/pages/main-right-sidebar.md#文件引用标签

session-scoped 文件引用端点 MUST 只接受绝对 POSIX 文件路径、正整数 line 与可选正整数 column。runtime MUST 解析目标真实路径，并允许读取本机任意位置及任意符号链接真实目标的普通文件，MUST NOT 以当前会话工作空间、Codex sessions root 或其他目录白名单拒绝目标。

路径无法解析、目录、不存在、不可读、二进制或无效 UTF-8 MUST 返回结构化不可用结果，MUST NOT 回退读取相似路径。完成 `realpath` 后，可用响应以及后续 `line-too-large`、`response-too-large`、`line-not-found`、`scan-limit`、`binary-file`、`not-file` 或读取失败响应都 MUST 携带 canonical path；只有无法取得真实路径时保留输入路径。

可用响应 MUST 只返回目标行前后固定有界窗口、真实行号、目标行列与前后截断事实。读取 MUST 流式扫描，并分别受最大扫描字节、单行 UTF-8 字节与响应总 UTF-8 字节硬上限约束；超过单行或响应上限 MUST 返回结构化不可用结果，MUST NOT 返回部分行或整份大型文件。读取 MUST NOT 仅因整文件超过项目文件的 2 MiB 上限而拒绝仍可在上述预算内定位和返回的目标。

#### Scenario: `/tmp` 普通文本

- GIVEN `/tmp` 存在普通 UTF-8 文本文件且目标为第 12 行，该文件不在会话 workspace 或 Codex sessions root 内
- WHEN renderer 请求该文件引用
- THEN 响应可用，只包含第 12 行附近的有界窗口与真实行号
- AND 响应路径是该文件的 canonical path

#### Scenario: 符号链接指向工作空间外

- GIVEN workspace 内路径是一个符号链接，真实目标位于任意其他本机目录
- WHEN renderer 请求该链接
- THEN 响应按真实目标内容可用
- AND 响应路径是链接目标的 canonical path

#### Scenario: 大文件目标窗口

- GIVEN 任意位置的文本文件超过 2 MiB 且目标行在扫描预算内
- WHEN renderer 请求该目标行
- THEN 响应可用且包含目标行
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

分析草稿在发送前 MUST 支持有序、可删除的来源胶囊。提交时，local-console MUST 把仍存在的胶囊按顺序序列化为用户消息顶部唯一的 Markdown 来源块，并与正文和普通附件在同一个 session fact 中原子提交；已发送消息 MUST NOT 继续保存或重复呈现独立胶囊。来源块中的合法 `moebius-ref:` 按下文来源读取规则向新 run 提供只读引用内容，MUST NOT 被当作文件附件或扩展来源项目文件权限。

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

### Requirement: reference-text 生成公开应用内来源链接

Source: docs/product/flows/session-analysis.md#2-收集来源引用

local-console reference-text API MUST 要求调用方显式声明 `message` 或 `conversation` 范围，并生成可读标签与公开 `moebius-ref:` 目标。消息级链接 MUST 使用稳定 session/message 标识并提供安全纯文本摘录；对话级链接 MUST 使用稳定 session 标识与可读标题。长文本、Markdown 特殊字符、Emoji、控制字符与空正文 MUST 经过确定性投影、转义和截断。该 API 只生成来源链接；链接在用户消息中启动新 run 时的读取与权限边界由下文来源读取 Requirement 约束。

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

### Requirement: 来源引用在新 run 前读取最新可访问内容

Source: docs/product/flows/session-analysis.md#收集来源引用

任意用户消息中位于可导航 Markdown link 的合法 `moebius-ref:` MUST 在新 run 创建前读取目标当时最新的只读来源；Agent 消息中的引用 MUST NOT 触发来源交付。一次 run 的来源读取 MUST 形成稳定上下文；同一 run 恢复 MUST 沿用该上下文，新 run 才重新读取。

#### Scenario: 消息引用启动新 run

- GIVEN 用户消息包含可访问的消息引用
- WHEN runtime 准备创建新 run
- THEN run 上下文包含目标消息及其关联运行记录
- AND 不授予读取来源项目文件或其他对象的能力。

#### Scenario: 同一 run 恢复

- GIVEN run 已经取得来源上下文后中断
- WHEN 用户继续该 run
- THEN runtime 复用该 run 的既有来源上下文
- AND 不重新读取引用目标。

#### Scenario: 新 run 读取更新

- GIVEN 引用目标在上一次 run 后产生新内容
- WHEN 用户重试、重新运行或重发并创建新 run
- THEN runtime 重新读取引用目标的最新可访问内容。

### Requirement: 来源读取失败不创建新消息或 run

Source: docs/product/flows/session-analysis.md#来源引用不可用

来源读取 MUST 先于新用户消息提交、分析会话创建和新 run 创建。读取失败 MUST 返回可恢复错误，并保持原草稿、既有消息或 pending 项。主 Agent 忙碌时，pending 项 MUST 先按原顺序持久化；只有队首项准备创建 run 时才读取来源。

#### Scenario: 分析首条消息来源失败

- GIVEN 分析草稿的来源目标不可读
- WHEN 用户发送首条消息
- THEN 不创建用户消息、分析会话、父面板入口或 run。

#### Scenario: pending 队首来源失败

- GIVEN 主理人忙碌且队首 pending 项包含不可读引用
- WHEN 该项准备发射
- THEN 该项保持队首并记录失败原因
- AND 不 claim 该项、不创建 run、后续项不发射。

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
