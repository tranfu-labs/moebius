# 10 批新增 composition root 条件审计

## 口径

- 审计锚点：`0093323`（开始整改前）。
- 00 批 composition root exact allowlist 为 7 条；锚点为 18 条，实际净增 **11** 条，不是 12 条。
- 下表按 AST 控制分支（`if` / `while` / `for` / `case` / 三元表达式）计数，共 **125** 条；另有 81 个嵌套 `&&` / `||` / `??` 条件节点，因此 `[IB:application-use-case-shape]` 的 checker 口径为 **206** 个 condition nodes。先前的 124 条少计 1 条。
- 分类定义：wiring 是端口能力、I/O 可用性和缺失值保护；timing 是幂等、并发、生命周期写入顺序；business 是读取业务字段值并改变结果、路由、状态或用户信号。

## 逐文件条件分类

行号均指向审计锚点；每个控制分支恰好出现一次，三类计数之和等于总数。

| 文件 | 总数 | wiring 装配 | timing 时序控制 | business 业务判据 | 处置结论 |
| --- | ---: | --- | --- | --- | --- |
| `conversation-workspace-runtime.ts` | 4 | L74（cache/port 能力） | — | L23（baseline 存在性）、L32（diff 可用性）、L54（workspace mode） | **use case**；已下沉 `decide*`/`plan*`，注入 adapter port，并移出 allowlist |
| `session-continuation-runtime.ts` | 13 | L30、L33、L42、L51、L63、L76、L81、L109（记录/目录/port guard） | — | L70、L83、L100、L101、L106（continuation、team health、availability） | **use case**；拆 decision 后移出 allowlist |
| `session-presentation-runtime.ts` | 13 | L54、L67、L113、L147（目录/同步 port/空结果 guard） | L110、L116、L140、L145（去重写入与 abort 顺序） | L37、L47、L48、L66、L96（目录、workspace、continuation、running 显示） | **use case**；拆 projection/stop decision 后移出 allowlist |
| `run-failure-runtime.ts` | 16 | L92（placeholder 存在性） | L65、L88（graceful shutdown 先于 terminal 写入） | L54、L56、L63、L72×3、L99、L102、L114、L120、L122、L124、L127（timeout/interruption/文案与终局） | **use case**；终局映射下沉 domain 后移出 allowlist |
| `run-lifecycle-runtime.ts` | 23 | L147、L156、L158、L164、L179、L181、L186、L194、L206、L262、L265（active/store/projector guard） | L102、L103、L235、L238、L273（elapsed、长运行、resume timing） | L151、L162、L169、L208、L221、L222、L249（phase/status/attempt/activity 信号） | **保留 composition root**；它拥有 active-run 内存及时序，7 条业务判据必须改由 domain plan 给出 |
| `pending-session-context-runtime.ts` | 6 | L31、L35、L39（port/snapshot/primary guard） | L15、L29（idle 与 awaiting 批次顺序） | L22（worker pending 阻断 promotion） | **use case**；已下沉 pending/dispatch plans 并移出 allowlist |
| `run-recovery-runtime.ts` | 6 | L26、L49、L82、L85（fact/lifecycle port 与记录 guard） | L69（consume intent 先于失败终局） | L30（graceful intent eligibility） | **use case**；已下沉 recovery selection/persistence plans、注入 fact reader 并移出 allowlist |
| `project-command-runtime.ts` | 12 | L38、L42、L52、L58、L66、L72、L75、L105（capability/I/O/error guard） | L82（descendant closure 迭代） | L76、L85、L96（running/descendant/force removal） | **use case**；removal plan 下沉并按 command 拆分后移出 allowlist |
| `session-creation-runtime.ts` | 15 | L66、L90（project/load-team port guard） | L75、L138（baseline 读取与启动 processing 顺序） | L56、L59、L61、L67、L72、L94、L101、L103、L110、L118、L120（输入、workspace、routing、title） | **use case**；creation plan 下沉后移出 allowlist |
| `session-settings-runtime.ts` | 9 | L63、L75、L83、L96（error/capability guard） | — | L38、L42、L53、L56、L84（workspace/team/running policy） | **use case**；policy 下沉后移出 allowlist |
| `session-reference-runtime.ts` | 8 | L20、L34、L44（capability/missing record guard） | — | L35、L39、L40、L47、L53（scope/target/role projection） | **use case**；reference plan 下沉后移出 allowlist |

合计：wiring 49、timing 17、business 59，共 125。

## 收口规则

1. 10 个判定为 use case 的文件逐个移出 `compositionRoots`；直接 adapter 依赖改由 `runtime.ts` composition root 注入窄 port。
2. 59 条业务判据不得以 condition permit 放行；必须由 domain `decide*` / `plan*` 返回决策值。
3. `run-lifecycle-runtime.ts` 是唯一保留的新 root；完成 7 条业务判据下沉后，在 50 批 `[IB:*]` 复核中增加 composition-root 内容门禁及反例 fixture，避免 allowlist 成为免检区。
4. 每移除一项即运行 `pnpm check:boundaries`；allowlist 与本表的处置状态必须同步，禁止先删 debt、后补结构。
