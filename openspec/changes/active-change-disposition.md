# Active change 处置台账

> 调查日期：2026-08-02。基线：`main` / `origin/main` = `d282b7b`。
> 初始台账只记录调查与判断；后续按主理人放行执行了 C 作废归档、两个 A 的正式归档和 console-ui spec 回流，下面的执行记录与调查结论共同构成审计快照。

## 判定口径

- `[x]` 只表示任务文件自述完成，不作为归档证据；A 必须同时有当前代码、行为测试或真实运行观察点。
- C / D 必须能指出失效的事实源、产品前提变化或被替代的能力；“看起来旧”不构成依据。
- `openspec` CLI 未安装：`pnpm exec openspec validate fix-neutral-agent-avatar --strict` 退出码 254（command not found）。CLI 未运行的地方不伪造“严格校验通过”。

## 处置总表

| change | 判定 | 结论 |
| --- | --- | --- |
| `console-message-run-humanization` | **A → 已归档** | 三个独立复合组件、Story、组件测试都在当前代码；其中 `run-block`/`run-outcome` 有生产消费，`agent-message` 按 isolation 条保持未挂载；已按五步归档。 |
| `console-ui-sidebar-composer-context` | **A → 已归档** | 侧栏、角色 composer、空状态、会话上下文及其测试/Story 都在当前代码；前三者有生产消费，`session-context-header` 保持独立未挂载；已按五步归档。 |
| `provider-native-process-traces` | **B** | provider 原生读取能力已实现，但 Kimi 真实 thinking / tool call / tool result 页面证据仍被账户额度 403 阻断；不能收尾。 |
| `desktop-console-t65-integration-closeout` | **B** | T6.5 代码与固定数据验收已落地，但提交后 manifest / blob、PR 幂等查询和最终 PR 回读仍是未完成的收尾门。 |
| `fix-neutral-agent-avatar` | **B** | 产品规则仍有效，当前 avatar 仍使用身份色；未开工但没有失去意义，应继续实施，不是 D。 |
| `unify-marketing-visual-v02` | **C** | 该 change 的 v0.2 三路线事实链已被 7 月 29–30 日的新正式页与品牌叙事候选链取代；营销站仍存在，但本 change 的对照物和收敛路径已失效。 |

本轮没有 D：`fix-neutral-agent-avatar` 虽是 0/7，但 `docs/product/pages/agent-teams.md:357,370,811` 仍明确要求中性首字头像，而 `agent-initial-avatar.tsx:34-37` 仍反向使用身份色；这不是“已失去意义”。

## A 的 Requirement 分类闸门

判据是 delta 原文的主语和验收对象，分为三类：要求 console-ui 提供“independent”组件、组件内部状态/键盘行为或 Story 的，归为**组件契约条**；要求用户在已挂载页面上看到或操作某项能力的，归为**页面行为条**；主语是 `This change`、验收对象是变更文件清单/依赖检查/评审动作，或只在变更生命周期内成立的，归为**过程约束条**。只有前两类能在归档时回流事实源；过程约束条必须留在 archive。复扫结果是 9 条行为契约回流、1 条过程约束留档，因此未挂载的 `agent-message` 与 `session-context-header` 不阻断 A。

### `console-message-run-humanization`（4/5 回流；1/5 过程约束留档）

| Requirement | 分类 | 原文锚点与判定依据 |
| --- | --- | --- |
| `Agent messages use progressive disclosure` | 组件契约条 | `spec-delta/console-ui/spec.md:9` 主语是 “component library MUST provide an independent agent message component”；折叠/展开、摘要和覆盖优先级均是组件模型行为，场景以 agent-message Story 验收。 |
| `Run blocks support steps and a no-step fallback` | 组件契约条 | `:37` 明确要求 independent run block component 与 presentation-only model；步骤、无步骤降级和 Story 渲染是组件契约。 |
| `Terminal run outcomes are humanized without losing evidence` | 组件契约条 | `:77` 要求 component library 的 run outcome 映射；机器原因折叠与原始证据保留在组件模型/Story 内验收。 |
| `Disclosure and interrupt controls are keyboard-operable` | 组件契约条 | `:96` 的披露控件属于 agent message/run step/run outcome 组件，`:98-102` 验收 machine text、键盘 toggle 和 `onInterrupt` spy；没有页面挂载前提。 |
| `Humanization composites remain isolated` | 过程约束条（不回流） | `:133-145` 主语是 `This change`，并以 “changed file list ... inspected” 作为验收对象；它约束一次并行开发切片的评审边界，归档后主语和验收对象都失效，原样留在 archive 的 `spec-delta`。 |

