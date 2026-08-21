# 设计：agent-avatar-team-navigation

## 方案

## 关键选型理由

每条方向选择均按“本项目约束 → 采纳结论”记录：

| 方向 | 选型理由 | 采纳结论 |
| --- | --- | --- |
| 历史导航目标 | 需求：用户要求打开“对应 Agent 团队的对应 Agent”；现有 console-ui 规格：历史信息不得被当前团队替换；仓库事实：冻结快照已有 `team.ownership` 与 `team.id` → | 使用历史快照生成 `ownership:id` 与成员 slug；不使用当前团队回填。 |
| 团队键格式 | 仓库既有惯例：`getAgentTeamKey` 与 `snapshotSummaryToOperatorTeam` 都使用 `ownership:id` → | `LocalConsoleRunAgentInfo.team.teamKey` 沿用 `ownership:id`。 |
| 详情页形态 | 产品事实：`docs/product/pages/agent-teams.md`规定 Agent 详情属于团队详情内的成员选择；仓库现状：`AgentTeamsPage` 已有 `selectedMemberSlug` → | 复用既有团队详情页并预选成员，不新增 Agent 路由。 |
| Popover 组件 | 需求：运行中、成功、异常终局的头像都可进入当时信息；仓库现状：`AgentRunInfoPopover` 已具备 run 隔离、collision handling 和焦点回返 → | 扩展同一 Popover，活动与历史记录共用交互契约。 |
| 跨层导航接口 | 架构约束：`console-ui`只负责视图意图，桌面 renderer 负责导航状态；仓库现状：桌面已有 `useAgentTeamNavigation` → | 增加语义回调 `onOpenAgentTeamMember(teamKey, memberSlug)`，由桌面原子打开并选中。 |
| Provider 标识来源 | 仓库事实：快照成员有 `executionProfile`，活动 run 有 `profile`，终局有 `terminal.actualProfile`，头像已有 `ProviderMark` → | 按 run profile、终局 profile、冻结成员 profile 的优先级显示 Provider 标识，并保留 Pi `providerId`。 |
| 历史 Markdown 接口 | 需求：只要求 Popover 按钮改为团队成员详情跳转；范围纪律：只做明确要求的用户可见范围 → | 移除生产 UI 的 Markdown Dialog 与调用，暂保留后端内部接口，不扩大本 change 的 API 清理范围。 |
| 旧历史兼容 | 现有事实规格：缺失历史字段必须显示未记录，不能用当前状态猜测；快照团队字段本身可选 → | 无稳定团队键时不显示错误跳转动作，也不回退当前团队。 |

本方案没有挂不上需求、仓库惯例、架构约束或用户输入的选型条目，因此没有“无本项目依据，仅为惯例”的方向选择。

### 1. 事实与数据流

以已有历史团队快照为唯一导航事实源：

`teamSnapshot.team.ownership + id` → `ownership:id` → `LocalConsoleRunAgentInfo.team.teamKey` → `AgentRunInfoView` → `AgentRunInfoPopover` → `onOpenAgentTeamMember(teamKey, memberSlug)` → `useAgentTeamNavigation` → `AgentTeamsPage` 的团队详情与成员选择。

`LocalConsoleAgentTeamSnapshotMember.executionProfile` 投影为 `LocalConsoleMemberIdentity.engine`，其中 Pi 保留 `providerId`；活动 run 的 `profile` 从已有 `ActiveLocalRun.profile` 一并投影到 `LocalConsoleRunSnapshot`，让运行中的头像在首次渲染就能显示准确 Provider 标识。结构化终局已经有 `terminal.actualProfile`，优先使用它作为头像首屏标识；普通成功消息继续使用会话冻结成员身份的 profile。

历史 Popover 读取到 `AgentRunInfoView` 后，以历史 `profile` 覆盖触发器上的 roster/活动预览标识；缺失 profile 时显示无 Provider 标识，不从当前团队猜测。历史团队键或成员 slug 不可用时，不显示会把用户带到错误团队的导航动作。

### 2. 组件与宿主边界

- `AgentRunInfoPopover` 保持唯一 run 信息浮层和既有 Radix collision/focus-return 机制。它接收 `onOpenAgentTeamMember` 这一语义回调，不知道页面、路由或桌面状态；移除 `loadMarkdown`、嵌套 Dialog 及其 UI 文案。
- `RunBlock` 增加可选的 run 信息加载参数。存在 `runId + onLoadRunAgentInfo` 时，角色头像直接使用 `AgentRunInfoPopover`，否则保留无审计数据时的静态 `RoleTag` 降级。这样活动 run 与历史 Agent 消息共享同一交互契约。
- `OperatorConsole` 只负责把当前 run 的 session/run/role 和宿主回调串入组件。已有 Markdown mention 入口也改为传递成员 slug到同一语义回调，避免组件各自拼装“打开团队再选成员”的顺序；不改变 mention 文本、派工或执行语义。
- `desktop` 在 `useAgentTeamNavigation` 增加“打开指定成员”的原子意图，复用现有团队 catalog 加载、成员加载、`activeTeamKey` 与 `selectedMemberSlug` 状态。团队详情页仍是唯一页面，成员是该页的选中对象；console-ui 不引入路由。

### 3. Provider 标识优先级

1. Popover 已加载的 run-scoped `profile`。
2. 活动 run 的 profile或结构化终局的 `actualProfile`。
3. 会话冻结团队成员的 `executionProfile`。
4. 无可靠事实则不显示 Provider 标识。

这条优先级同时满足“首屏有标识”和“打开后以实际 run 事实为准”；`pi` 的 `providerId` 始终随标识传递，避免只显示无具体厂商图形的 `pi`。

