# local-console 规格增量

## MODIFIED Requirements

### Requirement: 普通 Claude 使用有自然终点的 headless query

Source: `openspec/specs/local-console/spec.md`#Claude execution

普通 Claude run MUST 通过共享 Claude Agent SDK adapter 执行一次有自然终点的
headless query。每轮 MUST 通过既有 execution driver 观察并校验 exact external session
id；full 生成新 session，resume 只能使用已核验的 canonical session id。停止或取消 MUST
通过 `AbortSignal` 收束当前 query，认证、权限、MCP、启动和 SDK 错误 MUST 进入既有安全
失败归类。

普通 Claude 默认路径 MUST NOT 创建或依赖 PTY、TUI lifecycle hook、workspace trust
detector、raw terminal trace 或持久 relay。不得因为不可见的登录、信任、权限或 MCP 交互
而等待用户输入，也不得在失败后自动改用第二次 full。

#### Scenario: Claude resume 保持同一 session

- **GIVEN** Claude full 已观察并持久化 external session id `S`
- **WHEN** 下一轮以 resume `S` 执行
- **THEN** adapter 只接受 provider 返回的同一 `S`
- **AND** 不创建 PTY、不挂载 lifecycle hook，并把 query 终局交给既有 run 生命周期。

#### Scenario: 不可见交互安全失败

- **GIVEN** Claude query 需要 Moebius 页面无法提供的认证、权限或 MCP 交互
- **WHEN** SDK 返回对应失败或无法继续
- **THEN** run 进入既有结构化失败状态
- **AND** 页面不等待隐藏输入、不渲染原始 terminal 字节、不自动 full 重试。

### Requirement: local-console 不再提供 Claude raw terminal trace API

Source: `openspec/specs/local-console/spec.md`#run output

local-console MUST NOT 在默认 HTTP server、runtime facade、primary/worker provider wiring
或 active-run state 中提供 `claudeTerminalTrace` route、port、状态字段或 terminal data
callback。Claude 运行过程继续通过结构化 activity、已有完整输出入口和已核验的 native
JSONL execution link 暴露。

#### Scenario: 旧 terminal trace URL 不可达

- **GIVEN** 客户端请求历史 `.../runs/<runId>/claude-terminal` URL
- **WHEN** local-console server 路由请求
- **THEN** 不创建 trace、不访问其他 run 的字节、不触发 provider
- **AND** 请求按未知资源处理。
