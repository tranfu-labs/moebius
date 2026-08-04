# local-console 规格增量：托管运行项

## 新增：托管运行项使用会话级结构化能力

Source: docs/product/pages/main-conversation.md#托管运行项

local console MUST 为 Codex、Claude 与 Kimi 的每次 full 和 resume invocation 临时提供同一版本的 `managed_process_start/list/inspect/read_logs/stop` MCP schema。capability MUST 绑定当前 session、workspace identity 和 provider run；公开工具参数 MUST NOT 接受 sessionId、workspace root、PID、PGID、env、shell 或 capability。invocation 结束后 capability MUST 撤销，已经创建的运行项 MUST 继续归属 session 并可由下一回合的新 capability 查询和停止。

`start` MUST 只接受受限 kind、label、单个 executable、args 数组、workspace-relative cwd、可选 readiness 与可选 loopback HTTP endpoint。local console MUST 解析当前会话的真实 workspace root，拒绝绝对 cwd、`..`、symlink escape、外部 host、非法协议、shell 字符串、过量 payload 和其他 session 的 processId。Darwin ownership wrapper MUST 通过 `spawn(executable,args[])` 与 `shell:false` 启动目标。普通 renderer API MUST NOT 提供 start。

`task` MUST 只表示有自然终点、但明确需要跨当前 Provider invocation 存活或由用户持续监督的有限进程。预期在当前 Provider 原生工具调用内结束、结果立即被 Agent 消费的 Python、测试与构建 MUST 继续以前台普通命令执行；运行数分钟本身 MUST NOT 把它升级为 managed task。意图不明确时 Agent MUST 保持前台且不得自行后台化。

### Scenario: 三家 full 与 resume 获得同一工具

- **GIVEN** 同一会话分别绑定 Codex、Claude 与 Kimi
- **WHEN** 每家执行一次首次创建和一次 resume
- **THEN** 每次 invocation 都发现相同名称、版本与 JSON Schema 的 managed-process 工具
- **AND** 新一轮能 list/inspect 前一轮创建的同一 processId
- **AND** invocation 临时 capability 不出现在 Agent prompt、时间线或 renderer DTO。

### Scenario: 越界启动 fail closed

- **GIVEN** Agent 请求绝对 cwd、workspace 外相对路径、symlink escape、外部 endpoint、shell 字符串或伪造 sessionId
- **WHEN** bridge 提交 start
- **THEN** local console 返回稳定结构化拒绝
- **AND** spawn 调用次数为零
- **AND** 注册表和 ownership manifest 均没有新增条目。

### Scenario: 普通命令不被自动认领

- **GIVEN** Agent 正文包含约定 JSON、localhost 链接或 Provider 原生终端使用 `nohup`/后台符号
- **WHEN** 没有成功调用 managed-process MCP start
- **THEN** local console 不创建运行项
- **AND** 不从正文、终端文本或进程扫描猜测所有权。

### Scenario: 有限 task 与普通前台命令边界

- **GIVEN** 一个测试命令预期在当前工具调用内返回结果，另一个训练命令被明确要求跨本轮继续并允许用户随时停止
- **WHEN** Agent 选择执行能力
- **THEN** 测试命令继续使用 Provider 原生前台工具且不出现在运行项注册表
- **AND** 训练命令 MAY 以 kind=task 调用 managed-process start
- **AND** 两者都不得使用后台 shell 绕过各自生命周期。

## 新增：Supervisor 持有进程组、状态、readiness 与有界日志

Source: docs/product/pages/main-conversation.md#托管运行项入口与面板

