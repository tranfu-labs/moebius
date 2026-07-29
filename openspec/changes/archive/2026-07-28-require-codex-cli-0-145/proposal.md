# 提案：require-codex-cli-0-145

## 需求基线

| 文件 | 小节 | 变更 | 状态 |
| --- | --- | --- | --- |
| `docs/product/pages/onboarding.md` | 第 1 步 · 环境就绪（至少一个 CLI 可用） | Codex 就绪新增 `>= 0.145.0` 硬门，并为旧版本提供明确升级指引 | 已写入 |

## 背景

Codex CLI `0.144.1` 不接受 `agents.enabled=false`，但仅传
`--disable multi_agent` 又不能可靠移除内部协作工具。这会让一次 Moebius
角色运行继续在 Codex 内部派生 Agent，外层运行迟迟不结束，因而阻塞
Moebius 基于公开时间线的角色交接。

Codex CLI `0.145.0` 开始支持 `agents.enabled`。Moebius 需要明确最低兼容
版本，避免在旧 CLI 上以配置解析错误或错误的内部协作行为失败。

## 提案

- 将 Codex CLI 最低兼容版本固定为 `0.145.0`。
- 在共享 Codex 能力探针、首次引导 readiness 与桌面 doctor 中识别旧版本，
  不继续执行模型能力枚举，并返回脱敏、可操作的升级提示。
- Codex 运行参数恢复 `-c agents.enabled=false`，移除重复且不能覆盖当前
  协作工具开关的 `--disable multi_agent`。
- 保持 Kimi 探测、至少一个 CLI 可用即可继续以及 Moebius 自身角色交接
  语义不变。

## 影响

- `src/config.ts` 的 Codex 公共启动参数。
- Codex CLI 版本解析与兼容判定。
- desktop 执行能力探针、首次引导 readiness、doctor 与引导文案。
- desktop-shell 与 local-console 行为规格及相关测试。
