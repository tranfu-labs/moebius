# console-ui spec delta：会话成员显示名一致性

## Requirement: 会话所有身份位置使用 effective 快照成员名

Source: `docs/product/pages/agent-teams.md#Agent-身份与说明`

操作台 MUST 以会话提供的 effective 成员身份投影把 message / run role 映射为可读成员名，并在主时间线历史消息、活动运行、终态事实、动作可访问名称、过程标签、子会话卡片和子任务标签中保持一致。成员 slug 已知但显示名不可用时 MUST 显示可辨认的 slug 兜底；只有 role 为空或确实无法映射时才 MAY 显示通用未知成员文案。内置角色兼容映射 MUST NOT 覆盖会话快照中的自定义显示名。

### Scenario: 两个自定义成员保持可区分

- GIVEN 会话投影把 `plan-supervisor` 映射为“方案监督者”、`plan-executor` 映射为“方案执行者”
- WHEN 两名成员分别出现在历史消息、活动 run 或终态事实中
- THEN 每个位置显示与其 slug 对应的真实成员名
- AND 已知成员不显示成“团队成员”“协作者”或“成员未知”

### Scenario: 同成员过程标签复用真实名称

- GIVEN 自定义成员“方案监督者”在同一会话有两个不同 run 输出入口
- WHEN 用户依次打开两个过程标签
- THEN 标签标题依次为“方案监督者”和“方案监督者 2”
- AND 过程内公开输入对该 role 使用“方案监督者”

### Scenario: 子会话使用自己的成员投影

- GIVEN 父会话与已打开子会话拥有不同的 effective 团队身份投影
- WHEN 子会话卡片与子任务标签渲染负责成员、历史消息及活动 run
- THEN 子会话区域使用子会话自己的成员显示名
- AND 不使用父会话当前团队名称覆盖它
