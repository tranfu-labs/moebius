# 提案：local-console-t5-full-parity

## Why
M4 T5 是本地对话操作台的终点线：拿 `github-issue-runner` spec 的 MUST 清单逐条核对，把 GitHub issue 模式的协作能力在本地落成原生形态。T4.5 已打通本地时间线接力总线，T4.6 已建立本地 project/workspace source；T5 不重做这两块，而是在它们之上补齐全功能对等。

需求持有者已确认边界：

- 事实源以 `docs/roadmap/milestone-4-local-console.md`、`openspec/specs/github-issue-runner/spec.md`、现有本地 console/runtime 基座为准。
- T4.5/T4.6 已验收内容只作为现有基座与“已对等”证据，不扩大 T5 scope。
- MUST 矩阵分类固定为 `已对等`、`本任务补齐`、`不在 T5 范围`；备注列可说明证据或风险。
- T5 的 worktree 三点对等是“开分支、diff 回流、不污染原目录”。GitHub issue-worktree 的创建/复用、跨 role 共享、remote main 前进只检测不自动合并/重建也纳入矩阵，但不作为 T5 shorthand 的三点。
- T6 互斥启动 flag 与 M3 遗留卡点 A-K 不在 T5 范围。

## What Changes
本 change 规划一个 production 级 T5 实现，分六个能力面落地：

1. **本地目标/会话账本桥**：让本地 session 成为 issue 的本地等价物，SQLite 承载 role thread、目标账本投影、child session references、acceptance facts、integration events 与 visible recovery records；保留现有 `session_messages` 作为时间线事实源。
2. **本地 CEO 路由与 no-mention 兜底**：把 GitHub 的外部无 mention 兜底与 agent-authored child 兜底落到本地时间线，采用“先写本地 CEO handoff 消息，下一轮 drain 再触发目标 agent”的两步语义。
3. **子会话编排**：把 CEO 的“开子 issue”改成本地“开子会话”，写入 `sessions.parent_session_id`，用稳定 orchestration key 去重/恢复，父会话只显示进展事件，不复制子会话全文。
4. **验收走查与集成回流**：在本地普通 mention trigger 前增加 acceptance pre-pass；解析 product-manager/hermes-user 的结构化走查，写 child acceptance fact，全部子任务通过后在父会话发起目标级集成验收，不通过时创建/找回 repair child session。
5. **dead-letter 与恢复**：把 GitHub 失败预算/死信评论变成本地 visible dead-letter system record；恢复入口是在同 session 追加新消息或子会话状态恢复后重新进入 drain，不静默吞任务。
6. **worktree 三点对等**：在 T4.6 temporary worktree 基础上补齐本地分支、diff 回流与原目录洁净保证。worktree 开启时 dev 修改先进入临时 worktree 的本地分支；code-verified 后生成可审计 diff bundle；用户显式回流时把 diff apply 到原目录，回流前原目录保持 `git status --short` 为空。

OpenSpec delta 使用当前 CLI 识别的 `openspec/changes/local-console-t5-full-parity/specs/<capability>/spec.md` 形态，且只修改 `local-console` 与 `console-ui` 业务域。`github-issue-runner` spec 作为 MUST 矩阵事实源，不在本 change 中新增或修改 delta，避免把本地 T5 行为写进 GitHub runner 边界。

### T5 routing-bus implementation slice
Issue #111 先实现其中的“本地交棒总线 + CEO 无 mention 兜底路由”切片，不新建平行 OpenSpec change。该切片建立本地通道与 GitHub mention trigger 对等的最小闭环：

