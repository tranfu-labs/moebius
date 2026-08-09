# 设计：terminal-record-member-attribution

## 方案

`insertSystemMessage`（`src/sqlite-state-worker.ts:5382`）当前把 `role` 写死为 `NULL`。改为接受一个可空的 `role` 参数并写入：

- 由**运行**产生的终局记录（`recordStuck` / `recordInterrupted` / `recordFailure` / `recordRetryableFailure` / `recordDeadLetterAndComplete` / `markStaleRunning` 的批量置 stuck）传入该次运行的角色。
- 与运行无关的系统通知（子会话卡片 `:3428`、上下文更新一类）继续传 `null`——它们本来就没有成员，不是丢失。

角色在写入点已经可得，只需透传：`LocalRunFailureRuntime` 的各入口已持有 `message` 与运行上下文，`primary-wiring.ts` 的 `recordFailure: (run, result) => …` 有 `run.role`，`worker-wiring.ts` 有 `workerInput.role`。给 `LocalRunFailureRuntime` 的方法签名补一个 role 参数，逐层传到 store。

UI 侧本 change **不动**。新写入的行会自然走 `message.role !== null` 分支，反推与兜底不再被触发。

## 权衡

- **只补 role，不改 speaker**：保持 `speaker='system'` 可以让「这是一条终局记录而非 Agent 发言」的现有判定（`terminalOutcome`、时间线分组、`speaker IN ('user','agent')` 的若干查询）全部不变，风险最小。代价是「结束方式塌进说话人轴」这个根本问题只被缓解、没有消除——半截正文仍存在 `terminal_json`、运行时仍往 `body` 写文案。这两项留给「彻底版」。
- **不做数据迁移**：`role` 可空，存量行保持 NULL。迁移需要从 `run_id`/`step_id` 反查历史运行的角色，收益低于风险（反查失败会写入错误归属，比留空更糟）。因此 UI 的反推与兜底作为**兼容路径长期保留**。
- **不改 `system_event_kind` 的取值集合**：本 change 不触碰状态分类。

## 风险

- **UI 兜底代码的删除时机**：`resolveMessageProcessRole`、`?? "agent"`、「系统提示」表头只要还有存量 NULL 行就不能删。删除条件：确认目标部署的 `session_messages` 中不存在 `speaker='system' AND run_id IS NOT NULL AND role IS NULL` 的行。在那之前它们是必要的兼容层，不是冗余。
- **归属错误比留空更糟**：透传时必须用**这次运行**的角色，不能用「会话里最近一个成员」之类的近似。任何拿不准的路径宁可继续传 `null`。
- **回滚**：改动是加法（多写一列已有字段），回滚即恢复写 `NULL`，不影响读路径。
