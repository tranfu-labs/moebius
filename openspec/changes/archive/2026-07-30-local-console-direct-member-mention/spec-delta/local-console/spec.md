# local-console spec delta：local-console-direct-member-mention

## MODIFIED Requirements

### Requirement: 主 Agent 控制与成员接力
Source: docs/product/pages/main-conversation.md#说话与提及

local runtime MUST 使用目标 session 的 effective 团队快照解释 composer 用户消息。代码区域外只命中一个不同的有效成员时 MUST 直接把该成员作为首位执行者；没有有效 mention、mention 全部无效或命中两个及以上不同有效成员时 MUST 运行团队主 Agent。系统 MUST 保留原始正文，MUST NOT 修改共享 GitHub mention trigger 或 Agent 回复的既有 handoff 选择规则。

同一有效成员重复出现 MUST 视为一个目标；无效 mention 与唯一有效 mention 并存时 MUST 直达该唯一有效成员。非主 Agent 回复有合法 mention 时 MUST 优先按显式交棒继续，无合法 mention 时 MUST 确定性运行主 Agent；主 Agent 回复无合法 mention 时 MUST 推进 cursor 并结束本轮。主 Agent 提及正在工作的成员时 MUST 中止该成员当前步骤，等待其进入终态后再用新指令启动同成员。系统 MUST NOT 把主 Agent 强制插入每次显式成员间交棒，MUST NOT 让主 Agent 无 mention 回复再次触发自己。

#### Scenario: 唯一有效成员直达

- **GIVEN** effective 团队首成员为 dev-manager，另有 dev 与 qa
- **WHEN** 用户发送 `@qa 请直接检查`
- **THEN** 首个新 run 的 role 为 qa
- **AND** dev-manager 与 dev 不因该用户消息启动。

#### Scenario: 未点名与无效 mention 回主 Agent

- **GIVEN** effective 团队首成员为 dev-manager，另有 qa
- **WHEN** 用户分别发送 `请检查` 与 `@unknown 请检查`
- **THEN** 两条消息的首位执行者都是 dev-manager
- **AND** qa 不因这两条消息启动。

#### Scenario: 多个不同有效成员回主 Agent

- **GIVEN** effective 团队包含 dev-manager、dev、qa
- **WHEN** 用户发送 `@qa 和 @dev 一起看看`
- **THEN** 首位执行者是 dev-manager
- **AND** dev 与 qa 都不被直接启动。

#### Scenario: 重复同一目标仍可直达

- **GIVEN** effective 团队包含 dev-manager 与 qa
- **WHEN** 用户发送 `@qa 请检查，@qa 完成后说明结果`
- **THEN** 有效目标集合只有 qa
- **AND** 首位执行者是 qa。

#### Scenario: 无效 mention 不遮蔽唯一有效目标

- **GIVEN** effective 团队包含 dev-manager 与 qa，且不包含 unknown
- **WHEN** 用户发送 `@unknown 请旁听，@qa 请检查`
- **THEN** 有效目标集合只有 qa
- **AND** 首位执行者是 qa。

#### Scenario: 专业成员无 mention 仍回主 Agent

- **GIVEN** 用户唯一 `@qa` 使 qa 成为首位执行者
- **WHEN** qa 回复没有合法 mention
- **THEN** 下一棒是主 Agent
- **AND** qa 回复不会再次触发自己。

#### Scenario: Agent 显式接力不插入主 Agent

- **GIVEN** qa 的回复包含唯一合法 mention `@dev`
- **WHEN** local runtime 处理该回复
- **THEN** 下一棒是 dev
- **AND** 主 Agent 不被强制插入 qa 与 dev 之间。

### Requirement: 一个主理人 FIFO 与按成员隔离的持久 FIFO
Source: docs/product/pages/main-conversation.md#输入框

主 Agent MUST 保持既有 pending FIFO。每个专业成员 MUST 拥有按 `sessionId + role` 隔离的持久 FIFO；同 role 最多一个 active run，不同 role MAY 与主 Agent 并行。用户直达活动成员时 MUST 只入该成员 FIFO，不得并行启动第二个同 role run，也不得中断当前 run。主 Agent 对活动成员的显式 redirect MUST 保持既有“中断后带新指令重启”语义，系统 MUST 在持久事实和调度类型上区分 redirect 与 user-direct。

#### Scenario: 忙碌成员只排队

- **GIVEN** qa 已有一个活动 run
- **WHEN** 用户发送唯一有效 mention `@qa 再检查第二项`
- **THEN** 该消息以 targetRole=qa 持久化为 pending
- **AND** qa 活动 runId 与 controller 未被中断
- **AND** session 中仍只有一个 qa active run。

