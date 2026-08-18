# console-ui 规格

## Purpose

`console-ui` 是桌面对话操作台的生产 UI 层与开发期展示台。它提供可被 Electron renderer 消费的 shadcn 风格源码组件、Radix 无障碍原语封装、Tailwind 语义令牌（近黑底暗色优先 + 状态色相族），以及由 Component、Block 到 Page/Screen 的项目专属组合；它不承载真实桌面对话操作台的数据流、IPC、runner 状态管理或 GitHub / Codex 调用。

## Requirements

### Requirement: Package boundary and Storybook source of truth

The `console-ui` domain MUST provide a workspace package named `@moebius/console-ui` under `packages/console-ui`.

The `console-ui` package MUST expose React components and global styles so the desktop renderer can import `@moebius/console-ui` and `@moebius/console-ui/globals.css`.

The `console-ui` package MUST use shadcn-style source components built on Tailwind CSS variables and Radix primitives, with component source checked into this repository rather than hidden behind a runtime UI package.

The `console-ui` package MUST provide Storybook as the only development-time browser showcase for production console UI. Its catalog MUST classify every Story under exactly one of `Component`, `Block`, or `Page`: Components are individually reusable controls or focused content units, Blocks compose components into a bounded product region, and Pages compose production exports into a complete screen state.

The `console-ui` package MUST include at least one Story in each catalog layer. A mature production page MUST provide a deterministic Page Story by default, and every Page Story MUST use Storybook's fullscreen layout.

The `console-ui` package MUST keep Storybook under `packages/console-ui` as the only shipped browser showcase for this domain.

The `console-ui` package MUST NOT keep a parallel static Tailwind HTML component library or editable/generated `*.ui.html` page as a second UI source of truth.

Stories MUST render real exports from `packages/console-ui` with deterministic fixtures and MUST NOT connect to real IPC, runner, SQLite, Codex, GitHub, filesystem capabilities, or user data. Page Stories verify production composition and deterministic visual states; the desktop application remains responsible for real IPC, data flow, persistence, renderer integration, and final runtime verification.

#### Scenario: Renderer can consume the component library

- **GIVEN** a desktop renderer needs console UI components
- **WHEN** it imports `@moebius/console-ui` and `@moebius/console-ui/globals.css`
- **THEN** it can render React components with the package-local global styles.

#### Scenario: Storybook shows all catalog layers

- **GIVEN** a developer runs `pnpm --filter @moebius/console-ui storybook`
- **WHEN** Storybook starts
- **THEN** the browser showcase includes Component, Block, and Page sections
- **AND** every mature production page Story renders real production exports with deterministic fixtures and fullscreen layout.

#### Scenario: Desktop owns runtime integration

- **GIVEN** a Page Story demonstrates a complete production screen
- **WHEN** its acceptance boundary is inspected
- **THEN** it contains no real IPC, runner, database, filesystem, Codex, GitHub, or user-data integration
- **AND** those integrations are verified in the desktop application.

### Requirement: Compiled global-style package boundary

The `console-ui` package MUST compile its Tailwind directives and `@apply` rules during package build and MUST expose the compiled stylesheet as `@moebius/console-ui/globals.css`.

The desktop renderer MUST consume the compiled package stylesheet and MUST NOT rely on Chromium to interpret Tailwind build directives.

The desktop renderer host stylesheet MUST remain limited to window/root hosting concerns and MUST NOT duplicate component layout, button, textarea, card, badge, sidebar, or composer styling owned by `console-ui`.

The desktop build MUST fail when its emitted renderer stylesheet still contains Tailwind build directives or does not contain representative `console-ui` utilities.

#### Scenario: Desktop renderer receives compiled component styles

- **GIVEN** the desktop renderer imports `@moebius/console-ui/globals.css`
- **WHEN** the desktop application is built
- **THEN** the emitted renderer stylesheet contains the component library token and utility styles
- **AND** it contains no `@tailwind` or `@apply` build directives.

#### Scenario: Desktop host CSS does not become a second component library

- **GIVEN** the desktop console page has a host stylesheet
- **WHEN** its selectors are inspected
- **THEN** it only establishes window/root hosting behavior
- **AND** component visual and layout rules remain owned by `console-ui`.

### Requirement: Design language governance

The `console-ui` package MUST keep `packages/console-ui/DESIGN.md` as the package-local design language fact source covering token usage discipline, typography rules, icon rules, status semantics and hue budget, elevation/focus/motion rules, and a catalog of component patterns pointing at the component source files that implement them.

New or modified components under `packages/console-ui` MUST compose the tokens, status semantics, and patterns recorded in `packages/console-ui/DESIGN.md` rather than introducing ad-hoc visual values; when a genuinely new pattern is introduced, the same change MUST add it to `packages/console-ui/DESIGN.md`.

`DESIGN.md` MUST record its external design references by link and attribution only, and MUST NOT vendor third-party design specification content.

#### Scenario: New component follows the design language

- **GIVEN** a developer adds a new console UI component
- **WHEN** the component and `DESIGN.md` are inspected
- **THEN** the component composes existing tokens and status semantics without hard-coded visual values
- **AND** any pattern not previously cataloged has been added to `DESIGN.md` in the same change.

### Requirement: Token system with status hue family

Source: docs/product/prd.md#视觉语言原则

The `console-ui` package MUST keep `packages/console-ui/src/styles/tokens.css` as the package-local token source: cool-tinted neutral surfaces and text dominate, indigo `#5E6AD2` is the single interaction accent in both light and dark themes, and green/red remain reserved for verdict and danger facts.

The token source MUST define a status hue family for runtime status pills — amber for running, blue for pending, violet for waiting, and a neutral tint — with foreground, tinted background, and same-hue border values defined for BOTH light and dark themes in the same change.

The token source MUST define the dark canvas near `#0A0B0D` with card surfaces near `#15161A` and visibly stronger borders than the previous near-monochrome baseline, and MUST set the corner-radius base token to 14px with derived steps computed from it.

The token source MUST define a per-theme accent hover color (`#4B57C8` darker in light, `#828FFF` brighter in dark), a multi-layer popover shadow token, a double-layer indigo focus ring token, and motion tokens (150ms default duration with an easeOutQuad-style curve, plus a slower entrance curve).

Dark-theme elevation MUST be expressed through luminance stacking (progressively lighter translucent surfaces and inset hairlines) rather than heavy drop shadows.

The `console-ui` package MUST map core shadcn semantic variables (`--background`, `--foreground`, `--primary`, `--border`, `--muted`, `--destructive`, `--ring`) onto the console token variables in `globals.css`.

The `console-ui` package MUST self-host Inter Variable (woff2 subset with the wght axis and `cv01`/`ss03` OpenType features, OFL 1.1) as the primary Latin typeface with system CJK fallback; UI emphasis text MUST use weight 510 and titles weight 590; body text below 16px MUST use zero letter-spacing.

The `console-ui` package MUST render waiting-for-human review surfaces as neutral surfaces with neutral waiting iconography.

The `console-ui` package MUST render pass/fail verdicts as pass/failed status pills (green/red) on acceptance surfaces.

The `console-ui` package MUST render submit actions using indigo as an interaction color rather than a waiting-state color.

A red unread-count badge MAY use the danger hue as the single registered exception to verdict/danger exclusivity; all other uses of green/red outside verdict, danger, and this exception MUST NOT be introduced.

Icons across the package MUST use 16px default size with 1.5px stroke width.

#### Scenario: Waiting-for-human state stays neutral

- **GIVEN** an acceptance card is rendered for a waiting-for-human review
- **WHEN** the component is inspected
- **THEN** the card remains a neutral surface with neutral waiting iconography, pass/fail verdicts use pass/failed status pills, and the submit action uses indigo as an interaction color.

#### Scenario: Interactive accent is indigo in both themes

- **GIVEN** the console renders in light theme and in dark theme
- **WHEN** primary buttons, links, and focus rings are inspected
- **THEN** the accent is `#5E6AD2` in both themes, hover moves to `#4B57C8` in light and `#828FFF` in dark, and focus rings use the double-layer indigo token.

#### Scenario: Status hue family exists in both themes

- **GIVEN** the token source loads
- **WHEN** running, pending, and waiting status pills render in either theme
- **THEN** each uses its own hue family (amber / blue / violet) with foreground, tinted background, and same-hue border tokens defined for that theme
- **AND** no status hue token is defined for only one theme.

### Requirement: No runner or desktop integration dependencies

The `console-ui` package MUST stay free of runner, observer, GitHub, Codex, `.state`, and IPC dependencies.

The `console-ui` package MUST NOT implement real desktop console app state management, renderer bundling, IPC, or runner/state-file integration in this domain.

#### Scenario: Console UI remains presentational

- **GIVEN** a component under `packages/console-ui/src`
- **WHEN** its imports are inspected
- **THEN** it does not import runner, observer, GitHub, Codex, `.state`, IPC, or desktop main-process modules.

### Requirement: Operator console presentational components

The `console-ui` package MUST provide presentational React components for the local operator console: project/session sidebar, session timeline, user/agent/system message rows, run live block, local error/interrupted/stuck records, message composer, and diagnostic action affordances.

The operator console components MUST remain controlled by props and callbacks supplied by the desktop renderer.

The operator console MUST render running states with a non-empty summary and an interrupt action when `interruptible` is true.

The operator console MUST render interrupted and stuck runs distinctly from failed runs; interrupted runs must use neutral status styling, stuck runs must be visibly marked as stuck, and failed runs must use danger fact styling.

The operator console MUST render failed local errors visibly with a reason.

The operator console MUST support a controlled list of local projects and render sessions under their owning project while preserving the project-to-session hierarchy.

Selecting a project or a session and creating a session for a project MUST flow through callbacks with an explicit project id.

The operator console MUST render each project title from the real directory title supplied by local console state and MUST expose folder opening through a callback rather than filesystem or Electron access.

Workspace mode mutation MUST remain a controlled callback. A `not-git-repository` workspace-unavailable reason MUST remain distinct from running, waiting, stuck, failed, and interrupted session states wherever diagnostics present it.

The operator console MUST render tail-read fallback or diagnostic copy without leaving the run live block blank.

#### Scenario: Run live block is non-empty

- **GIVEN** a run live block receives a running snapshot with no parseable output
- **WHEN** it renders
- **THEN** it displays a deterministic running summary and no empty card.

#### Scenario: Interrupted, stuck, and failed states are distinct

- **GIVEN** one timeline record is interrupted, another timeline record is stuck, and another timeline record is failed
- **WHEN** the timeline renders
- **THEN** the interrupted record uses neutral status styling, the stuck record is visibly marked as stuck, and the failed record uses danger fact styling.

#### Scenario: Multiple projects preserve session ownership

- **GIVEN** the operator console receives two local projects whose sessions have running, stuck, failed, and idle states
- **WHEN** the sidebar renders
- **THEN** it shows both real project titles, every session under its owning project, and visible state indicators for running, stuck, and failed sessions
- **AND** selecting a project or session calls the supplied callback with explicit ownership context.

### Requirement: Project-scoped new sessions and empty-session project switching

The operator console MUST provide a project-specific new-session button on every project folder row and MUST pass that row's project id through a controlled callback.

The operator console MUST NOT depend on an implicitly selected project to decide the destination of a project-row new-session action.

For a selected session with no messages, active run, parent, or child relationship, the composer project context MUST expose an accessible menu of opened projects, mark the current project, and pass the session id plus target project id through a controlled callback.

The composer draft MUST remain controlled by the renderer and MUST survive a successful project rebind. Once a session has messages, an active run, a parent, or children, the project context MUST remain visible but MUST NOT expose a project-switch menu.

### Requirement: Selection mutation serialization

While create session, open project, or session project rebind is pending, the operator console MUST disable sidebar session selection, project-row new-session buttons, the open-project button, and the project-switch menu.

The renderer callback/handler boundary MUST reject selection intents that arrive while another selection-changing mutation owns the gate; disabled presentation alone is not a correctness boundary.

At most one selection-changing mutation may open a picker or send an API request at a time, and only its owner may commit the target selection.

During a selection mutation, non-owner refreshes MUST NOT commit state or selection. The owner target refresh MUST be able to replace an older refresh lease, while periodic refresh remains single-flight so a slow request is not starved by the next polling tick.

Mutation cancellation or failure before API success MUST preserve the original selection. If the API succeeds but the following refresh fails, the target selection MUST remain committed so a later refresh can recover from it.

During session project rebind, the project menu and send action MUST be disabled, and the submit handler MUST reject a first-message callback until rebind settles.

#### Scenario: Project row creates a session for that project

- **GIVEN** the sidebar receives two projects
- **WHEN** the user activates the new-session button on the second project row
- **THEN** the controlled callback receives the second project id
- **AND** no callback is emitted for the first project.

#### Scenario: Empty session changes project without losing its draft

- **GIVEN** the selected session has no messages, active run, parent, or children
- **WHEN** the user selects another project from the composer project menu
- **THEN** the callback receives the selected session id and target project id
- **AND** the composer draft remains unchanged.

#### Scenario: Historical or related session keeps project locked

- **GIVEN** the selected session has messages, an active run, a parent, or children
- **WHEN** the composer context renders
- **THEN** the current project remains visible
- **AND** no project-switch menu is available.

#### Scenario: Selection-changing mutations remain serialized

- **GIVEN** a create session, open project, or session project rebind mutation is pending
- **WHEN** another selection, creation, project opening, project rebind, refresh, or first-message intent arrives
- **THEN** it cannot commit a second selection or duplicate side effect
- **AND** only the owner mutation may commit its target selection and refresh result.

### Requirement: 导航失败恢复完整组合现场

Source: docs/product/pages/main-left-sidebar.md#选择对话

普通、搜索和 hosted 分析导航的必要请求失败或过期时，操作台 MUST 恢复进入导航前的 selection、主内容 route、右栏 visibility、host session、tabs 文档、active tab、草稿和阅读位置；成功导航 MUST 只提交一次目标现场。

#### Scenario: 普通目标加载失败

- **GIVEN** 原会话右栏打开且存在 active tab
- **WHEN** 用户打开普通目标且目标加载失败
- **THEN** 原 selection、主内容、右栏开合、host、tabs 文档、active tab、草稿和阅读位置保持不变
- **AND** 页面显示可理解的失败反馈。

#### Scenario: Hosted 分析目标加载失败

- **GIVEN** 用户从搜索或分析入口进入 hosted 目标
- **WHEN** 目标请求失败或过期
- **THEN** 原组合现场完整恢复
- **AND** 目标导航过程中写入的 tabs 不残留。

### Requirement: Root session rail with persisted runtime lineage

The operator console MUST render only root sessions whose persisted summaries have no `parentSessionId` in the primary sidebar rail. Derived sessions MUST be reachable from their parent timeline card and MUST NOT render as sidebar rows or lineage labels.

Runtime lineage MUST remain persisted for orchestration and recovery, and MUST NOT produce indentation, tree connectors, expand/collapse controls, child-count summaries, parent breadcrumbs, or duplicate child entry points in the primary sidebar.

The operator console MUST keep root-session selection stable after refresh. Missing, cyclic, self-referential, or otherwise corrupt non-root references MUST remain bounded and MUST NOT force a derived session into the sidebar.

- MUST render visible root session rows within a project in stable `createdAt` DESC order.
- MUST NOT reorder root session rows based on session status changes, active runs, streaming output, unread results, human-attention needs, or timer updates.
- MUST NOT render a fixed "completed" grouping or auto-collapse group in the sidebar.
- MUST require an explicit user archive action to remove a root session from the sidebar; archived root sessions MUST NOT be shown in the primary sidebar rail.

#### Scenario: Session order is stable under state changes

- **GIVEN** a project has multiple sessions displayed in the sidebar
- **WHEN** any of those sessions starts running, produces a new agent result, becomes selected, or requires human attention
- **THEN** the display order in the sidebar remains unchanged
- **AND** only the row-level status indicator updates.

#### Scenario: No completed folding group

- **GIVEN** a project has sessions whose backend lifecycle is terminal
- **WHEN** the sidebar renders that project
- **THEN** no "completed" collapse control or grouping appears
- **AND** those sessions render as ordinary rows with no status dot unless archived.

#### Scenario: Derived sessions use the parent timeline card

- **GIVEN** a project has an original session and derived sessions whose `parentSessionId` references the original
- **WHEN** the operator console sidebar renders
- **THEN** only the original root session appears in the sidebar
- **AND** the derived sessions remain available from the parent timeline card without a lineage label or tree control.

#### Scenario: Corrupt lineage stays bounded without creating sidebar rows

- **GIVEN** flat session summaries contain a parent cycle, self-parent reference, or missing parent reference
- **WHEN** the operator console sidebar renders
- **THEN** rendering completes without a derived sidebar row or duplicate entry point
- **AND** valid root sessions remain selectable.

### Requirement: Conversation status dot semantics

Source: docs/product/pages/main-left-sidebar.md#对话状态点与顺序

会话点 MUST 以未确认 attention、控制工作、任意未读依次派生 red、blink、blue、none；项目聚合 MUST 排除置顶会话并按 red、blue、blink、none 选择。点与菜单辅助名称 MUST 分别为“需要你处理”“未读”“正在运行”。

收束后投影 MUST 区分需要用户处理与其它收束：`awaiting-user` 收束 MUST 点亮 red；`silent-closeout`（静默兜底）MUST NOT 单独点亮 red——真实异常会话的红点由未确认 attention / unresolvedSystemEventKind 承担，升级前被追溯落盘的 silent-closeout 因此不再把静止历史会话点亮。`completed` / `no-new-content` 收束 MUST 按未读派生 blue / none。

#### Scenario: 静默兜底收束不点亮静止历史会话

- **GIVEN** 一段会话只有一条升级前追溯落盘的 `silent-closeout` 事实且没有未确认异常
- **WHEN** 侧栏渲染该行
- **THEN** 行显示无点
- **AND** 项目聚合不因该会话出现红点。

#### Scenario: 静默兜底收束不掩盖真实异常

- **GIVEN** 一段会话有未确认的 run 异常事实（attention / unresolvedSystemEventKind）与一条 `silent-closeout` 事实
- **WHEN** 侧栏渲染该行
- **THEN** 行仍显示红点（来源为未确认异常，而非收束结论本身）。

#### Scenario: 手动未读不是 Agent 新结果

- GIVEN 用户把静止会话标记为未读且没有 Agent 新结果
- WHEN 侧栏渲染该行
- THEN 行显示蓝点且辅助名称为“未读”
- AND 不声称 Agent 有新结果。

### Requirement: Collapsed project status aggregation

- MUST allow each project row to be independently collapsed or expanded by the user.
- MUST NOT show a per-session status dot on the project row while the project is expanded.
- MUST show a single aggregated dot on a collapsed project row using the same `red > blue > blink` priority derived only from unpinned sessions still inside that project section.
- MUST NOT show a numeric count of unread or running sessions on the project row.
- MUST allow the project containing the currently selected session to be manually collapsed; the main content MUST continue showing the selected session and MUST NOT auto re-expand the project.
- MUST NOT change the currently selected session as a result of collapsing or expanding a project.

### Requirement: 置顶迁移与菜单矩阵

Source: docs/product/pages/main-left-sidebar.md#置顶区

侧栏 MUST 在应用级入口下方和项目区上方显示非空置顶区。置顶会话 MUST 只出现一次；菜单 MUST 按最终点显示对应阅读操作。持久化失败或陈旧状态 MUST 保留原行、原点和原菜单语义。

#### Scenario: 取消置顶回到折叠项目

- GIVEN 置顶会话所属项目已折叠
- WHEN 用户通过键盘取消置顶成功
- THEN 会话按原创建时间归位且不重复
- AND 焦点落到所属项目展开控件。

### Requirement: 一份共享对话信息浮层

Source: docs/product/pages/main-left-sidebar.md#对话行

整份侧栏 MUST 同时最多渲染一份对话信息浮层，并在目标行变化时沿纵轴跟随、原位替换完整标题、文件夹名称和实际工作空间分支。非 Git MUST 省略第三行；detached 与不可读 MUST 使用明确文本。菜单、重命名、离开区域和 reduced-motion MUST 按 PRD 收敛。

#### Scenario: 从 A 连续移动到 B

- GIVEN A 与 B 的文件夹或分支不同
- WHEN 指针从 A 移到 B
- THEN 可见浮层 DOM 数量始终不超过一
- AND 最终内容和位置只对应 B。

### Requirement: 重命名在所有生产入口一致呈现

Source: docs/product/pages/main-left-sidebar.md#重命名对话

重命名弹层 MUST trim 非空输入、允许重名、保存失败保留输入。成功后侧栏、主标题、搜索和右栏标签 MUST 使用 canonical 新标题；任何局部读取失败 MUST NOT 回显旧标题，并 MUST 显示非阻断说明、自动重读路径及持续失败时可用的手动重试入口。

#### Scenario: 标题已经保存但右栏暂时不可读

- GIVEN canonical 标题已变为 B 且某会话标签无法解析
- WHEN 标签组呈现
- THEN 原标签显示“标题更新中”和稳定区分信息
- AND 重试成功后同一标签原位显示 B。

### Requirement: 同名会话标签稳定可辨并保持横向位置

Source: docs/product/pages/main-right-sidebar.md#会话重命名同步

同名会话标签 MUST 显示稳定、用户可读且辅助名称一致的区分信息；同项目、同分支、同一分钟或多个标题无法解析时 MUST 使用稳定“同刻第 N 个”最终兜底。标题宽度变化时，选中或键盘聚焦标签 MUST 完整可见；后台标签更新 MUST NOT 抢占横向位置。

#### Scenario: 两个标题更新中标签

- GIVEN 同一组两个不同会话均无法读取标题
- WHEN 标签条显示两个“标题更新中”
- THEN 可见第二行和辅助名称均以不同“同刻第 N 个”稳定区分两者。

### Requirement: Sidebar collapse, restore, and layout memory

- MUST provide a `关闭侧边栏` control fixed in the sidebar header that hides the sidebar when activated.
- MUST define one shared 46px window header height, reserve the macOS traffic-light safety area in that dedicated top row, render only the sidebar close control in that row, vertically center the native traffic lights and controls through the shared header container without per-control offsets, and render the product logo and brand in a separate row below it.
- MUST provide a `打开侧边栏` control fixed in the main content when the sidebar is hidden, functional and not a decorative placeholder.
- MUST position the `打开侧边栏` control to the right of the macOS traffic-light safety area and vertically center it with the native traffic lights when the sidebar is hidden.
- MUST expand the main content region to reclaim the space when the sidebar is hidden.
- MUST persist the last explicit user choice of collapsed/expanded across app restarts.
- MUST keep the sidebar visible during the first-run onboarding regardless of the persisted choice.
- MUST preserve the currently selected session, project expanded/collapsed state, and project list scroll offset across a collapse+restore cycle.
- MUST NOT re-mount the main content timeline or active run block as a side effect of the sidebar collapse/restore.
- MUST 在窄窗口把显式打开动作投影为覆盖主内容的左侧抽屉和遮罩，不挤压主内容，也不改写宽窗的持久化开合偏好；打开后焦点 MUST 进入关闭按钮，关闭后 MUST 回到打开按钮，并通过状态播报公开开合结果。

### Requirement: Project row menu and directory repair

- MUST provide a project row context menu with exactly these items: `在文件管理器中显示`, `修改显示名称`, `移除项目`.
- MUST render a separate red wrench button on the project row (outside the context menu) when the project folder is unavailable, with an accessible name explaining "当前项目本地文件夹未找到，可以指定新的文件夹".
- MUST NOT place directory repair inside the context menu.
- MUST route directory repair through the desktop native folder picker and MUST enforce that a single filesystem folder is bound to at most one active project.
- MUST NOT move, copy, or rename any files on disk during directory repair; only the recorded project location updates.
- MUST show both the original and newly selected locations in a confirmation surface before applying the repair.
- MUST reject remove when the project has running agents unless the user confirms an explicit "强制中止" flow that runs abort then remove as an ordered sequence; partial failures MUST NOT be reported as success.
- MUST NOT delete or modify the underlying folder on disk when a project is removed; the removal only affects moebius records.

### Requirement: Manual project reorder without a dedicated drag handle

- MUST allow the user to drag a project row to reorder projects, using the row itself as the drag surface.
- MUST NOT render a separate drag handle on project rows.
- MUST distinguish click from drag using an explicit movement threshold; a drag operation MUST NOT trigger expand/collapse on release.
- MUST persist project order across app restarts.
- MUST NOT reorder projects automatically as a result of session state changes, active runs, new results, or human-attention transitions.
- MUST place newly added projects at the top of the list, auto-expanded, and MUST make the new project the current project.
- MUST make `＋` and `⋯` buttons inside a project row independent controls whose events do not bubble to the row's click or drag surface.

### Requirement: Conversation archive without a completed lifecycle

- MUST provide an archive action reachable from a conversation row's hover, keyboard focus, or context menu.
- MUST NOT introduce a "completed" sidebar status or a completed grouping folder.
- MUST reject archive on a session that has a currently running agent; the user must interrupt or wait for the run to end.
- MUST clear any active run association and stop local handoff drain immediately when a session is archived; resuming archive MUST allow the local cursor to continue from where it stopped without duplicate processing.
- MUST, after archiving the currently selected session, select an adjacent visible session in the same project; if none remain, MUST show the project empty state.
- MUST preserve messages, execution records, and delivered artifacts of archived sessions; archived sessions MUST remain retrievable via global search.

### Requirement: Sidebar width and narrow-window auto-collapse

- MUST expose a draggable right boundary on the sidebar with enforced minimum and maximum widths.
- MUST truncate long names to a single line and MUST expose the full text via hover tooltip and accessible name.
- MUST scroll only the project list when window height is insufficient; the top actions row, sidebar close button, and bottom settings entry MUST remain reachable.
- MUST auto-collapse the sidebar when the window width drops below the main page's minimum usable width.
- MUST NOT oscillate between collapsed and expanded state when the width crosses the threshold repeatedly; the persisted user choice governs restoration when the window widens.

### Requirement: Application-level entries above the project list

- MUST render `＋ 新建对话`, `⌕ 搜索`, and `◇ Agent 团队` fixed above the project list at the same row height, text hierarchy, and interaction style; the three MUST NOT visually promote Agent 团队 over the others.
- MUST NOT nest Agent 团队 inside settings.
- MUST route `＋ 新建对话` to the new-conversation page in the main content area without persisting an empty blank session on click.
- MUST route `⌕ 搜索` to the global search surface; closing that surface MUST restore the previous sidebar selection.
- MUST route `◇ Agent 团队` to the Agent Teams surface and show a selected state on the entry while that surface is active.
- MUST keep the bottom-fixed `⚙ 设置` entry the only settings entrypoint from the sidebar; internal diagnostics identifiers such as database paths, run directories, or raw errors MUST NOT be rendered at the bottom of the sidebar.

### Requirement: 操作台提供固定的引导回看入口

Source: docs/product/pages/main-left-sidebar.md#底部应用操作

`OperatorConsole` MUST 在侧边栏底部的“设置”上方渲染受控的“重新查看引导”操作。该操作 MUST 使用与侧栏导航行一致的视觉和键盘交互模式，并 MUST 通过回调把进入意图交给 desktop renderer，而不是自行读取 marker、路由或 IPC。

#### Scenario: 键盘访问底部操作

- **GIVEN** 主页面侧边栏已打开
- **WHEN** 用户按视觉顺序遍历侧栏交互控件
- **THEN** “重新查看引导”位于“设置”之前
- **AND** 两者都有可读的辅助名称和悬停说明。

### Requirement: 引导第 1 步以三 CLI 独立状态放行

Source: docs/product/pages/onboarding.md#第-1-步-环境就绪至少一个-cli-可用

`OnboardingShell` MUST 同时渲染 Codex、Claude Code 和 Kimi 三行独立状态，并明确三者
至少一个可用即可继续。任一行 ready 时“继续” MUST 可用；三行都不 ready 时 MUST
禁用。全局“重新检查” MUST 在 checking、ready、错误和安装状态下始终可操作，并同时
刷新三行；每行状态 MUST 只由自身最新 revision 更新。

缺失行 MUST 展示该 CLI 随应用发布的安装命令和可访问安装按钮。Claude 按钮名称 MUST
为“安装 Claude Code”。needs-login、unsupported-version 与 unavailable 行 MUST 只
展示对应修复指引，不得展示安装动作；Claude unsupported-version 行 MUST 额外展示
可访问的「更新 Claude Code」按钮，并只能触发调用方提供的受信任 update action。
ready 行 MUST 展示调用方提供的真实版本；静态表面没有真实输入时 MUST 使用无版本
通用文案。

#### Scenario: Claude-only ready 立即放行

- **GIVEN** Claude Code ready 且 Codex/Kimi missing
- **WHEN** 第 1 步渲染
- **THEN** “继续”可用
- **AND** Codex 与 Kimi 行仍展示各自安装动作
- **AND** 页面明确其安装是可选的。

#### Scenario: 三行重新检查

- **GIVEN** 三行已各自有终态
- **WHEN** 用户触发“重新检查”
- **THEN** 三行分别显示当次 checking 反馈
- **AND** 任一迟到的旧 revision 不覆盖新结果。

### Requirement: 引导安装反馈持续且可访问

Source: docs/product/pages/onboarding.md#第-1-步-cli-缺失与安装中

启动安装后，对应按钮 MUST 立即禁止重复触发，行内 MUST 持续显示 starting、
downloading、installing 或 verifying 阶段，并提供确认取消。活动变化、成功、失败、
取消和超时 MUST 通过 `aria-live` 宣告；reduced-motion 下 MUST 保留非动画等价信息。

离开第 1 步后，标题栏 MUST 聚合任意 1–3 项活动任务；没有任务时 MUST 不占据状态位置。
聚合数量 MUST 随任务完成准确下降，每项阶段与取消入口仍可区分。安装成功 MUST 只刷新
对应 CLI；失败、取消和超时 MUST 保留独立重试。

#### Scenario: 三任务聚合

- **GIVEN** Codex、Claude Code 与 Kimi 安装都在运行
- **WHEN** 用户进入第 2 步
- **THEN** 标题栏显示“3 项 CLI 正在安装”的聚合入口
- **AND** 详情能区分三项自身阶段
- **WHEN** Claude 任务结束
- **THEN** 聚合数量按剩余两项更新。

### Requirement: 引导四步使用固定操作区与响应式内容轴

Source: docs/product/pages/onboarding.md#页面结构

`OnboardingShell` MUST 使用 46px 应用标题栏、四段进度、640px 常规内容列和 780px 接力／AI 建队内容列。标题栏 MUST 左侧显示品牌、中间显示活动安装聚合、右侧显示首启或回看模式；主体与 footer MUST 分离，footer 在 `1180 × 760` 和正式最小窗口 `520 × 480` 都保持完整可达，根页面 MUST NOT 产生横向或纵向滚动。短高度 MAY 压缩辅助说明与垂直留白，但 MUST 保留当前步骤标题、主操作及所有必需状态。

#### Scenario: 最小窗口仍可完成第 2 步

- **GIVEN** onboarding 运行在 `520 × 480` 且团队列表有足够内容产生滚动
- **WHEN** 用户查看第 2 步并滚动团队列表
- **THEN** 标题、搜索、团队列表、AI 建队入口和 footer 均完整可见
- **AND** 根页面没有横向或纵向滚动。

### Requirement: 引导团队选择器支持大量团队且只滚动列表

Source: docs/product/pages/onboarding.md#第-2-步-选团队

第 2 步 MUST 始终显示可按团队名称、说明、成员名称或职责过滤的搜索框，并显示“共 n 支团队”或“匹配 m / 共 n 支团队”。可用团队 MUST 按“内置团队／我的团队”分组并使用紧凑团队行；同名团队 MUST 复用稳定、用户可读且不含内部 key 或路径的辨认标签。只有团队列表 MUST 占满剩余空间并独立纵向滚动，最小高度为 120px；紧凑团队行 MUST 收敛在列表可用宽度内且 MUST NOT 产生横向滚动；搜索、计数、列表外的 AI 建队入口和全局 footer MUST 保持固定可达。

