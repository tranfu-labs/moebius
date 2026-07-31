# local-console 规格增量

## MODIFIED Requirements

### Requirement: 每个 Agent run 持久化到 provider session 的稳定过程关联

Source: docs/product/pages/main-conversation.md#agent-执行与恢复
Source: docs/product/pages/agent-conversation.md#异常终态

系统 MUST 把 provider session identity observation、所属 Agent identity 的 canonical
session link 与 attempt 的过程读取 execution link 作为可独立判定的事实。Codex
`thread.started` 与 Claude matching `system/init.session_id` 继续在同一核验点提交三者。
Kimi `session/new|resume` 返回并通过一致性核验后 MUST 立即提交 observation 与
canonical link；只有当前 turn 已出现非空 Agent 可见文本或终态工具结果时，才可为该
attempt 提交 `execution_session_link`。

Kimi 空响应失败 MUST 保留 observation/canonical，使后续尝试只 resume 原 session；
MUST NOT 为该失败 run 提交 execution link、Agent 回复或 timeline cursor，也不得因为
缺少 execution link 而创建 replacement session。两阶段的 engine/external id 冲突、
trace-ready 先于 observed、或任一必要 fact 写入失败 MUST fail closed。

过程读取 link MUST 包含 runId、源消息 id、role、engine、external id、startedAt、
profile / context 指纹；同值重放 MUST 幂等，冲突 external id、engine 或归属 MUST
fail closed。

过程读取 MUST 直接使用这个已核验 external id 定位对应 provider 原生记录，不得再从
过程事件、文件时间、role 或最近会话猜测 id。旧 run 只有唯一兼容 link 时可读；缺失或
冲突时只把该 attempt 标为 unavailable。

#### Scenario: Claude init id 直接成为 transcript id

- **GIVEN** Claude full 由 Moebius 生成 UUID S
- **WHEN** Claude `system/init` 返回 S 且 execution link 持久化
- **THEN** 过程读取直接以 S 定位 transcript
- **AND** 不扫描 stream-json 内容寻找另一个 session id。

#### Scenario: Kimi resume 不得换 session

- **GIVEN** Kimi attempt 请求 resume S
- **WHEN** provider 返回 T 且 T 不等于 S
- **THEN** driver fail closed 且不建立 T 的过程 link
- **AND** 过程读取不按最近 wire 或工作目录猜测替代 session。

#### Scenario: Kimi 空响应保留 canonical 但没有过程 link

- **GIVEN** Kimi full 已返回并核验 session id S
- **AND** prompt 只返回裸 `end_turn`，没有非空 Agent 文本或终态工具结果
- **WHEN** invocation 收口
- **THEN** session JSONL 包含 S 的 provider observation 与 canonical Agent link
- **AND** 当前 run 不含 `execution_session_link`、Agent response 或 timeline cursor
- **AND** 下一次 retry 只调用 `session/resume S`，不调用 `session/new` 或其他 CLI。

#### Scenario: Kimi 首个有效证据提交过程 link

- **GIVEN** Kimi session S 已被观察并建立 canonical link
- **WHEN** 当前 turn 首次产生非空 Agent text 或 status 为 completed/failed 的工具结果
- **THEN** 当前 run 幂等提交指向 S 的 `execution_session_link`
- **AND** 后续重复文本或同一工具 update 不建立冲突或重复身份。

### Requirement: 过程读取唯一定位当前 provider 原生记录，缺失时不伪造降级

Source: docs/product/pages/main-right-sidebar.md#provider-原生过程记录可能不可用

系统 MUST 按 attempt 的 engine 与 external session id 分派到 Codex rollout、Claude
transcript 或 Kimi main wire resolver，并在各自生效数据根内唯一定位普通 JSONL 文件。
系统 MUST 校验 configured root、realpath、regular file、device、inode 与读取期间
monotonic size；关联缺失，或候选为零个、多个、损坏、越界、身份变化或不可读时 MUST
返回结构化 unavailable。

系统 MUST NOT 从 Moebius runDir / tmp、`claude-stream.jsonl`、`kimi-acp.jsonl`、
stdout / stderr tail、最终 Agent 回复、重组 prompt 或按时间 / role 猜测的其他文件
恢复过程内容。

