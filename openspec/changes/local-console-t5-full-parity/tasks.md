# 任务：local-console-t5-full-parity

## 执行清单

- [ ] 方案与 OpenSpec delta 校验
  - [ ] 保持 delta 位于 `openspec/changes/local-console-t5-full-parity/specs/local-console/spec.md` 与 `specs/console-ui/spec.md`。
  - [ ] 不新增 `openspec/changes/local-console-t5-full-parity/specs/github-issue-runner/spec.md`，`github-issue-runner` 只作为 MUST 矩阵事实源。
  - [ ] 用 local-console delta 修改现有 T5-only 禁止边界，确保归档后不同时保留同一能力的 MUST 与 MUST NOT 冲突。
  - [x] 运行 `pnpm exec openspec validate local-console-t5-full-parity --strict` 并保持退出码 0。
- [ ] 建立本地对等状态模型
  - [ ] 为 local sessions 增加 `parent_session_id` 与 child session 查询。
  - [ ] 建立 local role thread store，按 session + role 维护 thread id 与 last seen message id。
  - [ ] 建立 local ledger projection / acceptance fact / integration event / route decision / dead-letter / workspace diff 持久化。
  - [ ] 保证所有 visible local side effects 与对应状态写入在同一事务内完成或整体失败。
- [ ] 接入本地 CEO guardrail 与 no-mention 兜底
  - [ ] 在 local agent response 写入前调用 CEO guardrail，支持 no_change / append / fail-open。
  - [ ] 将 CEO append 写为 local CEO message，并交给下一轮 session drain 触发目标 agent。
  - [ ] 为 user no-mention 和 child agent no-mention 建立 CEO route judgment、去重和 fail-open 记录。
  - [ ] 覆盖 append 发布失败不推进 cursor、不保存成功 route decision。
  - [x] Issue #111：新增 runtime-local route bus，claim 后先复用 mention trigger；只有 no-trigger source 进入 local no-mention route。
  - [x] Issue #111：为 local user message 建立 `local-message:<id>` route key，并把 route decision 写入 `.state/local-console.sqlite` 的 `local_route_decisions`，不写 GitHub intake state。
  - [x] Issue #111：CEO route append 必须校验代码区域外恰好一个合法 agent mention；明确交棒消息遇到非法 append 时保持 retryable，或写不含合法 agent mention 的 visible local failure/dead-letter 后才完成。
  - [x] Issue #111：append 成功时在同一 SQLite transaction 内写 visible local CEO handoff、保存 append decision、完成源 message；下一轮 drain 再由 mention trigger 唤醒目标角色。
  - [x] Issue #111：append visible write 或 transaction 失败时释放源 message 供 retry，不推进 cursor、不保存成功 append decision。
  - [x] Issue #111：非法 append validation failure 不保存 successful append decision、不直接运行任何目标角色，并记录可诊断 reason。
- [ ] 实现子会话编排
  - [ ] 将 CEO spawn child issue executor 抽象为 issue/session 两套 sink，共享校验和 orchestration key。
  - [ ] `goal_intake.confirm` 在本地创建或找回 phase-one child sessions。
  - [ ] 写入 child session refs、parent progress events 与 bounded failure details。
  - [ ] 保证重试不重复创建 child session，部分成功不删除补偿。
- [ ] 实现本地验收 pre-pass 与集成回流
  - [ ] 在普通 trigger 前解析验收角色走查评论。
  - [ ] 写 child acceptance facts，并在全部 in-scope child passed 后创建 parent integration request。
  - [ ] 对 integration acceptance failure 创建或找回 repair child session。
  - [ ] 对整体通过但逐条走查不可解析的评论发 visible format reminder，单 session 封顶。
  - [ ] 对 missing child closed/archived but no pass fact 写 blocked report。
- [ ] 实现 dead-letter 与恢复
  - [ ] 为 local message 处理失败维护 failure count、last reason、next retry。
  - [ ] 达预算后写 visible dead-letter system record，不含合法 agent mention。
  - [ ] 新消息或相关子会话状态变化后可恢复处理，不重放已 dead-lettered 消息。