过滤 MUST NOT 取消当前选择；当前选择不匹配时 MUST 在结果外固定显示。`Escape` 和清空按钮 MUST 清除搜索且保持搜索焦点。AI 建队返回后 MUST 清除旧搜索、选中新团队并把焦点移到其团队行。默认选择 MUST 依次使用可用开发团队、第一支可用内置团队、第一支可用用户团队，完全无可用团队时 MUST 保持无选择并禁用继续。加载、目录读取失败、无可用团队和搜索无结果 MUST 是互不混淆的状态，读取失败 MUST 提供重试。

#### Scenario: 十二支团队中搜索并保留隐藏选择

- **GIVEN** 3 支内置团队和 9 支用户团队中已有一支团队被选择
- **WHEN** 搜索只匹配另一支用户团队
- **THEN** 计数显示匹配数与总数，结果按来源分组
- **AND** 原选择仍在“当前选择”分组可见且“继续”使用该选择。

#### Scenario: AI 建队返回到团队目录

- **GIVEN** 用户带着非空搜索进入 AI 建队并成功创建团队
- **WHEN** 正式团队目录返回该新团队
- **THEN** 搜索被清空，新团队可见且选中，键盘焦点位于该团队行。

### Requirement: 引导贯穿团队 CLI 兼容提示

Source: docs/product/pages/onboarding.md#第-2-步-选团队
Source: docs/product/pages/onboarding.md#第-4-步-准备就绪

onboarding 团队卡与第 4 步 MUST 根据成员 effective CLI 和 Codex/Claude Code/Kimi readiness 使用同一规则提示不兼容成员数与需要准备的 CLI，MUST NOT 静默替换成员 CLI。全兼容时 MAY 显示准备就绪；部分兼容时 MUST 使用中性状态且 MUST NOT 显示全成功大勾。相关 CLI 修复后，引导内提示 MUST 根据新 readiness 自动消失。

该提示 MUST 止于 onboarding 边界，MUST NOT 作为状态、文案或交互要求传播到新对话页。

#### Scenario: 部分兼容团队只在引导内提示

- **GIVEN** 只有 Codex ready 且所选团队有两名 Kimi 成员
- **WHEN** 用户查看 onboarding 团队卡和第 4 步
- **THEN** 两处一致提示两名成员需要 Kimi 准备
- **AND** 不改变这些成员的 CLI
- **AND** 第 4 步不显示全成功大勾。

#### Scenario: 修复后引导内提示消失

- **GIVEN** onboarding 当前选择的团队显示 Kimi 兼容警告
- **WHEN** Kimi 后台安装并 readiness 复检成功
- **THEN** onboarding 内同一团队的兼容警告自动消失。

#### Scenario: Claude 成员部分兼容

- **GIVEN** 只有 Codex ready 且所选团队有两名 Claude 成员
- **WHEN** 用户查看 onboarding 团队卡和第 4 步
- **THEN** 两处一致提示两名成员需要 Claude Code 准备
- **AND** 不改变这些成员的 CLI
- **AND** 第 4 步不显示全成功大勾。

### Requirement: 新对话不展示 CLI 准备概念

Source: docs/product/pages/main-conversation.md#选择工作空间与团队
Source: docs/product/pages/main-conversation.md#指标与验收

新对话页 MUST NOT 读取或展示 onboarding readiness，MUST NOT 显示成员准备人数、Codex/Claude Code/Kimi 准备信息、团队 CLI 兼容性提示或为解决该提示而前往 Agent 团队页的引导。该规则 MUST 对 checking、ready、missing、needs-login、unavailable、IPC 延迟、IPC 失败和迟到响应一致成立。

zh-CN 与 en locale MUST 使用同一信息边界；切换 locale、父级重渲染或导航后返回 MUST NOT 恢复旧提示 DOM 或任一语言的准备文案。

新对话发送使能 MUST 继续只依据项目、团队结构、正文/ready 附件、阻塞附件和提交状态，MUST NOT 引入 readiness 或 capability preflight。

#### Scenario: 任意 readiness 终态都没有准备提示

- **GIVEN** 正常操作台的新对话选择了包含 Codex/Claude Code/Kimi 混合成员的有效团队
- **WHEN** 上游 readiness 分别为 ready、missing、needs-login 或 unavailable
- **THEN** 页面都不显示成员准备人数、CLI 准备信息或兼容性提示
- **AND** readiness 差异不改变发送按钮状态。

#### Scenario: 冷启动未知与迟到响应不复现提示

- **GIVEN** 正常操作台冷启动且 readiness IPC 处于 checking、延迟或失败
- **WHEN** 父级多次重渲染且迟到响应随后完成
- **THEN** 新对话始终没有准备提示
- **AND** 不因该状态创建额外发送禁用原因。

#### Scenario: 中英文均无旧提示

- **GIVEN** 新对话选择了含 Codex/Claude Code/Kimi 混合成员的有效团队
- **WHEN** 页面分别以 zh-CN 与 en 渲染并发生父级重渲染
- **THEN** 两种 locale 都不存在旧兼容性提示 DOM
- **AND** 不存在成员准备人数、CLI setup/准备或前往 Agent 团队页调整的文案。
### Requirement: 引导壳区分首启与回看模式

Source: docs/product/pages/onboarding.md#重新查看引导

`OnboardingShell` MUST 通过显式输入区分 `first-run` 与 `replay`。回看模式 MUST 显示“回看引导”和可操作的“退出”，但第 4 步 MUST 与首启模式一样显示“开始使用”；首启模式 MUST 显示“首次启动”，且 MUST NOT 获得可跳过首启硬门禁的退出入口。相同 CTA 文案的完成语义 MUST 由上层 mode 回调决定，组件不得自行写 completion marker 或团队偏好。

#### Scenario: 已完成用户回看引导

- **GIVEN** shell 以 `replay` 模式渲染
- **WHEN** 用户从第 1 步进入或到达第 4 步
- **THEN** 标题栏显示“回看引导”和“退出”
- **AND** 第 4 步主 CTA 显示“开始使用”
- **AND** 页面不显示“完成回看”。

#### Scenario: 全新用户首次启动

- **GIVEN** shell 以 `first-run` 模式渲染
- **WHEN** 用户查看标题栏和第 4 步
- **THEN** 标题栏显示“首次启动”且没有退出操作
- **AND** 第 4 步主 CTA 为“开始使用”。

### Requirement: Status pill Badge baseline

Source: docs/product/prd.md#视觉语言原则

The shared `Card` primitive MUST remain a thin-border neutral surface without default shadows, using the 14px radius baseline and visibly bordered dark surfaces.

The shared `Card` primitive MUST NOT default to a floating or soft-card appearance.

The shared `Badge` primitive MUST expose variants as runtime status semantics instead of generic visual names, and MUST render every variant as a status pill: a 12px status icon plus text on a tinted background with a same-hue border and fully rounded shape.

The shared `Badge` primitive MUST cover `running`, `failed`, `waiting`, `interrupted`, `idle`, `pending`, `completed`, `displayed`, and `stuck` as status semantics used by the operator console, plus `pass` for verdict surfaces, with icon and hue following status semantics: half-pie amber for running, clock blue for pending, hollow-circle violet for waiting, dashed-circle neutral for interrupted and idle, filled-disc neutral tint for completed and displayed, crossed-circle danger for failed and stuck, and checked-circle pass green for verdict pass.

The shared `Badge` primitive MUST NOT retain `neutral`, `selected`, `accent`, or `danger` as compatibility aliases.

The shared `Badge` primitive MUST reserve pass/fail verdict coloring for acceptance verdict surfaces rather than mapping ordinary completed or displayed runtime states to verdict semantics.

#### Scenario: Badge stories show status pills

- **WHEN** the Card and Badge stories render
- **THEN** Card appears as a thin-border surface on the new radius baseline, and Badge stories show every status semantic variant as an icon-plus-text pill with its hue family.

### Requirement: Codex-native single-stream operator console

The operator console MUST use a Codex-desktop-style two-column frame consisting of an integrated project/session rail and one conversation canvas with a bottom composer.

The default conversation surface MUST NOT render a session header toolbar, aggregate passed/running/waiting counters, a persistent diagnostics button, a persistent worktree toggle, or expandable raw machine data.

User, agent, and system records MUST appear in one chronological stream. Agent identity MUST use a Linear-inbox-style row: a compact circular role avatar with a stage corner badge, the localized role name and inline state metadata on the first line, and rows separated by hairline dividers rather than floating message cards or per-agent columns.

Active runs, waiting-for-human facts, failures, stuck results, and interruptions MUST remain in the chronological stream and MUST preserve interrupt or diagnostic actions.

The bottom composer MUST display the current project and workspace context. Workspace mutation MUST reuse the existing direct/worktree callback without changing runtime workspace semantics.

Raw project paths, SQLite paths, session ids, run ids, run directories, working directories, machine output, and workspace-unavailable diagnostics MUST NOT be visible on the default conversation surface; failures MAY offer a contextual action that opens auxiliary developer diagnostics.

#### Scenario: Empty session matches the Codex frame

- **GIVEN** the selected session has no messages or active run
- **WHEN** the operator console renders
- **THEN** the rail remains visible, the canvas shows a concise project invitation, and the composer stays near the bottom
- **AND** no session toolbar or aggregate counters are shown.

#### Scenario: Multiple agents share one stream

- **GIVEN** a session contains replies from product-manager, dev, and qa
- **WHEN** the timeline renders
- **THEN** replies appear in timestamp order as hairline-separated inbox rows with distinct localized role identities
- **AND** no per-agent panel, floating message card, or dashboard is created.

#### Scenario: Workspace changes from composer context

- **GIVEN** a project supports worktree mode
- **WHEN** the user activates the workspace context item
- **THEN** the existing project workspace mutation callback receives the new mode
- **AND** the rail has no persistent worktree button.

#### Scenario: Machine details stay out of conversation

- **GIVEN** a run snapshot contains cwd, runDir, workspace mode, raw output, and diagnostics
- **WHEN** the default console renders
- **THEN** none of those machine values are visible in the rail, canvas, or composer
- **AND** a readable failure summary may offer a developer-diagnostics action.

> Agent 团队的磁盘布局、内置团队播种与结构有效性判定属于 `desktop-shell` 域（见 `openspec/specs/desktop-shell/spec.md` 的「Agent 团队存储」）；本域只规定这些事实在界面上如何呈现与交互。

### Requirement: Agent team member initial avatars

Source: docs/product/pages/main-conversation.md#Agent-头像与当时信息
Source: docs/product/pages/agent-teams.md#Agent-身份与说明

The Agent Teams surface, team selector options and Agent timeline/run records MUST compose the shared `AgentInitialAvatar` identity pattern. The glyph MUST derive from display name then stable slug and MUST use the stable identity token. A clickable timeline avatar MUST wrap that visual in an independently focusable button with a readable action name; the visual itself remains decorative. The product MUST NOT persist image or separate avatar metadata.

#### Scenario: Same member appears in menu and timeline

- **GIVEN** `@dev` has display name `开发工程师`
- **WHEN** the team menu and an Agent run render
- **THEN** both use the shared avatar glyph `开` and the same stable identity tone
- **AND** the run avatar button has an accessible name that includes the member and information action.

### Requirement: Stable member slug and mention rendering

- MUST assign each member a team-unique slug at creation time and MUST keep it unchanged for the member's lifetime.
- MUST NOT expose any interface for editing a slug.
- MUST assign a new team-unique slug when a member is duplicated within the same team.
- MUST persist mentions in `AGENT.md` as the literal text `@<slug>`.
- MUST match only current members of the same team when completing a `@` mention, and MUST show both the readable name and `@<slug>` among the completion results.
- MUST render a stored mention as a component whose primary visible text is the member's current display name.
- MUST expose the underlying `@<slug>` for viewing and copying on hover and on keyboard focus.
- MUST NOT change the stored mention text when a member's display name changes.
- MUST NOT validate whether the surrounding natural-language handoff rules are correct.

#### Scenario: Renaming a member preserves references

- **GIVEN** other members' `AGENT.md` files contain mentions of a member
- **WHEN** that member's display name is changed in its own `AGENT.md`
- **THEN** the existing mention components display the new name
- **AND** the stored text in every referencing file still reads `@<slug>` with the original slug.

#### Scenario: External editor sees stable text

- **GIVEN** an `AGENT.md` containing mention components authored in the app
- **WHEN** the file is opened in a file manager or an external editor
- **THEN** the mentions appear as plain `@<slug>` text.

### Requirement: Per-member unsaved drafts

Source: docs/product/pages/agent-teams.md#编辑与保存-agentmd
Source: docs/product/pages/agent-teams.md#保存后的生效反馈

The team detail MUST preserve independent unsaved member drafts and save only completed mutations. A single successful save MUST show the shared saved-without-restart feedback near the operation. Save-all-and-leave MUST show per-item persisted/failed results; full success MUST navigate to the list with team and count feedback, while partial failure MUST remain in detail, preserve failed drafts and omit overall success.

#### Scenario: Partial save-all is reported honestly

- **GIVEN** three members have unsaved drafts
- **WHEN** one save fails and two succeed
- **THEN** the two persisted items show saved feedback
- **AND** the failed member keeps its draft with retry
- **AND** the page remains in team detail and shows no overall-success notice.

### Requirement: External modification conflict resolution

- MUST apply conflict handling to both official-source and user teams; the app MUST detect an
  externally modified member `AGENT.md` for either ownership (official teams resolve their
  `.system/` location by stable id, user teams resolve the recorded location), while preserving
  the unsaved-draft conflict protection below.
- MUST reload an externally updated `AGENT.md` and show a light notice when the app holds no unsaved content for that member.
- MUST keep the draft and notify that the file changed externally when the app holds an unsaved draft for that member.
- MUST offer exactly two resolutions: load the external version, or overwrite with the current content.
- MUST NOT silently pick either side.
- MUST NOT provide line-level diff or automatic merge.
- MUST NOT trigger a conflict prompt for external changes to files other than the members' `AGENT.md`.
- MUST explain which members still need a resolution when leaving the team is refused, and MUST NOT let the leave control appear operable while doing nothing.
- MUST report a failed external-change check to the user on the affected member, rather than discarding it.

#### Scenario: Draft is never silently overwritten

- **GIVEN** a member has an unsaved draft in the app
- **WHEN** the same member's `AGENT.md` is modified outside the app and the user returns to the app
- **THEN** the draft is preserved
- **AND** the user is asked to choose between loading the external version and overwriting with the current content.

#### Scenario: Official-source member reloads like a user member

- **GIVEN** an official-source team member has no unsaved draft in the app
- **WHEN** the member's `AGENT.md` is modified in Finder and the user returns to the app
- **THEN** the external version is reloaded with a light notice
- **AND** the member's revision history gains one `user`-authored revision
- **AND** the team remains official source.

#### Scenario: Refused leave says why

- **GIVEN** a member has an unresolved external conflict
- **WHEN** the user attempts to return to the team list
- **THEN** the view stays on the team detail
- **AND** an explanation names the members awaiting a resolution.

### Requirement: Agent Markdown 编辑器呈现段落级变化标记与来历

Source: docs/product/pages/agent-teams.md#变化时间线
Source: docs/product/flows/agent-evolution.md#二看见变化与来历

`AGENT.md` 编辑器 MUST 接受一份变化标记输入（段落区间、作者种类、作者标签、时间、该段之前的文本），并在正文左侧对变动过的段落渲染标记。标记 MUST NOT 常驻显示作者与时间；MUST 在指针悬停或键盘聚焦该段落时才显形。点击标记 MUST 就地展开显示该段落之前的文本，MUST NOT 导航离开当前编辑器、MUST NOT 打开第二个界面。

组件 MUST NOT 渲染逐行增删对比、内容指纹或版本控制术语；变化的呈现单位是标记数据里给定的段落区间，组件本身 MUST NOT 自行对全文做二次分块或差异计算——分块和归属判断由调用方传入，编辑器只负责渲染。

编辑器容器 MUST 提供"最近变化"摘要行与展开入口；展开态渲染完整的成员级修订时间线（复用 `Requirement: Member revision timeline is a presentational list`），收起态只显示一行摘要。

标记样式 MUST 使用既有语义令牌（`border-line` / `bg-accent` 等），MUST NOT 引入裸 hex 或新增未登记的颜色语义。

#### Scenario: 标记默认不抢注意力，悬停才显形

- **GIVEN** 编辑器渲染了两个段落的变化标记
- **WHEN** 用户没有悬停或聚焦任何标记段落
- **THEN** 作者与时间文本不可见，只有色条可见
- **WHEN** 用户悬停其中一个标记段落
- **THEN** 该段落的作者与时间显形，其余标记不受影响。

#### Scenario: 点击标记就地展开，不导航

- **GIVEN** 一个标记段落带有"之前的文本"
- **WHEN** 用户点击该标记
- **THEN** 之前的文本在原位展开显示
- **AND** 编辑器焦点、滚动位置和当前草稿内容不因此改变
- **AND** 没有发生路由跳转或弹出独立对话框。

### Requirement: Member revision timeline is a presentational list

Source: docs/product/pages/agent-teams.md#变化时间线

时间线组件 MUST 按时间倒序渲染修订列表，每条只包含一句摘要、作者标签和相对时间；组件 MUST NOT 渲染内容指纹、保存时刻的技术细节或逐行对比。当前（最新）修订 MUST NOT 提供"回到这一版"操作；每条历史修订——包括最早一条——MUST 提供该操作，点击后组件 MUST 只调用传入的回调并把目标修订 id 交给调用方，MUST NOT 自行判断回退是否成功或修改本地状态。

组件 MUST 处理摘要未就绪（`pending`）与摘要不可用（`unavailable`）两种状态，分别渲染为等待中占位与中性说明文案，MUST NOT 把两者混淆展示，MUST NOT 编造摘要文本。

#### Scenario: 摘要未就绪时显示占位而非空白

- **GIVEN** 一条修订的摘要状态为 `pending`
- **WHEN** 时间线渲染这条修订
- **THEN** 显示中性的"生成中"占位文案
- **AND** 不显示空字符串或加载失败提示。

#### Scenario: 回到这一版只触发回调

- **GIVEN** 时间线渲染了三条修订
- **WHEN** 用户点击中间一条的"回到这一版"
- **THEN** 组件调用 `onRestore` 并传入该条修订的 id
- **AND** 组件本身不改变已渲染的列表顺序或内容，直到调用方传入新的 props。

#### Scenario: 当前版本不提供回退入口

- **GIVEN** 时间线渲染了三条修订且第一条是当前（最新）版本
- **WHEN** 用户查看时间线各条可用操作
- **THEN** 最新一条没有"回到这一版"，其余两条（含最早一条）都有
- **AND** 调用方可以据此回退到任意历史版本。

### Requirement: 默认 Agent 设置复用共享运行配置选择器

Source: docs/product/pages/settings.md#默认-agent

设置弹窗的默认 Agent 设置组 MUST 使用与团队成员运行配置相同的共享选择器组件（CLI / Provider / 模型 / 思考程度），选项范围、静态校验与旧值保留规则 MUST 与团队页保持完全一致，MUST NOT 实现第二套平行的选择控件。当前生效值缺失已保存选择时，MUST 显示调用方提供的内置推荐值，MUST NOT 显示为空白或"未设置"。

#### Scenario: 默认 Agent 与团队成员共用同一套选项

- **GIVEN** 团队成员运行配置选择器提供的 CLI 列表和某个 CLI 下的 model/effort 联动规则
- **WHEN** 设置页渲染默认 Agent 选择器
- **THEN** 可选项范围、切换 CLI 后的兼容默认组合与旧版自定义值展示规则与团队页完全一致
- **AND** 两处不存在任何字段级别的呈现差异。

### Requirement: Needs-repair propagation to the sidebar entry

- MUST show a single indicator on the sidebar "Agent 团队" entry whenever at least one team needs repair.
- MUST NOT scale that indicator with the number of affected teams.
- MUST expose the accessible name and hover text `有 Agent 团队需要修复` so the meaning does not depend on color alone.
- MUST NOT show the indicator for unfinished drafts.
- MUST mark the specific affected teams on the team list when the user opens the page from that entry.
- MUST keep an existing conversation's history viewable when **the team bound to that conversation** needs repair, and MUST block sending new messages in that conversation.
- MUST show a placeholder in place of the member row for a team that needs repair, and MUST NOT show member names or a member count for it.

#### Scenario: Multiple broken teams show one indicator

- **GIVEN** three teams need repair
- **WHEN** the sidebar renders
- **THEN** exactly one indicator appears on the "Agent 团队" entry with no count
- **AND** opening the page marks all three affected rows as needing repair.

#### Scenario: Broken team row identifies the team without a roster

- **GIVEN** a team needs repair because its directory is unreadable
- **WHEN** its row renders on the team list
- **THEN** the team name, description, and reason are shown
- **AND** the member area shows a placeholder instead of member names or a count.

### Requirement: Conversation view routing

- MUST return the main area to the conversation view whenever an action takes the user to a specific conversation, including selecting a session in the sidebar, successfully creating a conversation, jumping from a search result, and switching sessions as a consequence of archiving or removing a project.
- MUST route those actions through a single entry point that performs the session switch and the view return together.
- MUST NOT leave the sidebar selection on one conversation while the main area shows the agent teams page.
- MUST prompt for unsaved team drafts before leaving the agent teams page through that entry point, using the existing save/discard/cancel choices.

#### Scenario: Selecting a conversation leaves the teams page

- **GIVEN** the main area shows the agent teams page
- **WHEN** the user clicks a conversation in the sidebar
- **THEN** the main area shows that conversation's timeline
- **AND** the sidebar selection and the main area refer to the same conversation.

#### Scenario: Unsaved drafts are not lost on the way out

- **GIVEN** the agent teams page holds an unsaved `AGENT.md` draft
- **WHEN** the user clicks a conversation in the sidebar
- **THEN** the save, discard, and cancel choices are offered before the view changes.

### Requirement: Team browsing is separate from the conversation's team

- MUST derive the conversation's current team from the session's own binding.
- MUST keep the team selected for browsing on the agent teams page independent of that binding.
- MUST base send availability, and any team indicator shown with the conversation, on the bound team only.
- MUST NOT let a conversation default to an arbitrary team when its session has no binding.
- MUST re-evaluate the bound team's health on the existing refresh cycle, so a team that becomes unavailable or is repaired outside the app takes effect without visiting the agent teams page.

#### Scenario: Browsing a broken team does not block conversations

- **GIVEN** a conversation is bound to a healthy team
- **WHEN** the user opens a team that needs repair on the agent teams page and returns to the conversation
- **THEN** sending in that conversation remains available.

#### Scenario: The conversation's own team governs sending

- **GIVEN** a conversation is bound to a team that needs repair
- **WHEN** the conversation is shown
- **THEN** its history remains viewable and sending is blocked
- **AND** the block persists regardless of which team is selected on the agent teams page.

#### Scenario: Repairing outside the app takes effect without a visit

- **GIVEN** sending is blocked because the bound team's directory was moved outside the app
- **WHEN** the directory is restored and the user stays in the conversation
- **THEN** sending becomes available on a subsequent refresh
- **AND** the user does not have to open the agent teams page to retry.

### Requirement: Composition-safe agent markdown editing

- MUST NOT rewrite the editor's content or reset the caret while an input method composition is in progress.
- MUST commit the composed text once, after the composition ends.
- MUST verify this through tests that drive the real input path, and MUST NOT assert it by assigning element text directly.

#### Scenario: Composing text is not interrupted

- **GIVEN** the user is composing text with an input method in the `AGENT.md` editor
- **WHEN** intermediate composition updates occur
- **THEN** the composition continues uninterrupted
- **AND** the caret stays where the user was typing.

### Requirement: Last-used team preselection

- MUST record the team used to successfully create a conversation, and MUST update that record only on successful creation.
- MUST NOT update the record when a team is opened, edited, browsed, or duplicated.
- MUST preselect the recorded team when a new conversation is started, and MUST allow changing the selection before creation.
- MUST fall back to the first built-in team when there is no recorded team, or when the recorded team has been deleted or needs repair.
- MUST NOT provide a user-configurable application-level default team.

#### Scenario: Browsing does not change the preselection

- **GIVEN** team A is the recorded last-used team
- **WHEN** the user opens team B, edits a member's `AGENT.md`, saves it, and then starts a new conversation
- **THEN** team A is still preselected.

## Requirement: Agent 团队新建入口区分三条创建路径
Source: docs/product/pages/agent-teams.md#页面标题与新建入口
Acceptance: agent-teams#4

系统 MUST 在 Agent 团队首页的「新建团队」菜单中提供「跟 AI 聊出一支新团队」和「从空白开始」，MUST 让 AI 建队占用当前页面主体并提供返回 Agent 团队列表的动作，且 MUST 继续让从空白开始使用短字段 `TeamInformationDialog`。系统 MUST 只在已有团队详情中提供「复制并编辑」，不得把它加入新建菜单；三条路径创建成功后 MUST 都以普通用户团队进入既有团队详情。

### Scenario: 从新建菜单进入 AI 建队主体

- GIVEN Agent 团队首页已经载入
- WHEN 用户展开「新建团队」并选择「跟 AI 聊出一支新团队」
- THEN 当前页面主体显示共享的 `TeamBuilderView`
- AND 桌面 console 顶部导航和 Agent 团队上下文仍然保留
- AND 页面没有打开新建团队 dialog

### Scenario: 从空白开始保持既有短表单

- GIVEN Agent 团队首页已经载入
- WHEN 用户展开「新建团队」并选择「从空白开始」
- THEN 页面打开只含团队名称和一句话描述的 `TeamInformationDialog`
- AND 菜单中没有「复制并编辑」

## Requirement: AI 建队草稿与会话团队偏好保持隔离
Source: docs/product/pages/agent-teams.md#AI-建队
Acceptance: agent-teams#6

系统 MUST 只在 AI 建队主体内显示和恢复未确认草稿，MUST NOT 把草稿加入 Agent 团队列表或新建对话团队选择。确认创建后，系统 MUST 通过正式团队列表读取一次性原子创建的普通用户团队并进入其详情；AI 建队 selected 本身 MUST NOT 创建、覆盖或更新 `last-used-team.json`，该偏好仍只允许由成功创建会话更新。

### Scenario: 未确认草稿不进入团队列表

- GIVEN Agent 团队页的 AI 建队草稿含对话或有效方案但尚未确认
- WHEN renderer 从最外层团队列表入口调用 `listAgentTeams()`
- THEN 返回值只包含已经登记的正式团队
- AND 新建对话团队选择中没有该草稿

### Scenario: 确认创建进入详情但不改变会话偏好

- GIVEN `last-used-team.json` 记录上一次成功创建会话时使用的团队 A
- WHEN 用户在 Agent 团队页确认 AI 方案并收到 selected 团队 B
- THEN 团队 B 作为普通用户团队出现在列表并打开详情
- AND `last-used-team.json` 仍记录团队 A

## Requirement: 验收 1 — 新对话使用主内容页面
Source: docs/product/pages/main-conversation.md#页面目标

系统 MUST 在主内容区显示标题为“新对话”的新对话页面，并把侧边栏顶部“新建对话”入口显示为当前选中。系统 MUST NOT 打开模态弹窗、独立窗口或在侧边栏新增会话行。

### Scenario: 从全局入口进入新对话页
- GIVEN 主页面已有至少一个持久化会话
- WHEN 用户点击侧边栏顶部“新建对话”
- THEN 主内容区显示“新对话”页面且原会话行数量不变

## Requirement: 验收 2 — 未选项目时保持可编辑但禁止发送
Source: docs/product/pages/main-conversation.md#页面状态

系统 MUST 在全局入口进入时保持项目未选择、草稿输入可编辑、团队选择可用，并以内联常驻文字说明不能发送的原因。系统 MUST NOT 猜测第一个项目或上次项目，也 MUST NOT 在未选项目时显示工作区与分支上下文或允许发送。

### Scenario: 无项目的新对话初始态
- GIVEN 至少存在一个可用项目与一支可用团队
- WHEN 用户从侧边栏顶部进入新对话页
- THEN 项目保持未选择、输入框可编辑、发送按钮禁用且页面显示原因文字

## Requirement: 验收 3 — 首次发送后才出现会话
Source: docs/product/pages/main-conversation.md#操作与反馈

系统 MUST 在项目、团队和非空草稿齐备时以一次创建操作提交首条消息，并在成功后选择返回的会话、清除新对话草稿且只新增一个侧边栏会话行。系统 MUST NOT 在创建失败时清除草稿、项目或团队选择，也 MUST NOT 重复提交并发创建。

### Scenario: 首次发送创建并选中会话
- GIVEN 新对话页已选择项目和团队并填有非空草稿
- WHEN 用户点击发送且创建成功
- THEN 侧边栏恰好新增一个会话行并选中该会话

### Scenario: 创建失败保留输入
- GIVEN 新对话页已选择项目和团队并填有非空草稿
- WHEN 创建请求失败
- THEN 草稿、项目和团队选择保持不变且页面显示可读错误

## Requirement: 验收 4 — 项目菜单可添加项目
Source: docs/product/pages/main-conversation.md#操作与反馈

系统 MUST 在 composer 项目菜单列出全部可用项目，并在分隔线后提供“添加项目…”；新项目成功添加后 MUST 立即成为当前新对话项目。系统 MUST NOT 在选择器取消、添加失败或文件夹已绑定活动项目时改变当前选择、清除其他输入或创建重复项目。

### Scenario: 添加项目后立即选中
- GIVEN 新对话页没有选择项目且已填写草稿
- WHEN 用户从项目菜单选择“添加项目…”并在系统选择器中添加新目录成功
- THEN 新项目成为当前项目且原草稿保持不变

### Scenario: 已绑定目录不重复添加
- GIVEN 选择的目录已绑定一个活动项目
- WHEN 用户尝试从新对话页添加该目录
- THEN 当前项目选择保持不变且页面显示目录已被使用

## Requirement: 验收 5 — 创建后标题与项目上下文稳定
Source: docs/product/pages/main-conversation.md#会话内容区

系统 MUST 在首发成功后于时间线滚动容器顶部显示由首条消息生成的、复用统一 46px 窗口 header 高度的不透明 sticky 单行会话标题，标题文字 MUST 在该 header 内自然垂直居中并与消息行文字使用同一条左边界；长标题 MUST 截断且通过 title 属性暴露全文。窗口使用隐藏标题栏时 MUST NOT 为不存在的系统标题栏增加纵向留白。有消息的会话 MUST 保持创建时项目归属。系统 MUST NOT 提供标题编辑入口或有消息会话的项目切换控件。

### Scenario: 已有会话显示稳定标题
- GIVEN 首条消息已创建会话且生成标题
- WHEN 用户查看该会话
- THEN 主内容区与侧边栏显示同一标题且项目切换控件不可用

## Requirement: 验收 19 — 草稿按新对话与会话隔离持久化
Source: docs/product/pages/main-conversation.md#草稿隔离与保留

系统 MUST 独立持久化新对话草稿和每个已有会话的草稿，并在跨会话、跨页面、窗口尺寸变化及应用重启后恢复对应草稿。系统 MUST NOT 因离开新对话页、切换已有会话或创建失败而清除草稿；新对话草稿只能在会话创建且新选择已提交后清除。

### Scenario: 新对话草稿跨重启恢复
- GIVEN 新对话页保存了尚未发送的草稿
- WHEN 应用重启后用户再次打开新对话页
- THEN 输入框恢复该新对话草稿且已有会话草稿未被覆盖

### Scenario: 会话草稿互不覆盖
- GIVEN 两个已有会话分别保存了不同未发送草稿
- WHEN 用户在两会话之间往返切换
- THEN 每个会话恢复自己的草稿

