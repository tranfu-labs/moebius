# local-console 规格增量：BYOK Pi Agent Runtime

## ADDED Requirements

## Requirement: Pi API 是第四种冻结执行配置

Source: `docs/product/flows/byok-agent-runtime.md#主流程`

local-console MUST 将 Pi API 与 Codex、Claude Code、Kimi 作为四种显式执行引擎；Pi 配置 MUST 冻结 Provider 档案 ID、服务商 ID、模型和实际思考程度，MUST NOT 冻结或复制 API Key。存量 CLI 配置 MUST 原位兼容，未知执行配置 MUST fail closed 而不得静默换引擎、档案或模型。

### Scenario: Key 轮换不改变会话身份

- **GIVEN** 一个 Pi 会话已冻结档案 P、模型 M 和思考程度 E
- **WHEN** P 的 Key 完成原子轮换
- **THEN** 后续 run 继续使用同一 Agent identity、execution generation 与 Pi native session
- **AND** session JSONL、SQLite snapshot 和 renderer DTO 都不出现新旧 Key。

### Scenario: 存量 CLI 会话升级

- **GIVEN** 数据根含有升级前的 `{cli, model, effort}` 配置和既有 Provider link
- **WHEN** 新版本读取并继续该会话
- **THEN** 它保持原 CLI、模型、effort、workspace 和 canonical link
- **AND** 不创建 Pi 配置或第二个 Provider session。

## Requirement: Pi Provider 原生会话严格连续

Source: `docs/product/pages/main-conversation.md#agent-执行与恢复`

Pi full/resume MUST 使用与其他 Provider 相同的 canonical identity 原则，并额外校验 Provider 档案、服务商、模型、effort、execution generation、workspace 和 Pi session ID。Moebius session JSONL MUST 保持公开事实源；Pi session/trace MUST 只作为 mode `0600` 的 Provider 原生记录。存在 creation evidence 但 link 缺失、冲突、不唯一或不可恢复时 MUST 零 Provider 调用并形成可操作的不可继续状态。

### Scenario: 正常退出后恢复 Pi 原生上下文

- **GIVEN** Pi run 已观察并持久化唯一 native session ID
- **WHEN** 应用正常退出后用户继续同一 Agent
- **THEN** runtime 只 resume 该 ID，并在页面延续同一原生上下文
- **AND** 不执行 full fallback。

### Scenario: 历史档案缺失

- **GIVEN** 会话保留冻结 Provider 标识但档案记录已缺失
- **WHEN** 用户尝试继续
- **THEN** Provider 调用次数为零
- **AND** 系统只允许迁移到另一已就绪档案或结束继续能力，不提供原配置重建。

## Requirement: Pi Host 使用一次性私有协议且有界退出

Source: `docs/product/flows/byok-agent-runtime.md#参与者与职责`

每个 Pi Provider turn MUST 以前台短生命周期 Host 执行。API Key MUST 仅通过一次性私有 stdin frame 注入 Host 内存，MUST NOT 出现在 argv、env、Pi auth/config 文件、stdout、stderr、manifest、普通诊断或会话事实。Host 终结后 MUST 有界 reap 自身普通子进程，不得 detached、unref、double-fork 或跨 turn 存活。

### Scenario: Host 启动失败

- **GIVEN** runtime 已在主进程内解析凭据
- **WHEN** Host 在读取首帧前崩溃
- **THEN** run 形成安全 `crashed` 终态且不提交 Agent 回复
- **AND** 进程参数、环境、日志与 renderer DTO 均不含 Key。

### Scenario: Host 结束时仍有普通子进程

- **GIVEN** Pi 工具启动了属于当前 invocation 的前台普通子进程
- **WHEN** invocation 完成、失败或取消
- **THEN** Host 在退出 deadline 内停止并 reap 该进程树
- **AND** 零 helper 在 invocation 结束后继续运行。

## Requirement: Pi 工具与插件只能使用显式受控能力

Source: `docs/product/pages/main-conversation.md#agent-执行与恢复`

Pi MUST 只加载 Moebius 显式提供的 ResourceLoader、工具与插件配置。文件工具 MUST 绑定当前 workspace；命令工具 MUST 接受结构化 command/args/cwd 并使用 `shell:false`。MCP MUST 禁止配置自动扫描、`!command`、script MCP 和任意环境注入；Web MUST 不读取 Pi 明文配置；子 Agent MUST 只允许 depth 1、有界并发、当前 turn 内 join/cancel。全局或项目任意 extension 自动发现 MUST 被禁用。

### Scenario: 项目尝试注入扩展

- **GIVEN** workspace 含 Pi extension 配置或可执行脚本
- **WHEN** Pi run 启动
- **THEN** runtime 只加载 Moebius allowlist 中的资源与工具
- **AND** 项目扩展、脚本和环境指令不被执行。

### Scenario: 外部能力未配置

- **GIVEN** Web、MCP 或 Skills 中一项没有可信配置
- **WHEN** 用户执行基础编码任务
- **THEN** 缺失能力被如实投影为不可用
- **AND** read/edit/structured command 等已就绪基础能力仍可继续。

## Requirement: Pi 跨回合服务只使用 Moebius 托管进程

Source: `docs/product/flows/byok-agent-runtime.md#主流程`

