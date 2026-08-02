# 设计：four-layer-30-github-runner

## 1. 目标与不变量

本 change 从“重构 GitHub runner”改为“退役 GitHub runner 与其 observer”。完成后仓库只有 local
console 一条产品运行链；终端与 Desktop 共用同一 local 行为，不保留禁用但仍可复活的 GitHub 入口。

必须保持：

- `pnpm start` 冷启动 local console，且不要求 GitHub auth/repository 配置。
- Desktop 主窗口、local server、会话/团队/provider、恢复、附件与现有状态页诊断继续工作。
- `LocalConsoleStore`、local SQLite/JSONL、provider CLI 和 Release 更新检查语义不变。
- 不主动删除或改写数据根中已有 `.state` 历史 GitHub 数据。
- `src/sqlite-state-worker.ts` 与 Desktop worker bundle 保留；只允许删除无剩余调用者的 GitHub command
  分支，不能删除 worker 本体或 local schema/commands。
- `goal-ledger.ts` 作为独立纯业务域暂时保留；只删除 GitHub runtime 的 ledger state adapter。

## 2. 方案来源与选择

本任务按 solution-sourcing 属于 **C 退化/退役型**。来源扫描采用仓库内生产 import 图、Desktop
动态进程入口和 `new Worker`/`fork`/`spawn` 路径探针，而不是按文件名猜测。

| 候选 | 收益 | 代价 / 结论 |
| --- | --- | --- |
| 保持原 30 批重构 | 四层指标继续按原账推进 | 继续维护已退出产品能力；拒绝 |
| 只禁用 `--github-mode`，保留实现与 observer | diff 小、回滚容易 | 留下约 14k+ 行死代码、测试和 Desktop 后台概念；拒绝 |
| 删除 runner，保留 observer/state | 保留历史诊断页 | observer 没有活跃写者且迫使 GitHub state 链继续存在；拒绝 |
| **删除 runner + observer，提取本地共享能力** | 产品与代码边界一致，直接消除 debt/重型测试 | 删除面大，必须做动态入口与真机验证；采用 |

最小可行性验证已完成：local console 对 GitHub adapter 无生产 import；Desktop main 独立启动 local
server；动态扫描只发现 SQLite worker 必须保留，以及 Desktop runner child 是待删除的 GitHub fork。

## 3. 删除边界

### 3.1 整体删除

按依赖闭包删除以下能力簇及其只服务该簇的测试：

1. GitHub runner 主链：`src/runner/**`、scanner、dispatcher、intake、GitHub client、reaction/media/
   artifact、driver pool、retry、interrupt 与 state persister。
2. GitHub runtime state：role thread、agent context、GitHub intake、goal-ledger state adapters 和只服务它们
   的 config/session source helper。历史数据库表不做破坏性 migration。
3. GitHub prescripts：issue worktree、CEO ledger context 和其 registry/types；local workspace 使用
   `src/local-console/workspace-*`，不依赖这组实现。
4. Observer：`src/observer/**`、`pnpm observer`、Desktop observer server/window/action/status。
5. Desktop GitHub child：runner child、launch、supervisor、build entry、日志/重启/状态投影。

### 3.2 拆分后保留

| 当前模块 | 处理 | 保留理由 |
| --- | --- | --- |
| `src/runner.ts` | 改为 ≤80 逻辑行的 local CLI shell | 保持 `pnpm start` 稳定入口、signal close 与 unknown-arg fail closed |
| `src/ceo-orchestration.ts` | local parser/types 提取后删除原文件 | local child-session 仍解析结构化 CEO 输出，但不需要 GitHub issue 副作用 |
| `src/config.ts` / `local-config.ts` | 删除 repository/GitHub 常量，保留 data root、provider 与 local 参数 | local、desktop 和 provider 仍依赖 |
| `src/sqlite-state.ts` / worker | 保留动态 worker 和 local commands；按调用图删除无消费者的 GitHub commands | worker 是 local store 的真实运行入口 |
| `conversation.ts`、`triggers/**`、`format-ceo.ts`、`ceo-scripts.ts`、`agent-manifest.ts` | 保留 | local route、prompt、handoff 与团队执行仍使用 |
| `goal-ledger.ts` | 保留 | 独立纯业务域，不以当前 adapter 消费者数量决定产品去留 |
| updater/Release 外链 | 保留 | GitHub 作为发行/外链平台，不属于 issue runner |

