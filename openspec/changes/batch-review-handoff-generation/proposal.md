# 提案：batch-review-handoff-generation

## 需求基线

| 文件 | 小节 | 变更 | 状态 |
| --- | --- | --- | --- |
| `docs/product/AGENTS.md` | 编写与评审原则 | 逐文件起草/评审改为「同一依赖批次整批起草 → 冻结批次快照 → 整批评审 → 整批修订」，删除逐文件评审与逐文件 commit 要求 | 本次写入 |
| `docs/product/prompt.md` | 提示词正文 | 同步批次协议，删除「每次只写/改一个文件、commit 也只提交这一个文件、每写完一份就评审」 | 本次写入 |
| `docs/product/pages/main-conversation.md` | 说话与提及 | 新增「主 Agent 后续派工覆盖对同一成员的先前派工；被覆盖派工的晚到结果不继续推动接力」产品语义 | 本次写入 |
| `seeds/teams/product-development/members/product-delivery-lead/AGENT.md` | 职责 / 克制与启用条件 | 评审批次化；主 Agent 只调度与核验，不亲自实现/验收/替代专业结论；派工纪律（新用户消息默认不结束当前任务，只有目标/材料/验收标准变化才重新派工） | 本次写入 |
| `seeds/teams/product-development/members/implementation-lead/AGENT.md` | 职责 | 可连续完成整个已明确的纵向切片，不强制细碎 checkpoint；中断时报告完成项/剩余项/下一入口 | 本次写入 |
| `seeds/teams/product-development/members/product-reviewer/AGENT.md` | 边界与交棒 | 验收者不修改产品或验收工具；工具/环境无效时只返回「无法验收」，不得给产品结论 | 本次写入 |
| `seeds/teams/product-development/members/functional-qa/AGENT.md` | 职责 | 同上：工具/环境不成立时不得判产品失败 | 本次写入 |
| `openspec/specs/local-console/spec.md` | （新增 Requirement） | 派工世代：每次主 Agent 派工持久化递增 generation；未启动旧派工不执行；已运行旧派工的晚到回复不触发交棒/主 Agent run；历史保留 | spec-delta |

## 背景

一次真实产品开发会话（18.8 MB / 135 次运行）暴露六类协作问题：同一纵向功能被拆成七份文档逐份串行编写与评审；派工没有互斥、幂等与去重（19:55 与 19:56 对同一修订文件重复派工，文档阶段出现 16 次无新材料重复评审）；单个实施回合过大且不可恢复；验收期间持续修工具导致产品/工具问题混杂；无受控并行（blanket serial）；主 Agent 越过调度边界亲自实现与验收。

根因收敛为三处：

1. **执行单位错了**：产品文档把「事实源按文件分存」错误等价为「执行过程必须逐文件串行」，「每写完一份就评审」把评审强制插入写作中间。
2. **控制权没有世代**：主 Agent 后续派工不会覆盖先前派工；同一角色被重复派工时，旧派工（已排队或已运行）照常执行，其晚到结果照常继续推动接力——机器层没有任何拒绝点。
3. **角色与阶段边界不清**：主 Agent 定义没有禁止亲自实现/验收/替代专业结论；验收者被允许在验收回合内修工具与环境；实施授权没有限定工作单元与中断交接格式。

本轮按用户确认的收敛方案修复这三处：批次化评审（不建 DAG 调度器）、轻量 `handoff_generation` 运行时机制（不建通用任务平台）、角色提示词收紧（不建 capability 沙箱）。

## 提案

1. **产品文档批次化**：同一依赖批次内的全部文件完成草案后冻结为一个统一快照，整批交付评审，评审按批次闭环、问题按文件定位；默认流程为「整批起草 → 冻结批次快照 → 整批评审 → 整批修订 → 对新快照复评」。存在真实前置依赖时预先拆成依赖批次，仍不是逐文件评审。删除「每个文件单独 commit」要求，commit 对应原子产品变更。多个专业视角需要并行评审时审查同一批次快照。
2. **轻量 handoff_generation**：每次主 Agent 对 (session, role) 的派工持久化一条 `handoff_dispatch` 事实并分配递增 generation；新派工 supersede 同角色旧派工——未启动的旧派工 run 不再执行（排队即取消），已运行旧派工的晚到回复在落后于最新 generation 时不触发交棒或主 Agent run（只推进处理位点），历史消息与事实保留。用户直达派工不参与该机制。不建设任务表、依赖图或通用任务平台。
3. **角色提示词收紧**：主 Agent 只负责调度、证据完整性与交付决策，不亲自修改生产代码/OpenSpec/测试/验收脚本，不亲自执行验收，不亲自重跑验证替代专业结论；实施者可连续完成整个已明确的纵向切片并报告中断交接；验收者不修改产品或验收工具，工具/环境无效时只返回「无法验收：工具/环境无效」，不得判产品失败。

## 影响

- `src/local-console/`：`types.ts`（新事实类型与 store 方法）、`store.ts`（handoff_dispatch 事实读写）、`control-dispatch.ts`（纯决策：晚到结果判定）、`worker-runtime-plan.ts`（纯决策：排队派工覆盖）、`primary-dispatch-runtime.ts`（派工时记录事实；处理晚到回复时失效）、`worker-dispatch-runtime.ts`（排队派工取消）。
- 会话事实 JSONL 新增 `handoff_dispatch` 事件类型（空 messageUpserts，不改变消息投影）；SQLite 不新增表（事实只读回放）。
- 产品文档流程与团队种子提示词：`docs/product/AGENTS.md`、`docs/product/prompt.md`、`docs/product/pages/main-conversation.md`、`seeds/teams/product-development/members/*`。
- 对外行为：同一成员被主 Agent 重复派工时只执行最新派工；被覆盖派工的晚到结果不再推动接力；用户直达派工行为不变；产品文档按批次起草与评审。
