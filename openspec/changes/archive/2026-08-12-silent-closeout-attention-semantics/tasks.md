# 任务：silent-closeout-attention-semantics

> 说明：本 change 为流程补正归档。实现、测试与真机验证均在用户确认产品规则之前完成并通过独立复核；下列任务按实际完成情况勾选，归档动作（五步）为项目级流程，见 `openspec/changes/AGENTS.md`，不列入本清单。

## 实现

- [x] F1：`round-closeout-plan.ts` 一等收束信号同毫秒归属当前轮（`isNotBefore`），`planRoundStart` 保持严格 `>`。
- [x] F2：`round-terminal-runtime.ts` persist-skip 时经 `planRoundExistingState` 返回既有事实权威投影。
- [x] F3：`sqlite-state-worker.ts` 五个读状态操作不再推进 `updated_at`。
- [x] F4：`status-dot.ts` / `round-visible-plan.ts` silent-closeout 不单独点亮红点（awaiting-user 保留）。

## 测试与验证

- [x] 新增 `tests/round-terminal-runtime.test.ts`（重评一致性 ×4：既有事实权威、真实静默落盘保留、新轮静默收束、事实投影）。
- [x] `tests/round-closeout-plan.test.ts` 新增同毫秒用例 ×2（信号与上一轮收束同毫秒属于当前轮；用户消息同毫秒不重开轮）。
- [x] `tests/local-console-sidebar-metadata.test.ts` 新增「读状态操作不推进 updatedAt」用例。
- [x] `packages/console-ui/src/console/status-dot.test.ts` 语义更新（silent-closeout → none/blue；awaiting-user → red）。
- [x] `--scope` 闸门 103 文件 1054 用例全绿；typecheck、`check:boundaries`、desktop build 全绿。
- [x] 隔离数据根真实 Electron 验收 8/8（收束后 30s 不红、历史 silent-closeout 无点且 jsonl 零改写、真实异常仍红、空会话无点、运行中闪烁、state API terminal 投影）。

## 产品规则与事实源

- [x] 2026-08-12 用户确认：「某轮没有主 Agent 明确收尾，但系统也没有卡死、启动失败、重试耗尽、等待用户等异常事实时，不显示红点」。
- [x] `docs/product/pages/main-left-sidebar.md` 决策记录（2026-08-12）与红点来源规则更新。
- [x] 本 change 的 proposal / design / tasks / spec-delta 补齐并归档。
- [x] 独立技术复核（#24）通过；复核发现分档错误后按用户确认补正流程，顺序如实记录。
