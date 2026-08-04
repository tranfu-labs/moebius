# local-console delta：agent-team-snapshot-traceability-and-apply

## MODIFIED Requirements

### Requirement: 验收 #6 运行中的团队切换在当前步骤结束后落定

Source: docs/product/pages/main-conversation.md#运行中改选团队

系统 MUST 在会话空闲时立即落定团队切换，在存在当前 effective snapshot 代次的已启动、已调度或排队工作时持久化完整待生效团队版本，并于该代次及其衍生 handoff 全部终结后落定、清空待生效值。系统 MUST 让切换请求之后的新用户消息等待新快照再解析，MUST NOT 因切换中止旧工作、重放历史、提前把旧 handoff 路由到新团队或丢弃消息。

#### Scenario: 旧 run 点击后继续产生 handoff

- **GIVEN** 团队 A 的 Agent 正在运行且会在结束时 handoff 给 A 的另一名成员
- **WHEN** 用户选择团队 B
- **THEN** 两个 A 代次 run 都使用 A 的完整快照并依次终结
- **AND** B 只在 A 代次不再有活动或排队工作后生效
- **AND** 切换后提交的用户消息只按 B 的成员名单解析一次。

#### Scenario: 待生效团队跨进程重启保留

- **GIVEN** 一段会话已持久化待生效的完整团队版本及等待消息
- **WHEN** 本地进程重启并重新打开该会话
- **THEN** 同一目标版本、旧代次和等待消息仍存在
- **AND** 旧代次清空后目标只提升一次。

### Requirement: 验收 #20 会话使用选择时载入的团队内容快照

Source: docs/product/pages/main-conversation.md#选择工作空间与团队

系统 MUST 在会话创建、明确改选团队或显式应用当前团队更新时持久化完整团队快照，至少包含团队稳定身份、历史名称与用途、来源辨认、主 Agent、有序成员身份、每名成员 `AGENT.md` 与 CLI/model/effort，以及可为空的生效载入时间。运行中改选或应用的完整版本 MUST 与团队绑定一起待生效和落定。系统 MUST NOT 因团队页之后的保存自动改变 effective 快照，MUST NOT 用当前磁盘团队回填旧快照缺失字段，也 MUST NOT 用内容快照替代团队健康实时判定。

内部 snapshot key/digest MAY 用于一致性、代次和比较，但 MUST NOT 进入面向用户的 state DTO、错误或时间线。

#### Scenario: 显式应用完整更新

- **GIVEN** 会话 effective 版本 A 与当前有效保存版本 B 在 `AGENT.md` 和 profile 上均不同
- **WHEN** 用户点击任一变化提示的“应用”且没有旧代次工作
- **THEN** B 的完整团队身份、全部成员 Markdown 和全部 profile 一起成为 effective
- **AND** 不存在 Markdown 来自 B 而 profile 仍来自 A 的混合版本。

#### Scenario: 旧快照字段不可证明

- **GIVEN** 升级前会话快照只有成员 Markdown 和部分执行配置
- **WHEN** 系统读取该快照
- **THEN** 已有内容、顺序和 profile 保持不变
- **AND** 未记录的团队身份或载入时间保持缺失
- **AND** 系统不读取当前团队目录补写历史。

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

## ADDED Requirements

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
