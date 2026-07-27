# local-console 规格增量

## MODIFIED Requirements

### Requirement: Session team snapshot freezes each member execution profile

Source: docs/product/pages/main-conversation.md#选择工作空间与团队

For newly created or explicitly switched team snapshots, the system MUST persist each member's
effective CLI/model/effort together with slug and Agent Markdown. Later team-page changes MUST NOT
change the effective profile of an existing session snapshot. Legacy snapshot rows without a
profile MUST preserve one legacy Codex identity across its first and resume attempts, MUST NOT use
provider-session fallback, and MUST NOT be populated from current team state.

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

### Requirement: Execution session links are engine and profile specific

Source: docs/product/pages/main-conversation.md#agent-执行与恢复

The system MUST freeze each run's original team content, role, engine, profile and workspace as an
immutable run execution context. A persistent local Agent identity MUST be
`session + teamSnapshotFingerprint + role`; switching to another team snapshot creates another
identity even when the role slug is unchanged.

For each identity, the system MUST persist provider-session initialization evidence and one
canonical external link in the session JSONL fact source. The link MUST include the identity,
engine, external session id, execution-profile fingerprint and workspace ownership proof. A run
link MAY continue to identify process output, but MUST NOT be the only source of provider-session
continuity.

Only an identity with no provider-session creation evidence MAY use first-run `full` /
`session/new`. After Codex `thread.started` or Kimi `session/new|resume` reports an external id,
the system MUST synchronously append an idempotent canonical link before it can commit a successful
Agent reply. Every later ordinary message, handoff return, retry, edit-resend, rerun or restart for
that identity MUST resume that same id. A successful resume MUST report the requested id; a
different observed id is an identity conflict.

Missing or conflicting ids, incompatible identity/engine/profile/workspace ownership, an
unavailable provider session, or a requested/observed id conflict MUST produce
`unavailable` / `resume-unavailable`. These paths MUST NOT use full fallback, `session/new`,
another engine, a recent-session guess or a replacement session. An explicit recovery intent still
selects the product run/attempt being recovered, but no longer grants permission to create a new
provider session.

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

### Requirement: 每个 Agent run 持久化到 Codex thread 的稳定关联

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

#### Scenario: 失败 run 已建立 provider session

- **GIVEN** 一个 Agent run 已收到合法 external id S，随后失败或被用户中断
- **WHEN** 应用重启并从 session JSONL 恢复
- **THEN** 该 run 的过程读取 link 与所属 Agent 身份的 canonical link 均指向 S
- **AND** 后续运行只可 resume S，无需原 run 成功或依赖 active-run 内存状态。

#### Scenario: 旧 thread link 没有上下文指纹

- **GIVEN** session JSONL 中存在旧版过程读取 link
- **WHEN** planner 为其所属 Agent 身份解析 canonical provider session
- **THEN** 系统保留该 link 的过程读取能力
- **AND** 只有兼容旧事实归一为唯一 external id S 时才迁移并 resume S
- **AND** 零候选或冲突候选返回 unavailable，且不执行 full、`session/new` 或 provider 调用。

### Requirement: 恢复兼容性失败时不自动重新执行

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

#### Scenario: 同一团队快照内改一改重发

- **GIVEN** 当前团队快照中的 Agent 身份已有 canonical external id S
- **WHEN** 用户停止原 run 并执行改一改重发
- **THEN** 新消息与新 run 仍 resume S
- **AND** S 缺失、冲突或不可用时明确失败，不执行 full 或 `session/new`。

#### Scenario: 团队在停下后被切换

- **GIVEN** 原 run 属于团队快照 A 的 Agent 身份并链接 external id S
- **WHEN** 会话切换到团队快照 B，且同一 role 在 B 中形成尚无 creation evidence 的新身份
- **THEN** B 中的新身份可执行自己的首次 `full` / `session/new`
- **AND** A 的身份与 S 保持不变，B 不得把这次首次创建当作 A 的 fallback。

