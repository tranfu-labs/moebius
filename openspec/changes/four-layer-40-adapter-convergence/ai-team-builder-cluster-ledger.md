# AI team builder 簇级分支账

基线：`414fa1f`。本账覆盖五个主体文件，并把与它们直接绑定的两个跨层接缝
`ai-team-builder-ipc.ts -> index.ts`、`team-writer.ts -> team-onboarding-orchestration.ts` 一并收口；不授权
提前处理 desktop team-* 或 `desktop/src/main.ts`。

计数严格分两栏：

- **原始 AST 条件**：与 `four-layer-boundaries.ts::conditionNodes` 同口径，`if` / `while` / `do` /
  有条件的 `for` / ternary / `case` / `&&` / `||` / `??` 各计一个节点；嵌套表达式会计多次。
- **去重违规**：临时摘除对应 file/dependency debt 后，由 `analyzeFourLayerArchitecture` 最终 `unique()`
  输出的违规数；同一源码位置和指纹可能只保留一条，不能拿来反推原始 AST 数。

目标不是把条件藏进更多文件：原文件目标只描述边界收薄，新增 application/adapter/domain 文件另列归属；
不声明全仓条件净减少，也不以新增 exact permit 代替业务规则下沉。

## 1. 方案来源与取舍

这是结构退化型（C）问题，优先证据来自现有实现、测试、门禁和前三批已验证切法。

| 候选 | 结论 | 依据 |
| --- | --- | --- |
| 维持现状，只保留 debt | 否决 | `index.ts` 454 逻辑行超过 root 上限 300；21 条 adapter 条件仍决定 session precedence、团队一致性和可用性 |
| 把 spawner/writer 各拆成多个 adapter | 否决 | 只会把分支摊薄，I/O 与业务判据仍共居，属于指标修绿 |
| 先抽 Claude/Codex/Kimi 公共基类 | 否决 | 三家 resume preflight、manifest、workspace 与协议结果不同；先抽象会迫使 provider-specific 分支进入基类 |
| **保留 provider adapter，提纯 session plan；把 writer 还原为 application；root 只装配窄 use case** | **采用** | 与 10/20 批的 root→application→domain/adapter 切法一致；每条条件有可核查去向，且不改变公开 API/产品语义 |

## 2. 总账

`wc -l` 的五文件物理行合计 1,335；checker 逻辑行合计 1,252。

| 文件 | 逻辑行 | 原始 AST 条件 | 去重未分类/shape | 目标逻辑行 | 目标原文件条件 | 目标违规 | 去向 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| `index.ts` | 454 | 55 | shape 1 | <=180 | 5 | 0 | root 只留默认 adapter/use-case 装配和公开 facade；action/turn/store/migration 分出 |
| `team-writer.ts` | 232 | 23 | branch 9 | <=180 | <=8 | 0 | 从 adapter 改登记为 application；业务比较进纯 plan，fs/路径进 store adapter |
| `claude-spawner.ts` | 129 | 14 | branch 4 | <=129 | 10 | 0 | 4 条 session candidate precedence 进 provider-named domain selector |
| `codex-spawner.ts` | 263 | 21 | branch 5 | <=263 | 16 | 0 | 5 条 failed/success session candidate precedence 进 provider-named domain selector |
| `kimi-spawner.ts` | 174 | 13 | branch 3 | <=174 | 10 | 0 | 3 条 session candidate precedence 进 provider-named domain selector |
| **原五文件合计** | **1,252** | **126** | **22** | **<=926** | **<=49** | **0** | 下降值只表示原边界收薄，不宣称全系统少了 77 个决策 |

另有 2 条去重 dependency violation：

1. `ai-team-builder-ipc.ts -> index.ts`：IPC 改依赖纯 service port / error contract，由 composition root 注入
   实现，不再 import 具体 application class。
2. `team-writer.ts -> team-onboarding-orchestration.ts`：writer 改为 application 后不再是 adapter 反向进入
   application；同时 fs/path 能力由新 store port 注入，避免把 writer 仅靠改登记修绿。

本簇完成后 40 批 debt 目标 **25 -> 18**：五条 file debt 加上述两条 dependency debt 共清 7 条；
不新增 debt，不新增 composition root，condition permit 净增目标为 **0**。

## 3. Spawner 分支去向

三个 spawner 保留各自 class、argv/profile、cwd、manifest、resume preflight 和 provider wire mapping；不抽公共
adapter/base class。只共用一个纯 `driver-session-plan.ts`，其中保留 provider-named 函数，避免用可配置优先级
掩盖三家差异。

