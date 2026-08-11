# 设计：batch-review-handoff-generation

## 方案

### 1. 产品文档批次化（纯规则改动）

- `docs/product/AGENTS.md`「编写与评审原则」第一条从「一次只建立或评审一个产品文件，确认后再进入下一个文件」改为批次协议：同一依赖批次内的全部文件完成草案后冻结为统一快照，整批交付评审；评审以批次闭环、问题按文件定位；存在真实前置依赖时预先拆依赖批次；「建立顺序」明确为依赖顺序而非逐文件串行闸门。
- `docs/product/prompt.md`「提示词正文」删除「每次只写/改一个文件，commit 也只提交这一个文件；每写完一份就启用 subagent 评审」，改为「同一功能模块的文件全部落盘并冻结后统一进入逐文件定位的整批评审」；commit 对应一个原子产品变更，不再按文件 commit。
- `docs/product/pages/main-conversation.md`「说话与提及」追加产品语义：主 Agent 对同一成员的后续派工覆盖先前派工；被覆盖派工的晚到结论不继续推动接力；不同成员的派工互不影响；用户直达仍只排队不覆盖。

### 2. 轻量 handoff_generation（运行时机制）

**事实**：新增 JSONL 事实类型 `handoff_dispatch`，载荷 `{ sessionId, role, generation, runId, sourceMessageId, createdAt }`，空 `messageUpserts`。走 store 既有串行写漏斗（`enqueue` + `appendFactEvent`），SQLite 不加表。generation 按 (session, role) 从既有事实最大值 +1 分配，store 单写者串行保证无竞态。

**记录点（派工决策时）**：`LocalPrimaryDispatchRuntime.claim()` 的 `schedule-worker` 分支（主 Agent 回复提及成员或成员回复交棒时），先调用 `store.recordHandoffDispatch` 落盘事实，再 `recordMessageProcessed` 推进源消息，随后才 `scheduleWorker`。这样事实在成员 run 启动前就已落盘；晚到回复被主 Agent 处理时（同一 claim 循环的后续消息）必然能看到新世代。先记事实后推进源的失败语义：事实写失败时源消息仍保持 pending 可重领，派工不会丢；`recordMessageProcessed` 失败时事实已存在但 run 未启动，重领后产生的新 generation 自然覆盖那笔从未运行的派工。

**排队取消（未启动旧派工）**：`LocalWorkerDispatchRuntime.schedule()` 对每个 lane 维护内存中递增 sequence（只对 `primary-redirect` 派工计数）；队列任务启动时若自身 sequence 已落后于 lane 当前值，直接跳过 `scheduleRun`（不建 provider run、不记 run lifecycle）。用户直达（`user-direct`）不计数、不被跳过，保持既有 FIFO 语义。

**晚到结果失效（已运行旧派工）**：`LocalPrimaryDispatchRuntime.claim()` 在处理非主 Agent 的 agent 回复（worker reply）且控制动作是 `run-primary` / `schedule-worker`（即该回复会继续推动接力）时，查 `readHandoffDispatchState(sessionId, role, runId)`：回复所属 run 的 generation 落后于该角色最新 generation → 覆盖为 `complete-source`（只推进处理位点，不启动 run、不派工），历史回复消息保留在时间线。回复 run 无事实（用户直达 run、旧数据）时按「当前」处理（fail-open，行为与现状一致）。

**既有机制不动的部分**：主 Agent 对活动成员的 redirect 中断（`decideWorkerRedirectAbort`）保持；用户直达 FIFO 与「忙碌成员只排队」保持；`mention` 解析规则不改；「非主 Agent 回复有合法 mention 时按显式交棒继续」在非失效场景保持不变。

### 3. 角色提示词收紧（纯规则改动）

- `product-delivery-lead/AGENT.md`：PRD 评审批次化；「交付态执行完整流水线」改为「调度各成员完成并核验其证据」；克制与启用条件新增硬边界（不亲自改生产代码/OpenSpec/测试/验收脚本、不亲自执行验收、不亲自重跑替代专业结论、可疑证据交回对应成员）；新增派工纪律（新用户消息默认不结束当前成员任务；追加信息只更新上下文不重新 mention；只有任务目标/输入材料/验收标准变化才重新派工）。
- `implementation-lead/AGENT.md`：授权后可连续完成整个已明确的纵向切片，不强制细碎 checkpoint；存在未决技术问题时先完成尖峰再决定后续；被中断或主动返回时报告完成项、剩余项与下一步唯一入口。
- `product-reviewer/AGENT.md`、`functional-qa/AGENT.md`：验收者只验收，不修改产品或验收工具；工具或环境不成立时只返回「无法验收：工具/环境无效」，不得判产品失败或通过。

## 权衡

- **用事实代替代数器表**：generation 只存在于 JSONL 事实（append-only、可审计、可重建），不在 SQLite 建表——符合「SQLite 只存可变流转状态与可重建索引」的既有边界，也与 `run_lifecycle`、`codex_resume_intent` 等事实的既有模式一致。
- **generation 按 (session, role) 而非全局**：同一角色重复派工才互相覆盖；主 Agent 先后派不同成员（如 qa → visual-qa）互不影响，不破坏合法接力链。
- **只对 primary-redirect 计代**：用户直达是用户命令而非主 Agent 派工，覆盖语义会破坏「忙碌成员只排队」的既有产品承诺（用户可连发两条同成员指令）。
- **排队取消用内存 sequence 而非事实**：排队窗口极窄（同一次 claim 循环内的微任务），跨重启的排队任务本就不存在（lane tail 是进程内存态）；事实只服务于「晚到结果失效」这一需要跨重启判定的场景。
- **不做 DAG/任务平台/capability 沙箱**：按用户与 delivery-lead 收敛结论，批次规则、世代机制与角色提示词已覆盖六问题的主要损失面；其余留待出现真实重复证据再升级。

## 风险

- **store 方法缺失时 fail-open**：`recordHandoffDispatch` / `readHandoffDispatchState` 为可选 store 方法，运行时按 capability 门控；测试替身/旧包装 store 不实现时行为与现状一致（不失效、不记录）。生产 store 全部实现。
- **generation 分配竞态**：依赖 store `enqueue` 单写者串行（与 `nextRunAttempt` 同模式）；主 Agent claim 本身逐消息串行，两笔同角色派工不会并发分配。
- **误伤合法接力**：晚到失效只在「同角色存在更新派工」时触发；正常单派工链（qa 完成 → 回复交棒 → 下一成员）的 generation 等于最新值，不受影响。回归由既有「显式成员接力优先」等场景测试兜底。
- **回滚**：运行时机制可独立回滚（保留事实不读）；规则改动可单独 revert；事实类型对旧版本回放无副作用（空 messageUpserts，未知事件类型被读取方按 payload 原样保留）。
