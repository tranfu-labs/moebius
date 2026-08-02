# Desktop team 簇级分支账

基线：`cfade85`。本账覆盖 registry 中绑定 `four-layer-40-adapter-convergence` 的全部剩余 debt。
`REVIEW.md` 的范围摘要写成“12 个 team-* + main”，但 registry 实际是 **13 个 team-* file debt +
`desktop/src/main.ts`，另有 4 条 dependency debt，共 18 条**；本账以 exact registry 为准并保留这项差异。

计数严格分两栏：

- **原始 AST 条件**：与 `four-layer-boundaries.ts::conditionNodes` 同口径，`if` / `while` / `do` /
  有条件的 `for` / ternary / `case` / `&&` / `||` / `??` 各计一个节点，嵌套表达式重复计数。
- **去重违规**：临时摘除本簇 14 条 file debt 与 4 条 dependency debt 后，由
  `analyzeFourLayerArchitecture` 最终 `unique()` 输出；不能反推原始 AST 数。

严格分类口径沿用评审裁决：`wiring` 只表示依赖装配；外部 request/document 的格式解释记为 codec，
持久化版本迁移、所有权、可用性和允许结果记为 business；进程、窗口、事务与外部调用先后记为 timing /
transport。表内把 codec 并入 business、transport 并入 timing 复算，避免把它们塞进 wiring 兜底。

## 1. 方案来源与取舍

这是结构退化型（C）问题。成功判据先固定为：18 条 exact debt 清零；业务条件进入纯 domain；真实
filesystem/Electron/IPC/原子事务接缝仍由 adapter 测试覆盖；`main.ts` <=260 逻辑行；permit 与
composition root 都净增 0；产品行为和公开 preload contract 不变。

最小来源扫描只采用仓内已验证证据：10 批 `runtime.ts` 的 root→application→domain/adapter 切法、20 批
renderer bundle/窄入参切法、簇 1 exact permit 棘轮、簇 2 `team-writer.ts`“层级改登记与能力抽离同提交”
条款，以及当前门禁与 team I/O 测试。

| 候选 | 结论 | 依据 |
| --- | --- | --- |
| 维持 18 条 debt | 否决 | `main.ts` 586 逻辑行；69 条 adapter 业务条件与 4 条非法依赖继续冻结 |
| 给 69 条条件新增 exact permit | 否决 | 这些条件决定所有权、可用性、迁移和回退，不是不可约外部协议；且收口要求 permit 净增 0 |
| 把大 adapter 拆成多个小 adapter | 否决 | 只分摊分支，决策仍与 I/O 共居，属于指标修绿 |
| **伪 adapter 还原 application；具名纯 plan/codec 下沉；transport/store 留 adapter** | **采用** | 与前三批已验证切法一致；每条违规有可核查去向，不新增层或框架 |

最小验证已完成：机械复算 14 个 file debt 文件共 **4,711 逻辑行 / 626 原始 AST 条件**；临时摘 debt
得到 **98 条去重违规**（1 条 root shape、24 条 onboarding shape、69 条 adapter branch、4 条 dependency）；
逐条对照现有测试与调用者。实施时仍坚持“纯测试先于迁移”的 commit 顺序。

## 2. 总账

目标原文件条件只描述旧边界的收薄；迁入新 domain/application/adapter 的条件另列归属，不宣称全系统
净减少 206 条决策。除 `main.ts` 与改登记的 application 外，不用行数做 adapter 成败指标。

