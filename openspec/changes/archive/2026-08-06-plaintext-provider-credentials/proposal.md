# 提案：plaintext-provider-credentials

## 需求基线

| 文件 | 小节 | 变更 | 状态 |
| --- | --- | --- | --- |
| `docs/product/prd.md` | 数据边界（API Key 存储段） | 「系统凭据能力安全保存」改为「明文保存于本机应用数据目录凭据文件（0600）」 | 已写入 |
| `docs/product/flows/byok-agent-runtime.md` | 档案生命周期（需要处理诱因） | 「系统凭据无法读取」改为「本机凭据文件无法读取」 | 已写入 |
| `docs/product/pages/settings.md` | 管理 AI 服务商 / 验收边界 | 同上措辞替换（3 处） | 已写入 |
| `docs/product/pages/main-conversation.md` | 会话中凭据使用与修复入口 | 同上措辞替换（4 处） | 已写入 |

产品决定（用户 2026-08-06 采访拍板）：Provider API Key **纯明文**存储，不保留 safeStorage 加密/解密路径，也不做「能加密就加密」的降级双路径；旧密文凭据不做迁移；写文件保留 0600 权限。依据：同类开源 Agent 工具（aider、Continue、Claude Code Linux、Copilot Linux 等）主流即明文本地文件；safeStorage 的密钥与密文同机，对本机威胁模型无实质收益，却引入钥匙串环境依赖故障（打包态/CI/隔离验收环境）。

## 背景

v0.4.0 起凭据经 Electron safeStorage 加密落盘。该能力在打包态因子进程通道缺陷整体不可用（已在 `33cc200e` 修复为直调），但用户决定直接改为纯明文：加密对本机自有 Key 的威胁模型收益趋近于零，而 fail-closed 与钥匙串依赖已经实际造成打包态功能不可用、验收脚本 `--app` 模式不可用两个问题。

## 提案

- `CredentialVault` 改为纯明文读写：新凭据文件 `provider-credentials-v2.json`（`{ version: 2, credentials: { ref: { apiKey, createdAt } } }`），保留原子写（临时文件 + rename）与 0600 权限。
- 删除 safeStorage 整条路径：`SafeStoragePort` 接口、`createElectronSafeStoragePort`、加密/解密相关错误码；`main.ts` 与 `provider-profile-wiring.ts` 不再注入 `safeStorage`。
- 旧 v1 密文凭据不做迁移：启动时 best-effort 删除遗留 v1 文件；旧档案的 `credentialRef` 在 v2 文件中查无记录 → 走现有 `CREDENTIAL_NOT_FOUND` → `credential-invalid` → 「需要处理」→ 替换 Key 修复路径。
- 设置页文案告知用户 Key 以明文存于本机数据目录（沿用现有 i18n 描述位，不弹窗、不加 IPC）。
- `desktop-shell` spec 的「SafeStorage 凭据 fail closed 且原子持久化」Requirement 改写为明文存储规格。

## 影响

- 模块：`desktop/src/provider-credential-vault.ts`、`provider-profile-wiring.ts`、`main.ts`、`desktop-process-config.ts`（注释）、`provider-profile-service.ts`（错误码收敛）、`packages/console-ui` i18n 文案（2 条）。
- 行为：保存/轮换/读取凭据不再依赖钥匙串；旧 dev 环境已保存的档案进入「需要处理」，需重填一次 Key（打包态从未成功保存过，无真实用户受影响）。
- 验收：`byok-pi-onboarding.ts --app` 预期恢复可用。
- 不变项：preload 窄 IPC 边界、Key 不回显、DTO 不含凭据内容、operation journal 崩溃恢复语义。