### `console-ui-sidebar-composer-context`（5/5：组件契约条）

| Requirement | 分类 | 原文锚点与判定依据 |
| --- | --- | --- |
| `Project and session sidebar` | 组件契约条 | `spec-delta/console-ui/spec.md:7` 要求 independent sidebar component；排序、展开状态和 Story 是组件级验收。 |
| `Protocol-safe role composer` | 组件契约条 | `:35` 要求 independent controlled composer；合法 mention、选择和 disabled 行为由 composer 组件场景验收。 |
| `Empty conversation state` | 组件契约条 | `:61` 要求 independent empty conversation state；空态按钮/文案在 Empty-state Story 中验收。 |
| `Current session context header` | 组件契约条 | `:75` 明确要求 independent current-session header；父会话面包屑、任务状态和进度摘要在 header Story 中验收，不要求页面挂载。 |
| `Linear flat visual boundary` | 组件契约条 | `:88-97` 的主语是 sidebar、composer、empty state、session header 组件及其 semantic tokens；四个组件 Story 同时渲染即为该条的验收对象。 |

## 逐项证据与后续动作

### A · `console-message-run-humanization` — 已完成并归档

当前实现与可观察证据：

- `packages/console-ui/src/console/agent-message.tsx`、`run-block.tsx`、`run-outcome.tsx` 及对应 Story 都存在；测试覆盖 Markdown 摘要/覆盖优先级、步骤与无步骤降级、机器原因折叠和键盘披露。
- 当前工作树定向运行了七个相关 console-ui 测试文件（含本 change 与 sidebar change）：**7 files / 78 tests passed**，命令为：
  `pnpm --filter @moebius/console-ui exec vitest run src/console/agent-message.test.tsx src/console/run-block.test.tsx src/console/run-outcome.test.tsx src/console/conversation-sidebar.test.tsx src/console/role-composer.test.tsx src/console/conversation-empty-state.test.tsx src/console/session-context-header.test.tsx`。
- 生产消费核对结果是：`operator-console.tsx`/`subtask-tab.tsx` 只消费 `run-block` 与 `run-outcome`；`agent-message` 除自身文件、测试/Story、`packages/console-ui/src/index.ts` 桶导出和 registry 外，没有任何页面消费。该未挂载状态由 `Humanization composites remain isolated` 明确允许，不把组件契约误报成页面整合；`310c452` 的 T6.5 整页证据不覆盖 `agent-message`。
- 本 change 的 `spec-delta/console-ui/spec.md` 与 `specs/console-ui/spec.md` 语义相同，差异只有两行文件头说明；归档时只回流前者，两个镜像均随 archive 保留，不能把镜像头说明带入事实源。

判 A 的理由：四条可回流 Requirement 均是已实现并测试的独立组件契约；其中可被页面消费的 run 组件已有生产挂载，未挂载的 agent-message 不再由已归档的过程约束冒充产品行为；第五条过程约束留在 archive，不影响事实源归档。

### A · `console-ui-sidebar-composer-context` — 已完成并归档

当前实现与可观察证据：

- `conversation-sidebar.tsx`、`role-composer.tsx`、`conversation-empty-state.tsx`、`session-context-header.tsx` 及各自 Story/测试都存在。生产消费核对结果是：`operator-console.tsx` 消费前三者（`role-composer` 另有新对话页/子任务页消费），而 `session-context-header` 除自身文件、测试/Story、`packages/console-ui/src/index.ts` 桶导出和 registry 外，没有任何页面消费；这不阻断 A，因为对应 Requirement 是独立组件契约。
- 上述定向命令的 78 个测试覆盖稳定排序/状态、合法 mention 与第二角色阻止、空状态、父会话面包屑和上下文显示；不是只检查文件存在。
- `spec-delta/console-ui/spec.md` 与 `specs/console-ui/spec.md` 当前字节一致。
- T6.5 真实验收记录在 `docs/roadmap/milestone-4-local-console.md:129`：固定数据浏览器走查、可见文案/ARIA 机器词硬门、截图/evidence 和 console-ui/desktop/typecheck 命令均有记录。

判 A 的理由：五条 Requirement 均是已实现并测试的独立组件契约；前三个组件已有生产消费，会话上下文 header 按契约保持独立；剩余工作是按项目五步归档并回流当前事实源。

