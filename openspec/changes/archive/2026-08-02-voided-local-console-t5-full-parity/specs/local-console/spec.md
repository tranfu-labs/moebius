# local-console delta：local-console-t5-full-parity

## MODIFIED Requirements

### Requirement: 边界
The local-console domain MUST keep GitHub runner semantics untouched while allowing T5 local equivalents for CEO routing, child sessions, acceptance pre-pass, dead-letter recovery, local role threads, local evidence, and worktree diff return.

The local-console domain MUST NOT modify GitHub issue timeline normalization, mention trigger rules, GitHub CEO orchestration, issue intake scheduling, GitHub comment publication, reaction targets, release artifact publication, issue media handling, issue worktree behavior, observer behavior, or GitHub driver pool semantics for T5.

The local-console domain MUST NOT implement the M4 T6 mutually exclusive GitHub/local startup flag or M3 A-K runner-stability backlog items as part of T5.

#### Scenario: T5 local equivalents replace the previous T5-only prohibition
Given `openspec/specs/local-console/spec.md` previously stated that T5-only local equivalents must not be implemented in the pre-T5 domain
When this change is archived
Then the local-console spec allows T5 local equivalents in the local-console domain
And the GitHub issue runner spec remains unchanged
And the archived local-console spec does not simultaneously contain a MUST requiring T5 local equivalents and a MUST NOT forbidding those same T5 local equivalents.

## ADDED Requirements

### Requirement: Local goal and session ledger
The local console MUST model a local parent session as the local equivalent of a parent GitHub issue for goal orchestration.

The local console MUST support child sessions through `parent_session_id` or an equivalent persisted parent reference.

The local console MUST preserve `session_messages` as the durable local timeline fact source.

The local console MUST store local role-thread state per session and role so repeated local triggers can resume the role's Codex thread.

The local console MUST persist local goal/task/phase projection, child session references, acceptance facts, integration events, route decisions, dead-letter records, run evidence references, and workspace diff references in the existing local console SQLite database.

The local console MUST NOT create a second local persistence file disconnected from `.state/local-console.sqlite`.

#### Scenario: Parent goal creates child sessions
Given a local parent session receives a multi-task goal
When CEO confirms phase-one child tasks
Then local child sessions are created with parent references
And the parent session can list each child session and its current status
And the child session references are persisted in `.state/local-console.sqlite`.

### Requirement: Local CEO route and guardrail
The local console MUST run the same CEO guardrail semantics before a local agent response becomes visible.

The local console MUST fail open to the original local agent response when CEO guardrail fails.

The local console MUST write CEO append output as a visible local CEO message and leave any mention in that message for the next local drain step.

The local console MUST support local no-mention fallback routing for user messages with goal shape.

The local console MUST support local no-mention fallback routing for user messages that clearly hand off control without writing a legal agent mention.

The local console MUST support local agent-authored no-mention fallback routing when the latest agent message belongs to an unclosed local ledger child task.

The local console MUST dedupe local fallback route decisions by bounded message keys and MUST NOT store full message bodies in the route decision ledger.

The local console MUST validate local fallback route append bodies with the same code-region-aware single legal mention constraint used by the GitHub route guard.

The local console MUST NOT silently complete a clear local handoff message when fallback route judgment returns an invalid append body.

The local console MUST keep a clear local handoff message retryable, or write a visible local failure/dead-letter record before completing it, when fallback route append validation fails.

The local console MUST NOT save a successful append route decision or directly run any target agent when fallback route append validation fails.

The local console MUST persist local fallback route decisions only in `.state/local-console.sqlite` and MUST NOT update GitHub response intake fallback route state.

#### Scenario: Local no-mention route appends before triggering
Given a local user message has goal shape and no legal mention
When local fallback route judgment returns append
Then a visible local CEO message is written
And the target agent is triggered by the next local drain step
And the route judgment call itself does not directly run the target agent.

