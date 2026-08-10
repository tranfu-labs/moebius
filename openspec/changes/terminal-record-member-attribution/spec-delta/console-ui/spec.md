# spec-delta: console-ui / terminal-record-member-attribution

## Requirement: 终局记录保留运行成员身份

Source: docs/product/pages/agent-conversation.md#终局记录归属到执行它的那名成员

由运行产生的终局记录（失败 / 卡住 / 被停下 / 反复重试未成功）MUST 在写入时保留产生它的那次运行的成员身份（role），界面显示的身份 MUST 来自记录本身的 role 投影；与运行无关的系统通知 MUST 保持无成员（role 为空）。存量 `speaker='system' AND role IS NULL AND run_id IS NOT NULL` 的历史记录 MAY 继续使用按 stepId 反推兄弟消息的兼容路径；反推与兜底 MUST NOT 为机器故障编造占位成员名或默认画像，无法确定成员时 MUST 只呈现运行事实与时间。

### Scenario: 新写入的失败记录带成员身份

- **GIVEN** 一个绑定成员 dev 的 run 以失败收场
- **WHEN** 终局记录写入并渲染
- **THEN** 该记录携带 `role='dev'` 且界面表头显示 dev 的真实成员名与画像
- **AND** 不出现「协作者」占位名或「系统提示」表头。

### Scenario: 与运行无关的通知保持无成员

- **GIVEN** 运行时写入一条与任何 run 无关的系统通知（如上下文更新）
- **WHEN** 该记录持久化并渲染
- **THEN** 其 role 保持为空
- **AND** 界面按既有中性系统记录呈现。
