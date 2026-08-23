# 提案：claude-tui-auto-workspace-trust

## 需求基线

| 文件 | 小节 | 变更 | 状态 |
| --- | --- | --- | --- |
| docs/product/pages/main-conversation.md | Agent 执行与恢复 | Claude 原生工作区信任提示改为受限检测后的自动 Enter，不再要求人工对话框 | 已写入 |

用户已明确要求仅对 Claude Code 处理该提示；Codex、Kimi 与 Pi 不在本次范围内。

## 背景

Claude Code 首次进入未受信任工作区时会在真实 PTY 中显示原生信任提示。现有实现已可在任务写入前识别该提示，但暂停 run、显示不可关闭的 Desktop 对话框，再等待用户提交 native Enter。用户要求由程序识别已知原生提示并自动写入 Enter，避免每个新目录都需要人工确认。

## 提案

把现有 Claude PTY 的预任务检测窗口改为自动确认窗口：仅在检测器确认原生工作区信任提示时，对同一 PTY 写入一次 Enter；等待 Claude 返回正常输入提示后，再写入原始人类任务。移除只服务人工信任决定的 active-run 状态、HTTP route、Desktop callback 与 console-ui dialog，保留只读终端 trace。

## 影响

- provider-adapters：Claude TUI bootstrap 状态机与信任检测器。
- local-console：删除人工信任决定的投影、controller 和 HTTP 输入面。
- desktop-shell / console-ui：删除信任对话框及其调用、文案、stories、测试。
- 规格与文档：产品 PRD 已更新；local-console 与 console-ui 的行为规格通过 spec-delta 回流。
- 验证：补充单元、边界、真实 Claude CLI、真实 Electron 验收，确认没有影响其他 Provider。