### 3.3 动态入口防误删

实现删除前后都运行精确扫描：

- `new Worker`：必须仍解析并打包 `sqlite-state-worker.js`。
- `utilityProcess.fork`：删除 `runner-child.js` 后不得再有路径引用或 build output 声明。
- `spawn`：删除 gh runner 调用，保留 provider、git workspace、CLI installer 等 local 子进程。
- string URL/path：build、package scripts、acceptance 与 docs 不得引用已删除生产入口。

## 4. Desktop 与可见行为

Desktop status snapshot 删除 `runner` 与 `observer`，保留 app version、data root、local console、doctor、
shell path、seed 和 update。状态页移除 runner/observer 行与“打开观察页”动作；主操作台不再接收或显示
`runnerStatus`。这不是隐藏错误状态，而是删除已不存在的后台能力。

实现后执行真实运行断言：

- **RA-11R（终端 local-only）**：从终端运行 `pnpm start`，观察 local server 可访问并能创建/读取一个
  临时会话；进程树无 gh/runner child，退出后端口释放。运行 `pnpm start -- --github-mode` 必须在启动
  server 前以未知参数失败。
- **RA-12R（Desktop local-only）**：从 `pnpm desktop` 打开真实主窗口，页面能选择已有项目/会话并
  完成一次 local 状态读取；辅助状态页只显示 local/环境/版本事实，没有 runner、observer 或打开观察页
  动作；进程树无 `runner-child.js`，关闭应用后 local server 正常退出。
- **RA-30D（历史数据非破坏）**：以包含代表性旧 GitHub state 文件/表的临时数据根启动终端和 Desktop，
  local 页面可用，旧文件/表内容哈希不变且没有 GitHub state 新写入。

旧 RA-11/RA-12 sandbox issue 验收取消，不再以“待真机验收”挂账。三 provider 真机覆盖仍属于 40 批
自己的 RA-15，不因 GitHub runner 退役而取消。

## 5. 测试剪枝与对账

本批删除的是产品契约，不做“集成测试降级为纯测试”的伪对账。ledger 逐 test file/test name 归类：

| 类别 | 处理 | 判据 |
| --- | --- | --- |
| GitHub scanner/intake/dispatch/publication/state/observer | 删除 | 被测运行形态与外部契约已删除 |
| Desktop runner launch/supervisor/observer status | 删除 | 被测后台进程与 UI 字段已删除 |
| local startup | 改为 local-only 行为测试 | `pnpm start` 仍是公开入口，unknown args 仍需 fail closed |
| CEO orchestration | 保留 parser/local child-session 分支测试，删除 GitHub issue side-effect 分支 | 以生产调用者与输出契约区分，不按文件整删 |
| SQLite worker | 保留全部 local schema/worker pool/事实日志测试；删除仅覆盖 GitHub state commands 的用例 | 动态 worker 是 local 接缝，不得因 runner 删除而失去覆盖 |
| shared conversation/trigger/format/provider/goal-ledger | 保留 | local runtime 或独立业务域仍使用 |

每条删除必须在 `tasks.md` ledger 写明原 test name、删除的产品契约和剩余接缝；不得把旧断言改写成
新文件路径的镜像测试。源码路径快照若只守已删除架构，按“契约删除”单列，不混入行为用例。

## 6. 分段实施与自洽停止点

