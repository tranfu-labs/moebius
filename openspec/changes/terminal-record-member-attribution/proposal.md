# 提案：terminal-record-member-attribution

## 需求基线

| 文件 | 小节 | 变更 | 状态 |
| --- | --- | --- | --- |
| docs/product/pages/agent-conversation.md | L163（终局记录小节） | 新增「终局记录归属到执行它的那名成员；无法确定成员时如实呈现，不得用占位成员名或默认画像顶替」 | 已写入 |

## 背景

2026-08-09 的对话区 UI 打磨发现：同一次运行，成功与失败写库的形状不一样，失败路径把成员身份丢了。

- **对照证据**：成功记录 `src/sqlite-state-worker.ts:4437`（另有 `:4457`）以 `VALUES (?, 'agent', ?, …)` 写入，第三个占位符是 `input.role`，**成员身份保留**。
- **违反点**：终局记录 `src/sqlite-state-worker.ts:5382` 的 `insertSystemMessage` 以 `VALUES (?, 'system', NULL, …)` 写入，`role` **写死为 NULL**。所有失败/卡住/停止记录都没有成员。
- **不是拿不到**：schema 上 `role TEXT` 无约束（`src/sqlite-state-worker.ts:510`），且运行时在写入那一刻手里就有角色（`run.role` / `workerInput.role`，见 `src/local-console/primary-wiring.ts`、`src/local-console/worker-wiring.ts`）。是写入时主动丢弃。

**更底层的原因**：把「运行如何结束」编码成了「谁在说话」。时间线本有两根独立的轴——说话人（user / agent / system）与结束方式（完成 / 卡住 / 没启动 / 被停下）。把失败记成 `speaker='system'`，等于把结束方式塌进说话人这根轴；而「系统」按定义没有成员，于是 `role` 不是不小心丢的，是在这个编码下**结构上不可能保留**。

**下游代价**（均已在 UI 侧留下补偿代码）：

1. 半截产出无处当 agent 正文存，只能进 `terminal_json.partialMarkdown`，渲染时长在失败卡片里（已在 UI 侧拆开，但数据仍是这个形状）。
2. system 消息唯一载荷是自由文本 `body`，运行时只能把状态写成句子（「这一步卡住了。你可以…」）；`packages/console-ui/src/console/legacy-run-outcome-copy.ts` 是为剥离它而存在的补偿层。
3. `role` 恒为 NULL → UI 靠 `resolveMessageProcessRole`（`packages/console-ui/src/console/operator-console.tsx:3609`）按 `stepId` 找兄弟消息反推；反推不到时 `auditRole = message.role ?? processRole ?? "agent"`（`:3712`）落到 `"agent"`，`resolveOperatorMemberName` 返回「协作者」并配默认画像——**为一次机器故障编造出一名不存在的成员**，与 agent-conversation.md L160「不解释成 Agent 的业务判断」相抵触。
4. 完全认不出成员时退到「系统提示」表头（`operator-console.tsx:3856`、`subtask-tab.tsx:326`）。该措辞不是产品概念：PRD 中「系统提示」只作为*不该自动生成的东西*出现（`docs/product/pages/main-conversation.md:1064`），i18n key 来自本地化提取而非设计。

## 提案

让终局记录保留它所属运行的成员身份，使成功与失败成为同一次运行的两个终态。

- **最小版**：`insertSystemMessage` 接受并写入 `role`，调用链（`recordStuck` / `recordInterrupted` / `recordFailure` / `recordDeadLetter` / `markStaleRunning` 及 `run-failure-runtime` 各入口）把已有的运行角色透传下去。存量行 `role` 仍为 NULL，UI 保留反推作为兼容路径。
- **彻底版（可后续独立成 change）**：失败运行的半截产出按 agent 消息正文存，结束方式作为结构化元数据（`system_event_kind` + `terminal_json`）挂在同一条记录上；届时可删除 `legacy-run-outcome-copy.ts` 与运行时写入 UI 文案的逻辑。

本 change 只做最小版。

## 影响

- **数据层**：`src/sqlite-state-worker.ts` 的 `insertSystemMessage` 及其全部调用点；无需 schema 迁移（`role` 列已存在且可空）。
- **运行时**：`src/local-console/run-failure-runtime.ts`、`primary-wiring.ts`、`worker-wiring.ts` 透传角色。
- **UI**：`resolveMessageProcessRole` 反推、`?? "agent"` 兜底、「系统提示」表头三处在新数据下不再被触发；存量行仍需它们，**本 change 不删**，删除条件写在 design.md。
- **对外行为**：失败消息表头从「协作者 / 系统提示」变为真实成员名与画像；已有测试 `operator-console.test.tsx` 中断言「查看 协作者 当时使用的信息」的用例需要随之更新。
