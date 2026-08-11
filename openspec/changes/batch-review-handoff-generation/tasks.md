# 任务：batch-review-handoff-generation

## 规则与产品文档

- [x] `docs/product/AGENTS.md`：编写与评审原则改为批次协议（整批起草 → 冻结快照 → 整批评审 → 整批修订），删除逐文件评审/逐文件 commit 要求；建立顺序注明依赖顺序语义
- [x] `docs/product/prompt.md`：提示词正文删除「每次只写/改一个文件、commit 只提交这一个文件、每写完一份就评审」，改为批次起草与整批评审
- [x] `docs/product/pages/main-conversation.md#说话与提及`：追加「主 Agent 后续派工覆盖先前派工、晚到结果不继续推动接力」产品语义
- [x] `seeds/teams/product-development/members/product-delivery-lead/AGENT.md`：评审批次化；主 Agent 只调度与核验（不亲自实现/验收/替代专业结论）；派工纪律（新用户消息默认不结束当前任务，目标/材料/验收标准变化才重新派工）
- [x] `seeds/teams/product-development/members/implementation-lead/AGENT.md`：可连续完成整个已明确的纵向切片，不强制细碎 checkpoint；中断时报告完成项/剩余项/下一步入口
- [x] `seeds/teams/product-development/members/product-reviewer/AGENT.md`、`functional-qa/AGENT.md`：验收者不修改产品或验收工具；工具/环境无效时只返回「无法验收」，不得给产品结论

## 运行时 handoff_generation

- [x] `src/local-console/types.ts`：`LocalHandoffDispatchFact` 类型 + store 可选方法 `recordHandoffDispatch` / `readHandoffDispatchState`
- [x] `src/local-console/store.ts`：`handoff_dispatch` 事实写入（generation = (session, role) 最大值 +1，串行漏斗）与读取（run 所属 generation + 角色最新 generation）
- [x] `src/local-console/control-dispatch.ts`：纯决策 `decideWorkerReplyStalenessCheck` / `decideHandoffStaleness`（含 `decideHandoffStaleOutcome` / `decideHandoffDispatchRecording` / `planHandoffDispatchGeneration` / `planHandoffDispatchState`）
- [x] `src/local-console/worker-runtime-plan.ts`：纯决策 `planWorkerDispatchSequence` / `decideWorkerQueuedDispatch`
- [x] `src/local-console/primary-dispatch-runtime.ts`：schedule-worker 分支先记录派工事实、后推进源消息；worker reply 的 run-primary/schedule-worker 在失效时覆盖为 complete-source
- [x] `src/local-console/worker-dispatch-runtime.ts`：primary-redirect 排队派工按 sequence 取消未启动 run

## 测试与验证

- [x] 纯决策单测：`decideHandoffStaleness` / `decideWorkerReplyStalenessCheck` / `planWorkerDispatchSequence` / `decideWorkerQueuedDispatch`
- [x] store 级测试：generation 单调、跨角色独立、(session, role) 作用域、重启后读取
- [x] 集成测试：重复派工只运行最新派工；晚到回复不交棒且历史保留；正常接力链回归
- [x] `--scope` 定向测试 + typecheck + 相关构建全绿（`pnpm check:boundaries` 与三套 typecheck exit=0；完整 `pnpm test` 按规则留待复核通过后、合并前一次）
