# 40 批测试对账：parser/classifier 与真实 I/O 接缝

## 结论

- 本 change **删除测试 0 条**；不存在“集成测试被纯测试替代”的候选，因此等价替代表为空。
- 新增的 parser/classifier/plan 测试只证明迁出的纯决策；它们不抵扣下表的真实 fs、SQLite/JSONL、进程、IPC、HTTP 或 Electron 接缝。
- 后续若要剪除下表任一测试，必须另列“旧 test-name → 新 test-name → 同一外部行为分支证据”；仅有同名纯 plan 用例不构成等价。

## 新增纯测试（增量覆盖，不是替代关系）

| 簇 | test-name | 纯行为 |
| --- | --- | --- |
| provider / infra | `execution-failure-plan.test.ts :: preserves interruption, timeout, and crash semantics` | provider 失败语义投影 |
| provider / infra | `local-console-attachment-plan.test.ts :: keeps draft ownership and content scope bound to the session` | 附件归属与内容范围 |
| provider / infra | `local-console-codex-rollout-invocation-plan.test.ts :: projects only trusted developer and user message roles` | trusted rollout 角色投影 |
| ai-team-builder | `ai-team-builder-driver-session-plan.test.ts :: preserves each provider's observed-session precedence` | provider session 候选优先级 |
| ai-team-builder | `ai-team-builder-draft-persistence-plan.test.ts :: migrates v1 identity and failure fields without probing another provider` | 草稿版本解释与迁移 |
| ai-team-builder | `ai-team-builder-team-write-plan.test.ts :: rejects invalid proposals before a storage adapter is needed` | 写入前领域校验 |
| ai-team-builder | `ai-team-builder-turn-plan.test.ts :: persists one observed session and rejects a conflicting replacement` | turn/session 决策 |
| desktop team | `team-management-document-codec.test.ts :: rejects malformed ownership and state keys` | 管理文档 codec |
| desktop team | `team-storage-plans.test.ts :: rejects invalid ownership and path mutations` | ownership/path 领域决策，不执行 fs |
| desktop team | `team-official-update-plan.test.ts :: rejects a staged content fingerprint mismatch` | 官方更新计划判定 |
| desktop team | `team-onboarding-orchestration-plan.test.ts :: distinguishes missing and invalid embedded relay data` | legacy orchestration 数据解释 |
| desktop team | `team-runtime-binding-plan.test.ts :: derives repair health and deleted read failures` | runtime binding 状态决策 |
| desktop root | `desktop-shutdown-plan.test.ts :: maps user approval and lifecycle state to observable shutdown actions` | 退出协调计划 |
| desktop root | `desktop-window-plan.test.ts :: requests coordinated shutdown while an installer is active` | 窗口关闭计划 |

## 不可删除的真实 I/O 接缝

下列登记是**保留边界**，不是以文件名通配抵扣等价性；本 change 对这些文件的测试删除数均为 0。

| 外部接缝 | 受保护 test-name（代表其所在文件的真实 I/O 契约） | 纯测试为何不能替代 |
| --- | --- | --- |
| SQLite worker generation / crash / FIFO | `sqlite-state-worker-pool.test.ts :: rejects a crashed active command once and preserves queued order across recovery` | 必须启动真实 worker 并观察崩溃恢复与队列顺序 |
| SQLite schema / symlink canonicalization | `sqlite-state.test.ts :: reuses a canonical lane through symlinks and reinitializes schema for each generation` | 依赖真实路径、连接和 schema 生命周期 |
| JSONL 原子提交与 SQLite 索引顺序 | `session-jsonl-fact-log.test.ts :: round-trips appended facts, keeps a stable path, and commits the log before the SQLite index` | 需要真实文件与持久化顺序 |
| JSONL 损坏尾部恢复 | `session-jsonl-fact-log.test.ts :: ignores an incomplete tail while reading and truncates it before the next append` | 需要真实损坏文件与后续 append |
| Codex argv/stdin 与进程取消 | `codex.test.ts :: terminates option parsing with -- so greedy --image cannot swallow the prompt`；`codex.test.ts :: escalates aborted codex child processes to SIGKILL when they ignore graceful signals` | 保护真实 CLI 参数边界与进程信号升级 |
| Claude native stream / watchdog / session link | `claude.test.ts :: streams only text deltas after a matching init and preserves the session on resume`；`claude.test.ts :: stops a tool_use that never produces a tool_result` | 保护原生 wire、watchdog 与 resume 同源接缝 |
| Kimi ACP transport / canonical session | `kimi.test.ts :: preserves JSON-RPC error code, message, and data in run-local diagnostics`；`kimi.test.ts :: rejects a resume response with a different exact session id before prompting` | 保护 ACP transport 与 session 身份边界 |
| Team store 原子写、回收与路径 | `team-store.test.ts :: moves a user team directory to recoverable trash and rejects built-in teams` | 需要真实目录、trash port 与 ownership 接缝 |
| Team record migration / restart read | `team-record-store.test.ts :: migrates v1 directory records to managed v2 locations without retaining member summaries` | 需要真实版本化文件与持久化重读 |
| Team management atomic document | `team-management-store.test.ts :: persists versioned official state atomically` | 保护 fs 原子替换和损坏文档 fail-closed |
| Official update rollback / recovery | `team-official-update.test.ts :: rolls back a record failure, retries the same plan, and deduplicates its protected copy`；`team-official-update.test.ts :: recovers an interrupted post-swap journal to the complete old state on startup` | 需要真实 staging、journal、rollback 与重启恢复 |
| Team seed filesystem conflict | `team-seed.test.ts :: preserves an occupied official directory and registers General Assistant at a managed alternate location` | 需要真实目录冲突与 seed 写入 |
| Onboarding storage migration | `team-onboarding-orchestration.test.ts :: migrates valid embedded relay data before rewriting a user team manifest` | 需要真实 legacy 文件迁移和原子写 |
| Electron shell / file manager | `team-file-manager.test.ts :: replaces missing, inaccessible, and shell errors with a stable error code` | 保护 shell port、realpath 与错误映射 |
| External AGENT.md change | `team-external-change.test.ts :: checks a relocated user team through its recorded external location` | 需要真实外部路径读取与 relocation 记录 |
| IPC DTO / storage registration | `team-ipc.test.ts :: returns safe list data from built-in and user teams without exposing disk paths or markdown bodies` | 保护 Electron channel、DTO 与真实 store 装配 |
| Repair IPC failure preservation | `team-repair-ipc.test.ts :: keeps the original record and gives a concrete reason when relocation is rejected` | 保护失败时持久事实不被覆盖 |
| Local console team binding | `local-console-timeline-truth.test.ts :: reports a deleted team as read-only, then recovers through the HTTP team switch without losing history` | 需要真实 HTTP、会话事实与团队状态接缝 |

## 剪枝对账

| 旧 test-name | 新 test-name | 等价分支证据 | 处置 |
| --- | --- | --- | --- |
| — | — | 本 change 无删除候选 | 测试净删除 0 |
