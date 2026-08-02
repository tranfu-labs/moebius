# Composition root 条件分类审计

口径与系列 design §3.3 一致：TypeScript AST 的 `if` / ternary / loop condition / case / `&&` / `||` /
`??` 全量逐行分类，wiring + timing + business 必须等于 AST 条件总数。

## `desktop/src/onboarding/register.ts`

| 行 | 条件 | 分类 | 处置 |
| --- | --- | --- | --- |
| 22 | `input.readiness ?? new OnboardingCliReadinessService()` | wiring | 可选注入或创建默认 readiness adapter |
| 23 | `input.installer ?? new OnboardingCliInstallManager(...)` | wiring | 可选注入或创建默认 installer adapter |
| 42 | `onboardingChannel === undefined` | wiring | 内部 channel map 完整性 guard，不读取业务字段 |
| 48 | `input.teamBuilder ?? new AiTeamBuilder(...)` | wiring | 可选注入或创建默认 builder application |

复算：wiring 4 + timing 0 + business 0 = AST 控制分支 4。文件只组装依赖和 channel adapter；没有
业务判据留在 composition root。

## `desktop/src/console-page/desktop-application-root.tsx`

| 行 | 条件 | 分类 | 处置 |
| --- | --- | --- | --- |
| 58 | `useContext(DesktopLanguageContext) ?? FALLBACK_DESKTOP_LANGUAGE` | wiring | Context 消费者脱离 Provider 时注入静态 fallback bundle；不读取业务字段，不改变路由或持久化决策 |

复算：wiring 1 + timing 0 + business 0 = AST 控制分支 1。语言持久化与重试由
`useDesktopLanguageController` 调度并委托 `language-state.ts` 的 `plan*` 决策；首次启动、完成与 replay
路由由 `DesktopRoutesController` / `OperatorConsoleRoute` 调度并委托 `desktop-routing-model.ts`。root
仅装配具名 `languageBundle`、i18n Provider、HashRouter 与 route controller。

## `desktop/src/console-page/use-agent-team-console.ts`

该 facade 没有 AST 控制分支，故无逐行条件表。复算：wiring 0 + timing 0 + business 0 = AST
控制分支 0。文件包含 9 次具名 team hook 装配和一次 memo 化透传；不持有业务状态、不注册 effect，
团队列表的 `ready` 状态形状由 `useAgentTeamCatalog` 内部的 `replaceTeams` 能力负责，builder 草稿
storage key 由 domain constants 提供。

## `desktop/src/console-page/use-console-attachment-drafts.ts`

该 attachment 子树 facade 没有 AST 控制分支，故无逐行条件表。复算：wiring 0 + timing 0 +
business 0 = AST 控制分支 0。文件只把 main、sub-session、sidebar 三个 draft key 装配到既有
`useManagedAttachmentDrafts` controller，并 memo 化三个具名 bundle；上传、恢复、替换、preview 与
presence generation 的规则仍由原 controller/domain modules 持有。

## `desktop/src/console-page/use-right-sidebar-process-data.ts`

该 process-data 子树 facade 没有 AST 控制分支，故无逐行条件表。复算：wiring 0 + timing 0 +
business 0 = AST 控制分支 0。文件只装配 `useProcessOutputData` 与
`useProcessInvocationData` 两个具名用例 bundle；append/settled/history merge 判据位于
`console-process-model.ts`，请求 generation、取消和 host reset 分别由两个 controller 持有。

## `desktop/src/console-page/use-right-sidebar-console.ts`

| 行 | 条件 | 分类 | 处置 |
| --- | --- | --- | --- |
| 49 | `active.conversation?.kind === "session"` | wiring | domain planner 已把 active tab 解析为具名 source；facade 只把 session source 接入 conversation-view controller |

复算：wiring 1 + timing 0 + business 0 = AST 控制分支 1。文件只装配 tabs、conversation views 与
process data、project files 四个具名 bundle，并在 host 切换时清空旧 sub-session view；active tab 类型与 source
解析由 `right-sidebar-tabs-model.ts` 的 `planRightSidebarActiveSources` 持有。该 facade 仍登记为
application file，接受比 composition-root allowlist 更强的 shape 门禁。

## `desktop/src/console-page/use-conversation-console.ts`

该 conversation 子树 facade 没有 AST 控制分支，故无逐行条件表。复算：wiring 0 + timing 0 +
business 0 = AST 控制分支 0。文件只装配 transition、navigation、new-submission、analysis
navigation、conversation-analysis 与 searched-session 六个具名 application bundle；目标预加载、
异步 reference、草稿规划、搜索恢复和 selection mutation 仍分别由独立 controller/domain modules 持有。该 facade 继续登记为
application file，不进入 composition-root allowlist。

## `desktop/src/console-page/use-session-console.ts`

该 session 子树 facade 没有 AST 控制分支，故无逐行条件表。复算：wiring 0 + timing 0 +
business 0 = AST 控制分支 0。文件只装配 session-run、sidebar-message 与 sidebar-draft 三个具名
application bundle；发送可用性、草稿内容、promotion 路由和 sidebar view 刷新判据仍由独立 domain models 持有。该 facade
继续登记为 application file，不进入 composition-root allowlist。