#### Scenario: Claude transcript 已被删除

- **GIVEN** run execution link 仍指向 Claude session S
- **AND** S 的 transcript 已被移走
- **WHEN** 客户端请求该 attempt 的过程
- **THEN** 接口返回 Claude provider 的 unavailable
- **AND** 响应不含 stream-json tail、最终回复或 Codex rollout。

#### Scenario: 读取期间原生文件被替换

- **GIVEN** previous page 已绑定 provider trace 的 device 与 inode
- **WHEN** 下一页读取前文件被替换
- **THEN** 接口返回 cursor-invalid / unavailable
- **AND** 不把两个文件拼为同一 attempt。

### Requirement: 本轮调试上下文直接读取 provider 原生记录

Source: docs/product/pages/main-right-sidebar.md#过程标签

系统 MUST 让每个 provider adapter 返回带原生 label、source 与 recorded/unavailable
状态的有序 context sections。Codex MUST 读取 rollout 的 system/developer/user；
Claude MUST 读取 transcript 实际存在的 user/assistant/session metadata；Kimi MUST 读取
wire 的 systemPrompt、turn.prompt、context 与 request metadata。系统 MUST NOT 要求
三 provider 返回相同 section，也不得根据当前 persona、团队、时间线或另一 provider
字段重组缺失内容。

#### Scenario: Claude 没有 Codex developer 层

- **GIVEN** Claude transcript 记录了用户消息、assistant 内容与工具事实但没有
  Codex 式 developer prompt
- **WHEN** 客户端请求该 attempt 的 context sections
- **THEN** 响应返回 Claude 实际 sections
- **AND** developer 对应能力标记为“该引擎未记录”，不从当前 persona 补造。

### Requirement: Provider 调试投影保留各自原生调用与输出

Source: docs/product/pages/main-right-sidebar.md#过程标签

系统 MUST 让 Codex、Claude、Kimi adapter 分别投影自己记录的 Agent 输出、thinking、
命令 / 工具、参数、结果、错误、诊断、usage 与生命周期事实，并保留 engine、原始协议
类型、可用 ISO 时间戳、call id、name、status、绝对路径、内部标识及受允许 raw
payload。未知事件 MUST 以对应 engine 的 unknown event 保留，不得压进无来源公共
schema 或静默丢弃。

Codex reasoning 与 encrypted reasoning payload MUST 继续过滤；Claude transcript 与
Kimi wire 中已持久化为可读事件的 thinking / reasoning MUST 按来源投影；任何 opaque
或 encrypted payload MUST NOT 被解密、推断或通过 unknown fallback 泄漏。

#### Scenario: Claude thinking 与工具结果保持关联

- **GIVEN** Claude transcript 依次记录 thinking、tool_use C 和 tool_result C
- **WHEN** adapter 投影该范围
- **THEN** 响应按顺序保留可读 thinking 与 C 的参数和结果
- **AND** 每条事件 engine 均为 Claude。

#### Scenario: Kimi unknown loop event 不串成 Codex

- **GIVEN** Kimi wire 出现一个新 `context.append_loop_event`
- **WHEN** adapter 尚无专门 projector
- **THEN** 响应保留 Kimi、原始 type 与安全 raw payload
- **AND** 不使用 Codex event name 或 Claude renderer。

### Requirement: Attempt 元数据使用真实运行事实与 provider identity

Source: docs/product/pages/main-right-sidebar.md#过程标签

系统 MUST 为每个 attempt 返回 engine、实际 model / effort / provider / CLI、runId、
externalSessionId、开始时间、完成时间、耗时和完整 Moebius run status。trace 原生元数据
优先；缺字段时 MAY 使用同一 run immutable execution context 并标明来源，MUST NOT 使用
当前团队配置。provider-specific id 的展示 label MAY 为 thread/session，但 DTO 身份必须
保留 engine。

#### Scenario: 损坏事实把同一步关联到两个 provider

