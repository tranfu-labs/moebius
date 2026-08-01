# 设计：audit-console-state-composition

## 范围与产物边界

唯一正式交付物是 `docs/architecture/console-state-composition-audit.md`。审计对象包括：

1. `app.tsx` 的 86 条 hook 声明，按声明所在组件限定作用域。组件作用域列只允许取 `App`（0）、`DesktopLanguageRoot`（2）、`DesktopRoutes`（1）、`OperatorConsoleRoute`（3）、`OperatorConsoleApp`（80），合计 86；同名的 `state`（`DesktopLanguageRoot` reducer 与 `OperatorConsoleApp` state）和 `pendingAgentTeamKey`（`OperatorConsoleRoute` 的只读导航快照与 `OperatorConsoleApp` 的可变待应用团队）必须作为不同条目。
2. 22 个 `useEffect`，逐个登记其读取、写入、清理和异步边界；effect 不另计入 86 条 hook，但必须能反查到它影响的 hook / 外部状态面。
3. `app.tsx` 同目录除自身外的 22 个邻近文件全部进入模块覆盖附录；其中有 mutable state / store / coordinator 公开面的文件继续进入外部状态面 ledger，至少覆盖草稿、selection、session-view queue、presentation route、右侧标签、sidebar-conversation 草稿、阅读位置、团队编辑、设置、语言、新对话和附件草稿。CSS、HTML、类型声明、纯格式化、只读 adapter 或无状态 utility 逐文件说明排除理由，避免以“在别的文件里”为由漏审。

不审计 React / Router / console-ui 内部实现，也不把服务端领域状态重新定义成 renderer 不变量；只追踪 renderer 持有、镜像、缓存或编排的状态组合。

## 审计方法

### 1. 建立声明、写入、读取与边界账本

按源码行号为 86 条声明分配稳定 ID `H-001` 至 `H-086`。每行至少包含：组件作用域、hook 类型、声明坐标、状态 / ref / reducer 名称、全部直接写点、关键读点、关联 effect、关联外部状态面、归属的风险 ID 或登记依据 ID。

另建两张表：

- `E-001` 起的 effect ledger：22 行，记录依赖、写目标、cleanup、`await` / Promise continuation / IPC callback / timer / requestAnimationFrame 等边界，以及它是否可能在输入身份变化后提交旧结果。
- `X-001` 起的外部状态面 ledger：记录邻近模块的状态 shape、owner/key/version/generation/phase 字段、读写 API、持久化介质及 `app.tsx` 调用坐标；无状态模块以“排除”行登记理由。

机械基线必须在正文的 fenced code block 中原样给出可重跑命令与输出：hook 声明 86（49 state + 3 reducer + 34 ref）、effect 22；文档中 `H-` 行数必须等于 86，五个组件作用域的分项数必须为 0 / 2 / 1 / 3 / 80，且每个 `H-` 恰好有风险或登记去向。

### 2. 从读写图识别候选不变量

对每个状态从写点向后追踪到读取它的 render、handler、effect 与持久化调用，并反向记录该读写成立所依赖的其他状态。出现下列任一形状即建立候选，不以文件大小或 hook 数量作判据：

- 值的含义依赖另一个 selection / session / team / tab / draft key，但值自身没有 owner。
- Promise、IPC、effect、timer 或动画回调在发起后还能提交，而目标 identity / generation / route 已可改变。
- state 与 ref 镜像共同参与正确性，但存在只更新其一的写点或同一离散事件内读取旧镜像的路径。
- 多个布尔、nullable state 或集合共同编码有限 phase，且独立 setter 能构造产品不允许的组合。
- renderer 内存、localStorage store 与服务端投影存在两个以上可写副本，且提交优先级 / 版本 / 回滚规则未声明。
- 一项副作用的正文、附件、目标、发送门禁或清理对象来自不同 owner 来源。

若关系已经由 reducer、owner key、generation、稳定 FIFO、version token 或 fail-closed guard 显式声明，则不作为开放风险；仍在 hook 表登记现有保护及坐标。

### 3. 把不变量写成可判真假的句子

每条只允许以下两种主句形式：

- “若 X，则必须 Y。”
- “不存在 A=a 且 B=b 同时成立的时刻。”

“应保持一致”“可能不同步”“状态有点乱”等不可判定措辞不得作为不变量。每条必须附一段最短反例时序：起始合法状态 → 打开窗口的边界 → 交错写入 → 非法组合；没有具体边界与写点的猜测不进入风险清单。

### 4. 使用可复算风险分数排序