#### Scenario: Local handoff text without mention routes once
Given a local user message says to hand control to a known role without using a legal agent mention
When local fallback route judgment returns an append handoff for that role
Then exactly one visible local CEO handoff message is written
And that handoff message contains exactly one legal agent mention outside code regions
And the mentioned agent is triggered by the next local drain step
And reprocessing the same source message does not write a second handoff message.

#### Scenario: Local route state does not pollute GitHub intake
Given a local no-mention route decision is recorded for a local session message
When GitHub response intake state is loaded or folded
Then the local route decision is not present in any GitHub intake issue fallback route ledger.

#### Scenario: Invalid local route append remains visible or retryable
Given a local user message clearly hands off control without using a legal agent mention
When local fallback route judgment returns an append body with no legal mention or more than one legal mention
Then the invalid append body is rejected
And no target agent is run directly
And no successful append route decision is saved
And the source message remains retryable or is completed only after a visible local failure or dead-letter record is written.

#### Scenario: Local CEO route hang is bounded
Given local CEO route judgment never settles
When local fallback route handling waits for the configured timeout
Then the session drain is released
And the local message remains retryable or reaches a visible dead-letter according to the retry budget
And no successful route decision is saved for that message.

### Requirement: Child session orchestration
The local console MUST map CEO child issue spawn descriptors to local child session creation when the current source is local.

The local console MUST validate workflow id, ledger task id, quality baseline, acceptance statements, dependencies, initial role, provenance, and conflict group before creating a child session.

The local console MUST derive local child orchestration keys from parent session id, workflow id, and ledger task id; the key MUST NOT include free text.

The local console MUST recover an existing child session by ledger ref or hidden orchestration key before creating a new one.

The local console MUST leave visible parent-session failure details when child creation, recovery, or ledger save fails.

The local console MUST NOT delete already-created child sessions as compensation after a later failure.

#### Scenario: Retry recovers child session by orchestration key
Given a previous local child-session creation succeeded but saving the ledger child reference failed
When local CEO orchestration retries the same ledger task
Then the existing child session is recovered by hidden orchestration key
And a duplicate child session is not created.

### Requirement: Local acceptance pre-pass
The local console MUST run a local acceptance pre-pass before normal mention trigger handling.

The local console MUST recognize child task pass only from a real acceptance role message that covers every formal child acceptance statement and states overall pass.

The local console MUST write child acceptance facts before consuming any handoff mention in the same message.

The local console MUST create one parent integration acceptance request after all current active local child session refs pass.

The local console MUST route parent integration acceptance failure into a repair child session, not direct parent implementation.

The local console MUST dedupe parent integration requests and repair child sessions by stable hidden keys.

The local console MUST post a bounded visible format reminder when an acceptance message states overall pass but per-statement walkthrough cannot be parsed.

The local console MUST surface a visible blocked report when a required child session is closed or archived without an acceptance pass fact.

#### Scenario: Acceptance write succeeds but integration request write fails
Given a local child acceptance fact is saved
And the parent integration request visible message write fails
When local acceptance pre-pass settles
Then the triggering message handoff is not consumed
And a completed parent integration request is not recorded
And a later retry can publish the parent integration request.

#### Scenario: Parent integration failure creates repair child session
Given all child sessions passed and parent integration acceptance is requested
When the acceptance role rejects one target-level statement
Then a repair child session is created or recovered
And the parent session shows the repair reference
And the original parent implementation is not modified directly.

### Requirement: Local dead-letter and recovery
The local console MUST keep failure counts and last failure reasons for local message processing failures.

The local console MUST NOT advance the local processing cursor when handling fails before a visible local result is written.

The local console MUST write a visible dead-letter system record after the retry budget is exhausted.

The local console MUST ensure local dead-letter records contain no legal agent mention and do not trigger a new agent run.

The local console MUST allow a later local message to recover the session and continue processing without replaying the dead-lettered message.

#### Scenario: Dead-letter visible write failure does not advance cursor
Given a local message has exhausted its retry budget
And writing the visible dead-letter system record fails
When local processing settles
Then the processing cursor is not advanced
And the dead-lettered outcome is not saved as successful
And a later retry can attempt the visible dead-letter write again.