#### Scenario: 同成员终态后发射最早一条

- **GIVEN** qa 正在运行且 qa FIFO 依次有消息 A、B
- **WHEN** 活动 qa run 进入任一已确认终态
- **THEN** 系统只领取 A 并启动新的 qa run
- **AND** B 保持 pending
- **AND** A 的 run 启动前 B 不得越过 A。

#### Scenario: 不同成员队列独立

- **GIVEN** qa 忙碌且 qa FIFO 有一条 pending，dev 空闲
- **WHEN** 用户发送唯一 `@dev`
- **THEN** dev 可以启动
- **AND** qa 的活动 run 与 pending 顺序不变。

### Requirement: dispatch、团队切换与恢复使用同一持久事实
Source: docs/product/pages/main-conversation.md#选择项目与添加项目

每条 user message MUST 持久化 dispatch lane、目标 role 与判定原因，或在 pending 团队切换期间持久化为 awaiting-team。升级前没有 dispatch 字段的 pending user message MUST 兼容为主 Agent 目标，历史 completed/displayed 消息、cursor、附件与 provider links MUST NOT 被改写。

切换请求之前已经进入专业成员 FIFO 的消息 MUST 使用旧 effective 快照并阻止团队切换提升，直至这些工作进入终态；切换请求之后的用户消息 MUST 等待新快照生效，再按新团队名单解析。graceful restart MUST 先恢复同 role 活动 run，再领取其 FIFO；orphan running MUST 先形成可见 stuck 或其他真实终态，之后才可释放同 role 下一条。系统 MUST NOT 为直达消息创建 replacement provider session。

#### Scenario: 重启保留忙碌成员队列

- **GIVEN** qa 正在运行，第二条唯一 `@qa` 消息处于 qa FIFO
- **WHEN** 应用正常退出并使用同一数据根重启
- **THEN** 原 qa run 按既有 runId/provider identity 恢复或形成真实不可恢复终态
- **AND** 第二条消息仍显示 targetRole=qa 且顺序不变
- **AND** 原 run 终态前不会启动第二个 qa run。

#### Scenario: 已有会话升级不重解释旧 pending

- **GIVEN** 升级前会话有一条包含 `@qa` 的 pending user message
- **WHEN** 新版本完成 schema migration 与 startup catch-up
- **THEN** 该旧消息仍交给主 Agent
- **AND** 历史时间线与既有 provider links 不变
- **AND** 升级后新发送的唯一 `@qa` 使用新直达规则。

#### Scenario: 切换前后消息使用正确团队

- **GIVEN** 旧团队 qa 正在运行且已有一条旧团队 qa pending
- **WHEN** 用户请求切换团队并在切换等待期间再发送消息
- **THEN** 旧 qa pending 先按旧快照完成并阻止新快照提升
- **AND** 切换等待期间的新消息不启动旧团队成员
- **AND** 新快照提升后才按新团队名单解析新消息。

### Requirement: state 暴露全部待发射目标且保持主理人兼容投影
Source: docs/product/pages/main-conversation.md#团队推进中

local snapshot、state 与 session view MUST 暴露全部 pending dispatch，每项至少包含目标 lane、目标 role 或 awaiting-team 状态。`pendingPrimaryMessages` MAY 在迁移期保留，但 MUST 只包含主 Agent 项。`hasPendingControlWork`、running count、archive guard、session/project summary MUST 覆盖所有成员 pending、活动恢复与待主 Agent 接回结果，MUST NOT 因主 Agent 空闲而把仍有 worker FIFO 的 session 标为 idle。

#### Scenario: 只有专业成员 pending

- **GIVEN** 主 Agent 空闲、qa 正在运行且 qa FIFO 有一条 pending
- **WHEN** 客户端读取 session view
- **THEN** pending dispatch 包含 targetRole=qa 的条目
- **AND** `pendingPrimaryMessages` 不包含该条目
- **AND** `hasPendingControlWork` 为 true。

## Verification Requirements

- MUST provide automated evidence for routing, store atomicity, per-role FIFO, migration, team switch, restart, orphan recovery, provider identity reuse and GitHub zero drift.
- MUST provide real production main-conversation evidence containing the page entry, submitted body, actual started role, roles not started, runId, pending target and restart/provider identity signals.
- MUST isolate no-mention, invalid-mention and multiple-valid-mention fallback observations by new session, or prove the prior session has no active run, pending dispatch or pending control work before the next submission.
- MUST hold and release the busy-role run through a deterministic protocol-compatible provider fixture, and prove no abort signal occurred before the explicit release or intentional application shutdown; manual timing is insufficient.
- MUST NOT claim code-verified based only on unit tests, typecheck, build or a fake component Story.