local console MUST 以不可预测 processId 建立 session/workspace 所有权。Darwin 生产 adapter MUST 用固定 Moebius wrapper 建立 `launchd` job 和 job process group；wrapper 才能以校验后的 `spawn(executable,args[])`、`shell:false` 启动目标。非 Darwin 首版 MUST 不注入该能力或返回稳定 unsupported，target spawn 为零，MUST NOT 退化为 direct child、裸 PID/PGID 租约或后台 shell。每个条目 MUST 结构化区分 starting、running、ready、unhealthy、stopping、exited；spawn 成功 MUST NOT 直接表示 readiness 成功。readiness MUST 支持 none、loopback tcp、loopback http 和有界 stdout literal contains，所有 deadline/interval/threshold MUST 来自集中配置。

supervisor MUST 持续 drain stdout/stderr 到有界 ring，记录 dropped/truncated 事实，并限制单次 MCP/HTTP 读取字节。日志 DTO MUST 转义控制字符，MUST NOT 包含 bridge token、环境变量、Provider 原始 payload 或用户全局配置正文。进程自行退出 MUST 进入 exited 并保存安全 exit code/signal；MUST NOT 从 stderr 文本猜测业务状态或自动重启。

stop MUST session-scoped 且幂等：第一次请求使目标进入 stopping，并由经认证的 wrapper 或精确 launchd service target 对整个 job process group 执行有界 SIGTERM→SIGKILL→bootout/reap；重复请求等待同一 promise。supervisor 和 startup reconciliation MUST NOT 对 manifest 里的裸 PID/PGID 发信号。一个条目的 stop MUST NOT abort Agent run、其他运行项或其他 session 的进程。

### Scenario: HTTP 服务经过 readiness 后可用

- **GIVEN** start 创建一个延迟监听 loopback 端口的服务并声明 HTTP readiness
- **WHEN** launchd wrapper 已启动但端口尚未响应
- **THEN** 状态保持 starting 而不是 ready
- **AND** 探针成功后同一 processId 转为 ready
- **AND** endpoint DTO 与真实可访问 URL 一致。

### Scenario: readiness 失败不自动重启

- **GIVEN** 目标进程存活但 readiness 在截止内未成功
- **WHEN** deadline 到达
- **THEN** 状态进入 unhealthy
- **AND** PID/PGID 保持不变
- **AND** supervisor 不执行命令第二次
- **AND** logs 与 stop 仍可用。

### Scenario: 日志洪泛有界

- **GIVEN** 目标持续写出超过配置上限的 stdout/stderr
- **WHEN** Agent 或 renderer 读取日志
- **THEN** 响应只包含允许的尾部与 truncated/dropped 事实
- **AND** supervisor 继续 drain 子进程管道
- **AND** 内存和单次响应不随总输出无界增长。

### Scenario: 精确停止整棵进程树

- **GIVEN** 两个运行项都处于 ready，目标项还派生了子进程并监听端口
- **WHEN** 当前 session 对目标 processId 调用 stop
- **THEN** 只有目标项进入 stopping 后 exited
- **AND** 目标 PGID、子进程与端口全部消失
- **AND** 另一运行项保持 ready 且端口仍可访问。

## 新增：已退出记录由用户确认后清除

Source: docs/product/pages/main-conversation.md#托管运行项入口与面板

local console MUST 提供 session-scoped `acknowledge-exited` renderer intent，只删除当前 session 已 settled 的 exited 内存条目。它 MUST NOT 停止或删除 active/stopping 条目，MUST NOT 改写 session JSONL/SQLite，也 MUST NOT 暴露为 Agent 可启动或清理进程的 MCP 工具。重复确认 MUST 幂等；失败 MUST 保留原条目和日志供重试。

### Scenario: 确认只清理当前会话的退出记录

- **GIVEN** 当前 session 有两个 exited 条目、一个 active 条目，另一 session 也有 exited 条目
- **WHEN** renderer 对当前 session 确认清除已退出
- **THEN** 只删除当前 session 的两个 exited 内存条目
- **AND** 当前 active 条目与另一 session 条目保持不变
- **AND** 没有进程信号、会话事实写入或 Provider 调用发生。

## 新增：运行项跨 Agent 回合但不跨应用恢复

