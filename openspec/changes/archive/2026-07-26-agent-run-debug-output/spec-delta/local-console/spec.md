# local-console delta：agent-run-debug-output

## MODIFIED Requirements

### Requirement: 本轮调试输入直接读取 Codex rollout
Source: docs/product/pages/main-right-sidebar.md#过程标签

系统 MUST 依据每个 attempt 的稳定 run-thread 关联，从受信任 Codex sessions 根内的唯一 rollout 读取 `session_meta.base_instructions`、有序 developer messages、实际 user messages、turn context 与 session metadata。系统 MUST 分层返回 `SYSTEM_PROMPT`、`DEVELOPER_PROMPT`、`USER_INPUT` 及实际 model / effort / provider / CLI / cwd / run / thread 元数据，MUST NOT 根据当前 Agent persona、当前团队、当前时间线或当前执行配置重组历史值。某一层未记录时 MUST 只把该层标为未记录。

#### Scenario: 历史 run 的 prompt stack 与当前配置不同
- GIVEN 一个历史 Codex run 的 rollout 记录了 system、developer、user 三层 prompt 和模型 `model-a`
- AND 当前团队 persona 与模型已经改成另一组值
- WHEN 客户端请求该 attempt 的调试 invocation
- THEN 响应返回 rollout 中的三层原文与 `model-a`
- AND 响应不包含用当前配置重组的替代 prompt

#### Scenario: developer 层未记录
- GIVEN rollout 有 system 与 user 层但没有 developer message
- WHEN 客户端请求调试 invocation
- THEN developer 层状态为未记录
- AND system 与 user 层仍返回自己的原文

### Requirement: rollout 调试投影保留未脱敏调用与输出
Source: docs/product/pages/main-right-sidebar.md#过程标签

系统 MUST 按顺序投影 Agent 原始输出、命令、函数、custom tool、tool search、MCP、文件、错误、诊断与生命周期事件，并保留原始协议类型、ISO 时间戳、call id、name、status、参数、结果、绝对路径、内部标识和已确认范围内的 raw payload。系统 MUST NOT 对路径或 session / run / thread / message / call id 做脱敏、摘要或头尾截断。

#### Scenario: 工具事件含绝对路径与内部标识
- GIVEN rollout 工具参数包含绝对路径 `/Users/person/project/file.ts` 与 `runId=debug-marker`
- WHEN 过程 API 投影该事件
- THEN 响应保留完整绝对路径和 `runId=debug-marker`
- AND 响应不包含 `…/file.ts` 或「内部标识已隐藏」

#### Scenario: 未识别的新事件保留调试线索
- GIVEN rollout 包含一个未识别的新事件
- WHEN 过程 API 投影该记录
- THEN 新事件返回原始协议类型与可展开 raw payload
- AND 不以无信息占位静默吞掉该事件

### Requirement: token 统计可调试且 reasoning 保持过滤
Source: docs/product/pages/main-right-sidebar.md#过程标签

系统 MUST 将 Codex rollout 的 `token_count` / usage 记录投影为独立调试事件，并保留原始协议类型、时间戳以及 input、cached input、output、reasoning output、total 等实际存在的统计字段。系统 MUST 显式过滤 `reasoning`、`agent_reasoning` 与 encrypted reasoning payload，未知事件 fallback MUST NOT 绕过该过滤边界。

#### Scenario: 同一 turn 同时含 token 与 reasoning
- GIVEN rollout 同时包含 token usage、reasoning 文本与 encrypted reasoning payload
- WHEN 过程 API 投影该 turn
- THEN 响应包含 token 统计事件及原始 usage 字段
- AND 响应不包含 reasoning 文本或 encrypted payload

### Requirement: attempt 元数据使用真实运行事实
Source: docs/product/pages/main-right-sidebar.md#过程标签

系统 MUST 为每个 attempt 返回 engine、实际 model / effort / provider / CLI、runId、threadId、开始时间、完成时间、耗时和完整 Moebius run status。实际模型信息优先来自该 rollout；rollout 缺字段时 MAY 使用同一 run 的 immutable execution context 并标明来源，MUST NOT 使用当前团队配置。running、completed、failed、interrupted、stuck 与 paused MUST NOT 被压扁成无法调试的单一 `settled`。

#### Scenario: 失败后重试使用不同模型
- GIVEN 同一步第 1 次执行以 `model-a` failed，第 2 次执行以 `model-b` completed
- WHEN 客户端读取过程历史
- THEN 两个 attempts 分别显示自己的模型、开始 / 完成时间和 failed / completed
- AND 后一次元数据不覆盖前一次

### Requirement: prompt stack 按 attempt 惰性完整读取
Source: docs/product/pages/main-right-sidebar.md#响应式与窗口行为

系统 MUST 为 `sessionId + runId` 提供窄的 prompt stack 读取能力，并复用 rollout 真实路径、设备 / inode 身份和受信任根校验。该读取 MUST 返回完整层内容或稳定的 unavailable / malformed 结果；单个完整 prompt record 超过常规过程页字节预算时 MUST 允许其独占响应，MUST NOT 返回静默截断的半段 prompt。过程事件继续使用反向分页与 append cursor，MUST NOT 在每一页重复携带完整 prompt stack。

#### Scenario: 大 prompt 超过常规过程页预算
- GIVEN 一个 prompt record 超过常规过程事件页的字节预算
- WHEN 客户端展开该层
- THEN 接口以单条完整 record 返回该层首尾全文
- AND 同 attempt 的分页事件仍可读取

#### Scenario: rollout 在读取期间被替换
- GIVEN prompt 读取开始后 rollout 的设备或 inode 发生变化
- WHEN 服务端完成身份校验
- THEN 接口返回稳定 unavailable / cursor-invalid
- AND 不把两个文件的内容拼成一个 prompt stack

### Requirement: 过程读取唯一定位 Codex rollout，缺失时不伪造降级
Source: docs/product/pages/main-right-sidebar.md#codex-过程记录可能不可用

系统 MUST 依据 session fact 中的 threadId 在当前 Codex sessions 根内唯一定位对应 rollout JSONL，并校验真实路径仍位于受信任根；关联缺失，或候选为零个、多个、损坏、越界、不可读时，MUST 返回结构化 unavailable。系统 MUST NOT 从 Moebius runDir / tmp 恢复关联，也不得使用 stdout / stderr tail、最终 Agent 回复、重组 prompt 或按时间 / role 猜测的其他文件冒充调试调用链。

#### Scenario: rollout 已被删除
- GIVEN run-thread link 仍存在但对应 Codex rollout 文件已被删除
- WHEN 客户端请求该步骤过程或 prompt stack
- THEN 接口返回 unavailable
- AND 响应不包含 stdout tail、最终 Agent 回复或重组 prompt fallback
