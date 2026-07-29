### Requirement: Moebius 角色运行禁用 Codex 内部 Agent 工具

系统 MUST 要求 Codex CLI 版本不低于 `0.145.0`，并为所有 Codex full 与
resume 调用传入 `agents.enabled=false`。系统 MUST NOT 依赖已不能覆盖当前
协作工具的 `features.multi_agent` 开关，也 MUST NOT 允许一次角色运行在
Codex 内部派生 Agent；角色之间的交接只由 Moebius 公开时间线路由处理。

#### Scenario: Codex 调用使用权威内部 Agent 开关

- **GIVEN** 一个绑定 Codex 的 Moebius Agent 需要执行 full 或 resume
- **WHEN** 系统构造 Codex 参数
- **THEN** 参数包含 `-c agents.enabled=false`
- **AND** 参数不包含 `--disable multi_agent`
- **AND** Codex 退出并留下公开回复后，Moebius 才按合法 mention 继续交接。