每条开放风险先填写“判定性质”，取值只允许 `已确认缺陷`（具体反例时序可由坐标推出必然发生）、`未证伪的可能性`（形状成立但反例依赖未验证的运行时假设）或 `已有保护待登记`。该字段不参与评分，不能用风险分数倒推判定性质。

每条风险再填写五个维度，分数 `R = W + 2U + P + S + B`，范围 1–18：

| 维度 | 取值锚点 |
| --- | --- |
| `W` 可触发性（0–3） | 0=现有 guard 下不可形成窗口；1=仅恢复/异常/内部入口；2=普通操作但依赖时序；3=普通操作可重复触发且无需特殊环境 |
| `U` 用户后果（0–4） | 0=无可见后果；1=短暂展示/焦点错误；2=操作受阻或可恢复困惑；3=内容丢失、错路由或错误内容；4=错误持久副作用、破坏性或不可恢复结果 |
| `P` 持续性（0–3） | 0=下一次 render 即消失；1=当前页面/模式内持续；2=跨导航或 localStorage / 应用重启持续；3=写入服务端、文件或外部系统 |
| `S` 静默性（0–2） | 0=明确阻断并解释；1=症状可见但原因不明；2=错误静默发生 |
| `B` 影响面（0–2） | 0=单控件；1=单会话/单团队/单标签；2=跨会话、跨项目、跨团队或应用级 |

等级由总分唯一决定：高风险 13–18，中风险 8–12，低风险 1–7。“登记即可”不是低风险，而是没有未声明跨状态不变量的独立结论，不参与评分。排序先按 `R` 降序，再按 `U`、`P`、`W` 降序，最后按稳定 ID 升序；因此任何人用表内取值都能复算顺序。

### 5. 建议动作只取三类

- **显式化**：缺口是 owner、identity、generation、version、target 或提交顺序未进入状态模型。
- **合并成单一 reducer**：多个字段共同编码同一个有限 phase，非法组合来自独立 setter，且不存在缺失 owner 这一更直接的问题。
- **登记即可无需动作**：setter / ref 写点已穷尽，状态无跨状态读取条件，或现有 reducer / owner / generation / queue 已声明关系并封住迟到提交。

条目只写动作类型与判定理由，不写模块拆分、字段设计、函数签名、迁移步骤或测试实现；这些属于后续独立 change。

## 文档结构

最终文档依次包含：

1. 审计结论摘要与排序规则。
2. 高 / 中 / 低风险候选表；每条含状态、可判定不变量、声明/写/读坐标、异步边界、反例时序、用户后果、五维评分、总分、等级、动作类型与独立 follow-up change 边界。
3. 86 条 hook 完整性表，并列出五个组件作用域分项计数。
4. 22 条 effect ledger。
5. 邻近状态模块公开面与排除表。
6. “登记即可”证据目录；每个依据包含精确 `rg` 命令、调用点行号，或现有 reducer / owner / generation / queue 的定义与消费坐标。
7. `02c1604^` 回溯自校验。
8. 未来可提升到 `docs/architecture/invariants.md` 的候选及准入理由。
9. 限制与未验证项。

每个风险 ID 只覆盖一条不可分的不变量。若两个状态簇不能用同一句合法组合判据和同一反例时序描述，就必须拆成两个条目；每条 follow-up 边界不得依赖先拆 `app.tsx` 或同时完成其他条目。

## 回溯自校验

在当前代码审计前，先对 `02c1604^` 的历史 `app.tsx`、`draft-store.ts` 与相关调用点执行同一流程：

1. 不引用归档结论作为发现依据，先从历史声明账本追踪 composer 正文、selection / selection ref、草稿 store 与 session-view transition。
2. 检查方法能否生成可判定句：“若 composer 正文展示为会话 B 的草稿，则正文持久化与发送目标必须都属于 B。”
3. 检查能否定位异步阅读状态 transition 打开的窗口、旧 selection 写入点与迟到目标草稿回读点，并把用户后果判断为串草稿 / 清空 / 错会话发送。
4. 用本设计的五维表独立评分，并把动作归类为“显式化”。
5. 最后才与归档 change 对照；任一关键点未被同一方法发现，先修订候选识别规则并重跑校准，不得直接补写已知答案。

回溯条目使用 `02c1604^:<file>:<line>` 历史坐标，当前已显式化的 composer owner 只在当前 hook 表登记保护，不重复列为开放风险。

## 方案验收清单