- **GIVEN** 同一步的持久事实异常地出现 Claude 与 Kimi 两种 engine
- **WHEN** 客户端读取过程历史
- **THEN** 冲突 attempt 返回 identity-invalid / unavailable
- **AND** 系统不把两个 provider 的 link、context 或事件拼在一起。

### Requirement: Provider context 按 attempt 惰性完整读取

Source: docs/product/pages/main-right-sidebar.md#响应式与窗口行为

系统 MUST 为 `sessionId + runId + engine` 提供窄 context 读取能力，并复用当前 provider
trace 的真实路径、device / inode 与受信任根校验。读取 MUST 返回完整原生 section 或
稳定 unavailable / malformed；单条完整 record 超过常规页预算时 MUST 允许独占响应，
不得静默截断。过程事件继续反向分页与 append，MUST NOT 在每页重复 context。

#### Scenario: 切换 engine 后旧 context cursor 被拒绝

- **GIVEN** cursor 绑定 Claude attempt A
- **WHEN** 调用方把 cursor 用于 Kimi attempt B
- **THEN** 接口拒绝 cursor
- **AND** A 的内容不进入 B。

### Requirement: 过程 API 跨 attempts 反向分页且保留 provider 边界

Source: docs/product/pages/main-right-sidebar.md#响应式与窗口行为

系统 MUST 从 execution links 恢复同一步全部 attempts，以不透明游标从最新 attempt
末尾反向分页并在页内按时间正序返回；游标 MUST 绑定 session、step、run、engine 与文件
身份。正常同一步 attempts 必须保持冻结的同一 engine；出现不同 engine 属于身份冲突并
局部 unavailable，不得跨 provider 拼接。活动文件 MUST 从 append cursor 读取新增完整
行。每页 MAY 有事件数与字节数上限；单个完整事件超过上限时 MUST 独占一页且不截断，
尾部半行 MUST 等待后续追加。

多个 attempts MAY 通过 resume 指向同一个 external session。系统 MUST 沿用现有
Codex 语义，让每个 attempt 读取该 external session 原生文件的全量窗口，并分别保留
自己的 engine、计时、状态和模型元数据；本 change MUST NOT 按时间戳、turn 或 run
边界推断 attempt 专属事件区间。同一文件事件在多个 attempts 中同源重叠不是重复归属
错误。

#### Scenario: 三 provider 各自的多 attempts 跨页仍保持来源

- **GIVEN** Codex、Claude、Kimi 各有一个包含多 attempts 且跨越多页的步骤
- **WHEN** 客户端分别连续读取到各自 previous cursor 为空
- **THEN** 每个步骤的合并结果保持 attempt 顺序且每条事件带正确 engine
- **AND** 没有重复、截断或跨 provider 内容。

#### Scenario: Resume 后两个 attempts 共享原生 session 全量

- **GIVEN** 同一步 attempt A 创建 provider session S
- **AND** recovery attempt B 明确 resume S 并继续向同一 transcript/wire 追加
- **WHEN** 客户端分别读取 A 与 B
- **THEN** 两个 attempts 保留各自计时、状态和模型元数据
- **AND** 两者事件内容均同源于 S 的全量文件，不按 run 时间区间切分。

## ADDED Requirements

### Requirement: Claude transcript 以精确 session id 和 cwd 定位

Source: docs/product/pages/main-right-sidebar.md#过程标签

系统 MUST 从生效 `CLAUDE_CONFIG_DIR/projects` 或默认 `~/.claude/projects` 的一级 project
目录中查找精确 `<externalSessionId>.jsonl`，并校验合法 UUID、候选唯一、transcript
session id 一致及至少一个主记录 cwd 与 immutable context 一致。系统 MUST NOT 复制
Claude project-key 私有编码算法，不得递归选择 subagent transcript 或按 mtime 选择。

Moebius MUST NOT 设置、重写或受管链接 Claude data root；只有继承的宿主环境提供非空
`CLAUDE_CONFIG_DIR` 时才优先使用它，否则 trusted root MUST 是用户真实
`~/.claude/projects`。resolver MUST NOT 回退到 Moebius data root。即使 trusted root
中同时存在用户自行发起的其他 Claude sessions，也只能打开 execution link 精确 UUID
且通过 immutable cwd 校验的唯一 transcript；不得按 cwd、mtime 或最近会话替代。

