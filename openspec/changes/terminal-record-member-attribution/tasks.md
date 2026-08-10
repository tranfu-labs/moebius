# 任务：terminal-record-member-attribution

- [x] 盘点 `insertSystemMessage`（`src/sqlite-state-worker.ts:5382`）的全部调用点，逐个判定「由运行产生」还是「与运行无关」，产出清单
  - 清单：`recordDetachedRunTerminal` / `recordSystemAndComplete` / `recordSystemMessage` / `recordFailure` / `recordDeadLetterAndComplete` / `recordInterrupted` / `recordStuck` / `markStaleRunning` 三处。由运行产生：detached terminal、failure、dead-letter、interrupted、stuck、markStaleRunning（按行派生 `role ?? dispatchRole`）、recordSystemMessage 的 directory-unavailable 警告（primary/worker terminal 传入 run.role）。与运行无关：recordSystemAndComplete、session-presentation / session-metadata 的普通通知（保持 null）。
- [x] 给 `insertSystemMessage` 增加可空 role 参数并写入该列；与运行无关的调用点显式传 `null`
- [x] 从 `LocalRunFailureRuntime` 各入口透传运行角色（`primary-wiring.ts` 的 `run.role`、`worker-wiring.ts` 的 `workerInput.role`；dispatch/execution 路径用 `message.dispatchRole`，worker missing-agent 用 `role` 参数，orphan stuck 由 `identifyOrphanRuns` 携带 `dispatchRole`）
- [x] 补 store 层测试：终局记录写入后 `role` 等于该次运行的成员；与运行无关的系统通知仍为 `null`（`tests/local-console-process-steps.test.ts` 第二个用例，含重启回放）
- [x] 更新 `packages/console-ui/src/console/operator-console.test.tsx` 中断言「查看 协作者 当时使用的信息」的用例——新数据下应显示真实成员名
  - 结论：UI 兜底按 design 长期保留（存量 NULL 行兼容），该用例 fixture 故意用 role=NULL，仍是兼容路径的有效覆盖，未改写；新数据路径由 store 测试 + 运行时 role 透传覆盖。
- [ ] 复查主对话与子任务面板：失败消息表头显示真实成员画像与名字，不再出现「协作者」或「系统提示」（真实运行 UI 复查，属验收动作，交 reviewer）
- [ ] `pnpm typecheck` + `pnpm test` 全绿（由 delivery-lead 代跑闸门）
- [x] 写 spec-delta 一条 Requirement 覆盖「终局记录保留运行成员身份」
- [x] 写 .task-done.json，phase="implement"，status="done"|"failed"|"needs-review"
