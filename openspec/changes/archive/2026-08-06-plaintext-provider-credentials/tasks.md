# 任务：plaintext-provider-credentials

## 实现

- [x] `provider-credential-vault.ts`：删 safeStorage 路径，v2 明文 schema，原子写 + 0600 保留，启动 best-effort 清理 `provider-credentials-v1.json`，错误码收敛
- [x] `provider-profile-wiring.ts` / `main.ts`：移除 `safeStorage` 注入，vault 指向 `provider-credentials-v2.json`
- [x] `provider-profile-service.ts`：`classifyValidationError` 删 `CREDENTIAL_DECRYPTION_FAILED` 分支
- [x] `desktop-process-config.ts`：更新 `setName` 注释（不再提 safeStorage）
- [x] console-ui i18n：`settings.providers.description` 与 `deleteWarning` 中英四条文案
- [x] 重写 `desktop/tests/provider-credential-vault.test.ts`；按需调整 `provider-profile-service.test.ts`

## 门禁

- [x] `pnpm --filter @moebius/desktop test`、`pnpm typecheck`、`pnpm check:boundaries`、根 `pnpm run test --scope` 全绿

## 真实运行验收（逐条给证据）

- [x] **明文落盘**：`pnpm desktop` → 设置 → AI 服务商 → 添加 DeepSeek → 有效 Key → 验证并保存 → 档案「已就绪」；用编辑器打开 `<数据根>/.state/provider-credentials-v2.json` 可见明文 Key；`stat` 显示权限 600
- [x] **打包态同样**：`pnpm --filter @moebius/desktop dist` 打新包，安装包内重复上一条，结果相同
- [x] **重启保持**：完全退出重开 → 档案仍「已就绪」
- [x] **旧格式降级**：在 dev 数据根保留/构造 v1 密文凭据文件后启动 → 档案变「需要处理」，设置页出现替换 Key 入口；重填 Key 验证保存后恢复「已就绪」；v1 文件已被清理
- [x] **文案**：设置 ▸ AI 服务商页描述显示「明文保存在本机数据目录」说明
- [x] **验收脚本**：`byok-pi-onboarding.ts --app <新包>` 实跑，确认保存步骤不再因 Keychain 缺失卡死（结果如实记录，可用则说明可作打包态闸门，不可用则记录剩余卡点）；`byok-pi-electron.ts` dev 回归

## 归档前

- [x] spec-delta 合并回 `openspec/specs/desktop-shell/spec.md`，change 目录归档
