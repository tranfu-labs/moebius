# Provider / infra 簇级分支账

基线：`b4e8770`。本账只覆盖 provider / infra 第一簇，不授权提前实施 ai-team-builder、desktop team
或 `desktop/src/main.ts`。统计口径与 `src/testing/four-layer-boundaries.ts::conditionNodes` 完全一致：
`if` / `while` / `do` / 有条件的 `for` / 三元 / `case` / `&&` / `||` / `??` 各计一个 AST 条件。

“未分类”指临时移除本文件对应 `fileDebt` 后，仍被 `[IB:adapter-boundary-branch-total]` 报出的条件；
目标必须为 0。目标总分支数不是美化指标：只有业务决策下沉 domain 或装配输入显式化才允许下降；
协议 codec、命令分派和进程时序留在原 adapter，并用 exact、可 stale 的 condition permit 说明契约。

## 1. 总账

| 文件 | 当前总分支 | 当前未分类 | 目标总分支 | 目标未分类 | 去向 |
| --- | ---: | ---: | ---: | ---: | --- |
| `src/claude.ts` | 120 | 3 | 119 | 0 | 1 条进度选择进 domain；2 条 session callback 时序留 adapter |
| `src/codex.ts` | 183 | 26 | 157 | 0 | 1 条进度选择、25 条 failure→terminal 映射进 domain |
| `src/kimi.ts` | 258 | 11 | 257 | 0 | 1 条进度选择进 domain；3 条 shutdown 时序与 7 条 ACP error code 映射留 adapter |
| `src/codex-rollout.ts` | 103 | 2 | 101 | 0 | 2 条 prompt role 投影进入纯 rollout invocation projector |
| `src/ceo-scripts.ts` | 30 | 1 | 29 | 0 | composition 调用方显式传 `agentsDir`，不保留 adapter 内默认选择 |
| `src/config.ts` | 32 | 1 | 31 | 0 | composition 入口显式传 `projectRoot`，不保留 resolver 内默认选择 |
| `src/sqlite-state.ts` | 84 | 1 | 84 | 0 | `canonicalizeSqlitePath` 的祖先探测循环留 adapter，登记 transport permit |
| `src/sqlite-state-worker.ts` | 692 | 169 | 660 | 0 | 32 条业务判据进既有/新增 domain plan；137 条 DB protocol/codec/dispatch 留原 worker |
| **合计** | **1,502** | **214** | **1,438** | **0** | **64 条离开 adapter 条件图；150 条以 exact permit 留在原 adapter** |

任一文件实施后的总分支超过本表目标，或 exact permit 数不是 150，必须在继续下一簇前主动报告并重算；
不得靠新增 adapter 文件分摊计数。此簇不新增 composition root。

## 2. Provider 与旁路 adapter 去向

### 2.1 三家 provider

| 当前位置 | 数量 | 分类 | 目标 |
| --- | ---: | --- | --- |
| `claude.ts:397`、`codex.ts:425`、`kimi.ts:334` 的 `toolLifecycle.progress ?? project*Progress(...)` | 3 | provider-specific 纯进度选择 | 在既有 `src/execution-contract.ts` 增加三个具名 provider selector；不抽 generic provider 基类 |
| `codex.ts:851-895` 的 `terminalForFailure` case | 25 | failure code 到 terminal/retryability 的业务映射 | 原样迁到纯 `src/execution-failure-plan.ts`；Claude/Kimi/Codex 直接依赖该 domain，不经 `codex.ts` 转发 |
| `claude.ts:479,505` 的 `!sessionReady` | 2 | async session callback 完成前缓存 stream/result 的 transport control | 留 `claude.ts`，登记两个 exact `transport-control` permit |
| `kimi.ts:848,854,860` 的 shutdown stage | 3 | child-process signal 幂等与升级时序 | 留 `kimi.ts`，登记 exact `transport-control` permit |
| `kimi.ts:1234-1282` 的 7 个 ACP error `case` | 7 | Kimi 外部协议 error code → normalized failure DTO | 留 `kimi.ts`，逐 case 登记 exact `external-contract` permit；terminal 业务语义由 `execution-failure-plan.ts` 决定 |

三家路径先形成各自 selector/permit，不提取共享 spawner/adapter 基类。已有 `execution-contract.ts` 是三家共同
使用的纯契约；在其中加入三个具名函数是把既有 provider-specific 逻辑归位，不是新增跨 provider 抽象。

