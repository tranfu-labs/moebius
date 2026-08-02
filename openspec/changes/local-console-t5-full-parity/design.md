# 设计：local-console-t5-full-parity

## 设计目标
T5 不把 GitHub issue 机械搬到本地，而是保持核心规则对等、外观与留痕本地化：

- issue timeline → `session_messages`
- child issue → child session with `parent_session_id`
- issue comments / role envelope → local timeline records with role metadata
- intake state / route ledger → SQLite cursor + route decisions
- dead-letter comment → local visible system record
- release artifact URL → local evidence/run artifact references
- issue worktree branch delivery → local temporary worktree branch + diff bundle + explicit apply-back

核心共享模块继续复用 `conversation`、`triggers`、`codex`、CEO persona、goal-ledger 纯业务规则和 acceptance parser；本 change 只加 local adapter 和本地持久化投影。

OpenSpec delta 只落在 `openspec/changes/local-console-t5-full-parity/specs/local-console/spec.md` 与 `specs/console-ui/spec.md`。`github-issue-runner` 是对等性矩阵的事实源，不作为本 change 的 delta 目标。

## 数据模型

在 `.state/local-console.sqlite` 增加或扩展下列事实：

- `sessions.parent_session_id`：child session 树。父会话可有多个 child，repair child 也挂在原 parent 或 failed child 下。
- `local_role_threads(session_id, role, thread_id, last_seen_message_id, updated_at)`：local per-role resume。
- `local_goal_ledger` 或等价 typed tables：保存 goal/milestone/task/phase projection、child session refs、acceptance facts、integration events、run/evidence refs。实现阶段可选择 typed tables 或 JSON column，但必须保证事务边界与查询能力。
- `local_route_decisions(session_id, message_id, route_key, outcome, target_role, reason, created_at)`：user/agent no-mention 兜底去重，不保存完整消息正文。
- `local_dead_letters(session_id, message_id, failure_count, reason, created_at, recovered_at)`：visible failure source。
- `local_workspace_diffs(session_id, run_id, base_ref, branch_name, worktree_path, patch_path, status, applied_at)`：worktree 三点对等证据。

所有本地 visible side effects 使用一个 store transaction 写入，避免“消息可见但状态未写”或“状态成功但消息不可见”。

## 本地 CEO 与路由

本地 runtime 在 agent response 写入前执行和 GitHub sink 等价的 CEO guardrail：

1. 组装完整 local public session context：session 标识、父子关系、全部 visible messages、latestResponse、agent、allowedStages。
2. 调用 CEO guardrail，失败时 fail-open 写原 agent response。
3. `no_change` 写原 response；`append` 先写原 response，再写一条 local CEO message；`replace` 保留代码层能力但 persona 仍默认不用。
4. CEO append 若包含合法 mention，不在同一处理步骤直接运行目标 agent，而是让 session drain 下一轮按时间线触发。

no-mention 兜底使用同样两步：

- user message 或 child session agent message 无合法 mention 且符合目标/验收/交棒形状时，调用 CEO route judgment。
- append 成功写入 local CEO message 后推进 cursor；写入失败保持 retry。
- 已有 route decision 的 message 不重复调用 CEO。

### Issue #111：本地交棒总线切片

实现先落在 local-console 边界内，形态上是一个 runtime-local route bus：

