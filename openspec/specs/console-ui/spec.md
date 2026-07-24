# console-ui 规格

## Purpose

`console-ui` 是桌面对话操作台的 React 组件库与开发期展示台。它提供可被 Electron renderer 消费的 shadcn 风格源码组件、Radix 无障碍原语封装、Tailwind 语义令牌（近黑底暗色优先 + 状态色相族）和项目专属复合组件；它不承载真实桌面对话操作台的数据流、IPC、runner 状态管理或 GitHub / Codex 调用。

## Requirements

### Requirement: Package boundary and Storybook source of truth

The `console-ui` domain MUST provide a workspace package named `@moebius/console-ui` under `packages/console-ui`.

The `console-ui` package MUST expose React components and global styles so the desktop renderer can import `@moebius/console-ui` and `@moebius/console-ui/globals.css`.

The `console-ui` package MUST use shadcn-style source components built on Tailwind CSS variables and Radix primitives, with component source checked into this repository rather than hidden behind a runtime UI package.

The `console-ui` package MUST provide Storybook as the development-time browser showcase for console UI components.

The `console-ui` package MUST include at least one shadcn-style primitive sample and one project-specific composite sample so the token chain, Storybook setup, and renderer-consumable package shape are verified.

The `console-ui` package MUST keep Storybook under `packages/console-ui` as the only shipped browser showcase for this domain.

The `console-ui` package MUST NOT keep a parallel static Tailwind HTML component library as a second UI source of truth.

#### Scenario: Renderer can consume the component library

- **GIVEN** a desktop renderer needs console UI components
- **WHEN** it imports `@moebius/console-ui` and `@moebius/console-ui/globals.css`
- **THEN** it can render React components with the package-local global styles.

#### Scenario: Storybook shows package samples

- **GIVEN** a developer runs `pnpm --filter @moebius/console-ui storybook`
- **WHEN** Storybook starts
- **THEN** the browser showcase includes a primitive button story and a project-specific acceptance card story.

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

- MUST derive at most one status dot per session row and per collapsed project row from unresolved run facts, non-continuable session state, unread result state, the latest-message mention fact, and active-run state.
- MUST apply the priority `red > blue > blink > none` when more than one fact is true.
- MUST render `red` only for an unresolved run-not-started, run-stuck, or retry-exhausted fact, or when the session cannot continue because its project folder is unavailable, its team was deleted, or its team needs repair.
- MUST render `blue` when nobody is running, the latest message mentions no team member, and the latest result has not been viewed.
- MUST render `blink` when no red or blue condition applies and a member is running.
- MUST render no dot otherwise.
- MUST NOT render red or blue when the latest message mentions a team member; MUST NOT render red merely because the user stopped a run, a run completed normally, or an old waiting-for-human field is present.
- MUST NOT rely on color alone; each dot MUST expose an accessible name distinguishable without color: `发生异常` / `有新结果` / `正在运行`.
- MUST clear the blue dot after the user opens the session and the latest result becomes visible.

#### Scenario: Priority holds when facts overlap

- **GIVEN** a session simultaneously has an unresolved stuck run and an unread result
- **WHEN** the sidebar renders that session row
- **THEN** exactly one red dot is shown
- **AND** its accessible name reads `发生异常`.

### Requirement: Collapsed project status aggregation

- MUST allow each project row to be independently collapsed or expanded by the user.
- MUST NOT show a per-session status dot on the project row while the project is expanded.
- MUST show a single aggregated dot on a collapsed project row using the same `red > blue > blink` priority derived from all sessions inside that project.
- MUST NOT show a numeric count of unread or running sessions on the project row.
- MUST allow the project containing the currently selected session to be manually collapsed; the main content MUST continue showing the selected session and MUST NOT auto re-expand the project.
- MUST NOT change the currently selected session as a result of collapsing or expanding a project.

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

### Requirement: 引导壳区分首启与回看模式

Source: docs/product/pages/onboarding.md#重新查看引导

`OnboardingShell` MUST 通过显式输入区分 `first-run` 与 `replay`。回看模式 MUST 显示“回看引导”、可操作的“退出”和末步“完成回看”；首启模式 MUST 继续显示“首次启动”和末步“开始使用”，且 MUST NOT 获得可跳过首启硬门禁的退出入口。

#### Scenario: 已完成用户回看引导