- [x] 补齐 worktree 三点对等
  - [x] Issue #115：worktree mode 下为 session 从目标 base 创建/复用稳定 local branch，Codex cwd 指向 temporary worktree。
  - [x] Issue #115：记录 original repo root、base ref、branch name、worktree path、run id、patch path、affected files summary 与 diff status。
  - [x] Issue #115：只在 local agent 输出合法 `code-verified` stage 后生成 diff bundle；`in-progress` / `plan-written` 不生成可回流 bundle。
  - [x] Issue #115：diff 生成前验证原目录 `git status --short` 为空；非空时写 visible local error，不继续自动回流。
  - [x] Issue #115：显式回流时有界 `git apply --check` + apply 到原目录；成功后 status 变为 `applied`，原目录只出现 patch 预期改动。
  - [x] Issue #115：回流失败或挂起时保留 patch、写 visible local error、释放 session，且不 reset/delete 原目录。
  - [x] Issue #115：放弃 generated diff 只更新 status 为 `abandoned`，不触碰原目录、不删除 worktree、不破坏后续同 session 重跑。
  - [x] Issue #115：已 applied diff 的回滚使用同一 patch 做 bounded reverse check + reverse apply，成功后原目录重新洁净，失败时保留 patch 并写 visible local error。
  - [x] Issue #115：对照 `src/agent-prescripts/issue-worktree.ts` 写 parity 证明，确认本地开分支、cwd 指向 worktree、回流前原目录洁净三点对等，且不改变 GitHub issue-worktree 行为。
- [ ] 扩展桌面操作台 UI
  - [ ] 侧栏渲染 project -> parent session -> child session 树。
  - [ ] 父会话渲染子会话进展流和 blocked/dead-letter/recovery 状态。
  - [ ] 集成 `AcceptCard` 到真实验收提交流，输出协议合规文本。
  - [ ] 渲染 worktree diff bundle、回流按钮、apply result 和错误。
  - [ ] 保持窄视口无文本重叠，侧栏树可扫描。
- [ ] 补齐测试与验收脚本
  - [ ] 增加 local store migration / transaction / idempotency 单元测试。
  - [ ] 增加 local guardrail、no-mention route、agent-authored route 测试。
  - [x] Issue #111：增加“本地无 mention 明确交棒 → CEO append 单 mention → 下一轮唤醒目标角色”的单元 / runtime 测试。
  - [x] Issue #111：增加“重复处理同一无 mention message → 不重复 CEO judgment / 不重复 append / 不重复唤醒”的防重测试。
  - [x] Issue #111：增加“local route append 可见写失败 → cursor 不推进、append decision 不保存、retry 可重入”的 S1/V1 测试。
  - [x] Issue #111：增加“CEO route judgment 返回多 mention append body → 拒绝 append、不直接运行 agent、不保存 successful append decision、源消息 retry 或可见失败后完成”的 S1/V1 测试。
  - [x] Issue #111：增加“CEO route judgment 返回无合法 mention append body → 不静默完成明确交棒消息，且 GitHub intake fallback route ledger 不出现 local route decision”的 S1/V1 测试。
  - [x] Issue #111：复跑 `tests/github-response-intake.test.ts`，证明本地 route bus 不污染 GitHub intake fallback route ledger。
  - [ ] 增加 local CEO route judgment 永久挂起的 L1 故障注入，验证超时释放 session drain 且不保存成功 route decision。
  - [ ] 增加 child session orchestration、goal-intake confirm、repair child 测试。
  - [ ] 增加 acceptance pre-pass、integration request、format reminder、blocked report 测试。
  - [ ] 增加 CEO append visible write failure 的 S1/V1 故障注入，验证 cursor 不推进、成功 route decision 不保存、后续 retry 可重入。
  - [ ] 增加 acceptance fact 成功但 parent integration request visible write failure 的 S1/V1 故障注入，验证不消费同消息 handoff、不记录 completed integration request。
  - [ ] 增加 dead-letter retry/recovery 测试。
  - [ ] 增加 visible dead-letter write failure 的 S1/V1 故障注入，验证 cursor 不推进且可 retry。
  - [x] 增加 worktree branch/diff/apply/no-pollution 测试。
  - [x] 增加 diff apply 冲突或永久挂起的 L1 故障注入，验证超时写 visible error、保留 patch、释放 session、原目录不半写脏。
  - [x] Issue #115：增加 `worktree-return-rollback` 验收 case，证明显式回流后只出现预期 diff，reverse rollback 后原目录洁净。
  - [x] Issue #115：增加 `worktree-abandon` 验收 case，证明放弃 generated diff 不触碰原目录、不删除 worktree、不破坏后续重跑。
  - [x] Issue #115：增加 `worktree-issue-parity` 验收 case，证明 local workspace source 与 issue-worktree 在开分支、cwd、原目录洁净三点对等，且 GitHub issue-worktree tests 保持通过。
  - [ ] 增加 console-ui child tree、acceptance submit、dead-letter、diff 回流测试。
  - [ ] 新增 `scripts/acceptance/local-console-t5.ts`，支持 `multi-child-goal`、`route-hang-l1`、`visible-write-s1-v1`、`acceptance-integration-s1-v1`、`worktree-diff`、`diff-apply-failure-l1`、`dead-letter-recovery`、`dead-letter-write-failure-s1-v1`、`fake-gh-zero` case，并生成 `artifacts/acceptance/t5-evidence.json` 和必要截图。
