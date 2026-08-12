# 设计：silent-closeout-attention-semantics

## 方案

实现已随红点修复完成（F1–F4），本文件记录设计形态供归档追溯。

### F1 · 一等收束信号与上一轮收束同毫秒时归属当前轮

`src/local-console/round-closeout-plan.ts`：`primary_closeout` 与 `round_terminal` 在同一判定时刻成对落盘（`occurredAt` 相同）。重评时把 `primaryFinishedAfterRoundStart` 与 `buildRoundView.closeoutInRound` 的判定从严格 `>`（`isAfter`）改为不早于比较（`isNotBefore`，`>=`）。`planRoundStart`（用户消息晚于收束才开新一轮）保持严格 `>` 不变——用户动作必须严格晚于收束才属于新轮，而同毫秒的收束信号与收束事实必然属于同一轮。

### F2 · 重评结论与持久化一致

`src/local-console/round-terminal-runtime.ts`：`evaluate` 在 `planRoundPersist` 判定 skip（同 roundId 已有事实）时，经 domain 纯函数 `planRoundExistingState` 返回既有事实的 terminal 状态，绝不以重评新结论（静默兜底等）覆盖投影。状态与事实日志从此单源一致，重复 `/state` 稳定。

### F3 · 读状态操作不推进 `updated_at`

`src/sqlite-state-worker.ts`：`markSessionResultRead`、`updateSessionReadState`（mark-read-attention / mark-read-unread / mark-unread）、`armSessionManualUnread`、`markSessionViewed` 不再更新 `updated_at`。读不是内容活动：不击穿 `planRoundReuse` 剪枝、不触发重评、不扰动会话排序。revision 推进与 STALE 守卫保持不变。

### F4 · silent-closeout 不单独点亮红点

`packages/console-ui/src/console/status-dot.ts`（`planRoundNeedsAttention` 只保留 `awaiting-user`）与 `src/local-console/round-visible-plan.ts`（Dock 投影同语义）。真实异常会话的红点由独立机制承担：attention / `unresolvedSystemEventKind`（`run-not-started` / `run-stuck` / `retry-exhausted` 系统记录），这些机制不受本变更影响（真机证明：run-stuck 会话仍红）。

## 权衡

| 选项 | 取舍 | 结论 |
| --- | --- | --- |
| silent-closeout 不单独点红（本方案） | 「没有明确收尾」的纯静默轮次失去红点；换取升级前追溯误标的历史会话不再整片变红。用户已确认（2026-08-12） | 采用 |
| 保留 silent-closeout 红点，只修 F1–F3 | 当前用户会话（非主成员收轮触发的静默兜底）仍会红，与用户目标不可兼得 | 不采用 |
| 区分「追溯误标」与「真实静默收束」再分别点亮 | 两种事实在事实层不可区分（都无一等信号、都静置超窗落盘），需要不可靠的时间/来源启发式 | 不采用；红点统一由独立异常事实承担 |
| 读状态操作继续推进 `updated_at`，只放宽轮次剪枝 | 需要改动剪枝输入语义，且会话排序仍被「读」扰动 | 不采用；读不推进 `updated_at` 更贴近语义 |

## 风险

- **纯静默兜底不再红**：无异常信号的静默收束（如一等信号丢失且无任何异常记录）不显示红点。用户已确认接受；真实异常场景（进程崩溃、run 卡住等）通常伴随 unresolved 系统记录，红点由它们承担。
- **awaiting-user 409 盲区**（既有边界）：roundState 红点的「标记为已读」菜单在服务端 STALE 守卫不认识 roundState 时返回 409；awaiting-user 红点经发新消息自然消除，本变更后 silent-closeout 不再触发该路径。不扩 scope，记录在案。
- **回滚**：F1–F3 为一致性修复，回滚即恢复严格比较与 updated_at 推进（红点复现）；F4 回滚即恢复 silent-closeout 红点（历史会话整片变红复现）。事实日志无迁移，任一方向均不产生数据改写。