Pi invocation MUST 获得与三套 CLI 相同版本、同一 session/workspace/run capability 绑定的 managed process tools。公开参数 MUST NOT 接受 session ID、workspace root、env、shell、PID 或 PGID。Pi Host、MCP adapter、Web adapter 与 subagent adapter MUST NOT 建立另一套跨回合后台进程。

### Scenario: Pi 启动需跨回合保留的服务

- **GIVEN** Agent 需要启动开发服务器并在下一轮继续检查
- **WHEN** 它调用托管进程工具
- **THEN** 运行项登记到既有 session managed-process 事实并在下一回合可查询/停止
- **AND** Pi Host 本身按当前 turn 正常退出。

## Requirement: Provider 错误只形成安全分类

Source: `docs/product/pages/agent-conversation.md#完整输出`

Pi adapter MUST 将 Provider 结果归类为 auth、model-unavailable、rate-limited、quota、network、provider-unavailable、no-complete-result、crashed 或 cancelled。普通时间线、完整输出和 renderer DTO MUST NOT 包含原始 Provider error body、请求/响应载荷、Authorization、Key、内部协议对象、stderr 或绝对路径；完整输出只能展示更详细的安全投影。

### Scenario: Provider 返回含秘密的错误

- **GIVEN** DeepSeek error body 回显请求头或 Key 片段
- **WHEN** run 失败并打开完整输出
- **THEN** 页面只显示安全原因和匹配恢复入口
- **AND** 原始正文只可进入受信任且经过秘密清洗的有界本机诊断。

## Requirement: 执行代际诚实表达重跑与迁移

Source: `docs/product/pages/main-conversation.md#pi-配置异常与会话迁移`

session member 的执行配置变化 MUST 以 append-only generation 记录。一次性换配置重跑 MUST 使用 derived Provider identity，且不得改变团队配置、base generation 或其 canonical link。永久换模型或跨档案迁移 MUST 封存旧 generation、建立新 Pi session 并明确记录上下文重建；MUST NOT 伪装成原生 resume。

### Scenario: 一次性换配置成功

- **GIVEN** 原 Pi attempt 已进入可重试终态
- **WHEN** 用户选择另一已就绪配置只重跑该步
- **THEN** 新 run 使用独立 derived identity 与 native session
- **AND** 下一条普通消息仍回到 base generation。

### Scenario: 永久迁移当前会话

- **GIVEN** 冻结模型或服务商已经下架
- **WHEN** 用户确认迁移到新档案和模型
- **THEN** 旧 generation 被封存，新 generation 使用安全可见历史摘要建立新 Pi session
- **AND** 页面显示上下文已重建而不是“已恢复原会话”。

## Requirement: 结束继续能力释放队列阻塞

Source: `docs/product/pages/main-conversation.md#三种不可继续状态的共同表现`

用户结束某 Agent 的继续能力后，runtime MUST 将其待发射项持久化为未发送且原目标不可继续；这些项目 MUST 保留正文、附件与原目标，MUST NOT 阻塞团队切换或自动转派。用户只能编辑后重新提交或移除。

### Scenario: 结束后切换团队

- **GIVEN** Agent A 有两条 pending 消息且其 generation 已结束
- **WHEN** 用户选择另一团队
- **THEN** 两条消息成为不阻塞切换的未发送项目
- **AND** 新团队不自动收到它们。

## Requirement: Pi 上下文压缩与附件形成统一事实

Source: `docs/product/pages/agent-conversation.md#完整输出`

Pi MUST 复用托管附件与 prompt 副本边界；图片只进入目录明确支持图片的模型输入，普通文件进入受控读取。首版 DeepSeek V4 为文本输入模型，收到图片时 MUST 在请求 Provider 前以 `model-incompatible` fail closed，并向用户显示可执行的移除图片提示；MUST NOT 静默换模型或声称已经理解图片。上下文压缩后 MUST 在公开时间线追加唯一“已整理较早上下文”系统事实，并继续当前 Pi native session；不得制造第二种用户事件名称或把原始压缩载荷写入 renderer。

### Scenario: 长会话自动压缩后继续

- **GIVEN** Pi session 到达压缩阈值并有较早上下文
- **WHEN** runtime 完成压缩并继续回答
- **THEN** 时间线出现一次“已整理较早上下文”且后续 run resume 同一 native session
- **AND** 完整输出只显示安全摘要与时点。

## Requirement: DeepSeek 真实验证不接触用户项目

Source: `docs/product/flows/byok-agent-runtime.md#3-真实能力验证`

Provider 档案保存前 MUST 在隔离 fixture workspace 发起真实模型请求，要求非空回复并正确调用受控无副作用工具。验证 MUST 可取消、可按 operation ID 丢弃迟到结果，并在用户开始前告知模型数和少量 API 用量。验证失败 MUST 不创建半档案、不修改旧有效 revision。

### Scenario: 多模型 Key 轮换中途失败

- **GIVEN** 档案有两个已验证模型和仍有效的旧 Key
- **WHEN** 新 Key 在第二个模型验证失败
- **THEN** 档案继续使用完整旧 revision 和旧 Key
- **AND** 新 Key、部分验证结果和半档案不可用于运行。
