# local-console spec delta：local-console-t45-handoff-loop

T4.5 将本地通道从单轮 pending user message intake 扩展为本地时间线接力总线。该 delta 只规定 local console 的消息处理位点、agent handoff 即时推进和重启续跑；不规定 T5 的 CEO 无 mention 兜底、子会话编排、验收 pre-pass 全功能对等，也不改变 GitHub issue runner 语义。

## 新增行为规则

### 本地消息处理位点
- MUST persist a per-session local message processing cursor in the existing local console SQLite database.
- MUST use the cursor to resume local handoff processing after process restart without replaying already processed messages.
- MUST store only bounded cursor metadata such as session id, processed-through message id, active message id, active run id, and timestamps; it must not duplicate full message bodies outside `session_messages`.
- MUST initialize the cursor for pre-existing local console history so completed/displayed historical messages are not replayed after the migration while pre-existing pending local user messages are not skipped.
- MUST keep `session_messages` as the durable timeline fact source; the cursor only tracks intake progress.

### Agent replies as trigger sources
- MUST make local agent replies eligible as new trigger sources after they are written to `session_messages`.
- MUST evaluate valid agent mentions in local agent replies using the existing mention trigger rules, including ignoring mentions inside inline code and fenced code blocks.
- MUST process local user and agent trigger sources in timeline order within a session.
- MUST NOT treat local system messages as agent trigger sources.
- MUST NOT change the displayed status semantics of already visible agent replies merely because they are used as trigger sources.
- MUST avoid repeated processing of a local agent message that has already been evaluated and recorded in the cursor.

### Immediate local handoff drain
- MUST continue processing the same local session immediately after a successful local agent response is recorded when that response contains a valid handoff mention.
- MUST NOT depend on a fixed 1 second polling loop to discover local agent handoff messages.
- MUST keep local execution serial per session; one session must not run two Codex jobs concurrently.
- MUST allow different local sessions to process independently as before.
- MUST stop the current drain on Codex failure, user interruption, stuck timeout, or store failure using the existing visible local status semantics.
- MUST keep prompt/timeline construction scoped to the claimed trigger source so later system/error records cannot become the effective latest message for that claim.

### Restart catch-up
- MUST perform a bounded startup catch-up for local sessions so unprocessed local handoff messages continue after process restart.
- MUST NOT keep a background fixed-interval catch-up poll as the normal local intake driver.
- MUST preserve stale running repair: a run that was active before process death must become visible stuck/interrupted/failed according to the existing local-console timeout rules, and later unprocessed handoff messages must still be eligible for catch-up.

### GitHub zero drift
- MUST NOT modify `runner.heartbeat`, GitHub response intake scheduling, GitHub comment publication, reaction targets, artifact publication, issue media handling, issue worktree behavior, or GitHub driver pool semantics for this change.
- MUST keep existing GitHub runner tests passing.

## 新增场景

### 场景 LC.T4.9：本地 agent 回复立即触发下一棒
Given a local session has agents `ceo`, `dev-manager`, `dev`, and `qa`
And fake Codex responses hand off from `ceo` to `dev-manager`, then to `dev`, then to `qa`
When the user sends `@ceo 我想做 X` in the local console
Then the local timeline eventually contains four agent messages in order: `ceo`, `dev-manager`, `dev`, `qa`
And each agent reply after `ceo` was triggered by the previous agent message rather than by a periodic polling interval
And no adjacent handoff waits for a fixed 1 second poll delay.

### 场景 LC.T4.10：本地接力重启后不重复不丢棒
Given a local session has already processed the first part of an agent handoff chain
And the SQLite cursor records the processed-through message
When the local runtime process is killed before the remaining handoff chain is complete
And the local console starts again with the same SQLite database
Then startup catch-up resumes from the first unprocessed handoff message
And previously processed agent messages do not start Codex again
And remaining handoff messages are not skipped.

### 场景 LC.T4.11：无 trigger agent 回复只推进位点
Given a local agent reply contains no valid agent mention
When local intake evaluates that agent reply
Then the cursor advances past that message
And no Codex run is started for it
And repeated local intake passes do not append duplicate no-trigger records for the same agent reply.

### 场景 LC.T4.12：启动 catch-up 替代固定轮询
Given the local console server starts with unprocessed local messages in SQLite
When startup completes
Then it performs one catch-up pass for pending local sessions
And later handoffs are driven by message append or runtime drain completion
And the server does not keep a fixed 1 second local intake interval.

## 验收约束

- MUST provide `code-verified` evidence showing a pure local `@ceo 我想做 X` handoff chain recorded `ceo -> dev-manager -> dev -> qa` in SQLite.
- MUST provide `code-verified` evidence showing adjacent local handoff messages were not delayed by a fixed 1 second polling wait.
- MUST provide `code-verified` evidence showing kill/restart catch-up resumed from the SQLite cursor without duplicate Codex calls or lost handoff messages.
- MUST provide `code-verified` evidence showing a failure before the `recordAgentResponse` transaction commits does not advance the cursor and does not leave a partial agent reply.
- MUST provide `code-verified` evidence showing process exit after the `recordAgentResponse` transaction commits but before the next claim resumes from the newly written agent reply and does not repeat the completed role.
- MUST provide `code-verified` evidence showing a permanent hang or max-duration timeout in the middle of a handoff records a visible stuck state, releases the session, and does not leave cursor active metadata permanently blocking catch-up.
- MUST provide `code-verified` evidence showing startup catch-up for two sessions does not let a slow handoff in session A block an unprocessed handoff in session B.
- MUST provide `code-verified` evidence that `pnpm test` passed.
- MUST update `docs/roadmap/milestone-4-local-console.md` under T4.5 with acceptance evidence and mark T4.5 complete.
