# 任务：agent-md-revision-and-default-agent

实施顺序固定为 **UI 对齐（纯 `packages/console-ui`，fixture 假数据，不连真实数据链路）→ 用户在 Storybook 里确认目标形态 → 存储与迁移 → 修订服务与默认 Agent 调用 → 桌面装配 → 定向验证 → 真实验收**。UI 对齐阶段允许在方案核验通过后先行推进（纯展示，无真实副作用）；A 节之后的生产数据链路实现仍需等 UI 对齐通过人工闸门。

## A. UI 对齐（先行）

只动 `packages/console-ui`；不碰 `desktop/`、SQLite、IPC；所有内容走 Storybook fixture，不连真实数据链路。七块共享同一套变化标记 / 来历署名视觉语言，一次性对齐，不按后续 B–D 的实现批次拆分体验。

- [x] 提取 `execution-profile-fields.tsx`：从 `agent-team-detail.tsx` 现有内联 JSX 提取 CLI / Provider / 模型 / 思考程度选择器 + 校验逻辑（`isExecutionProfileValid`）；`agent-team-detail.tsx` 改为消费该组件，行为回归，58 项既有测试全绿
- [x] 扩展 `agent-markdown-mention-editor.tsx`：新增 `changeMarkers` 输入（按段落块索引，presentation-only，不服务合并）；左侧色条、hover 显形来历署名、点击就地展开原文；无标题 `AGENT.md`（`general-assistant` 场景）退化为整份一块
- [x] 新增 `agent-markdown-revision-timeline.tsx`：成员级时间线面板，逐条摘要 + 作者 + "回到这一版"；摘要 `pending`/`unavailable` 两态
- [x] 扩展 `agent-team-detail.tsx`：`AGENT.md` 标题行接入"最近变化"摘要与"全部"展开态；新增 `officialSyncBanner` 同步结果横幅（"看看改了什么"/"撤销这次同步"/"×"），与旧的显式"有更新"横幅并存但数据源独立，互不冲突
- [x] 扩展 `agent-teams-page.tsx`：团队首页横行"官方有新变化"标记；"更多"菜单新增"最近的官方同步"常驻入口（`RecentOfficialSyncPanel`）
- [x] 扩展 `operator-console.tsx`：侧边栏底部新增 `teamSyncStatus` 同步中/已更新两态，与"安装更新"共用位置；`SidebarAction` 新增 `tooltip`/`iconSpinning` 能力
- [x] 扩展 `settings-dialog.tsx`：常规分类新增"默认 Agent"设置组，复用 `execution-profile-fields.tsx`
- [x] 扩展 `session-team-update-notice.tsx`：新增"查看"与"×"（`onView`/`onDismissCategory` 均为可选，省略时保持今天的纯"应用"行为）；新增 `session-team-update-detail-dialog.tsx` 查看弹窗，"取消"只关闭、"应用"与外层同语义
- [x] 全部新增能力均为可选 prop，未传入时保持现状渲染——真实 desktop 尚未传这些新 prop，因此生产行为在本节完成后不变
- [x] 新增/更新 Component、Block、Page Story：亮暗主题、无标题 `AGENT.md`、长时间线、摘要 pending/unavailable、窄窗口、reduced-motion fixture；`pnpm --filter @moebius/console-ui check:storybook` 通过（43 stories，Component 24 / Block 12 / Page 7）
- [x] 更新 `src/testing/four-layer-registry.ts` 登记三个新生产文件为 view 层；`pnpm check:boundaries` 通过
- [x] `pnpm --filter @moebius/console-ui exec vitest run`（545 tests）与 `pnpm typecheck`（含 desktop）全绿
- [x] 用户在 Storybook（本次跑在 6021）里对齐七块目标形态；确认后再进入 B 节（第二轮开发前用户任务评审清零，按用户授权记为通过）

## B. 存储与迁移