- [ ] 验收与收尾
  - [x] 修正 `scripts/acceptance/local-console-t5.ts` 的 `must-matrix` statement，使 564 / 475 计数从当前 `openspec/specs/github-issue-runner/spec.md` 动态计算，且不再出现 552 / 463。
  - [x] 修正 `roadmap-evidence` case，使其读取 `docs/roadmap/milestone-4-local-console.md` 并断言 T5 `[x]`、`artifacts/acceptance/t5-evidence.json`、全量 case、MUST 矩阵、`pnpm test` / `pnpm typecheck` 退出码与 T6/M3 非目标说明。
  - [x] 修正 `pr-evidence` case，使其校验真实 PR body draft 中的 `Closes #109`、`Closes #116`、T5 evidence 路径、MUST 矩阵路径与测试/typecheck 摘要，不再检查 `Closes #...` 占位符。
  - [x] 修正 fake `gh` 零调用 case，使其覆盖提交前全量本地 acceptance 入口，而不只覆盖 `worktree-diff`。
  - [x] 运行 `pnpm exec tsx scripts/acceptance/local-console-t5.ts --case all`，重新生成 `artifacts/acceptance/t5-evidence.json`，且 `selectedCase` 为 `all`。
  - [x] 使用 fake `gh` 前置 PATH 跑 T5 全量本地 acceptance，确认 fake `gh` 调用次数为 0。
  - [x] 运行 `pnpm test`，确认 GitHub 模式相关测试无回归。
  - [x] 运行 `pnpm typecheck`。
  - [x] 运行 `pnpm --filter @moebius/desktop build`。
  - [x] 运行 `pnpm --filter @moebius/console-ui test`。
  - [x] 运行 `git diff --check`。
  - [x] 更新 `docs/roadmap/milestone-4-local-console.md`，勾选 T5 `[x]`，记录全量验收证据、MUST 矩阵路径、测试/typecheck 退出码，并明确 T6 flag 与 M3 A-K 不在 T5。
  - [x] 生成 PR body draft，内容包含 `Closes #109`、`Closes #116`、T5 evidence 路径、MUST 矩阵路径和测试/typecheck 结果摘要，并用 `pr-evidence` case 校验 draft。
  - [x] push/PR 前运行 `git fetch origin main` 与 `git merge-base --is-ancestor origin/main HEAD`；若失败，停止收尾，同步最新 main 后重跑 T5 evidence 与回归命令。
  - [ ] git add -A 后提交；commit message/body 含 `Closes #116`。
  - [ ] push 当前 issue 分支并创建 base `main` 的 PR；PR body 包含 `Closes #109`、`Closes #116`、T5 证据、MUST 矩阵路径和测试/typecheck 结果摘要。
  - [ ] PR 创建后运行 `gh pr view <PR_URL> --json baseRefName,body,state`，确认 `baseRefName` 为 `main`，body 含 `Closes #109`、`Closes #116`、T5 evidence 路径、MUST 矩阵路径与测试/typecheck 结果摘要。

## MUST 矩阵索引
说明：完整分类与处理说明见 `proposal.md` 的「MUST 矩阵」。本节保留同一组源行映射，便于直接在任务文件中核对验收。矩阵覆盖 `openspec/specs/github-issue-runner/spec.md` 中全部 564 行包含字面量 `MUST` 的源行；只统计项目符号 `- MUST` 的 475 行不是本任务验收口径。