| 文件 | 当前层 | 逻辑行 | 原始 AST | 去重违规 | 目标层/原文件条件 | 目标违规 | 主要去向 |
| --- | --- | ---: | ---: | ---: | --- | ---: | --- |
| `main.ts` | application root | 586 | 50 | shape 1 | root <=260 行 / <=8 wiring | 0 | IPC registrar、window/process lifecycle runtime；root 只装配 |
| `team-conversation-preference.ts` | adapter | 108 | 22 | branch 4 | application <=140 行 / <=6 | 0 | service + preference file store + preference plan |
| `team-external-change.ts` | adapter | 62 | 12 | branch 3 | adapter / <=9 | 0 | request codec、ownership/change plan；文件读取留 adapter |
| `team-file-manager.ts` | adapter | 67 | 15 | branch 2 | adapter / <=13 | 0 | request codec、location plan；stat/access/shell 留 adapter |
| `team-ipc.ts` | adapter | 679 | 88 | branch 17 + dependency 1 | application service <=300 行 / <=11 | 0 | wire codec/projection、catalog/mutation/profile/update plans 与注入 ports |
| `team-management-store.ts` | adapter | 268 | 31 | branch 6 | adapter / <=25 | 0 | persisted document codec；fs/atomic write 留 adapter |
| `team-official-management.ts` | adapter | 329 | 49 | branch 4 | adapter / <=45 | 0 | official manifest/update domain plan；collect/hash 留 adapter |
| `team-official-update.ts` | adapter | 629 | 89 | branch 5 | adapter / <=84 | 0 | update-input/verification plan；原子 journal/rollback 留 adapter |
| `team-onboarding-orchestration.ts` | application | 232 | 29 | shape 24 + dependency 1 | domain / <=22 | 0 | 纯 JSON/legacy codec 留原文件；fs/atomic write 进 store adapter |
| `team-record-store.ts` | adapter | 447 | 73 | branch 3 + dependency 1 | adapter / <=70 | 0 | record/location plan；records fs/atomic write 留 adapter |
| `team-repair-ipc.ts` | adapter | 52 | 9 | branch 1 | contract/application 合并 / 0 | 0 | request codec 进 repair contract；用例并入 team service |
| `team-runtime-binding.ts` | adapter | 147 | 21 | branch 5 | application <=180 行 / <=8 | 0 | binding service + file store + binding plan |
| `team-seed.ts` | adapter | 391 | 54 | branch 3 | adapter / <=51 | 0 | seed conflict/copy plan；目录复制、hash、recovery 留 adapter |
| `team-store.ts` | adapter | 714 | 84 | branch 16 + dependency 1 | adapter / <=68 | 0 | team location/mutation plan；fs/path safety/atomic write 留 adapter |
| **合计** |  | **4,711** | **626** | **98** | **旧文件 <=420 条** | **0** | 条件下降只表示旧边界收薄 |

本簇完成后 40 批 debt **18→0**；condition permit 必须保持 **193**，composition root 必须保持 **9**。
若实施发现必须新增 permit/root，或任一 application 超过 300 行/复杂度 12，立即停下重算，不以新增 debt
或把条件拆到第二个 adapter 修绿。

## 3. `main.ts` 到窄 root 的分解账

当前 586 行按 AST 顶层声明完整覆盖，无未认领区域：

| 块 | 当前逻辑行 | 目标 | 去向 |
| --- | ---: | ---: | --- |
| imports | 99 | <=40 | team/shell/window/lifecycle 改为窄 registrar/service port |
| process/data-root/status setup | 69 | <=34 | `desktop-process-bootstrap` adapter 返回窄启动上下文；root 保留具体对象图 |
| `boot` | 70 | <=50 | seed/status 决策进纯 startup plan，副作用时序进 application runtime |
| window/language IPC | 47 | <=8 | window manager 与 language registrar adapter |
| local console startup | 48 | <=48 | 保留 root：它创建 concrete store/server，是合法 composition 职责 |
| status/team/project/settings IPC | 153 | <=16 | team 与 shell IPC registrar adapter；通过注入 port 调 application，不反向 import |
| shutdown | 58 | <=32 | shutdown application runtime + 纯 lifecycle plan；root 注入 app/window/installer ports |
| status/seed/error helpers | 42 | <=32 | window adapter、startup plan、error codec |
| **合计** | **586** | **<=260** | 留 40 行门禁余量，不靠单行化达标 |

### 3.1 当前条件严格复算

| 位置组 | AST 条件 | wiring | timing/transport | business/codec | 处置 |
| --- | ---: | ---: | ---: | ---: | --- |
| process/data-root/single-instance | 8 | 4 | 4 | 0 | bootstrap adapter + lifecycle runtime |
| `boot` | 7 | 3 | 2 | 2 | app/platform 装配保留；seed result 进 startup plan |
| window close | 3 | 0 | 3 | 0 | window/lifecycle runtime |
| local console session guard | 1 | 0 | 0 | 1 | session lookup application port |
| IPC/dialog/request | 17 | 3 | 10 | 4 | registrar adapter + request codec；root 不内联 handler |
| shutdown | 10 | 0 | 10 | 0 | shutdown runtime + lifecycle plan |
| status/seed/error helpers | 4 | 1 | 2 | 1 | window adapter、startup/error plan |
| **复算** | **50** | **11** | **31** | **8** | 三类合计等于原始 AST 总数 |

