# console-ui spec delta：sidebar-project-conversation-load-more

## 新增 Requirement: Project conversation incremental loading

Source: docs/product/pages/main-left-sidebar.md#项目内对话的渐进加载

The operator console MUST show only the newest five unpinned root conversations for an expanded project by default, using the existing `createdAt` DESC order.

When more unpinned root conversations exist, the project conversation list MUST render a ghost `Show More` action at the bottom. Activating it MUST expose a loading state, then append at most ten more conversations below the existing rows. The action MUST remain while more conversations exist and MUST be hidden when all available conversations are visible.

Collapsing a project MUST clear its incremental-loading state and any pending local load commit. Re-expanding the project MUST show the newest five unpinned root conversations again.

Pinned conversations MUST remain in the separate pinned section and MUST NOT consume the project conversation loading batches.

#### Scenario: Initial project list is bounded

- GIVEN a project has twelve unpinned root conversations ordered by `createdAt` DESC
- WHEN the project is expanded
- THEN exactly the newest five project conversations are visible
- AND a ghost `Show More` action is visible below them.

#### Scenario: Loading more appends a batch

- GIVEN the project shows five conversations and has more available
- WHEN the user activates `Show More`
- THEN the action exposes a loading state and is not activatable again during that state
- AND after loading, up to ten additional conversations appear below the existing rows.

#### Scenario: Collapse resets incremental loading

- GIVEN a project has loaded more than its initial five conversations
- WHEN the user collapses and re-expands the project
- THEN only the newest five unpinned root conversations are visible
- AND no stale loading state or late local load result changes the collapsed project.
