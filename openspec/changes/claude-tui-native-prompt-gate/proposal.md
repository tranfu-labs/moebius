# 提案：claude-tui-native-prompt-gate

## 需求基线

| 文件 | 小节 | 变更 | 状态 |
| --- | --- | --- | --- |
| `docs/product/pages/main-conversation.md` | [#Agent 执行与恢复](../../../docs/product/pages/main-conversation.md) | 修改：把「只识别工作区信任提示」泛化为「TUI 正在等一个决定」的三层处置（自动应答 / 候选项选择 / 有界停下）；临时 `--settings` 内容从「只含 lifecycle hooks」放宽为「只含 Moebius 自己的运行边界设置」 | 已写入 |
| `docs/product/pages/main-conversation.md` | #Claude 运行中的呈现与原生确认 | 新增小节（取代原 #Claude TUI 运行表面）：等待确认与已停下两种运行块形态、候选项原样呈现、只表达「选第几项」 | 已写入 |
| `docs/product/pages/main-conversation.md` | #指标与验收 | 新增验收 119、120、122 | 已写入 |

## 背景

Claude TUI 在首个任务写入前会显示原生确认。现有实现只识别一种——工作区信任（`src/claude-tui-workspace-trust.ts`），其余一律落在 `awaiting-terminal` 状态里等 `❯ Try …` 输入提示。

已经出现两种未被覆盖的确认：

- `--resume` 时的恢复模式选择（`1. Resume from summary / 2. Resume full session as-is / 3. Don't ask me again`）；
- Moebius 自己用 `--mcp-config` 注入 `moebius_managed` relay 后的 MCP 授权（`1. Use this MCP server / 2. Use this and all future MCP servers in this project / 3. Continue without using this MCP server`）。

两者都不是信任提示、也不是 `❯` 输入提示，检测器永远停在 `waiting`，本轮任务永远不写入。更严重的是这一路径**没有任何兜底计时**：`markTurnIdle()` 只在本轮 Stop 之后调用（`src/claude.ts:741`），bootstrap 阶段既不超时也不失败，只能靠用户手动中断。用户在只读终端里看得见菜单却无法选择，因为终端硬只读（`disableStdin`、按键处理器恒 false）。

这不是「漏了一条正则」，是用白名单接一个持续演进的开放集：Claude Code 每新增一种原生确认，Moebius 的默认行为就是无限挂起。

## 提案

把三种已知确认的特例逻辑替换成一条统一的「原生确认门」：

1. **有界兜底**（根治挂死）：首个任务写入前，PTY 停在非正常输入提示的等待态超过阈值即必须处置，不得无限等待。
2. **上游消除**：Moebius 自己注入的 relay 授权与恢复模式选择，优先在自己的临时 `--settings` 里关掉，让提示根本不出现。
3. **自动应答**：上游消除不可用时，对 Moebius 自造的确认与工作区信任按既定语义自动应答一次，不打扰用户；恢复固定选「按原样恢复完整会话」。
4. **候选项识别**：不认识但能从终端原文辨认出候选项的，把候选项原样上抛为产品化选择（本 change 只产出后端事实与安全停下，页面选择入口由 `claude-terminal-demotion` 承接）。
5. **兜底停下**：以上都不成立时，本轮明确停下并附终端原文，允许显式重试。

## 影响

- `local-console`：Claude adapter 的 bootstrap 判定、临时 settings 内容、原生确认处置与失败分类。
- `docs/product/`：Claude 原生确认的产品规则与验收。
- 不影响：Codex、Kimi、Pi 的 adapter、resume 语义与过程展示；Claude 的 lifecycle hooks、transcript resolver、managed-process lease 与 PTY 生命周期本身不变。
- 本 change 结束后主时间线仍渲染只读终端；终端降级由 `claude-terminal-demotion` 承接。