1. **本地 route sink**：新增 runtime-local 路由协调模块，把 GitHub external route 的 `no_action` / `append` / `fail_open` 结果映射到 `session_messages` 与 `local_route_decisions`，但不 import GitHub runner side-effect modules。
2. **无 mention CEO 兜底**：当最新 pending local user message 没有合法 agent mention、且呈现明确交棒或目标形状时，调用 CEO route judgment；append 只写一条 visible local CEO message，目标 agent 由下一轮 drain 通过既有 mention trigger 唤醒。
3. **单 mention 约束**：本地 route append 的正文必须在代码区域外包含且只包含一个合法 agent mention；不合规 append 对明确交棒消息不能静默完成，必须保持 retryable，或先写一条不含合法 agent mention 的 visible local failure / dead-letter 后才完成。
4. **防重与可见边界**：同一 local message id / route key 只记录一次 route decision；append 可见消息写入失败时不推进 cursor、不保存成功 append decision，后续 retry 可重入且不会污染 GitHub intake state。
5. **GitHub 模式隔离**：所有新状态落在 `.state/local-console.sqlite`；不修改 `github-response-intake` 的 external route ledger，不改 `format-ceo` 的 GitHub prompt 契约，不改变 GitHub issue runner 的 comment / reaction / artifact 行为。

QA 方案审查指出的 S1/V1 修正已纳入本切片：CEO route judgment 返回非法 append body（无 mention、多 mention、unknown mention、mention 只在代码区域内）时，不得把“明确交棒”的源消息当作已处理；实现必须选择“释放重试”或“可见失败 / dead-letter 后完成”的其中一种收敛路径，并证明不会保存 successful append decision、不会直接运行任何目标角色。

### T5 worktree parity implementation slice
Issue #115 推进其中的“本地 worktree 隔离 / 回滚语义与 diff 回流对等”切片，不新建平行 OpenSpec change。该切片只补齐 T4.6 workspace source 在 worktree 开启态下的交付闭环，并明确不改变 GitHub issue-worktree 行为：

1. **开分支对等**：复用 `src/local-console/workspace-source.ts` 的 session 级 temporary worktree 路径，但把目标 base、原始 repo root、稳定 local branch name、worktree path 与 run id 作为本地 workspace diff 事实记录。local branch 从目标 base 创建 / 复用，Codex cwd 必须指向 temporary worktree；原目录在 run 与 diff 生成阶段不 checkout、不 merge、不 rebase、不写文件。
2. **diff 回流对等**：只有 `code-verified` local worktree run 才生成可审计 diff bundle；bundle 使用 base ref 到 worktree branch 的 bounded binary diff，并保存 patch path、affected files summary 与 status。回流必须由显式本地动作触发，先 `git apply --check`，再 bounded apply 到原始 repo root，成功后 status 变为 `applied`。
3. **原目录洁净 / 回滚放弃**：回流前原目录 `git status --short` 必须为空；回流后只允许出现 patch 所描述的预期改动。放弃 diff 只标记 `abandoned`，不触碰原目录；已回流 diff 的回滚只允许用同一 patch 做 bounded reverse apply，成功后原目录回到洁净，失败时保留 patch、写 visible local error，不做 reset/delete 破坏原目录。
4. **GitHub issue-worktree 零漂移**：`src/agent-prescripts/issue-worktree.ts` 的 clone/fetch/main freshness、共享 issue worktree、legacy migration、repo lock 与不自动 merge/rebase 语义保持不变；如需复用代码，只能抽取无 GitHub 语义的 bounded git / path helper。
5. **验收证据**：T5 acceptance 新增或补强 `worktree-diff`、`worktree-return-rollback`、`worktree-abandon`、`worktree-issue-parity` case，证明开分支、diff 回流、原目录洁净三点与 issue-worktree 的隔离语义对等。

### T5 integration evidence delivery slice
Issue #116 是本 change 的最终集成证据与交付收尾切片。需求持有者已确认 T5 前置子任务 #110-#115 已全部合入 `main`；本切片不再扩展 T5 功能范围，只在最新 `main` 基线上完成可核查证据、roadmap 勾选和 PR 交付。

