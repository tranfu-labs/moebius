# console-ui 规格增量

## MODIFIED Requirements

### Requirement: 完整输出能力按 provider resolver 局部降级

Source: docs/product/pages/agent-conversation.md#完整输出
Source: docs/product/pages/main-right-sidebar.md#过程标签

系统 MUST 为 resolver registry 支持的 Codex、Claude、Kimi run 显示可点击完整输出入口。
入口只表示当前 engine 有原生读取契约；某个 attempt 的 link 或原生文件缺失 MUST 在过程
标签内部局部显示 provider-specific unavailable，不得在主时间线把整个 engine 永久
标为不支持。未知 future engine MAY 原位显示 capability unavailable。

系统 MUST NOT 打开另一执行引擎的记录、借用最终回复或显示与 run engine 不一致的名称。
`kimi-empty-response` attempt 没有 execution link 时，完整输出 MUST 只显示 Kimi
过程记录不可用，不得读取 canonical session wire、最终回复或其他 provider 内容替代。

#### Scenario: Claude run 工作中

- **GIVEN** 当前活动 run 的执行引擎是 Claude
- **WHEN** 用户查看活动记录并点击完整输出
- **THEN** 最新活动与已进行时长正常显示
- **AND** 右侧栏打开该步骤过程标签并等待或显示 Claude transcript
- **AND** 不出现 Codex 或 Kimi 内容。

#### Scenario: 历史 Kimi link 存在但 wire 已清理

- **GIVEN** Kimi 历史 run 有稳定 execution link 但 main wire 已不存在
- **WHEN** 用户打开完整输出
- **THEN** 标签中仅该 attempt 显示 Kimi 过程记录已不可用
- **AND** 最终回复仍只保留在主对话区。

### Requirement: 过程标签按 provider 原生上下文和事件呈现

Source: docs/product/pages/main-right-sidebar.md#过程标签

系统 MUST 为每个 attempt 先显示状态、独立计时、开始 / 完成时间、engine、model /
effort / provider / CLI 和原始 run / external session 标识，再显示 provider 返回的有序
context sections，最后按时间顺序显示 engine-discriminated 事件。

Codex sections MAY 为 system/developer/user；Claude 与 Kimi MUST 使用自己的原生 label
与 source。不存在的字段 MUST 显示“该引擎未记录”，MUST NOT 伪造固定三层或把所有字段
拼成无来源文本。

#### Scenario: Claude attempt 展示自己的原生结构

- **GIVEN** Claude 响应包含 user context、thinking、tool use 和 tool result
- **WHEN** 用户展开 attempt
- **THEN** 页面标明 Claude 并分别显示实际 context 和三类事件
- **AND** 不生成空的 Codex developer prompt 内容。

#### Scenario: Kimi attempt 展示自己的原生结构

- **GIVEN** Kimi 响应包含 systemPrompt、turn.prompt、loop event 和 usage
- **WHEN** 用户展开 attempt
- **THEN** 页面按 Kimi 来源显示这些分区和事件
- **AND** 不把 loop event 标为 Codex rollout event。

### Requirement: Provider 调试事件显示原始字段且安全只读

Source: docs/product/pages/main-right-sidebar.md#过程标签

系统 MUST 按 event engine 选择对应 renderer，并显示可用精确时间戳、原始协议类型、
call id、name、status、参数、结果、Agent 输出、thinking 与允许的 raw payload。绝对
路径和内部标识 MUST 保持原值；控制字符 MUST 转为可见转义；原始内容 MUST 作为只读
文本渲染，不得执行 Markdown、HTML、脚本或终端序列。

Codex reasoning / encrypted payload MUST 不显示；Claude/Kimi 已持久化为可读原生事件的
thinking MUST 显示；opaque / encrypted payload 不得解密或通过 unknown fallback 显示。

#### Scenario: Claude thinking、HTML 工具结果和路径

- **GIVEN** Claude event 含可读 thinking，工具结果含 `<script>`、ESC 与绝对路径
- **WHEN** 用户展开事件
- **THEN** thinking 与完整路径可读
- **AND** script/ESC 只以文本显示且不执行。

### Requirement: 长 provider 调试内容默认折叠且不截断

Source: docs/product/pages/main-right-sidebar.md#过程标签

系统 MUST 让三 provider 的长 context、参数、结果、thinking、raw payload 与 Agent 输出
默认折叠；展开后 MUST 能从首行读到末行并允许选择复制。动态事件继续使用虚拟列表，
DOM 规模 MUST 有界，不得按完整 trace 总事件数线性增长。

#### Scenario: Kimi 大型 wire 含长工具结果

