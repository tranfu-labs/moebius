# console-ui delta：agent-team-snapshot-traceability-and-apply

## MODIFIED Requirements

### Requirement: Agent team member initial avatars

Source: docs/product/pages/main-conversation.md#Agent-头像与当时信息
Source: docs/product/pages/agent-teams.md#Agent-身份与说明

The Agent Teams surface, team selector options and Agent timeline/run records MUST compose the shared `AgentInitialAvatar` identity pattern. The glyph MUST derive from display name then stable slug and MUST use the stable identity token. A clickable timeline avatar MUST wrap that visual in an independently focusable button with a readable action name; the visual itself remains decorative. The product MUST NOT persist image or separate avatar metadata.

#### Scenario: Same member appears in menu and timeline

- **GIVEN** `@dev` has display name `开发工程师`
- **WHEN** the team menu and an Agent run render
- **THEN** both use the shared avatar glyph `开` and the same stable identity tone
- **AND** the run avatar button has an accessible name that includes the member and information action.

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

### Requirement: 验收 #20 团队菜单披露创建时载入的快照语义

Source: docs/product/pages/main-conversation.md#团队按钮展开

New conversation, analysis new conversation and existing-session team menus MUST reuse one team-option component. Every selectable option MUST show name, source, purpose, primary Agent, member count and ordered readable members. When space is insufficient, it MUST retain the primary Agent and provide a keyboard-operable `+N` control that expands/collapses the full bounded member list without selecting the team or closing the menu. It MUST NOT show member CLI/model/effort or internal identifiers.

An existing-session trigger and checked current item MUST use the effective historical snapshot summary. Current catalog teams MUST appear only after a separator, excluding the stable team represented by the current snapshot. A pending explicit switch MUST show its frozen target summary. New-conversation options MUST use current saved catalog state.

#### Scenario: Team renamed after conversation load

- **GIVEN** a conversation loaded historical team name A and the saved catalog now names the same team B
- **WHEN** the existing-session trigger and menu open
- **THEN** the trigger and checked current item display A with historical source disambiguation
- **AND** B does not replace or duplicate that current item.

#### Scenario: Full member list expands without selection

- **GIVEN** an option has six members and displays three plus `+3`
- **WHEN** the user activates `+3` by mouse, Enter or Space
- **THEN** all six members become reachable in that option
- **AND** the option is not selected and the menu remains open.

## ADDED Requirements

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
