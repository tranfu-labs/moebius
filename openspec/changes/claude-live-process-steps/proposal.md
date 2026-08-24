# 提案：claude-live-process-steps

## 需求基线

| 文件 | 小节 | 变更 | 状态 |
| --- | --- | --- | --- |
| `docs/product/pages/main-conversation.md` | [#Agent 执行与恢复](../../../docs/product/pages/main-conversation.md) | 新增条目：Claude 的过程与结果分两条来源——transcript 在轮次进行中被只读跟随并投影为与其他引擎同构的过程步骤与活动行，轮次结束后才读取最终正文与 usage | 已写入 |
| `docs/product/pages/main-conversation.md` | #指标与验收 | 新增验收 121；本 change 承接其中「步骤在 Stop 之前出现且不与最终正文重复」部分，终端相关部分由 `claude-terminal-demotion` 承接 | 已写入 |

## 背景

Claude 是四个执行引擎里唯一一个运行中没有结构化过程的。`ClaudeRunOptions` 声明了 `onVisibleAgentMarkdown`、`onStructuredActivity`、`onExecutionProgress`（`src/claude.ts:90-95`），但整个 TUI 路径从不调用它们——只有 headless 时代的 `src/claude-print.ts` 调用过。

后果是：Claude run 进行中，运行块里既没有过程步骤，也没有活动行，也没有流式正文。唯一的实时反馈是那块只读终端。这正是 `claude-tui-resume` 当初引入 raw terminal 的原因——它在 design 的权衡里被记为「raw terminal vs stream-json Markdown」，因为改用持久 TUI 后没有结构化流可用了。

但这个前提已经变了：`provider-native-process-traces` 与 `process-step-detail` 已经把 Claude 的思考、工具调用与工具结果从 transcript JSONL 结构化投影出来，与 Codex、Kimi 同构（并为此给 argv 加了 `--thinking-display summarized`）。缺的只是「运行中」这一段：现有 resolver 只在 Stop 之后读一次。

## 提案

把 Claude transcript 的读取从「Stop 后一次性」扩展为「轮次进行中只读跟随 + Stop 后按边界定案」：

- 轮次写入人类输入时记下已验证的 transcript 记录边界，之后增量读取该边界之后新追加的记录；
- 把新记录按已定的 Claude transcript 投影规则转成结构化活动事件，交给既有的 `onStructuredActivity` 通道，从而复用 Codex/Kimi 共用的步骤投影与活动行管线；
- 跟随器只读：不驱动 lifecycle，不产出最终正文与 usage，不改变 Stop 后 resolver 的既有边界语义。

## 影响

- `local-console`：新增 Claude transcript 跟随器；Claude adapter 接线三个既有回调；Claude 运行期活动与步骤行为规格。
- 不影响：Codex、Kimi、Pi 的活动来源与步骤投影；Claude 的 hooks、PTY 生命周期、resume 语义、managed-process lease；最终正文与 usage 的既有事实源和 fail-closed 判据。
- 本 change 结束后主时间线同时存在过程步骤与只读终端；终端降级由 `claude-terminal-demotion` 承接。
