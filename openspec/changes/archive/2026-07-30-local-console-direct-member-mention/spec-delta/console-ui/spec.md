# console-ui spec delta：local-console-direct-member-mention

## MODIFIED Requirements

### Requirement: mc-40 composer 是主理人专属控制面
Source: docs/product/pages/main-conversation.md#输入框

系统 MUST 让已有会话 composer 按 runtime 提供的 dispatch 事实表达消息目标：唯一有效成员 mention 可直达该成员，其余情况交给主 Agent。主 Agent 运行时，composer MUST 同时保留可编辑输入、发送能力和一个只绑定主 Agent `runId` 的方形停止按钮；输入内容、直达其他成员的发送或其他专业成员活动 MUST NOT 隐藏、改写或误绑定该停止按钮。专业 Agent 运行而主 Agent 空闲时，composer MUST NOT 显示主理人停止按钮。

#### Scenario: 主理人运行时仍可直达空闲成员

- **GIVEN** 主 Agent 正在运行、qa 空闲且 composer 包含唯一 `@qa`
- **WHEN** 用户发送
- **THEN** 页面保持“停下主理人”动作绑定原主 Agent runId
- **AND** 发送动作不伪装成停止动作
- **AND** 后续 state 可同时显示主 Agent 与 qa 活动记录。

#### Scenario: 只有专业成员运行

- **GIVEN** qa 正在运行且主 Agent 空闲
- **WHEN** composer 渲染
- **THEN** composer 不显示“停下主理人”
- **AND** qa 的精确停止仍只位于 qa 活动记录。

## ADDED Requirements

### Requirement: 待发射区显示真实目标与恢复状态
Source: docs/product/pages/main-conversation.md#团队推进中

operator console MUST 使用 runtime 的 pending dispatch 投影显示待发射项，逐条展示提交顺序、可读目标成员与正文或附件摘要。主 Agent、专业成员和 awaiting-team MUST 有非猜测的可读目标文案。组件 MUST NOT 从正文 mention 自行推导目标，MUST NOT 把不同成员队列呈现成一个会阻塞彼此的全局 FIFO。

待发射区 MUST 继续与主会话正文列和 composer 对齐，在窄窗口中内部有界滚动且不产生页面级横向滚动。父级使用新 state 重渲染时 MUST 替换旧目标和顺序，不得缓存过期 props。

#### Scenario: 忙碌 qa 的 pending 可见

- **GIVEN** pending dispatch 含两条 targetRole=qa 的用户消息
- **WHEN** operator console 渲染
- **THEN** 两条都显示目标为 qa 的可读名称
- **AND** 顺序与 runtime 投影一致
- **AND** 区域不显示“待发射给主理人”这一错误目标。

#### Scenario: 多目标回主 Agent 的真实结果可见

- **GIVEN** 用户正文含 `@qa @dev`，runtime 投影 targetRole=dev-manager
- **WHEN** 该消息因主 Agent 忙碌进入 pending
- **THEN** 待发射项显示目标为主 Agent 的可读名称
- **AND** UI 不把 qa 或 dev 显示为已排队执行者。

#### Scenario: 团队切换等待项不冒认旧成员

- **GIVEN** pending dispatch 状态为 awaiting-team
- **WHEN** 待发射区渲染
- **THEN** 目标文案说明“新团队生效后决定”
- **AND** 不显示旧团队任一成员为目标。

#### Scenario: 父级更新后目标不陈旧

- **GIVEN** 首次 props 把消息目标显示为 qa
- **WHEN** 父级以相同组件实例重渲染并把该消息更新为 awaiting-team 或新团队成员
- **THEN** 页面只显示最新目标
- **AND** 旧 qa 目标不再可见。
