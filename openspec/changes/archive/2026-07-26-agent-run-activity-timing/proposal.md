# 提案：agent-run-activity-timing

## 需求基线

| 文件 | 小节 | 变更 | 状态 |
| --- | --- | --- | --- |
| `docs/product/pages/agent-conversation.md` | 页面结构、最新活动、运行耗时、完整输出、停下、重试与恢复 | 新增单 Agent 运行记录的活动投影、明确计时和尝试语义 | 已写入 |
| `docs/product/pages/main-conversation.md` | 时间线、运行中的操作条、停下、重试与恢复 | 全局时间线复用单 Agent 规则，成员停止按 run 精确作用 | 已写入 |
| `docs/product/pages/main-right-sidebar.md` | 过程标签 | 同一步聚合尝试并保留每次尝试时间，Kimi 局部降级 | 已写入 |

## 背景

当前操作台只在活动 run 中展示最新 Agent Markdown 或 stdout 摘要，运行时间被 DTO 提供但界面主动隐藏；结构化工具调用只在完整输出中可见。Agent 一段时间没有新文字时，用户无法在时间线中区分仍在工作、卡住或已经结束，也容易把历史裸时间误认为开始或结束时刻。

## 提案

- 为本地 run 增加向后兼容的生命周期、活动与终态事实，并在 API DTO 中提供安全活动摘要、实际累计时长、完成时刻、执行引擎和步骤尝试关系。
- 从 Codex JSONL 与 Kimi ACP 的结构化执行事件投影最新一条安全活动；活动游标单调前进，完成事件不会闪回较早工具。
- 活动记录显示「已进行」和最新活动；终态承接记录显示一次「耗时」，完成时刻仅通过悬停、键盘聚焦和可访问说明提供。
- 用户重试创建同一步的新 run；过程标签按步骤聚合尝试并展示每次尝试的独立时间。
- Codex 才提供可点击的完整输出；Kimi 在原位显示能力不可用说明。

## 影响

- `src/codex.ts`、`src/kimi.ts`、`src/local-console/execution-driver.ts`：执行生命周期与结构化活动回调。
- `src/local-console/runtime.ts`、`store.ts`、`types.ts`、`process-history.ts`：事实记录、运行投影和尝试时间。
- `packages/console-ui`：活动行、时间语义、成员级停止、终态时间和过程尝试头。
- `desktop/src/console-page`：消费扩展 DTO；不新增跨进程权限或新页面。