1. **证据 oracle 修正**：先修正 `scripts/acceptance/local-console-t5.ts` 的静态证据缺口：`must-matrix` 的人类可读 statement 必须从当前 `github-issue-runner` spec 动态计算 564 / 475，不再保留 552 / 463；`pr-evidence` 不得依赖 `Closes #...` 占位符；`roadmap-evidence` 必须读取真实 roadmap；fake `gh` 零调用需要覆盖提交前全量本地验收入口，而不是只覆盖 `worktree-diff`。
2. **全量集成证据**：以 `scripts/acceptance/local-console-t5.ts --case all` 作为 T5 本地端到端验收入口，重新生成 `artifacts/acceptance/t5-evidence.json`。证据必须覆盖多子任务目标链路、CEO 兜底路由、`parent_session_id` 子会话树、qa/product-manager 走查与父级集成回流、worktree 开启态 diff 回流对等、dead-letter 降级、MUST 矩阵、真实 roadmap 断言和 PR body draft 断言；最终 evidence 的 `selectedCase` 必须为 `all`。
3. **回归命令**：除 T5 acceptance 外，复跑 `pnpm test` 与 `pnpm typecheck`；若本切片只补证据/文档且不改 UI 逻辑，desktop build 与 console-ui test 可作为额外稳健回归执行并在证据摘要中记录。
4. **roadmap 收尾**：把 T5 从 `[ ]` 改为 `[x]`，在 T5 下追记 `artifacts/acceptance/t5-evidence.json`、全量 case、MUST 矩阵、测试/typecheck 退出码、GitHub 模式无回归，以及 T6 互斥 flag / M3 A-K 仍不在 T5 范围；最终 `roadmap-evidence` case 必须读取该文档并断言这些内容真实存在。
5. **PR 收尾**：提交信息包含 `Closes #116`；提交前生成 PR body draft，写入 `Closes #109` 与 `Closes #116`、T5 evidence、MUST 矩阵路径、测试/typecheck 结果摘要，并由 `pr-evidence` case 校验 draft；创建 PR 后再用 `gh pr view <PR_URL> --json baseRefName,body,state` 核实真实 PR base 为 `main` 且 body 含上述锚点与摘要。
6. **远端 freshness gate**：push/PR 前必须运行 `git fetch origin main` 与 `git merge-base --is-ancestor origin/main HEAD`；若退出码非 0，停止收尾，同步最新 `main` 后重新运行 T5 evidence 与回归命令。

## Impact
受影响模块：

- `src/local-console/runtime.ts`：增加 local guardrail/route/acceptance pre-pass/child session orchestration/dead-letter coordination，保持 session 内串行与不同 session 并行。
- `src/local-console/store.ts`、`src/local-console/types.ts`、`src/sqlite-state.ts`：扩展 SQLite schema 与命令，覆盖 parent session、local role threads、local ledger projection、route decisions、acceptance facts、integration events、dead-letter records、workspace diff metadata。
- `src/local-console/workspace-source.ts`：在现有 temporary worktree resolver 上补齐 branch naming、base ref、diff generation、diff apply/recovery 状态。
- `src/local-console/server.ts` 与 desktop preload/main/renderer：新增 child session API、acceptance submit、diff 回流、dead-letter/recovery 相关端点与 IPC。
- `packages/console-ui/src/console/*`：侧栏渲染子会话树、父会话进展流、验收卡片、dead-letter/recovery 状态、worktree diff 回流操作。
- `tests/local-console.test.ts`、`packages/console-ui` 测试、`desktop/tests/*`、`scripts/acceptance/local-console-t5.ts`：新增 production 级验收覆盖。
- `openspec/changes/local-console-t5-full-parity/specs/local-console/spec.md`：修改现有 T5-only 禁止边界，新增本地 T5 等价运行时规则与故障注入场景。
- `openspec/changes/local-console-t5-full-parity/specs/console-ui/spec.md`：新增 child session tree、验收卡片、dead-letter/diff 回流可视化规则。
- `docs/roadmap/milestone-4-local-console.md`：实现完成后勾选 T5 并记录证据。