### 4. 错误与兼容

- Popover 信息读取失败仍保留现有局部错误/重试，不提供不确定的导航目标。
- 团队尚未进入 catalog 时由导航层保留待打开意图；团队存在但成员已不在 catalog 时不伪造成员选中，保留团队详情的可用状态。
- 没有 `teamSnapshot` 的旧 run 仍可显示历史信息卡，但不回退到当前会话团队；这类记录没有“打开 Agent 详情”动作。
- 后端 `agent-markdown` 读取链路暂不删除，仅移除生产 UI 的调用与展示，作为本 change 的范围边界。

## 变更单元与测试策略

| 变更单元 | 可独立验证内容 | 测试与运行证据 | 测试基础设施 |
| --- | --- | --- | --- |
| A. 运行事实与 Provider 投影 | 历史 `teamKey`、成员 `engine`、Pi `providerId`、活动 run `profile` 的传输 | 新增/补充 `member-identity`、`run-agent-audit-plan`、run snapshot 单元测试；断言无快照时不生成错误目标 | 不新增；沿用 Vitest 纯逻辑测试 |
| B. 共享头像与 Popover | 活动头像可点击；Provider 标识首屏出现；加载后以 run profile 为准；详情按钮只发出团队键和成员 slug；焦点、错误、重试保持 | `agent-run-info-popover.test.tsx`、`run-block.test.tsx`、`operator-console.test.tsx`；删除/替换旧 Markdown Dialog 测试 | 不新增；沿用 Testing Library、Radix 测试环境 |
| C. 桌面团队成员导航 | 指定 `teamKey + memberSlug` 能打开既有团队详情并选中成员；catalog 延迟/成员不存在时不误选 | 增加 `use-agent-team-navigation` 或等价桌面导航测试，并覆盖真实回调接线 | 不新增；沿用 Vitest 与现有 Electron host |
| D. 产品行为与回归 | 中英文文案、产品事实源、Popover 和详情页在真实应用中闭环 | 扩展 `scripts/acceptance/console-dashboard-ui.ts` 的真实 Electron 用例；随后执行步骤 4 全量回归并与步骤 1 基线对比 | 不新增；复用现有 acceptance harness |

本方案阶段尚未执行上述 change 专项测试；实现前的基线证据仍是步骤 1 记录的全量测试、桌面构建和 typecheck 结果。

## 权衡

- 选择历史 `ownership:id` 而不是当前会话团队：需求要求对应 run 的团队；当前团队可能已被修改或切换，用它会把历史身份错误导航到别处。
- 选择一个 `onOpenAgentTeamMember` 语义回调而不是在 Popover 内先调用“打开团队”再调用“选择成员”：两步组合会暴露跨层状态时序，且 catalog 尚未加载时容易丢目标；原子意图与现有 desktop 导航 hook职责一致。
- 选择复用团队详情页成员选择而不是新增 Agent 页面：`docs/product/pages/agent-teams.md` 已明确 Agent 详情属于团队详情内的成员选择，新增路由会制造第二套编辑与加载状态。
- 选择保留历史 Markdown 后端接口而暂不清理：用户只要求替换 UI 去向；删除接口会扩大运行时 API、测试和兼容范围，且不影响本次验收。

## 风险

- 旧历史上下文可能没有稳定团队键，导航动作只能缺省；回退策略是不使用当前团队，避免错误归属。
- Popover 在活动 run 尚未结束时加载的 audit info 仍需走现有 session/run 隔离与迟到响应保护；复用现有 loader 生命周期，不另写异步状态机。
- 活动 run 的 profile 增加到 snapshot 是内存/API 投影变更，无持久化迁移；若旧客户端忽略该可选字段，仍由 roster engine 降级显示。

## 方向性风险判定

无方向性风险。方向选择均有本项目依据并已完成源码核查：

- `LocalConsoleAgentTeamSnapshot.team` 已提供 `ownership` 与 `id`，且 `snapshotSummaryToOperatorTeam` 与 `getAgentTeamKey` 已采用 `ownership:id`。
- `useAgentTeamNavigation` 已集中管理 `activeTeamKey`、成员选择与延迟加载；`AgentTeamsPage` 已通过 `selectedMemberSlug`呈现团队内成员详情。
- `AgentPortrait`、`ProviderMark`、`AgentRunInfoPopover` 已是现有生产组件，所需 Provider 标识和 run 信息加载能力已经存在。

没有“仅为惯例、且无法从本项目输入推出”的方向选择类条目，因此不需要 spike；已用源码核查关闭方向判断，不把未执行 spike 写成技术验证结果。

## 遗留事项（方案阶段）

- 评审提醒 #4：已采纳；已统一补充每条选型的“本项目约束 → 采纳结论”，并补齐每个变更单元的测试映射。
- **未验证**：本 change 的 Provider 默认标识、活动头像 Popover、团队成员跳转和真实 Electron 闭环尚未实现，尚无专项测试输出；按步骤 3/4 执行后更新。
- **未验证**：`openspec/specs/console-ui` 的 `spec-delta` 尚未回流；按 OpenSpec 规则待实现并验证后归档。
- **待核实**：存量 session 中缺少 `teamSnapshot.team` 稳定身份的 run 数量尚未统计；实现不依赖统计结果，统一采取“不回退当前团队”的安全处理。
- 旧 run 没有稳定团队键时不提供 Agent 详情跳转；后端历史 Markdown 接口暂保留但不再由生产 UI 调用。

本方案经评审交接后自主定稿，按纪律第 3 条分级作为基准。