Source: docs/product/pages/main-conversation.md#退出应用与恢复执行

managed-process 注册表 MUST 跨同一应用生命周期内的 Provider invocation 与 Agent 回合保持，但 MUST NOT 作为可恢复 session fact 写入 JSONL/SQLite，也 MUST NOT 在应用重启后重建或自动执行旧命令。目标退出后的条目 MAY 留在当前进程内供查看；应用重启时注册表 MUST 为空。

supervisor MUST 为每项写入版本化、0600、HMAC 认证且最小化的 ownership manifest，绑定 installation identity、当前 `gui/<uid>` domain、不可预测 service label、processId、session/workspace identity hash 与 plist digest，但不保存目标命令、环境、endpoint 或日志。manifest MUST 在 bootstrap 前原子持久化；bootstrap 失败 MUST 撤销 service 并删除 manifest/plist/start payload，使任何已启动 job 都先有可认证清理身份。Darwin wrapper MUST 作为 launchd job main process 启动目标且显式设置 `AbandonProcessGroup=false`、`KeepAlive=false`、`RunAtLoad=true`，使 job 在本次 bootstrap 启动但退出后不自动重启；旧 start payload 在 wrapper 接收后删除。`gui/<uid>` 不可用时 MUST 返回稳定 unavailable 且 target spawn 为零。

启动 reconciliation MUST 先验证 manifest 的 version/HMAC/UID/domain/label namespace/plist digest，再只按精确 launchd service target 的 registration 执行有界 kill/bootout。它 MUST NOT 调用 bootstrap/kickstart、读取或执行旧 start payload、按同名 executable/端口搜索、或对 manifest 中的 PID/PGID 发信号。每个 manifest MUST 独立收敛；无法证明 service 归属、身份冲突或 plist 缺失的条目 MUST 保留并报告 cleanup blocked，保持目标进程不受影响，同时继续清理其他有效条目并允许应用以空注册表启动。无关同名进程 MUST 保持存活。

normal close MUST 先持久化活动 Agent run 的既有 graceful resume intent，再停止并 reap 全部 managed process，最后关闭 store/server。任一 managed group 未在清理 deadline 内确认退出时 close MUST reject，调用方 MUST NOT 声称安全退出。

### Scenario: Agent 回合结束后服务仍存活

- **GIVEN** Agent 通过 MCP start 得到 ready 运行项
- **WHEN** Provider invocation 正常完成且下一回合开始
- **THEN** 同一 processId、PID/PGID 和 endpoint 仍存在
- **AND** 下一回合能 list/inspect/read_logs/stop
- **AND** Provider invocation cleanup 没有停止目标组。

### Scenario: 正常关闭停止而不恢复

- **GIVEN** local console 有多个 active managed process 和一个可恢复 Agent run
- **WHEN** runtime close 完成并再次启动
- **THEN** Agent run 仍按既有 graceful resume 规则处理
- **AND** 所有 managed PGID 与端口在 close 返回前消失
- **AND** 新注册表为空且旧命令执行次数不增加。

### Scenario: 崩溃残留只清理已证明归属的 service

- **GIVEN** 上次 owner 异常消失后留下 HMAC 有效 manifest 对应的 live launchd service、另一个 wrapper 已消失但 registration 尚待 bootout 的 job、一个伪造 manifest 和一个无关同名进程
- **WHEN** local console 再次启动 reconciliation
- **THEN** live service 的精确 target 被停止、bootout 并 reap
- **AND** wrapper 已消失的 job 由 launchd process-group 规则确认无残留后按精确 service target bootout
- **AND** 旧命令没有再次执行
- **AND** 无关进程保持存活
- **AND** 伪造、冲突或 plist 缺失的 manifest 产生 blocked 事实而不触发任何 PID/PGID kill，也不阻止应用启动或其他有效 manifest 清理。

## 新增：Runtime Contract 只引导托管工具选择

Source: docs/product/pages/main-conversation.md#托管运行项