### B · `provider-native-process-traces` — 在途，暂不收掉尾项

当前实现证据：

- `src/local-console/provider-process-trace.ts:126-192,337-533` 已按 provider 分派 Claude transcript 与 Kimi wire；`tests/local-console-provider-process-trace.test.ts:21-575` 覆盖 thinking、tool call/result、身份/路径安全和 unavailable 分支；`packages/console-ui/src/console/process-tab.tsx:91-413` 提供 provider-specific 输出与降级。
- 当前产品事实源仍要求三 provider 的原生 thinking、工具调用和工具结果：`docs/product/pages/main-right-sidebar.md:342-346`，并未退役或被其他能力替代。
- 唯一未完成的父任务在 `tasks.md:24-37`：真实页面四组验收中的 Kimi thinking、tool call、tool result 三项。记录的 2026-07-31 复现是本计费周期 HTTP 403；验收脚本也会明确写出 `partial-account-quota-blocked`，而不是伪造 complete。

这条值得保留、但不值得现在强行收掉：实现和替身测试已经覆盖能力，缺的是账户额度恢复后才能观察的真实页面证据。额度恢复前勾选或归档会把“无法观察”误写成“已验证”；保持 B，后续只补 Kimi 三项真实页面断言并记录 evidence。

### B · `desktop-console-t65-integration-closeout` — 实现完成，收尾仍在途

已实现的行为证据：

- `scripts/acceptance/local-console-t65.ts:60-190,470-563` 实现唯一 run、staging/final artifact、可见文字/ARIA 硬门、七个哨兵和 tested-source manifest；`operator-console.tsx` 当前接入七个复合组件。
- `docs/roadmap/milestone-4-local-console.md:129` 留有 run id、截图、evidence JSON/sidecar、机器词零命中和命令退出码；`310c452` 提交正文包含 `Closes #142`，且当前 `main` 包含该提交。

仍不能判 A 的原因是 `tasks.md:29-33` 的五道收尾门没有当前仓库内的逐条证据：提交前 manifest 重算、变更范围与推送核对、提交后 commit blob 重算、PR 幂等查询、最终 PR head/body 回读。实现完成不等于这些外部收尾事实已核实。后续应只补这五项并把结果写回台账或 change，再进入五步归档；不需要重做已通过的 T6.5 行为实现。

### B · `fix-neutral-agent-avatar` — 在途，不是作废

事实核对：

- 当前 `packages/console-ui/src/console/agent-initial-avatar.tsx:1-2,34-37` 仍 import `identityToken`，按 slug 选择 `--ident-*` 并设置 `--ident-fg`；三个真实消费点仍位于 `agent-teams-page.tsx:1202`、`agent-team-detail.tsx:832,942`。
- 产品事实没有撤回：`docs/product/pages/agent-teams.md:357,370,400-401,811` 要求统一中性圆形首字头像，不用身份色表达层级或状态。
- `--ident-*` 不是全局死代码：`packages/console-ui/src/console/role-tag.tsx:25-37` 和 `conversation-relay-rail.tsx:24,240,484` 仍消费身份色。因此未来实现只应解除 avatar 对身份色的依赖，不应按“avatar 唯一消费者”删除 tokens。
- `spec-delta/console-ui/spec.md` 只有一行骨架说明，没有 `Requirement` / `Scenario`；这解释了为什么 change 不能归档，但不说明产品目标失效。

delta 形态本身是当前仓库认可的形态：`openspec/changes/_template/spec-delta/` 是模板，多个已归档 change 只有 `spec-delta/<domain>/spec.md` 而没有 `specs/` 镜像。这里缺的是内容，不是目录形态；CLI 因未安装无法实跑验证。后续按任务先补 grep 结果和最小 Requirement，再实施/测试。

### C · `unify-marketing-visual-v02` — 事实源失效，已作废归档

不是营销站被砍，而是本 change 的事实链已被后续产品方向取代：

