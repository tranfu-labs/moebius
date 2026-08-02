# 提案：ceo-default-plan-chain

## 背景

里程碑 4 T1 要修正当前 GitHub 运行时的新目标入口：目标形状的新会话默认应走方案链，而不是立即进入 goal-intake 拆分。现状有两层约束共同导致“默认拆分”：

1. `src/agent-prescripts/ceo-ledger-context.ts` 在无 active phase projection 的 bootstrap context 中明确写入 “You may only use the goal-intake workflow”，使普通 `@ceo` agent 无法输出 `route` 工作流。
2. `agents/ceo.md` 的外部无 mention 兜底路由把“我想做一个 X”追加给 `@ceo`，而普通 CEO bootstrap 又被机制层限制为只能 goal-intake。

结果是：一个没有明确拆分意图的目标入口，也会被推向 goal-intake 采访 / 提案 / 子 issue 拆分路径，和 T1 要求的“默认方案链，拆分只在明确表达时触发”相反。

## 提案

把 bootstrap 入口改成“可路由”的 CEO 决策点，而不是“只能 goal-intake”的机制闸：

1. 新增 CEO route 剧本 `default-plan-chain`，用于无 active ledger projection 且无明确拆分 / 编排意图的新目标入口；该剧本只发布一条 `@dev` handoff，让 dev 按 OpenSpec 流程采访、写方案、输出 `plan-written`。
2. 修改 `ceo-ledger-context.ts` 的 bootstrap prompt：在无 active phase 时允许 `default-plan-chain` route 和 `goal-intake`，但继续禁止 `spawn_child_issues` / `roundtable` 这类需要 visible task ids 的结构化编排。
3. 收紧 `agents/ceo.md` 的兜底路由与普通 CEO 目标入账判据：普通目标形状（如“我想做一个 X”“帮我实现 X”“帮我设计 X”“怎么做 X”）默认进入 `default-plan-chain`；只有用户明确表达拆成多个任务、并行做、编排多个子任务、创建子 issue / 子任务、阶段化拆解并分派角色时，才进入 `goal-intake`。
4. 更新 `github-issue-runner` 与 `goal-ledger` spec-delta：明确 plain goal bootstrap route 不写 ledger、不拆 child issue；goal-intake ledger admission 只在明确拆分 / 编排或用户确认 proposal 时发生。
5. 补纯单元测试 / 纯函数测试，覆盖 bootstrap prompt、CEO script registry、route parser、runner 副作用边界与已确认的 5 条正式验收语句。

## 影响

受影响文件预计为：

- `src/agent-prescripts/ceo-ledger-context.ts`
- `agents/ceo.md`
- `agents/ceo-scripts/default-plan-chain.md`
- `src/ceo-scripts.ts`
- `tests/runner.test.ts`
- `tests/ceo-ledger-context.test.ts`
- `tests/ceo-scripts.test.ts`
- `tests/ceo-orchestration.test.ts`
- `openspec/specs/github-issue-runner/spec.md`（通过本 change 的 spec-delta，归档时合入）
- `openspec/specs/goal-ledger/spec.md`（通过本 change 的 spec-delta，归档时合入）
- `docs/roadmap/milestone-4-local-console.md`（实现验收完成后追记 T1 证据并勾选）

不引入本地 adapter、SQLite、UI、真实 GitHub issue 端到端测试或 T2+ 范围。