1. `processPending()` claim 到 pending message 后先构造 local timeline，继续用共享 `resolveTrigger()` 检查最新消息。
2. 若 mention trigger 命中，沿现有 Codex 路径运行，不经过 no-mention route bus。
3. 若没有合法 mention，调用本地 `maybeRouteLocalNoMentionMessage()`。它只接收 local session/message/timeline/agent list、local route store API、CEO route judgment adapter 和日志函数；不得依赖 `src/runner/external-route.ts` 或 GitHub issue/intake 类型。
4. route bus 对 user message 与 child-session agent message 使用不同 route key 前缀，例如 `local-message:<id>` 与 `local-child-agent:<id>`；首批 #111 实现 user message，接口保留 child agent route 的 source kind。
5. route bus 先查 `local_route_decisions`。已有记录时直接把源 message 标记为 processed 或维持既有状态，不再次调用 CEO、不再次写 handoff。
6. CEO route judgment 返回 `append` 时，先校验正文：非空、代码区域外恰好一个合法 agent mention、mention 在 available agents 中。校验通过后，在一个 SQLite transaction 内写入 visible local CEO message、写入 append route decision、完成源 message。
7. append body 校验失败时按源消息意图分流：对“明确交棒”的 local message，非法 append 不是可接受的 no-action，不能静默完成源 message；runtime 必须释放源 message 供 retry，或写一条不含合法 agent mention 的 visible local failure / dead-letter 并记录非 successful append outcome 后才完成。对无法判定交棒意图的普通 no-trigger message，可记录 `fail_open` / `no_action` 并完成，但必须留下可诊断 reason。
8. append 写入成功后不在同一 loop 直接调用目标 agent。因为 visible CEO message 是新的 pending/displayed trigger source，下一轮 drain 重新 claim/resolve，沿已有 mention trigger 唤醒目标角色。
9. append visible write 或 route decision transaction 失败时，源 message 通过 `releaseMessageForRetry()` 回到 retryable 状态；不得保存成功 append decision，也不得推进 cursor。

CEO route judgment adapter 复用现有 CEO persona 规则，但 prompt 要本地化：输入是 local session context 与 latest local message，不包含 GitHub issue/comment/reaction 语义；输出仍限定为 `no_action` 或 `append`，append body 必须满足单 mention 约束。为了避免污染 GitHub 模式，本地 adapter 可以复用 `parseExternalCommentRouteOutput()` / append-body 校验这类纯函数，但不得复用发布 GitHub comment 的 runner module。

本切片不处理 child session 编排、验收 pre-pass、dead-letter 完整预算和 worktree diff 回流；这些仍留在同一个 T5 change 的后续任务里。#111 只要求本地无 mention handoff 的可见追加、下一轮触发、防重和 GitHub intake 测试不回退。

## 子会话编排

CEO `spawn_child_issues` 和 `goal_intake.confirm` 在本地映射为 child session executor：

- 校验 workflow id、ledger task id、quality baseline、acceptance statements、dependencies、initial role、provenance、conflict group。
- child session title/body 从受控 template 渲染；body 首条消息包含 parent reference、task id、质量基准、验收语句、依赖、initial handoff、provenance、hidden orchestration key。
- orchestration key 由 parent session id + workflow id + ledger task id 派生，不含自由文本。
- retry 时先查 ledger child session ref，再按 hidden key 查 local messages；唯一命中则补写 ledger，不重复创建。
- 父会话写一条进展 system event，链接到 child session；子会话后续验收和 repair 事件再回流父会话。

## 验收 pre-pass

local runtime 在普通 trigger 前执行 acceptance pre-pass：

- child session 中，product-manager/hermes-user 的结构化验收走查覆盖全部 formal acceptance statements 且整体通过时，写 task acceptance fact。
- 走查格式不可解析但声明整体通过时，写 visible format reminder，本地 cap 两次。
- 全部 in-scope child passed 后，在 parent session 写 integration acceptance request，使用 active phase projection 的目标级验收语句。
- integration acceptance 不通过时创建/找回 repair child session；repair 通过后 rejoin parent。
- missing child session 若被手动关闭/归档但无 pass fact，父会话写 blocked report。

UI 的验收卡片调用同一 formatter，生成：

```text
1. 通过 — 依据
2. 不通过 — 依据
验收结论：通过/不通过
```

用户仍可手写消息，但 UI 生成路径必须默认合规。

## Dead-letter 与恢复

本地失败预算沿用 GitHub 语义，但本地化表达：

- 单条 message 处理失败不推进 cursor，记录 `failureCount` 和 `lastFailureReason`，保持 session 可见 active/retry 状态。
- 达预算后写 visible dead-letter system record，推进 cursor 到 dead-lettered，避免同一坏消息刷屏。
- dead-letter record 不含合法 agent mention，不自触发。
- 用户在同 session 追加新消息、或相关 repair/child session 状态变化后，runtime 可从新消息继续处理；旧 dead-letter 只作为可见历史。

## Worktree 三点对等

T4.6 已能把 Codex cwd 指向 temporary local worktree。T5 补齐交付语义：