### 2.2 rollout / scripts / config / sqlite process adapter

| 当前位置 | 数量 | 分类 | 目标 |
| --- | ---: | --- | --- |
| `codex-rollout.ts:347,349` | 2 | trusted rollout message role → prompt layer 的纯投影 | 迁到 `src/local-console/codex-rollout-invocation-plan.ts`，文件读取/identity/stat 留 adapter |
| `ceo-scripts.ts:33` | 1 | adapter 路径默认值 | `LoadCeoScriptsOptions.agentsDir` 改为必填；现有 production 调用方均已持有并传入该路径 |
| `config.ts:33` | 1 | runtime composition 默认源码根 | `resolveRuntimePaths` 要求显式 `projectRoot`；模块初始化计算一次默认根后传入，测试继续传固定根 |
| `sqlite-state.ts:892` | 1 | realpath 向祖先回退的有界 IO 循环 | 留 adapter，给 `canonicalizeSqlitePath/true` 登记 exact `transport-control` permit |

上述 5 条没有被分到第二个 adapter：2 条进入纯 projector，2 条通过收紧 composition 输入消失，1 条留原
adapter 并机械登记。

## 3. `sqlite-state-worker.ts` 169 条未分类分支

### 3.1 合法留在 worker 的 137 条

| owner / 行号组 | 数量 | 机械分类 | 处理 |
| --- | ---: | --- | --- |
| `runCommand` `:175-324` 的 command `case` | 82 | worker request discriminant → DB handler 的 external contract dispatch | 留原函数，逐 case exact permit |
| `executeSessionFactWrite` `:1488-1520` 的 fact-command `case` | 33 | 单一事务写漏斗内的 command dispatch | 留原函数，逐 case exact permit |
| `rebuildSessionMessageIndex`、`readExecutionIndexIdentity`、`assertExecutionIndexIdentity` `:1285-1425` | 4 | 持久化 envelope 的 session/run identity guard | 留原函数，exact `external-contract` permit |
| row/upsert guard：`createLocalProject`、`renameLocalProject`、`repairLocalProjectFolder`、`removeLocalProject` | 4 | DB row existence / upsert codec | 留原函数，exact `external-contract` permit |
| `createLocalSession` 的 `originSessionId ?? null` / `analysisParentSessionId ?? null` | 2 | optional command field → SQL nullable column | 留原函数，exact `external-contract` permit |
| `moveEmptyLocalSession` 的 session/project row guards | 2 | DB result codec | 留原函数，exact `external-contract` permit |
| `listChildSessionSummarySources` 的 nullable DTO 投影 | 3 | LEFT JOIN / optional row → DTO codec | 留原函数，exact `external-contract` permit |
| `skipUnprocessableLocalMessages/true` | 1 | 读下一条直到 exhausted 的 DB cursor transport loop | 留原函数，exact `transport-control` permit |
| `readLocalProjectRow` 的非 record session 跳过 | 1 | DB aggregate row codec | 留原函数，exact `external-contract` permit |
| `ensureSession` 的 5 条 legacy source/default 映射 | 5 | 历史 session row 兼容映射；不授权新 GitHub 写路径 | 留原函数，exact `external-contract` permit |
| **合计** | **137** |  | 不拆 worker、不改变 `LocalConsoleStore`/schema/transaction |

### 3.2 下沉 domain 的 32 条

| domain 落点 | 数量 | 从 worker 移出的判据 |
| --- | ---: | --- |
| `src/local-console/project-command-plan.ts` | 9 | 空标题回退；项目有 pending work 且非 force；重排必须全量且无重复（2）；默认项目/默认会话隐藏身份（5） |
| `src/local-console/session-settings-plan.ts` | 6 | workspace 有消息后锁定；team 有在途工作时转 pending；pending team promotion；archive 在途阻断与相邻 selection 回退（3） |
| `src/local-console/session-creation-plan.ts` | 6 | analysis self-parent；初始 dispatch role 两级回退；child project 一致；父 team ownership/id 两级继承 |
| `src/local-console/state-query-plan.ts` | 2 | 标题搜索匹配；pending control work 推导可见 attention |
| `src/local-console/session-presentation-plan.ts` | 2 | persisted title 回退；default session id 的展示标题 |
| 新建 `src/local-console/attachment-plan.ts` | 4 | draft key 默认；clone target draft 归属；content scope 两级选择 |
| `src/local-console/startup-recovery-plan.ts` | 2 | user-direct resume 的 lane/role identity（嵌套条件同一判据） |
| `src/local-console/pending-processing-plan.ts` | 1 | running/pending/cursor 状态合成为“有 control work” |
| **合计** | **32** | 每项先建纯测试命中原决策分支，再替换 worker 内联判断 |

