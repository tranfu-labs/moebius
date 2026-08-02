# 提案：local-console-t45-handoff-loop

## 背景
里程碑 4 的 T4 已经让桌面操作台能订阅本地通道、看到运行直播、中断和错误状态，但 T4 成功标准中“ceo + qa + dev-manager + dev 在纯本地完成一轮方案链”仍未闭环。当前 local console 的 intake 仍是单轮形态：

- `src/local-console/runtime.ts` 的 `processPending` 只 claim `pending` user message。
- agent 回复落入 `session_messages` 后状态是 `displayed`，不会被视为新的可 claim 触发点。
- agent 回复里即使包含下一棒 mention，也不会立即再走 `resolveTrigger`。
- `src/local-console/server.ts` 通过 1s `setInterval(processAllPending)` 做兜底扫描，导致接力至少依赖轮询节奏，也无法表达重启后的“最后处理位点”。

T4.5 要把 local intake 侧从“用户消息触发单轮 run”提升为“本地时间线消息处理总线”：agent 回复在同一落库事务内成为新的可 claim 触发点，runtime 在当前 run 完成后立即推进下一条未处理消息；进程重启后从 SQLite 位点续跑，不重复也不丢棒。GitHub runner 仍保持零漂移。

## 提案
本 change 只改 local-console 侧：

1. 在 SQLite 中新增本地消息处理位点表，按 session 记录已完成 trigger 判定 / claim 的最高消息 id，以及当前正在处理的 message id / run id 等有界元数据。
2. 调整 local store 的 claim 语义：不再只查 `status='pending'`，而是按处理位点选择下一条尚未处理、可作为 mention trigger 源的 `user` 或 `agent` 消息；system 消息和无触发消息只推进位点，不启动 Codex。
3. 调整 `recordAgentResponse` 的事务：完成触发源消息的同时插入 agent 回复，并让该 agent 回复在同一事务内对处理位点可见，确保下一轮可立即 claim。
4. 调整 `LocalConsoleRuntime.processPending` 为“drain 当前 session”：一次进入后串行处理直到没有下一条可处理消息或遇到 active run / 失败 / 中断 / stuck；成功记录 agent 回复后立即继续下一轮，不依赖 HTTP 层轮询。
5. 替换 `server.ts` 的 1s 兜底轮询：启动后只执行一次 `runtime.processAllPending()` catch-up，之后只由消息写入与 agent 回复完成后的 runtime drain 驱动。
6. 保持 session 内严格串行、session 间并行的现有约束；保留 running / interrupted / failed / stuck 的释放语义。
7. 增加单元测试和本地验收脚本，覆盖秒级多角色接力、kill/restart 断点续跑、不重复不丢棒、无 1s+ 轮询等待以及 GitHub 全测试套件全绿。
8. 实现完成后把 T4.5 验收证据追记到 `docs/roadmap/milestone-4-local-console.md` 并勾选。

## 影响
受影响模块：

- `src/local-console/runtime.ts`：把单条 pending 处理改成 session drain；成功写入 agent 回复后立即继续处理下一触发源。
- `src/local-console/store.ts` / `src/local-console/types.ts`：扩展 local store 接口，提供基于位点的 claim / 完成 / 跳过能力。
- `src/sqlite-state.ts` / `src/sqlite-state-worker.ts`：新增 SQLite 命令和位点表；保证 schema migration 幂等。
- `src/local-console/server.ts`：移除 1s interval，只保留启动 catch-up。
- `tests/local-console.test.ts`：补本地接力、断点续跑、catch-up 和轮询收缩回归。
- `scripts/acceptance/`：新增或扩展 T4.5 验收脚本，输出可发布的证据文件。
- `docs/roadmap/milestone-4-local-console.md`：实现完成后追记验收证据并勾选 T4.5。

对外行为：

- 本地模式：同一 session 内 agent handoff 会在上一轮 Codex 成功落库后立即进入下一轮，只受 Codex 单轮耗时和 store 有界调用影响。
- 本地模式：进程重启后从 SQLite 位点继续处理未完成接力；已经完成过 trigger 判定的消息不会重复启动 Codex。
- GitHub 模式：不改 `runner.heartbeat`、GitHub intake、comment sink、reaction、artifact、issue worktree 或 driver pool 调度。
