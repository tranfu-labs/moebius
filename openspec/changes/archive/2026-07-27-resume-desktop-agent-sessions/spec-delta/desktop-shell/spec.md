# desktop-shell 规格增量

## MODIFIED Requirements

### Requirement: AI 建队使用并冻结当前可用 CLI

Source: docs/product/pages/onboarding.md#第-2-步-ai-建队

系统 MUST 继续按 readiness 选择并在 draft 生命周期内冻结 CLI、execution profile 与
隔离 cwd。每个 AI 建队 draft MUST 独占一个冻结 CLI 的 provider session。draft 第一次执行 MAY
创建 Codex thread 或 Kimi session；取得 external ID 后，submit、adjust、retry、恢复及
唯一一次结构 repair MUST 只 resume 该 ID。团队创建成功并结束 draft 后，新建队 draft
MUST 使用新身份，跨 draft MUST NOT 查找或复用 external ID。失败 MUST NOT 跨 CLI。

#### Scenario: 同一 draft 连续调整

- **GIVEN** AI 建队 draft 首轮已经取得 external ID
- **WHEN** 用户回答追问、调整方案并触发一次结构 repair
- **THEN** 所有后续 provider invocation 都是 resume
- **AND** requested external ID 始终相同。

#### Scenario: 跨 draft 隔离

- **GIVEN** 一个 Agent 团队页 draft 已成功创建团队并结束
- **WHEN** 用户再次进入 AI 建队并生成新 draft ID
- **THEN** 新 draft 不读取旧 external ID
- **AND** 新 draft 第一次执行可创建自己的 provider session。

### Requirement: AI 建队失败有界并保留可恢复内容

Source: docs/product/pages/onboarding.md#第-2-步-ai-建队

系统 MUST 继续把非法输出修复限制为最多一次。AI 建队观察到 external ID 后 MUST 立即随 draft 保存，即使当轮随后失败。resume 失败、
requested / observed ID 冲突或 provider 会话不存在时 MUST 只执行一次 resume，MUST
保留 draft ID、external ID、对话和最后有效方案，MUST NOT reset thread、构造
reconstruction prompt、执行 full / `session/new` 或跨 CLI。

renderer MUST 显示
`AI 上下文暂时无法继续，已保留对话和最后有效方案。` 并保留 `重试`，但 MUST NOT
接收 provider ID。

#### Scenario: resume 失败后重试仍保留身份

- **GIVEN** draft 已有 Kimi session ID 和最后有效方案
- **WHEN** `session/resume` 返回 Session not found
- **THEN** draft 进入可重试 failed
- **AND** external ID 不清空
- **AND** 本轮没有 `session/new`
- **AND** 页面显示固定安全文案与 `重试`。

#### Scenario: started 后输出非法

- **GIVEN** 首次 Codex 调用已报告 thread ID
- **WHEN** 输出非法且 repair 失败
- **THEN** failed draft 已保存该 thread ID
- **AND** 下一次 retry resume 同一 thread。

## ADDED Requirements

### Requirement: AI 建队 invocation manifest 仅供内部审计

Source: docs/product/prd.md#desktop-持久-agent-的执行会话连续性

AI 建队每个内部 runDir MUST 记录安全 invocation manifest，至少包含
`full|resume`、requested / observed ID 一致性和 outcome，使测试可以断言失败轮只有
一次 resume 且没有 reconstruction。manifest MUST NOT 包含 prompt、原始模型输出、
provider 密钥或 token，且 MUST NOT 进入 renderer DTO。

#### Scenario: renderer 读取失败 draft

- **GIVEN** resume 失败轮已写 invocation manifest
- **WHEN** renderer 通过 IPC 读取 draft
- **THEN** DTO 只含安全 error、canRetry、消息与最后有效方案
- **AND** 不含 external ID、runDir 或 manifest 内容。