- [x] 新增 SQLite 迁移：`agent_markdown_revisions` 表（team_stable_id / member_slug / content / author_kind / author_label / summary / summary_status / created_at / batch_id 可空），索引 `(team_stable_id, member_slug, created_at)`；沿用现有幂等双跑迁移模式
- [x] 扩展 `AppliedOfficialTeamState`：新增内容快照字段，保留原指纹字段用于快速比较
- [x] 新增纯函数 `planAppliedBaselineMigration`（`team-official-plan.ts`）：内容指纹相等 → `verified` + 回填；不等 → `conservative` + 不回填
- [x] 新增迁移执行入口（`team-official-management.ts`）：一次性、幂等、失败时旧状态原样保留；`conservative` 分支额外调用修订存储补一条起点修订
- [x] 单测：`planAppliedBaselineMigration` 的 verified / conservative 两条路径；迁移执行入口的幂等重跑、崩溃后重启恢复、失败保留旧状态

## C. 修订服务与默认 Agent 单次调用

- [x] 新增 `desktop/src/agent-revision-plan.ts`：段落切块 + 归属传播纯函数，覆盖无标题输入（`general-assistant` 场景）、首次修订、连续多次修改同一段；切块规则须与 `packages/console-ui` 的 `computeMarkdownBlocks`（已在 A 节落地）语义一致，但保持两处独立实现——前者是桌面纯函数不依赖 console-ui，重复是刻意的边界隔离，不是待合并的重复代码
- [x] 新增 `desktop/src/agent-revision-store.ts`：修订 CRUD
- [x] 新增 `desktop/src/agent-revision-service.ts`：挂在团队页保存成功与 `team-external-change.ts` 检测到的 Finder 有效外部修改之后，同步建修订、异步派发摘要任务
- [x] 新增 `desktop/src/agent-revision-summary-job.ts`：读默认 Agent 配置，做一次性单轮 provider 调用；确认现有 Codex/Claude/Kimi/Pi 驱动是否有可复用的单轮补全入口，若无则新增窄适配层（design.md「风险」已标注，若成本超预期回来更新设计）
- [x] 新增 `desktop/src/default-agent-config-store.ts`：应用级单例配置持久化
- [x] 单测：保存成功立即产生修订且不等摘要；默认 Agent 不可用时摘要正确降级为 `unavailable` 且不阻塞、不重试轰炸；回退产生新修订而不是删除或覆盖历史；默认 Agent 调用不创建会话/run 记录

## D. 桌面装配（把 A 节的 UI 接上真实数据）

- [x] 扩展 `team-ipc.ts` / `team-ipc-contract.ts`：新增 `agent-teams:member-revisions:list`、`agent-teams:member-revisions:restore`、`agent-teams:default-agent:get`、`agent-teams:default-agent:save`；请求只携带 team/member/revision 标识，不携带任意路径
- [x] 装配 `desktop-team-ipc-wiring.ts` / `desktop-team-wiring.ts`：挂载新 store/service；应用启动时跑一次官方基线迁移（已是新结构则跳过）
- [x] 把 A 节新增的可选 props（`changeMarkers`、`recentChange`、`revisionTimeline`、`defaultAgent` 等）接上真实 IPC 数据；接上之后真实桌面行为才第一次可观察到变化
- [x] 单测：IPC 层参数校验、越权路径拒绝、迟到响应不覆盖当前状态（沿用仓库既有 late-response 测试模式）

## E. 边界、定向验证与符合度反思

- [x] 实施开始前记录当前 commit 为本 change 的 scope 基线；后续所有 `--scope` 命令使用该同一精确基线
- [x] 运行 `pnpm run test --scope <记录的精确基线>`
- [x] 运行 `pnpm typecheck`
- [x] 运行 `pnpm --filter @moebius/console-ui check:storybook`
- [x] 运行 `pnpm --filter @moebius/desktop build`
- [x] 运行 `git diff --check`
- [x] 对照 proposal/design/spec-delta 和三份 PRD 锚点反思：逐项列出已实现、未实现、多做、兼容降级与测试证据；偏差必须先修复
- [x] 确认段落切块结果没有被合并逻辑复用（本 change 不实现合并，但要为 change 2 留出不可复用的边界证据——即 `agent-revision-plan.ts` 没有被除呈现路径外的任何调用方引用）

## F. 真实功能与视觉验收

