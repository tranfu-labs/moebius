# console-ui 规格增量

## ADDED Requirements

### Requirement: Kimi 空响应显示为可重试失败而非空白成功

Source: docs/product/pages/agent-conversation.md#异常终态

系统 MUST 将 `kimi-empty-response` 呈现为「这一步没跑起来」，显示稳定 Kimi 空响应说明
、在终端直接运行 `kimi` 查看详细错误的自查引导与「重试」，并保留真实 engine、失败
状态、attempt 和已启动后的耗时。系统 MUST NOT 渲染空白 Agent 消息、completed 状态、
具体额度/认证猜测、绝对路径、session id 或 provider payload。

该失败 attempt 没有 `execution_session_link` 时，「完整输出」MUST 只显示 Kimi
过程记录不可用，不得读取 canonical session 的 wire、最终回复或其他 provider 内容
替代。

#### Scenario: 真实 Kimi 空 end_turn

- **GIVEN** Kimi attempt 以 `kimi-empty-response` failed fact 收口
- **AND** 当前 run 没有 Agent response 或 execution link
- **WHEN** 用户查看时间线并打开该 attempt 的完整输出
- **THEN** 页面显示「这一步没跑起来」、安全 Kimi 说明、终端 `kimi` 自查引导和「重试」
- **AND** 完整输出显示 Kimi 记录不可用
- **AND** 页面没有空白 Agent bubble、403 原文、路径、session id 或 Codex/Claude 内容。

#### Scenario: 重启后空响应事实保持

- **GIVEN** 同一步两次 Kimi empty attempts 都已失败
- **WHEN** Electron 重启后重新打开会话
- **THEN** 两次 attempts 各自保留 Kimi、failed、计时和安全说明
- **AND** 页面不把任一 attempt 恢复成 completed 或空白 Agent 回复。