- **GIVEN** shell 以 `replay` 模式渲染
- **WHEN** 用户从第 1 步进入或到达第 4 步
- **THEN** 标题栏显示“回看引导”和“退出”
- **AND** 第 4 步主 CTA 显示“完成回看”。

#### Scenario: 全新用户首次启动

- **GIVEN** shell 以 `first-run` 模式渲染
- **WHEN** 用户查看标题栏和第 4 步
- **THEN** 标题栏显示“首次启动”且没有退出操作
- **AND** 第 4 步主 CTA 仍为“开始使用”。

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

Source: docs/product/pages/agent-teams.md#Agent-身份与说明

The Agent Teams surface MUST render the same neutral circular initial-avatar pattern for each member in the team-list member item, the detail member selector, and the current-member heading.

The avatar glyph MUST use the first visible character of the member display name, MUST fall back to the first character of the stable member slug when the display name is unavailable, and MUST uppercase Latin fallback or display initials.

The surface MUST NOT require or persist an image, image path, or separate avatar metadata field for this identity marker.

#### Scenario: Canonical display name supplies the avatar

- **GIVEN** a team member has display name `软件测试` and slug `qa`
- **WHEN** the team list, member selector, and current-member heading render that member
- **THEN** all three surfaces show the neutral circular glyph `软` beside the same readable identity.

#### Scenario: Missing display name falls back to slug

- **GIVEN** an intermediate or unavailable member summary has an empty display name and slug `dev-manager`
- **WHEN** an initial avatar is rendered
- **THEN** the neutral circular glyph is `D`
- **AND** no image or avatar metadata is required.

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

- MUST keep unsaved `AGENT.md` edits for multiple members simultaneously within one team detail view.
- MUST NOT auto-save `AGENT.md`.
- MUST NOT prompt when switching between members while drafts exist, and MUST preserve every draft across member switches, window resizing, and horizontal scrolling of the member selector.
- MUST save only the current member when the save action is invoked, and MUST support `Command/Ctrl + S`.
- MUST retain the edited content and show a reason with a retry affordance when a save fails.
- MUST offer continue-editing, discard-all, and save-all-and-leave when leaving the team detail with drafts outstanding.
- MUST keep successfully saved members saved and keep failed members' drafts when save-all-and-leave partially fails, MUST keep the user on the current team detail, and MUST show which members failed.
- MUST NOT report overall success when any member failed to save, and MUST NOT roll back members that already saved.
- MUST require the user to save or discard outstanding drafts before duplicating or deleting the affected team or member.

#### Scenario: Partial save-all is reported honestly

- **GIVEN** three members have unsaved drafts and the user chooses save-all-and-leave
- **WHEN** one member's save fails and two succeed
- **THEN** the two successful members are saved and their drafts cleared
- **AND** the failing member keeps its draft and appears in a failure list
- **AND** the user remains on the team detail view.

### Requirement: External modification conflict resolution

- MUST apply conflict handling only to user teams.
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

#### Scenario: Refused leave says why

- **GIVEN** a member has an unresolved external conflict
- **WHEN** the user attempts to return to the team list
- **THEN** the view stays on the team detail
- **AND** an explanation names the members awaiting a resolution.

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
Source: docs/product/pages/main-conversation.md#上下文

系统 MUST 允许用户从会话团队菜单改选可用团队，并在菜单内说明“这段对话用的是开始时载入的那份团队内容，之后在 Agent 团队页的修改不影响它”。系统 MUST NOT 让用户把 Agent 团队页的后续编辑误认为会自动改变本会话已载入的团队内容。

### Scenario: 打开团队菜单查看绑定语义
- GIVEN 一段会话已绑定一个可用团队
- WHEN 用户打开团队菜单
- THEN 菜单列出可选团队，并显示创建时载入且不随团队页后续修改变化的说明

## Requirement: #10 时间线不显示过程状态
Source: docs/product/pages/main-conversation.md#区域与信息

系统 MUST 只把对话内容和最终事实放入时间线，并让消息时间仅在悬停或聚焦时显示。系统 MUST NOT 显示「已交棒」「已完成」「运行中」「未开始」等过程标签、过程图标或汇总计数条。

### Scenario: 已结束的步骤只留下对话
- GIVEN 一个成员已经完成当前步骤
- WHEN 用户查看该步骤的历史记录
- THEN 记录中没有过程标签、过程图标、操作条或常驻时间

