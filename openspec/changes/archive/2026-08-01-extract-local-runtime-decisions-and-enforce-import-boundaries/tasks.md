# 任务：extract-local-runtime-decisions-and-enforce-import-boundaries

## 0. 动刀前护栏

- [x] 建立并保存 `processPending` / `runWorker` 分支覆盖矩阵，逐项对应现有测试、待补基线或保留的人工风险。
- [x] 先补纯行为基线：claimed-source 动作、source-scoped retry intent、worker lane candidate、共享 invocation plan、missing executing Agent；`runtime.ts` 的生产逻辑尚未修改。
- [x] 保留 primary、user-direct worker、agent-handoff worker 各至少一个 I/O 接缝测试，并确认 provider fact / restart / store failure 的唯一集成测试不被剪掉。
- [x] 固定四文件集合执行 6 次取得 3 次全绿：107/107，wall time 30.58s / 30.75s / 30.56s，中位数 30.58s、范围 30.56–30.75s；另 3 次均为同一 A→B source/order 用例 8s 超时，已登记为既有 flaky。剪枝候选 test-level duration 中位数合计 720.95ms。

## 1. P0：提纯 runtime 决策

- [x] 析出 claimed-source action 与 source-scoped retry intent 纯函数；`processPending` 只执行返回计划，不复制条件树。
- [x] 析出 worker lane candidate 纯函数；保持每 role FIFO、active/tail 跳过与 primary redirect 现有规则。
- [x] 析出 primary / worker 共用 invocation planner；复用 `execution-context.ts`，覆盖 first / resume / edit-resend / graceful same-run / unavailable / rollout unavailable。
- [x] 让 `processPending` 与 `runWorker` 消费纯计划，同时保持 store、JSONL、附件、workspace、provider callback 与生命周期副作用顺序不变。
- [x] 按即时剪枝判据删除/合并失去独立价值的重型重复，并在交付说明列出每一项及替代证据。

## 2. P1：import 边界门禁

- [x] 实现 TypeScript import graph 扫描与规则 evaluator，覆盖 import、export-from、字面量 dynamic import、本地路径解析和可读违规诊断。
- [x] 按 `design.md` 的 MUST NOT 全量映射建立每条可自动表达的 deny / allow-exception 规则；机器不可表达项保持逐模块登记，不写镜像文本测试。
- [x] 在 `module-map.md` 为每条原子禁止项标注唯一 `[IB:<id>]` 或 `[NI:<id>]`，实现 `IB` 文档/registry 双向一致、禁止项标注完整、`NI` 原因非空的结构检查；不得比较条款原文。
- [x] 为规则 evaluator 增加正例、违规边、窄例外、未解析本地 specifier 与多违规诊断测试。
- [x] 把检查接入 `pnpm test`，同步根 `AGENTS.md` 命令入口与 `docs/architecture/module-map.md` 模块入口/边界说明。
- [x] 执行真实反证：临时引入一条违规 import，确认检查非零退出且报告 rule/importer/target；撤销后同命令退出 0。

## 3. 验证、反思与收口

- [x] 运行新增纯测试及保留的 runtime 接缝测试，确认不启真实 CLI 即可覆盖路由、lane 与 resume/invocation 决策。
- [x] 运行 scope 闭环（当前 pnpm 使用 `pnpm run test --scope 2bc009d`）、`pnpm typecheck` 和 desktop build；scope 首轮出现一次既有 SQLite `database is locked`，复跑为 21 files / 350 tests 全绿。
- [x] 交付收尾运行一次完整 `pnpm test`，退出码 0：root 946 + slow 63 + desktop 414 + console-ui 458 全绿，import-boundary preflight 同步通过。
- [x] 用动刀前完全相同的固定四文件命令取得实现后 3 次全绿样本；总降幅 0.21s，剪枝贡献估算 0.72095s，净归因估算 -0.51095s，因此按零净收益声明。
- [x] 对照 proposal / design 复核：公开 API、持久化 schema、错误文案、provider 参数和业务语义均未改变；A3 复核修正把失效 scope 入口更新为 `pnpm run test --scope`。
- [x] 核对 diff 不包含 `desktop/src/console-page/app.tsx`、`src/sqlite-state-worker.ts` 或 `packages/console-ui/src/console/operator-console.tsx` props 改动。
- [x] 向 `@qa` 交付四条真实应用复核语句：无 mention primary、唯一 mention worker FIFO/并行、专业成员回主 Agent/主 Agent 收尾、同 external ID resume 且无 fallback full。

## 逐条验收清单

| ID | 验收项 | 必须提供的证据 |
| --- | --- | --- |
| A1 | 行为不变 | 固定相关套件、`pnpm run test --scope`、完整 `pnpm test` 全绿；符合度复核列出 API/schema/文案/provider 参数未变 |
| A2 | 护栏先行 | git diff / commit 顺序证明基线测试先于 runtime 提取；覆盖矩阵逐分支有归属 |
| A3 | 纯模块成立 | planner 测试只构造内存值，依赖图与测试 spy 证明不 import/调用 CLI、store、fs、JSONL |
| A4 | lane 规则不变 | 纯矩阵 + primary/user-direct/handoff 三条最小 I/O 接缝；FIFO、并行与 abort 信号断言 |
| A5 | resume 规则单一 | 新 planner 复用 `planLocalExecutionRecovery`；first/resume/unavailable/same-run/edit-resend 对称测试及 provider invocation facts |
| A6 | MUST NOT 无遗漏 | `design.md` 全量映射逐模块核对；每个“自动”项有 rule id，每个“非 import”项有原因 |
| A7 | 边界门禁进闸 | `pnpm test` 计划/输出含 import-boundary preflight，正常仓库退出 0 |
| A8 | 违规反证 | 临时违规 import 时退出非零并报告 rule/importer/target；撤销后退出 0，仓库最终无违规代码 |
| A9 | 慢测收益量化 | (a) 前后同命令或同一稳定 pattern 各至少 3 次全绿的 wall-time 中位数/范围/用例数；(b) 每个剪枝用例原 test-level duration 中位数及加总；(c) 总降幅减剪枝贡献的净归因估算，并注明 wall/test duration 口径差；无可靠样本或净收益约零时按零报告 |
| A10 | 范围未漂移 | `git diff --name-only` 不含 P2/P3/props 出局文件；任何发现的 bug 单独登记 |
| A11 | 用户链路可复核 | 四条真实应用验收语句逐条给出入口与可断言信号，供 `@qa` 真机复核 |

## 4. A3 复核修正

- [x] 把 `buildLocalResumePrompt` 原样移动到 `prompt.ts`，更新调用方与纯测试 import，证明字符串行为不变。
- [x] 给 import-boundary evaluator 增加运行时传递依赖闭包；type-only 边不进入闭包，违规诊断包含完整 dependency path。
- [x] 为 `control-dispatch.ts` 与 `run-invocation-plan.ts` 各新增一条 IB closure rule，并以直接 / 间接 `node:fs` 违规做红绿反证。
- [x] 把原交付 IB 计数订正为“修正前 23、本轮后 25”，并把 `AGENTS.md` scope 命令改为 pnpm 9 可用的 `pnpm run test --scope`。
- [x] scope 20 files / 339 tests、typecheck、desktop build 全绿；复核修正后完整闸门 root 947 + slow 63 + desktop 414 + console-ui 458 全绿，保留原四条真机复核语句交给 `@qa`。
