# console-ui delta：local-console-t5-full-parity

## ADDED Requirements

### Requirement: Child session tree
The console UI MUST render local sessions as a project -> parent session -> child session tree when parent references are available.

The console UI MUST keep child session rows compact and scannable with status, title, and role/waiting summary.

The console UI MUST render repair child sessions under the failed child or parent relationship supplied by the local state API.

The console UI MUST NOT reorder the tree on streaming output alone; only status or relationship changes may move rows.

#### Scenario: Sidebar shows child session tree
Given a project has one parent session and three child sessions
When the operator console renders the project sidebar
Then the child sessions appear under the parent session
And each child row shows its current status without wrapping over adjacent rows.

### Requirement: Parent progress and acceptance
The console UI MUST render parent-session progress events for child session creation, child pass/fail, integration request, repair creation, and blocked/dead-letter states.

The console UI MUST render an acceptance card that can generate strict runner-compatible walkthrough text.

The console UI MUST prevent submitting an acceptance card while any acceptance statement remains undecided.

The console UI MUST keep evidence links and artifact labels optional; missing evidence MUST NOT be fabricated.

#### Scenario: Acceptance card outputs protocol text
Given every acceptance item has pass or fail selected
When the user submits the acceptance card
Then the generated message contains one numbered walkthrough line per statement
And a final `验收结论：通过/不通过` line.

### Requirement: Dead-letter and diff return
The console UI MUST render visible local dead-letter records as recoverable system facts, not as hidden diagnostics.

The console UI MUST render worktree diff bundle summary, affected files, and explicit diff return action when provided by local state.

The console UI MUST render generated, applied, abandoned, rolled_back, and failed worktree diff states distinctly.

The console UI MUST expose abandon and rollback actions only when the supplied local diff state allows those actions.

The console UI MUST render diff return failure as a visible local error while keeping the diff bundle accessible.

#### Scenario: Diff return status is visible
Given a worktree diff bundle is available
When the details panel renders
Then the affected files and explicit apply action are visible
And no UI text implies the original directory has already been modified before apply succeeds.

#### Scenario: Diff rollback and abandon actions follow state
Given a generated worktree diff is visible
When the operator console renders the diff controls
Then abandon is available before apply
And rollback is available only after apply succeeds
And neither action implies a destructive reset or deletion of the original directory.