#### Scenario: Dead-letter record does not self-trigger
Given a visible local dead-letter system record has been written
When local drain evaluates subsequent trigger sources
Then the dead-letter record does not trigger any agent
And the dead-lettered source message is not replayed.

### Requirement: Worktree branch and diff parity
The local console MUST create or reuse a stable local branch inside the temporary worktree when worktree mode is enabled for a git project.

The local console MUST record the original repository root, base ref, branch name, worktree path, and run id for each worktree-mode Codex run.

The local console MUST generate a bounded diff bundle only after a code-verified local worktree run.

The local console MUST NOT generate a returnable diff bundle for in-progress or plan-written local worktree runs.

The local console MUST persist the diff patch path, affected files summary, and diff status for each generated local workspace diff.

The local console MUST keep the original project directory clean before explicit diff return.

The local console MUST fail visibly and preserve the diff source when the original project directory is dirty before diff return.

The local console MUST apply the generated diff to the original project directory only after an explicit local user action.

The local console MUST run a bounded diff apply check before applying a generated diff to the original project directory.

The local console MUST preserve the diff bundle and write a visible local error if diff return fails or times out.

The local console MUST support abandoning a generated diff without modifying the original project directory or deleting the temporary worktree.

The local console MUST support rolling back an applied diff through a bounded reverse apply of the same patch.

The local console MUST keep the original project directory clean after a successful rollback.

The local console MUST NOT call `gh`, fetch, merge, rebase, delete the original directory, or modify GitHub issue worktree state while performing local worktree diff return.

#### Scenario: Worktree branch produces diff without dirtying original directory
Given a git project has worktree mode enabled
When dev completes a local code-verified run
Then Codex ran on a local branch in a temporary worktree
And a diff bundle is generated
And the original project directory remains clean until the user explicitly applies the diff.

#### Scenario: Only code-verified worktree runs produce returnable diffs
Given a git project has worktree mode enabled
When dev completes a local in-progress or plan-written run
Then the local console does not create a returnable workspace diff bundle
And the temporary worktree remains available for later work.

#### Scenario: Explicit diff return changes only the expected files
Given a generated worktree diff bundle exists
And the original project directory is clean
When the user explicitly applies the diff
Then the apply check succeeds before apply
And the original project directory status contains only files described by the diff bundle
And the diff status becomes applied.

#### Scenario: Abandoning a generated diff preserves isolation
Given a generated worktree diff bundle exists
When the user abandons the diff
Then the diff status becomes abandoned
And the original project directory remains clean
And the temporary worktree is not deleted.

#### Scenario: Applied diff can be rolled back without destructive reset
Given a generated worktree diff bundle has been applied to the original project directory
When the user rolls back that diff
Then the local console reverse-applies the same patch with a bounded check
And the original project directory becomes clean
And the local console does not run a destructive reset or delete the original directory.

#### Scenario: Diff apply conflict or hang is bounded
Given a generated worktree diff bundle exists
When applying the diff to the original project directory conflicts or never settles
Then the system writes a visible local error within the configured timeout
And the patch file is preserved
And the session is released
And the original directory is not left half-written by the failed apply.

#### Scenario: Local worktree parity does not change GitHub issue worktree behavior
Given the local console implements worktree branch and diff return
When the GitHub issue worktree capability prepares an issue workspace
Then the issue workspace still uses the issue-scoped worktree path and branch
And reuse still only refreshes and reports main freshness
And the issue workspace is not automatically merged, rebased, recreated, or diff-returned into another directory.

### Requirement: Local T5 GitHub-zero evidence
The local T5 acceptance flow MUST NOT call `gh`.

#### Scenario: Fake gh is not invoked during T5 acceptance
Given the T5 acceptance flow runs with a fake `gh` executable placed first in `PATH`
When `pnpm exec tsx scripts/acceptance/local-console-t5.ts` completes
Then the fake `gh` call count is 0.