- [x] 在隔离数据根启动真实 Electron，团队页保存一段 `AGENT.md`：断言编辑器出现左侧标记与"最近变化"摘要，摘要就绪前后状态可观察区分
- [x] 用 Finder 直接修改一名成员的 `AGENT.md` 并返回应用：断言产生同等结构的修订
- [x] 展开时间线，点击"回到这一版"：断言内容与标记正确回滚，且回退本身产生新修订
- [x] 设置页选择默认 Agent 并保存，重启应用：断言配置仍生效，未设置时显示内置推荐
- [x] 携带一个存量、只有指纹的 `AppliedOfficialTeamState`（分别构造用户未改动/已自定义两种 fixture）启动应用：断言迁移分别落到 `verified` 回填与 `conservative` 标记 + 起点修订
- [x] 真实验收 evidence JSON、DOM/可访问性断言和必要截图写入脚本报告的系统临时目录；不得写仓库 `artifacts/`

## G. 功能 QA / 视觉 QA 移交清单

- [ ] 功能 QA：按本 change 的 spec-delta 场景与 PRD 锚点逐条执行，记录页面入口、动作、可观察信号和 evidence 路径
- [ ] 视觉 QA：核对左侧标记 hover 显形、就地展开、时间线面板与设置页默认 Agent 面板的信息密度、令牌使用（无裸色/渐变/阴影越界）——A 节已可在 Storybook 先行走查，本节是接上真实数据后的复核
- [ ] 每条用户可见行为都附一条"真实运行可观察"语句；缺少真实页面证据不得声明 code-verified 完成

> 完整 `pnpm test` 不在实现者初次收口运行；按仓库规则，待功能与视觉复核通过后、合并前由交付流程对本 change 恰好运行一次。归档、spec 回流、architecture/wireframe 回流与本地提交服从 `openspec/changes/AGENTS.md`，不在本清单重复。

## F 真机验收记录（真实 Electron，隔离数据根）

验收脚本：`scripts/acceptance/agent-revision-acceptance.ts`（`pnpm exec tsx scripts/acceptance/agent-revision-acceptance.ts`）；证据 JSON 与临时数据写入系统临时目录，脚本结尾打印 evidence 路径。本次运行 5 项断言全绿（含脚本完成标记），记录如下：

| 断言 | 入口 | 动作 | 可观察信号 | evidence 关键值 |
| --- | --- | --- | --- | --- |
| 保存产生修订 + 标记 + 摘要降级 | Agent 团队 → 开发团队 → 开发经理 AGENT.md 编辑器 | 真实输入新内容并点击“保存” | 编辑器正文左侧出现变化标记；**标题行先显示“正在生成说明…”占位**；展开时间线先显示“摘要生成中…”；后台摘要任务到达终态后重选成员可见对应 UI | marker=2；pending 可见；**标题行 pending 占位可见**；terminalStatus=unavailable（本机默认 Agent 无可用 provider 时；时间线“摘要暂时无法生成”与**标题行“最近变化 · 本次改动涉及 2 处”均渲染**）；SQLite 1 条 user 修订 |
| Finder 修改记同等修订 | 复制官方开发团队为用户团队 → Finder 修改其 dev 成员 AGENT.md → 返回应用聚焦窗口 | 先打开成员再真实修改文件，随后让窗口重新获得焦点 | 编辑器载入 Finder 新内容，SQLite 出现该成员的一条 user 修订（与团队页保存结构一致） | externalRevision content_len=24；共 2 条修订 |
| 回退回滚内容并产生新修订 | 开发经理时间线 → 中间一条修订的“回到这一版” | 点击“回到这一版” | 编辑器与磁盘内容都回到中间一版（编辑器按存储的规范化全文显示）；时间线新增一条回退产生的 user 修订，历史未被删除或覆盖 | 回滚后 copy dev-manager 修订 4 条（39/49/54/49）；恢复按钮 ≥2；最新 sqlite 修订内容 == 磁盘内容 |
| 默认 Agent 设置重启保持 | 设置 → 常规 → 默认 Agent → 重启应用 → 设置 | 首次打开显示内置推荐（Codex/gpt-5.6-sol/high）；切换为 Claude Code 保存；重启后再次打开设置 | 未配置时显示内置通用助手推荐而非空白；重启后仍是保存的 Claude Code/sonnet，配置文件落盘 | initial codex/gpt-5.6-sol → saved claude/sonnet；`default-agent-v1.json` 含 `"cli": "claude"` |
| 存量指纹基线迁移 verified/conservative + 幂等 | 首次启动（seed 写入 fingerprint-only 官方状态）→ 启动迁移；随后人为改回 legacy 结构再重启 | 以全新隔离数据根启动应用；再构造旧版 fingerprint-only 结构重启 | 未编辑官方团队 → verified + 内容快照回填；已自定义团队 → conservative + 每成员一条 user 起点修订；第三次启动不重复追加 | verified 快照回填成功；conservative 标记且 dev 恰好 2 条（Finder 编辑 + 起点）；幂等重启条数不变 |