| 文件 / 当前位置 | 原始节点 | 去重违规 | 分类 | 目标 |
| --- | ---: | ---: | --- | --- |
| Claude `result.threadId ?? observed ?? requested` 两处 | 4 | 4 | provider 结果候选到 canonical session 的纯优先级 | `selectClaudeAiTeamBuilderSession(...)` |
| Codex failed observed、failed response、success response 三处 | 5 | 5 | failed/success 各自的纯 session 归属计划 | `selectCodexAiTeamBuilderFailedSession(...)` / `selectCodexAiTeamBuilderSession(...)` |
| Kimi failed observed、success response 两处 | 3 | 3 | ACP 结果候选到 canonical session 的纯优先级 | `selectKimiAiTeamBuilderFailedSession(...)` / `selectKimiAiTeamBuilderSession(...)` |

其余 36 个原始条件留原 adapter：profile discriminant、full/resume mode、可选 AbortSignal、外部 run result、
resume preflight、session identity codec 和 process error formatting。它们已被现有 checker 机械识别为 codec /
transport control，不需要 permit；若实施中出现新增未分类条件，必须主动重算，不能临时加 permit。

## 4. `team-writer.ts` 从伪 adapter 还原为 application

当前 `AiTeamWriter.create()` 同时决定 proposal 是否可提交、staging/rename/register/rollback 顺序、落盘内容
与最终 snapshot 是否可用。它不是窄 data adapter；继续按 adapter 修补会迫使业务判断持 permit，或把同一
流程拆成多个 adapter。因此保留公开 `AiTeamWriter` API，但改登记为 application use case。

### 4.1 23 个原始条件的去向

| 当前 owner / 条件组 | 原始节点 | 去重未分类 | 去向 |
| --- | ---: | ---: | --- |
| constructor 的 `register` / `rollbackRecord` 默认值 | 2 | 2 | 默认 concrete adapter 改由 `index.ts` root 显式装配；writer 只收窄 ports |
| `create` 的 proposal codec、rename cleanup、error wrapping | 4 | 0 | proposal 判定委托现有 validator/domain；rename/rollback 顺序留 application |
| staged definition name/description/primary/member order | 4 | 3 | 新 `team-write-plan.ts` 校验已解码 definition 与 proposal |
| onboarding relay beats | 1 | 0 | 同一 plan 校验已解码 orchestration，不把 fs/path 传进 domain |
| expected member、identity/markdown 对账 | 4 | 3 | store 只读取文本；domain plan 按 slug 生成 member decision/snapshot facts |
| proposal final validation、readiness/member count | 4 | 1 | domain plan 返回 usable / reject decision，application 只执行 |
| same-device check | 1 | 1 | store 返回两个 `dev` 窄值，domain `decide*` 给出是否允许原子 rename |
| ID fallback / `createId` 默认值 | 3 | 0 | team id 纯计划进 domain；随机源仍为注入 port |
| **合计** | **23** | **9** | writer 目标 <=8 个 application 条件，且全部分派具名 `decide*`/`plan*` 结果 |

### 4.2 新接缝

- `team-write-plan.ts`（domain）：只收 proposal、已解析 definition/orchestration/member identity、readiness、
  device ids 与随机字符串；不得接收 path、fs、TeamRecordStore 或 Electron。
- `team-write-store.ts`（adapter）：只做 mkdir/read/write/stat/mkdtemp/rename/rm 和 path 投影；不得比较团队
  名称、角色、member order、relay beats 或 usability。
- `team-writer.ts`（application）：持有 create→stage→reread→rename→register 的顺序及失败 rollback；只有
  一个 runtime export，<=180 逻辑行、复杂度 <=12，所有条件委托 domain plan。
- `index.ts` root 注入 record register/rollback、store、random id；不让 wiring 模块持有半个 builder。

这不是把 23 个条件拆给第二个 adapter：业务条件进入纯 domain，storage adapter 只保留 I/O；writer 的层级
变更必须与 fs/path 抽离在同一提交完成，否则不允许摘 debt。

## 5. `index.ts` composition root 收口

### 5.1 当前条件分类审计

| owner / 行号组 | 原始节点 | wiring | timing | business | 处置 |
| --- | ---: | ---: | ---: | ---: | --- |
| constructor L65-71 | 5 | 5 | 0 | 0 | 保留 root，装配三家 driver、profile resolver、writer |
| submit/adjust/retry L88-122 | 8 | 0 | 0 | 8 | 进入 `builder-service.ts`，动作合法性由 domain plan 决定 |
| `runCurrentTurn` L182-267 | 10 | 0 | 4 | 6 | 进入 `turn-runtime.ts`；repair/terminal/phase 进 domain turn plan |
| external session persistence L287-296 | 4 | 0 | 4 | 0 | 进入 turn runtime + draft-store port，identity 判据进 domain |
| mutation/load/recovery L307-351 | 7 | 0 | 6 | 1 | mutation 留 service；read/write/recovery 走 draft-store 与 domain plan |
| stored draft migration L393-447 | 14 | 14 | 0 | 0 | 进入纯 `draft-persistence-plan.ts`，只处理 unknown JSON 值 |
| profile/draft/error guards L455-476 | 7 | 6 | 0 | 1 | path/profile/error decision 进入 domain contracts/plans |
| **复算** | **55** | **25** | **14** | **16** | 三类合计等于原始 AST 条件总数 |