provider-declared 大工具结果只可从该 session 的受信任 tool-results sidecar 读取；sidecar
缺失或越界只降级对应事件。

#### Scenario: 两个 project 下出现相同 transcript 名

- **GIVEN** Claude projects 根下两个候选都名为 `<S>.jsonl`
- **WHEN** resolver 定位 S
- **THEN** 返回 duplicate unavailable
- **AND** 不按更新时间或当前 project 名猜一个。

#### Scenario: 用户真实 home 中存在其他 Claude 会话

- **GIVEN** 默认 `~/.claude/projects` 同时包含 Moebius link 的 session S 和用户自行
  发起的其他 session T
- **WHEN** resolver 为 S 定位 transcript
- **THEN** 只读取精确 `<S>.jsonl` 且要求 cwd 与 immutable context 一致
- **AND** 不因 T 的 cwd 相同、mtime 更新或目录更近而读取 T。

### Requirement: Kimi index 安全重锚定到 source home

Source: docs/product/pages/main-right-sidebar.md#过程标签

系统 MUST 通过 `resolveKimiRuntimeHomePaths()` 的 source home 读取
`session_index.jsonl`，按 exact sessionId 与 immutable workDir 选择唯一兼容映射。
`workDirKey` MUST 符合 `wd_<slug>_<sha256(workDir) 前 12 位>`；resolver MUST 只从 index
记录提取相对 workDirKey/sessionId，并在可信 `sourceHome/sessions` 下重构 session
目录，MUST NOT 直接打开 index 中可能指向旧 managed home 或临时 data root 的绝对
`sessionDir`。

managed `sessions` / `session_index.jsonl` 链接损坏但 source 数据完整时，历史过程读取
MAY 继续从 source home 工作；source/index 缺失、冲突、hash/cwd 不匹配或重锚定候选
越界时 MUST 返回安全 unavailable。UI MUST NOT 接收裸路径或 index 原文。

#### Scenario: Index 保留旧 managed home 绝对路径

- **GIVEN** S 的 index 行包含正确 workDir、workDirKey 和 sessionId
- **AND** `sessionDir` 绝对前缀指向已删除的旧 managed home
- **AND** source home 下相同 `<workDirKey>/<S>/agents/main/wire.jsonl` 存在
- **WHEN** resolver 定位 S
- **THEN** 它从 source home 安全读取 main wire
- **AND** 不尝试打开旧 absolute prefix。

#### Scenario: workDir hash 与 context 不符

- **GIVEN** index 行 sessionId 匹配但 workDir 或 key hash 后缀不匹配 immutable cwd
- **WHEN** resolver 定位
- **THEN** 返回 context-mismatch unavailable
- **AND** 不扫描其他 Kimi session 替代。

## RENAMED Requirements

- FROM: `### Requirement: 每个 Agent run 持久化到 Codex thread 的稳定关联`
  TO: `### Requirement: 每个 Agent run 持久化到 provider session 的稳定过程关联`
- FROM: `### Requirement: 过程读取唯一定位 Codex rollout，缺失时不伪造降级`
  TO: `### Requirement: 过程读取唯一定位当前 provider 原生记录，缺失时不伪造降级`
- FROM: `### Requirement: 本轮调试输入直接读取 Codex rollout`
  TO: `### Requirement: 本轮调试上下文直接读取 provider 原生记录`
- FROM: `### Requirement: rollout 调试投影保留未脱敏调用与输出`
  TO: `### Requirement: Provider 调试投影保留各自原生调用与输出`
- FROM: `### Requirement: attempt 元数据使用真实运行事实`
  TO: `### Requirement: Attempt 元数据使用真实运行事实与 provider identity`
- FROM: `### Requirement: prompt stack 按 attempt 惰性完整读取`
  TO: `### Requirement: Provider context 按 attempt 惰性完整读取`
- FROM: `### Requirement: 过程 API 跨 attempts 反向分页且不截断全程`
  TO: `### Requirement: 过程 API 跨 attempts 反向分页且保留 provider 边界`