### F 节期间的三个真实 bug（均已修复并留单测）

1. **contentEditable 崩溃（v0.4.1 既有生产 bug）**：真实 Chromium 中 contentEditable 内任何 re-render 抛 `Failed to execute 'removeChild'`；基线 worktree 同样崩。修复：contentEditable 只渲染单个文本节点 `{value}`，变化标记/rail 全部移到镜像测量层（`ChangeMarkerOverlay`）；mention 渲染回退为可编辑纯文本 `@slug`，复制交互由 `CopyableAgentSlug` 承接（原 AgentMention 内嵌复制按钮删除，3 个孤儿 i18n key 一并删除）。
2. **preload 桥缺失**：`desktop/src/preload.ts` 未暴露 4 个新 IPC 方法 → 真实 Electron 中 `window.moebius.*` undefined → UI 静默 no-op（“保存后修订不达 UI”的真实根因）。修复：接口 + contextBridge 实现同步补齐；后续新增 renderer 可见 IPC 必须同步暴露在 preload。
3. **回退后修订爆炸循环**：restore 路径只更新 draftMarkdown、不更新 savedMarkdown → 成员脏态 → 外部变更检查把刚回滚的文件当作外来修改，每次命中 conflict 分支都产生新 state → effect 无限重查、每条查一次重记一条修订（约 250 条/秒）。修复：新增 `applyAgentTeamMemberRestored` 同时对齐 draft 与 saved 基线并清空外部状态；`applyAgentTeamMemberExternalChange` 对相同 conflict 返回同一 state（防同类循环）；`team-state.test.ts` 4 条用例钉死两个行为。

### 功能复核补修（product-delivery-lead 复核发现，本 change 内同一分支提交）

**“最近变化”标题行在摘要缺失时被整行摘掉**（`planMemberRevisionsResponse` 在 `latest.summary === null` 时返回 `recentChange: null`）。PRD（`flows/agent-evolution.md` 41/51/116/133）要求该行常驻，摘要 pending/unavailable 时用中性占位，绝不消失——默认 Agent 未配置是全新用户初始状态，这一行消失会让最高频场景 A 的完成信号失效。修复口径：

- 契约：`recentChange` 只要存在 latest 修订就必须产出，携带 `summaryStatus`（`pending` / `ready` / `unavailable`）；`summary` 在摘要任务进行中或失败时为 null。
- 占位文案在 **view 层用 i18n 生成**（`console.agentTeamDetail.recentChangePending` / `recentChangeUnavailable`，中英双语），主进程不拼本地化文本；unavailable 按 `changeMarkers` 块数生成机械摘要（“最近变化 · 本次改动涉及 N 处”）。
- 三态同构：payload 都带作者署名与时间，渲染同一单行。
- 单测：`team-revision-ipc.test.ts` 新增 pending / unavailable / 无修订三例；`agent-team-detail.test.tsx` 新增标题行两态渲染两例；`production-copy-guard` 校验无 CJK 直出。
- Story：`agent-teams-page.stories.tsx` 的 `TimelineSummaryPendingAndUnavailable` 扩展为覆盖标题行两态（dev-manager 标题行 unavailable + 机械摘要，dev 标题行 pending），时间线条目两态保留。
- 真机：验收 1 新增标题行断言——保存后 pending 窗口断言“最近变化 · 正在生成说明…”真实渲染（`pendingTitleLineVisible=true`），终态 unavailable 后断言“最近变化 · 本次改动涉及 2 处”真实渲染（`terminalTitleLineRendered=true`）；全 7 项断言绿。

### 视觉 QA 复核补修（visual-qa 发现，本 change 内同一分支提交）