## Requirement: 验收 #5 会话输入区展示四项上下文，只有团队可改选
Source: docs/product/pages/main-conversation.md#上下文

系统 MUST 在输入框上方按“项目 → 工作空间 → 分支 → 团队”的固定顺序展示当前会话上下文；会话已有消息时，项目与工作空间 MUST 渲染为不可点击文本，团队 MUST 仍可展开改选。系统 MUST NOT 为已有消息的会话提供改变工作空间的入口，MUST NOT 提供从独立工作空间切回默认工作空间的路径或对应的确认弹层。

### Scenario: 已开始的对话锁定项目与工作空间
- GIVEN 一段已有消息的会话已经绑定项目、工作空间、分支和团队
- WHEN 用户查看输入区上方的上下文条
- THEN 四项按项目、工作空间、分支、团队的顺序出现；项目与工作空间是不可点击文本，只有团队可展开改选

### Scenario: 产品内不存在切回默认工作空间的路径
- GIVEN 一段会话正在使用独立工作空间
- WHEN 用户在会话页寻找改回默认工作空间的方式
- THEN 页面上不存在该入口，也不出现工作空间切换确认弹层

## Requirement: 验收 #8 工作空间在选择处说明边界
Source: docs/product/pages/main-conversation.md#选择工作空间与团队

系统 MUST 在发出第一条消息之前提供工作空间选择，并在选择“独立工作空间”时说明副本基于项目当前所在的提交、不包含尚未提交的改动；非 Git 项目 MUST 在同一菜单内禁用“独立工作空间”并显示不可选原因。系统 MUST NOT 暗示切换会回滚、清理或搬运已经产生的改动，MUST NOT 在对话已经开始后仍提供该选择。

### Scenario: 新对话页选择独立工作空间
- GIVEN 新对话页已选定一个 Git 项目且尚未发出消息
- WHEN 用户选择“独立工作空间”
- THEN 界面说明副本基于项目当前所在的提交且不包含尚未提交的改动

### Scenario: 非 Git 项目解释独立工作空间不可选
- GIVEN 当前选定的项目文件夹不是 Git 仓库
- WHEN 用户打开工作空间菜单
- THEN “独立工作空间”不可选择，且同一菜单内显示“这个项目文件夹不是 git 仓库，无法隔离改动”

## Requirement: 验收 #20 团队菜单披露创建时载入的快照语义
Source: docs/product/pages/main-conversation.md#团队按钮展开

New conversation, analysis new conversation and existing-session team menus MUST reuse one team-option component. Every selectable option MUST show name, source, purpose, primary Agent, member count and ordered readable members. When space is insufficient, it MUST retain the primary Agent and provide a keyboard-operable `+N` control that expands/collapses the full bounded member list without selecting the team or closing the menu. It MUST NOT show member CLI/model/effort or internal identifiers.

An existing-session trigger and checked current item MUST use the effective historical snapshot summary. Current catalog teams MUST appear only after a separator, excluding the stable team represented by the current snapshot. A pending explicit switch MUST show its frozen target summary. New-conversation options MUST use current saved catalog state.

### Scenario: Team renamed after conversation load

- GIVEN a conversation loaded historical team name A and the saved catalog now names the same team B
- WHEN the existing-session trigger and menu open
- THEN the trigger and checked current item display A with historical source disambiguation
- AND B does not replace or duplicate that current item.

### Scenario: Full member list expands without selection

- GIVEN an option has six members and displays three plus `+3`
- WHEN the user activates `+3` by mouse, Enter or Space
- THEN all six members become reachable in that option
- AND the option is not selected and the menu remains open.

## Requirement: #10 时间线不显示过程状态
Source: docs/product/pages/main-conversation.md#区域与信息

系统 MUST 只把对话内容、当前活动投影和最终事实放入时间线，并让消息发送时刻仅在悬停或聚焦时显示。系统 MUST NOT 显示「已交棒」「已完成」「运行中」「未开始」等过程标签、过程图标或汇总计数条；run 自身语义明确的「已进行 / 耗时」不属于消息发送时刻。

### Scenario: 已结束的步骤只留下对话
- GIVEN 一个成员已经完成当前步骤
- WHEN 用户查看该步骤的历史记录
- THEN 记录中没有过程标签、过程图标或常驻消息发送时刻
- AND 真实启动过的 run MAY 保留一次语义明确的「耗时」

## Requirement: #11 运行记录展示最新活动、明确计时与精确停止
Source: docs/product/pages/agent-conversation.md#页面结构

系统 MUST 让每个活动 run 只占一条原地更新的记录，角色行常驻显示自己的「已进行」时长，活动行只显示当前最新安全活动。专业成员与独立子会话的记录 MUST 提供只作用于该 run 的停下操作；全局主 Agent 的停止仍由 composer 承载。系统 MUST NOT 显示百分比、轮播历史工具事件、把全量过程铺入时间线或让一个 run 的停止/时钟覆盖其他 run。

### Scenario: 多成员并行
- GIVEN 主 Agent 与两个专业成员同时运行
- WHEN 三个 run 的活动与时间分别更新
- THEN 时间线保持三条独立活动记录
- AND 每条记录的活动、时钟和停止目标只绑定自己的 run

### Scenario: 运行中最新活动
- GIVEN 一个成员的 run 已真实启动并产生结构化工具事件
- WHEN 用户查看活动记录
- THEN 角色行显示「已进行」与明确时长
- AND 下一行只显示最新一条安全活动
- AND 页面没有百分比或历史工具列表

### Scenario: 成功历史消息按需显示图标入口
- GIVEN 主时间线存在一条带 run id 的成功 Agent 历史消息
- WHEN 消息没有悬停且焦点不在消息内
- THEN 正文下方不显示常驻的「完整输出」文字按钮
- WHEN 用户悬停整条消息或用键盘把焦点移入该消息
- THEN 正文下方原有左边界显示一个完整输出图标按钮
- AND 图标按钮可用键盘到达且可访问名称为「完整输出」

### Scenario: 历史图标仍打开原步骤过程
- GIVEN 主时间线成功历史消息的完整输出图标已经显示
- WHEN 用户激活该图标
- THEN 系统使用该消息所属 session id 与稳定 step id 打开或聚焦对应过程标签
- AND run id 只作为读取该步骤聚合过程的 attempt 锚点

### Scenario: 有稳定过程能力的没跑起来记录也能调出完整输出
- GIVEN 一个能提供稳定过程记录的步骤留下了「这一步没跑起来」记录
- WHEN 用户查看该记录
- THEN 记录上常驻提供「完整输出」，与「重试」并存

### Scenario: 完整输出在右侧栏按需显示
- GIVEN 时间线上的「完整输出」入口没有展示路径、内部标识或计时
- WHEN 用户打开该入口
- THEN 右侧栏打开或聚焦对应的“过程”标签
- AND 命令、工具、文件与错误以友好结构呈现，不显示原始 JSON、绝对路径或内部标识

### Scenario: 从子任务打开完整输出
- GIVEN 子任务标签中存在带 run id 的历史 Agent 回复或活动运行
- WHEN 用户点击该记录的「完整输出」
- THEN 系统使用该子会话 id 与稳定 step id 打开或聚焦对应的过程标签
- AND run id 只作为读取该步骤聚合过程的 attempt 锚点
- AND 不会错误读取父会话中同名或同时运行的步骤

## Requirement: 终态只显示一次耗时并按需说明完成时刻
Source: docs/product/pages/agent-conversation.md#完成时间

系统 MUST 在承接 run 的最终 Agent 消息或系统事实中只显示一次「耗时」。完成时刻 MUST 通过耗时控件的悬停、键盘聚焦和屏幕阅读器说明提供；今天、本年内非今天与跨年 MUST 使用产品规定的分级格式。没有真实启动事实时 MUST NOT 显示 `00:00`。

### Scenario: 成功 run 结束
- GIVEN 一个真实启动的 run 成功结束
- WHEN 最终 Agent 消息接管临时活动记录
- THEN 消息常驻显示一次「耗时 mm:ss」
- AND 聚焦耗时可获得「完成于」说明

### Scenario: 未启动失败
- GIVEN 一个 run 未确认进程启动就进入没跑起来终态
- WHEN 系统事实接管临时记录
- THEN 记录不显示耗时或 `00:00`
- AND 完成时刻仍可通过可访问说明获得

## Requirement: 完整输出能力按执行引擎局部降级
Source: docs/product/pages/agent-conversation.md#完整输出

系统 MUST 只为能提供稳定过程记录的 run 显示可点击完整输出入口。Kimi 与 Claude run
MUST 保留最新活动、计时和最终回复，但统一原位说明当前执行引擎不提供可恢复的完整
过程记录，MUST NOT 打开空标签、借用 Codex 记录或显示另一执行引擎的名称。已持久化
为 `kimi-empty-response` 且没有 `execution_session_link` 的失败 attempt 是局部例外：
其完整输出入口 MUST 打开仅含“Kimi 过程记录已不可用”的过程空态，不得读取 canonical
session wire 或其他 provider 内容。

#### Scenario: Claude run 工作中

- **GIVEN** 当前活动 run 的执行引擎是 Claude
- **WHEN** 用户查看活动记录
- **THEN** 最新活动与已进行时长正常显示
- **AND** 完整输出位置显示执行引擎中性不可用说明而不是按钮
- **AND** 说明中不出现 Kimi。

## Requirement: Kimi 空响应显示为可重试失败而非空白成功

Source: docs/product/pages/agent-conversation.md#异常终态

系统 MUST 将 `kimi-empty-response` 呈现为「这一步没跑起来」，显示稳定 Kimi 空响应说明
、在终端直接运行 `kimi` 查看详细错误的自查引导与「重试」，并保留真实 engine、失败
状态、attempt 和已启动后的耗时。系统 MUST NOT 渲染空白 Agent 消息、completed 状态、
具体额度/认证猜测、绝对路径、session id 或 provider payload。

该失败 attempt 没有 `execution_session_link` 时，「完整输出」MUST 只显示 Kimi
过程记录不可用，不得读取 canonical session 的 wire、最终回复或其他 provider 内容
替代。

### Scenario: 真实 Kimi 空 end_turn

- **GIVEN** Kimi attempt 以 `kimi-empty-response` failed fact 收口
- **AND** 当前 run 没有 Agent response 或 execution link
- **WHEN** 用户查看时间线并打开该 attempt 的完整输出
- **THEN** 页面显示「这一步没跑起来」、安全 Kimi 说明、终端 `kimi` 自查引导和「重试」
- **AND** 完整输出显示 Kimi 记录不可用
- **AND** 页面没有空白 Agent bubble、403 原文、路径、session id 或 Codex/Claude 内容。

### Scenario: 重启后空响应事实保持

- **GIVEN** 同一步两次 Kimi empty attempts 都已失败
- **WHEN** Electron 重启后重新打开会话
- **THEN** 两次 attempts 各自保留 Kimi、failed、计时和安全说明
- **AND** 页面不把任一 attempt 恢复成 completed 或空白 Agent 回复。

## Requirement: 恢复不可用事实提供明确重新运行
Source: docs/product/pages/agent-conversation.md#四种事实与异常状态

系统 MUST 将恢复校验失败显示为「原执行已经无法继续」，保留已有耗时，并提供明确的「重新运行」动作。系统 MUST NOT 把它混同为普通没跑起来或暗示会自动重试。

### Scenario: 正常退出后无法恢复
- GIVEN 原 run 的恢复校验失败且已有累计耗时
- WHEN 用户查看终态事实
- THEN 页面显示「原执行已经无法继续」与原耗时
- AND 操作标为「重新运行」而不是自动继续或普通重试

## Requirement: 主时间线运行记录复用正文列
Source: docs/product/pages/main-conversation.md#页面结构

系统 MUST 让主时间线中的会话标题、历史消息正文、运行中角色名与实时 Markdown 使用同一左边界，并让运行操作的右边界与该正文列一致。系统 MUST 让活动运行块随正文列响应式收缩，MUST NOT 因活动运行使用独立组件而向时间线容器外沿偏移或保留更窄的固定最大宽度。

### Scenario: 历史消息后出现活动运行
- GIVEN 主时间线已经显示会话标题与至少一条历史消息
- WHEN 一个成员开始工作并显示实时 Markdown 与「完整输出」
- THEN 标题、历史消息正文、运行中角色名和实时 Markdown 的左边界一致
- AND 「完整输出」的右边界与正文列右边界一致

### Scenario: 窄窗口中的活动运行
- GIVEN 主时间线所在窗口缩窄
- WHEN 活动运行块随正文列收缩
- THEN 页面不因活动运行块产生横向滚动
- AND 实时 Markdown 继续使用既有的局部溢出规则

## Requirement: 主会话输入器复用正文列
Source: docs/product/pages/main-conversation.md#页面结构

系统 MUST 让已有会话 composer、其上方的待发射区和新对话 composer 与主会话正文列使用相同的最大宽度和左右边界，并在可用宽度不足时一起响应式收缩。系统 MUST NOT 因统一主会话列而改变右侧子任务栏 composer 的独立宽度约束。

### Scenario: 已有会话输入器与正文列对齐
- GIVEN 主时间线显示历史消息和底部 composer
- WHEN 主内容区宽于正文列最大宽度
- THEN composer 的左右边界与正文列一致

### Scenario: 待发射区与输入器对齐
- GIVEN 主理人运行期间存在至少一条待发射消息
- WHEN 待发射区显示在 composer 上方
- THEN 待发射区、composer 与正文列使用相同的左右边界

### Scenario: 新对话与窄窗口保持同一列
- GIVEN 用户位于新对话状态
- WHEN 主内容区宽于正文列上限或缩窄到不足该上限
- THEN 新对话 composer 与主会话列使用相同上限并随可用宽度收缩
- AND 页面不产生由该 composer 引起的横向滚动

## Requirement: #12 四种事实由持久化类型驱动
Source: docs/product/pages/main-conversation.md#区域与信息

系统 MUST 按事件类型分别呈现没跑起来、卡住、用户按停和反复重试仍未成功；没跑起来与卡住 MUST 提供「重试」，另两种 MUST NOT 提供。系统 MUST NOT 把用户按停写成失败或暗示文件改动会被撤销。

### Scenario: 重启后仍可辨认四种事实
- GIVEN 一段对话已经持久化四种事件类型
- WHEN 页面刷新或桌面应用重启后重新打开该对话
- THEN 四种事实仍分别可见且只有没跑起来和卡住带「重试」

## Requirement: #13 会话文本不再替换机器信息
Source: docs/product/pages/main-conversation.md#指标与验收

系统 MUST 在 Agent 正文、运行步骤标题与摘要、实时 Markdown、允许展示的终态说明和系统记录中保留输入原文的路径、`cwd`、`runDir`、数据库路径及内部 id。系统 MUST NOT 用机器信息、路径、内部标识或工作空间类型占位符替换这些文本，也 MUST NOT 因非空活动摘要包含机器信息而整条丢弃；活动摘要只有缺失或纯空白时才 MUST 使用 `console.runBlock.progress`。

终态说明 MUST 保留既有安全错误码资格门：只有被 runtime 分类为安全错误码的非空 `message.body` 才按原文进入 description；正文空白或错误未分类时 MUST 使用 RunOutcome 对应状态的既有默认说明。renderer 放开显示 MUST NOT 要求 runtime 把原始 stderr、路径或内部异常加入 `message.body`。

### Scenario: Agent 正文同时包含路径与自然语言机器词
- GIVEN Agent 正文包含 `/tmp/report.txt:2`、`runId=run-secret` 与 `Send a direct message before handoff.`
- WHEN 主时间线渲染该消息
- THEN 路径、run id、`direct` 与 `handoff` 均按原文可见
- AND 页面不存在任何“已隐藏”占位文案

### Scenario: 运行步骤包含路径
- GIVEN 活动 run 的步骤标题或摘要包含绝对路径、`cwd` 与内部 id
- WHEN RunBlock 渲染该步骤
- THEN 非空文本保持原值
- AND 缺失或纯空白摘要仍显示既有进度兜底

### Scenario: 活动摘要命中旧机器模式
- GIVEN 成员运行期间的活动摘要为 `正在写入 /tmp/report.txt，runId=run-secret`
- WHEN 主时间线渲染活动行
- THEN 活动行逐字显示该摘要
- AND 不显示 `console.runBlock.progress` 对应文案

### Scenario: 活动摘要为空白
- GIVEN 成员运行期间的活动摘要缺失或只有空白
- WHEN 主时间线渲染活动行
- THEN 活动行显示 `console.runBlock.progress` 对应文案

### Scenario: 安全终态说明与 runtime 边界
- GIVEN runtime 为受信任安全错误码提供非空用户可读 `message.body`
- WHEN RunOutcome 渲染该终态
- THEN description 按原文显示该 body
- WHEN body 为空白或错误码未分类
- THEN description 使用该状态既有默认说明
- AND renderer 不读取或拼接原始 stderr、路径或内部异常

## Requirement: #16 状态点只取确定事实
Source: docs/product/pages/main-conversation.md#操作与反馈

系统 MUST 按红大于蓝大于闪的优先级派生状态点：红点来自三种未处理异常或三种不可继续状态，蓝点来自无人工作、最后消息未提及成员且结果未读，闪点来自成员正在工作。系统 MUST NOT 以用户按停、正常完成、最后消息已提及成员或旧「等人回话」字段触发红点或蓝点；每个红点 MUST 对应时间线中的可读系统记录。静默兜底收束（`silent-closeout`）MUST NOT 单独成为红点来源：升级前被追溯落盘的该事实不点亮静止历史会话，真实异常的红点由未确认异常事实承担。

### Scenario: 停下不会召回用户
- GIVEN 用户按停后没有其他异常且最后结果已查看
- WHEN 侧边栏渲染该会话和所属项目
- THEN 会话行与项目聚合行都不显示红点

## Requirement: #17 三种不可继续状态共用只读表现
Source: docs/product/pages/main-conversation.md#三种不可继续状态的共同规则

系统 MUST 对项目文件夹不可用、团队已删除、团队需要修复统一禁用输入和发送、保持历史只读并标红对应上下文控件。系统 MUST NOT 混淆三种原因或恢复动作，恢复条件满足后 MUST 恢复输入能力。

### Scenario: 已删除团队改选后恢复
- GIVEN 当前团队已删除且对话处于只读态
- WHEN 用户改选一支可用团队
- THEN 输入与发送恢复且既有时间线保持不变

## Requirement: 子会话以时间线卡片呈现且不进入侧边栏
Source: docs/product/pages/main-conversation.md#子会话卡片

系统 MUST 在父会话时间线的拆分锚点处呈现子会话卡片，每行 MUST 显示子任务标题、负责成员和运行时给出的当前状态，且整行可打开对应子会话。系统 MUST NOT 在侧边栏呈现带父会话的会话、lineage 文案或由界面自行推导的子任务状态。

### Scenario: 拆分结果只有一个聚合入口
- GIVEN 父会话已拆出两个状态不同的子会话
- WHEN 主会话页同时呈现时间线和侧边栏
- THEN 时间线卡片含两行任务、成员、状态，侧边栏只含父会话

## Requirement: 子会话在右侧展开区外壳中打开
Source: docs/product/pages/main-conversation.md#子会话卡片

系统 MUST 在宽窗口右侧打开所选子会话、标记所选卡片行、保持父会话及其输入框可达，并在关闭后恢复打开前的父时间线滚动位置。系统 MUST NOT 在本外壳中新增输入方式或操作集。

### Scenario: 父会话更新后关闭展开区
- GIVEN 用户从父时间线中部打开了一个子会话
- WHEN 展开期间父会话收到新消息且用户关闭展开区
- THEN 父会话仍显示在打开前的滚动位置，展开区内只复用既有会话视图

## Requirement: 窄窗按固定顺序收敛会话上下文
Source: docs/product/pages/main-conversation.md#响应式与窗口行为

系统 MUST 在窗口变窄时按分支、工作空间、团队、项目的顺序逐项隐藏上下文，并让子会话展开区覆盖整个主内容区。系统 MUST NOT 在团队或项目仍需显示的宽度先隐藏它们而保留分支或工作空间。

### Scenario: 从宽窗缩到最窄
- GIVEN 会话上下文在宽窗显示项目、工作空间、分支、团队
- WHEN 窗口依次跨过每个收敛阈值
- THEN 可见项依次变为项目工作空间团队、项目团队、仅项目、全部隐藏，子会话展开区在窄窗为全覆盖

## Requirement: 父时间线保持可控跟随
Source: docs/product/pages/main-conversation.md#响应式与窗口行为

系统 MUST 只把时间线作为页面主要滚动区域；用户位于底部时 MUST 跟随新内容，用户向上翻阅时 MUST 保持位置并提供回到底部入口，可见的代码或命令输出 MUST 在自身容器内横向滚动。系统 MUST NOT 让长文本或命令输出撑宽页面，也 MUST NOT 让分栏遮断页面标题和父会话输入框。

### Scenario: 向上阅读时收到新内容
- GIVEN 用户已离开父时间线底部
- WHEN 父会话出现新内容
- THEN 时间线保持用户当前阅读位置并显示回到底部入口

## Requirement: 用户与 Agent 使用同一套安全 Markdown renderer
Source: docs/product/pages/main-conversation.md#时间线

系统 MUST 用共享 Streamdown renderer 呈现用户与 Agent 正文：已完成消息使用 static mode，活动 run 使用 streaming mode。系统 MUST 支持基础 Markdown、GFM 表格/任务列表/删除线/自动链接/脚注、CJK 友好解析、Shiki 代码高亮、KaTeX 数学与 Mermaid 图。系统事实、失败、卡住、中断、子会话和结果卡片 MUST 继续使用结构化组件，MUST NOT 因正文含 Markdown 标记而被重新解释。

### Scenario: 同一时间线混合静态与活动 Markdown
- GIVEN 时间线有一条用户 Markdown、一条已完成 Agent Markdown、一个当前活动 run 和一条系统失败事实
- WHEN operator console 渲染
- THEN 用户与 Agent 正文按完整语法呈现且活动 run 使用 streaming mode
- AND 系统失败事实仍按其结构化组件与恢复动作呈现

## Requirement: 流式更新不增加时间线行
Source: docs/product/pages/main-conversation.md#时间线

系统 MUST 以 `runId` 稳定呈现至多一个活动 run 节点，后续 `liveMarkdown` MUST 原地替换该节点内容，MUST NOT 插入虚拟 message。run 完成后活动节点 MUST 消失并由最终持久化 Agent 消息接管，最终正文 MUST NOT 同时显示两份。历史消息 MUST 使用 static mode 且 MUST NOT 在重开会话时重新播放流式动画。

### Scenario: 活动段切换为最终消息
- GIVEN 同一 run 已依次收到两段可见 Markdown
- WHEN renderer 先 refresh 活动 snapshot、再 refresh 已完成 snapshot
- THEN 活动阶段始终只有一条 run 行且显示最新段
- AND 完成阶段只显示一条最终 Agent 消息

## Requirement: Markdown 丰富内容服从会话布局与可访问性
Source: docs/product/pages/main-conversation.md#时间线

系统 MUST 让表格和 fenced code 在自身容器横向滚动、图片按时间线宽度等比收敛，并让标题层级、段落、列表、引用、代码与公式服从现有 console-ui 令牌。复制、下载、链接确认和 Mermaid 控件 MUST 可由键盘操作；昂贵的 Mermaid 渲染 MUST 等代码 fence 闭合后再执行。活动动画 MUST 只作用于当前 run。

### Scenario: 窄时间线包含宽表格和 Mermaid
- GIVEN 760px 或更窄的时间线正在显示宽表格、代码块和未闭合 Mermaid
- WHEN Markdown 处于 streaming mode
- THEN 页面宽度不被内容撑开且表格/代码自身可滚动
- AND Mermaid 在 fence 闭合前不执行图表渲染

## Requirement: Markdown URL 与 HTML 显式收紧
Source: docs/product/pages/main-conversation.md#时间线

系统 MUST 清洗 raw HTML 并阻止 script、iframe、事件属性和危险节点。链接 MUST 只允许 `http`、`https`、`mailto`，图片 MUST 只允许 `http`、`https`，并 MUST 禁止 data image、本地文件、JavaScript 与自定义协议。外链 MUST 经确认并通过宿主回调打开；没有宿主回调时 MUST NOT 直接导航。Mermaid MUST 使用 strict security。

### Scenario: 恶意 Markdown 不越过 renderer
- GIVEN 用户或 Agent 正文包含 script、onclick、javascript link、data image、file URL 与一个合法 HTTPS 链接
- WHEN Markdown 渲染并发生点击
- THEN 危险内容不可执行且不能导航或读取本地文件
- AND 只有合法链接能进入确认与宿主回调
## Requirement: composer 提供三种等价的本地附件入口
Source: docs/product/pages/main-conversation.md#带附件的输入框与时间线

operator console composer MUST 在右下角把「＋」与发送按钮放在同一操作组；「＋」MUST 打开支持多选的系统文件选择入口。composer MUST 同时把拖入的文件和剪贴板中的图片交给同一个受控 `onFilesAdded` 边界，MUST NOT 把原始本地路径或 `file:` URL插入正文。普通文字粘贴 MUST 保持正文编辑行为。

三种入口 MUST 可独立使用；拖拽 MUST NOT 成为唯一入口。键盘和 screen reader 用户 MUST 能添加、移除、重试并辨认每个附件及其状态。

### Scenario: 三种入口形成同一种草稿项
- GIVEN composer 可编辑
- WHEN 用户分别通过「＋」、拖拽和剪贴板图片加入文件
- THEN 组件都通过同一个受控 callback 输出有序 File 输入
- AND 原始文件路径不进入 textarea。

### Scenario: 粘贴普通文字不创建附件
- GIVEN 剪贴板只有文字
- WHEN 用户在 textarea 粘贴
- THEN 文字进入正文
- AND 不调用图片附件 callback。

## Requirement: 图片与普通文件使用结构化附件呈现
## Requirement: Agent 本地图片引用在所属消息内形成有序预览
Source: docs/product/pages/main-conversation.md#会话图片预览与大图查看

系统 MUST 只从 Agent 最终消息的既有 Markdown 文件引用节点语义取得本地图片候选，并按首次出现顺序在所属消息正文后呈现；代码、转义文本、HTML、远程 URL、未知自定义协议和普通非引用文本 MUST NOT 生成本地图片预览。原文件引用入口 MUST 保留，远程 Markdown 图片 MUST NOT 再生成第二份预览。

用户附件与 Agent 图片 MUST 使用同一图片预览结构，正常视觉界面只显示图片；文件名和来源仍进入替代文字或辅助名称。图片卡 MUST 统一 160px 高、按原图比例完整显示并限制最大宽度 320px，MUST NOT 裁剪图片内容；图片状态卡（loading、failed、missing、changed、unsafe）MUST 与图片卡同高 160px。单条消息图片超过 6 张时 MUST 直接显示前 6 张并把其余折叠为一个「查看全部图片（共 N 张）」入口，激活该入口 MUST 从本条消息第一张开始在大图查看层按序查看全部图片。多图 MUST 在消息边界内响应式换列，MUST NOT 撑宽主页面。

#### Scenario: Agent 回复中的两张本地图片按出现顺序显示
- GIVEN Agent 最终消息先引用 SVG A，再引用 PNG B，并重复引用 A
- WHEN 时间线渲染消息
- THEN A 与 B 在正文后按首次出现顺序各显示一次
- AND 原文中的三个文件引用仍可分别激活。

#### Scenario: 代码块路径不生成预览
- GIVEN Agent 最终消息在代码块写出 `/tmp/example.png`，正文没有文件引用
- WHEN 时间线渲染消息
- THEN 不生成本地图片预览
- AND 代码块内容保持原样。

#### Scenario: 普通非图片文件引用不生成图片状态卡
- GIVEN Agent 最终消息引用实际存在的 `/src/config.ts`
- WHEN 时间线渲染消息
- THEN 该引用不进入本地图片预览候选
- AND 不生成 loading、failed、missing、changed 或 ready 图片状态卡，原文件引用入口继续保持可见可用。

### Requirement: 会话图片支持受控大图查看
Source: docs/product/pages/main-conversation.md#会话图片预览与大图查看

每个 ready 图片预览 MUST 是可点击、可键盘聚焦的按钮，Enter 与 Space MUST 打开当前对话图片集合中对应索引的 Lightbox。Lightbox MUST 使用现有 Dialog 的遮罩、焦点和关闭语义，但视觉层只展示图片和轻量控制，不显示文件名、格式和来源。图片 MUST 保持比例并适应可用区域；Lightbox MUST 提供上一张、下一张、放大、缩小、恢复适应窗口和放大后的拖拽，不得提供旋转、编辑或下载。

关闭按钮与 Escape MUST 关闭 Dialog，并恢复触发按钮的焦点和会话阅读位置。关闭 MUST NOT 触发 Agent、消息、附件或文件 mutation。GIF 与 SVG 在大图中仍使用静态、安全派生预览。

#### Scenario: 键盘打开并关闭大图
- GIVEN 时间线有一张 ready 图片且触发按钮已聚焦
- WHEN 用户按 Space，再按 Escape
- THEN 大图 Dialog 打开后关闭
- AND 焦点回到原图片按钮
- AND 会话滚动位置与 Agent 运行状态不变。

#### Scenario: 同一对话内切换与缩放
- GIVEN 当前对话按顺序有三张 ready 图片，第二张预览已聚焦
- WHEN 用户打开 Lightbox，点击下一张，放大后拖拽，再按 `0`
- THEN Lightbox 依次显示第二张、第三张
- AND 图片缩放与偏移可改变并能恢复适应窗口
- AND 关闭后焦点仍回到第二张原预览按钮。

#### Scenario: 窄窗口大图不撑宽页面
- GIVEN 主窗口缩窄且图片大于可用区域
- WHEN 用户打开大图
- THEN 图片保持比例并只在 Dialog 内容区滚动
- AND 主页面不产生横向滚动。

### Requirement: 图片预览异步状态局部降级且抵抗迟到响应
Source: docs/product/pages/main-conversation.md#会话图片预览与大图查看

图片加载、失败、文件不存在、安全拒绝与文件变化 MUST 占用当前预览槽，并使用 PRD 指定的可执行文案；失败 MUST 只替换当前图片，不得隐藏正文、其他图片或普通附件。重新加载 MUST 只重新读取当前预览；打开文件 MUST 走既有受控文件入口。

切换 session、消息消失、重试或关闭页面后，旧请求的迟到结果 MUST NOT 写入当前消息或大图；所有被替换或移除的 object URL MUST 释放。

#### Scenario: 切换会话后旧图片迟到
- GIVEN session A 的 Agent 图片仍在加载
- WHEN 用户切到 session B，随后 A 的响应成功
- THEN B 不显示 A 的图片或错误
- AND A 的迟到 Blob URL 被释放。

#### Scenario: 单张失败不影响同消息其他内容
- GIVEN 一条 Agent 消息含正文、ready PNG、缺失 SVG 和普通文件引用
- WHEN SVG 加载返回 not-found
- THEN SVG 槽显示 `找不到这张图片`
- AND 正文、PNG 与普通文件引用保持可见可用。

## Requirement: 会话图片支持受控大图查看
Source: docs/product/pages/main-conversation.md#会话图片预览与大图查看

每个 ready 图片预览 MUST 是可点击、可键盘聚焦的按钮，Enter 与 Space MUST 打开当前对话图片集合中对应索引的 Lightbox。Lightbox MUST 使用现有 Dialog 的遮罩、焦点和关闭语义，但视觉层只展示图片和轻量控制，不显示文件名、格式和来源。图片 MUST 保持比例并适应可用区域；Lightbox MUST 提供上一张、下一张、放大、缩小、恢复适应窗口和放大后的拖拽，不得提供旋转、编辑或下载。

关闭按钮与 Escape MUST 关闭 Dialog，并恢复触发按钮的焦点和会话阅读位置。关闭 MUST NOT 触发 Agent、消息、附件或文件 mutation。GIF 与 SVG 在大图中仍使用静态、安全派生预览。

