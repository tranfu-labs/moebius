# 任务：ceo-default-plan-chain

- [x] 新增 `agents/ceo-scripts/default-plan-chain.md` 并把它加入 required CEO scripts。
- [x] 更新 `src/agent-prescripts/ceo-ledger-context.ts`：bootstrap context 允许 `default-plan-chain` route 与显式拆分意图下的 `goal-intake`，不再写“只能 goal-intake”。
- [x] 更新 `agents/ceo.md`：收紧外部无 mention 兜底路由说明与普通 CEO bootstrap 目标入账判据，明确普通目标默认方案链、明确拆分才 goal-intake。
- [x] 更新 `tests/runner.test.ts`：覆盖普通目标 route handoff 后 `postComment` 可见、`createIssue` 未调用、goal ledger 写入未调用、ledger 保持空；覆盖无 mention 普通目标两轮 fallback → CEO route 行为；覆盖明确拆分路径不被 `default-plan-chain` 强制覆盖。
- [x] 更新 `tests/ceo-ledger-context.test.ts`、`tests/ceo-scripts.test.ts`、`tests/ceo-orchestration.test.ts`，覆盖 prompt、script registry 与 bootstrap route parser。
- [ ] 归档时把 `spec-delta/github-issue-runner/spec.md` 合入 `openspec/specs/github-issue-runner/spec.md`。
- [ ] 归档时把 `spec-delta/goal-ledger/spec.md` 合入 `openspec/specs/goal-ledger/spec.md`。
- [x] 验证：运行 `pnpm test -- tests/runner.test.ts tests/ceo-ledger-context.test.ts tests/ceo-scripts.test.ts tests/ceo-orchestration.test.ts`；必要时运行全量 `pnpm test` 与 `pnpm typecheck`。
- [x] 实现验收完成后，在 `docs/roadmap/milestone-4-local-console.md` 的 T1 下追记验收证据并勾选。

---

## 30 批处置（归档为历史）

本 change 的产品前提（GitHub issue runner 运行形态）已于 `four-layer-30-github-runner` 随 GitHub runner 一并移除。已实施部分作为历史记录归档，其 GitHub spec/protocol 承诺不再有效；不回滚任何已形成的 local 事实。