- 本 change 的方案仍围绕 2026-07-18 的 `style1/2/3`、`index1/2/3` 三路线，以及“用户选择后再迁移正式 `style.html` / `index.html`”。
- 当前 `sites/marketeam/AGENTS.md:7-18` 已记录：2026-07-29 用户确认的正式 `index.html` 是深色工作台首页，2026-07-30 又进入新的 `rebrand-narrative-plan.md` 样张候选链；当前 `index-field-*` / `style-atlas-*` 仅作历史参考，不再代表正式入口。
- 同一文件 `:40-42` 明确写出早期去框实验“已由正式收敛取代”，`:80-90` 又把 Relay Atlas 候选和独立样张定义为新事实链；这不是旧 change 尚未完成的单纯状态，而是对照物和收敛程序已经换了。
- 新方案的候选集合、用户画像和人工确认门都在 `sites/marketeam/rebrand-narrative-plan.md:1-5,24-50,105-139`，与旧 change 的三路线/视觉宪法 v0.2 收敛路径不是同一产品决策。

判 C：已采用 `2026-08-02-voided-unify-marketing-visual-v02` 作废归档，保留候选文件和旧 delta 作为历史快照，**不**把该 change 的 marketing spec-delta 回流到 `openspec/specs/marketing-site/`。

## 执行记录

- `unify-marketing-visual-v02` 已移至 `openspec/changes/archive/2026-08-02-voided-unify-marketing-visual-v02/`；19 条未完成任务作废，候选文件和旧 delta 原样保留，未回流 marketing-site spec。
- `console-message-run-humanization` 已移至 `openspec/changes/archive/2026-08-02-console-message-run-humanization/`；仅将 `spec-delta/console-ui/spec.md` 回流到 `openspec/specs/console-ui/spec.md`，原 `specs/` 镜像随目录保留。镜像差异仅两行文件头；因 CLI 未安装，镜像没有经过 CLI 独立校验，双份同义文件的人工同步仍是已知脆性来源。
- `console-ui-sidebar-composer-context` 已移至 `openspec/changes/archive/2026-08-02-console-ui-sidebar-composer-context/`；其 `spec-delta/console-ui/spec.md` 已回流，原 `specs/` 镜像随目录保留；两份镜像归档前字节一致。
- 两个 A 均没有 `wireframes.md` 或 `architecture/after.svg`，因此五步中的 wireframe / architecture 回流按规则跳过；没有伪造 architecture 事实源。
- 两个 A 的 proposal 都没有项目要求的「需求基线」节，原始提案使用 issue 时间线或旧 change 事实源，而非 `docs/product/` 锚点。归档第 5 步已核对相关产品页：`main-left-sidebar.md`、`main-conversation.md`、`agent-conversation.md`、`main-right-sidebar.md` 的现行页面规则与已回流的独立组件契约无矛盾；这两个 change 不新增页面挂载承诺，因此没有需要修改的 `docs/product/` 表述。该 PRD 缺口如实保留，不补造 Source。
- Requirement 回流摘要：humanization 回流 `Agent messages use progressive disclosure`、`Run blocks support steps and a no-step fallback`、`Terminal run outcomes are humanized without losing evidence`、`Disclosure and interrupt controls are keyboard-operable` 四条；`Humanization composites remain isolated` 被识别为过程约束条，不回流，原样留在 archive 的 `spec-delta`。sidebar 回流 `Project and session sidebar`、`Protocol-safe role composer`、`Empty conversation state`、`Current session context header`、`Linear flat visual boundary` 五条。9 条行为契约均通过组件代码、测试和 Story 证据核对；不把未挂载的 `agent-message` / `session-context-header` 冒充页面行为。
- 本轮补上三分类漏洞：组件契约条与页面行为条可在满足对应证据后回流；过程约束条因归档后主语/评审对象失效，必须留在 archive。该规则及 `Humanization composites remain isolated` 反例已写入 `openspec/changes/AGENTS.md` 归档第 2 步。
- OpenSpec CLI 安装尝试：`pnpm dlx openspec@latest --version` 成功解析 npm 包但退出码 1，报 `ERR_PNPM_DLX_NO_BIN No binaries found in openspec`；当前仍没有可执行的 `openspec` 命令，严格校验未验证，不能记为通过。临时日志在 `/tmp/moebius-openspec-cli-install.log`，未改 package manifest 或 lockfile。
- 过程约束条移除并 amend 后，按放行要求重新执行完整闸门一次：`pnpm test` 退出码 0；root `99 files / 713 passed + 1 skipped file / 4 skipped tests`、slow `1 file / 63 passed`、desktop `130 files / 578 passed`、console-ui `45 files / 459 passed`，数字与基线一致，没有剪枝或覆盖缺口。边界 preflight 同样为 `622 source / 536 production / 3 roots`。