对外行为：

- 本地模式：多子任务目标可从本地会话完成 CEO 兜底路由、子会话创建、子会话树渲染、qa/product-manager 验收走查、父级集成验收和 repair 子会话。
- 本地模式：dead-letter 和恢复都留在本地时间线，用户能看到失败原因、累计次数和恢复提示。
- 本地模式：worktree 开启时达到开分支、diff 回流、不污染原目录三点；关闭 worktree 时继续按 T4.6 直接在原目录运行。
- GitHub 模式：不改变 issue intake、comment/reaction、release artifact、issue worktree、driver pool、observer、CEO agent GitHub 编排的既有语义。

## MUST 矩阵
说明：`GIR:Lx-Ly` 指 `openspec/specs/github-issue-runner/spec.md` 的源行；矩阵覆盖该文件所有包含字面量 `MUST` 的 564 行。连续范围可包含非 MUST 行，但只表示该范围内含 `MUST` 的源行具有相同分类；不跨越本分类外的 MUST。只统计项目符号 `- MUST` 会得到 475 行，那个口径不作为本任务验收口径。`LC` 指 `openspec/specs/local-console/spec.md` 与 T4.5/T4.6 change 已落事实。

| 源 | 分类 | T5 处理 |
| --- | --- | --- |
| GIR:L9-L25 | 不在 T5 范围 | GitHub repository config、polling 和 baseline 语义保持 GitHub-only；本地通道已有 SQLite/API 入口，不在 T5 重做。 |
| GIR:L26 | 本任务补齐 | 本地处理游标同样只在 visible local result 后推进；失败进入 retry/dead-letter。 |
| GIR:L27-L38 | 不在 T5 范围 | GitHub issue state、active window、watch repository 上限保持 GitHub-only。 |
| GIR:L39-L41 | 本任务补齐 | 本地失败预算、last failure reason、dead-letter 后清零/恢复。 |
| GIR:L42-L47 | 本任务补齐 | 本地 user no-mention 兜底路由，append 本地 CEO handoff 后由下一轮 drain 触发。 |
| GIR:L48-L53 | 不在 T5 范围 | GitHub runner 模块边界已是既有事实；T5 不重构 GitHub runner。 |
| GIR:L54-L56 | 本任务补齐 | local acceptance/route/repair/dead-letter 可见边界，禁止在可见写失败时保存成功状态。 |
| GIR:L57-L60 | 本任务补齐 | local dead-letter system record、无自触发、恢复提示。 |
| GIR:L61-L74 | 已对等 | T4/T4.5 已有 local session serial、不同 session 独立、store 单写者和 drain；GitHub driver pool/heartbeat不进 T5。 |
| GIR:L75 | 已对等 | T4.5 local cursor/restart catch-up 已按 durable message cursor 恢复，不依赖执行中标记；T5 保持该 crash recovery 边界。 |
| GIR:L76-L78 | 不在 T5 范围 | GitHub issue not-found/closed 处理不映射到本地会话。 |
| GIR:L79 | 本任务补齐 | local workspace/guardrail/Codex/store 失败统一进 retry/dead-letter，不按错误类型吞游标。 |
| GIR:L80-L86 | 不在 T5 范围 | GitHub CLI retry/timeout 是 GitHub adapter 事实；本地不调用 gh。 |
| GIR:L87-L89 | 本任务补齐 | local 首个可见结果边界、死信日志、收尾检查 fail-open 的本地等价。 |
| GIR:L90-L96 | 已对等 | Codex idle/max-duration/watchdog 与 abort 路径已由共享 `codex.ts` 与 T4 local runtime 使用。 |
| GIR:L97-L113 | 已对等 | agent file discovery、mention trigger、协议事实源、验收治理和 stage 枚举是共享规则；T5 只在本地 UI/API 生成合规输入。 |
| GIR:L114-L141 | 本任务补齐 | local agent response 也要经过 CEO guardrail/stage route；`plan-written` 到 qa、`code-verified` 到需求持有者的本地回流。 |
| GIR:L142-L147 | 已对等 | preScript registry、timeline normalize、trigger rules 已由共享 conversation/trigger 模块承载；local timeline 已复用。 |
| GIR:L148-L153 | 不在 T5 范围 | GitHub `eyes` reaction 无本地等价；本地已有运行直播即时态。 |
| GIR:L154-L165 | 不在 T5 范围 | GitHub issue media 下载/校验与 comment 错误路径不是 T5；本地附件另行设计。 |
| GIR:L166-L168 | 已对等 | agent frontmatter/workspace_access 与 GitHub issue workspace 权限是既有事实。 |
| GIR:L169-L186 | 本任务补齐 | local worktree 开启态补齐开分支、diff 回流、不污染原目录；同时矩阵记录 GitHub worktree baseline 约束。 |
| GIR:L187-L189 | 已对等 | T4 已有本地中断按钮和 Codex abort；GitHub 新评论打断仅属 GitHub issue 语义。 |
| GIR:L190-L203 | 本任务补齐 | local role threads 挂 session key，支持 per-role resume/delta prompt，而不是每轮 full prompt。 |
| GIR:L204-L223 | 本任务补齐 | local output artifact/evidence manifest 进入 SQLite/runDir，不走 GitHub release，但保留显式引用、越界拒绝和发布失败可见语义的本地等价。 |
| GIR:L224-L247 | 不在 T5 范围 | observer 是只读诊断事实源，不属于桌面操作台 T5 全功能对等。 |
| GIR:L248-L263 | 本任务补齐 | 本地验收卡片与提交 API 生成严格走查文本，保障需求侧验收治理。 |
| GIR:L264-L292 | 已对等 | dev-manager、secretary、qa persona 与 invariants 是共享事实；T5 不改 persona 职责。 |
| GIR:L293-L327 | 本任务补齐 | 本地 CEO guardrail、普通 CEO agent、规则进化入口与 speaker 归一化在本地 sink 中生效。 |
| GIR:L328 | 不在 T5 范围 | T5 不新增 driver agent；未来扩 agent 时同步 CEO append role 白名单仍是 GitHub runner/guardrail 维护任务。 |
| GIR:L329-L335 | 本任务补齐 | local agent message 写回、role metadata、guardrail fail-open 与 role thread 更新边界。 |
| GIR:L336-L386 | 不在 T5 范围 | `T6 v0 roundtable topology` 是 GitHub 编排 dogfood 主题，不纳入 M4 T5；M4 T6 互斥启动 flag 也不纳入 T5。 |
| GIR:L449-L462 | 已对等 | spawn argv 安全、不信任外部输入、prompt/trigger 纯函数与 token 不落仓库是共享安全约束。 |
| GIR:L466-L472 | 本任务补齐 | 本地 UI/API 必须保留统一输出骨架、合法收尾行、等待/交棒状态展示。 |
| GIR:L473-L500 | 已对等 | T7 guardrail 场景由共享 CEO persona 与 format guardrail 承载；T5 只复用到本地 visible sink。 |
| GIR:L501-L1716 | 已对等 | 场景段继承上述业务规则；T5 验收脚本只复跑与本地等价相关的场景，不重测全部 GitHub-only 场景。 |
| GIR:L1722-L1760 | 不在 T5 范围 | observer ledger UI 是只读诊断，不属于本地操作台 T5。 |
| GIR:L1847-L1894 | 本任务补齐 | CEO spawn child issue 映射为 create/recover child session，失败可见且不重复创建。 |
| GIR:L2027-L2061 | 本任务补齐 | acceptance pre-pass、child pass、parent integration、repair child session 和 blocked report 的本地等价。 |
| GIR:L2143-L2179 | 本任务补齐 | goal-intake interview/propose/confirm 在本地写 pending/active ledger projection，并创建/找回 phase-one child sessions。 |
| GIR:L2272-L2292 | 本任务补齐 | agent-authored no-mention fallback route 在本地 child session 中按 task 状态判定。 |
| GIR:L2303-L2323 | 本任务补齐 | T5 新增本地验收脚本、测试、typecheck、roadmap 勾选与 PR 收尾证据；GitHub 启动环境要求不进本地模式。 |
| LC:T4.5 | 已对等 | 本地 agent handoff drain、cursor、restart catch-up、无 1s poll 已验收。 |
| LC:T4.6 | 已对等 | 本地 project、folder workspace、worktree on/off、非 git 降级、fake gh 零调用已验收。 |
| LC:spec L48-L50 | 本任务补齐 | 当前 local-console spec 明确禁止 T5-only 能力；本 change 的 `specs/local-console/spec.md` 将把这些边界升级为 T5 正式行为。 |