### 5.2 目标形态

- `index.ts` 仍是唯一 composition root，<=180 逻辑行；只保留 5 条默认装配 wiring，timing 0、business 0。
- `builder-service.ts`（application）：公开 action 与 per-draft mutation 串行化；一个 runtime export、<=300
  逻辑行、原始条件 <=11，分支只消费 domain `decide*`/`plan*` 结果。
- `turn-runtime.ts`（application）：一次 provider turn、最多一次 repair、stale return 抑制与 terminal 落盘；
  一个 runtime export、<=300 逻辑行、原始条件 <=11。
- `draft-store.ts`（adapter）：draft JSON 与原子文件替换；只做外部 codec/transport control，不持有 phase、
  retry、proposal 或 provider 选择规则。
- `draft-persistence-plan.ts` / `turn-plan.ts`（domain）：v1/v2/v3 migration、repair/failure/accept decision、
  session identity；纯闭包，由 registry 纳入 domain closure。
- `contract.ts` 增加 `AiTeamBuilderServicePort`；request/stale error 移至纯 contract/error 模块。
  `ai-team-builder-ipc.ts` 只依赖该 port 与错误契约，从而清除 concrete application re-entry。

新增 application 文件不得进 `compositionRoots`；若任一文件必须实例化具体 spawner/store 或组装全局对象图，
说明它实质是新 root，必须停下重算，不能伪装成 use case。

## 6. 测试对账与实施顺序

1. 先补纯测试：
   - `driver-session-plan` 覆盖 Claude/Codex/Kimi success/failure 的候选优先级、missing 和 resume identity；
   - `team-write-plan` 覆盖 manifest、member order、identity/markdown、relay beats、readiness、device/id 边界；
   - `draft-persistence-plan` 覆盖 v1/v2/v3 migration、非法版本与 external session/profile 冻结；
   - `turn-plan` 覆盖一次 repair、repair failure、resume failure、stale turn 与 clarifying/proposal 分派。
2. 再迁条件；逐文件临时摘 debt 验证真实零违规。`index.ts` 每段后重新核算逻辑行，超过 180 目标 20%
   或任一 application 条件超过 11 时主动报告。
3. 保留现有 service/engine-freeze/writer/spawner/IPC 测试，证明真实 fs 原子性、register rollback、provider argv、
   resume preflight、manifest 与安全 DTO。纯测试不能替代这些 I/O 接缝。
4. 本簇测试净删除目标为 0；若旧测试因职责被纯门禁接管而失义，必须另列 test-name 与接管门禁，不能静默删。
5. 收口运行 `pnpm run test --scope 414fa1f`、相关定向 tests、`pnpm check:boundaries`、`pnpm typecheck`
   和 desktop build；完整 `pnpm test` 留给 40 change 主理人复核后的唯一合并点。

本簇不承诺速度收益，记 0；新增纯测试可能令局部 suite 略增。收益以 7 条 debt 清零、root 454→<=180、
adapter 未分类 21→0 和不新增 permit/root 为准。

## 验收语句

1. 进入桌面「Agent Teams」启动 AI 建队，首问、澄清、方案、调整、失败重试与 proposal revision 的屏幕信号
   与基线一致；应用重启后 draft phase、消息、方案和冻结 CLI/profile 不变。
2. 在 proposal 点击创建：团队只在完整落盘并注册后出现在团队列表；人为制造注册失败时页面显示可重试失败，
   正式目录、staging 与 record 均无半成品，重启后仍不可见。
3. 对环境可用的 Codex/Claude/Kimi 各执行一次新 turn 与 resume：同一 draft 继续同一 external session，过程和
   terminal 正确归属；provider 返回冲突 identity 时明确失败，不跨 provider fallback。缺失环境按 RA-15 标记
   “待真机验收”，不以另一家结果抵扣。
4. 通过 preload 的 AI 建队入口提交非法 request、stale revision 和内部错误：renderer 只看到既有安全错误码与
   retryability，不出现路径、session id、stdout/stderr；正常请求仍走同一 builder 实例。
5. 跑 `pnpm check:boundaries`：40 批 debt 从 25 降到 18，五条 file debt 与两条 dependency debt 删除；
   `index.ts` 仍是唯一 AI builder root，新增 application/domain/adapter 均有唯一层归属，permit/root 不增加。