| 源 | 分类 | 执行任务 |
| --- | --- | --- |
| GIR:L9-L25 | 不在 T5 范围 | 不做 GitHub polling/config。 |
| GIR:L26 | 本任务补齐 | dead-letter / visible cursor boundary。 |
| GIR:L27-L38 | 不在 T5 范围 | 不做 GitHub issue state/window。 |
| GIR:L39-L41 | 本任务补齐 | local failure budget 状态。 |
| GIR:L42-L47 | 本任务补齐 | user no-mention route。 |
| GIR:L48-L53 | 不在 T5 范围 | 不重构 GitHub runner 模块。 |
| GIR:L54-L56 | 本任务补齐 | local visible boundary transaction。 |
| GIR:L57-L60 | 本任务补齐 | local dead-letter record / no self trigger。 |
| GIR:L61-L74 | 已对等 | T4/T4.5 local drain 与 session concurrency。 |
| GIR:L75 | 已对等 | T4.5 local cursor/restart catch-up，不依赖执行中标记。 |
| GIR:L76-L78 | 不在 T5 范围 | GitHub issue not-found/closed only。 |
| GIR:L79 | 本任务补齐 | local failure folding。 |
| GIR:L80-L86 | 不在 T5 范围 | GitHub CLI only。 |
| GIR:L87-L89 | 本任务补齐 | local first visible result boundary。 |
| GIR:L90-L96 | 已对等 | shared Codex watchdog。 |
| GIR:L97-L113 | 已对等 | shared agent discovery / trigger / protocol；T5 UI 只生成合规输入。 |
| GIR:L114-L141 | 本任务补齐 | local CEO guardrail stage route。 |
| GIR:L142-L147 | 已对等 | shared timeline/trigger/preScript registry baseline。 |
| GIR:L148-L153 | 不在 T5 范围 | GitHub reaction only。 |
| GIR:L154-L165 | 不在 T5 范围 | GitHub issue media only。 |
| GIR:L166-L168 | 已对等 | frontmatter/workspace_access baseline。 |
| GIR:L169-L186 | 本任务补齐 | local branch / diff return / clean original。 |
| GIR:L187-L189 | 已对等 | T4 local interruption。 |
| GIR:L190-L203 | 本任务补齐 | local role threads and resume。 |
| GIR:L204-L223 | 本任务补齐 | local artifacts/evidence manifest。 |
| GIR:L224-L247 | 不在 T5 范围 | observer only。 |
| GIR:L248-L263 | 本任务补齐 | local acceptance card protocol submit。 |
| GIR:L264-L292 | 已对等 | shared persona / qa / invariants。 |
| GIR:L293-L327 | 本任务补齐 | local CEO guardrail / CEO agent parity。 |
| GIR:L328 | 不在 T5 范围 | T5 不新增 driver agent；未来 agent 白名单维护不进本任务。 |
| GIR:L329-L335 | 本任务补齐 | local agent writeback / guardrail fail-open / role-thread boundary。 |
| GIR:L336-L386 | 不在 T5 范围 | roundtable / M4 T6 flag out of T5。 |
| GIR:L449-L462 | 已对等 | shared security and spawn constraints。 |
| GIR:L466-L472 | 本任务补齐 | local handoff/wait rendering and validation。 |
| GIR:L473-L500 | 已对等 | shared T7 guardrail scenarios reused by local visible sink。 |
| GIR:L501-L1716 | 已对等 | scenarios inherit mapped rules; local acceptance covers T5-relevant subset。 |
| GIR:L1722-L1760 | 不在 T5 范围 | observer ledger UI only。 |
| GIR:L1847-L1894 | 本任务补齐 | CEO child issue -> child session executor。 |
| GIR:L2027-L2061 | 本任务补齐 | local acceptance pre-pass / integration / repair。 |
| GIR:L2143-L2179 | 本任务补齐 | local goal-intake runtime to child sessions。 |
| GIR:L2272-L2292 | 本任务补齐 | local agent-authored no-mention route。 |
| GIR:L2303-L2323 | 本任务补齐 | T5 tests/typecheck/roadmap/PR evidence。 |
| LC:T4.5 | 已对等 | handoff drain / cursor / restart catch-up。 |
| LC:T4.6 | 已对等 | project/workspace source / worktree on-off。 |
| LC:spec L48-L50 | 本任务补齐 | replace T5 prohibition with positive T5 rules through current `specs/local-console/spec.md` delta。 |

---

## 30 批处置（阻塞：待重写）

本 change 以 `github-issue-runner` spec 作为 full-parity 的 MUST 矩阵事实源，而该 spec 已于 `four-layer-30-github-runner` 退役删除。**"parity" 已无对照物，本 change 不能按原样继续实施。**

处置：目录保留、不作废、不归档。其中 9 条未完成任务描述的是本地能力本身（而非对 GitHub 的对等），是否仍需要属于产品范围决定，需由需求方确认后**以 `local-console` spec 为事实源重写**，而不是继续对照一个已不存在的域。已完成的 1 项 local 事实保持有效。
