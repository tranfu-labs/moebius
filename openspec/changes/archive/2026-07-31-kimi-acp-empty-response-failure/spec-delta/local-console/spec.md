# local-console 规格增量

## MODIFIED Requirements

### Requirement: 每个 Agent run 持久化到 provider session 的稳定过程关联

Source: docs/product/pages/agent-conversation.md#异常终态

系统 MUST 把 provider session identity observation、所属 Agent identity 的 canonical
session link 与 attempt 的过程读取 execution link 作为可独立判定的事实。Codex
`thread.started`、Claude matching `system/init.session_id` 继续在同一核验点提交三者。
Kimi `session/new|resume` 返回并通过一致性核验后 MUST 立即提交 observation 与
canonical link；只有当前 turn 已出现非空 Agent 可见文本或终态工具结果时，才可为该
attempt 提交 `execution_session_link`。

Kimi 空响应失败 MUST 保留 observation/canonical，使后续尝试只 resume 原 session；
MUST NOT 为该失败 run 提交 execution link、Agent 回复或 timeline cursor，也不得因为
缺少 execution link 而创建 replacement session。两阶段的 engine/external id 冲突、
trace-ready 先于 observed、或任一必要 fact 写入失败 MUST fail closed。

#### Scenario: Kimi 空响应保留 canonical 但没有过程 link

- **GIVEN** Kimi full 已返回并核验 session id S
- **AND** prompt 只返回裸 `end_turn`，没有非空 Agent 文本或终态工具结果
- **WHEN** invocation 收口
- **THEN** session JSONL 包含 S 的 provider observation 与 canonical Agent link
- **AND** 当前 run 不含 `execution_session_link`、Agent response 或 timeline cursor
- **AND** 下一次 retry 只调用 `session/resume S`，不调用 `session/new` 或其他 CLI。

#### Scenario: Kimi 首个有效证据提交过程 link

- **GIVEN** Kimi session S 已被观察并建立 canonical link
- **WHEN** 当前 turn 首次产生非空 Agent text 或 status 为 completed/failed 的工具结果
- **THEN** 当前 run 幂等提交指向 S 的 `execution_session_link`
- **AND** 后续重复文本或同一工具 update 不建立冲突或重复身份。

#### Scenario: Codex 和 Claude link 时机不变

- **GIVEN** Codex 或 Claude 到达既有 external id identity 核验点
- **WHEN** runtime 处理两阶段 callback
- **THEN** observation、canonical 与 execution link 仍在该点提交
- **AND** 本 change 不推迟其过程读取能力。

### Requirement: Local Agent run is hard-routed to the snapshotted engine

Source: docs/product/pages/agent-conversation.md#异常终态

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

## ADDED Requirements

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