local console MUST 从单一版本化 builder 将 managed-process Runtime Contract 组合进 initial、delta、graceful resume、retry 与 edit-resend prompt。contract MUST 指明需要跨工具调用／回合存活的进程使用 managed-process 工具，并禁止自行后台化；MUST NOT 包含 token、bridge endpoint、内部路径或会话标识。进程注册、状态与停止 MUST 只来自结构化工具调用和 supervisor 事实，MUST NOT 解析 Agent 正文 JSON。

任一 Provider 的临时 MCP 配置生成、bridge 启动、MCP 初始化或工具发现失败 MUST 撤销 capability 并使本次 invocation 进入可理解 setup failure。该路径 MUST NOT 接受 managed-process start、MUST NOT 新增 registry/manifest、target spawn MUST 为零，也 MUST NOT 写 completed Agent 成功消息。Runtime Contract MUST 要求 Agent 报告能力不可用，MUST NOT 回退到 `nohup`、`&`、double-fork、自建 daemon 或正文 JSON。

### Scenario: resume 重新收到运行时契约

- **GIVEN** Agent 已有 canonical Provider session
- **WHEN** 新消息通过 delta 或 graceful resume 启动下一轮
- **THEN** 本轮 prompt 仍包含同一版本的 Runtime Contract
- **AND** 工具 capability 为本轮新签发
- **AND** 不依赖首次 full prompt 的历史残留。

### Scenario: MCP 注入或发现失败时不后台回退

- **GIVEN** Codex、Claude 或 Kimi 的本轮 MCP 注入、初始化或工具发现被故障注入为失败
- **WHEN** 用户要求启动一个需跨回合存活的服务
- **THEN** invocation 以 managed-process capability setup failure 收束且没有 completed Agent 成功消息
- **AND** target spawn、registry 新增与 manifest 新增均为零
- **AND** Provider 原生终端没有执行 `nohup`、后台符号、double-fork 或等价逃逸命令
- **AND** 用户全局 Provider 配置内容与元数据保持不变。

## 新增：Kimi 托管工具完成后有界收束 Provider 回合

Source: docs/product/pages/agent-conversation.md#验收标准

bridge MUST 按 providerRunId/toolCallId 向对应 execution adapter 提供结构化 managed-tool completion 事实，不暴露请求参数、token 或日志。Kimi 在该工具已经返回后 MUST 启动独立、集中可配的滑动 settlement deadline；后续普通工具调用在途时 MUST 暂停该 deadline，工具结束或新的非空 Agent 正文／reasoning 到达时 MUST 从该真实进展重新计时，`session/prompt` 终局 MUST 撤销该 deadline。配置更新、心跳与重复工具状态 MUST NOT 刷新。

deadline 到达时 Kimi adapter MUST 复用既有 ACP cancel 与有界 signal escalation，并返回可重试 `timeout{basis:"provider-turn"}`。它 MUST NOT 写 completed Agent message、推进公开 cursor、重放 managed tool 或停止已经托管的进程。已观察 external session ID MUST 继续按 canonical resume 规则使用。

### Scenario: 工具返回但 Kimi prompt 不终结

- **GIVEN** managed-process stop 已返回 stopped，且 Kimi `session/prompt` 此后没有终局或真实进展
- **WHEN** settlement deadline 到达
- **THEN** Kimi invocation 有界结束为 provider-turn timeout
- **AND** 时间线没有 completed Agent message且提供重试
- **AND** stop 副作用保持已提交，不重复调用工具
- **AND** 其他 managed process 仍可由下一回合查询和停止。

### Scenario: 工具返回后 Kimi 正常回复

- **GIVEN** managed-process start 已返回 ready
- **WHEN** Kimi 在 deadline 内产生非空 Agent 正文并返回正常终局
- **THEN** settlement timer 被撤销
- **AND** Agent run 按既有 completed 规则收束
- **AND** managed process 跨回合继续存活。
