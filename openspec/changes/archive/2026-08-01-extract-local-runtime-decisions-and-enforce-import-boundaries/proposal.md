# 提案：extract-local-runtime-decisions-and-enforce-import-boundaries

## 需求基线

本 change 是行为不变的内部重构，不修改 PRD，也不需要产品采访。事实源锚点为：

| 文件 | 小节 | 变更 | 状态 |
| --- | --- | --- | --- |
| `docs/architecture/module-map.md` | `local-console` 与各模块「禁止依赖」 | 记录析出的纯决策模块与自动 import 边界门禁 | 实现验证后更新 |
| `openspec/specs/local-console/spec.md` | 本地 Agent 路由、并发 lane、provider identity / resume、失败恢复 | 仅作为行为不变基线，不修改 Requirement | 无变更 |

`spec-delta/` 保持为空：P0 不改变已实现行为，P1 是工程架构门禁，不是产品或运行时行为规格。归档时只核对现有 local-console spec 未被实现偏离，不合入新的行为 Requirement。

## 背景

`src/local-console/runtime.ts` 当前约 5,550 行。问题不在文件长度本身，而在 `processPending`（约 930 行）与 `runWorker`（约 700 行）把多种独立变化理由放在同一个 I/O 编排体内：claimed source 路由、主/专业 lane 选择、provider 恢复资格、prompt 与附件增量、执行上下文冻结、CLI 调用、JSONL / SQLite 写入、运行生命周期和失败清理。

已有恢复核心 `planLocalExecutionRecovery` 已是纯函数并有直接单测，但它的输入装配、主/专业运行的公共 prompt 决策和 lane 路由仍只能通过 server、SQLite 与 fake provider 的重型测试间接验证。结果是同一决策在 primary / worker 两条路径重复，测试慢且容易把决策错误与 I/O 时序错误混在一起。

`docs/architecture/module-map.md` 的禁止依赖目前也只靠人工阅读。可由 import graph 表达的边界没有自动门禁，未来重构可能在测试仍绿时引入反向依赖。

方案阶段已对固定相关测试集合做了四次重构前试跑：

```text
pnpm exec vitest run \
  tests/local-console-execution-runtime.test.ts \
  tests/local-console-codex-resume.test.ts \
  tests/local-console-pending-switch.test.ts \
  tests/local-console.test.ts \
  --maxWorkers=1 --no-file-parallelism
```

- 样本 1：106/106 通过，wall time 32.45s。
- 样本 2：104/106，通过集合外有 2 个现有时序/隔离失败，wall time 51.92s。
- 样本 3：105/106，通过集合外有 1 个现有时序失败，wall time 41.09s。
- 样本 4：106/106 通过，wall time 34.40s。

失败集中在本 change 正要提纯的两个间接测试：多 session 路由组合，以及 no-trigger retry 的 source/order 组合。它们不是本 change 引入的回归，也不能被当作有效性能基线。实现第一步必须先把这些规则以纯测试直接固定，并保留最小 I/O 接缝测试；在生产代码提取前取得可重复的绿色基线。

## 提案

1. 护栏先行：建立 `processPending` / `runWorker` 的分支覆盖矩阵；对没有直接护栏的 claimed-source 路由、worker lane 选择、source-scoped retry 选择和主/专业共用 invocation 规划补纯行为基线。已有端到端测试只在仍证明跨层接缝时保留。
2. 从 `processPending` 析出不依赖 store、文件系统、provider 或 shell 的控制决策：claimed source 下一动作、主 Agent 回收规则、worker redirect、source-scoped retry intent 与可派发 worker lane 计划。
3. 从 `processPending` / `runWorker` 析出共享的纯 invocation 规划：恢复结论投影、同 run continuation、full / resume / edit-resend prompt 选择、timeline / attachment 增量范围、workspace access 与 active-run 描述。继续复用 `execution-context.ts` 的 provider identity / resume 单一事实，不复制恢复算法。
4. `runtime.ts` 保留 I/O 编排职责：读取事实、调用纯 planner、执行 store / JSONL / 附件 / workspace / provider 副作用，并按现有顺序提交成功或失败事实。
5. 新增 import 边界检查器，扫描仓库 TypeScript import / re-export / dynamic import 图，对 `module-map.md` 中所有可由静态依赖表达的 MUST NOT 条款执行 deny + narrow allow-exception 规则，并进入 `pnpm test`。
6. 对所有不能由 import graph 判定的 MUST NOT 条款逐模块登记原因；不把运行时副作用、数据内容、安全参数或“不得复制业务事实”伪装成 import 检查已覆盖。

## 影响

预期改动只涉及：

- `src/local-console/runtime.ts`
- `src/local-console/` 下新增或扩展的纯控制 / invocation planner
- 对应纯单测与最小 runtime 接缝测试
- import 边界检查器、规则清单、检查器单测与 `pnpm test` 编排
- `docs/architecture/module-map.md`、根 `AGENTS.md`（新增工程检查入口）
- 本 change 的架构图与方案证据

明确不涉及：

- `desktop/src/console-page/app.tsx`
- `src/sqlite-state-worker.ts`
- `packages/console-ui/src/console/operator-console.tsx` props
- 用户可见文案、API shape、SQLite schema、JSONL schema、provider CLI 参数或业务语义
- 任何顺手 bug 修复；发现问题只登记并报告主理人

