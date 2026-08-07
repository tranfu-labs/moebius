# 设计：plaintext-provider-credentials

## 方案

### 凭据文件格式

新文件 `provider-credentials-v2.json`（与 v1 并存隔离，不复用文件名）：

```json
{ "version": 2, "credentials": { "provider-credential:<uuid>": { "apiKey": "<明文>", "createdAt": "<ISO>" } } }
```

选新文件名而非同文件改 schema：v1 文件里是 safeStorage 密文，schema 不兼容；新名字让「旧文件整体作废」语义显式，`readDocument` 不需要兼容两种记录形态。`writeDocument` 的原子写（临时文件 + rename）与 0600 权限原样保留——0600 是用户已确认保留项，也是明文派同行（aider、Claude Code Linux、OpenClaw）的标配。

### 旧 v1 记录处理（不迁移）

- vault 工厂首次被调用读写时，若同目录存在 `provider-credentials-v1.json`，best-effort 删除（里面只剩本实现已无法解密的密文，留着是死数据）。删除失败不阻塞启动。
- 旧档案的 `credentialRef` 在 v2 文件中查无记录 → `vault.read` 抛 `CREDENTIAL_NOT_FOUND` → `provider-profile-service.ts` 现有的 ready 校准（`recoverInterrupted` 内逐档案 `vault.read`）把档案标为 `needs-attention` + `credential-invalid` → 设置页出现「替换 Key」修复入口。不崩溃、不静默吞掉、用户看得懂——复用现有状态机，不新增任何 UI 路径。

### 代码改动面

| 文件 | 改动 |
| --- | --- |
| `desktop/src/provider-credential-vault.ts` | 删 `SafeStoragePort`、`createElectronSafeStoragePort`、`assertEncryptionAvailable`；`stage/read` 直接明文读写；schema 改 v2；启动清理遗留 v1 文件；错误码收敛为 `NOT_FOUND / WRITE_FAILED / DOCUMENT_INVALID / INPUT_INVALID`（删除 `ENCRYPTION_*`、`DECRYPTION_FAILED`） |
| `desktop/src/provider-profile-wiring.ts` | 不再接收/注入 `safeStorage`；vault 构造只传 `filePath`（v2 路径） |
| `desktop/src/main.ts` | 移除 `safeStorage` import 与传参 |
| `desktop/src/provider-profile-service.ts` | `classifyValidationError` 删除 `CREDENTIAL_DECRYPTION_FAILED` 分支（`NOT_FOUND → credential-invalid` 保留） |
| `desktop/src/desktop-process-config.ts` | 保留 `app.setName("Moebius")`、改写注释：它仍钉住 dev/packaged 的应用名与 name 派生路径一致性（dev 包名是带 slash 的 `@moebius/desktop`），但不再服务 Keychain 身份 |
| `packages/console-ui/src/i18n/locales/{zh-CN,en}.ts` | `settings.providers.description` 改为明文存储告知（见下）；`deleteWarning` 的「系统凭据」措辞同步为「本机凭据」 |
| `src/testing/four-layer-registry.ts` | 登记的文件仍在原分层，预期无需改动；实现时跑 `check:boundaries` 确认 |
| `desktop/tests/provider-credential-vault.test.ts` | 重写：明文 stage/read 回环、0600 权限断言、损坏文件 → `DOCUMENT_INVALID`、缺记录 → `NOT_FOUND`、遗留 v1 文件被清理、`pruneExcept`/`remove` 回归 |
| `desktop/tests/provider-profile-service.test.ts` | 随错误码收敛调整（fake vault 注入点不变，预期改动很小） |

### 用户知情（不弹窗）

改 `settings.providers.description` 这一处既有文案位（设置 ▸ AI 服务商页顶部描述，onboarding 添加服务商复用同一组件则自然覆盖）：

- zh：`API Key 以明文保存在本机数据目录（可通过状态页「打开数据目录」查看），界面只显示末四位。使用 API 时项目内容会发送给所选服务商。`
- en：`API keys are stored in plaintext in the local data directory (open it from the status page); only the last four characters are shown. Project content is sent to the selected provider when you use its API.`

不展示绝对路径（dev/packaged 数据根不同，渲染层也不持有该值），指引用户走状态页「打开数据目录」这一既有入口。不新增 IPC——spec 的 renderer DTO 边界（不含凭据文件路径）保持不变。

### `byok-pi-onboarding.ts --app` 可用性判断

保存路径不再触碰 safeStorage/Keychain → 该脚本隔离 `HOME` 导致的 `A keychain cannot be found` 阻塞消失，`--app` 模式预期自动恢复可用，此后可作为打包态验收闸门。脚本读取测试 Key 的 `security find-generic-password` 在父进程、真实 `HOME` 下执行，不受子进程隔离影响。实现阶段实跑一次确认；若仍有其它卡点只记录、本轮不修脚本。

### `byok-pi-electron.ts:362` 选择器歧义

不受影响：本 change 不触碰任何 React 组件结构，仅改 i18n 文案字符串，「Agent 团队」双按钮歧义的成因不变。

## 权衡

- **纯明文 vs 加密+明文降级双路径**：用户已拍板纯明文。双路径要保留 safeStorage 调用与格式判别分支，恰是本次要删掉的环境依赖面；且 Electron `basic_text` 后端实质就是明文，「能加密就加密」在 Linux 上经常白忙。
- **v2 新文件 vs v1 同文件双形态**：双形态让 `readDocument` 永久背着 legacy 分支；新文件名 + 启动清理把 legacy 处理压缩成一次性 `rm`。
- **不迁移旧密文**：迁移就要保留一条 safeStorage 解密路径，纯明文的简化即失效；打包态从未成功保存（v0.4.0 起保存路径必炸），受影响只有 dev 机上的既有档案，代价是重填一次 Key。

## 风险

- 明文 Key 落在数据根 `.state/` 下：属用户已接受的产品决定；0600 + 数据根本身 0700 保持本机多用户隔离。
- dev 既有档案变「需要处理」：预期行为，验收清单第 4 条专门验证修复路径可用。
- i18n 文案改动需检查是否有测试引用原文（如有按行为断言调整，不写镜像断言）。
