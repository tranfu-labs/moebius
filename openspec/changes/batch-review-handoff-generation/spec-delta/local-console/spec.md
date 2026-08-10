# spec-delta：local-console

## Requirement: 派工世代与晚到结果失效
Source: docs/product/pages/main-conversation.md#说话与提及

系统 MUST 在主 Agent（primary Agent）对某专业成员产生一次派工（worker dispatch）时，为该 (session, role) 持久化一条 `handoff_dispatch` 事实，包含递增整数 generation、该次派工的 runId 与 source message id；同 (session, role) 的后续派工 MUST 分配严格更大的 generation。用户直达派工（user-direct）MUST NOT 记录该事实，也不受世代失效约束。

同一 (session, role) 存在更新派工时，尚未启动的旧派工 run MUST NOT 执行任何 provider 调用，也 MUST NOT 记录 run lifecycle 启动事实。已运行旧派工的回复（speaker 为 agent 且 role 非主 Agent）在回复所属 run 的 generation 落后于该角色最新 generation 时 MUST NOT 触发交棒或主 Agent run，MUST 只推进处理位点（complete-source）；该回复历史消息 MUST 保留在时间线，MUST NOT 被删除或改写。回复所属 run 无对应 `handoff_dispatch` 事实时 MUST 按最新派工处理（不失效）。

系统 MUST NOT 改变 mention 解析规则，MUST NOT 改变用户直达的 FIFO「忙碌成员只排队」语义，MUST NOT 让不同成员之间的派工互相覆盖。

### Scenario: 重复派工只运行最新派工
- GIVEN 主 Agent 回复两次提及成员 qa（两次派工均未被处理），同一 session
- WHEN 第二笔派工的 `handoff_dispatch` 事实落盘且第一笔派工的 run 尚未启动
- THEN 第一笔派工的 run 不执行 provider 调用
- AND 只有第二笔派工的 run 执行并产生成员回复

### Scenario: 晚到回复不继续推动接力
- GIVEN qa 的第一笔派工（generation 1）已运行并产生回复，随后主 Agent 对 qa 产生第二笔派工（generation 2）
- WHEN 主 Agent 处理 qa 第一笔派工的回复且该回复包含合法 mention
- THEN 该回复不触发任何新 run 或派工，只推进处理位点
- AND 该回复仍作为历史消息保留在时间线

### Scenario: 正常单派工链不受影响
- GIVEN qa 完成唯一一笔派工（generation 1）且回复包含合法 mention @visual-qa
- WHEN 主 Agent 处理该回复
- THEN 按既有显式交棒规则启动 visual-qa
- AND qa 的回复不被判定为失效

### Scenario: 用户直达不受世代约束
- GIVEN 用户连续发送两条唯一 mention @qa 消息且 qa 已有活动 run
- WHEN 第二条用户消息进入 qa FIFO
- THEN 第二条消息保持 pending、不覆盖第一条，qa 活动 run 不被中断
- AND 两条消息各自按 FIFO 顺序执行

### Scenario: 跨角色派工互不影响
- GIVEN 主 Agent 先后派工 qa 与 visual-qa
- WHEN qa 完成回复并交棒 visual-qa
- THEN visual-qa 的派工不受 qa 世代影响，按既有规则推进