## Requirement: #11 运行记录只提供完整输出
Source: docs/product/pages/main-conversation.md#运行中的操作条

系统 MUST 让活动运行记录继续原地展示当前最新可见输出，并在记录末尾只提供「完整输出」；四种事实记录 MUST 同样提供「完整输出」。主会话与子任务标签中的 Agent 历史消息、活动运行和终态事实只要带 run id，MUST 都能用所属 session 与 run 打开自己的完整输出。系统 MUST NOT 在活动运行记录或已结束历史记录中呈现「停下」或计时；停下入口 MUST 仅位于空草稿的运行中输入框按钮。「完整输出」MUST 在步骤结束后保留在历史记录上。右侧栏正式形态已就绪，「完整输出」打开意图 MUST 打开或聚焦右侧栏对应的“过程”标签。过程内容 MUST 使用面向用户的结构化展示，并隐藏绝对路径和内部标识。系统 MUST NOT 把全量输出堆积进时间线，MUST NOT 用操作台故障诊断入口代替「完整输出」，MUST NOT 在入口文案、时间线或过程标签中泄露运行目录、工作目录、数据库路径或内部标识。

### Scenario: 查看活动运行记录
- GIVEN 时间线正在展示一个成员的活动运行记录
- WHEN 用户查看该记录末尾与输入框操作区
- THEN 活动运行记录只提供完整输出且没有停下按钮或计时
- AND 空草稿输入框中存在唯一的停下按钮

### Scenario: 步骤结束后查看完整输出
- GIVEN 一个带有完整输出入口的活动步骤已经结束
- WHEN 用户查看该步骤的历史记录
- THEN 完整输出入口继续保留
- AND 历史记录中没有停下按钮或计时

### Scenario: 没跑起来的记录也能调出完整输出
- GIVEN 一个步骤留下了「这一步没跑起来」的记录
- WHEN 用户查看该记录
- THEN 记录上提供「完整输出」，与「重试」并存

### Scenario: 完整输出在右侧栏按需显示
- GIVEN 时间线上的「完整输出」入口没有展示路径、内部标识或计时
- WHEN 用户打开该入口
- THEN 右侧栏打开或聚焦对应的“过程”标签
- AND 命令、工具、文件与错误以友好结构呈现，不显示原始 JSON、绝对路径或内部标识

### Scenario: 从子任务打开完整输出
- GIVEN 子任务标签中存在带 run id 的历史 Agent 回复或活动运行
- WHEN 用户点击该记录的「完整输出」
- THEN 系统使用该子会话 id 与 run id 打开对应的过程标签
- AND 不会错误读取父会话中同名或同时运行的步骤

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

## Requirement: #13 所有对话文本过滤机器信息
Source: docs/product/pages/main-conversation.md#指标与验收

系统 MUST 过滤 Agent 正文、运行步骤标题、实时摘要和系统记录中的路径、cwd、runDir、数据库路径及内部 id。系统 MUST NOT 过滤项目修复确认框中由用户亲自选择的文件夹路径。

### Scenario: Agent 输出绝对路径
- GIVEN Agent 正文和步骤标题包含绝对路径与内部运行 id
- WHEN 时间线渲染这些文本
- THEN 用户只能看到替代文案而看不到路径或内部 id

## Requirement: #16 状态点只取确定事实
Source: docs/product/pages/main-conversation.md#操作与反馈

系统 MUST 按红大于蓝大于闪的优先级派生状态点：红点来自三种未处理异常或三种不可继续状态，蓝点来自无人工作、最后消息未提及成员且结果未读，闪点来自成员正在工作。系统 MUST NOT 以用户按停、正常完成、最后消息已提及成员或旧「等人回话」字段触发红点或蓝点；每个红点 MUST 对应时间线中的可读系统记录。

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

系统 MUST 让既有会话 composer 的用户消息始终以团队主 Agent 为目标。主 Agent 运行时，composer MUST 同时保留可编辑输入、发送能力和一个只绑定主 Agent `runId` 的方形停止按钮；输入内容变化 MUST NOT 隐藏或改写该停止按钮。专业 Agent 运行而主 Agent 空闲时，composer MUST NOT 显示停止按钮。

