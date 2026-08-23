# 交付报告：claude-tui-auto-workspace-trust

## 1. 变更摘要

Claude Code 首次进入未受信任工作区时，Moebius 只在同一真实 PTY 的预任务阶段识别已知原生提示，并自动写入恰好一次 Enter；正常输入提示返回后才写入保留的用户任务。首个任务写入后检测器即销毁，后续终端内容不能再触发 Enter。

- `src/claude.ts` 与 `src/claude-tui-workspace-trust.ts`：一次性自动确认、重复 redraw 防重入、等待正常 prompt、任务后停止检测。
- local-console／Desktop／console-ui：删除人工 `workspaceTrust` 投影、决策 route、callback、dialog、翻译、stories 与失效测试；旧 POST endpoint 现返回 404。
- `scripts/acceptance/claude-tui-electron.ts` 与 Claude 真实验收：验证原生提示 trace、无人工 dialog、同 PTY 第二轮、idle 精确 `--resume` 与 transcript cache usage。
- `boundary-matrix.md`、模块地图与 console-ui 设计约定：记录边界、回归与当前架构事实；OpenSpec spec-delta 保持在 change 内，归档时合并。

运行方式：本地操作台用 `pnpm start`，真实桌面入口用 `pnpm desktop`；完整闸门用 `pnpm test`。真实 Claude 验收分别使用 `MOEBIUS_REAL_CLAUDE=1 MOEBIUS_REAL_CLAUDE_TRUST_FLOW=1 pnpm exec vitest run tests/claude-real.acceptance.test.ts` 与 `MOEBIUS_REAL_CLAUDE_ELECTRON=1 pnpm exec tsx scripts/acceptance/claude-tui-electron.ts`。

## 2. 测试报告

步骤 1／步骤 4 范围基线对比：

| 项目 | 步骤 1 | 步骤 4 |
| --- | --- | --- |
| Desktop build | exit 0；bundle 4.94 秒 | exit 0；bundle 4.86 秒 |
| import-boundaries | 815 source／671 production | 811 source／669 production，通过 |
| 根套件 | 65 通过、1 跳过；586 通过、6 跳过 | 60 通过、1 跳过；564 通过、5 跳过，102.31 秒 |
| Desktop | 39 文件／266 测试通过 | 39 文件／266 测试通过，20.05 秒 |
| Console UI | 48 文件／580 测试通过 | 47 文件／578 测试通过，9.45 秒 |

减少的 scope 文件和测试来自已删除的人工 dialog／route 覆盖，以及 `--scope HEAD^` 对当前差异重新计算的依赖闭包；无失败。

最终完整闸门：`pnpm test` exit 0。

- 根套件：137 文件通过、1 文件跳过；949 通过、5 跳过，109.31 秒。
- 额外 local-console 慢测：1 文件／66 测试通过，21.28 秒。
- Desktop：159 文件／788 测试通过，54.25 秒。
- Console UI：64 文件／654 测试通过，17.26 秒。

真实行为证据：Claude CLI 验收 3 通过、2 跳过（26.82 秒）；真实 Electron 验收输出 `{"ok":true,"records":11,"assertions":11}`，首轮原生提示 trace 为 5 chunks／1232 bytes，cache-read usage 为 30,046 → 53,567 → 30,046。

## 3. 与需求差异清单（终稿）

无。自动确认仅作用于 Claude Code 的已知原生工作区信任提示；Codex、Kimi 与 Pi 未改动。

## 4. 建议回退需求的问题

无。

## 5. 有意偏离清单（汇总）

无。

## 6. 遗留事项终稿与对账清单

### 遗留事项

- 不采纳的评审提醒：无。
- 无本项目依据的方案条目及风险判定：无；方向性风险已关闭。
- 【待核实】未来 Claude Code 改变原生提示形态后的识别兼容性；未匹配时当前实现 fail-closed，不写 Enter 或任务。
- 【待核实】真实 Electron 验收中的 IMK warning 与 404 diagnostic，未使任一断言失败。
- 【待核实】既有 React `act(...)` 测试警告，完整与范围闸门均未失败。

### 对账

- 验收标准均已有实现、单元／集成验证，以及真实 CLI 或真实 Electron 证据。
- `boundary-matrix.md` 的四个功能单元和五类异常情形均无空白格。
- `pnpm run test --scope HEAD^`、Desktop build、完整 `pnpm test` 与 `git diff --check` 均已通过。
- 归档前的唯一流程项是将现有 spec-delta 合并进 `openspec/specs/`；这不是行为或测试缺口。