| 段 | 范围 | 预估生产改动 | 合并/回滚后的自洽状态 |
| --- | --- | ---: | --- |
| A | local parser 提取、local CLI shell 与启动测试 | 1.2k–1.6k | `pnpm start` 已不依赖 GitHub branch，但旧 GitHub 模块尚可回滚 |
| B | 删除 runner/GitHub/state/prescript 闭包并清 config/SQLite commands | 净删 9k–12k | 终端只剩 local，Desktop 旧 child 暂时需在同段末禁用，编译全绿 |
| C | 删除 observer 与 Desktop child/supervisor/status/preload/UI/build 装配 | 净删 4k–5k | Desktop 只装配 local console 与诊断，无悬空进程/状态字段 |
| D | registry、测试 ledger、PRD/spec/docs/AGENTS/module-map 收口 | 0.8k–1.5k | 命令、事实源、边界门禁与生产代码一致，可独立归档 |

每段一个或多个可回滚 commit，但段末必须 typecheck、scope 与 boundaries 全绿；不得提交“下一段才能
编译”的半成品。

## 7. 指标与四层系列影响

- 30 批预计净删除生产代码 14k–17k 行；不是把代码搬到免检区。
- 30 批名下 20 条 debt 清零。40 批 debt 在删除后机械重导出；`sqlite-state-worker.ts` debt 保留。
- 删除同时移除纯规则与 IO/adapters，旧“纯逻辑/业务规则累计比例”分母失效。30 批以剩余生产代码
  重新建立同口径基线，目标不低于 60%；不拿删除后的比例与 Batch20 直接宣称提升。
- 完整闸门以 Batch20 的 Node 24 样本 128s/133s 为前值，预计 95–120s。只把 ledger 中确实删除的
  test-name 三次中位数计为可归因收益；单次全量差值只记录，不认领。
- 40 批预估范围缩为 desktop/provider/local storage 剩余 adapters；GitHub/state/observer 不再重构。
- 50 批仍做零 debt、门禁/事实源/测试总账与真实 local smoke；不再引用 GitHub RA。

## 8. 风险与回滚

- **误删动态 worker**：以 `new Worker` 路径探针、desktop build 与真实 local 写读为三重 oracle。
- **把共享能力当 GitHub-only**：删除前以 production consumers 清单核对；local parser/provider/
  conversation/trigger 保留并有现有测试。
- **历史数据被清理**：禁止 destructive migration；用 fixture 数据根的文件哈希/表行数前后对账。
- **状态页留下假死字段**：contract、preload、renderer、console-ui props 与测试同段删除，禁止仅隐藏 DOM。
- **大删改掩盖测试损失**：ledger 按产品契约删除，local/shared 接缝必须有保留项；完整闸门红后必须
  修复并重跑全量。
- **回滚**：按 A/B/C 段逆序回滚；不执行数据库迁移，因此回滚不需要数据恢复。

## 9. 未归档 change 冲突清单

下列目录在当前工作区仍包含 GitHub runner 前提，不能在本 change 归档后原样继续：

| 类型 | 当前 change | 处置原则 |
| --- | --- | --- |
| GitHub 协议/runner 专属 | `acceptance-governance-rules`、`ceo-default-plan-chain`、`roundtable-topology-t6`、`visual-requirement-flow` | GitHub spec/protocol delta 作废；若另有 goal-ledger/persona 独立内容，拆出后保留 |
| local 为主但声明 GitHub 零漂移/对等 | `conversation-console`、`local-console-t2-e2e-spike`、`local-console-t3-sqlite-persistence`、`local-console-t45-handoff-loop`、`local-console-t5-full-parity` | 保留已形成的 local 事实；删除或改写只用于旧 GitHub runner 的验收前提，不回滚 local 实现 |
| 仅文字命中、无 runner 产品依赖 | `provider-native-process-traces` 等 | 不因关键词命中改动；按真实 spec-delta/production consumer 复核 |

本表是冲突审计，不授权批量删除 change 目录。归档前由主理人逐项确认其真实状态（待实施、已实现未
归档或历史残留），并选择归档为历史、拆分保留或显式作废；任何处置都不得把 local 已验证事实删掉。