#### Scenario: 正常退出后 provider session 已丢失

- **GIVEN** 正常退出已为原 run 持久化恢复意图及 canonical external id S
- **WHEN** 重启后 provider 报告 S 不可恢复
- **THEN** 原 run 显示「原执行已经无法继续」并保留退出前累计耗时
- **AND** 本轮只有一次 resume S，用户点击「重新运行」也不得触发 full 或 replacement session。

### Requirement: 恢复执行段与缓存用量可诊断

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

#### Scenario: resume 完成并返回 cache 用量

- **GIVEN** Codex 或 Kimi resume 成功并返回可用缓存指标
- **WHEN** 运行完成
- **THEN** session 事实可关联原 run 的新执行段、同一 canonical external id 和缓存指标
- **AND** 普通对话 API 不新增 external id 或 token cache 字段。

#### Scenario: thread 关联持久化暂时失败

- **GIVEN** provider 已发出合法且不冲突的 external id S
- **AND** session fact 写漏斗在同步重试后仍不可用
- **WHEN** 当前 Agent invocation 尝试继续
- **THEN** run 明确失败，成功 Agent 回复与公开时间线 cursor 均不提交
- **AND** 系统不得仅把 S 留在进程内后继续成功
- **AND** 后续 planner 在 creation evidence 已存在但稳定 link 缺失时返回 unavailable，provider 调用次数为零。

## REMOVED Requirements

### Requirement: 仅显式同次未完成执行可以 resume

本 change 删除该 Requirement 及其 `普通下一步骤仍然 full`、`用户重试创建新的 full run`
两个 Scenario。恢复意图只再选择需要恢复的 Moebius run / attempt，不再决定是否允许
resume；同一持久 Agent 身份一旦建立 canonical external id，所有后续运行都按
`Execution session links are engine and profile specific` 继续该 id。

## ADDED Requirements

### Requirement: 每个 Agent 后续只接收未见公开时间线增量

Source: docs/product/pages/main-conversation.md#agent-执行与恢复

Agent 身份首次创建时 MUST 接收当时完整共享时间线；后续 resume MUST 只接收其公开
时间线 cursor 之后、且不是该 Agent 自己已经形成的公开回复，以及这些消息对应的附件。
Agent 回复成功成为公开事实后才可推进 cursor；provider 失败、输出无效或回复未持久化
时 MUST NOT 推进。

#### Scenario: A 返回时看到 B 的回复但不重复完整历史

- **GIVEN** A 的 provider session 已包含首次完整时间线
- **AND** A 离开期间 B 形成一条公开回复
- **WHEN** A 再次运行
- **THEN** resume prompt 包含 B 的新回复与本轮触发消息
- **AND** 不重复注入 A cursor 之前的完整历史。

#### Scenario: 失败不吞掉增量

- **GIVEN** A 的 resume prompt 包含 cursor 之后的两条公开消息
- **WHEN** provider 失败且没有 Agent 回复落库
- **THEN** A 的 cursor 保持不变
- **AND** 用户显式重试仍 resume 同一 ID 并重新选择这两条未确认消息。

### Requirement: local provider invocation 可审计但不进入 renderer

Source: docs/product/prd.md#desktop-持久-agent-的执行会话连续性

每次 local provider invocation MUST 以内部事实或 manifest 记录 mode、requested /
observed ID 一致性与 outcome，使测试可直接断言调用次数和无 fallback。记录 MUST NOT
包含 prompt、provider 密钥或 token，external ID MUST NOT 进入 renderer DTO 或普通
用户文案。

#### Scenario: resume 失败审计

- **GIVEN** 一次 Kimi resume 返回 Session not found
- **WHEN** run 收敛为 unavailable
- **THEN** 内部记录恰有一条 `mode=resume`
- **AND** 不存在同 run 的 `mode=full` 或 `session/new`
- **AND** renderer 只收到安全失败文案和动作。