- [x] 目标文档只是一份风险清单；生产代码、测试、PRD、specs、`invariants.md` 均无改动。
- [x] 基线代码块原样贴出可重跑命令及输出，结果为 86 条 hook（49 state / 3 reducer / 34 ref）与 22 条 effect；`H-` 表恰好 86 行，五个组件作用域计数为 0 / 2 / 1 / 3 / 80，且两个 `state`、两个 `pendingAgentTeamKey` 均按作用域分开。
- [x] 每个 `H-` 条目恰好链接至少一个风险 ID 或一个“登记即可”依据 ID；关键 ref 与 store 公开状态不存在无去向项。
- [x] 22 个 effect 全部进入 ledger，并记录依赖、写目标、cleanup / 异步边界和迟到提交判断。
- [x] 同目录 22 个邻近文件全部进入模块覆盖附录；有 mutable state / store / coordinator 的公开面全部登记，排除项逐个给出“样式或壳文件 / 无 mutable state / 只读 adapter / 纯计算”等可回查理由。
- [x] 每个风险不变量严格写成“若 X 则必须 Y”或“不存在 A 且 B 同时成立”，并有 `file:line` 声明、写点、读点和具体异步边界。
- [x] 每个用户可见后果都能由所列反例时序推出，并附 PRD `file.md#anchor` 或 spec Requirement 坐标；没有 oracle 坐标的后果不进入风险条目。
- [x] 每个风险先标记 `已确认缺陷 / 未证伪的可能性 / 已有保护待登记` 三选一判定性质，再填写 `W/U/P/S/B`、公式总分和唯一等级；判定性质不参与评分，全文排序可按规定的 tie-break 复算。
- [x] 每个建议动作精确属于“显式化 / 合并成单一 reducer / 登记即可无需动作”之一，且不包含文件机械拆分或后续实现方案。
- [x] 每个风险条目只覆盖一个可独立开 change 的不变量簇；不存在必须打包多个无关条目才能执行的父项。
- [x] 每个“登记即可”都有 setter / dispatch / ref 写点检索命令及坐标，或已有 reducer / owner / generation / queue 的定义与消费坐标；不以“看起来没问题”为依据。
- [x] `02c1604^` 自校验使用同一方法独立捞出草稿归属、异步窗口、用户后果和“显式化”动作；失败时已先修订方法再重跑。
- [x] 单列可能提升进 `invariants.md` 的候选与准入理由，但没有修改现有 L/S/V 编号事实源。
- [x] 文档记录审计限制和未验证项；不把静态分析包装成真实运行复现或已确认 bug。

## 权衡

### 采用：声明账本 + 读写图 + 异步边界 + 已知答案校准

该方法把“状态乱”转换为可证伪的合法组合和反例时序，能同时覆盖 app 内 hook、ref 镜像和外部 store；86 行覆盖表防止只报告显眼风险，历史校准防止方法系统性漏掉已知故障形状。

接受的成本是文档较长，且大量“登记即可”条目必须留下机械证据。这个成本正是完整性可审核所需，不用风险条目数量或文件行数替代。

### 不采用：仅按 hook 邻近位置分组

声明相邻不代表同一变化理由；草稿归属已证明风险可以横跨 app、store 与异步 mutation。按代码块分组会漏掉跨模块关系。

### 不采用：直接给 `app.tsx` 拆分建议

移动声明不会声明 owner、generation、phase 或提交顺序，只会把隐式关系变成跨模块关系。本轮只登记不变量和动作类型。

### 不采用：把所有多字段状态都建议 reducer

缺 owner 的值即使进入 reducer 仍可能属于错误 identity；单写者派生状态也不因字段多就有组合风险。动作类型由缺口形状决定。

## 风险

- **静态分析漏掉动态别名**：setter 经 callback、action class 或 store method 间接调用时，单纯名称检索可能漏写点。审计必须从 handler / effect 调用链双向回查，并在限制节记录无法静态证明的动态入口。
- **文档坐标随并行代码改动漂移**：落盘前记录审计基准 commit；若 `app.tsx` 或相关状态模块在方案核验后变化，先重建声明与行号账本，不能沿用旧坐标。
- **把已有保护误报为风险**：owner、generation、queue、version token 或 reducer 已表达的关系必须先登记保护；只有还能构造反例时才列开放风险。
- **把产品未决策当 bug**：用户后果无法由 PRD / spec 或明确当前行为推出时，只写限制，不为其评分或假设验收标准。
- **风险等级被主观放大**：维度必须按锚点取值并写证据；排序只使用公式和 tie-break，不允许手工调整 P 级。
- **清单粒度过大**：发现条目同时含两个异步窗口或两种不变量句时强制拆分，保证后续每条可单独开 change。