视觉验收（Storybook + 真实 Electron 双证据）在 `agent-markdown-mention-editor.tsx` 的变化标记层发现 3 项必修，全部修复并提交：

1. **左侧色条完全不可见（亮暗双主题均复现）**：rail 用 `bg-accent/50`，而 `--accent` 是纯 CSS 变量——Tailwind 3.4 对纯 var 颜色不生成 `accent/<n>` 透明度修饰规则，类名静默失效（运行中页面的 styleSheets 已核实无该规则）。修复：rail 改为 `bg-[color-mix(in_srgb,var(--accent)_50%,transparent)]`（同色 40% 用于展开按钮焦点 ring），构建产物已核实两条 color-mix 规则真实存在。
2. **标记交互层对真实指针不可达**：marker 层全部子元素 absolute、容器自身无高度 → 层 0×0、rail 高度 0、展开按钮继承 overlay 的 `pointer-events-none`，真实鼠标 hover 署名 opacity 恒 0、`elementFromPoint` 命中 null。修复：层按块文本高度携带真实尺寸（镜像 Range 测量 `top+height`，jsdom 退化为行数估算），层本身 `pointer-events-auto w-3` 常驻命中带；署名行默认 `opacity-0 pointer-events-none`，`group-hover/marker` / `group-focus-within/marker` 时显形并恢复指针可达（整行可命中，署名与按钮之间无死区），隐藏时绝不拦截正文首行文本选择。
3. **展开按钮键盘焦点不可见**：`focus()` 后 opacity 仍 0、无焦点环。修复：聚焦即经 `group-focus-within` 显形，按钮自身 `focus-visible:ring-2` + color-mix 40% ring 提供可见键盘焦点。

记录（未修，超出本 change 范围）：`accent/<n>` 透明度修饰系统性失效（`focus-visible:ring-accent/30` 等既有用法同样不生成规则），已同步更新 `packages/console-ui/DESIGN.md` 变化标记模式条目为 color-mix 机制；窄窗成员标签截断为既有已定性不修项。建议（记录不修）：展开原文是 absolute overlay，密集文本下会遮挡后续段落——按 popover 类设计意图保留；「最近变化」行终态不自动刷新，需切换成员重选（功能验收同观察），留待后续。

- 单测：`agent-markdown-mention-editor.test.tsx` 新增 1 条回归用例钉住层尺寸（jsdom 行数估算 40/40）、`pointer-events-auto`、color-mix rail 类（并断言不再含 `bg-accent/50`）、hover/focus 显形接线与焦点 ring。
- 门禁：console-ui 全量 552 测试、typecheck×3、check:storybook（43 stories）、console-ui build（color-mix 规则在 dist CSS）、desktop build、check:boundaries（727 文件）、`git diff --check` 全绿；真机验收重跑 exit 0、7 项断言全绿（`markerCountAfterFirstSave=2`、`pendingTitleLineVisible=true`、`terminalTitleLineRendered=true`）。

## G 功能 QA / 视觉 QA 移交记录

- 功能 QA：F 节 5 条真机断言已全绿（见上表），覆盖 spec-delta 的核心场景（保存、外部修改、回退、默认 Agent 持久化、基线迁移三态）。待移交项：`change 2` 范围的自动同步/批次/撤销落盘与“查看弹窗真实数据”不属于本 change，A 节对应 UI（横幅、侧边栏同步态、查看弹窗）保持 inert 未接数据，请复核时注意区分。
- 视觉 QA：左侧标记 hover 显形、就地展开、时间线面板与默认 Agent 面板在 A 节已过 Storybook 人工闸门；F 节真机复核了标记、时间线 toggle/展开、最近变化标题行与摘要降级文案。
- 已实现但需复核时知晓的行为：摘要任务按默认 Agent 配置做一次性单轮调用，终态按环境为 ready/unavailable 两者之一（本机验收为 unavailable，确定性降级路径由 `agent-revision-service.test.ts` 钉死）；`conservative` 基线只做标记 + 起点修订，不做二路合并（合并是 change 2 范围）。
- 移交物：本清单 + `scripts/acceptance/agent-revision-acceptance.ts`（含 evidence 输出）；`pnpm run test --scope` 基线 commit 为 `d2bd03692fb0979e4b74d32ccfb594f72367c036`。
