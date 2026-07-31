# local-console 规格增量：运行监督与一次性执行配置重跑

## 新增：三引擎共享结构化终局

Source: docs/product/pages/agent-conversation.md#指标与验收

local console MUST 让 Codex、Claude 与 Kimi 的执行结果通过穷尽的结构化终局进入 runtime，至少区分 completed、user/system interrupted、idle/tool/max timeout、quota exhausted、retryable rate limited、auth 和 crashed。每个 engine-specific terminal MUST 显式映射；未知 payload MUST 安全落为 crashed/unknown。runtime MUST NOT 通过 reason 字符串前缀、中文错误文本或 CLI 名称特例推断终局。

completed MUST 要求 provider 成功终局和通过现有 Agent 回复契约的非空完整正文。进程退出成功、Kimi `stopReason=end_turn`、空正文或不完整回复本身 MUST NOT 形成成功 Agent message 或推进 Agent 公开时间线 cursor。

原始 provider code/message/data、stderr、路径和内部异常 MAY 进入有界 run-local 诊断，但 MUST NOT 进入普通时间线或 renderer DTO。Kimi ACP JSON-RPC error MUST 保留其原始 code/message/data 到受信任诊断；系统 MUST NOT 依赖 `~/.kimi-code` 内部诊断文件才能形成安全失败。

### Scenario: Kimi 空 end_turn 不冒充成功

- **GIVEN** Kimi `session/prompt` 返回 `stopReason=end_turn`
- **AND** 没有通过 Agent 回复契约的完整非空正文
- **WHEN** local runtime 收束该 run
- **THEN** 它写入 no-complete-result/crashed 终局
- **AND** 不写成功 Agent message、不推进公开回复 cursor
- **AND** 原输入仍可由用户显式重试或换执行配置重跑。

### Scenario: Kimi 中断是用户动作

- **GIVEN** 用户精确停止一个活动 Kimi run
- **WHEN** Kimi adapter 收到 abort 并结束
- **THEN** 终局为 `interrupted{user}`
- **AND** 不得落成 run-not-started、crashed 或 completed。

### Scenario: 未知错误安全降级

- **GIVEN** 任一引擎返回未登记 payload
- **WHEN** adapter 映射终局
- **THEN** 它形成 crashed/unknown 与受信任诊断
- **AND** raw payload 不进入 renderer
- **AND** 编译期穷尽检查覆盖所有已登记联合成员。

## 新增：真实进展驱动监督

Source: docs/product/pages/agent-conversation.md#最新活动
Source: docs/product/pages/agent-conversation.md#运行耗时

只有新增非空 Agent 正文、非空 reasoning、唯一工具调用 started/finished 和明确文件改动 MUST 刷新 local run 的 progress idle deadline。provider retry、配置更新、usage、状态心跳、空 delta、重复或已消费事件 MUST NOT 刷新该 deadline；其中可识别 provider retry 进入下述独立 busy phase，不能识别为结构化 retry 的普通文本回显仍由 progress idle 收敛。Codex/Claude stdout 字节与 Kimi 任意 `session/update` 到达 MUST NOT 自身构成进展。

工具调用从唯一 started 到匹配 finished/result 之间 MUST 被视为已知在途工作，并暂停通用 progress idle、启动独立且更宽的工具执行 deadline；该 deadline 默认三十分钟，覆盖 open-tool 集合从空变为非空到再次清空的连续在途区间，同一区间新增或结束部分并行工具 MUST NOT 重置它。匹配结束且集合清空后 MUST 撤销工具 deadline 并从结束时刻重新计时。Claude 的 streamed `content_block_stop` 只表示模型输出块闭合，MUST NOT 被当成工具完成；系统必须等待对应 `tool_result`，并正确处理一轮中的并行工具结果。provider 缺失 tool id 时，adapter MUST 以本地发生次序稳定配对同类 start/finish；同一 provider id 在前一实例结束后再次出现 MUST 被视为新生命周期，不能被永久去重。没有匹配 started 的 completed/finished MUST 安全降级为非进展 status，不能误删其他在途工具或刷新 idle。工具在途期间 MAY 继续显示当前工具活动，但 local runtime MUST NOT 仅因该工具静默超过普通 idle 窗口而终结 run；工具 deadline 到期 MUST 停止 run 并形成 `timeout{tool}`。

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