目标 root 为 **<=8 个 wiring、timing 0、business 0**。`desktop-process-bootstrap`、window/IPC registrar
只接收窄 Electron/transport 能力，不创建 application service 或全局对象图；shutdown/startup application
只接收 ports，不 import Electron/fs。若抽出的模块必须同时创建 concrete adapter 与 application graph，说明它
实质是新 root，方案失败，不能靠不登记 root 绕过审计。

## 4. 69 条 adapter branch 去向

| 当前 owner | 未分类 | 严格分类 | 目标纯模块 / 接缝 |
| --- | ---: | --- | --- |
| conversation preference | 4 | session 存在性、team 可用于会话、ownership codec | `team-conversation-preference-plan.ts` + 现有 contract parser；fs 原子写单列 adapter |
| external change | 3 | system 忽略、known markdown 相等、ownership codec | `team-external-change-plan.ts`；文件读取和 markdown decode 留 adapter |
| file manager | 2 | ownership→location、ownership codec | `team-location-plan.ts` + file-manager contract parser；stat/access/shell 留 adapter |
| team IPC/service | 17 | catalog availability/projection 8；ownership/mutation routing 5；member/profile fallback 2；request codec 2 | `team-catalog-plan.ts`、`team-mutation-plan.ts`、现有 IPC contract codec；application 只执行 ports |
| management store | 6 | schema/version/binding document interpretation | `team-management-document-codec.ts`；read/write/rename 留 adapter |
| official management | 4 | manifest member codec 2、manifest-content filter 1、member collision 1 | `team-official-plan.ts`；目录遍历/hash 留 adapter |
| official update | 5 | plan-id default、record bootstrap、staged fingerprint、binding/member fallback | `team-official-update-plan.ts`；journal/receipt/rollback 留 adapter |
| record store | 3 | user-only record 2、managed/external location 1 | `team-record-plan.ts`；records file/atomic write 留 adapter |
| repair IPC | 1 | user-only repair request | `team-repair-contract.ts` codec；application method 并入 team service |
| runtime binding | 5 | ownership route、profile fallback、recommendation/default/error projection | `team-runtime-binding-plan.ts`；共享 Agent 文件读取进窄 adapter port |
| seed | 3 | conflict preservation、copy result、marker exclusion | `team-seed-plan.ts`；copy/hash/recovery 留 adapter |
| team store | 16 | location/ownership 10、id/path-segment policy 3、member/primary fallback 3 | `team-location-plan.ts` + `team-mutation-plan.ts`；realpath/fs/atomic write 留 adapter |
| **合计** | **69** | 业务与数据解释离开 adapter 条件图 | **不新增 permit，不新增 adapter 来分摊条件** |

### 4.1 伪 adapter 层级归位

- `team-ipc.ts` 不是真 IPC transport：它目前暴露 20+ 用例函数并直接编排 stores。改为单一
  `AgentTeamService` application runtime（或等价单 runtime export），具体 stores 通过窄 ports 注入；raw request /
  response projection 留 `team-ipc-contract.ts` 与新的 Electron registrar adapter。改登记与 concrete fs import
  清除必须同一提交完成。
- `team-conversation-preference.ts` 的“session/team 验证→写 preference”是 application；文件读写进入
  preference-store adapter，列表/会话查询通过 ports 注入。
- `team-runtime-binding.ts` 的“session binding→snapshot/profile/health”是 application；共享文件读取与 team stores
  通过 ports 注入。
- `team-repair-ipc.ts` 没有 Electron transport，本质是 request codec + repair use case：codec 回归 contract，
  relocate/remove 进入 `AgentTeamService`，旧 runtime 文件删除或只保留 type-only contract。

其余文件仍是 adapter：official update/seed 的 journal、copy、rollback、recovery 是外部原子协议；store/record/
management 是持久化；file-manager/external-change 是系统/文件边界。它们只把业务判据交给 domain，不因名字
相似先抽公共 repository/base class。

## 5. Onboarding domain/store 拆分与 4 条 dependency debt

当前 `team-onboarding-orchestration.ts` 29 条条件严格复算为 wiring 0 + timing/transport 7 +
business/codec 22。它同时含纯 JSON/legacy migration 和 fs 原子替换，导致 9 runtime exports、复杂度 30、
application 直达 `node:fs/promises`，又被三个 adapter 反向 import。

