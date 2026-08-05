# local-console 规格增量：extend-local-tool-deadline-2h

## MODIFIED Requirements

### Requirement: 真实进展驱动监督

Source: docs/product/pages/agent-conversation.md#最新活动
Source: docs/product/pages/agent-conversation.md#运行耗时
Source: docs/product/pages/agent-conversation.md#运行监督与异常重跑

只有新增非空 Agent 正文、非空 reasoning、唯一工具调用 started/finished 和明确文件改动 MUST 刷新 local run 的 progress idle deadline。provider retry、配置更新、usage、状态心跳、空 delta、重复或已消费事件 MUST NOT 刷新该 deadline；其中可识别 provider retry 进入下述独立 busy phase，不能识别为结构化 retry 的普通文本回显仍由 progress idle 收敛。Codex/Claude stdout 字节与 Kimi 任意 `session/update` 到达 MUST NOT 自身构成进展。

工具调用从唯一 started 到匹配 finished/result 之间 MUST 被视为已知在途工作，并暂停通用 progress idle、启动独立且更宽的工具执行 deadline；该 deadline 默认两小时（`7_200_000` 毫秒），覆盖 open-tool 集合从空变为非空到再次清空的连续在途区间，同一区间新增或结束部分并行工具 MUST NOT 重置它。local console MUST centrally resolve this deadline: when `MOEBIUS_LOCAL_TOOL_IN_FLIGHT_TIMEOUT_MS` is absent or empty, it MUST use exactly `7_200_000` milliseconds; when the variable contains a positive integer, it MUST use that integer exactly. Existing validation for non-integer, zero, or negative values MUST remain fail-fast, and MUST NOT produce an unlimited deadline. 匹配结束且集合清空后 MUST 撤销工具 deadline 并从结束时刻重新计时。Claude 的 streamed `content_block_stop` 只表示模型输出块闭合，MUST NOT 被当成工具完成；系统必须等待对应 `tool_result`，并正确处理一轮中的并行工具结果。provider 缺失 tool id 时，adapter MUST 以本地发生次序稳定配对同类 start/finish；同一 provider id 在前一实例结束后再次出现 MUST 被视为新生命周期，不能被永久去重。没有匹配 started 的 completed/finished MUST 安全降级为非进展 status，不能误删其他在途工具或刷新 idle。工具在途期间 MAY 继续显示当前工具活动，但 local runtime MUST NOT 仅因该工具静默超过普通 idle 窗口而终结 run；工具 deadline 到期 MUST 停止 run 并形成 `timeout{tool}`。

local console MUST NOT 因总墙钟达到固定上限而停止仍有真实进展的 run。长运行报告阈值 MAY 生成一次可见监督提示，但 MUST NOT 终结 run 或刷新 progress idle。其他运行模式或 provider 自身产生的 max timeout 仍 MUST 被结构化表达，不得与 local long-run report 混同。

识别到 retryable provider/service retry 后，系统 MUST 建立独立 busy phase，在活动投影中显示服务繁忙和观察到的重试次数；次数不可可靠取得时 MUST 省略次数。busy phase 从首个可识别 retry 起使用 `src/config.ts` 集中的独立闸，默认五分钟；到期 MUST 停止该 run 并写 rate-limited 终局。真实进展 MUST 结束当前 busy phase。没有可靠 retry 信号时系统 MUST NOT 猜服务繁忙，而应继续由 progress idle 负责无进展收敛。

### Scenario: 伪活动不能延长 idle

- **GIVEN** Kimi 持续发送配置更新、心跳或无法形成结构化 provider-retry 的普通文本回显
- **AND** 没有正文、reasoning、工具起止或文件改动
- **WHEN** progress idle deadline 到达
- **THEN** run 进入 idle timeout 终局
- **AND** 伪活动没有移动 deadline。

### Scenario: 真实进展刷新监督

- **GIVEN** run 尚未达到 progress idle deadline
- **WHEN** adapter 发出新的非空 reasoning 或唯一 tool-finished 事件
- **THEN** lastProgressAt 更新为该事件时刻
- **AND** 重复同一事件不会再次更新。

### Scenario: 长工具执行不被普通 idle 误杀

- **GIVEN** adapter 已发出唯一 tool-started
- **AND** 对应工具执行时间超过普通 progress idle 窗口
- **AND** 尚未达到独立工具执行 deadline
- **WHEN** 期间没有正文、reasoning 或其他协议事件
- **THEN** 通用 idle 保持暂停且 provider 进程继续运行
- **AND** 匹配 tool-finished/tool-result 到达后重新开始 idle 计时
- **AND** 随后的完整 Agent 回复仍可形成 completed 终局。

### Scenario: 挂死工具由独立 deadline 收束

- **GIVEN** adapter 已发出 tool-started
- **AND** 没有收到匹配 finished/result
- **WHEN** 独立工具执行 deadline 到达
- **THEN** provider 进程被有界停止
- **AND** 终局为 `timeout{tool}`，文案说明工具执行过久
- **AND** run 不会因普通 idle 被提前误杀，也不会无限保持活动。

### Scenario: 缺失与复用 tool id 仍正确配对

- **GIVEN** provider 的一组工具事件缺失 id，或结束后的下一工具复用了相同 id
- **WHEN** adapter 投影这些 start/finish 生命周期
- **THEN** 缺失 id 的同类事件按发生次序配对
- **AND** 复用 id 的第二次 start 建立新的在途实例
- **AND** open-tool 集合最终不会泄漏，也不会在工具仍运行时提前清空。

### Scenario: 长运行只报告

- **GIVEN** run 持续产生真实进展
- **WHEN** local long-run report 阈值到达
- **THEN** 活动投影显示长运行提醒
- **AND** provider 进程保持活动
- **AND** local runtime 不产生 max-duration timeout。

### Scenario: 服务繁忙闸独立收束

- **GIVEN** provider 连续发出可识别 retryable service retry
- **WHEN** busy phase 达到默认五分钟且期间没有真实进展
- **THEN** 活动行在运行中显示观察到的 retry 次数
- **AND** run 以 rate-limited 终局停止
- **AND** 系统不自动调用其他 CLI。

### Scenario: 默认工具 deadline 为两小时

- **GIVEN** local console 未设置 `MOEBIUS_LOCAL_TOOL_IN_FLIGHT_TIMEOUT_MS`
- **WHEN** runtime 解析连续工具在途区间的工具 deadline
- **THEN** deadline 为精确的 `7_200_000` 毫秒
- **AND** open-tool 集合的连续区间和并行工具计时语义保持不变。

### Scenario: 正数环境覆盖按原值使用

- **GIVEN** local console 将 `MOEBIUS_LOCAL_TOOL_IN_FLIGHT_TIMEOUT_MS` 设置为正整数
- **WHEN** runtime 解析连续工具在途区间的工具 deadline
- **THEN** deadline 使用该整数
- **AND** Codex、Claude 与 Kimi 的 ordinary tool execution paths 收到相同值
- **AND** idle、provider busy、long-run report 与 managed-process 语义不变。
