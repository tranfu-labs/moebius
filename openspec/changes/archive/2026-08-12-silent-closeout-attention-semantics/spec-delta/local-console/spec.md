# local-console spec delta：silent-closeout-attention-semantics

### Requirement: 轮次收束重评与持久化一致
Source: docs/product/pages/main-left-sidebar.md#对话状态点与顺序

轮次收束事实（`round_terminal`）与一等收束信号（`primary_closeout`）在同一判定时刻成对落盘时 MUST 被视为同一轮，后续任何重评 MUST 得到与事实日志一致的结论：已存在同 roundId 收束事实时，重评 MUST 返回既有事实的 terminal 状态，MUST NOT 以静默兜底等新结论覆盖投影。静默兜底（`silent-closeout`）只允许在真实静置超窗时落盘；已收束轮次的重复评估 MUST NOT 追加或改写事实。读状态操作（标记已读/未读、查看）MUST NOT 推进会话 `updated_at`——读不是内容活动，不得触发轮次重评或扰动会话排序。

#### Scenario: 收束后重评保持既有结论

- **GIVEN** 会话已有同 roundId 的 `completed` 收束事实与同毫秒的一等收束信号
- **WHEN** 收束 30 秒后重复查询状态
- **THEN** 会话仍投影为同一 `completed` 收束
- **AND** 事实日志不追加 `silent-closeout`。

#### Scenario: 标记已读不触发重评

- **GIVEN** 会话已收束且 `updated_at` 等于收束时刻
- **WHEN** 用户标记已读
- **THEN** 会话 `updated_at` 保持不变
- **AND** 轮次剪枝继续复用既有收束结论。