#### Scenario: 键盘打开并关闭大图
- GIVEN 时间线有一张 ready 图片且触发按钮已聚焦
- WHEN 用户按 Space，再按 Escape
- THEN 大图 Dialog 打开后关闭
- AND 焦点回到原图片按钮
- AND 会话滚动位置与 Agent 运行状态不变。

#### Scenario: 同一对话内切换与缩放
- GIVEN 当前对话按顺序有三张 ready 图片，第二张预览已聚焦
- WHEN 用户打开 Lightbox，点击下一张，放大后拖拽，再按 `0`
- THEN Lightbox 依次显示第二张、第三张
- AND 图片缩放与偏移可改变并能恢复适应窗口
- AND 关闭后焦点仍回到第二张原预览按钮。

#### Scenario: 窄窗口大图不撑宽页面
- GIVEN 主窗口缩窄且图片大于可用区域
- WHEN 用户打开大图
- THEN 图片保持比例并只在 Dialog 内容区滚动
- AND 主页面不产生横向滚动。

### Requirement: 图片预览异步状态局部降级且抵抗迟到响应
Source: docs/product/pages/main-conversation.md#会话图片预览与大图查看

图片加载、失败、文件不存在、安全拒绝与文件变化 MUST 占用当前预览槽，并使用 PRD 指定的可执行文案；失败 MUST 只替换当前图片，不得隐藏正文、其他图片或普通附件。重新加载 MUST 只重新读取当前预览；打开文件 MUST 走既有受控文件入口。

切换 session、消息消失、重试或关闭页面后，旧请求的迟到结果 MUST NOT 写入当前消息或大图；所有被替换或移除的 object URL MUST 释放。

#### Scenario: 切换会话后旧图片迟到
- GIVEN session A 的 Agent 图片仍在加载
- WHEN 用户切到 session B，随后 A 的响应成功
- THEN B 不显示 A 的图片或错误
- AND A 的迟到 Blob URL 被释放。

#### Scenario: 单张失败不影响同消息其他内容
- GIVEN 一条 Agent 消息含正文、ready PNG、缺失 SVG 和普通文件引用
- WHEN SVG 加载返回 not-found
- THEN SVG 槽显示 `找不到这张图片`
- AND 正文、PNG 与普通文件引用保持可见可用。

## Requirement: 图片预览异步状态局部降级且抵抗迟到响应
Source: docs/product/pages/main-conversation.md#会话图片预览与大图查看

图片加载、失败、文件不存在、安全拒绝与文件变化 MUST 占用当前预览槽，并使用 PRD 指定的可执行文案；失败 MUST 只替换当前图片，不得隐藏正文、其他图片或普通附件。重新加载 MUST 只重新读取当前预览；打开文件 MUST 走既有受控文件入口。

切换 session、消息消失、重试或关闭页面后，旧请求的迟到结果 MUST NOT 写入当前消息或大图；所有被替换或移除的 object URL MUST 释放。

#### Scenario: 切换会话后旧图片迟到
- GIVEN session A 的 Agent 图片仍在加载
- WHEN 用户切到 session B，随后 A 的响应成功
- THEN B 不显示 A 的图片或错误
- AND A 的迟到 Blob URL 被释放。

#### Scenario: 单张失败不影响同消息其他内容
- GIVEN 一条 Agent 消息含正文、ready PNG、缺失 SVG 和普通文件引用
- WHEN SVG 加载返回 not-found
- THEN SVG 槽显示 `找不到这张图片`
- AND 正文、PNG 与普通文件引用保持可见可用。

Source: docs/product/pages/main-conversation.md#会话图片预览与大图查看

composer 草稿和已发送用户消息 MUST 在正文之外呈现有序附件：能安全预览的 PNG、JPEG、GIF、WebP、SVG、ICO、BMP 与 AVIF 正常态只显示图片缩略图，普通文件继续使用文件名、类型、大小卡片。图片缩略图 MUST 统一 160px 高、按原图比例完整显示并限制最大宽度 320px，不裁剪图片内容。文件名、格式和来源 MUST 保留在图片的替代文字或辅助名称中，但正常视觉界面不重复展示。GIF MUST 使用静态预览；SVG/ICO/BMP/AVIF MUST 作为普通文件提交并进入附件清单，有派生预览时以图片卡呈现，无法安全解码时 MUST 作为 ready 普通文件卡片呈现。pending、failed 与 ready MUST 有非纯颜色的可辨认状态；failed MUST 提供重试和移除，pending MUST 允许移除。窗口缩窄时 MUST 不产生页面级横向滚动。

结构化附件组件 MUST NOT 把本地资源 URL 交给 Markdown renderer。组件卸载、消息切换或预览替换时 MUST 释放 renderer 创建的临时 object URL。

#### Scenario: SVG 与 PDF 使用不同卡片
- GIVEN 一条草稿含一张 ready SVG 和一个 ready PDF
- WHEN composer 渲染
- THEN 安全 SVG 显示静态缩略图，PDF 显示含名称、类型和大小的普通文件卡片
- AND 两项顺序与草稿顺序一致。

#### Scenario: SVG 降级不阻止其他内容发送
- GIVEN 草稿含正文、一个 ready 附件和一个无法安全预览但已降级为普通文件的 SVG
- WHEN composer 计算发送状态
- THEN SVG 卡片说明它会作为普通文件发送
- AND 正文、ready 附件与 SVG 可以共同发送。

#### Scenario: 失败附件不清空其他草稿
- GIVEN 草稿含正文、一个 ready 附件和一个 failed 栅格图片
- WHEN failed 卡片显示错误
- THEN 正文和 ready 附件仍在
- AND 用户可对 failed 项重试或移除
- AND 发送保持禁用直到没有 pending/failed 项。

Source: docs/product/pages/main-conversation.md#带附件的输入框与时间线

composer 草稿和已发送用户消息 MUST 在正文之外呈现有序附件：图片使用缩略图和文件名，普通文件使用文件名、类型、大小卡片。pending、failed 与 ready MUST 有非纯颜色的可辨认状态；failed MUST 提供重试和移除，pending MUST 允许移除。附件名称过长或窗口缩窄时 MUST 截断或换行而不产生页面级横向滚动。

结构化附件组件 MUST NOT 把本地资源 URL交给 Markdown renderer。组件卸载或预览替换时 MUST 释放 renderer 创建的临时 object URL。

### Scenario: 图片与 PDF 使用不同卡片
- GIVEN 一条草稿含一张 ready 图片和一个 ready PDF
- WHEN composer 渲染
- THEN 图片显示缩略图，PDF 显示含名称、类型和大小的普通文件卡片
- AND 两项顺序与草稿顺序一致。

### Scenario: 失败附件不清空其他草稿
- GIVEN 草稿含正文、一个 ready 附件和一个 failed 附件
- WHEN failed 卡片显示错误
- THEN 正文和 ready 附件仍在
- AND 用户可对 failed 项重试或移除
- AND 发送保持禁用直到没有 pending/failed 项。

## Requirement: composer 支持纯附件与附件草稿恢复
Source: docs/product/pages/main-conversation.md#输入框

发送可用性 MUST 接受“trim 后正文非空”或“至少一个 ready 附件”任一条件，并在存在 pending/failed 附件、项目未选、selection mutation、不可继续 session 或既有发送禁用条件时保持禁用。成功发送后 MUST 清空当前正文和附件草稿；失败时 MUST 保留二者。

renderer MUST 用 `draft:new` 和 `draft:<sessionId>` 隔离附件草稿，并在切换对话或应用重启后把服务端持久化的附件与对应正文草稿重新组合，MUST NOT 把一个会话的附件显示或提交到另一个会话。

### Scenario: 只有 ready 图片时可发送
- GIVEN 项目已选、没有其他禁用条件、正文为空且有一张 ready 图片
- WHEN composer 计算发送状态
- THEN 发送可用
- AND提交 callback 收到空正文与该图片 id。

### Scenario: 发送失败保留完整草稿
- GIVEN 正文和两个 ready 附件提交失败
- WHEN renderer 收敛失败响应
- THEN 正文和两个附件仍在原 draft key
- AND 用户可以不重新选择原文件直接重试。

## Requirement: mc-39 输入法组合期间 Enter 不提交消息
Source: docs/product/pages/main-conversation.md#输入框

系统 MUST 在消息输入框处于输入法组合状态时让 Enter 只交给输入法确认候选词，并在组合结束后让非 Shift 的 Enter 提交当前可发送草稿。系统 MUST 让 Shift+Enter 保持换行语义。系统 MUST NOT 在输入法组合期间发送消息或选择提及补全项。

### Scenario: 组合文字时确认候选词
- GIVEN 会话页或新对话页的共享输入框正在组合中文、日文或韩文文字
- WHEN 用户按下 Enter
- THEN 输入法可以确认候选词且消息提交回调没有触发

### Scenario: 组合结束后发送与换行
- GIVEN 输入法组合已经结束且草稿满足发送条件
- WHEN 用户按下 Enter 或 Shift+Enter
- THEN Enter 触发一次消息提交，Shift+Enter 不触发提交并保留换行语义

## Requirement: mc-40 composer 是主理人专属控制面
Source: docs/product/pages/main-conversation.md#输入框

系统 MUST 让已有会话 composer 按 runtime 提供的 dispatch 事实表达消息目标：唯一有效成员 mention 可直达该成员，其余情况交给主 Agent。主 Agent 运行时，composer MUST 同时保留可编辑输入、发送能力和一个只绑定主 Agent `runId` 的方形停止按钮；输入内容、直达其他成员的发送或其他专业成员活动 MUST NOT 隐藏、改写或误绑定该停止按钮。专业 Agent 运行而主 Agent 空闲时，composer MUST NOT 显示主理人停止按钮。

### Scenario: 主理人运行时仍可直达空闲成员
- GIVEN 主 Agent 正在运行、qa 空闲且 composer 包含唯一 `@qa`
- WHEN 用户发送
- THEN 页面保持“停下主理人”动作绑定原主 Agent runId
- AND 发送动作不伪装成停止动作
- AND 后续 state 可同时显示主 Agent 与 qa 活动记录

### Scenario: 主理人运行中继续输入
- GIVEN 主 Agent 正在运行且 composer 包含可发送正文
- WHEN 用户查看并操作 composer
- THEN 页面同时存在发送动作和“停下主理人”可访问动作
- AND 停下动作仍绑定原主 Agent runId

### Scenario: 只有专业成员运行
- GIVEN qa 正在运行且主 Agent 空闲
- WHEN 用户查看 composer
- THEN composer 显示普通发送动作且没有主理人停止按钮
- AND qa 的活动行显示只绑定 qa runId 的停止动作

### Scenario: 停下请求与运行结束竞态
- GIVEN 输入框已经显示主理人停下按钮但对应 run 在请求到达前结束
- WHEN 停下入口返回没有匹配活动 run
- THEN 桌面操作台刷新会话事实且不把该竞态显示为停下失败

## Requirement: 待发射区显示真实目标与恢复状态
Source: docs/product/pages/main-conversation.md#团队推进中

operator console MUST 使用 runtime 的 pending dispatch 投影显示待发射项，逐条展示提交顺序、可读目标成员与正文或附件摘要。主 Agent、专业成员和 awaiting-team MUST 有非猜测的可读目标文案。组件 MUST NOT 从正文 mention 自行推导目标，MUST NOT 把不同成员队列呈现成一个会阻塞彼此的全局 FIFO。

待发射消息 MUST NOT 同时出现在主时间线；当该消息被 runtime 领取并启动目标 Agent 后，MUST 从待发射区移除并出现在时间线。刷新与重启 MUST 保持相同归属。待发射区 MUST 继续与主会话正文列和 composer 对齐，在窄窗口中内部有界滚动且不产生页面级横向滚动。父级使用新 state 重渲染时 MUST 替换旧目标和顺序，不得缓存过期 props。

### Scenario: 忙碌 qa 的 pending 可见
- GIVEN pending dispatch 含两条 targetRole=qa 的用户消息
- WHEN operator console 渲染
- THEN 两条都显示目标为 qa 的可读名称
- AND 顺序与 runtime 投影一致
- AND 区域不显示“待发射给主理人”这一错误目标

### Scenario: 多目标回主 Agent 的真实结果可见
- GIVEN 用户正文含 `@qa @dev`，runtime 投影 targetRole=dev-manager
- WHEN 该消息因主 Agent 忙碌进入 pending
- THEN 待发射项显示目标为主 Agent 的可读名称
- AND UI 不把 qa 或 dev 显示为已排队执行者

### Scenario: 团队切换等待项不冒认旧成员
- GIVEN pending dispatch 状态为 awaiting-team
- WHEN 待发射区渲染
- THEN 目标文案说明“新团队生效后决定”
- AND 不显示旧团队任一成员为目标

### Scenario: 父级更新后目标不陈旧
- GIVEN 首次 props 把消息目标显示为 qa
- WHEN 父级以相同组件实例重渲染并把该消息更新为 awaiting-team 或新团队成员
- THEN 页面只显示最新目标
- AND 旧 qa 目标不再可见

### Scenario: 发射后进入时间线
- GIVEN 待发射区有两条 qa 消息且 qa 活动 run 进入终态
- WHEN runtime 领取下一条 qa 消息
- THEN 第一条从待发射区进入主时间线并启动 qa
- AND 第二条继续留在待发射区

## Requirement: 每个专业 Agent 活动行精确停止自身
Source: docs/product/pages/main-conversation.md#运行中的操作条

系统 MUST 为每个活动专业 Agent 分别渲染一条原地更新的 RunBlock，并在该行提供绑定其 `sessionId + runId` 的停止动作。主 Agent RunBlock MUST NOT 重复显示停止动作。停止任一专业 Agent MUST NOT 移除、停止或替换其他活动 run。

### Scenario: 两个专业 Agent 并行
- GIVEN dev 与 qa 在同一会话中拥有不同 runId 的活动 run
- WHEN 用户点击 dev 行的停止
- THEN 客户端只提交 dev 的 sessionId 与 runId
- AND qa 行继续显示为活动状态

## Requirement: 多活动 run 保持正文列与可访问性
Source: docs/product/pages/main-conversation.md#团队推进中

系统 MUST 让所有活动 RunBlock 复用历史消息正文列并保持稳定的启动顺序。每个停止按钮 MUST 具有包含成员名称的可访问名称，键盘焦点 MUST 只落在可操作的对应行，不得以颜色或位置作为唯一目标区分。

### Scenario: 键盘区分三个停止目标
- GIVEN 主 Agent、dev 与 qa 同时运行
- WHEN 键盘用户遍历运行操作
- THEN composer 暴露“停下主理人”
- AND dev 与 qa 行分别暴露包含各自成员名称的停止动作

## Requirement: mc-41 改一改重发入口只属于用户停下记录
Source: docs/product/pages/main-conversation.md#停下

系统 MUST 只在 `user-stopped` 的「你让这一步停下了」系统记录旁提供键盘可达且可访问名称明确的「改一改重发」入口。系统 MUST NOT 在其他运行结果或一般用户、Agent 历史消息旁显示该入口。

### Scenario: 停下记录与普通历史同时存在
- GIVEN 时间线同时包含一条 `user-stopped` 系统记录、普通历史消息和卡住记录
- WHEN 用户查看并用键盘遍历时间线操作
- THEN 只有 `user-stopped` 系统记录旁存在一个「改一改重发」入口

## Requirement: mc-41 回填使用停下轮次最近的用户消息
Source: docs/product/pages/main-conversation.md#停下

系统 MUST 从被操作的 `user-stopped` 记录向前定位同一会话最近一条用户消息作为本轮起点，并把该消息正文回填到当前会话草稿。系统 MUST NOT 把接力中的 Agent 消息或其他会话消息当作回填起点。

### Scenario: 多成员接力中停下
- GIVEN 一条用户消息先触发开发成员、随后由开发成员接力给测试成员且测试步骤被用户停下
- WHEN 用户激活该停下记录旁的「改一改重发」
- THEN 输入框回填接力开始前最近一条用户消息的正文

## Requirement: mc-41 附件以新草稿引用按原顺序回填
Source: docs/product/pages/main-conversation.md#停下

系统 MUST 把本轮起点用户消息的附件按原顺序克隆为当前会话草稿的新引用，并让正文与附件共同遵循既有草稿持久化。系统 MUST NOT 修改原消息附件引用、复制托管 blob 内容或直接改写附件表绕过克隆能力。

### Scenario: 回填带附件的停下轮次
- GIVEN 本轮起点用户消息按顺序包含两个托管附件且当前步骤已被用户停下
- WHEN 用户激活「改一改重发」并切换会话后返回
- THEN 输入框恢复原正文且附件草稿包含两个顺序不变的新引用
- AND 原消息仍引用原 attachment ids 和原 blobs

## Requirement: mc-41 重发追加新消息且保留原消息
Source: docs/product/pages/main-conversation.md#停下

系统 MUST 让修改后的草稿通过既有发送入口追加为新用户消息，并在内部携带被停下的原 runId 作为恢复目标。该 metadata 不得显示在正文中；系统仍不得修改或删除原消息。

### Scenario: 修改正文后重发并关联原 run
- GIVEN 改一改重发已经回填原消息且记录被停下的 runId
- WHEN 用户修改正文并使用普通发送按钮提交
- THEN 时间线追加一条包含修改后正文的新用户消息
- AND 原用户消息的正文、附件和时间线位置保持不变
- AND 恢复请求只指向被停下的原 runId

## Requirement: 主时间线与子会话 Retry 调用同一恢复动作
Source: docs/product/pages/main-conversation.md#退出应用与恢复执行

系统 MUST 为 `run-not-started` 与 `run-stuck` 记录把 `sessionId + runId` 传给恢复 callback。主时间线和右侧子会话 MUST 使用相同语义，不得用一条可见“请重试”普通消息模拟 Retry。

### Scenario: 主时间线点击 Retry
- GIVEN 主时间线显示带 runId 的 stuck 记录
- WHEN 用户点击 Retry
- THEN renderer 请求该 session 和 run 的恢复 API
- AND 时间线不追加伪造的“请重试”用户消息

### Scenario: Retry 缺少 runId
- GIVEN 终态记录没有可定位的 runId
- WHEN 界面渲染该记录
- THEN Retry 不可调用错误的最近 run

## Requirement: mc-41 回填与重发不回滚工作空间文件
Source: docs/product/pages/main-conversation.md#停下

系统 MUST 在回填和重发期间保留停下前已经产生的工作空间文件状态。系统 MUST NOT 因激活「改一改重发」或提交新消息而执行文件恢复、工作空间重建、reset、checkout、merge 或 rebase。

### Scenario: 停下前已有文件改动
- GIVEN 被停下的步骤已经在工作空间产生文件改动
- WHEN 用户依次激活「改一改重发」、修改草稿并发送
- THEN 工作空间中停下前的文件改动仍然存在

## Requirement: mc-41 不提供历史消息编辑或分叉入口
Source: docs/product/pages/main-conversation.md#停下

系统 MUST 把「改一改重发」保持为 `user-stopped` 系统记录上的草稿回填动作。系统 MUST NOT 提供历史消息原地编辑、从任意历史消息分叉、或从任意历史消息重跑的入口。

### Scenario: 浏览一般历史消息
- GIVEN 时间线包含多条已发送的用户与 Agent 历史消息且没有对应的 `user-stopped` 记录操作
- WHEN 用户查看历史消息可用操作
- THEN 不存在编辑、分叉、重发或重跑历史消息的入口

## Requirement: #22 一轮结束留下结果卡片
Source: docs/product/pages/main-conversation.md#区域与信息

系统 MUST 在没有任何成员在工作且没有待处理交棒时，于时间线末尾展示结果卡片，说明这段对话期间有几个文件发生改动并提供一步打开改动内容的入口；右侧栏正式形态已就绪，该入口 MUST 打开或聚焦右侧栏对应的“改动”标签；没有文件改动时 MUST 如实说明；项目文件夹不是 Git 仓库时 MUST NOT 出现结果卡片。系统 MUST NOT 在卡片上铺开文件清单，MUST NOT 声称这些改动由团队成员造成，MUST NOT 按单个步骤结束反复产出卡片。

### Scenario: 一轮结束且有改动
- GIVEN 一轮工作结束且没有成员继续接力，这段对话期间有 2 个文件发生改动
- WHEN 用户查看时间线末尾
- THEN 出现结果卡片说明有 2 个文件发生改动，只给数量与查看入口，措辞不归因于成员

### Scenario: 一轮结束但什么都没改
- GIVEN 一轮工作结束且这段对话期间没有文件发生改动
- WHEN 用户查看时间线末尾
- THEN 结果卡片如实说明没有文件发生改动，不省略卡片

### Scenario: 非 Git 项目不出卡片
- GIVEN 当前会话的项目文件夹不是 Git 仓库
- WHEN 一轮工作结束
- THEN 时间线末尾不出现结果卡片

### Scenario: 查看改动使用右侧栏正式形态
- GIVEN 一张结果卡片只展示改动文件数量与「查看改动」入口
- WHEN 用户点击「查看改动」
- THEN 右侧栏打开或聚焦对应的“改动”标签

## Requirement: 验收 #1 右侧栏开关与原始宽度偏好全局持久化
Source: docs/product/pages/main-right-sidebar.md#入口与去向
Source: docs/product/pages/main-right-sidebar.md#响应式与窗口行为

系统 MUST 在没有已保存开关偏好时默认关闭右侧栏，在没有已保存宽度偏好时按当前可用内容宽度的 50% 呈现。用户改变开关或主动调整宽度后，系统 MUST 跨对话与应用重启恢复对应原始偏好。窗口或左导航变化导致宽度暂时越界时 MUST 只夹取呈现值，不得覆盖原始偏好。开合 MUST NOT 清空当前会话草稿、改变运行状态或重置会话区滚动位。

### Scenario: 缩窗只临时夹取已保存宽度
- GIVEN 用户已保存 700px 右栏宽度
- WHEN 可用内容宽度缩窄到只能呈现 520px，随后恢复到 1200px 并重启应用
- THEN 缩窄期间右栏呈现 520px
- AND 恢复和重启后右栏重新呈现 700px

## Requirement: 验收 #2 标签条按对话隔离并跨重启恢复
Source: docs/product/pages/main-right-sidebar.md#入口与去向

系统 MUST 按会话标识分别持久化标签列表与当前标签，并在切换会话或重启应用后恢复目标会话自己的标签条。系统 MUST NOT 把一个会话的标签带到另一个会话，且 MUST NOT 因持久化数据包含未知标签类型而使右侧栏崩溃。

### Scenario: 两个会话恢复各自标签
- GIVEN 会话 A 打开了“改动”和“项目文件”，会话 B 只打开了“改动”
- WHEN 用户从会话 B 切回会话 A 并重启应用
- THEN 会话 A 恢复“改动”和“项目文件”及其原选中项

## Requirement: 验收 #7 非 Git 项目不提供改动类型
Source: docs/product/pages/main-right-sidebar.md#空白标签与类型选择

系统 MUST 在当前项目文件夹不是 Git 仓库时只显示“项目文件”类型，并显示改动不可用的原因。系统 MUST NOT 显示或创建“改动”类型，也 MUST NOT 静默隐藏该类型而不解释。

### Scenario: 非 Git 项目打开空白标签
- GIVEN 当前会话绑定的项目文件夹不是 Git 仓库
- WHEN 用户通过加号打开空白标签
- THEN 类型选择仅有“项目文件”且同时显示不是 Git 仓库的说明

## Requirement: 验收 #15 来源标签去重而手动标签不去重
Source: docs/product/pages/main-right-sidebar.md#标签条

系统 MUST 以来源键去重主对话区打开的标签，重复打开同一来源时聚焦已有标签；系统 MUST 让每次加号操作创建新的空白标签。系统 MUST NOT 因标签类型相同而合并来自不同来源或用户手动创建的标签。

### Scenario: 重复打开同一结果卡片
- GIVEN 结果卡片对应的改动标签已经存在且用户当前位于另一个标签
- WHEN 用户再次点击该结果卡片的“查看”
- THEN 标签总数不变且已有改动标签成为当前标签

## Requirement: 验收 #16 最后标签关闭时右侧栏保留退场快照
Source: docs/product/pages/main-right-sidebar.md#标签全部关闭
Source: docs/product/pages/main-right-sidebar.md#关闭标签

系统 MUST 为每个标签提供关闭操作。最后一个标签关闭后 MUST 立即保存零标签状态并开始关闭右侧栏；出场期间 MUST 保留最后内容的不可交互视觉快照，完成后才从页面结构移除。系统 MUST NOT 创建虚假的空白标签、先显示空白工作面、关闭对话、停止推进或取消子任务。之后仅通过显示按钮重开时 MUST 显示内容选择面，且选择前标签数仍为零。

### Scenario: 关闭最后标签后重开
- GIVEN 右侧栏只剩一个改动标签
- WHEN 用户关闭该标签
- THEN 标签状态立即为空且旧改动内容只作为 inert 快照保留至退场完成
- WHEN 用户重新显示右侧栏
- THEN 页面显示“这个标签要看什么”且没有已创建标签

## Requirement: 验收 #17 加号只创建两类可选内容
Source: docs/product/pages/main-right-sidebar.md#空白标签与类型选择

系统 MUST 让加号创建一个不参与去重的空白标签，并在 Git 项目中提供“新会话”“改动”和“项目文件”三种选择。系统 MUST NOT 在类型选择中出现过程、子任务、终端、预览或浏览器。没有“新会话”类型时，生产类型与既有普通会话行为仍 MUST 保留。

### Scenario: Git 项目打开空白标签
- GIVEN 当前会话绑定的是 Git 项目
- WHEN 用户点击标签条加号
- THEN 新空白标签的类型选择恰好包含“新会话”“改动”和“项目文件”

## Requirement: 验收 #18 空白标签说明受来源约束的内容入口
Source: docs/product/pages/main-right-sidebar.md#空白标签与类型选择

系统 MUST 在空白标签中说明成员完整输出与子任务需要从主对话区点开。系统 MUST NOT 把过程或子任务伪装成缺失的通用类型选择。

### Scenario: 用户查看空白标签说明
- GIVEN 用户已经通过加号创建空白标签
- WHEN 空白标签成为当前标签
- THEN 页面可见文字说明成员完整输出与子任务从主对话区点开

## Requirement: 验收 #19 内容更新不抢占当前标签
Source: docs/product/pages/main-right-sidebar.md#内容更新

系统 MUST 在标签内容或会话状态更新时保留用户当前选中的标签。系统 MUST NOT 因非当前标签出现新内容而自动改变当前标签。

### Scenario: 用户阅读项目文件时会话刷新
- GIVEN 用户当前选中“项目文件”标签且“过程”标签收到新内容
- WHEN 会话状态刷新
- THEN “项目文件”仍为当前标签

## Requirement: 验收 #23 右侧栏按可用内容宽度切换并排与覆盖
Source: docs/product/pages/main-right-sidebar.md#窄窗口
Source: docs/product/pages/main-right-sidebar.md#响应式与窗口行为

系统 MUST 以应用窗口扣除当前可见左导航后的可用内容宽度作为布局输入。宽度达到或超过 960px 时 MUST 并排显示主会话与右栏；低于 960px 时 MUST 让右栏占满内容面并覆盖会话区，提供独立关闭入口。仅因窗口或左导航变化跨越断点时 MUST NOT 播放开关动画、丢失焦点、标签或阅读位置。关闭后 MUST 恢复打开前的会话区滚动位。

标签条 MUST 使用单一 Tab 停靠点，并支持 `ArrowLeft`、`ArrowRight`、`Home`、`End` 在标签间选择和移动焦点；该行为 MUST 覆盖普通“新会话”标签。

### Scenario: 960px 边界
- GIVEN 右侧栏已经打开
- WHEN 可用内容宽度依次为 960px 和 959px
- THEN 960px 使用并排布局且右栏为 480px
- AND 959px 使用占满内容面的覆盖布局且没有宽度分隔线

## Requirement: 右侧工作区按比例和双面可读边界呈现
Source: docs/product/pages/main-right-sidebar.md#响应式与窗口行为

并排布局没有宽度偏好时，系统 MUST 让右栏取可用内容宽度的 50%，取整误差不超过 1px。右栏 MUST 至少 480px；当前最大值 MUST 取可用内容宽度 75% 与给主会话保留 480px 后剩余宽度的较小者。

### Scenario: 无偏好的 1200px 内容面
- GIVEN 没有保存右栏宽度偏好
- WHEN 可用内容宽度为 1200px
- THEN 右栏宽度为 600px 且主会话宽度不小于 480px

## Requirement: 分隔线同时支持指针与键盘宽度调整
Source: docs/product/pages/main-right-sidebar.md#宽度调整分隔线

并排布局 MUST 提供贯穿内容高度、命中区大于可见细线的可聚焦垂直 separator，公开当前、最小和动态最大宽度。左拖 MUST 扩大右栏、右拖 MUST 缩小；`ArrowLeft/ArrowRight` MUST 分别扩大/缩小 16px，Shift 步长为 64px，Home/End MUST 到当前边界。hover、拖动、键盘焦点和抵达边界 MUST 有强调反馈；继续越界操作 MUST 保持边界且不得抖动、位移或弹 toast。

### Scenario: 键盘到达动态最大值
- GIVEN 1200px 内容面中的分隔线获得键盘焦点
- WHEN 用户按 End 后继续按 ArrowLeft
- THEN 右栏保持 720px
- AND separator 的当前值与边界反馈一致

## Requirement: 右侧工作区开合可反向且安全退场
Source: docs/product/pages/main-right-sidebar.md#打开与关闭右侧栏

右侧栏 MUST 使用 150ms 无弹性标准缓动从右缘展开并沿原路径收回。并排时主会话 MUST 同步让出或收回空间；覆盖时右栏 MUST 从右缘覆入或退出；内容 MUST 只被裁切或平移，不得缩放、弹跳或先显示空白面。动画中再次开关 MUST 从当前进度响应最后意图，不排队或跳回端点。

关闭开始时右栏 MUST 立即停止指针和键盘交互，并把内部焦点移到主内容显示/隐藏按钮；视觉内容 MUST 保留到退出完成后才卸载和恢复主会话滚动位置。打开 MUST 保留开关焦点。用户启用减少动态效果时 MUST 立即完成目标状态。

### Scenario: 关闭途中重新打开
- GIVEN 已打开右栏正在执行关闭动画且尚未到端点
- WHEN 用户再次激活显示按钮
- THEN 右栏从当前进度立即反向打开且没有排队或端点跳变
- AND 最终保持打开

### Scenario: reduced-motion 关闭
- GIVEN 用户启用减少动态效果且焦点位于右栏内容
- WHEN 用户关闭右栏
- THEN 右栏立即移除且焦点位于主内容显示按钮
- AND 主会话滚动位置恢复

## Requirement: 过程标签以分层调试调用链呈现一次 Agent 执行
Source: docs/product/pages/main-right-sidebar.md#过程标签

系统 MUST 为每个 attempt 先显示完整运行状态、独立计时、开始 / 完成时间、model / effort / provider / CLI 和原始 run / thread 标识，再提供 `SYSTEM_PROMPT`、`DEVELOPER_PROMPT`、`USER_INPUT` 三个分层 disclosure，最后按时间顺序显示调用与输出事件。系统 MUST 常驻提示该本地调试视图可能包含提示词、路径与内部标识。系统 MUST NOT 把三层 prompt 拼成一个无来源文本块。

### Scenario: 用户展开一次 completed run
- GIVEN 过程响应包含完整 attempt 元数据和三层 prompt
- WHEN 用户打开该成员的完整输出并展开三层
- THEN 页面显示模型、精确开始 / 完成时间和 completed
- AND 三层分别显示自己的原文
- AND 页面常驻显示本地原始调试信息提示

## Requirement: 调试事件显示原始字段且安全只读
Source: docs/product/pages/main-right-sidebar.md#过程标签

