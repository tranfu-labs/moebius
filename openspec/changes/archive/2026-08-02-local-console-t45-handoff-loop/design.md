# 设计：local-console-t45-handoff-loop

## 方案
本方案把 local console 的 intake 视为本地时间线上的“消息处理位点”，而不是单纯 pending user message 队列。实现时只在 local-console adapter / store 边界内改动，不改 `conversation`、`triggers`、stage parsing、CEO guardrail、goal-ledger 或 GitHub runner。

### 1. SQLite 位点表

新增表：

```sql
CREATE TABLE IF NOT EXISTS local_message_cursors (
  session_id TEXT PRIMARY KEY,
  processed_through_message_id INTEGER NOT NULL DEFAULT 0,
  active_message_id INTEGER,
  active_run_id TEXT,
  updated_at TEXT NOT NULL
);
```

含义：

- `processed_through_message_id`：该 session 已经完成 trigger 判定的最高时间线消息 id。完成包括：启动 Codex 并写回结果、判定无 trigger 并写入 system 记录、plan skip 并写入 system 记录、失败/中断/stuck 后释放 session。
- `active_message_id` / `active_run_id`：进程正在处理的消息，主要用于重启后判断是否需要修复 stale running。它只记录有界 id，不保存完整消息体。
- 位点表只用于 local console；GitHub intake state 不迁移到这里。

Schema migration 走现有 `ensureSchema` 幂等创建。旧数据库没有位点表时，不能简单从 0 开始，否则已展示的历史 agent 回复可能被重放；也不能粗暴跳到最大 id，否则可能跳过旧版本遗留的 pending 用户消息。初始化规则为：按 session 从小到大扫描 `session_messages`，把 cursor 放在第一条未完成消息之前的连续已完成前缀末尾；若不存在 pending/running/stuck/failed/interrupted 等未完成或需人工可见处理的消息，则放到该 session 最大 id。测试覆盖旧库历史不重放、旧库 pending user 不丢、新库新消息可处理。

### 2. 可 claim 触发源

新增 store 操作替代或包裹现有 `claimNextPendingMessage`：

- `claimNextProcessableMessage({ sessionId, runId, now })`
- 查找 `session_messages` 中 `id > processed_through_message_id` 且 `speaker IN ('user', 'agent')` 的最小 id。
- 如果该消息是 user 且 `status='pending'`，更新为 `running` 并写入 `run_id`。
- 如果该消息是 agent 且 `status='displayed'`，不把 agent message 改成 `running`，但在 cursor 中写 `active_message_id` / `active_run_id`，让 runtime 可以对该消息运行 trigger 判定。
- system 消息不作为触发源；cursor 可在 claim 过程中跳过 system 消息并推进，或通过查询条件自然忽略，但最终不能让 system 消息挡住后续 agent/user 消息。

为什么 agent message 不改为 `running`：UI 当前把 `displayed` 作为 agent 回复的已展示状态；把它改为 `running` 会污染时间线语义。active run 的真实运行态继续由 runtime `activeRuns` 提供，触发源 id 由 cursor 记录。

无 trigger / prompt skip 的处理：

- 对 user pending 消息沿用现有 `recordSystemAndComplete`，同时推进 cursor 到该 user message id。
- 对 agent displayed 消息写一条 visible system record 不是必需；为了避免 agent 自然收尾消息制造噪音，默认只推进 cursor，不追加 “No valid agent mention” system 消息。测试覆盖 agent 无 mention 后不会重复扫描。

### 3. Agent 回复同事务可见

`recordAgentResponse` 需要在同一个 SQLite transaction 内完成：

1. 插入 agent message。
2. 将触发源 user message 标记 completed，或在触发源为 agent message 时保持 displayed。
3. 推进 cursor 到触发源 message id，清空 active 信息。
4. 返回新插入 agent message id，或至少保证该行已经 commit，下一次 `claimNextProcessableMessage` 能看到它。

runtime 不需要把 agent 回复手动塞进内存队列；写库事务提交后，下一轮 claim 直接从 SQLite 位点拿下一条。这样 kill/restart 和正常连续 drain 使用同一事实源。

### 4. Runtime session drain

`processPending(sessionId)` 保持对外名字兼容，但内部改成 drain loop：

1. session 级 `processingSessions` 防重入保留。
2. 进入后先 `repairStaleRunning(sessionId)`。
3. 若 store 或 runtime 已有 running run，退出。
4. claim 下一条 processable message；无消息则退出。
5. 用当前完整 `session_messages` 构造 timeline，并对“最新可处理消息”运行 `resolveTrigger`。因为 timeline 当前总是取完整消息列表，claim 后若后面存在 system 记录，需要确保构造出的 latest message 与被 claim 消息一致；实现时可以在 claim 后读取 `listMessages` 并只取 `id <= claimed.id` 的前缀构造 timeline，避免后续系统记录干扰 trigger。
6. 有合法 mention 时运行 Codex；成功后 `recordAgentResponse`，然后继续 loop。
7. 无合法 mention 或 prompt skip 时推进 cursor / 记录必要 system 状态，然后继续 loop。
8. Codex failure / interruption / stuck 按现有语义记录并退出本次 drain；后续由用户新消息或启动 catch-up 再推进。

