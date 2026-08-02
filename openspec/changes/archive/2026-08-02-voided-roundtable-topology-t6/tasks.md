# 任务：roundtable-topology-t6

- [ ] 新增 `agents/ceo-scripts/roundtable-plan-review.md`，定义 v0 方案评审团剧本、参与者顺序、固定一轮规则、汇总保留分歧与依据的要求
- [ ] 更新 `agents/ceo.md`：普通 CEO agent 路径可识别并使用 roundtable workflow；确认不改变 guardrail 的 `plan-written` qa 审查回流
- [ ] 更新 `src/ceo-scripts.ts`：支持 `roundtable` action，并把 `roundtable-plan-review` 加入 required workflows
- [ ] 更新 `src/ceo-orchestration.ts`：新增 roundtable start / route / complete parser、hidden key builder、child body renderer、parent summary renderer 与 contribution 校验
- [ ] 更新 `src/runner.ts`：实现 roundtable start 创建 / 找回 child issue、保存 bounded task child ref、父 issue发布 child URL
- [ ] 更新 `src/runner.ts`：实现 roundtable route 在 child issue 内按参与者顺序逐个 handoff，且只允许一个合法 mention，并由 renderer 强制追加回交 CEO 指令
- [ ] 更新 `src/runner.ts`：实现 roundtable participant no-handoff recovery；参与者发言未 `@ceo` 时，在 no-trigger 前发布可见 recovery 评论唤醒 CEO
- [ ] 更新 `src/runner.ts`：实现 roundtable complete 的参与者发言校验、父 issue汇总回流、与 summary wording 无关的 completion key 去重、child 完成说明
- [ ] 实现失败留痕：参与者未响应、参与者未回交 CEO、主持人无法汇总、hidden key lookup / createIssue / ledger save timeout、父 issue回流失败、父回流成功后 child 完成说明或 role thread 保存失败时均有可见 fail-closed 路径或既有 dead-letter 收敛
- [ ] 补齐 `tests/ceo-scripts.test.ts`：required workflow、缺失 workflow、action mismatch
- [ ] 补齐 `tests/ceo-orchestration.test.ts`：roundtable start / route / complete 正常与非法结构、单 mention、participants / contributions 覆盖
- [ ] 补齐 `tests/runner.test.ts`：start 创建与幂等找回、create 成功但 ledger save timeout 后重试找回、route 顺序、participant no-handoff recovery、complete 回流、父回流成功后收尾失败去重、父回流失败、hidden lookup timeout、v1 fan-out 非执行边界
- [ ] 更新 `docs/protocols/github-interaction.md`：说明 v0 roundtable 仍遵守单 mention；v1 多 mention fan-out 是后续例外设计
- [ ] 更新 `docs/architecture/module-map.md` 与必要架构图：记录 roundtable action 位于 CEO orchestration / runner 边界，不引入 trigger 多 mention
- [ ] 更新 `AGENTS.md` 与相关 OpenSpec specs；实现验收通过后追记 `docs/roadmap/milestone-3-orchestration.md` 的 T6 验收证据并勾选
- [ ] 运行 `pnpm test -- ceo-scripts ceo-orchestration runner`、`pnpm test`、`pnpm typecheck`、`git diff --check`

---

## 30 批处置（显式作废）

本 change 从未实施（tasks 无任何已完成项），且其唯一产品前提 GitHub issue runner 已于 `four-layer-30-github-runner` 移除，前提不复存在。显式作废，不再排期；保留目录以便追溯决策，不做静默删除。