系统 MUST 为调用与输出事件显示精确 ISO 时间戳、原始协议类型、call id、name 和 status，并让原始参数、结果、Agent 输出与 raw payload 可展开查看。绝对路径和内部标识 MUST 保持原值；终端控制字符 MUST 转为可见转义；所有原始内容 MUST 作为只读文本渲染，MUST NOT 作为 Markdown、HTML、脚本或终端控制序列执行。

### Scenario: 原始工具输出含 HTML、控制字符和内部路径
- GIVEN 工具输出包含 `<script>bad()</script>`、ESC 控制字符与完整绝对路径
- WHEN 用户展开原始输出
- THEN script 以文本可见且没有执行
- AND ESC 以可见转义显示
- AND 绝对路径未被省略或替换

## Requirement: token 统计进入调试链但 reasoning 不显示
Source: docs/product/pages/main-right-sidebar.md#过程标签

系统 MUST 将 token usage 作为独立调试事件显示原始协议类型与实际存在的 input / cached input / output / reasoning output / total 统计，MUST NOT 显示 reasoning 文本或 encrypted reasoning payload。

### Scenario: token 与 reasoning 同时存在
- GIVEN 一次执行的 rollout 同时记录 token usage 与 reasoning
- WHEN 用户查看该次执行的调用链
- THEN 页面显示 token 统计
- AND 页面中找不到 reasoning 文本或 encrypted payload

## Requirement: 长调试内容默认折叠且不截断
Source: docs/product/pages/main-right-sidebar.md#过程标签

系统 MUST 让长 prompt、参数、结果、raw payload 与 Agent 原始输出默认折叠；展开后 MUST 能从首行读到末行并允许选择复制。系统 MUST 继续以虚拟列表保持大型事件流的有界 DOM，MUST NOT 因 disclosure 把全部历史事件同时挂载。

### Scenario: 一千条事件包含超长输出
- GIVEN 一个 attempt 有 1,000 条事件且其中一条输出超过 20 行
- WHEN 过程标签首次渲染
- THEN 长输出正文默认不可见
- AND 事件 DOM 数量保持有界
- WHEN 用户展开长输出
- THEN 首行、中间行和末行均可见

## Requirement: prompt 惰性加载抵抗重渲染、慢返回与失败
Source: docs/product/pages/main-right-sidebar.md#内容更新

系统 MUST 按 `sessionId + runId` 隔离 prompt stack 的 idle / loading / ready / unavailable / error 状态。父级重渲染或 load callback 身份变化 MUST NOT 清空已经加载的 prompt；切换 attempt、tab 或 session 后迟到的旧响应 MUST NOT 覆盖当前目标；加载失败 MUST 提供局部重试且过程事件仍可阅读。

### Scenario: 慢请求期间切换到另一会话
- GIVEN attempt A 的 prompt 请求尚未返回
- WHEN 用户切换到会话 B 并展开 attempt B
- AND attempt A 的响应随后到达
- THEN 页面仍显示 attempt B 的状态与内容
- AND attempt A 的内容没有写入 B

### Scenario: 父级回调身份变化后请求成功
- GIVEN prompt 正在加载且父级重渲染产生新的 load callback 身份
- WHEN 原请求成功返回
- THEN 目标 attempt 进入 ready 且内容只保存一次
- AND 不因 callback 变化重新进入 loading 或重复请求

### Scenario: prompt 加载失败后重试
- GIVEN prompt 请求失败但过程事件已成功加载
- WHEN 页面显示局部错误
- THEN 调用与输出事件仍可阅读
- WHEN 用户点击重试且下一次请求成功
- THEN 三层 prompt 正常显示且事件阅读位置不变

## Requirement: 验收 #13 — 过程标签标题只由成员名和同成员序号组成
Source: docs/product/pages/main-right-sidebar.md#标签条

系统 MUST 使用步骤意图的 role 到成员名映射作为过程标签标题，同一会话内同时打开的同成员第二个及以后不同步骤的过程标签 MUST 依次命名为「成员名 2」「成员名 3」；同一步骤的初次执行与重试 MUST 以稳定 step id 复用唯一标签。终态 system 记录没有 role 时，系统 MUST 使用同一步消息或聚合过程响应中的 role 修正标题；确实无法映射 role 时 MUST 使用「成员未知」。标签文字溢出时 MUST 截断显示并由 `title` 提供完整标题。系统 MUST NOT 从步骤正文、摘要或实时输出生成描述性标题。

### Scenario: 同一成员打开两个不同步骤
- GIVEN 同一会话中开发成员有两个不同 step 的输出入口
- WHEN 用户依次点击两个入口的「完整输出」
- THEN 标签条同时出现「开发」与「开发 2」，且二者标题均不包含步骤正文

### Scenario: 从中断事实与重试回复打开同一步
- GIVEN 同一步第 1 次执行留下无 role 的中断 system 事实，第 2 次执行留下开发成员的成功回复
- WHEN 用户分别点击两条记录的「完整输出」
- THEN 标签条只保留一个标题为「开发」的过程标签
- AND 标签内聚合显示两次 attempt

## Requirement: 同一步多 attempt 各自保留调试事实
Source: docs/product/pages/main-right-sidebar.md#过程标签

系统 MUST 在同一过程标签内按开始顺序显示全部 attempts，并让每个 attempt 使用自己的 prompt stack、模型元数据、状态、时间和事件。单次 rollout 或 prompt stack 不可用 MUST 只降级该 attempt，MUST NOT 清空同一步其他 attempts。活动过程标签 MUST 持续轮询，因此某次执行已 settled、下一次 retry 尚未开始的间隙也不得停止更新。

### Scenario: 失败后重试同一步骤
- GIVEN 某步骤第一次执行失败并产生原始错误，第二次执行随后成功
- WHEN 用户查看该步骤的过程标签
- THEN 标签内先显示含原始错误的「第 1 次执行」，再显示「第 2 次执行」
- AND 两次执行分别显示自己的 prompt、模型、状态、耗时与完成时刻

### Scenario: 三次执行中第二次记录不可用
- GIVEN 同一步有 failed、unavailable、completed 三次执行
- WHEN 用户查看该步骤的过程标签
- THEN 第一次与第三次分别显示自己的 prompt、模型、状态和事件
- AND 第二次原位显示记录不可用
- AND 标签整体不降级为空

## Requirement: Codex 记录不可用时只显示明确空态
Source: docs/product/pages/main-right-sidebar.md#过程标签

系统 MUST 在过程接口报告关联或 rollout 不可用时显示「Codex 过程记录文件已不可用」并说明最终回复仍在主对话区。系统 MUST NOT 在过程正文中渲染 fallback、stdout tail、stderr tail 或最终 Agent 回复。

### Scenario: 历史 rollout 被清理
- GIVEN 用户从历史 Agent 消息打开过程标签且 Codex rollout 已不存在
- WHEN 加载完成
- THEN 页面显示记录不可用空态
- AND 不显示截断提示、标准输出、错误输出或保留记录区块

## Requirement: 首开到底且遵循离底暂停的跟随模型
Source: docs/product/pages/main-right-sidebar.md#内容更新

系统 MUST 在过程标签首次 ready 时定位最新事件；用户位于底部阈值内时新事件 MUST 自动保持在底部，用户向上离开阈值后 MUST 保持阅读位置并累计新内容数量，只有点击「到最新」或手动回到底部才恢复跟随。系统 MUST NOT 在 reading 状态因轮询、事件追加或 Markdown 高度变化抢走位置。

### Scenario: 阅读旧命令时收到三条新事件
- GIVEN 用户已从底部向上滚动并停在一条旧命令
- WHEN 活动 run 追加三条事件
- THEN 旧命令保持相同视口位置
- AND 页面显示三条新内容与到最新入口
- WHEN 用户点击到最新
- THEN 页面滚到最新事件并恢复自动跟随

## Requirement: 上滚分页与虚拟化保持锚点和有界 DOM
Source: docs/product/pages/main-right-sidebar.md#响应式与窗口行为

系统 MUST 仅挂载可视窗口及 overscan 范围内的动态高度事件节点；顶部触发 previous page 后 MUST 以旧首个可见 event key 与像素偏移恢复位置。系统 MUST NOT 让 DOM 节点数随完整 rollout 事件总数线性增长，也不得因插入前页把用户跳到页面顶部或底部。

### Scenario: 十万事件的 rollout
- GIVEN 一个过程投影包含十万条事件
- WHEN 用户从末尾持续向上加载多页
- THEN 用户最终可读到第一条事件
- AND 任一时刻挂载节点数保持在 viewport 与 overscan 的有界范围
- AND 每次插入前页后当前旧事件保持原视口位置

## Requirement: 每个过程标签恢复自己的阅读锚点
Source: docs/product/pages/main-right-sidebar.md#内容更新

系统 MUST 为每个过程标签保存最后阅读 event key、像素偏移与是否跟随最新，并在切换标签、关闭重开和应用重启后尽力恢复；来源重复打开只聚焦已有标签，不重置阅读位置。锚点已不存在时 MAY 回到最新，但 MUST NOT 使用其他标签的位置。

### Scenario: 两个开发过程标签停在不同位置
- GIVEN 「开发」停在历史中部且「开发 2」停在最新
- WHEN 用户切换标签并重启应用
- THEN 两个标签分别恢复各自位置与跟随状态

## Requirement: 验收 #3 结果卡片一步打开当前对话的改动标签
Source: docs/product/pages/main-right-sidebar.md#入口与去向

系统 MUST 让一轮结束结果卡片的「查看」动作直接打开右侧栏并聚焦当前对话唯一的来源改动标签。系统 MUST NOT 先显示类型选择，也 MUST NOT 为同一结果来源重复创建标签。

### Scenario: 从一轮结果查看改动
- GIVEN 当前对话一轮工作结束并显示含改动数量的结果卡片
- WHEN 用户点击「查看」
- THEN 右侧栏打开并聚焦该对话的改动标签，标签内容开始读取累计改动

## Requirement: 验收 #4 改动标签展示对话全程累计改动
Source: docs/product/pages/main-right-sidebar.md#改动标签

系统 MUST 展示相对当前对话开始基线的累计改动。系统 MUST NOT 把最后一步或最后一轮的局部改动冒充为整段对话改动。

### Scenario: 多轮工作后查看累计改动
- GIVEN 同一对话先后两轮分别改动了不同文件
- WHEN 用户在第二轮结束后打开改动标签
- THEN 文件树同时包含两轮相对对话开始基线产生的改动文件

## Requirement: 验收 #5 改动说明不归因于团队成员
Source: docs/product/pages/main-right-sidebar.md#改动标签

系统 MUST 以「这段对话期间，项目发生了这些改动」说明内容范围。系统 MUST NOT 声称这些改动由团队、成员或某个 Agent 造成。

### Scenario: 查看有改动的文件清单
- GIVEN 当前对话存在项目改动
- WHEN 改动标签完成加载
- THEN 顶部说明的主语为项目或这段对话，且说明中没有成员改动归因

## Requirement: 验收 #6 改动标签明确当前工作空间
Source: docs/product/pages/main-right-sidebar.md#改动标签

系统 MUST 使用「项目文件夹」或「独立工作空间」说明正在读取的位置；独立工作空间还 MUST 说明改动位于隔离副本且项目文件夹没有被动过。系统 MUST NOT 显示磁盘路径、`direct`、`worktree` 或「默认工作空间」。

### Scenario: 独立工作空间说明隔离后果
- GIVEN 当前对话使用独立工作空间
- WHEN 用户查看改动标签
- THEN 页面显示「独立工作空间」并说明隔离副本中的改动没有动项目文件夹

## Requirement: 验收 #8 文件内容逐行区分变化
Source: docs/product/pages/main-right-sidebar.md#改动标签

系统 MUST 为新增、删除与未改动行分别呈现可判定的行类型，并保留未改动上下文。系统 MUST NOT 把整个文件仅渲染为一段无变化标记的文本。

### Scenario: 查看同时包含增删的文件
- GIVEN 所选文件包含新增行、删除行与未改动上下文
- WHEN 文件内容读取完成
- THEN 三类行分别带 `addition`、`deletion`、`unchanged` 可观察标记并显示对应行号

## Requirement: 验收 #9 项目文件使用源码视图且改动使用 Review 视图
Source: docs/product/pages/main-right-sidebar.md#项目文件标签

系统 MUST 让改动标签只列改动文件，并让项目文件标签列出包含未改动文件的完整项目树。项目文件内容 MUST 显示完整当前文本和单一当前行号，MUST NOT 显示旧 / 新双行号、增删 line kind、`+` / `−` 或增删背景；改动标签 MUST 继续使用会话基线 diff，并以可访问且不只依赖颜色的信号区分新增、删除与上下文。

### Scenario: 浏览未改动文件
- GIVEN 项目包含一个改动文件和一个未改动文件
- WHEN 用户分别打开改动标签与项目文件标签
- THEN 改动标签只列改动文件并以 Review / Diff 呈现改动文件
- AND 项目文件标签同时列出两个文件，且两者都以完整当前源码和一列当前行号呈现

## Requirement: 验收 #10 工作期间披露列表时点并允许手动刷新
Source: docs/product/pages/main-right-sidebar.md#内容更新

系统 MUST 在团队正在工作时说明改动列表截至上一轮结束并提供手动刷新。系统 MUST NOT 把活动运行输出更新当作改动列表的实时订阅。

### Scenario: 团队工作时打开改动标签
- GIVEN 当前对话有成员正在工作
- WHEN 用户查看改动标签
- THEN 页面显示「截至上一轮结束」说明和可用的「刷新」按钮

## Requirement: 验收 #11 三种改动空态使用不同措辞
Source: docs/product/pages/main-right-sidebar.md#改动为空

系统 MUST 分别说明「对话还没有开始」「跑过但文件没有变化」「正在读取」三种状态。系统 MUST NOT 在读取中或对话未开始时下结论称没有改动。

### Scenario: 三种状态依次出现
- GIVEN 用户依次查看未开始的对话、正在读取的已开始对话、已完成且无文件变化的对话
- WHEN 改动标签渲染各状态
- THEN 三种状态的可见文本互不相同，只有最后一种说明文件没有变化

## Requirement: 验收 #20 刷新保持文件阅读位置
Source: docs/product/pages/main-right-sidebar.md#内容更新

系统 MUST 在刷新发现新改动时保留当前选中文件与内容滚动位置，并先显示可点击的新改动提示，由用户决定何时应用。系统 MUST NOT 因刷新自动跳到其他文件、滚动到顶部或抢占当前标签。

### Scenario: 阅读中刷新发现新改动
- GIVEN 用户已选中一个文件并把内容滚动到中部
- WHEN 手动刷新返回新改动
- THEN 原文件与滚动位置保持不变并出现「有新改动」提示，点击提示后才更新内容

## Requirement: 验收 #22 文件内容与路径可选择复制
Source: docs/product/pages/main-right-sidebar.md#弹层与危险操作

系统 MUST 让文件路径和文件内容保持可选择复制，并保持改动与项目文件标签只读。系统 MUST NOT 提供编辑、保存、撤销、回滚、还原或 git 操作控件与文案。

### Scenario: 从文件视图复制证据
- GIVEN 用户已在改动或项目文件标签打开一个文本文件
- WHEN 用户选择路径或正文文本
- THEN 浏览器允许文本选择，页面不存在任何文件写入、还原或 git 操作入口

## Requirement: 验收 #21 子任务标签是右侧栏唯一可推进的对话标签
Source: docs/product/pages/main-right-sidebar.md#弹层与危险操作

系统 MUST 让从主对话区子会话卡片打开的每个子任务标签按子会话标识隔离显示子任务名称、负责成员、当前状态、消息与活动运行，并提供与主对话区相同的输入、成员提及、重试和停下操作；这些操作 MUST 作用于该标签对应的子会话，打开标签时对应卡片行 MUST 标记为正在查看。系统 MUST NOT 在子任务标签中显示改动视图、文件写入或 git 操作、新建 / 重命名 / 删除子任务操作，也 MUST NOT 在关闭标签时中断、删除或取消子任务；改动、项目文件与过程标签 MUST NOT 获得子任务推进控件。

### Scenario: 同时打开并分别推进两个子任务
- GIVEN 主对话区存在两个子会话卡片行，且两个子会话拥有不同的名称、成员、状态、消息与活动运行
- WHEN 用户依次打开两个子任务标签、在其中一个标签输入含合法成员提及的消息并发送
- THEN 标签条同时保留两个子任务标签，当前标签显示对应子会话的摘要与推进内容，主对话区只高亮当前正在查看的卡片行，消息请求携带当前标签对应的子会话标识

### Scenario: 重试和停下命中当前子会话
- GIVEN 当前子任务标签包含一条可重试的没跑起来记录和一个可中断的活动运行
- WHEN 用户依次触发重试和输入框空草稿状态下的停下
- THEN 重试恢复请求与中断请求都携带该子会话标识和各自的运行标识，主会话不收到这两个请求

### Scenario: 关闭子任务标签只关闭视图
- GIVEN 某子任务标签已打开且对应卡片行标记为正在查看
- WHEN 用户关闭该标签
- THEN 子任务标签从标签条移除或由最后一个标签的空白兜底替代，对应卡片行不再标记为正在查看，且没有中断、删除或取消子任务请求发生

### Scenario: 右侧栏其余内容保持只读
- GIVEN 右侧栏存在子任务、改动、项目文件与过程标签
- WHEN 用户查看各标签可用控件
- THEN 只有子任务标签包含消息输入、成员提及、重试和停下入口，子任务标签不包含文件树、行级对比、文件写入、git 或子任务管理控件

## Requirement: 验收 #8 — 第 3 步播放所选团队的独立引导编排

Source: docs/product/pages/onboarding.md#第-3-步--团队接力演示

系统 MUST 把第 3 步作为首次引导的必经步骤，并在标准动态效果下按接力拍数计算 8–12 秒的总播放时长。系统 MUST 从第 2 步所选团队独立编排投影中的 `relayBeats: Array<{ speakerSlug, message }>` 读取播放内容；内置开发团队 MUST 提供经理拆解、开发执行、测试指出问题、开发修正、测试复核通过、经理带证据收尾共 6 拍，AI 团队 MUST 使用确认创建时写入独立编排文件的 `relayBeats`。系统 MUST NOT 按 `team.id` 选择硬编码接力脚本或用开发团队内容替代 AI 团队内容。编排 missing、invalid、空数组或引用非成员 slug 时 MUST 只在演示区显示「暂无可播放的协作示例」和「不影响这支团队的实际使用」，MUST NOT 显示重播按钮、抛出页面级错误或阻止「继续」。

### Scenario: AI 团队使用自身接力方案

- **GIVEN** 用户在第 2 步创建并选中一支 AI 团队，且其独立引导编排含已验证的两拍接力
- **WHEN** 用户进入第 3 步
- **THEN** 页面显示这支 AI 团队的两条 `message` 及对应成员
- **AND** 页面不出现内置开发团队的 6 拍文案。

### Scenario: 接力引用越过当前成员集合

- **GIVEN** 所选团队某一拍的 `speakerSlug` 不在 `team.members`
- **WHEN** 第 3 步读取接力元数据
- **THEN** 演示区显示局部不可用空态
- **AND** 不替换 speaker、不跳过该拍、不加载默认团队脚本
- **AND** 用户仍可点击「继续」进入下一步。

### Scenario: 团队没有引导编排

- **GIVEN** 所选团队核心与成员完整，但没有 `onboarding-orchestration.json`
- **WHEN** 用户进入第 3 步
- **THEN** 演示区显示「暂无可播放的协作示例」和「不影响这支团队的实际使用」
- **AND** 页面不显示「重新播放」
- **AND** 「继续」保持可用。

## Requirement: 验收 #16 — 接力可重播、可跳过且减少动态效果信息等价

Source: docs/product/pages/onboarding.md#第-3-步重播与继续

系统 MUST 在每次进入第 3 步时从第一拍自动播放，「重新播放」MUST 在不改变所选团队的情况下从第一拍重新开始；播放完成后 MUST 停留在主 Agent 收尾画面且 MUST NOT 自动进入第 4 步。播放期间「继续」MUST 始终可用，触发后 MUST 立即取消剩余播放计时并进入第 4 步。从第 4 步返回第 3 步时 MUST 开始新一轮完整播放。

当 `prefers-reduced-motion: reduce` 命中时，系统 MUST 以逐拍 opacity 淡入与当前拍静态高亮表达同一成员、顺序、消息和完成记录；该分支 MUST NOT 触发 CSS `transform`、`translate`、持续脉冲或平滑滚动。系统 MUST 保留「重新播放」与「继续」的同等功能。

### Scenario: 播放中直接继续

- **GIVEN** 第 3 步只播放到第 2 拍
- **WHEN** 用户点击「继续」
- **THEN** 页面立即进入第 4 步
- **AND** 不等待剩余拍次的计时器结束。

### Scenario: 减少动态效果后重播

- **GIVEN** 系统匹配 `prefers-reduced-motion: reduce`
- **WHEN** 用户进入第 3 步并点击「重新播放」
- **THEN** 每一拍仅以 opacity 淡入和静态高亮重新按序出现
- **AND** 渲染分支不应用 CSS `transform` 或 `translate`
- **AND** 最终可读信息与标准动态效果一致。

## Requirement: 验收 #18 — 接力节点只以相邻线段连接并与消息逐行对齐

Source: docs/product/pages/onboarding.md#第-3-步--团队接力演示

系统 MUST 仅把团队成员顺序映射为稳定等宽的横向轨道。graph 总宽 MUST 等于 `memberCount × laneWidth`，成员节点横坐标 MUST 等于 `(memberIndex + 0.5) × laneWidth`；同一组几何结果 MUST 同时驱动角色表头、节点与 SVG viewBox，系统 MUST NOT 把任意成员数继续压入一个固定比例宽度。

每一拍 MUST 在该拍 `speakerSlug` 的位置产生一个节点。每个已完成节点 MUST 绘制一段短 tail，tail 末端 MUST 与下一拍 connector 曲线的起点相接，MUST NOT 越过曲线转弯点留下下挂的竖线残段或与曲线之间产生细缝；下一拍 MUST 使用一条三次贝塞尔曲线从上一成员轨道转入当前成员轨道；tail 和 connector MUST 只属于第 `i - 1` 拍与第 `i` 拍之间的交接，任何连接的 `y1..y2` 索引差 MUST 不超过一个 beat 索引单位。系统 MUST NOT 渲染代表某成员贯穿多拍的竖线、首拍直连末拍的路径或其他跨拍 DAG 边。

每拍节点行与该拍消息行 MUST 位于同一共享 CSS grid，且两者的 `grid-row` MUST 使用相同 beat 索引。已出现的拍次 MUST 留在同一舞台中，当前拍变化不得从数据或 DOM 中移除既有问题、修正或复核记录。

### Scenario: 六拍开发团队接力

- **GIVEN** 内置开发团队有 3 名成员和 6 拍编排
- **WHEN** 第 3 步渲染完整接力
- **THEN** 页面渲染 6 个节点和 5 组相邻连接
- **AND** 每组连接的终止 beat 索引减起始 beat 索引等于 1
- **AND** 每个节点行与对应消息行拥有相同 `grid-row`
- **AND** 成员表头、节点与路径使用同一组轨道横坐标。

### Scenario: 六名成员的宽版轨道

- **GIVEN** 所选团队有 6 名成员
- **WHEN** 第 3 步在宽窗口渲染
- **THEN** graph 总宽等于 6 个稳定轨道宽度
- **AND** 第 1 名和第 6 名成员的节点中心分别位于 0.5 和 5.5 个轨道宽度
- **AND** 角色标签不因平均挤入固定比例 graph 列而退化为省略号。

## Requirement: 验收 #25 — 第 3 步使用宽版且高度可降级的接力舞台

Source: docs/product/pages/onboarding.md#主体区每屏

系统 MUST 在宽窗口下让第 3 步接力舞台使用约 780px 对齐框架，同时 MUST 保持第 1、2、4 步普通内容约 512px 的阅读宽度。全局“上一步 / 继续”操作 MUST 位于独立的固定底部 footer 中，并保持可见、右对齐且与约 780px 内容框架共用右边缘。

当可用高度不足或编排超过标准六棒时，系统 MUST 只让接力时间线或步骤主体滚动；接力卡标题、角色表头、重新播放、完成说明和底部操作 footer MUST 保持可达。系统 MUST NOT 以强制改变 Electron BrowserWindow 尺寸、裁切消息正文或隐藏引导操作来获得空间。

### Scenario: 默认桌面窗口显示六棒

- **GIVEN** Electron 主窗口为默认 `1180 × 760`
- **AND** 所选开发团队包含标准 6 拍
- **WHEN** 用户进入第 3 步
- **THEN** 接力舞台使用约 780px 宽版
- **AND** 团队名、成员标签与 6 条消息均可读取
- **AND** “重新播放”“上一步”“继续”保持可见
- **AND** “上一步 / 继续”位于窗口底部 footer 并与舞台右边缘对齐。

### Scenario: 最小高度窗口

- **GIVEN** 窗口高度缩小到允许的最小高度
- **WHEN** 第 3 步无法完整容纳所有内容
- **THEN** 接力时间线或步骤主体产生纵向滚动
- **AND** 底部操作 footer 不随主体滚动且不覆盖内容。

## Requirement: 接力输入阶段与角色持有者反馈

Source: docs/product/pages/onboarding.md#第-3-步--团队接力演示

系统 MUST 在下一拍消息出现前显示该成员的有界输入反馈，并在消息 reveal 时用节点、相邻连接、消息行和角色持有者反馈表达同一次交接。标准动态效果 MUST 把角色表头下划线移动到 typing 或 active 成员轨道并绘制当前相邻路径；`prefers-reduced-motion: reduce` 命中时 MUST 使用无 transform、无 translate、无持续脉冲的静态位置与 opacity 反馈，且成员、顺序、消息和完成状态 MUST 信息等价。

### Scenario: 下一位成员正在输入

- **GIVEN** 第 2 拍尚未 reveal
- **WHEN** 第 2 拍进入预备输入阶段
- **THEN** 时间线显示第 2 拍成员的输入反馈
- **AND** 角色持有者反馈指向第 2 拍成员
- **WHEN** 第 2 拍 reveal
- **THEN** 输入反馈退出并由第 2 拍节点、连接和消息替代。

## Requirement: 应用品牌位置复用同一 MoebiusLogo

Source: docs/product/pages/main-left-sidebar.md#品牌标题栏与关闭按钮
Source: docs/product/pages/onboarding.md#应用标题栏每屏

主侧栏品牌行与 onboarding 应用标题栏 MUST 复用同一个 `MoebiusLogo` 组件，并使用品牌脚本生成的 64px 图像在各自槽位中缩放显示。组件 MUST 提供可理解的品牌辅助名称；装饰性重复上下文 MAY 对内部图像隐藏。两处 MUST NOT 各自绘制 SVG、使用图标库 Infinity 图标或引入另一份品牌图形。

### Scenario: 主侧栏与 onboarding 渲染品牌

- GIVEN 分别渲染操作台主侧栏和 onboarding 任一步
- WHEN 查询品牌行
- THEN 两处都显示同一来源的 Moebius 图像与品牌名
- AND DOM 中没有旧的手绘无限 SVG 或 Lucide Infinity 图标

### Scenario: 亮暗主题切换

- GIVEN onboarding 或主侧栏正在显示 MoebiusLogo
- WHEN 主题从亮色切换到暗色
- THEN 图标保持原始黑色符号与白色方形底
- AND 周围布局仍使用当前主题令牌且品牌可辨识

## Requirement: 会话所有身份位置使用 effective 快照成员名

Source: `docs/product/pages/agent-teams.md#Agent-身份与说明`

操作台 MUST 以会话提供的 effective 成员身份投影把 message / run role 映射为可读成员名，并在主时间线历史消息、活动运行、终态事实、动作可访问名称、过程标签、子会话卡片和子任务标签中保持一致。成员 slug 已知但显示名不可用时 MUST 显示可辨认的 slug 兜底；只有 role 为空或确实无法映射时才 MAY 显示通用未知成员文案。内置角色兼容映射 MUST NOT 覆盖会话快照中的自定义显示名。

### Scenario: 两个自定义成员保持可区分

- GIVEN 会话投影把 `plan-supervisor` 映射为“方案监督者”、`plan-executor` 映射为“方案执行者”
- WHEN 两名成员分别出现在历史消息、活动 run 或终态事实中
- THEN 每个位置显示与其 slug 对应的真实成员名
- AND 已知成员不显示成“团队成员”“协作者”或“成员未知”

### Scenario: 同成员过程标签复用真实名称

- GIVEN 自定义成员“方案监督者”在同一会话有两个不同 run 输出入口
- WHEN 用户依次打开两个过程标签
- THEN 标签标题依次为“方案监督者”和“方案监督者 2”
- AND 过程内公开输入对该 role 使用“方案监督者”

### Scenario: 子会话使用自己的成员投影

- GIVEN 父会话与已打开子会话拥有不同的 effective 团队身份投影
- WHEN 子会话卡片与子任务标签渲染负责成员、历史消息及活动 run
- THEN 子会话区域使用子会话自己的成员显示名
- AND 不使用父会话当前团队名称覆盖它

## 官方来源团队与 Agent 运行配置

### Requirement: 当前主会话拥有固定目录轨

Source: docs/product/pages/main-conversation.md#会话目录轨

系统 MUST 仅在当前打开的根会话内、相对主会话左缘内缩 12px 显示固定目录轨；项目 / 会话侧栏 MUST NOT 为各会话行绘制消息目录。收起态 MUST 使用 44px 命中槽与 20px 事件行，以共同左端对齐的短横线投影每条用户消息和 Agent 可见最终回复：普通事件 MUST 为 `13 × 2px` 且七成不透明，当前阅读事件 MUST 为 `24 × 3px` 且完全不透明。用户事件 MUST 使用前景色，Agent 事件 MUST 使用对应身份色。系统事实、运行占位、子会话卡片与工具过程 MUST NOT 形成目录事件。

#### Scenario: 打开包含多成员回复的根会话

- **GIVEN** 当前根会话存在用户消息、多个 Agent 回复、系统事实与子会话卡片
- **WHEN** 主会话页面完成渲染
- **THEN** 主会话左缘内缩 12px 的 44px 槽内只为用户消息和 Agent 回复显示短横线
- **AND** 当前阅读事件比普通事件更长、更实
- **AND** 会话侧栏各行保持原有导航密度且没有目录轨

### Requirement: 展开轨迹使用整行命中与成员分支图

Source: docs/product/pages/main-conversation.md#会话目录轨

系统 MUST 在目录悬停或键盘聚焦后，以覆盖层展开同一批事件；每条真实事件的整行 MUST 成为同一节点的悬停、聚焦和激活区域。用户事件 MUST 位于 `x=14px` 的用户主干，Agent MUST 按首次出现顺序进入成员泳道；所有事件 MUST 显示为圆点，当前阅读事件 MUST 显示为作者色描边环。用户主干 MUST 贯穿每个连续可见区间，每名 Agent 的成员色分支 MUST 从其首个可见回复之前的事件节点平滑分叉、穿过该成员的可见回复，并在其末个可见回复之后平滑并回下一事件节点。系统 MUST NOT 使用直角折线、跨省略区连线、全宽等距散点或仅节点大小的命中区。

#### Scenario: 多成员往返会话展开

- **GIVEN** 可见事件顺序为用户、主 Agent、开发、主 Agent、测试、开发
- **WHEN** 用户展开目录轨
- **THEN** 用户事件位于固定主干，主 Agent、开发和测试按首次出现顺序占据各自泳道
- **AND** 每个成员分支从前一事件进入并在后一事件并回
- **AND** 最左与最右事件行的任意横向位置都命中各自唯一节点

#### Scenario: 可见事件之间存在折叠区

- **GIVEN** 两个可见事件之间有一个省略行
- **WHEN** 轨迹展开
- **THEN** 主干与成员分支在省略边界各自收束
- **AND** 省略区两侧不绘制一条跨区直接连接