1. **开分支**：worktree mode enabled 且 folder 是 git repo 时，resolver 为 session 创建/复用稳定 local branch，例如 `moebius/local/<project-slug>/<session-slug>`，base 为打开 project 时或 run 开始时记录的 original `HEAD`。实现必须记录原始 repo root、base ref、branch name、worktree path 和 run id。复用 worktree 时必须校验当前 cwd 仍是合法 worktree，branch/base 缺失时写 visible local error，不伪装为 direct mode 成功。
2. **不污染原目录**：Codex cwd 始终在 temporary worktree；回流前原目录不写文件、不 checkout、不 merge、不 rebase。run 完成后先检查原目录 `git status --short`，若非空则 diff 状态标为 failed 并写 visible local error，不能继续自动回流。
3. **diff 生成**：只有 local agent 输出合法 `code-verified` stage 后生成 patch/diff bundle 和 affected files summary。patch 使用 bounded `git diff --binary <baseRef> --`，保存到 runDir 内并记录到 `local_workspace_diffs`。`in-progress` / `plan-written` 只保留 worktree 修改，不生成可回流 bundle，避免把未验收方案或中间态误发布为交付 diff。
4. **显式回流**：用户显式触发回流时，runtime/API 先在原始 repo root 执行 bounded `git apply --check <patch>`，再执行 bounded apply。成功后 diff status 更新为 `applied`，并记录原目录 `git status --short` 作为预期改动证据。回流失败写 visible local error，status 变为 `failed`，patch 继续保留；不得用 `git reset`、删除原目录或重建 worktree 做补偿。
5. **放弃与回滚**：放弃 generated diff 只把 status 更新为 `abandoned`，不删除 patch、不删除 worktree、不触碰原目录。对已 applied diff，回滚必须用同一 patch 做 bounded reverse check + reverse apply，成功后 status 更新为 `rolled_back` 并证明原目录重新洁净；reverse 失败时保留 patch、写 visible local error，原目录不得被 reset/delete。
6. **issue-worktree 对照**：`src/agent-prescripts/issue-worktree.ts` 仍负责 GitHub issue worktree：从 freshly fetched `origin/main` 创建 issue branch，复用时只刷新/检测 main freshness，不自动 merge/rebase/recreate。local worktree parity 只对齐“隔离 branch + Codex cwd 指向 worktree + 原目录不被 run 污染”三点；不引入 GitHub clone/fetch/mainStatus 到 local folder resolver，也不把 local diff 回流行为写入 issue-worktree。

所有 git 操作有 timeout，失败释放 session，且不调用 `gh`。

## 测试策略

- 单元测试：store migration、route decision dedupe、child session idempotency、acceptance parser/pre-pass、dead-letter retry budget、role thread resume、workspace diff generation/apply。
- L1 故障注入：local CEO route judgment 永久挂起必须在配置超时内释放 session drain，且 diff apply 冲突或挂起必须写 visible local error、保留 patch、释放 session、保持原目录不半写脏。
- S1/V1 故障注入：CEO append visible write failure 必须保持 cursor 不推进且不保存成功 route decision；acceptance fact 成功但 parent integration request visible write failure 必须不消费同消息 handoff 且不记录 completed integration request；visible dead-letter write failure 必须不推进 cursor 且可 retry。
- UI 测试：子会话树、父会话进展、验收卡片协议输出、dead-letter 状态、diff 回流按钮。
- 验收脚本：`scripts/acceptance/local-console-t5.ts` 用 fake Codex/fake git/fake gh 覆盖本地多子任务目标、worktree 三点、dead-letter 恢复、L1/S1/V1 故障注入和 fake `gh` 零调用，并输出 `artifacts/acceptance/t5-evidence.json` 和必要截图。
- 回归：`pnpm test`、`pnpm typecheck`、desktop build、console-ui test、`git diff --check`。

## 风险与取舍

- 不在 T5 做 T6 互斥启动 flag。T5 实现仍可以在当前默认 local console server/desktop 入口下验收；启动模式切换由 T6 收尾。
- 不承接 M3 A-K。那些是 runner 稳定性/编排 track，不能混进本地化终点线。
- 不把 GitHub observer 搬到本地操作台。T5 的用户入口是 console；observer 保持只读诊断。
- 不默认把 worktree diff 自动写回原目录。自动回流会破坏“不污染原目录”；必须显式触发。
