# console-ui spec delta：silent-closeout-attention-semantics

### Requirement: Conversation status dot semantics
Source: docs/product/pages/main-left-sidebar.md#对话状态点与顺序

会话点 MUST 以未确认 attention、控制工作、任意未读依次派生 red、blink、blue、none；项目聚合 MUST 排除置顶会话并按 red、blue、blink、none 选择。点与菜单辅助名称 MUST 分别为“需要你处理”“未读”“正在运行”。

收束后投影 MUST 区分需要用户处理与其它收束：`awaiting-user` 收束 MUST 点亮 red；`silent-closeout`（静默兜底）MUST NOT 单独点亮 red——真实异常会话的红点由未确认 attention / unresolvedSystemEventKind 承担，升级前被追溯落盘的 silent-closeout 因此不再把静止历史会话点亮。`completed` / `no-new-content` 收束 MUST 按未读派生 blue / none。

#### Scenario: 静默兜底收束不点亮静止历史会话

- **GIVEN** 一段会话只有一条升级前追溯落盘的 `silent-closeout` 事实且没有未确认异常
- **WHEN** 侧栏渲染该行
- **THEN** 行显示无点
- **AND** 项目聚合不因该会话出现红点。

#### Scenario: 静默兜底收束不掩盖真实异常

- **GIVEN** 一段会话有未确认的 run 异常事实（attention / unresolvedSystemEventKind）与一条 `silent-closeout` 事实
- **WHEN** 侧栏渲染该行
- **THEN** 行仍显示红点（来源为未确认异常，而非收束结论本身）。

#### Scenario: 手动未读不是 Agent 新结果

- GIVEN 用户把静止会话标记为未读且没有 Agent 新结果
- WHEN 侧栏渲染该行
- THEN 行显示蓝点且辅助名称为“未读”
- AND 不声称 Agent 有新结果。

### Requirement: #16 状态点只取确定事实
Source: docs/product/pages/main-conversation.md#操作与反馈

系统 MUST 按红大于蓝大于闪的优先级派生状态点：红点来自三种未处理异常或三种不可继续状态，蓝点来自无人工作、最后消息未提及成员且结果未读，闪点来自成员正在工作。系统 MUST NOT 以用户按停、正常完成、最后消息已提及成员或旧「等人回话」字段触发红点或蓝点；每个红点 MUST 对应时间线中的可读系统记录。静默兜底收束（`silent-closeout`）MUST NOT 单独成为红点来源：升级前被追溯落盘的该事实不点亮静止历史会话，真实异常的红点由未确认异常事实承担。

#### Scenario: 停下不会召回用户
- GIVEN 用户按停后没有其他异常且最后结果已查看
- WHEN 侧边栏渲染该会话和所属项目
- THEN 会话行与项目聚合行都不显示红点