#### Scenario: 省略段保持展开轨道

- **GIVEN** 长会话目录包含省略段且某个事件预览可见
- **WHEN** 指针从事件行移入省略段
- **THEN** 目录轨保持展开
- **AND** 当前事件预览保持不变
- **AND** 只有指针真正离开整个目录轨或预览卡时才进入关闭宽限

### Requirement: 节点预览模板与面板锚点保持稳定

Source: docs/product/pages/main-conversation.md#会话目录轨

系统 MUST 让预览卡默认宽 240px、正文最多三行，并相对整个展开轨迹面板保持 12px side offset；窗口碰撞时 MAY 整卡翻转或约束宽度，但 MUST NOT 按节点泳道位置改变偏移。亮色预览卡 MUST 使用 shadcn 的 1px 描边与 `shadow-md` 抬升，暗色预览卡 MUST 取消阴影并使用与画布不同的实色卡面分层。Agent 事件预览 MUST 只显示成员可读名称、时间和原回复开头；用户事件预览 MUST 显示“你”、时间和用户原文开头。系统 MUST NOT 在 Agent 预览顶部重复显示关联用户消息、内部 slug 或生成摘要。指针从面板跨入预览卡时 MUST 保持展开；只有离开面板与预览卡后才 MAY 延迟收起。

#### Scenario: 从最左泳道检查到最右泳道

- **GIVEN** 展开轨迹同时存在最左用户节点和最右 Agent 节点
- **WHEN** 用户分别检查两条事件行并把指针跨入预览卡
- **THEN** 两次预览都与面板保持 12px 横向间距
- **AND** 卡片只沿事件行纵向跟随且在指针进入时保持可见

### Requirement: 会话目录轨以左侧锚点呈现连续轨迹动效

Source: docs/product/pages/main-conversation.md#会话目录轨

系统 MUST 让收起态短横线保持共同左端基线，并在展开时从同一左侧锚点向右打开面板。正常可用高度下，事件行 MUST 从 20px 展开到 32px；短横线 MUST 从左端收束，节点 MUST 横向进入对应泳道，用户主干与成员分支 MUST 随展开绘入。面板 MUST 使用抬升中性底、1px 描边、8px 圆角、零阴影和位于轨迹下方的事件 hover 带；focused 外观 MUST 使用 side surface 作为面板底色、interaction surface 作为 hover 带，两者 MUST 保持可见层级差。hover 带 MUST 仅作为整行命中区内缩后的视觉反馈，左右各留 4px、上下各留 2px，不得贴住面板边界。面板宽度 MUST 由实际成员泳道数决定：主干和右侧留白各 14px、成员泳道默认相隔 18px，成员过多时压缩间距，最终宽度 MUST NOT 超过 224px。系统 MUST NOT 按主会话宽度在 148–224px 之间无条件插值，也 MUST NOT 采用居中膨胀、左右同时生长或邻近事件金字塔。

#### Scenario: 从收起目录展开少量成员轨迹

- **GIVEN** 当前目录只有用户和一名 Agent
- **WHEN** 用户悬停或键盘聚焦任一真实事件行
- **THEN** 面板宽度只覆盖主干、该成员泳道与两侧留白
- **AND** 行高在正常窗口中展开到 32px，短横线收束、圆点进入泳道、分支图出现
- **AND** 正文、标题、输入框和主时间线滚动位置不变

#### Scenario: 多成员遇到窄主会话

- **GIVEN** 成员泳道按 18px 间距会超过主会话可用宽度
- **WHEN** 目录展开
- **THEN** 系统压缩泳道间距且面板不超过 224px
- **AND** 目录不迁入项目 / 会话侧栏，也不推动正文重排

### Requirement: 目录轨展开以覆盖层呈现且窄容器留白固定

Source: docs/product/pages/main-conversation.md#会话目录轨

系统 MUST 让目录轨展开面板以悬浮覆盖层呈现：展开面板 MUST 从收起态槽位向右延伸、z-index 高于时间线正文列，MUST NOT 推动正文、标题、输入框位置或主时间线滚动位置，MUST NOT 改变任何消息的排布。窄容器（自然居中 840px 内容列左缘不足 56px，即 `conversationPaneWidth < 952px`）下，时间线消息列与 composer MUST 以固定 56px 左内边距（12px 左内缩 + 44px 收起态目录轨视口）预留收起态目录轨占地，且该值 MUST NOT 随目录轨展开/收起变化。宽容器（自然居中列左缘 ≥ 56px）下，时间线消息列与 composer MUST 保持标准 32px gutter，且 MUST NOT 因目录轨展开改变。时间线消息列与 composer 的左侧内容边界 MUST 在两种容器宽度下保持一致。

#### Scenario: 窄容器目录轨展开不推动正文

- **GIVEN** 窄主会话（`conversationPaneWidth` < 952px）包含目录轨、消息与输入框
- **WHEN** 用户悬停目录轨使其展开
- **THEN** 消息列与 composer 的左内边距保持 56px 不变，正文与输入框左缘像素坐标不变
- **AND** 展开面板覆盖在正文左缘之上且事件行整行可点击

#### Scenario: 窄容器目录轨收起

- **GIVEN** 窄主会话包含目录轨、消息与输入框
- **WHEN** 目录轨处于收起态且用户未悬停
- **THEN** 消息列与 composer 的左内边距为 56px，与展开态相同
- **AND** 收起态目录轨（44px 视口 + 12px 内缩）不压到消息文字

#### Scenario: 宽容器目录轨展开不改变布局

- **GIVEN** 宽主会话（自然居中列左缘 ≥ 56px）包含目录轨
- **WHEN** 用户悬停目录轨使其展开
- **THEN** 消息列与 composer 保持 32px gutter 且内容边界不随展开变化

### Requirement: 目录预览连续跟随检查事件且尊重 reduced motion

Source: docs/product/pages/main-conversation.md#会话目录轨

系统 MUST 让预览卡相对展开面板保持固定 side offset，并在检查事件变化时沿事件行纵向连续跟随，内容 MUST 使用短促淡换。系统 MUST 等到首个有效视口尺寸后才呈现可定位的轨道内容；预览锚点 MUST 使用独立于展开面板动画的稳定坐标层，首次呈现 MUST 直接使用最终展开坐标，不得把未测量的临时坐标或收起面板的位置作为动画起点；后续检查事件切换和真实尺寸变化 MUST 保持连续。`prefers-reduced-motion: reduce` 命中时，系统 MUST 取消面板、横线、节点、曲线、锚点和内容的位移、绘制及淡换时序，以即时静态切换提供等价信息。

#### Scenario: 首次测量不产生位置修正动画

- GIVEN 目录轨尚未取得有效视口高度
- WHEN 页面首次挂载并随后取得有效高度
- THEN 测量前不呈现导航、预览锚点或预览卡
- AND 测量后它们直接出现在最终展开位置
- AND 展开面板自身的位移动画不改变预览锚点坐标

#### Scenario: 从最左泳道切换到最右泳道

- GIVEN 多泳道目录已展开且预览最左泳道事件
- WHEN 指针移动到最右泳道事件所在的整行
- THEN 预览只沿纵向跟随新事件
- AND 卡片与展开面板的横向间距保持不变

#### Scenario: 用户要求减少动态效果

- GIVEN 系统匹配 `prefers-reduced-motion: reduce`
- WHEN 目录轨展开并切换检查事件
- THEN 节点、曲线和预览立即进入目标状态
- AND 轨迹顺序、当前节点、预览内容和定位能力与标准模式等价

### Requirement: 长会话目录围绕阅读焦点折叠并可精确定位

Source: docs/product/pages/main-conversation.md#会话目录轨

系统 MUST 从主时间线实际可用视口推导长会话目录的显示高度预算：正常窗口取视口高度约 70%，上下 MUST 保留至少 24px 总间隙，高窗口 MUST 最多显示 15 个 32px 标准行（480px），不得铺满整个会话区。系统 MUST 按该预算与最大 32px 展开事件行计算可见容量；超出容量时 MUST 围绕当前阅读消息保留连续窗口并尽量保留首尾边界，远端区间以省略行表示。可用高度不足时，展开事件行 MAY 在 32–20px 之间有界压缩，但目录面板 MUST NOT 越过主会话可用视口或 composer。目录滚轮与方向键浏览 MUST NOT 移动主时间线，只有点击、Enter 或 Space 激活真实事件后才 MUST 将原消息定位到阅读区并短暂突出。定位失败 MUST 保持原阅读位置。

#### Scenario: 矮窗口阅读长会话中段

- **GIVEN** 会话事件数超过按 32px 展开行高计算的容量且阅读焦点位于中段
- **WHEN** 目录展开并用方向键移动浏览游标
- **THEN** 面板留在可用视口内，焦点两侧远端区间分别折叠且主时间线位置不变
- **WHEN** 用户按 Enter 激活浏览事件
- **THEN** 对应原消息进入阅读区并短暂突出

### Requirement: 根会话恢复各自最后阅读消息

Source: docs/product/pages/main-conversation.md#会话目录轨

系统 MUST 为每个根会话尽力保存最后阅读 message id，并在切换返回后只恢复一次。用户正在阅读历史时，新消息与 state 刷新 MUST NOT 强制跳底；用户位于底部时 MUST 继续跟随最新消息。从未打开、存储损坏或锚点失效的会话 MUST 安全聚焦最新稳定事件。

#### Scenario: 两个会话停在不同阅读位置

- GIVEN 用户分别在两个根会话停留于不同消息
- WHEN 用户在两者之间切换并返回
- THEN 各会话恢复自己的消息锚点
- AND 期间新增回复不把正在阅读历史的会话强制移到底部

### Requirement: 长会话窗口化不减少可访问历史

Source: docs/product/pages/main-conversation.md#指标与验收
Source: docs/product/pages/main-conversation.md#会话目录轨

操作台 MUST 保留完整的公开消息逻辑集合，即使只挂载视口附近的消息 DOM。窗口化 MUST 支持真实消息高度变化、首尾滚动、未挂载消息的精确 Relay 定位、跨会话非末尾阅读位置恢复和末尾新消息跟随；内部运行占位 MUST NOT 进入公开时间线 DOM。

#### Scenario: 未挂载消息被目录轨定位

- **GIVEN** 目标公开消息不在当前 DOM 窗口内
- **WHEN** 用户从目录轨激活该消息
- **THEN** 页面先使目标进入可定位窗口，再把它精确滚入阅读区并短暂突出
- **AND** 不跳到近似消息或丢失其他公开历史。

#### Scenario: 切换返回中段阅读位置

- **GIVEN** 用户在会话 A 的中段阅读且没有停在末尾
- **WHEN** 用户切到会话 B 后返回会话 A
- **THEN** 会话 A 恢复原阅读消息
- **AND** 期间到达的新消息不强制把阅读位置移到末尾。

### Requirement: Official-source detail separates content editing from deletion protection

Source: docs/product/pages/agent-teams.md#官方来源团队详情

Official-source identity and team deletion MUST remain protected, while team information, primary
agent, members, member files and execution profiles MUST use the same editable controls and draft
protection as user teams. The UI MUST NOT derive all editability from `ownership === "system"`.

#### Scenario: Official team detail exposes content editing

- **GIVEN** an official-source team detail is usable
- **WHEN** the user opens its information, member and primary-agent controls
- **THEN** the same validated edit actions as a user team are available
- **AND** the team-level delete action remains absent.

### Requirement: Team page renders official management state without repair semantics

Source: docs/product/pages/agent-teams.md#官方版本与三方比较

The team list and detail MUST render official source, customized and update available from
server-provided state. Update available and customized MUST NOT create the Agent Teams sidebar
repair indicator. The UI MUST NOT recompute A/B/C fingerprints or protection rules and MUST NOT
introduce a runtime-profile management status.

#### Scenario: Customized official team has an update

- **GIVEN** the server returns official-source + customized + update-available
- **WHEN** the team row and detail render
- **THEN** both surfaces show those management states
- **AND** the sidebar repair indicator remains off unless an independent structural repair issue
  exists.

### Requirement: Agent execution profile editor has independent draft state

Source: docs/product/pages/agent-teams.md#Agent-运行配置

The selected member MUST expose the saved CLI, model and effort, source and eligible restore/save
actions without runtime capability data. CLI MUST be a Codex/Claude Code/Kimi enum. Model MUST use
the product-bundled registry for that CLI; effort MUST contain only the selected model's supported
efforts. Selecting Claude MUST choose `sonnet/high`. Selecting Claude `fable` MUST offer xhigh,
while selecting `sonnet` or `opus` MUST remove xhigh. Changing model MUST preserve effort only when
still supported and otherwise choose that model's default `high`.

A saved value absent from the registry MUST remain visibly unsupported until the user explicitly
selects a current combination. Profile drafts MUST survive member switches independently of Markdown
drafts. Parent rerenders, new callback identities and slow or failed async returns MUST NOT reset a
draft, reapply stale data or trigger duplicate reads. Save failure MUST retain the draft and identify
the last saved profile as effective.

#### Scenario: Claude draft survives parent rerenders

- **GIVEN** a member has an unsaved Claude/fable/xhigh profile draft
- **WHEN** the parent rerenders with new callback identities and an older read resolves late
- **THEN** the Claude draft remains visible
- **AND** the old response does not reset or persist it
- **AND** no duplicate save occurs.

#### Scenario: Historical Claude profile remains visible

- **GIVEN** a member previously saved a Claude model or effort absent from the bundled registry
- **WHEN** the user opens the detail or switches away and back
- **THEN** the original values remain selected and labelled as legacy custom
- **AND** no save occurs until a supported combination is explicitly selected and saved.

### Requirement: Claude 旧版本失败提供同一受信任更新入口

Source: docs/product/pages/main-conversation.md#Agent-执行与恢复
Acceptance: main-conversation#58

When a Claude-bound run fails the `<2.1.170` runtime gate, the console MUST show a stable
“Claude Code 需要升级” reason and an accessible update action. The renderer MUST NOT receive or
submit executable paths, commands, args, stderr or internal errors. Triggering update MUST preserve
the failed run, user message and frozen profile; completion MUST offer an explicit retry rather than
automatically creating a Claude session.

#### Scenario: Runtime old-version failure does not crash

- **GIVEN** a Claude-bound run reports unsupported version before session creation
- **WHEN** the failure renders
- **THEN** the timeline remains usable and shows the update action
- **AND** updating does not erase the failed attempt or automatically rerun it.

### Requirement: Official update shows impact before and facts after

Source: docs/product/pages/agent-teams.md#更新官方来源团队

Before update, the detail MUST show current/latest versions, member changes, recommendation
changes, protected members and whether a copy will be created. The primary action MUST be direct
update or protective-copy-and-update exactly as returned by the server. Success MUST identify the
applied version and actual changes; when a copy exists it MUST provide its stable name and an entry
to that team. Failure MUST retain the prior team and retry action.

#### Scenario: Protected update completes

- **GIVEN** the impact summary says overridden member `qa` will be removed and protected in a copy
- **WHEN** protective-copy-and-update succeeds
- **THEN** the success result names the applied version, removed member and copy
- **AND** the user can enter that copy from the result.

### Requirement: Team management renders no runtime capability health

Source: docs/product/pages/agent-teams.md#运行配置静态校验

The team list and detail MUST NOT render “正在读取运行配置”, unable-to-verify,
needs-adjustment, recheck, capability-derived options or a runtime-profile repair badge. They MUST
render persisted profile values and ordinary static/save errors. Runtime availability MUST NOT
create the Agent Teams sidebar repair indicator.

#### Scenario: Local Kimi is unavailable

- **GIVEN** a member has a structurally valid saved Kimi profile and local Kimi is unavailable
- **WHEN** team list and detail render
- **THEN** the saved CLI/model/effort are editable
- **AND** no runtime warning, recheck action or repair indicator appears.

### Requirement: 绝对路径成为应用内文件引用

Source: docs/product/pages/main-conversation.md#时间线

共享 Markdown renderer MUST 只把规范化后在根 `/` 之外至少包含一个实际路径段的目标解析为应用内文件引用。该边界 MUST 同时适用于语法有效的显式 Markdown 绝对 POSIX 文件目标、普通文本中的裸绝对 POSIX 路径及整个 inline code；单独 `/`、规范化后仍为 `/` 的目标以及 `A / B` 中作为分隔符的 `/` MUST 保持原有文本语义，MUST NOT 登记文件 intent 或触发文件引用回调。

有效文件引用的可选 `:line[:column]`、URI 解码、路径规范化与私有 intent 身份 MUST 保持现有行为，并在 path、line、column 之外保留行号是否由正文显式给出；无行号路径与显式 `:1` MUST NOT 合并为同一初始显示意图。renderer MUST NOT 根据磁盘存在性、目标是否为目录或可读性预判引用，也不对 inline code、显式 Markdown 文件链接与宽松档裸路径做扩展名约束；`/tmp`、无扩展名路径和不存在目标在通过边界判定后仍 MUST 进入文件引用回调，点击后的目录、不存在或不可读结果 MUST 由文件面板反馈。内部动作身份 MUST 来自当前 renderer 实例在 Markdown AST 变换时登记的私有意图，MUST NOT 只凭正文可构造的 URL 或 hash 判定。

普通文本中的尾随句子标点 MUST 留在文件引用外；有效 inline code 文件目标 MUST 保留代码视觉并可点击。已有 Markdown link、图片与 fenced code MUST NOT 被递归拆成嵌套文件引用，其中的路径文本仍 MUST 保持原文。任何正文 HTTPS URL 都仍是普通外链并走既有确认回调；图片、`file:`、`javascript:`、data 与自定义协议仍按既有边界阻断。点击有效文件引用 MUST 只把规范化的 path、line、column 交给文件引用回调，MUST NOT 触发浏览器导航、外链确认或 `window.open`。

普通文本中的裸绝对 POSIX 路径 MUST 按斜杠前一个字符分级判定起点：空白、行首与半角符号之后使用宽松档（规范化路径至少一个段含拉丁字母）；中日韩文字与全角标点之后使用严格档（末段带扩展名，即 `.` 加 1–8 位拉丁字母数字，或整体带显式 `:行号`）；拉丁字母、数字、`.`、`_`、`-`、`:`、`/` 与 `~` 之后不构成路径起点。全角括号 `（）「」【】` 与反斜杠 MUST 终止裸路径扫描，`~` MUST NOT 成为路径起点。这些约束只作用于裸文本扫描，不改变 inline code 与显式 Markdown 文件链接的既有行为。紧贴中日韩文字且无扩展名、无显式行号的目标保持普通文本，路径含全角括号的目标在括号处截断，均属接受代价；日期（`2026/08/07`）、分数（`1/2`）与 HTTPS URL MUST NOT 成为文件引用。

#### Scenario: 单独斜杠保持普通文本

- GIVEN 正文包含单独 `/`、`A / B` 与后续有效路径 `/tmp/report`
- WHEN Markdown renderer 渲染并发生点击
- THEN 两个作为文本的 `/` 均不登记文件 intent、不可触发文件回调
- AND `/tmp/report` 仍可触发 path `/tmp/report`、line `1`、column `null` 的文件回调

#### Scenario: Inline code 与显式 Markdown 根目标不提升

- GIVEN 正文包含 inline code `` `/` ``、显式链接 `[根目标](/)` 与有效 inline code `` `/tmp/report.txt:2` ``
- WHEN Markdown renderer 渲染并发生点击
- THEN inline code `` `/` `` 保持代码视觉且不触发文件回调
- AND 显式 Markdown 根目标不触发文件回调
- AND 有效 inline code 保持代码视觉并触发 path `/tmp/report.txt`、line `2`、column `null` 的文件回调

#### Scenario: 判据使用规范化结果

- GIVEN 显式 Markdown 目标或完整 inline code 分别为 `/:2`、`/./`、`/tmp/..` 与 `/tmp/../var/log`
- WHEN Markdown renderer 渲染并发生点击
- THEN 前三个规范化后仍为 `/` 的目标均不登记文件 intent、不触发文件回调
- AND `/tmp/../var/log` 触发 path `/var/log`、line `1`、column `null` 的文件回调
- AND 系统不是按原始字符串是否包含行号、`.` 或 `..` 决定引用资格

#### Scenario: 目录与不存在目标仍由文件面板判断

- GIVEN 正文包含 `/tmp`、无扩展名路径 `/tmp/moebius-output` 与不存在目标 `/tmp/not-created-yet`
- WHEN 主时间线渲染这些路径
- THEN 三者均呈现为文件引用而不读取磁盘预判
- WHEN 用户点击 `/tmp`
- THEN 文件面板报告目标不是普通文件
- AND renderer 不把该结果改写成普通文本或外链

#### Scenario: 真实文本路径保留行列定位

- GIVEN 正文包含指向真实临时文本的绝对路径并带 `:2:3`
- WHEN 用户点击该文件引用
- THEN 文件回调收到规范化 path、line `2`、column `3`
- AND 右侧栏显示 canonical path、目标位置与突出显示的第 2 行

#### Scenario: Agent 给出裸 `/tmp` 产物

- GIVEN Agent 正文包含 `产物位于 /tmp/moebius-report.txt:12:3，请查看。`
- WHEN 主时间线渲染并点击该裸路径
- THEN 页面保留完整路径文本与路径外的逗号
- AND 文件回调收到 path `/tmp/moebius-report.txt`、line `12`、column `3`
- AND 不触发外链确认

#### Scenario: Inline code 与代码块保持各自语义

- GIVEN 正文包含 inline code `` `/tmp/report.txt:2` `` 和 fenced code 中的 `/tmp/example.txt`
- WHEN Markdown 渲染
- THEN inline code 保持代码视觉并可触发 path `/tmp/report.txt`、line `2` 的文件回调
- AND fenced code 原文可见但不生成文件回调

#### Scenario: 显式文件链接与成员 mention 回归

- GIVEN 正文同时包含显式绝对文件链接、裸绝对路径、已知成员 mention 与 HTTPS 外链
- WHEN 用户依次点击四种目标
- THEN 两种文件目标进入文件回调、mention 进入成员回调、HTTPS 进入外链确认
- AND 四种 intent 不互相冒充或覆盖

#### Scenario: 危险协议不提升为文件引用

- GIVEN 正文包含 `file:///tmp/a`、`javascript:`、data image 与自定义协议
- WHEN Markdown 渲染并发生点击
- THEN 这些目标不能导航或进入文件回调

#### Scenario: 外观类似内部地址的 HTTPS 仍是外链

- GIVEN 正文包含指向 Moebius 保留域外观的普通 HTTPS Markdown 链接
- WHEN 用户点击该链接
- THEN 它只进入外链确认流程
- AND 文件引用与成员 mention 回调都不触发

#### Scenario: 紧贴中日韩文字的裸路径需要更强形状证据

- GIVEN 正文包含 `工程文件在/工程/笔记.md`、`产物在/Users/wing/app.ts` 与 `见/src/index.ts:42`
- WHEN 主时间线渲染这些文本
- THEN 三者均呈现为文件引用并分别携带路径与行号信息
- GIVEN 正文包含 `在我构建过程中被另一个正在运行的进程/会话实时修改（i18n 文件`、`成本/收益如何计算` 与 `成本/收益ROI计算`
- WHEN 主时间线渲染
- THEN 三者均保持普通文本，不登记文件 intent

#### Scenario: 宽松档要求至少一个拉丁字母段

- GIVEN 正文包含 `取 /2 作为系数` 与 `rm -rf /tmp/cache && node /app/x.js`
- WHEN 主时间线渲染
- THEN `/2` 保持普通文本
- AND `/tmp/cache` 与 `/app/x.js` 各自呈现为文件引用

#### Scenario: 全角括号与反斜杠终止裸路径

- GIVEN 正文包含 `/tmp/a（备份）`、`正则 /\d+/ 匹配数字` 与 `家目录 ~/projects/x`
- WHEN 主时间线渲染
- THEN 只呈现 `/tmp/a` 为文件引用且全角括号保持普通文本
- AND `/\d+/` 与 `~/projects/x` 整体保持普通文本

#### Scenario: 日期、分数与 URL 不进入文件引用

- GIVEN 正文包含 `2026/08/07`、`1/2`、`(1/2)` 与 `https://example.com/a`
- WHEN 主时间线渲染
- THEN 日期与分数保持普通文本
- AND HTTPS URL 走既有外链确认流程而不进入文件引用回调

### Requirement: 已知团队 mention 显示可读名称并连接既有团队详情

Source: docs/product/pages/main-conversation.md#时间线

共享 Markdown renderer MUST 只在普通文本节点中按会话冻结成员名单识别 `@slug`，并复用运行时 handoff 的 ASCII slug 边界语义，把已知 slug 显示为 `@<displayName>` 并在存在宿主回调时呈现为可点击控件。点击 MUST 只交回该成员 slug；operator console MUST 用当前会话冻结团队键打开现有 Agent 团队详情，MUST NOT 从 mention 直接派工、执行、编辑成员或改变消息原文。

未知 mention MUST 保持原文与普通文本形态。fenced code、inline code 和已有 Markdown link 内的 `@` MUST NOT 被替换、嵌套成链接或触发团队入口。

#### Scenario: 已知与未知 mention 同时出现

- GIVEN 会话成员名单包含 `{ slug: "implementer", displayName: "实现者" }`
- AND 正文包含普通文本 `@implementer`、未知 `@other`、行内代码 `` `@implementer` ``
- WHEN Markdown 渲染
- THEN 普通文本显示可点击的 `@实现者`
- AND 未知 mention 与行内代码仍分别显示 `@other` 和 `@implementer`
- WHEN 用户点击 `@实现者`
- THEN 宿主只收到成员 slug `implementer`

### Requirement: 文件引用在右侧栏按目标位置打开

Source: docs/product/pages/main-right-sidebar.md#文件引用标签

系统 MUST 按 `sessionId + canonical file path + line + column + explicit-line intent` 打开或聚焦唯一 `file-reference` 标签，并把该类型纳入可恢复标签枚举但排除在加号类型选择之外。显式定位首次加载可用内容时 MUST 把目标行滚入视野、用非纯颜色方式突出，并显示可选择复制的路径与真实行号；列号存在时 MUST 显示目标列信息。

右侧栏 MUST 根据服务端返回的目标作用域呈现文件。完整工作区文件 MUST 使用普通源码阅读或 Markdown Preview；工作区外结果在成功与失败时都 MUST 同时在标签与内容区明确标识“预览”和内容有界，MUST NOT 显示为完整文件或提供 Markdown Preview。不可用响应 MUST 清除上一目标内容、显示原因且不得崩溃、导航或回退读取其他文件。外部有界响应 MUST 保留真实行号，MUST NOT 假装窗口首行为文件第一行。

#### Scenario: 重复点击同一引用

- GIVEN 某会话的文件、行、列引用标签已经打开
- WHEN 用户再次点击相同引用
- THEN 右侧栏聚焦既有标签且标签总数不变

#### Scenario: 裸路径与显式第一行保留不同意图

- GIVEN 用户先后点击 `/workspace/README.md` 与 `/workspace/README.md:1`
- WHEN 两个引用都解析到同一 canonical 文件
- THEN 前者保留无显式定位意图，后者保留显式第一行意图
- AND 两者首次显示模式不因 canonical 去重而互相覆盖

#### Scenario: v1 标签按可恢复位置推断显式定位

- GIVEN 旧版持久化标签没有 explicit-line 字段
- WHEN 其目标行大于 1 或存在 column
- THEN 恢复时按显式定位进入源码并定位目标
- AND 只有 line 为 1 且没有 column 的旧标签按裸路径 best-effort 恢复

#### Scenario: 符号链接与真实路径引用同一文件

- GIVEN 同一会话先后点击某文件的符号链接路径和真实路径，且二者解析到同一 canonical path
- WHEN 两次引用的行列相同
- THEN 右侧栏只保留一个文件引用标签并聚焦它

#### Scenario: 两个文件引用并发解析

- GIVEN 用户在第一个文件引用解析完成前点击另一个不同文件引用
- WHEN 两个读取请求以任意顺序完成
- THEN 两个文件引用标签都保留
- AND 后完成的结果不覆盖先完成的标签

#### Scenario: 大文件目标窗口

- GIVEN 文件引用响应从第 250 行开始并以第 292 行为目标
- WHEN 文件引用标签呈现
- THEN 行号从 250 起显示且第 292 行滚入视野并突出
- AND 加号类型选择仍只有改动与项目文件

### Requirement: 完整 Markdown 文件提供 Preview 与源码

Source: docs/product/pages/main-right-sidebar.md#工作区文件与工作区外预览

完整工作区 `.md` 与 `.markdown` 文件 MUST 提供 Preview 和源码模式。无显式行号的首次打开 MUST 默认 Preview；带显式行号的首次打开 MUST 默认源码并定位目标。用户切换模式后，选择 MUST 只作用于当前标签；切回源码 MUST 恢复目标位置。Preview 与源码 MUST 从同一次成功读取的完整文本快照派生。

Preview MUST 复用既有 Markdown HTML 清洗、危险协议阻止、远程外链确认和严格 Mermaid 策略。Preview 中的绝对本地文件链接 MUST 继续进入应用内文件打开回调；文件正文 MUST NOT 激活团队 mention 或对话引用控制。相对本地链接、本地图片和 `.mdx` MUST NOT 因此获得新的本地解析能力。

#### Scenario: 裸 README 默认 Preview

- GIVEN `/workspace/README.md` 被完整读取且没有显式行号
- WHEN 文件标签首次呈现
- THEN Preview 为选中模式并显示渲染后的标题
- WHEN 用户切换源码
- THEN 显示同一快照的完整 Markdown 原文

#### Scenario: 带行号 Markdown 默认源码

- GIVEN `/workspace/README.md:42` 被完整读取
- WHEN 文件标签首次呈现
- THEN 源码为选中模式且第 42 行进入视野并突出
- WHEN 用户切到 Preview 再切回源码
- THEN 第 42 行再次进入视野并突出

#### Scenario: Preview 中链接遵守既有安全边界

- GIVEN Markdown 同时包含绝对本地文件链接、HTTPS、`javascript:` 与本地相对图片
- WHEN 用户依次激活这些目标
- THEN 绝对本地路径只进入应用内文件回调
- AND HTTPS 只进入既有确认流程
- AND 危险协议与本地相对图片不执行、不读取

### Requirement: 文件异步加载只提交当前目标结果

Source: docs/product/pages/main-right-sidebar.md#选择文件

文件加载的成功与失败 MUST 同时匹配当前标签身份、session、目标和请求代次后才能提交。父级重渲染、回调身份变化、模式切换或较慢旧请求完成 MUST NOT 覆盖较新的目标、模式、内容、错误、活动标签或阅读位置。磁盘文件 MUST NOT 自动替换当前已呈现文本；重新选择、重新打开或使用既有刷新入口后的源码与 Preview MUST 从同一次新响应派生。

#### Scenario: 慢旧请求晚于新请求返回

- GIVEN 文件 A 的请求尚未完成时用户选择文件 B
- WHEN B 先成功且 A 随后成功或失败
- THEN 当前目标、活动标签与内容仍为 B
- AND A 的内容或错误不出现

#### Scenario: 父级更新回调身份

- GIVEN 当前文件请求中父级重渲染并传入新回调实例
- WHEN 原请求成功
- THEN 匹配当前目标的结果仍可提交一次
- AND 不重复请求、不回退到旧目标

#### Scenario: 重新读取后两种模式使用同一文本

- GIVEN 当前 Markdown 的源码与 Preview 都来自文本 V1
- AND 文件在磁盘变为 V2
- WHEN 用户尚未重新读取
- THEN 两种模式继续显示 V1
- WHEN 用户重新选择、重新打开或使用既有刷新入口且请求成功
- THEN 两种模式都从同一次 V2 响应派生

### Requirement: Type-safe local interface translations

Source: `docs/product/pages/settings.md#语言覆盖范围`

