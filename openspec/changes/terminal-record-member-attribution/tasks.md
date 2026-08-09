# 任务：terminal-record-member-attribution

- [ ] 盘点 `insertSystemMessage`（`src/sqlite-state-worker.ts:5382`）的全部调用点，逐个判定「由运行产生」还是「与运行无关」，产出清单
- [ ] 给 `insertSystemMessage` 增加可空 role 参数并写入该列；与运行无关的调用点显式传 `null`
- [ ] 从 `LocalRunFailureRuntime` 各入口透传运行角色（`primary-wiring.ts` 的 `run.role`、`worker-wiring.ts` 的 `workerInput.role`）
- [ ] 补 store 层测试：终局记录写入后 `role` 等于该次运行的成员；与运行无关的系统通知仍为 `null`
- [ ] 更新 `packages/console-ui/src/console/operator-console.test.tsx` 中断言「查看 协作者 当时使用的信息」的用例——新数据下应显示真实成员名
- [ ] 复查主对话与子任务面板：失败消息表头显示真实成员画像与名字，不再出现「协作者」或「系统提示」
- [ ] `pnpm typecheck` + `pnpm test` 全绿
- [ ] 写 spec-delta 一条 Requirement 覆盖「终局记录保留运行成员身份」
- [ ] 写 .task-done.json，phase="implement"，status="done"|"failed"|"needs-review"
