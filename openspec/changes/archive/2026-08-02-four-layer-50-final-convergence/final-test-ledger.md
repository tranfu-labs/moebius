# 00～50 六批测试总账

## 1. 汇总结论

| change | 重构/新增纯测试 | 集成接缝删除 | 契约/死代码删除 | 镜像/失义测试删除 | 结论 |
| --- | --- | ---: | ---: | ---: | --- |
| 00 boundary foundation | 门禁与 10 组反例 fixture | 0 | 0 | 0 | 只建防线 |
| 10 local console | 31 项纯决策测试；4 条集成 ledger 全保留 | 0 | 0 | 6 | provider 源码镜像由 IB 接管 |
| 20 desktop renderer | controller/domain tests；5 条集成 ledger 全保留 | 0 | 0 | 0 | mounted React/fetch/IPC 接缝不抵扣 |
| 30 GitHub runner retire | local/shared 接缝先保留或增强 | 0 | 342 | 0 | 产品契约 322 + 孤儿 goal-ledger 20 |
| 40 adapter convergence | parser/plan tests净增；真实 I/O 表全部保留 | 0 | 0 | 0 | 测试净删除 0 |
| 50 final convergence | failure code/latest translator/sentinel tests | 0 | 0 | 1 | legacy copy-debt 契约消失，全量 guard 接管 |

不存在“集成测试降级为纯测试后删除”的项目；该列六批均为 0。删除只发生在三类判据明确不同的场景：
产品契约退役、无生产消费者的死代码、源码镜像/legacy debt 契约失义。

## 2. 10 批：源码镜像 → 机制化门禁

删除文件 `tests/desktop-runtime-provider-scope.test.ts`，六个 test-name：

1. `keeps every concrete Codex entry point explicitly classified`
2. `keeps every concrete Kimi entry point explicitly classified`
3. `keeps Claude limited to local console and isolated AI team building`
4. `injects the active desktop data root into the local console provider runtime`
5. `keeps each persistent Agent call site fail-closed on its own provider identity`
6. `keeps auxiliary inference full and detached from Agent session state`

机械删除判据：测试递归读取生产源码并冻结 import 文件、helper 名与调用文本，重构后唯一修法是抄新路径。
接管门禁：`architecture-layer-dependency-matrix`、`adapter-boundary-branch-total`、
`domain-pure-runtime-closure`；provider full/resume、身份 fail-closed、data root 与 route 行为测试继续保留。

## 3. 20 批：五条候选全部保留

canonical ledger 位于 `openspec/changes/archive/2026-08-02-four-layer-20-desktop-renderer/tasks.md#test-name-ledger`：

- sidebar slow switch + parent rerender；
- rapid round trips + unread/selection；
- ordinary conversation creation failure rollback；
- onboarding initial readiness late result；
- onboarding old full snapshot vs per-CLI result。

每条虽已有纯 controller/model 测试，但仍分别拥有 mounted React receiver、慢 fetch/HTTP 或 preload/IPC
唯一接缝，因此删除 0。

## 4. 30 批：产品契约与孤儿域删除

342 个 test-name 的唯一逐名事实源是
`openspec/changes/archive/2026-08-02-four-layer-30-github-runner/test-deletion-ledger.md`：文件逐组列出每个标题、删除类别与
local/shared 保留证据；其中 322 条属于 GitHub runner/observer/Desktop child 契约退役，20 条属于删除
零生产消费者的 `goal-ledger` 孤儿域。该账包含两条参数化展开，故不能用当前 suite 数简单反推标题数。

保留/增强接缝包括：`runtime-start.test.ts` 的 local-only 与退役 flag fail-closed、CEO local parser、
SQLite worker 动态加载、本地 JSONL/SQLite、provider adapters、conversation/trigger 与 Desktop local lifecycle。
这些删除不伪装成“纯测试等价替代”。

## 5. 40 批：纯决策新增不抵扣真实 I/O

canonical ledger 位于
`openspec/changes/archive/2026-08-02-four-layer-40-adapter-convergence/test-name-ledger.md`。测试删除 0；固定真实 I/O
集合如下，50 批完整闸门从同一日志对这些文件的 duration 求和，未打印者按 0：

- root：`sqlite-state-worker-pool.test.ts`、`sqlite-state.test.ts`、`session-jsonl-fact-log.test.ts`、
  `codex.test.ts`、`claude.test.ts`、`kimi.test.ts`、`team-management-store.test.ts`、
  `team-official-update.test.ts`、`team-seed-official-updates.test.ts`、
  `local-console-timeline-truth.test.ts`；
- desktop：`team-store.test.ts`、`team-record-store.test.ts`、`team-management-store.test.ts`、
  `team-official-update.test.ts`、`team-seed.test.ts`、`team-onboarding-orchestration.test.ts`、
  `team-file-manager.test.ts`、`team-external-change.test.ts`、`team-ipc.test.ts`、`team-repair-ipc.test.ts`。

## 6. 50 批：legacy copy debt 棘轮退役

删除：`packages/console-ui/src/i18n/production-copy-guard.test.ts :: keeps legacy production copy debt exact and bound to its removal change`。

删除判据：6 文件/16 行 debt 已为 0，`ProductionCopyDebt`、count 与 removal change 契约本身消失；保留该
测试只会变成空数组自证。接管：同文件
`keeps literal CJK interface copy in locale resources` 现在无豁免扫描全部自动发现的生产文件；
`forbids locale-driven copy branches in production components` 与 locale key/插值 parity 测试继续保留。

新增行为测试不冻结中英文原句：

- client 动态服务端错误原样保留、静态 fallback 产生稳定 failure code；
- preview invalid dimensions / exhausted budget 产生稳定 code；
- slow restore 与 slow upload 在父级 rerender、translator identity 变化后使用最新 translator；
- draft owner 改变后 Abort/stale failure 不提交；
- edit-resend 与 team-save 通过 sentinel copy 命中原分支。