这些 plan 只接收已由 worker 读取/解码的窄值并返回 decision/DTO；不得接收 database、statement、path、
worker request 或具体 store。SQL 查询、事务、row codec、command dispatch 全留在 worker，因此不是把 692 条分支
拆到多个 adapter。

## 4. 测试对账与实施顺序

1. 先新增/扩充 domain tests：execution progress/failure、rollout invocation、project/session/attachment/
   recovery/pending plans；每条下沉判断必须先有能命中原分支的外部行为断言。
2. 再迁移 adapter 条件并登记 150 条 exact permits；暂不删除任何 provider、trusted JSONL、SQLite worker
   pool、transaction、migration、lock、restart 或 path identity 集成用例。
3. 逐文件临时摘除本簇 `fileDebt`，要求 `[IB:adapter-boundary-branch-total]` 真实为零；同时验证 permit stale
   反证，不能以新增 file debt 或拆 adapter 修绿。
4. 最后才评估纯测试是否与既有集成用例重复；没有逐 test-name 等价证据时，本簇测试净删除目标为 0。

## 验收语句

1. 跑 `pnpm check:boundaries` → 应退出 0，八个 provider/infra 文件的 8 条 file debt 已删除、未出现
   `adapter-boundary-branch-total` 或 stale permit，且 composition root 数不增加。
2. 跑 provider/failure/rollout 的定向纯测与现有 Claude/Codex/Kimi、trusted JSONL 测试 → 应退出 0，三家
   progress、failure terminal、rollout prompt layer 的外部结果与基线一致。
3. 跑 config/CEO scripts 与 SQLite state/worker pool/local-console 定向测试 → 应退出 0，路径解析、脚本加载、
   worker command、事务、schema、重启和历史数据读取行为与基线一致。
4. 在环境可用的真实 Electron 中分别执行 Codex/Claude/Kimi 新调用与 resume → 应看到同一 provider 的过程、
   terminal、session link 和重启后记录一致；不可用 provider 按 proposal 逐家标记“未验证”，不得互相抵扣。

## 5. 实施实绩

| 文件 | 实际总分支 | 实际 exact permit | 结论 |
| --- | ---: | ---: | --- |
| `src/claude.ts` | 119 | 2 | 两条 session callback 时序留 adapter |
| `src/codex.ts` | 157 | 0 | progress 与 failure mapping 已下沉 |
| `src/kimi.ts` | 257 | 10 | shutdown 3 + ACP error dispatch 7 留 adapter |
| `src/codex-rollout.ts` | 101 | 0 | prompt role 投影已下沉 |
| `src/ceo-scripts.ts` | 29 | 0 | `agentsDir` 改为显式输入 |
| `src/config.ts` | 31 | 0 | `projectRoot` 改为显式 composition 输入 |
| `src/sqlite-state.ts` | 84 | 1 | canonical path 祖先探测循环留 adapter |
| `src/sqlite-state-worker.ts` | 650 | 137 | 32 条业务判据下沉；协议分派/codec 留原 worker |
| **合计** | **1,428** | **150** | **8 条 file debt 清零，composition root 不增加** |

worker 的实际总分支比目标 660 少 10，不是额外删除业务分支：基线“未分类 169”取自最终 violation
去重结果，而总分支 692 取自原始 `conditionNodes`；嵌套 `if (a && b)` 会生成两个 AST condition，
但同一行同一 fingerprint 在 violation 输出中只保留一个。业务判据整体下沉时，这 10 个重复 AST 节点随之
一起消失。exact permit 仍为批准账面的 150，且 150 个 `ruleId:file:owner:fingerprint` key 全部唯一。

permit stale 反证已执行：临时把 `src/claude.ts` 的 `streamSessionPending` 条件改成
`streamSessionPending === true` 后，`pnpm check:boundaries` 退出 1，同时报告旧 permit stale 与新条件
未登记；恢复源码后门禁重新退出 0。测试净删除为 0。