## 新增：异常终局持久保留可见正文

Source: docs/product/pages/agent-conversation.md#停下
Source: docs/product/pages/agent-conversation.md#页面状态

任一非成功终局 MUST 在移除 active snapshot 前，先尝试把该 run 最后已经对用户可见的安全 Agent Markdown 与 terminal kind、safe code、content-incomplete、elapsed、step/attempt/run 关联原子写入 session JSONL。SQLite MAY 保存可重建投影，但 MUST NOT 成为该正文的唯一事实源。写入失败 MUST NOT 推进 source cursor、提交成功 Agent message 或把 lifecycle 报告为 completed，并 MUST 保留可由启动恢复识别的未收束 source/lifecycle。

刷新、重启、主会话与 embedded 子任务投影 MUST 恢复同一 partial Markdown 和终局。partial Markdown MUST NOT 同时作为 completed Agent message 出现。升级前没有 partial 字段的旧终局 MUST 兼容为空，不得重写历史。

### Scenario: 中断前正文跨重启保留

- **GIVEN** Kimi 已产生一段可见 Markdown
- **WHEN** 用户停止 run 并重启应用
- **THEN** 时间线仍显示该 Markdown、content-incomplete 和 user-interrupted 终局
- **AND** 没有成功 Agent message 副本。

### Scenario: terminal 提交失败不丢 active

- **GIVEN** runtime 正在把 partial Markdown 写入 terminal fact
- **WHEN** JSONL 或 store 事务失败
- **THEN** runtime 不推进公开 cursor
- **AND** 不把该 run 报告为 completed
- **AND** 恢复路径仍可确定性识别未收束 run。

## 新增：一次性执行配置使用派生 provider 身份

Source: docs/product/pages/agent-conversation.md#重试与恢复
Source: docs/product/pages/main-conversation.md#重试

已停下、timeout、quota/rate-limit、auth 或 no-complete-result 终局 MUST 允许用户以受信任 registry 中的 CLI/model/effort 创建同一步的新 run。override MUST 明确为 single-run，MUST NOT 修改团队成员配置、会话冻结快照、base Agent identity 或其 canonical provider link。

服务端 MUST 在创建 run 前校验 override，并把 override intent、source message、step、attempt 和新 run 原子持久化。合法 override MUST 使用由 base Agent identity、override id 和 override profile fingerprint 派生的独立 provider identity；该 identity 首次允许 full，观察到 external ID 后必须立即固化，正常退出恢复同一 run 时只能 resume 该 ID。

override run 终局后，后续没有 override 的普通 run MUST 继续使用 base profile 和 base canonical external ID。普通 engine/profile mismatch MUST 继续 fail closed，MUST NOT 因本 Requirement 变成 full fallback。任何 override MUST NOT 自动回滚已有文件改动或自动调用第二个引擎。

### Scenario: Kimi 终局临时改用 Codex

- **GIVEN** base Agent identity 绑定 Kimi external session K
- **AND** 用户在该 run 终局选择合法 Codex profile C
- **WHEN** 系统创建同一步下一 attempt
- **THEN** 新 run 以 derived identity full 启动 Codex
- **AND** base snapshot 与 Kimi canonical link K 不变
- **AND** Kimi 不在该 override run 中被调用。

### Scenario: override 后回到基础身份

- **GIVEN** 上一次 single-run Codex override 已终局
- **WHEN** 同一成员收到没有 override 的下一条普通消息
- **THEN** runtime 使用 base Kimi profile resume K
- **AND** 不 resume override Codex session
- **AND** 公开时间线仍包含 override run 的可见结果。

### Scenario: 同次提交幂等而再次确认形成新意图

- **GIVEN** renderer 因重复点击、迟到响应或 callback 变化重复发送同一 submission nonce
- **WHEN** local API 处理这些请求
- **THEN** 同一 nonce 最多创建一个新 run/attempt
- **AND** 不创建第二个 derived provider identity
- **BUT WHEN** 用户在终局卡片再次显式确认同一执行配置
- **THEN** renderer 生成新 nonce，runtime 接纳新的重跑意图而不是静默吞掉。