### Scenario: 主理人运行中继续输入
- GIVEN 主 Agent 正在运行且 composer 包含可发送正文
- WHEN 用户查看并操作 composer
- THEN 页面同时存在“发送给主理人”和“停下主理人”两个可访问动作
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

## Requirement: 主理人待发射区与时间线分离
Source: docs/product/pages/main-conversation.md#输入框

系统 MUST 在 composer 上方按 FIFO 展示主 Agent 运行期间提交的待发射用户消息，并 MUST 显示可理解的正文摘要与附件事实。待发射消息 MUST NOT 同时出现在主时间线；当该消息被 runtime 领取并启动主 Agent 后，MUST 从待发射区移除并出现在时间线。刷新与重启 MUST 保持相同归属。

### Scenario: 两条消息等待主理人
- GIVEN 主 Agent 正在运行且用户依次提交两条消息
- WHEN state 刷新
- THEN 待发射区按原顺序显示两条消息且主时间线尚未显示它们

### Scenario: 最早消息发射
- GIVEN 待发射区有两条消息且主 Agent 进入终态
- WHEN runtime 领取下一条消息
- THEN 第一条从待发射区进入主时间线并启动主 Agent
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

系统 MUST 在没有任何成员在工作且没有待处理交棒时，于时间线末尾展示结果卡片，说明这段对话期间有几个文件发生改动并提供一步打开改动内容的入口；右侧栏正式形态已就绪，该入口 MUST 打开或聚焦右侧栏对应的“改动”标签；没有文件改动时 MUST 如实说明；项目文件夹不是 Git 仓库时 MUST NOT 出现结果卡片。系统 MUST NOT 在卡片上铺开文件清单，MUST NOT 声称这些改动由团队成员造成，MUST NOT 按单个步骤结束反复产出卡片，MUST NOT 在入口或卡片中泄露路径与内部标识。

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
- THEN 右侧栏打开或聚焦对应的“改动”标签，入口与卡片均不显示路径或内部标识

## Requirement: 验收 #1 右侧栏开关与宽度作为全局偏好持久化
Source: docs/product/pages/main-right-sidebar.md#入口与去向

系统 MUST 在没有已保存偏好时默认关闭右侧栏，并在用户改变开关或宽度后跨对话切换及应用重启恢复该值。系统 MUST NOT 让右侧栏开合清空当前会话草稿、改变运行状态或重置会话区滚动位。

### Scenario: 重启后恢复右侧栏工作习惯
- GIVEN 用户已打开右侧栏并把宽度调整为 500 像素
- WHEN 用户切换对话并重启应用
- THEN 右侧栏保持打开且恢复为 500 像素宽

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

## Requirement: 验收 #16 每个标签可关闭且最后一个标签有空白兜底
Source: docs/product/pages/main-right-sidebar.md#关闭标签

系统 MUST 为每个标签提供关闭操作，并在最后一个标签关闭后立即留下一个空白标签且保持右侧栏打开。系统 MUST NOT 因关闭标签而关闭对话、停止推进或取消子任务。

### Scenario: 关闭最后一个标签
- GIVEN 右侧栏已打开且只剩一个标签
- WHEN 用户关闭该标签
- THEN 右侧栏继续显示并包含一个标题为“新标签”的空白标签

## Requirement: 验收 #17 加号只创建两类可选内容
Source: docs/product/pages/main-right-sidebar.md#空白标签与类型选择

系统 MUST 让加号创建一个不参与去重的空白标签，并在 Git 项目中只提供“改动”和“项目文件”两种选择。系统 MUST NOT 在类型选择中出现过程、子任务、终端、预览或浏览器。

### Scenario: Git 项目打开空白标签
- GIVEN 当前会话绑定的是 Git 项目
- WHEN 用户点击标签条加号
- THEN 新空白标签的类型选择恰好包含“改动”和“项目文件”

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

## Requirement: 验收 #23 窄窗右侧栏覆盖会话区并恢复滚动位
Source: docs/product/pages/main-right-sidebar.md#窄窗口

系统 MUST 在窗口不足以三栏并排时让右侧栏覆盖会话区，提供独立的关闭并回到会话区操作，并在关闭后恢复打开前的会话区滚动位。系统 MUST NOT 让用户必须依赖被覆盖的主内容按钮才能离开右侧栏。

