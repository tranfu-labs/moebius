## ADDED Requirements

## Requirement: run 生命周期以执行段事实记录真实耗时
Source: docs/product/pages/agent-conversation.md#运行耗时

系统 MUST 为每个 run 记录排队完成、执行进程启动、暂停/恢复执行段与终态事实，并只累计真实执行段；排队与暂停期间 MUST NOT 计时。未确认执行进程启动的终态 MUST NOT 产生虚假的零耗时。

### Scenario: 进程启动前失败
- GIVEN 一个 run 已离开队列但外部执行进程没有成功启动
- WHEN run 进入没跑起来终态
- THEN API 不提供已进行或耗时
- AND 完成时刻仍记录真实终态时刻

### Scenario: 执行后停止
- GIVEN 一个 run 的执行进程已经启动并运行 84 秒
- WHEN 用户精确停止该 run
- THEN 终态事实记录累计耗时 84 秒与真正停止时刻
- AND 同会话其他 run 的计时不受影响

## Requirement: 活动事实只记录单调、安全的最新投影
Source: docs/product/pages/agent-conversation.md#最新活动

系统 MUST 从当前执行引擎的结构化事件投影有界的动作与安全对象，并按 run 内单调游标原地更新最新活动。系统 MUST NOT 在较新事件完成后回退到较早工具的开始事件，也 MUST NOT 在活动 DTO 中暴露命令参数全集、输出、绝对路径、运行目录、内部 ID 或原始协议类型。

### Scenario: 较新并发工具完成
- GIVEN 较早工具 A 仍运行且较新工具 B 已开始
- WHEN B 产生完成事件
- THEN 最新活动显示 B 的完成态
- AND 后续无新事件时不闪回 A 的开始态

### Scenario: 命令活动脱敏
- GIVEN Codex 运行带绝对路径、内部 id 和多个命令参数
- WHEN runtime 投影命令活动
- THEN DTO 只包含安全的动作与命令对象
- AND 不包含绝对路径、内部 id、cwd 或命令输出

## Requirement: 步骤聚合多次用户触发的独立 run
Source: docs/product/pages/agent-conversation.md#步骤、尝试与-run

系统 MUST 为初次执行建立稳定步骤标识，并让用户重试创建同一步的新 run 与下一尝试序号；改一改重发创建新消息、新步骤和新 run。首版 MUST NOT 自动重试或产生新的 retry-exhausted 事实。

### Scenario: 用户重试
- GIVEN 同一步第 1 次 run 已进入终态
- WHEN 用户点击重试
- THEN 新 run 沿用步骤标识且 attempt 为 2
- AND 新 run 从零独立计时

### Scenario: 改一改重发
- GIVEN 用户停止原 run 并修改原消息后发送
- WHEN 新消息触发执行
- THEN 新 run 使用新的步骤标识且 attempt 为 1
- AND 原消息、原 run 与原耗时保持不变

## Requirement: 正常退出恢复复用原 run 且校验失败不自动重跑
Source: docs/product/pages/agent-conversation.md#重试与恢复

系统 MUST 在正常退出后精确恢复同一外部执行会话时复用原 Moebius run、步骤和 attempt，并把恢复后的真实执行段累加到原耗时；暂停期间 MUST NOT 计时。恢复上下文或外部执行会话校验失败时，系统 MUST 将原 run 收口为「无法继续」并冻结已有耗时，MUST NOT 自动 full 重跑。只有用户点击「重新运行」后，系统才创建同一步的下一 run 与 attempt。

### Scenario: 正常退出后精确恢复
- GIVEN 一个已运行 84 秒的 run 正常退出并成功持久化恢复意图
- WHEN 应用重启且外部执行会话仍可精确定位
- THEN 恢复继续使用原 run id 与 attempt
- AND 新执行段从原 84 秒继续累计，关闭期间不计时

### Scenario: 外部执行会话已不可用
- GIVEN 一个正常退出的 run 已冻结已有耗时
- WHEN 重启时恢复校验发现外部执行会话不可用
- THEN 原 run 进入「无法继续」且执行器不自动 full 重跑
- WHEN 用户点击「重新运行」
- THEN 系统才创建同一步的下一 run 与 attempt 并从零计时
