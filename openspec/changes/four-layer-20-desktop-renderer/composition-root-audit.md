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
控制分支 0。文件包含 9 次具名 team hook 装配、纯 detail selector 与具名 view intents；不注册 effect，
团队列表的 `ready` 状态形状由 `useAgentTeamCatalog` 内部的 `replaceTeams` 能力负责，builder 草稿
storage key 由 domain constants 提供。

## `desktop/src/console-page/use-desktop-runtime-bridge.ts`

| 行 | 条件 | 分类 | 处置 |
| --- | --- | --- | --- |
| 36 | `resolution.kind === "commit"` | timing | API base resolution 由 domain plan 给出，只提交当前 resolution |
| 37 | `resolution.kind === "read-preload"` | timing | 仅在 domain plan 要求时启动 preload read |
| 39 | `decideDesktopAsyncCommit(cancelled, Boolean(fromPreload)) === "commit"` | timing | 卸载后的 preload 返回不得提交 |
| 49 | `load.kind === "skip"` | timing | API base 未就绪时保持 loading，不启动 registry request |
| 60 | `decideDesktopRegistryCommit(controller.signal.aborted) === "commit"` | timing | 仅当前 registry 请求可提交成功 |
| 64 | 同上 | timing | 仅当前 registry 请求可提交失败 |
| 74 | `decideDesktopAsyncCommit(cancelled, true) === "commit"` | timing | 卸载后的 capability 返回不得提交 |
| 82 | `update.apiBase !== null` | timing | status plan 有新 endpoint 时才替换 |
| 83 | `update.error !== null` | timing | status plan 有错误时才提交 |

复算：wiring 0 + timing 9 + business 0 = AST 控制分支 9。API/base、registry、capability 与 runner status
只做异步时序协调；所有接受/忽略判据委托 `desktop-runtime-bridge-model.ts`。

## `desktop/src/console-page/use-desktop-shell-actions.ts`

| 行 | 条件 | 分类 | 处置 |
| --- | --- | --- | --- |
| 14 | `availability === "unavailable"` | wiring | status page preload 能力未注入时不暴露 intent |
| 19 | `availability === "unavailable"` | wiring | Claude update preload 能力未注入时返回稳定错误 |
| 27 | `availability === "unavailable"` | wiring | external-link preload 能力未注入时不暴露 intent |

复算：wiring 3 + timing 0 + business 0 = AST 控制分支 3。三个分支均消费 domain availability plan，
不比较业务字段。

## `desktop/src/console-page/use-console-selection-state.ts`

| 行 | 条件 | 分类 | 处置 |
| --- | --- | --- | --- |
| 73 | `persistence === "skip"` | business | selection persistence decision 由 domain 决定 |
| 93 | `decision.action === "remember"` | business | startup selection plan 决定持久化动作 |
| 94 | `decision.action === "forget" || decision.action === "open-new-conversation"` | business | 同一 domain result 的 forget 分派（外层条件） |
| 94 | 同上 | business | 同一 domain result 的 forget/open 析取条件 |
| 97 | `decision.action === "open-new-conversation"` | business | domain result 决定是否恢复新会话草稿 |

复算：wiring 0 + timing 0 + business 5 = AST 控制分支 5。所有 selection、route 与 startup action 均由
`selection-preference.ts` 的 `decide*`/`plan*` 结果分派。

## `desktop/src/console-page/use-console-state-actions.ts`

| 行 | 条件 | 分类 | 处置 |
| --- | --- | --- | --- |
| 44 | `next === null` | business | domain metadata plan 无可提交 state 时跳过 |
| 68 | `decideProjectFolderSelectionAvailability(...) === "unavailable"` | wiring | preload folder capability 未注入时不暴露 port |

复算：wiring 1 + timing 0 + business 1 = AST 控制分支 2。文件只装配 `ConsoleStateActions` 及其窄 ports。

## 零分支 console facades

`use-console-presentation.ts` 与 `use-conversation-composer.ts` 均无 AST 控制分支。各自复算均为
wiring 0 + timing 0 + business 0 = AST 控制分支 0；前者组合纯 presentation plans 与两个 attachment
preview controller，后者组合持久 draft port 与纯 draft state transitions。

## `desktop/src/console-page/use-sidebar-draft-close.ts`

| 行 | 条件 | 分类 | 处置 |
| --- | --- | --- | --- |
| 21 | `draftId === null` | business | domain tab locator 判定非 draft tab 时直接允许关闭 |
| 26 | `attachmentDraftKey === null` | business | domain draft-key plan 决定是否查询附件 |
| 28 | `decision === "retain"` | business | domain close decision 判定无可关闭 draft |
| 29 | `decision === "confirm" && !confirmDiscard(...)` | business | domain close decision 要求确认且用户拒绝（外层条件） |
| 29 | 同上 | business | confirm 与用户结果的析取条件 |
| 34 | `attachmentDraftKey !== null` | business | domain draft-key plan 决定是否清附件 |

复算：wiring 0 + timing 0 + business 6 = AST 控制分支 6。draft 身份、确认要求和附件 key 均先由
`sidebar-draft-model.ts` 计划，application 只执行删除顺序。

## `desktop/src/console-page/use-console-attachment-drafts.ts`

| 行 | 条件 | 分类 | 处置 |
| --- | --- | --- | --- |
| 44 | `decision === "skip"` | timing | presence 没有版本变化时不重复发布 sidebar draft 列表 |

复算：wiring 0 + timing 1 + business 0 = AST 控制分支 1。三个 attachment controller 的 owner key 由
`managed-attachment-model.ts` 统一计划，facade 不自行判断草稿归属。

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
navigation、conversation-analysis、searched-session、new-conversation launcher 与 edit-resend 八个具名 application bundle；目标预加载、
异步 reference、草稿规划、搜索恢复、source migration 和 selection mutation 仍分别由独立 controller/domain modules 持有。该 facade 继续登记为
application file，不进入 composition-root allowlist。

## `desktop/src/console-page/use-session-console.ts`

该 session 子树 facade 没有 AST 控制分支，故无逐行条件表。复算：wiring 0 + timing 0 +
business 0 = AST 控制分支 0。文件只装配 session-run、sidebar-message 与 sidebar-draft 三个具名
application bundle；发送可用性、草稿内容、promotion 路由和 sidebar view 刷新判据仍由独立 domain models 持有。该 facade
继续登记为 application file，不进入 composition-root allowlist。