## 验收语句
1. 跑 `pnpm exec openspec validate local-console-t5-full-parity --strict` → 应退出码 0。
2. 查看 `openspec/changes/local-console-t5-full-parity/proposal.md` 与 `tasks.md` → 应看到 `openspec/specs/github-issue-runner/spec.md` 中全部 564 行包含 `MUST` 的源行逐条映射为 `已对等`、`本任务补齐`、`不在 T5 范围`，并说明项目符号 `- MUST` 的 475 行统计不是本任务验收口径。
3. 查看 `openspec/changes/local-console-t5-full-parity/specs/local-console/spec.md` 与 `specs/console-ui/spec.md` → 应看到当前 OpenSpec CLI 识别的 `specs/<capability>/spec.md` delta，且没有 `specs/github-issue-runner/spec.md` delta。
4. 查看 `openspec/changes/local-console-t5-full-parity/specs/local-console/spec.md` → 应看到 delta 明确修改现有 T5-only 禁止规则；归档后不得同时存在要求 T5 local equivalents 的 MUST 与禁止同一能力的 MUST NOT。
5. 跑 `pnpm exec tsx scripts/acceptance/local-console-t5.ts --case multi-child-goal` → 应输出本地多子任务目标从 CEO 兜底路由到子会话创建、子会话树渲染、qa/product-manager 验收走查、父级集成验收、repair child、agent-authored no-mention、closed task no_action 的通过证据。
6. 跑 `pnpm exec tsx scripts/acceptance/local-console-t5.ts --case route-hang-l1` → 应输出注入 local CEO route judgment 永久挂起后，系统在配置超时内 fail-open 或 retry/dead-letter，并释放 session drain。
7. 跑 `pnpm exec tsx scripts/acceptance/local-console-t5.ts --case visible-write-s1-v1` → 应输出注入 CEO append 可见消息写入失败后 cursor 不推进、成功 route decision 不保存，后续 retry 可重入。
8. 跑 `pnpm exec tsx scripts/acceptance/local-console-t5.ts --case acceptance-integration-s1-v1` → 应输出注入 acceptance fact 写入成功但 parent integration request 可见写入失败后，不消费同消息 handoff，且不记录已完成集成请求。
9. 跑 `pnpm exec tsx scripts/acceptance/local-console-t5.ts --case worktree-diff` → 应输出 worktree 开启态下开分支、生成 diff bundle、显式回流后原目录出现预期 diff、回流前原目录 `git status --short` 为空。
10. 跑 `pnpm exec tsx scripts/acceptance/local-console-t5.ts --case diff-apply-failure-l1` → 应输出注入 diff apply 冲突或挂起后，系统在超时内写 visible local error，保留 patch，释放 session，且原目录不被半写脏。
11. 跑 `pnpm exec tsx scripts/acceptance/local-console-t5.ts --case dead-letter-recovery` → 应输出本地处理连续失败进入 visible dead-letter，dead-letter record 不自触发，追加新消息后可恢复处理且不会重复消费已死信消息。
12. 跑 `pnpm exec tsx scripts/acceptance/local-console-t5.ts --case dead-letter-write-failure-s1-v1` → 应输出注入 visible dead-letter 写入失败后 cursor 不推进，成功 dead-letter outcome 不保存，后续 retry 可重入。
13. 跑 fake `gh` 前置 PATH 的 T5 全量本地验收入口 → 应输出 fake `gh` 调用次数为 0，覆盖 `--case all` 中所有本地 acceptance cases，而不只覆盖 `worktree-diff`。
14. 查看 `docs/roadmap/milestone-4-local-console.md` → 应看到 T5 勾选 `[x]`、T5 验收证据摘要、`artifacts/acceptance/t5-evidence.json` 全量 case、MUST 文档勾选说明、`pnpm test` 与 `pnpm typecheck` 退出码，并明确 T6 互斥启动 flag 与 M3 A-K 不在 T5 范围。
15. PR 创建后跑 `gh pr view <PR_URL> --json baseRefName,body,state` → 应看到 `baseRefName` 为 `main`，body 包含 `Closes #109`、`Closes #116`、T5 验收证据、测试/typecheck 退出码、MUST 矩阵路径和证据摘要。
16. 在本地会话发送无 mention 但明确移交控制权的消息 → 应由 CEO 兜底追加一条 visible local CEO handoff 消息，该消息代码区域外只含一个合法 agent mention，且目标角色由下一轮 local drain 唤醒。
17. 重复处理同一条无 mention local message → 应不重复调用 CEO route judgment、不重复追加 handoff 消息、不重复唤醒目标角色，且 `tests/github-response-intake.test.ts` 中 GitHub intake fallback route 相关测试保持通过。
18. 注入 CEO route judgment 对明确交棒 local message 返回含两个合法 agent mention 的 append body → 应拒绝该 append，不直接运行任何目标角色，不保存 successful append decision，并保持源消息 retryable 或写 visible local failure/dead-letter 后才完成。
19. 注入 CEO route judgment 对明确交棒 local message 返回不含合法 agent mention 的 append body → 应留下可见降级结果或保持 retry，不能静默完成源消息，且 GitHub intake fallback route ledger 不应出现 local route decision。
20. 重复处理同一条曾遇到非法 append 的 local message → 应按 route key 防重处理已可见降级结果，或在未可见降级前允许 retry，不应重复追加 handoff 或重复唤醒目标角色。
21. 跑 `pnpm exec tsx scripts/acceptance/local-console-t5.ts --case worktree-diff` → 应输出 worktree 开启态运行 dev 修改时，从目标 base 创建 / 复用隔离 local branch，Codex cwd 指向 temporary worktree，回流前原目录 `git status --short` 为空。
22. 跑 `pnpm exec tsx scripts/acceptance/local-console-t5.ts --case worktree-return-rollback` → 应输出显式 diff 回流后原目录只包含 patch 预期改动，随后 reverse rollback 回到洁净；若 reverse check 失败，应保留 patch、写 visible local error，且不 reset/delete 原目录。
23. 跑 `pnpm exec tsx scripts/acceptance/local-console-t5.ts --case worktree-abandon` → 应输出放弃 generated diff 只更新本地 diff status，不触碰原目录、不删除 worktree、不破坏后续同 session 重跑。
24. 跑 `pnpm exec tsx scripts/acceptance/local-console-t5.ts --case worktree-issue-parity` → 应输出本地 workspace source 与 `src/agent-prescripts/issue-worktree.ts` 在开分支、cwd 指向 worktree、回流前原目录洁净三点上的对照证据，并证明 GitHub issue-worktree 行为未被修改。

## 验收治理记录
QA 增补的 3 条非法 append S1/V1 防回归语句已由 product-manager 在 issue 时间线明确接受为本子 issue 的正式实现验收扩展；实现阶段必须按正式验收清单逐条提供证据，不得降级为普通建议。
