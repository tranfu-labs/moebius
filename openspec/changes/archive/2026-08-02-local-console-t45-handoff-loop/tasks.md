# 任务：local-console-t45-handoff-loop

- [x] 建立本地消息处理位点
  - [x] 在 SQLite schema 中新增 `local_message_cursors` 幂等表。
  - [x] 增加历史库位点初始化，避免已存在 completed/displayed 历史消息被重放，同时不跳过旧库 pending 用户消息。
  - [x] 扩展 `SqliteStateCommand`、store 类型和 worker 操作，支持基于位点 claim、完成、跳过。
- [x] 打通 runtime 接力 drain
  - [x] 将 `LocalConsoleRuntime.processPending` 改为 session drain loop，保留 session 内串行防重。
  - [x] 使用 claimed message 前缀构造 local timeline，并复用现有 `resolveTrigger` / `buildRolePromptPlan`。
  - [x] 在 agent 回复落库事务后立即继续 claim 下一条可处理消息。
  - [x] 保持 failure / interruption / stuck 记录和 session 释放语义。
- [x] 收缩 server 轮询
  - [x] 移除 1s `setInterval(processAllPending)`。
  - [x] 启动后执行一次 catch-up `processAllPending()`。
  - [x] 保持 POST message append 后立即触发当前 session drain。
- [x] 补齐测试
  - [x] 增加四角色本地接力顺序和无 1s+ 轮询等待测试。
  - [x] 增加 agent message 作为触发源、无 trigger agent message 推进位点测试。
  - [x] 增加 kill/restart 后从 SQLite 位点续跑、不重复不丢棒测试。
  - [x] 增加启动 catch-up 测试、历史库不重放测试和旧库 pending 不丢测试。
  - [x] 增加 server 不再周期性 poll 的回归测试。
  - [x] 增加 `recordAgentResponse` 事务前失败不推进 cursor、不产生半条 agent 回复的测试。
  - [x] 增加 `recordAgentResponse` 提交后、下一棒 claim 前退出并由重启续跑的测试。
  - [x] 增加 handoff 中段 Codex 永久挂起 / max-duration timeout 后 stuck 可见、session 释放、cursor 不永久挡住 catch-up 的测试。
  - [x] 增加两个 session startup catch-up 的测试，证明慢 session 不阻塞另一 session。
- [x] 验收与收尾
  - [x] 新增或扩展 T4.5 本地验收脚本，生成 `artifacts/acceptance/t45-evidence.json`。
  - [x] 运行 `pnpm test`。
  - [x] 运行 `pnpm typecheck`。
  - [x] 将 T4.5 验收证据追记到 `docs/roadmap/milestone-4-local-console.md` 并勾选。
  - [x] `git diff --check`，随后 commit、push，并创建 PR；commit / PR body 含 `Closes #105`。

---

## 30 批处置（归档）

本 change 的 local 任务已全部完成，归档为事实。其中涉及 GitHub 对等/零漂移的验收前提随 `four-layer-30-github-runner` 失效，但已验证的 local 事实完整保留。
