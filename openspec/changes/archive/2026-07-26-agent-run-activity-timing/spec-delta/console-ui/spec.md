## MODIFIED Requirements

## Requirement: #11 运行记录展示最新活动、明确计时与精确停止
Source: docs/product/pages/agent-conversation.md#页面结构

系统 MUST 让每个活动 run 只占一条原地更新的记录，角色行常驻显示自己的「已进行」时长，活动行只显示当前最新安全活动。专业成员与独立子会话的记录 MUST 提供只作用于该 run 的停下操作；全局主 Agent 的停止仍由 composer 承载。系统 MUST NOT 显示百分比、轮播历史工具事件、把全量过程铺入时间线或让一个 run 的停止/时钟覆盖其他 run。

### Scenario: 多成员并行
- GIVEN 主 Agent 与两个专业成员同时运行
- WHEN 三个 run 的活动与时间分别更新
- THEN 时间线保持三条独立活动记录
- AND 每条记录的活动、时钟和停止目标只绑定自己的 run

### Scenario: 运行中最新活动
- GIVEN 一个成员的 run 已真实启动并产生结构化工具事件
- WHEN 用户查看活动记录
- THEN 角色行显示「已进行」与明确时长
- AND 下一行只显示最新一条安全活动
- AND 页面没有百分比或历史工具列表

## Requirement: 终态只显示一次耗时并按需说明完成时刻
Source: docs/product/pages/agent-conversation.md#完成时间

系统 MUST 在承接 run 的最终 Agent 消息或系统事实中只显示一次「耗时」。完成时刻 MUST 通过耗时控件的悬停、键盘聚焦和屏幕阅读器说明提供；今天、本年内非今天与跨年 MUST 使用产品规定的分级格式。没有真实启动事实时 MUST NOT 显示 `00:00`。

### Scenario: 成功 run 结束
- GIVEN 一个真实启动的 run 成功结束
- WHEN 最终 Agent 消息接管临时活动记录
- THEN 消息常驻显示一次「耗时 mm:ss」
- AND 聚焦耗时可获得「完成于」说明

### Scenario: 未启动失败
- GIVEN 一个 run 未确认进程启动就进入没跑起来终态
- WHEN 系统事实接管临时记录
- THEN 记录不显示耗时或 `00:00`
- AND 完成时刻仍可通过可访问说明获得

## Requirement: 完整输出能力按执行引擎局部降级
Source: docs/product/pages/agent-conversation.md#完整输出

系统 MUST 只为能提供稳定过程记录的 run 显示可点击完整输出入口。Kimi run MUST 保留最新活动、计时和最终回复，但原位说明当前执行不提供可恢复的完整过程记录，MUST NOT 打开空标签或借用 Codex 记录。

### Scenario: Kimi run 工作中
- GIVEN 当前活动 run 的执行引擎是 Kimi
- WHEN 用户查看活动记录
- THEN 最新活动与已进行时长正常显示
- AND 完整输出位置显示不可用说明而不是按钮

## Requirement: 过程标签逐次显示尝试时间并局部降级
Source: docs/product/pages/main-right-sidebar.md#过程标签

系统 MUST 在同一步骤的过程标签内为每次执行显示自己的耗时与完成时刻。单次过程记录缺失 MUST 只在该次执行内显示不可用，MUST NOT 让其他尝试或整个标签失效。

### Scenario: 三次执行中第二次记录缺失
- GIVEN 同一步骤有三次执行且仅第二次 Codex 记录已缺失
- WHEN 用户查看该步骤的过程标签
- THEN 第二次执行原位显示记录不可用
- AND 第一次与第三次执行仍显示各自过程和时间

## Requirement: 恢复不可用事实提供明确重新运行
Source: docs/product/pages/agent-conversation.md#四种事实与异常状态

系统 MUST 将恢复校验失败显示为「原执行已经无法继续」，保留已有耗时，并提供明确的「重新运行」动作。系统 MUST NOT 把它混同为普通没跑起来或暗示会自动重试。

### Scenario: 正常退出后无法恢复
- GIVEN 原 run 的恢复校验失败且已有累计耗时
- WHEN 用户查看终态事实
- THEN 页面显示「原执行已经无法继续」与原耗时
- AND 操作标为「重新运行」而不是自动继续或普通重试