The console UI MUST provide bundled `zh-CN` and `en` resource files with identical translation keys and interpolation contracts.

Production components MUST render Moebius-provided static interface copy through translation keys and MUST NOT choose copy with locale comparisons, locale switches, or locale ternaries.

User input, Agent output, custom names, file content, file names, local paths, and raw diagnostics MUST remain unchanged when the interface locale changes.

#### Scenario: Interface copy changes while user content does not

Given the current workspace contains a draft, messages, a project name, and a local path
When the locale provider commits a saved target locale
Then Moebius-provided labels and accessible names use the target resource
And the draft, messages, project name, and local path remain byte-for-byte unchanged.

### Requirement: Settings dialog

Source: `docs/product/pages/settings.md#页面结构`

The console UI MUST expose a controlled modal settings dialog opened from the sidebar's single settings entry.

The settings dialog MUST show only General and About as available categories. General MUST contain the `简体中文` and `English` language options in one continuous group. About MUST expose application identity, version, platform, update status, version copy, and public links. The dialog MUST NOT show disabled future categories or coming-soon placeholders.

The dialog MUST trap focus, return focus to the settings entry on close, close through its close control or Escape, remain open on backdrop interaction, and switch to a stacked layout at narrow widths.

#### Scenario: Settings opens without navigating

Given a project, conversation, sidebar state, scroll position, and unsent draft are active
When the user opens Settings
Then a centered modal dialog appears without changing the current route or unmounting the workspace
And closing it restores focus and preserves all active workspace state.

#### Scenario: Failed language save remains retryable

Given the active locale is `zh-CN`
When saving `en` fails
Then the dialog and workspace remain in `zh-CN`
And the dialog exposes a localized failure message and Retry action.

### Requirement: 设置弹窗以紧凑双分类呈现语言与关于

Source: docs/product/pages/settings.md#页面结构

生产 `SettingsDialog` MUST 只显示“常规”和“关于”两个可用分类，MUST 只有一个弹窗标题，语言选项 MUST 位于单一连续分组。“关于” MUST 显示统一品牌、当前版本、右对齐的 Apple Silicon Mac、更新状态和三个公开入口。窄窗 MUST 把分类导航移到内容上方；短窗 MUST 只滚动内容并保持标题与关闭入口可达。

#### Scenario: 关于页的确定信息结构

- GIVEN 设置弹窗已打开并切换到“关于”
- WHEN 应用版本为 `0.1.4`
- THEN 页面显示 Moebius 品牌、`0.1.4`、右对齐的 `Apple Silicon Mac`
- AND 显示检查更新、查看发布记录、反馈问题和开源仓库
- AND 不出现禁用或即将推出分类

### Requirement: 设置更新、复制与外链结果受控且键盘连续

Source: docs/product/pages/settings.md#更新检查、下载与安装
Source: docs/product/pages/settings.md#复制版本与公开链接

`SettingsDialog` MUST 受控呈现 idle、checking、latest、available、downloading、ready、installing、failed 更新状态以及复制成功/失败和外链失败。检查中、下载中、已准备好和安装准备中 MUST 禁止会造成重复检查、下载或安装的操作；触发控件 MUST 保持可聚焦。终态 MUST 原地更新并通过可访问状态通知读出，MUST NOT 自动抢焦点。关于页的下载、重试和公开链接 MUST 进入正常 Tab 顺序，但安装操作只从侧栏进入。打开外链失败 MUST 保留当前弹窗、分类和焦点。

#### Scenario: 检查到新版

- GIVEN 当前版本为 `0.1.4`
- WHEN 受控状态变为 available 或 downloading 且最新版本为 `0.1.5`
- THEN 更新组显示 `0.1.5` 和后台下载进度
- AND 不显示安装按钮、不打开浏览器且不会创建第二次下载

#### Scenario: 更新包已准备好

- GIVEN 受控状态变为 ready 且最新版本为 `0.1.5`
- WHEN 用户查看关于页
- THEN 更新组显示“已准备好”和安装入口位于侧边栏的提示
- AND 关于页不显示安装按钮

#### Scenario: 更新检查失败

- GIVEN 当前版本可见
- WHEN 受控状态变为 failed
- THEN 页面显示可理解失败说明和重试
- AND MUST NOT 显示已是最新版

### Requirement: 侧栏只在更新包就绪时提供安装入口

Source: docs/product/pages/main-left-sidebar.md#底部应用操作

`OperatorConsole` MUST 将“设置”和“安装更新”作为两个并列、各自可聚焦的底部操作。只有更新状态为 `ready-to-install` 时 MUST 渲染“安装更新”；检查中、下载中、失败、已是最新版和未知状态 MUST 不渲染该按钮，不显示更新红点或更新完成通知。

#### Scenario: 更新包未就绪

- GIVEN 更新状态为 checking、downloading、failed、latest 或 idle
- WHEN 侧边栏底部渲染
- THEN 只显示设置入口
- AND 用户不会看到安装更新按钮或下载完成通知

#### Scenario: 下载中的立即检查被阻止

- GIVEN 更新状态为 `available` 或 `downloading`
- WHEN 用户尝试点击关于页的立即检查
- THEN 检查按钮不可用且不会重新发起下载
- AND 当前版本与下载进度保持不变

#### Scenario: 更新包已就绪

- GIVEN 更新状态为 ready-to-install 且版本为 `0.2.1`
- WHEN 侧边栏底部渲染
- THEN 设置右侧显示独立的“安装更新”按钮
- AND 该按钮具有本地化可访问名称并可用键盘聚焦

### Requirement: 侧栏安装入口呈现安装确认

Source: docs/product/pages/settings.md#更新检查、下载与安装

设置“关于”只展示 `ready-to-install` 状态，不提供安装按钮。侧栏“安装更新” MUST 调用上层安装意图并先展示安装确认。无运行任务和有运行任务 MUST 使用不同的弹窗标题、说明与按钮；有运行任务时 MUST 提供“继续工作”和“停止任务并重启安装”，取消或继续工作 MUST 保留 ready 状态。

#### Scenario: 无运行任务确认安装

- GIVEN ready 状态且没有受管运行任务
- WHEN 用户点击侧栏“安装更新”
- THEN 显示说明应用将关闭、安装并重新打开的确认弹窗
- AND 取消不改变当前页面或 ready 状态

#### Scenario: 有运行任务的重启安装弹窗

- GIVEN ready 状态且有受管运行任务
- WHEN 用户点击侧栏“安装更新”
- THEN 显示独立的重启安装保护弹窗
- AND 弹窗说明停止任务会保留会话记录
- AND 选择“继续工作”只关闭弹窗，不显示普通退出弹窗

### Requirement: 更新异步状态对父级重渲染安全

Source: docs/product/pages/settings.md#打开与关闭

设置与侧栏的更新状态呈现 MUST 在父级重渲染、回调身份变化、慢返回、失败返回和迟到事件下保持同一状态机语义。重复检查/下载 MUST 被拦截，迟到的旧请求 MUST NOT 覆盖较新的 `ready`、failed 或 installing 状态，关闭并重新打开设置 MUST 恢复当前应用会话状态。

### Requirement: 工作区通知恢复设置异步结果

Source: docs/product/pages/settings.md#打开与关闭

`OperatorConsole` MUST 在设置关闭后仍保留进行中的语言保存、更新检查和更新下载。从侧边栏重开设置时，若更新检查或下载仍在进行，MUST 直接恢复“关于”及当前状态。更新检查、下载完成和下载失败 MUST NOT 追加工作区通知；弹窗保持打开时 MUST NOT 重复通知；语言保存的既有通知 MUST NOT 被更新状态覆盖。

#### Scenario: 关闭后更新状态恢复

- GIVEN 更新检查或下载进行中且用户关闭设置
- WHEN 用户从侧边栏重新打开设置
- THEN 直接重开“关于”并显示当前更新状态
- AND 不出现更新完成或失败通知
- AND 当前项目、对话、草稿、滚动位置与焦点不被更新状态改变

### Requirement: 右侧栏承载普通会话且不复制会话布局

Source: docs/product/pages/main-right-sidebar.md#新会话与已有会话标签

右侧栏 MUST 支持未发送普通新会话和已创建普通会话标签。主内容与右侧会话 MUST 复用同一生产会话组合的标题、时间线、运行记录、composer、普通附件、团队切换与恢复行为。系统 MUST NOT 增加分析专用布局、嵌套第二层右侧栏或让右侧会话内部自己持有 evidence 标签工作区。

#### Scenario: 首次发送原地成为已有会话

- GIVEN 右侧栏当前标签承载一个有效未发送会话草稿
- WHEN 首条消息创建成功
- THEN 同一标签原地显示普通已有会话
- AND 左侧栏出现该普通用户会话
- AND 完整输出、文件与子任务在当前外层标签条打开兄弟标签。

#### Scenario: 手动 sidebar chat 没有分析闸门

- GIVEN 用户从右侧栏内容选择手动创建普通新会话
- WHEN 用户保留「通用助手」并发送
- THEN 页面按普通会话运行
- AND 不因团队身份显示或执行方案确认闸门。

### Requirement: 消息与对话分析入口使用同一生产会话组合

Source: docs/product/flows/session-analysis.md#1-从来源消息或根对话开始分析

系统 MUST 在符合条件的 Agent 消息菜单提供「在右侧栏分析这条消息」，并在左侧栏对话菜单提供「在右侧栏分析这段对话」。每个对象的鼠标右键、可聚焦菜单按钮与键盘上下文操作 MUST 打开同一菜单并绑定同一消息或对话，菜单关闭后 MUST 把焦点返回对应对象或其菜单按钮。

两种入口 MUST 打开同一个右侧栏普通新对话生产组合，使用相同布局、候选问题、草稿归并、发送和后续对话行为，MUST NOT 创建分析专用详情页或第二套草稿。入口对象只允许改变追加的来源引用。入口选定的草稿在普通附件区域增加可删除来源胶囊，并在空态增加候选问题；胶囊 MUST 显示可读来源标签，其悬浮、键盘聚焦和辅助技术文本 MUST 逐字公开将插入消息的完整片段文本，候选问题 MUST 只把对应提示词写入正文。

#### Scenario: 两种菜单进入同一页面

- GIVEN 一条可分析的 Agent 消息和一段记录可用的对话
- WHEN 用户分别从消息菜单和对话菜单触发分析
- THEN 两次结果使用同一个右侧栏新对话生产组合与相同候选问题
- AND 消息级与对话级结果只在来源引用目标与标签上不同

#### Scenario: 三种菜单打开方式绑定同一对象

- GIVEN 用户聚焦一条可分析消息或对话行
- WHEN 用户分别使用右键、菜单按钮和键盘上下文操作
- THEN 三种方式打开同一组菜单项并绑定同一来源对象
- AND 菜单关闭后焦点回到该对象或其菜单按钮

#### Scenario: 同一草稿追加片段

- GIVEN 流程控制器返回一份可归并未发送草稿
- WHEN 用户从另一个时间线位置再次触发入口
- THEN 页面聚焦同一右侧标签
- AND 在现有来源后追加一个可独立删除的来源胶囊
- AND 不修改正文、上下文或普通附件。

#### Scenario: 胶囊公开完整载荷

- GIVEN 分析草稿含一个文本为 T 的来源胶囊
- WHEN 用户悬浮胶囊、键盘聚焦或使用辅助技术读取它
- THEN 三种方式都能读取完整 T
- AND 页面不声称还会提供目标消息、对话或关联运行记录。

#### Scenario: 首次发送后零专用布局

- GIVEN 分析入口创建的草稿首次发送成功
- WHEN 页面显示已创建会话
- THEN 候选问题消失
- AND 会话使用普通已有会话的全部布局
- AND 来源胶囊序列化为首条用户消息顶部唯一的 Markdown 来源块
- AND 历史不再重复显示独立胶囊。

### Requirement: 对话分析项按记录可用性禁用

Source: docs/product/pages/main-left-sidebar.md#在右侧栏分析这段对话

对话正在运行、存在未读结果、当前未选中或所属项目目录不可用时，系统 MUST 在记录路径仍可取得的前提下保持「在右侧栏分析这段对话」可用。记录路径不可用时，系统 MUST 禁用该项，通过鼠标悬停与辅助技术提供「对话记录不可用，暂时无法分析」的可读原因，并 MUST NOT 打开没有来源片段的草稿。

#### Scenario: 项目目录不可用不阻止分析

- GIVEN 对话所属项目目录不可用但对话记录路径可取得
- WHEN 用户打开该对话菜单
- THEN 分析项保持可用。

#### Scenario: 记录不可用时禁用

- GIVEN 对话记录路径不可取得
- WHEN 用户打开该对话菜单并悬停分析项
- THEN 分析项不可选择，鼠标用户看到禁用原因且辅助技术可读取同一原因
- AND 不创建或打开分析草稿。

### Requirement: SessionAnalysis Page Story 展示真实入口

Source: docs/product/pages/main-right-sidebar.md#新会话与已有会话标签

`Page/Console/SessionAnalysis` MUST 使用确定性 fixture、fullscreen 布局与真实生产导出展示根对话与分析对话自己的分析面板、宽窄布局、关闭/空/加载/失败/重试/多条目状态、直接父子归属与同一外层兄弟标签导航。Story MUST 复用生产 `AnalysisPanel`、`OperatorConsole` 与右侧栏导出，MUST NOT 复制平行组件或连接真实 IPC、文件系统和用户数据。

#### Scenario: Page Story 可机械比较面板状态与层级

- WHEN 打开 SessionAnalysis 的 Page Stories
- THEN 可分别观察根面板多条目、分析对话自己的面板、孙辈兄弟标签、窄窗口覆盖和读取失败重试
- AND fixture 只驱动真实生产组件的受控 props。

### Requirement: 零标签关闭右侧栏并恢复内容选择

Source: docs/product/pages/main-right-sidebar.md#标签全部关闭

关闭最后一个标签 MUST 同时关闭右侧栏并留下零标签状态，MUST NOT 自动创建、高亮或保留「新标签」。用户之后显示右侧栏时 MUST 先看到无标签内容选择；只有选择类型后才创建标签。

#### Scenario: 关闭最后一个标签

- GIVEN 右侧栏只有一个可关闭标签
- WHEN 用户完成关闭或草稿丢弃裁决
- THEN 标签数为零
- AND 右侧栏关闭
- AND 焦点回到主内容显示按钮。

### Requirement: 手动 sidebar chat 组合路由区分选中与承载会话

Source: docs/product/pages/main-left-sidebar.md#选择对话

左侧栏 MUST 把已创建的手动 sidebar chat 作为最终项目下的普通用户会话呈现。来源可用时，页面 MUST 只高亮该手动 sidebar chat 行，同时在主内容显示来源并在右侧栏显示 sidebar chat；来源不可用时 MUST 在主内容显示 sidebar chat。分析会话不进入左侧栏，适用分析面板与外层兄弟标签 Requirements。两段会话的状态点、阅读位置和草稿 MUST 独立。

#### Scenario: 来源可用时找回

- GIVEN sidebar chat B 的来源 A 仍可承载主内容
- WHEN 用户激活 B 的左侧栏行
- THEN 只有 B 行处于选中态
- AND 主内容显示 A
- AND 右侧栏显示并聚焦 B。

#### Scenario: 已打开后来源失效

- GIVEN 页面正在显示来源 A 与右侧 B
- WHEN A 变为不可承载且 B 仍可用
- THEN B 成功迁移到主内容后才删除旧来源标签
- AND B 的阅读位置、草稿、运行状态与选中态保持。

### Requirement: 搜索结果与当前查询条件一致

Source: docs/product/pages/search.md#操作与反馈

搜索 MUST 至少按完整标题执行 trim、Unicode NFKC、lowercase 后的非空包含匹配。空查询 MUST 保持中性初始状态。页面显示的加载、结果和错误 MUST 只属于当前输入与归档范围对应的最近搜索；已失效搜索不得覆盖状态或阻塞新搜索。输入法组合期间 Enter MUST NOT 提交搜索。

#### Scenario: 晚到旧结果被隔离

- GIVEN 查询 A 仍在执行
- WHEN 用户改成查询 B 并提交，随后 A 晚到
- THEN 页面输入、范围、加载、结果与错误只反映 B
- AND A 不禁用 B 的提交入口。

#### Scenario: 归档结果恢复并打开

- GIVEN 搜索结果是一段仍属于活动项目的归档 sidebar chat
- WHEN 用户激活唯一「恢复并打开」动作
- THEN 会话只恢复一次
- AND 来源可用时走组合路由
- AND 来源不可用时在主内容打开并显示降级说明。

### Requirement: 所有合法团队重名状态可辨认

Source: docs/product/pages/main-conversation.md#选择工作空间与团队

新对话、sidebar chat 和已有会话的团队选择控件 MUST 让所有合法重名团队通过稳定、用户可读且不含内部 key、路径或临时序号的信息辨认。可见文本与辅助名称 MUST 使用同一辨认信息。

#### Scenario: 同名用户团队

- GIVEN 两支用户团队显示名称相同
- WHEN 用户展开或收起团队选择控件
- THEN 选项与当前值使用稳定本地创建时间区分
- AND 辅助名称提供相同上下文。

### Requirement: 左侧栏采用 dashboard 视觉节奏且保留生产能力

Source: docs/product/pages/main-left-sidebar.md#页面结构

系统 MUST 让主页面左侧栏默认宽度为 252px，同时保留既有可拖动最小 / 最大宽度、窄窗自动收起和
显式开合能力。系统 MUST 使用 46px 窗口控制行、34px 品牌行、34px 应用级导航行以及 32px
项目 / 会话行；会话行 MUST 以固定 28px 左缩进容纳标题，并只以中性选中背景、前景文字和
`aria-current` 表示当前会话。系统 MUST NOT 为选中会话渲染 `»`、`>>`、前缀图标或其他占位，
MUST NOT 在选中、未选中、hover 或 focus 间改变标题左边界与可用宽度。系统 MUST 保留“新建
对话”“搜索”“Agent 团队”“重新查看引导”“设置”及全部项目 / 会话操作，MUST NOT 因参考稿
未展示某项生产能力而删除或隐藏它。

#### Scenario: 展开含状态会话的侧栏

- **GIVEN** 主页面侧栏包含展开项目、折叠项目、选中会话和三种状态点
- **WHEN** 用户在默认宽度打开侧栏并切换当前会话
- **THEN** 侧栏宽 252px，窗口控制、品牌、应用入口、项目和会话使用规定高度
- **AND** 选中会话只显示中性选中底与前景文字，DOM 和可见文本均没有 `»` 或 `>>`
- **AND** 切换前后选中与未选中会话标题的左边界、可用宽度和状态尾列保持不变
- **AND** 展开项目不重复聚合状态点，折叠项目只显示最高优先状态点，底部操作保持可达

#### Scenario: 用户拖动并恢复侧栏

- **GIVEN** 侧栏处于默认 252px 宽度
- **WHEN** 用户拖动右边界后关闭并重新打开侧栏
- **THEN** 拖动仍受既有最小 / 最大宽度约束，主内容随实际宽度重排
- **AND** 开合不重置会话、项目展开状态、列表滚动位置或主时间线

### Requirement: 左侧栏与主会话非品牌图标按宿主盒统一对齐

Source: docs/product/pages/main-left-sidebar.md#响应式与窗口行为；docs/product/pages/main-conversation.md#页面结构

系统 MUST 让左侧栏与主会话内除品牌 Logo 外的 Lucide 图标在既有按钮或文本行宿主中自然居中。
具有相同视觉角色与密度的图标 MUST 保持一致的视觉重量；系统 MUST NOT 通过单枚图标的 `top`、
额外上内边距或位移补偿对齐，也 MUST NOT 为校正图形而缩小既有按钮宿主。图标出现、消失、
hover、focus、展开、折叠或状态切换 MUST NOT 改变同层文字的基线或横向起点。该规则 MUST NOT
自动应用到品牌 Logo 或右侧栏内部。

#### Scenario: 生产侧栏与主会话图标按宿主盒对齐

- **GIVEN** 生产侧栏与主会话显示 shell、导航、项目/会话操作、消息/活动工具、子会话、状态、上下文和 Composer 代表状态
- **WHEN** 检查这些图标与其宿主
- **THEN** 具有相同视觉角色与密度的图标使用相符的图形尺寸、描边和自然居中方式
- **AND** 单行图标中心与宿主行或按钮中心的垂直差不超过 0.5px
- **AND** 图标与文字基线自然，同一行相邻按钮视觉重量一致
- **AND** 其他已经自然对齐且视觉重量一致的生产图标保持既有尺寸和布局

#### Scenario: 现有图标交互不因对齐调整回归

- **GIVEN** 用户可使用侧栏和主会话中的全部现有图标入口
- **WHEN** 用户以鼠标或键盘触发 hover、focus、项目折叠、附件、发送和停止
- **THEN** 原入口、辅助名称、悬停说明、焦点反馈和业务回调保持可用
- **AND** 被校正图形的既有按钮宿主尺寸没有缩小
- **AND** Logo 与右侧栏内部的图标尺寸和布局没有变化

### Requirement: 左侧栏与主会话使用一致的表面层级和独立滚动边界

Source: docs/product/pages/main-left-sidebar.md#响应式与窗口行为

系统 MUST 让左侧栏与主会话使用同一不透明 canvas 背景，以语义选中、悬停和 card token 表达层级，并以 1px 语义分隔线表达侧栏右边界、顶部控制行底边、侧栏底部操作顶边和 composer 边界。品牌和页面标题 MUST 使用既有 display 字体，导航、列表与正文 MUST 使用既有 body 字体及对应层级。系统 MUST NOT 为本次对齐新增裸色、阴影或渐变。侧栏中只有项目 / 会话列表 MUST 独立滚动；主会话中只有时间线 MUST 独立滚动，顶部控制行、标题、底部操作和 composer MUST 保持可达，最后一条消息 MUST NOT 被 composer 遮挡。

主页面 MUST 提供键盘可聚焦的“跳到主内容”入口。项目列表初次加载时 MUST 在主内容显示明确加载面，同时保留侧栏中的独立设置和团队入口；加载骨架在正常动态效果下 MAY 持续脉冲，在 `prefers-reduced-motion: reduce` 下 MUST 取消持续动画并保留可辨认的静态结构。空会话 MUST 使用无插画的标题、说明和既有 composer。窄窗左右抽屉的开合结果 MUST 通过非阻断状态区域播报。

#### Scenario: 短高度窗口分别滚动侧栏和主会话

- **GIVEN** 侧栏包含超出可用高度的项目列表，主会话包含超出可用高度的消息
- **WHEN** 用户把桌面窗口高度缩短并分别滚动两区
- **THEN** 只有项目列表和主时间线发生滚动
- **AND** 品牌、应用导航、侧栏底部操作、主标题和 composer 保持可达
- **AND** 两区背景、语义分隔线和字体层级保持一致，最后一条消息不被 composer 遮挡

### Requirement: 主会话所有状态共用 dashboard 内容轴

Source: docs/product/pages/main-conversation.md#页面结构

系统 MUST 让主会话 sticky 标题、通知、空态、时间线消息、活动 run、结果、待发射区和 composer 共用最大 840px 的居中内容轴；可用宽度不足时各区域 MUST 共同收缩并保持 32px 左右 gutter；存在会话目录轨时，时间线消息列与 composer 的左侧 gutter 例外地按收起态目录轨宽度预留（56px）且不随目录轨展开变化，sticky 标题行位于目录轨上方、不受该例外影响。顶部窗口控制行与 sticky 会话标题 MUST 均为 46px。系统 MUST NOT 让任一区域继续使用独立的 760px / 720px 宽度，MUST NOT 因内容轴变宽而把目录轨迁入项目 / 会话侧栏或产生根级横向滚动。

#### Scenario: 宽窗打开长会话

- **GIVEN** 已有会话包含通知、用户与 Agent 消息、活动 run、待发射内容和 composer
- **WHEN** 主会话可用宽度大于 904px
- **THEN** 标题、消息、活动记录、待发射区和 composer 的内容边界对齐到居中的 840px 轴
- **AND** 顶部窗口控制行与 sticky 标题均为 46px，目录轨仍属于当前主会话

#### Scenario: 主会话容器收窄

- **GIVEN** 左侧栏打开且主会话正在显示
- **WHEN** 窗口缩窄到无法容纳 840px 内容轴
- **THEN** 标题、时间线和 composer 同步收缩；无目录轨时保留 32px 左右 gutter，有目录轨时消息列与 composer 左缘固定让出收起态目录轨宽度（56px）且不随目录轨展开变化
- **AND** 长正文、附件和 Markdown 在自身边界换行或滚动，不撑宽根页面

### Requirement: 主会话消息采用 dashboard 身份与正文层级

Source: docs/product/pages/main-conversation.md#时间线

系统 MUST 在主会话把用户与 Agent 身份头像渲染为 24px 圆形，把 Agent / system 正文相对身份行缩进 32px，并让 Agent 正文占满 840px 内容列、不再附加行宽上限。用户身份行和消息 MUST 右对齐，用户消息气泡 MUST 不超过主内容轴的 75%，使用 8px × 12px 内边距和 10px 圆角。系统 MUST 保持消息时间只在 hover / focus 时可见，并保持 Markdown、附件、完整输出、分析入口及活动 run 的既有行为。主会话视觉参数 MUST NOT 自动应用到右侧栏的 embedded 会话。

#### Scenario: 同一时间线含用户长消息与 Agent 长回复

- **GIVEN** 主会话包含用户消息、Agent 长回复与活动 run
- **WHEN** 用户悬停并键盘聚焦这些记录
- **THEN** 主会话头像为 24px，Agent 正文缩进 32px 且占满内容列宽度
- **AND** 用户气泡右对齐且不超过内容轴 75%，消息时间可见
- **AND** 原有消息操作仍可由鼠标和键盘使用

### Requirement: 主会话 composer 对齐内容轴并与 embedded 布局隔离

Source: docs/product/pages/main-conversation.md#输入框

系统 MUST 让已有会话与新对话的主 composer 使用同一 840px 内容轴、1px 描边、14px 圆角和 10px / 12px 内间距。上下文项 MUST 为 28px 高；空 textarea MUST 从单行高度起步并随内容增长，最大高度 MUST 为 120px；附件、发送和主理人停止按钮 MUST 为 32px 方形且使用 10px 圆角。系统 MUST 保留正文、输入法、mention、附件、发送、停止、待发射和禁用原因的既有状态规则，MUST NOT 把主 composer 宽度或单行起步规则应用到右侧 embedded composer。

#### Scenario: 新对话与已有会话输入多行内容

- **GIVEN** 用户分别打开新对话和已有会话
- **WHEN** 用户输入多行正文、添加附件并打开 mention 补全
- **THEN** 两个主 composer 与各自页面的 840px 内容轴一致
- **AND** textarea 从单行增长且不超过 120px，所有上下文与操作保持可达

#### Scenario: 主理人运行时右侧子任务同时打开

- **GIVEN** 主会话主理人正在运行且右侧栏打开一个可推进的子任务
- **WHEN** 主会话显示发送、停止和待发射状态
- **THEN** 主 composer 使用 dashboard 主布局并保持既有控制语义
- **AND** 右侧子任务 composer 继续使用 embedded 可用宽度和原有密度
### Requirement: 分析面板只展示直接分析子项入口

Source: docs/product/pages/main-conversation.md#分析对话入口面板规则

分析面板 MUST 支持关闭、空、加载、失败和直接子项列表状态；列表项 MUST 只触发打开或聚焦会话，不得承载摘要、运行状态、详情、输入或管理动作。

#### Scenario: 多层分析关系

- GIVEN 当前对话 A 的直接子项为 B，B 的直接子项为 C
- WHEN 渲染 A 的分析面板
- THEN 面板显示 B
- AND 不显示 C、不缩进、不画树。

#### Scenario: 长列表

- GIVEN 直接子项超过面板可用高度
- WHEN 用户滚动面板
- THEN 仅面板列表滚动
- AND 所在对话时间线阅读位置不变。

### Requirement: 根对话与分析对话复用同一面板组件

Source: docs/product/pages/main-conversation.md#分析对话入口面板规则

根对话的面板 MUST 锚定主内容右上角；右侧栏分析对话的面板 MUST 锚定该标签内容右上角。宽内容区 MUST 使用 288px 并排面板，窄内容区 MUST 使用不改变正文宽度的覆盖布局。

#### Scenario: 右侧栏分析对话打开自己的面板

- GIVEN 分析对话显示在外层右侧栏标签
- WHEN 用户激活其标题区分析面板开关
- THEN 面板出现在该标签的内容区域
- AND 外层右侧栏不新增嵌套层。

### Requirement: 分析面板交互可访问

Source: docs/product/pages/main-conversation.md#分析对话入口面板规则

面板开关 MUST 暴露可访问名称与展开状态；入口 MUST 可键盘聚焦激活并使用完整标题；关闭面板与成功导航 MUST 遵守规定焦点去向。消息级导航 MUST 在目标挂载后聚焦并短暂突出目标消息。

#### Scenario: 键盘关闭面板

- GIVEN 键盘焦点在打开的面板内
- WHEN 用户关闭面板
- THEN 焦点返回控制该面板的开关。

#### Scenario: 键盘打开分析入口

- GIVEN 键盘焦点位于可用分析入口
- WHEN 用户激活入口
- THEN 唯一目标标签打开或聚焦
- AND 焦点进入活动标签或目标会话标题。

#### Scenario: 入口打开失败

- GIVEN 目标会话不可用
- WHEN 用户激活入口
- THEN 焦点保持原入口
- AND 显示可被辅助技术读取的失败原因。

### Requirement: `moebius-ref:` 作为受控应用内链接渲染

Source: docs/product/pages/main-conversation.md#右侧栏中的分析新会话

合法 `moebius-ref:` Markdown link MUST 渲染为应用内导航；未知自定义协议、非法目标以及转义文本、代码、HTML、图片地址或裸文本中的协议样式 MUST NOT 获得导航或来源交付能力。导航判定与 local-console 来源提取 MUST 使用同一 Markdown link-node 语义。

#### Scenario: 合法消息引用

- GIVEN 用户消息包含合法且可访问的消息引用链接
- WHEN 渲染消息并激活链接
- THEN 发出消息导航 intent
- AND 不调用系统外链能力。

#### Scenario: 非链接语法不获得能力

- GIVEN 正文在转义文本、代码、HTML、图片地址或裸文本中包含 `moebius-ref:` 样式
- WHEN 渲染并准备来源交付
- THEN 不渲染应用内导航
- AND 不向 Agent 交付对应来源。

#### Scenario: 不可用引用

- GIVEN 链接语法非法或目标不可访问
- WHEN 渲染消息
- THEN 保留可读标签并说明来源不可用
- AND 不允许激活为应用内或外部链接。

# 运行监督终局与一次性执行配置重跑

## Requirement: 运行活动显示真实监督事实

Source: docs/product/pages/agent-conversation.md#最新活动

RunBlock MUST 能呈现 runtime 提供的服务繁忙、观察到的 retry attempt 和长运行报告；这些事实仍原地替换同一 run 的最新活动，不得新增时间线行。次数只有在 DTO 明确提供时才显示；缺失时 MUST 使用不含数字的安全文案。组件 MUST NOT 根据 elapsed、CLI 名称、普通 stderr 文本或活动频率自行推断服务繁忙、额度耗尽或卡住。

### Scenario: 服务繁忙次数可见

- **GIVEN** runtime activity DTO 表示 retryable service busy 且 attempt=3
- **WHEN** 用户查看该活动 run
- **THEN** 活动行显示「对方服务繁忙，正在第 3 次重试」
- **AND** 同一 run 仍只有一条活动记录
- **AND** 停下入口保持可用。

### Scenario: 未提供次数不编造

- **GIVEN** runtime 只确认服务繁忙但没有可靠 attempt
- **WHEN** RunBlock 渲染活动
- **THEN** 它显示「对方服务繁忙，正在重试」
- **AND** 不显示猜测的次数。

## Requirement: 异常终局保留不完整正文

