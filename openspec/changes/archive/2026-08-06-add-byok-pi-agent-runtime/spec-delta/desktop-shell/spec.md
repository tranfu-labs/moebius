# desktop-shell 规格增量：BYOK Provider 与 Pi 装配

## ADDED Requirements

## Requirement: API Provider 档案由桌面主进程拥有

Source: `docs/product/pages/settings.md#ai-服务商`

Desktop main MUST 是 Provider catalog、档案事务与凭据能力的唯一 composition root。Preload MUST 只暴露列出安全档案、提交输入 Key、验证、生命周期动作和 operation 状态的窄 IPC；renderer MUST NOT 读取 credentialRef 对应 blob、解密 Key、Base URL 或原始 Provider 错误。

### Scenario: Renderer 列出档案

- **GIVEN** 主进程保存了一个已就绪 DeepSeek 档案
- **WHEN** renderer 请求 AI 服务商列表
- **THEN** DTO 只含稳定 ID、显示名、服务商、模型、状态、Key 脱敏尾号和可执行动作
- **AND** 不含 Key、ciphertext、凭据文件路径或 Authorization。

## Requirement: SafeStorage 凭据 fail closed 且原子持久化

Source: `docs/product/flows/byok-agent-runtime.md#2-输入-key-与选择模型`

Desktop MUST 在 `app.whenReady()` 后仅由 main process 使用 Electron safeStorage 保护有界 API Key，并将 encrypted blob 以 mode `0600` 原子写入应用数据根。加密不可用、解密失败、blob 损坏或原子写失败 MUST 形成可修复的安全状态，MUST NOT 回退明文或把 Key 交给 renderer/local-console server。

### Scenario: 重启后解密失败

- **GIVEN** 档案元数据存在但系统凭据无法解密对应 blob
- **WHEN** 应用重启并检查档案
- **THEN** 档案进入“需要处理”且新运行被阻止
- **AND** 历史仍可读，应用不使用空 Key、旧缓存或明文 fallback。

### Scenario: Key 轮换提交失败

- **GIVEN** 旧档案 revision 可正常运行且新 Key 已通过验证
- **WHEN** 本地 profile commit 失败
- **THEN** 旧 revision 和旧 credential 继续有效
- **AND** 用户可不产生额外 API 用量重试本地保存。

## Requirement: Provider 生命周期操作可从崩溃恢复

Source: `docs/product/pages/settings.md#管理-ai-服务商`

创建、轮换、重新启用、迁移和删除 MUST 使用持久 operation journal 与完整 commit marker。应用关闭或崩溃后 MUST 只呈现完整成功，或恢复操作前状态并显示“上次操作未完成”及重试入口；不得呈现半迁移、半团队替换或档案/凭据不一致。

### Scenario: 批量迁移期间崩溃

- **GIVEN** 用户确认把多个引用迁移到新档案
- **WHEN** 应用在部分独立对象提交后崩溃
- **THEN** 重启后已提交对象明确列为完成，未提交对象保持旧引用并可重试
- **AND** 任一单对象的结构与 Provider 引用不会半提交。

## Requirement: API Provider 单独满足首次引导门槛

Source: `docs/product/pages/onboarding.md#第-1-步--环境就绪至少一个执行引擎已就绪`

首次引导 MUST 将已就绪 API Provider 与已就绪 CLI 统一视为可用执行环境。纯 API 用户 MUST 能使用 Pi 完成 AI 建队并保存每名成员的 Provider、模型和实际思考程度。对任意不可用执行配置，批量“改用这个 API” MUST 原子更新成员配置与引用，失败时整体保持原状。

### Scenario: 无 CLI 的用户完成建队

- **GIVEN** 三套 CLI 均不可用且一个 DeepSeek 档案已就绪
- **WHEN** 用户用 AI 生成并创建团队
- **THEN** AI 建队由 Pi 执行，创建前逐名显示 Pi 档案、模型和思考程度
- **AND** 保存后的团队可以直接发起首个任务。

## Requirement: Pi Host 与原生依赖进入桌面产物

Source: `docs/product/prd.md#开发域-mvp`

Desktop build/dist MUST 包含 Pi Host entry、精确锁定的 Pi SDK/adapter 代码及 macOS arm64 所需原生依赖。打包应用 MUST 能启动、停止和 resume Pi Host，且退出后零普通 helper；缺失或不兼容依赖 MUST 在构建或能力检查时 fail closed，不得在用户发送后才静默换 CLI。

### Scenario: 打包应用执行 Pi 首任务

- **GIVEN** 安装态 macOS arm64 应用和已就绪 DeepSeek 档案
- **WHEN** 用户从真实页面发起受控编码任务并退出应用
- **THEN** Pi Host 完成工具循环、结果持久化与有界退出
- **AND** 应用退出后不残留 Pi Host 或其普通 helper。

## Requirement: Provider 档案引用与团队写入同成同败

Source: `docs/product/pages/agent-teams.md#provider-引用与团队生命周期`

团队创建、AI 创建、成员/团队复制、官方更新、成员删除和团队删除 MUST 与对应 Provider 引用在同一用户可见提交中完成。失败时团队结构与引用 MUST 一起保持原状；解除团队引用 MUST NOT 解除可恢复会话、草稿、任务或一次性执行的冻结引用。

### Scenario: 复制团队引用保存失败

- **GIVEN** 源团队成员使用 Provider 档案 P
- **WHEN** 复制团队时 P 的新增引用提交失败
- **THEN** 新团队不可见且 P 的引用列表不增加半成品
- **AND** 源团队与既有会话保持不变。
