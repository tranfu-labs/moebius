### Requirement: 引导环境检查验证 Codex 与 Kimi 真实就绪

Source: docs/product/pages/onboarding.md#第-1-步-环境就绪至少一个-cli-可用

Codex CLI 只有在真实版本不低于 `0.145.0` 时才可继续能力检查并成为 ready。
低于最低版本或无法解析版本时 MUST NOT 启动 Codex app-server 或模型能力
枚举；旧版本 MUST 返回稳定的升级所需 code、保留真实版本文本并向用户显示
最低版本升级指引，MUST NOT 把它误分类为 missing 或 needs-login。

#### Scenario: Codex 版本过旧

- **GIVEN** `codex --version` 成功返回 `codex-cli 0.144.1`
- **WHEN** 引导执行 Codex readiness 检查
- **THEN** Codex 行为 unavailable 且显示需要 `0.145.0` 或更高版本
- **AND** 保留 `codex-cli 0.144.1` 作为本次真实版本
- **AND** 不启动 app-server、模型能力枚举或真实推理。