处置：

- 原文件改登记 domain，只保留 type、parse/serialize、legacy extraction/migration 与错误契约，<=22 原始条件；
- 新 `team-onboarding-orchestration-store.ts` 登记 adapter，只做 read/write/ENOENT/temporary rename，<=7 个
  codec/transport 条件；
- `team-ipc.ts`、`team-record-store.ts`、`team-store.ts` 分别改依赖 domain codec 或 store adapter，不再反向进入
  application；
- 层级改登记、fs/path/randomUUID 能力抽离与 4 条 dependency debt 摘除必须在同一提交完成。

四条 dependency debt 的目标逐条为：

1. `team-ipc.ts -> team-onboarding-orchestration.ts`：adapter/application flow 只消费 domain codec/store port；
2. `team-record-store.ts -> team-onboarding-orchestration.ts`：adapter 消费 domain legacy codec，合法；
3. `team-store.ts -> team-onboarding-orchestration.ts`：adapter 消费 domain codec/store adapter，合法；
4. `team-onboarding-orchestration.ts -> node:fs/promises`：纯 domain 文件不再含 fs runtime import。

## 6. 测试对账与实施顺序

1. **先补纯行为测试**，命中迁移前同一决策分支：
   - catalog/preference/location/mutation plans：system/user、usable/needs-repair/deleted、primary/member fallback；
   - management/onboarding/record codecs：schema version、legacy migration、重复记录、非法 ownership/path；
   - official/update/seed plans：member add/remove/rename/collision、protective copy、stale fingerprint、seed conflict；
   - runtime/lifecycle plans：profile recommendation/override、missing team、窗口关闭、installer shutdown、seed result。
2. 再按 **onboarding domain/store → team stores/plans → AgentTeamService 与 IPC registrar → runtime/preference →
   `main.ts`** 的顺序迁移。每段临时摘对应 debt，要求 checker 真实为零；不得先改 registry 修绿。
3. 以下真实 I/O 测试全部保留：`team-store`、`team-record-store`、`team-management-store`、
   `team-official-management`、`team-official-update`、`team-seed`、`team-onboarding-orchestration`、
   `team-file-manager`、`team-external-change`、`team-runtime-binding`、`team-ipc`、`team-repair-ipc`、
   `local-console-timeline-truth`。它们证明 atomic write/rollback、path safety、Electron shell/IPC DTO、重启读取和
   local-console binding，纯测试不能抵扣。
4. 本簇测试净删除目标为 0。若旧 parser 参数组合被纯测试等价替代，必须在 test-name ledger 逐条写旧名、
   新名、同一分支证据后再剪；否则保留。
5. 每段运行相关定向测试、`pnpm check:boundaries` 与 typecheck；收口运行
   `pnpm run test --scope cfade85`、desktop build。完整 `pnpm test` 只在 40 批复核通过后的合并点运行一次。

## 7. 验收语句

1. 从桌面 Agent Teams 页面完成团队列表、创建、成员编辑、主 Agent 设置、执行配置、复制、移除、修复和
   官方更新：每个动作的页面结果、失败反馈与重启后事实与基线一致；注册/更新失败不留下半成品目录或记录。
2. 从成员页面触发“在 Finder 中显示”和外部 AGENT.md 变更检测：系统打开正确 team/member 目录；取消、路径
   不可读和无变化时返回既有可恢复信号，不暴露绝对路径或底层异常。
3. 新建会话成功后重启桌面：上次使用团队、session 绑定、成员顺序和 effective profile 保持；system/user、
   needs-repair/deleted 的可用性与列表/会话入口一致。
4. 冷启动桌面并退出：单实例、seed、local console URL、窗口加载和 installer 退出协调依次可观察；取消退出
   回到原窗口，确认退出后 server/SQLite worker 关闭，无后台残留。
5. RA-15 对 Codex/Claude/Kimi 逐家执行新调用和 resume；不可用环境逐家标“待真机验收”，不以另一家抵扣。
6. 跑 `pnpm check:boundaries`：40 批 debt 18→0、permit 保持 193、root 保持 9；`main.ts` <=260 行且审计
   wiring<=8/timing0/business0，新增 application/domain/adapter 各有唯一层归属。

本簇不承诺速度收益，记 0。收益以 18 条 debt 清零、三类伪 adapter 归位、root 586→<=260、业务条件不再
与 I/O 共居、且无新增 permit/root 为准。
