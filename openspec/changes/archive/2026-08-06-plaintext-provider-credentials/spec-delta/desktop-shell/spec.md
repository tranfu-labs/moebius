# desktop-shell 规格增量：Provider 凭据改明文本地存储

## MODIFIED Requirements

## Requirement: Provider 凭据明文原子持久化于本机数据根

Source: `docs/product/flows/byok-agent-runtime.md#2-输入-key-与选择模型`

Desktop MUST 仅由 main process 把有界 API Key 以 UTF-8 明文写入应用数据根的凭据文件，写入 MUST 原子（临时文件 + rename）且文件 mode 为 `0600`。凭据记录缺失、凭据文件损坏或原子写失败 MUST 形成可修复的安全状态（档案进入"需要处理"并阻止新运行），MUST NOT 把 Key 交给 renderer/local-console server，也 MUST NOT 使用空 Key 或旧缓存继续运行。

### Scenario: 凭据记录缺失或无法解析

- **GIVEN** 档案元数据存在但凭据文件中没有对应记录或记录无法解析（含旧版 safeStorage 密文记录）
- **WHEN** 应用重启并校准档案
- **THEN** 档案进入"需要处理"且新运行被阻止
- **AND** 历史仍可读，用户在设置中替换 Key 并重新验证保存后恢复"已就绪"。

### Scenario: Key 轮换提交失败

- **GIVEN** 旧档案 revision 可正常运行且新 Key 已通过验证
- **WHEN** 本地 profile commit 失败
- **THEN** 旧 revision 和旧 credential 继续有效
- **AND** 用户可不产生额外 API 用量重试本地保存。
