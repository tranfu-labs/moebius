# 任务：acceptance-governance-rules

- [x] 更新 `docs/protocols/github-interaction.md`：新增“验收治理”规则、正例、反例、合规改写，并把规则总览同步到 6 条。
- [x] 更新 `agents/ceo.md`：新增验收治理违规 append-only 介入场景，覆盖未经确认改写验收语句、缩小范围、扩大范围后自判通过、覆盖验收角色不通过结论。
- [x] 更新 `agents/dev.md`：补充 dev 不得自行 rescope / override 验收语句，细化只限机械可执行且需说明理由，调整须需求持有者或用户确认。
- [x] 更新 `agents/product-manager.md` 与 `agents/hermes-user.md`：补充只按已确认验收清单验收，发现未经确认变更或 override 时要求回到需求持有者或用户确认。
- [x] 更新 `agents/qa.md`：补充 QA 增补为测试设计建议，只有需求持有者或用户确认后才并入验收清单。
- [x] 归档时把 `spec-delta/github-issue-runner/spec.md` 合入 `openspec/specs/github-issue-runner/spec.md`。
- [ ] 验证：运行文档 / persona 关键字检查、CEO persona-level 场景检查与 `git diff --check`；必要时运行 `pnpm test` / `pnpm typecheck` 确认文档改动未引入工程回归。
- [ ] 实现验收完成后，在 `docs/roadmap/milestone-2-stability-oracle.md` 的 T5 下追记验收证据并勾选。

---

## 30 批处置（归档为历史）

本 change 的产品前提（GitHub issue runner 运行形态）已于 `four-layer-30-github-runner` 随 GitHub runner 一并移除。已实施部分作为历史记录归档，其 GitHub spec/protocol 承诺不再有效；不回滚任何已形成的 local 事实。