### Scenario: 窄窗打开并关闭右侧栏
- GIVEN 窄窗口中的会话区滚动位置为 320 像素
- WHEN 用户打开右侧栏并使用覆盖层内的关闭操作
- THEN 右侧栏消失且会话区滚动位置仍为 320 像素

## Requirement: 过程标签以友好时间线呈现公开输入与执行事件
Source: docs/product/pages/main-right-sidebar.md#过程标签

系统 MUST 把每次执行的公开输入呈现为用户与 Agent 按顺序一来一回的安全 Markdown，并在其后呈现 Agent Markdown、命令、工具 / 函数 / MCP、文件、错误与 unsupported 等结构化过程事件；多次执行 MUST 各自显示「第 N 次执行 / 本轮输入 / 本轮执行过程」。系统 MUST NOT 显示原始 JSON、拼接 prompt、系统指令、persona、团队规则、token 统计或原始 reasoning。

### Scenario: 用户消息经开发经理交给开发
- GIVEN 某次开发 run 启动时公开时间线依次包含用户消息与开发经理交棒
- WHEN 用户打开开发的完整输出
- THEN 本轮输入先按角色显示用户与开发经理消息
- AND 本轮执行过程随后显示开发的 Agent Markdown 与工具事件
- AND 页面不出现开发 persona 或本地团队规则

## Requirement: 验收 #13 — 过程标签标题只由成员名和同成员序号组成
Source: docs/product/pages/main-right-sidebar.md#标签条

系统 MUST 使用步骤意图的 role 到成员名映射作为过程标签标题，同一会话内同时打开的同成员第二个及以后过程标签 MUST 依次命名为「成员名 2」「成员名 3」；无法映射 role 时 MUST 使用「成员未知」，标签文字溢出时 MUST 截断显示并由 `title` 提供完整标题。系统 MUST NOT 从步骤正文、摘要或实时输出生成描述性标题。

### Scenario: 同一成员打开两个不同步骤
- GIVEN 同一会话中开发成员有两个不同 run 输出入口
- WHEN 用户依次点击两个入口的「完整输出」
- THEN 标签条同时出现「开发」与「开发 2」，且二者标题均不包含步骤正文

## Requirement: 验收 #14 — 同一步骤的每次执行在一个过程标签内按序保留
Source: docs/product/pages/main-right-sidebar.md#过程标签

系统 MUST 在同一过程标签内按开始时间显示同一步骤的全部执行，并以「第 1 次执行」「第 2 次执行」连续编号；每次执行 MUST 保留自己启动时的公开输入和后续过程，活动过程标签 MUST 持续轮询，因此某次执行已 settled、下一次 retry 尚未开始的间隙也不得停止更新。系统 MUST NOT 用后一次执行覆盖前一次执行。

### Scenario: 失败后重试同一步骤
- GIVEN 某步骤第一次执行失败并产生原始错误，第二次执行随后成功
- WHEN 用户查看该步骤的过程标签
- THEN 标签内先显示含原始错误的「第 1 次执行」，再显示「第 2 次执行」

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

## Requirement: 验收 #9 改动与项目文件使用不同清单范围
Source: docs/product/pages/main-right-sidebar.md#项目文件标签

系统 MUST 让改动标签只列改动文件，并让项目文件标签列出包含未改动文件的完整项目树；项目文件中的改动文件 MUST 继续使用同一行级变化呈现。系统 MUST NOT 在改动标签混入未改动文件。

### Scenario: 浏览未改动文件
- GIVEN 项目包含一个改动文件和一个未改动文件
- WHEN 用户分别打开改动标签与项目文件标签
- THEN 改动标签只列改动文件，项目文件标签同时列出两个文件且可读取未改动文件内容

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

每一拍 MUST 在该拍 `speakerSlug` 的位置产生一个节点。每个已完成节点 MUST 向本拍边界绘制一段短 tail，下一拍 MUST 使用一条三次贝塞尔曲线从上一成员轨道转入当前成员轨道；tail 和 connector MUST 只属于第 `i - 1` 拍与第 `i` 拍之间的交接，任何连接的 `y1..y2` 索引差 MUST 不超过一个 beat 索引单位。系统 MUST NOT 渲染代表某成员贯穿多拍的竖线、首拍直连末拍的路径或其他跨拍 DAG 边。

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