- **GIVEN** Kimi attempt 有大量 loop events 且一个工具结果超过 20 行
- **WHEN** 过程标签首次渲染
- **THEN** 长结果默认折叠且事件 DOM 有界
- **WHEN** 用户展开
- **THEN** 首行、中间行和末行均可见。

### Requirement: Provider context 惰性加载抵抗重渲染、慢返回与失败

Source: docs/product/pages/main-right-sidebar.md#内容更新

系统 MUST 按 `sessionId + runId + engine` 隔离 context 的 idle / loading / ready /
unavailable / error。父级重渲染或 callback 身份变化 MUST NOT 清空已加载内容或重复
请求；切换 attempt、tab、session 或 engine 后迟到响应 MUST NOT 覆盖当前目标；加载
失败 MUST 提供局部重试且已加载事件与阅读位置仍可用。

#### Scenario: Claude 慢请求后切到 Kimi

- **GIVEN** Claude attempt A 的 context 尚未返回
- **WHEN** 用户切换到 Kimi attempt B
- **AND** A 随后成功
- **THEN** 页面仍显示 B 的 Kimi context
- **AND** A 的 Claude 内容没有写入 B。

#### Scenario: 父级 callback 变化后 Kimi 请求成功

- **GIVEN** Kimi context 正在加载且父级重渲染产生新 callback identity
- **WHEN** 原请求成功
- **THEN** 目标 attempt 只进入一次 ready
- **AND** 不重复请求或丢失既有事件。

### Requirement: 同一步多 attempt 各自保留 provider 原生事实

Source: docs/product/pages/main-right-sidebar.md#过程标签

系统 MUST 在同一过程标签按开始顺序显示全部 attempts，并让每个 attempt 使用自己的
engine、模型元数据、状态、时间及 external-session 过程关联。多个 resume attempts
指向同一个 external session 时，它们的 context / events MUST 明确同源于同一原生文件
全量，MUST NOT 暗示页面已按 attempt 切分事件。单次 provider trace 不可用 MUST 只降级
该 attempt。活动标签 MUST 持续轮询，不得在 settled 与 retry 间隙停止。

#### Scenario: Kimi 失败后由同一 Kimi 身份重试

- **GIVEN** 同一步第一次 Kimi failed，第二次 Kimi 通过 resume 同一 session completed
- **WHEN** 用户查看过程标签
- **THEN** 两次分别显示自己的计时、状态和模型元数据
- **AND** 两次 context / thinking / 工具事件明确同源于同一 Kimi wire 全量
- **AND** 页面不声称这些事件已按 attempt 时间区间切分。

### Requirement: Provider 记录不可用时只显示明确空态

Source: docs/product/pages/main-right-sidebar.md#provider-原生过程记录可能不可用

系统 MUST 在 resolver 报告原生记录不可用时显示对应 provider 名与“过程记录已不可用”，
并说明最终回复仍在主对话区。系统 MUST NOT 显示候选路径、裸异常、stdout/stderr、
`claude-stream.jsonl`、`kimi-acp.jsonl` 或最终 Agent 回复副本。

#### Scenario: Claude transcript 被清理

- **GIVEN** 用户从历史 Claude 消息打开过程标签且 transcript 已不存在
- **WHEN** 加载完成
- **THEN** 该 attempt 显示 Claude 过程记录已不可用
- **AND** 不显示诊断流、错误流或保留记录区块。

## RENAMED Requirements

- FROM: `### Requirement: 完整输出能力按执行引擎局部降级`
  TO: `### Requirement: 完整输出能力按 provider resolver 局部降级`
- FROM: `### Requirement: 过程标签以分层调试调用链呈现一次 Agent 执行`
  TO: `### Requirement: 过程标签按 provider 原生上下文和事件呈现`
- FROM: `### Requirement: 调试事件显示原始字段且安全只读`
  TO: `### Requirement: Provider 调试事件显示原始字段且安全只读`
- FROM: `### Requirement: 长调试内容默认折叠且不截断`
  TO: `### Requirement: 长 provider 调试内容默认折叠且不截断`
- FROM: `### Requirement: prompt 惰性加载抵抗重渲染、慢返回与失败`
  TO: `### Requirement: Provider context 惰性加载抵抗重渲染、慢返回与失败`
- FROM: `### Requirement: 同一步多 attempt 各自保留调试事实`
  TO: `### Requirement: 同一步多 attempt 各自保留 provider 原生事实`
- FROM: `### Requirement: Codex 记录不可用时只显示明确空态`
  TO: `### Requirement: Provider 记录不可用时只显示明确空态`