session 内仍严格串行：同一 session 只有一个 drain loop 和一个 active Codex run。session 间可通过 `processAllPending()` 并行启动各自 drain，保持现有行为。

### 5. Server 启动 catch-up

`startLocalConsoleServer` 不再创建 1s interval。替换为：

- `await runtime.init()` 修复 stale running。
- server listen 后执行一次 fire-and-forget `runtime.processAllPending()`，用于重启后 catch-up 未处理接力。
- `submitUserMessage` 仍在 append 成功后 `void this.processPending(sessionId)`，正常路径不依赖轮询。

这能让“杀进程后重启”从 SQLite 位点续跑，同时避免运行中每秒扫全部 session。

### 6. 测试设计

单元 / 集成测试：

- 多角色接力：fake agents `ceo`、`dev-manager`、`dev`、`qa`，fake Codex 依 role 返回下一棒 mention；发 `@ceo 我想做 X` 后等待时间线出现四条 agent message，断言 `runCodex` 调用顺序和消息间 elapsed 小于 1s 轮询阈值。
- Agent 回复触发源：直接在 store 中写入 agent displayed message 含下一棒 mention，调用 `processPending` 后应 claim 并运行目标 role。
- 无 trigger agent 回复：agent displayed message 无合法 mention 时只推进 cursor，重复 `processPending` 不追加噪音、不重复处理。
- kill/restart 续跑：用同一 SQLite，第一进程处理到中间后关闭；第二进程启动后一次 catch-up 继续未处理 agent handoff，断言已完成 role 不重复、后续 role 不丢。
- 启动 catch-up：server start 后未提交新用户消息也能处理 SQLite 中尚未过位点的消息。
- 轮询收缩：测试 start server 后一段时间内不会周期性调用 `processAllPending`；或者通过 fake runtime / short wait 断言无 1s interval 副作用。
- 历史库迁移：已有历史 completed/displayed 消息初始化位点到最大 id，不重放历史；新消息仍可处理。
- GitHub 回归：`pnpm test` 全套通过，重点保证 runner / GitHub intake 测试未被 local cursor 改动影响。

验收脚本：

- 新增 `scripts/acceptance/local-console-t45.ts`，使用 fake local console server 和 SQLite 直接制造可控 Codex 响应，输出 `artifacts/acceptance/t45-evidence.json`。
- 证据 JSON 记录四角色落库顺序、相邻消息时间差、kill/restart 前后 processed cursor 和 run 调用次数、全量测试命令摘要。

## 权衡
- 选择 SQLite 位点而不是内存队列：牺牲少量 schema 复杂度，换取 kill/restart 断点续跑和“不重复不丢棒”的可验证事实源。
- 选择让 agent message 保持 `displayed`：避免 UI 状态语义漂移；active 状态仍由 runtime snapshot 表达。
- 选择完整时间线前缀构造 trigger：复用现有 mention parsing 和 prompt plan，避免 fork local-only trigger 规则。
- 选择启动一次 catch-up 而不是定时 poll：正常接力延迟更低，且符合“只保留启动 catch-up”的需求；如果未来需要外部进程直接写 SQLite，可另行设计通知机制，不在 T4.5 偷偷保留轮询。

## 风险
- Cursor 初始化若处理不当会重放历史 agent 回复。缓解：为旧库初始化 processed cursor 到已有最大 message id，并用测试覆盖。
- `buildLocalConsoleTimeline` 当前默认使用全部消息；若不截断到 claimed message，会被后续 system/error 记录干扰。缓解：runtime claim 后按 id 前缀构造 timeline。
- Agent handoff chain 可能无限循环。缓解：本轮不新增业务语义限制，但 runtime 可保留 session drain 的单次循环保护，例如每次 drain 最多处理一个合理上限并记录 diagnostic；如引入上限，必须只作为防御，不改变正常四角色链。
- 移除 1s interval 后，若有代码绕过 runtime 直接写 SQLite，新消息不会被实时处理。缓解：本地 API 仍走 `submitUserMessage`；重启 catch-up 兜底可恢复。直接写库不是当前公开写接口。
- 回滚方式：恢复 `claimNextPendingMessage` 和 server interval，保留新增 cursor 表不读；因 cursor 只存 id 元数据，不影响现有 session_messages 时间线。