Source: docs/product/pages/agent-conversation.md#停下
Source: docs/product/pages/agent-conversation.md#页面状态

RunOutcome MUST 在 runtime DTO 提供 partial Markdown 时，使用既有安全 static Markdown renderer 显示该正文，并常驻可读的“内容不完整”说明。partial Markdown、说明和 terminal fact MUST 属于同一条历史记录；组件 MUST NOT 把 partial 渲染成 completed Agent message，也不得在 terminal refresh、父级重渲染或重开会话时丢失。

user-interrupted MUST 显示「你让这一步停下了」且保持中性；quota/rate-limit/auth/crashed/no-complete-result MUST 使用 runtime safe classification 的可理解文案并触发宿主提供的异常语义。只有间接证据时 MUST 说明没有产出完整结果和可能原因，MUST NOT 假称额度已经耗尽。raw provider payload、stderr、路径和内部 reason MUST NOT 出现在普通终局卡片。

### Scenario: Kimi 用户停止不显示失败

- **GIVEN** terminal DTO 为 user-interrupted 且包含 partial Markdown
- **WHEN** RunOutcome 渲染
- **THEN** 用户看到 partial Markdown、「内容不完整」和「你让这一步停下了」
- **AND** 看不到「这一步没跑起来」或成功完成语义。

### Scenario: 无结果不是成功消息

- **GIVEN** terminal DTO 为 no-complete-result
- **WHEN** 主会话和 sidebar status 渲染
- **THEN** 时间线显示需要处理的安全终局
- **AND** 不显示 completed Agent message 或有新结果蓝点。

## Requirement: 终局原位选择一次性执行配置重跑

Source: docs/product/pages/agent-conversation.md#重试与恢复

user-stopped、timeout、quota/rate-limit、auth 和 no-complete-result 终局 MUST 提供普通重试及「换执行配置重跑」。选择器 MUST 复用宿主传入的团队执行能力 registry 来约束 CLI/model/effort，明确说明“只用于这一次重跑，不会修改团队成员设置”，且首版 MUST NOT 提供默认持久化到团队配置的选项。

console-ui MUST 保持 presentational：它只消费 registry DTO、loading/error/selection/submitting 状态和 callbacks，不得加载 capability、调用 local API、修改团队 store 或导入 runtime 类型。registry 慢返回、失败或为空时，原 terminal content、普通重试和继续说话能力 MUST 保持；迟到响应、父级重渲染与 callback identity 变化 MUST NOT 重置用户较新的选择或重复提交。

所有选择器和确认/取消动作 MUST 可由键盘操作并具有独立可访问名称；提交中 MUST 防止重复激活。窄窗口 MAY 换行或纵向排列，但 MUST NOT 产生页面级横向滚动。

宿主 MUST 为每次用户显式确认生成新的 single-run submission nonce。同一次确认产生的重复网络请求 MUST 复用 nonce 以保持幂等；用户回到终局卡片再次确认同一 profile MUST 使用新 nonce，不得因 profile 相同而静默吞掉。

### Scenario: 临时切换模型提交

- **GIVEN** user-stopped 终局和已加载 capability registry
- **WHEN** 用户选择另一 CLI/model/effort 并确认
- **THEN** 组件恰好调用一次 single-run rerun callback
- **AND** 页面明确说明团队设置不会改变
- **AND** 原 partial Markdown 与 terminal history 保持可见。

### Scenario: registry 慢返回时父级更新

- **GIVEN** override panel 正在加载 registry
- **WHEN** 父级用新 callback identity 重渲染且旧请求随后返回
- **THEN** terminal content 不丢失
- **AND** 旧响应不覆盖较新的受控状态
- **AND** 确认操作只调用当前 callback 一次。

### Scenario: registry 失败可恢复

- **GIVEN** capability registry 加载失败
- **WHEN** 用户查看终局
- **THEN** panel 原位显示可理解失败和重新加载动作
- **AND** 普通重试、继续说话与历史内容仍可用
- **AND** 不提交默认或未经校验的 profile。

### Requirement: Agent messages use progressive disclosure

The console UI component library MUST provide an independent agent message component that defaults to a collapsed summary containing the localized role name, localized stage, conclusion, and handoff line.

The component MUST derive conclusion, stage marker, and handoff line from the raw agent Markdown by default.

The component MUST allow explicit conclusion, stage, and handoff fields to override the derived values.

The collapsed summary MUST NOT expose the English stage marker or other raw protocol metadata.

The expanded view MUST preserve the complete raw Markdown without deleting protocol metadata.

#### Scenario: Agent message is concise by default and auditable on demand

Given a raw agent response contains `## 结论`, a legal stage marker, and a handoff line
When the agent message Story first renders
Then the user sees the localized role, localized stage, conclusion, and handoff summary
And the complete raw response is not expanded by default
When the user expands the message
Then the complete original response is visible.

#### Scenario: Explicit structured fields override parsing

Given raw Markdown can be parsed and the caller also supplies explicit summary fields
When the agent message renders
Then each explicit field is shown in preference to its parsed counterpart
And the original raw Markdown remains unchanged in the expanded view.

### Requirement: Run blocks support steps and a no-step fallback

The console UI component library MUST provide an independent run block component with a presentation-only model that does not depend on local-console runtime types.

The run block MUST show the localized role name, human-readable elapsed time, and an accessible interrupt button whether or not step data exists.

When elapsed time is missing, empty, or whitespace-only, the run block MUST show「耗时未知」.

When steps exist, the run block MUST show each step as completed, running, or pending and MUST make each available raw step output expandable.

When steps do not exist, the run block MUST show a non-empty single-line human summary and MUST make available raw run output expandable.

When both steps and a usable summary are absent, the run block MUST show「正在运行，等待进展」instead of an empty card.

Raw output MUST remain collapsed by default.

#### Scenario: Planned run shows step progress

Given a run has completed, running, and pending steps
When its Story renders
Then every step and status is visible
And the localized role, elapsed time, and interrupt button are visible
And raw output is available through collapsed details.

#### Scenario: Unplanned run degrades to one useful line

Given a run has no step data but has a human summary and raw output
When its Story renders
Then the summary appears instead of an empty step area
And the localized role, elapsed time, and interrupt button are visible
And the raw output is available only after expanding details.

#### Scenario: Missing presentation data has a deterministic fallback

Given step data is absent and summary and elapsed time are missing, empty, or whitespace-only
When the run block renders
Then it shows「正在运行，等待进展」
And it shows「耗时未知」
And the run block is not blank.

### Requirement: Terminal run outcomes are humanized without losing evidence

The console UI component library MUST map failed to「运行失败」, stuck to「运行长时间无响应」, interrupted to「运行已中断」, and dead-letter to「多次尝试仍失败，已停止自动重试」in the user-visible summary.

The collapsed summary MUST NOT expose raw machine reasons such as `exit`, `idle-timeout`, or `dead-letter`.

The component MUST preserve the original machine reason and raw output in collapsed details that the user can expand.

The expanded content MUST preserve line breaks, angle brackets, ampersands, and machine strings such as `exit:42` as text without interpreting or altering them.

#### Scenario: Four terminal outcomes are understandable and auditable

Given Stories exist for failed, stuck, interrupted, and dead-letter outcomes with raw machine reasons
When each Story first renders
Then its user-visible area contains the confirmed Chinese summary
And raw `exit`, `idle-timeout`, and dead-letter strings are not visible
When the user expands details
Then the corresponding original machine reason is visible unchanged.

### Requirement: Disclosure and interrupt controls are keyboard-operable

Agent message, run step output, and run outcome disclosure controls MUST toggle within one Enter or Space activation.

Machine text inside each disclosure MUST be invisible to the user while collapsed and fully visible after expansion.

The run block interrupt button MUST invoke `onInterrupt` exactly once for one mouse activation and exactly once for one keyboard activation without crashing the component.

Visibility verification MUST use rendered browser visibility rather than treating text presence in the DOM as visible content.

#### Scenario: Keyboard toggles every disclosure once

Given agent message, run step output, and run outcome details are collapsed
When the user focuses each disclosure control and activates it once with Enter or Space
Then that disclosure toggles to expanded
And its complete machine text becomes visible
When the user activates it once again
Then it returns to collapsed
And its machine text is not visible.

#### Scenario: Interrupt fires once per activation

Given a run block receives an `onInterrupt` counting spy
When the user activates the interrupt button once with a mouse
Then the count increases by one
When the user activates the interrupt button once with a keyboard
Then the count increases by one again
And the component remains rendered.

#### Scenario: Special machine text is preserved behind disclosure

Given raw output contains line breaks, angle brackets, ampersands, and `exit:42`
When the component first renders collapsed
Then that raw content is not visible
When the user expands the disclosure
Then the rendered text content equals the original value.

### Requirement: Project and session sidebar

The console UI MUST provide an independent project and session sidebar component that derives each visible project label from the final directory name of its project path.

The sidebar MUST order sessions by waiting, running, idle, and completed status, in that order, while preserving caller order within the same status.

The sidebar MUST classify goal sessions by their actual status and MUST NOT introduce a special goal-session priority tier.

The sidebar MUST keep completed sessions in a completed group that is collapsed by default.

The selected session style MUST NOT change session ordering.

#### Scenario: Sidebar Story shows four status tiers

Given a Story supplies a project path and sessions in mixed status order
When the sidebar Story opens
Then the project displays the final directory name
And waiting sessions appear before running sessions
And running sessions appear before idle sessions
And the completed group appears last and is collapsed by default.

#### Scenario: Selection does not reorder sessions

Given an idle session is selected and a waiting session is not selected
When the sidebar renders
Then the waiting session remains before the selected idle session
And the selected session is indicated only as an interaction state.

### Requirement: Project conversation incremental loading

Source: docs/product/pages/main-left-sidebar.md#项目内对话的渐进加载

The console UI MUST show only the newest five unpinned root conversations for an expanded project by default, using the existing `createdAt` DESC order.

When more unpinned root conversations exist, the project conversation list MUST render a ghost `Show More` action at the bottom. Activating it MUST expose a loading state, then append at most ten more conversations below the existing rows. The action MUST remain while more conversations exist and MUST be hidden when all available conversations are visible.

Collapsing a project MUST clear its incremental-loading state and any pending local load commit. Re-expanding the project MUST show the newest five unpinned root conversations again.

Pinned conversations MUST remain in the separate pinned section and MUST NOT consume the project conversation loading batches.

#### Scenario: Initial project list is bounded

Given a project has twelve unpinned root conversations ordered by `createdAt` DESC
When the project is expanded
Then exactly the newest five project conversations are visible
And a ghost `Show More` action is visible below them.

#### Scenario: Loading more appends a batch

Given the project shows five conversations and has more available
When the user activates `Show More`
Then the action exposes a loading state and is not activatable again during that state
And after loading, up to ten additional conversations appear below the existing rows.

#### Scenario: Collapse resets incremental loading

Given a project has loaded more than its initial five conversations
When the user collapses and re-expands the project
Then only the newest five unpinned root conversations are visible
And no stale loading state or late local load result changes the collapsed project.

### Requirement: Protocol-safe role composer

The console UI MUST provide an independent controlled composer that opens a completion panel for the seven legal roles: ceo, dev, qa, dev-manager, product-manager, hermes-user, and secretary.

The completion panel MUST present a neutral avatar, Chinese role name, and concise responsibility for each role.

Selecting a role MUST replace the active completion token with exactly one legal `@<handle>` mention and MUST preserve surrounding ordinary text.

When the message already contains one legal role mention outside the active completion token, the composer MUST NOT insert a second legal role mention.

The completion panel MUST support pointer selection and keyboard selection.

#### Scenario: Role selection generates a legal mention

Given the composer contains an active `@` completion token and no other legal role mention
When the user selects the displayed 开发 role
Then the controlled composer value contains `@dev`
And the user did not need to type the complete protocol handle.

#### Scenario: Existing mention blocks a second insertion

Given the composer value already contains `@qa`
When the user attempts to open another completion and select 开发
Then the composer does not insert `@dev`
And the original value remains unchanged.

### Requirement: Empty conversation state

The console UI MUST provide an independent empty conversation state with an invitation to describe a goal and choose a role through the role composer.

The empty state MUST NOT use an illustration, unread language, urgency language, or more than one solid emphasis action.

#### Scenario: Empty state invites a protocol-safe start

Given a conversation has no messages
When the empty-state Story opens
Then it invites the user to describe a goal and choose a role
And the embedded composer can open the legal role completion panel
And the surface remains flat except for the completion overlay.

### Requirement: Current session context header

The console UI MUST provide an independent current-session header that renders an optional parent-session breadcrumb, the current task status, and a compact progress summary.

The current-session header MUST NOT render global waiting counts, global running counts, a new-session action, or the global waiting-list overlay.

#### Scenario: Header Story stays within current-session context

Given a task session has a parent session, status, and progress counts
When the session-context header Story opens
Then the parent breadcrumb, task status, and progress summary are visible
And global counts, a new-session action, and a global waiting-list control are absent.

### Requirement: Linear flat visual boundary

The sidebar, composer, empty state, and session header MUST use existing console semantic tokens, thin borders, near-square radii, compact spacing, and flat solid controls.

The role completion overlay MAY use one soft shadow, but non-overlay component surfaces MUST NOT use shadows.

Waiting presentation MUST remain neutral, and runtime state colors MUST NOT be used as decoration.

#### Scenario: Component Stories match the conversation-console source

Given the four component Stories are rendered in light or dark mode
When they are compared with the conversation-console design source and the AcceptCard component-library reference
Then borders, radii, spacing, buttons, and neutral status presentation use the same flat visual language
And only the open role-completion overlay has a shadow.

### Requirement: 主会话顶栏按当前会话展示运行项入口

Source: docs/product/pages/main-conversation.md#托管运行项入口与面板

主会话应用顶栏 MUST 在当前 session 存在 managed-process DTO 时显示运行项入口，并置于分析面板开关与右侧栏开关之前。只有一个 active 条目时 MUST 显示可读 label 与状态；多个 active 条目时 MUST 显示数量。没有任何 active 或本次应用生命周期内尚未确认的 exited 条目时 MUST 不渲染空占位。最后一个 active 退出后入口 MUST 保持可达并显示单项 `label · 已退出` 或多项 `N 个已结束`，直到用户明确确认清除；active 数量 MUST NOT 把 exited 计入。

入口与面板 MUST 只消费宿主提供的 serializable DTO、loading/error/log state 和 callbacks；console-ui MUST NOT 调用 HTTP、Electron IPC、Provider、child process 或 local-console runtime，也 MUST NOT 从 Agent 正文、elapsed 或 URL 文本推导运行项状态。

managed-process active count MUST 与 Agent `runningCount` 分离。它 MAY 禁用普通归档并触发项目移除确认，但 MUST NOT 点亮侧边栏“正在运行”状态点、使结果卡冒充 Agent run，或让 ChangeTab 进入 Agent 工作中状态。

#### Scenario: 单项与多项入口

- **GIVEN** 当前 session 先有一个 ready 运行项，随后增加第二个 running 运行项
- **WHEN** OperatorConsole 重渲染
- **THEN** 单项时入口显示 label 与“已就绪”状态
- **AND** 多项时显示“2 个运行项”
- **AND** 分析面板和右侧栏开关仍是独立可聚焦控件。

#### Scenario: 切换会话不显示旧条目

- **GIVEN** 会话 A 有运行项且会话 B 没有
- **WHEN** 宿主切换到 B 并进入 loading
- **THEN** UI 不继续显示 A 的 label、endpoint 或日志
- **AND** 不用 A 的旧数据填充 B 的面板
- **AND** B 确认无条目后入口不占位。

#### Scenario: 只有托管运行项时不冒充 Agent run

- **GIVEN** Agent run 已结束且当前会话只剩一个 ready managed process
- **WHEN** 用户观察侧边栏、结果卡、ChangeTab 与归档菜单
- **THEN** 侧边栏不显示“正在运行”状态点，结果卡和 ChangeTab 不进入 Agent 工作态
- **AND** 普通归档仍然禁用，运行项顶栏入口继续可见。

#### Scenario: 窄窗口仍可操作

- **GIVEN** 顶栏宽度不足以显示完整 label
- **WHEN** 运行项入口收敛
- **THEN** 可见内容 MAY 只保留图标或数量
- **AND** aria-label 仍包含当前 active 数量和状态
- **AND** 键盘仍能打开面板、逐项操作并把焦点返回入口。

#### Scenario: 最后一个运行项退出后确认清理

- **GIVEN** 当前 session 的最后一个 active 条目自行退出，且没有其他 active 或 stopping 条目
- **WHEN** 顶栏收到 exited summary
- **THEN** 入口不瞬间消失，而显示该条目“已退出”或退出条目数量
- **AND** 用户能打开面板查看退出事实与有限日志
- **WHEN** 用户激活“清除已退出”且宿主确认成功
- **THEN** exited 条目与入口立即消失，不留下空 gap
- **AND** 焦点移动到下一个可用顶栏控件；确认失败时入口、面板和日志保持并原位显示可重试原因。

### Requirement: 运行项面板区分生命周期、地址、日志与停止

Source: docs/product/pages/main-conversation.md#托管运行项入口与面板

面板 MUST 按创建顺序稳定展示 label、kind、starting/running/ready/unhealthy/stopping/exited 状态、可选 endpoint、日志状态和安全 exit code/signal。spawn 存活与 readiness ready MUST 使用不同可读状态，不得只靠颜色区分。没有 endpoint 的 service/task/watcher MUST 保留 logs 与 stop；只有服务端 DTO 提供已校验 loopback endpoint 时才显示 open。

每项 open、view logs 与 stop MUST 有包含 label 的独立可访问名称。stop 进行中 MUST 禁止重复激活，并保留其他条目操作。日志 MUST 使用可选择等宽文本、转义控制字符并显示 truncated/dropped 事实；loading、failed 与 empty MUST 彼此可区分，失败后可重试且不隐藏条目状态。

面板存在 exited 条目时 MUST 提供明确的“清除已退出”动作。该动作只提交宿主 intent；宿主 MUST 只清除当前 session 已 settled 的 exited 内存记录，不影响 active/stopping 条目、会话 JSONL 或进程。确认 pending 时防止重复提交；失败时保留全部退出事实并允许重试。

#### Scenario: readiness 与健康异常可辨认

- **GIVEN** 同一条目依次收到 starting、ready、unhealthy DTO
- **WHEN** 面板更新
- **THEN** 用户分别读到“启动中”“已就绪”“健康异常”
- **AND** processId 对应的条目不重复或换位
- **AND** unhealthy 时 logs 与 stop 保持可用。

#### Scenario: 无 URL 的 watcher 可管理

- **GIVEN** watcher 状态 running 且 endpoint=null
- **WHEN** 用户展开该条目
- **THEN** 不显示 open 动作
- **AND** 显示 view logs 与 stop
- **AND** 可访问名称不声称它是网页服务。

#### Scenario: 日志截断与失败恢复

- **GIVEN** 日志 DTO 表示 truncated 且下一次增量读取失败
- **WHEN** 面板展示日志
- **THEN** 保留已经读取的安全尾部和“前文已截断”说明
- **AND** 原位显示读取失败与重试
- **AND** 不清空条目、endpoint 或 stop 操作。

#### Scenario: 停止只提交一次

- **GIVEN** 用户激活某条目的 stop，宿主随后以新 callback identity 重渲染
- **WHEN** 用户重复点击或按键且旧 promise 尚未完成
- **THEN** 组件只提交一次该 session/process 的 stop intent
- **AND** 目标显示 stopping
- **AND** 其他条目不被禁用或改成 stopping。

### Requirement: 异步运行项状态对父级重渲染与迟到响应安全

Source: docs/product/pages/main-conversation.md#托管运行项入口与面板

宿主 MUST 以 session-scoped request revision 管理 summary、detail、logs 与 stop。切换 session、父级重渲染、callback identity 变化、慢返回、失败或旧请求迟到 MUST NOT 将旧 session 条目提交给当前 UI、重复 stop、覆盖较新的状态或丢失已读取日志。面板关闭 MAY 降低轮询频率，但 active 状态变化 MUST 继续在顶栏收敛；exited 后 MUST 停止无意义的高频日志轮询。

#### Scenario: 旧 session 慢响应被丢弃

- **GIVEN** 会话 A 的 list 请求未返回
- **WHEN** 用户切换到会话 B，B 请求先返回，随后 A 才返回
- **THEN** 当前入口与面板只显示 B 的条目
- **AND** A 响应不覆盖 B 或产生闪现。

#### Scenario: 面板关闭仍更新退出状态

- **GIVEN** active 条目存在且面板已关闭
- **WHEN** 目标进程自行退出
- **THEN** 顶栏在下一次 summary refresh 后不再把它计入 active 数量
- **AND** 重新打开面板仍能查看 exited 事实与有限日志
- **AND** settled 后日志不继续高频轮询。

## Team snapshot traceability and apply

### Requirement: Session team updates use categorized neutral notices

Source: docs/product/pages/main-conversation.md#团队按钮展开

The main composer MUST render separate neutral notices for Agent-definition, execution-profile and team-information changes. Same-category changes MUST collapse to one row; different categories MUST remain separate. Every row's Apply action MUST invoke the same full-team intent. The notices MUST NOT display hashes, times, paths, current/previous values, diffs, single-category apply or error-colored attention.

Waiting state MUST combine the rows into one waiting explanation while existing pending-dispatch UI keeps post-click messages editable/removable. Failed state MUST preserve those messages and expose retry-same-version and cancel-and-use-current actions. The component MUST consume backend state and MUST NOT implement change comparison or queue promotion.

#### Scenario: Two categories share one full apply

- **GIVEN** definition and profile notices are visible
- **WHEN** the user activates Apply on the profile row
- **THEN** exactly one full-team apply callback is invoked
- **AND** no profile-only callback or mixed-version state exists.

#### Scenario: Identity-only Markdown change presents both relevant notices

- **GIVEN** the backend reports Agent-definition and team-information categories for an identity-frontmatter-only edit
- **WHEN** the composer renders the update state
- **THEN** separate `Agent 定义已更新` and `团队信息已更新` notices are visible
- **AND** no execution-profile notice is visible.

#### Scenario: Failed application does not hide waiting messages

- **GIVEN** full-team application failed after two messages were submitted
- **WHEN** the composer area renders
- **THEN** both messages remain visible, editable and removable in the existing pending area
- **AND** retry and cancel actions have independent accessible names.

### Requirement: Agent avatar opens a run-scoped information popover

Source: docs/product/pages/main-conversation.md#Agent-头像与当时信息

Every active, successful and structured-terminal Agent record MUST provide a mouse- and keyboard-operable avatar button that opens one run-scoped Popover anchored to that trigger. The Popover MUST show historical Agent/team identity, source disambiguation, nullable CLI/model/effort, nullable loaded time and the backend evidence label for actual execution, planned-not-started or bound-start-unknown. Missing fields MUST show `此项未记录` and MUST NOT be filled from current team state.

The Popover MUST use collision handling to flip above when needed and remain within a narrow viewport without page-level horizontal scrolling. Outside click, Escape and repeated trigger activation MUST close it and return focus to the trigger. It MUST NOT obstruct access permanently to message menus, output or analysis actions.

#### Scenario: Popover flips near the bottom

- **GIVEN** an Agent avatar is near the bottom of the visible timeline
- **WHEN** its information Popover opens and there is insufficient space below
- **THEN** the Popover opens above the message within the viewport
- **AND** closing it returns focus to the same avatar.

#### Scenario: Current team values do not replace history

- **GIVEN** a run audit reports Kimi/K/high and the current team now uses Codex/C/medium
- **WHEN** the Popover opens
- **THEN** it displays Kimi/K/high
- **AND** Codex/C/medium is absent.

### Requirement: Historical Agent Markdown opens in a read-only dialog

Source: docs/product/pages/main-conversation.md#Agent-头像与当时信息

The run information Popover MUST provide a `查看 AGENT.md` action. Activating it MUST open a console-ui Dialog that loads and displays the complete persisted run-scoped Markdown as selectable escaped source text. It MUST NOT execute Markdown/HTML, edit, save, compare, restore, open a file path or navigate to current team settings. Closing the Dialog MUST return to the originating message context and preserve scroll position.

The Popover and Dialog loaders MUST isolate responses by session/run/role key. Slow or failed loads MUST show local loading/error/retry states. A parent re-render or callback identity change MUST NOT reset a newer result, duplicate a request or let a late response overwrite another run.

#### Scenario: Late Markdown response belongs to another run

- **GIVEN** run A's Markdown request is slow
- **WHEN** the user closes A, opens run B and B completes first
- **THEN** B remains visible
- **AND** A's late response is ignored.

#### Scenario: Callback identity changes while loading

- **GIVEN** an information request is pending
- **WHEN** the parent re-renders with a new callback identity for the same run key
- **THEN** the request is not duplicated or cleared
- **AND** retry later invokes the current callback exactly once.

### Requirement: Team save feedback uses one shared production component

Source: docs/product/pages/agent-teams.md#保存后的生效反馈

The Agent Teams page MUST render one shared feedback component for persisted single-item success, valid external-load success, partial results and save-all-and-leave success. Success copy MUST state that no restart is needed and explain the new-conversation/explicit-apply boundary without claiming CLI readiness. The list-level save-all success MUST identify the team and saved-item count. Conflict, invalid content, read failure, needs-repair and unsaved drafts MUST NOT render success.

#### Scenario: Save-all success appears after navigation

- **GIVEN** save-all-and-leave persisted three items
- **WHEN** the list page becomes visible
- **THEN** the shared feedback appears above the team list with the team and count three
- **AND** it remains long enough to read.

#### Scenario: Failed draft is not described as active

- **GIVEN** a member draft failed to save
- **WHEN** partial feedback renders
- **THEN** it states that the member still uses the previous saved version and offers retry
- **AND** no full-success message appears.
### Requirement: Onboarding 统一展示 CLI 与 API 执行环境

Source: `docs/product/pages/onboarding.md#第-1-步--环境就绪至少一个执行引擎已就绪`

Onboarding MUST 在同一环境步骤展示 CLI 与 AI Provider，允许选择 DeepSeek、输入 Key、选择受维护模型并执行真实验证。验证与本地保存 MUST 是可区分状态；保存失败、取消、离开、关闭重开和迟到结果 MUST 有唯一可见恢复结果。有效 API Provider 单独满足继续条件。

#### Scenario: 验证成功但保存失败

- **GIVEN** DeepSeek 回复和受控工具调用均已通过
- **WHEN** 本地保存档案失败
- **THEN** 页面显示验证已完成但尚未保存，并提供无需额外 API 用量的保存重试
- **AND** Provider 列表与可选执行环境不出现半档案。

### Requirement: Settings 提供 AI 服务商完整管理

Source: `docs/product/pages/settings.md#ai-服务商`

Settings MUST 提供 AI 服务商分类、列表、空态、新增、Key 轮换、模型管理、默认模型、重新验证/启用、停用、引用迁移、结束继续能力和删除保护。服务商下架 MUST 引导新建档案并迁移或结束历史继续能力，不进入不可修复的原档案表单。危险操作 MUST 显示逐项引用和跨重启结果。

#### Scenario: 默认模型下架但仍有可用模型

- **GIVEN** 档案仍有其他已验证模型但默认模型已下架
- **WHEN** 用户或团队配置打开该档案
- **THEN** 档案保持可识别状态，模型字段为空并要求显式选择
- **AND** 页面不静默代选模型。

#### Scenario: 重新启用失败分类

- **GIVEN** 用户对停用档案执行真实重新验证
- **WHEN** 发生网络/限流暂时失败或 Key/模型配置失败
- **THEN** 暂时失败保持“已停用”并可稍后重试，配置失败转为“需要处理”并显示匹配修复入口
- **AND** 修复、验证和保存完成后直接进入“已就绪”。

### Requirement: Agent 团队支持 Pi 成员配置与引用结果

Source: `docs/product/pages/agent-teams.md#agent-运行配置`

Agent 编辑器 MUST 将 Pi API 作为第四执行引擎，并为其显示 Provider 档案、模型和思考程度。页面 MUST 区分 ready、needs-attention、disabled、服务商/模型下架和历史档案缺失；不可用配置不得保存或用于新运行。团队生命周期与设置页逐名引用结果 MUST 同成同败地可见。

#### Scenario: Provider 默认模型不可用

- **GIVEN** 用户选择一个已就绪但没有有效默认模型的档案
- **WHEN** Pi 配置表单更新
- **THEN** Provider 保持选中、模型字段为空且保存禁用
- **AND** 用户明确选择已验证模型后才可保存。

### Requirement: 主对话提供 Pi 的唯一可执行恢复动作

Source: `docs/product/pages/main-conversation.md#pi-配置异常与会话迁移`

主对话 MUST 根据 Pi 档案和 generation 的真实状态提供修复、一次性换配置重跑、永久迁移、重新建立执行或结束继续能力；每一状态只能展示可执行动作。历史档案缺失时不得显示原配置重建。结束继续能力后的待发射内容 MUST 显示为不阻塞团队切换的未发送卡片，并保留编辑重提/移除入口。

#### Scenario: Provider 档案缺失

- **GIVEN** 时间线历史仍含 Provider 显示标识但档案已无法解析
- **WHEN** 用户打开异常卡片
- **THEN** 页面只显示迁移到已就绪档案或结束继续能力
- **AND** 历史消息和原冻结标识仍可阅读。

### Requirement: 单 Agent 页面展示安全的 Pi 完整过程

Source: `docs/product/pages/agent-conversation.md#完整输出`

单 Agent 页面 MUST 展示 Pi 的安全流式活动、工具、Plan、子任务、附件、耗时、尝试、上下文压缩和恢复结果。完整输出只能是更详细的安全投影；MUST NOT 展示 Key、Authorization、原始 Provider error body、请求响应载荷、stderr、内部协议对象或绝对路径。上下文压缩 MUST 与主时间线共用唯一“已整理较早上下文”事实。

#### Scenario: 打开失败 attempt 的完整输出

- **GIVEN** Provider 返回含内部载荷的 auth 失败
- **WHEN** 用户打开完整输出并复制可见内容
- **THEN** 内容只含安全分类、已发生的安全活动与恢复入口
- **AND** 不含原始错误正文、请求头、Key 或内部 frame。

### Requirement: BYOK 异步 UI 不依赖引用稳定

Source: `docs/product/pages/settings.md#操作与反馈`

所有 Provider 验证、保存、轮换、迁移、批量替换和删除 UI MUST 以稳定 operation ID 与 revision 关联结果，MUST NOT 依赖父组件不重渲染或 callback identity 稳定。关闭、切页、慢成功、慢失败、重复点击和迟到返回均不得提交过期草稿或覆盖较新状态。

#### Scenario: 父级重渲染后旧验证迟到

- **GIVEN** 用户启动档案 A 的验证后关闭表单，并重新打开编辑为档案 B
- **WHEN** 父级多次重渲染且 A 的旧回调最后返回成功
- **THEN** B 的草稿、按钮和档案列表不被 A 覆盖
- **AND** A 的 operation 只按其持久真实状态恢复或结束。

### Requirement: BYOK 页面遵守桌面与窄窗口设计系统

Source: `docs/product/pages/settings.md#响应式与窗口行为`

五个页面 MUST 使用 console-ui semantic tokens、既有 primitives、焦点与状态语义，MUST NOT 导入 prototype、裸 hex、渐变或阴影。常规桌面宽度与窄窗口 MUST 保持主动作可见、无横向滚动、弹层可滚动、键盘可达，并支持暗色与 reduced-motion。

#### Scenario: 窄窗口管理 Provider

- **GIVEN** 真实 Electron 窗口缩窄到页面 PRD 的关键宽度
- **WHEN** 用户新增、查看引用并打开迁移确认
- **THEN** 内容单列或全宽呈现，主操作和关闭入口均可见且可键盘操作
- **AND** 不遮挡状态、产生横向滚动或丢失草稿。
