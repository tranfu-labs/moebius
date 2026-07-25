# local-console delta：agent-runtime-profiles-official-team-updates

> Product anchors: `docs/product/pages/main-conversation.md#选择工作空间与团队` and
> `docs/product/pages/main-conversation.md#Agent-执行与恢复`. Onboarding, invalid-profile
> creation/switch gating and right-sidebar process projection remain outside this delta.

## ADDED Requirements

### Requirement: Session team snapshot freezes each member execution profile

Source: docs/product/pages/main-conversation.md#选择工作空间与团队

For newly created or explicitly switched team snapshots, the system MUST persist each member's
effective CLI/model/effort together with slug and Agent Markdown. Later team-page changes MUST NOT
change the effective profile of an existing session snapshot. Legacy snapshot rows without a
profile MUST preserve one legacy Codex identity across full, resume and fallback, and MUST NOT be
populated from current team state.

#### Scenario: Team profile changes after session creation

- **GIVEN** a session snapshot captured `@dev` with Kimi model K and effort high
- **WHEN** the team page later changes `@dev` to Codex model C
- **THEN** the existing session still runs `@dev` with Kimi/K/high
- **AND** a later new session can capture Codex/C.

#### Scenario: Pending switch preserves pre-switch runs

- **GIVEN** a session has multiple started or scheduled runs on team A
- **WHEN** the user selects team B
- **THEN** every pre-switch run keeps its team-A content and profile until terminal
- **AND** team B's complete content/profile snapshot becomes effective only after all of them settle
- **AND** pending handbacks and user messages are then routed to team B's primary Agent.

### Requirement: Local Agent run is hard-routed to the snapshotted engine

Source: docs/product/pages/main-conversation.md#Agent-执行与恢复

The local console MUST select the execution driver from the selected member's session snapshot and
MUST pass that snapshot's model and effort to full and resume attempts. Missing CLI, invalid
configuration or driver failure MUST become an explicit failed attempt. The system MUST NOT invoke
another CLI as fallback.

#### Scenario: Bound Kimi is missing

- **GIVEN** the selected member snapshot is bound to Kimi
- **AND** the Kimi executable cannot be started
- **WHEN** the member run begins
- **THEN** the run fails with a safe Kimi-specific reason
- **AND** the Codex driver is never called.

### Requirement: Execution session links are engine and profile specific

Source: docs/product/pages/main-conversation.md#Agent-执行与恢复

The system MUST freeze each run's original team content, role, engine, profile and workspace as an
immutable run execution context, and save external links with run id, engine, external session id,
execution-profile fingerprint and run-context fingerprint. Only an explicit recovery intent for
that same unfinished run and matching context MAY resume. Any mismatch MUST use full fallback with
that run's original context, MUST NOT read the session's current post-switch snapshot, and MUST NOT
pass an external session id to a different engine. The current team may take over only through a
new run. Existing Codex thread links MUST remain readable as legacy Codex links.

#### Scenario: Old run is retried after a team switch

- **GIVEN** an unfinished run links to a Kimi session
- **AND** the session later switches to a Codex-bound team
- **AND** the Kimi external session is no longer resumable
- **WHEN** recovery is planned
- **THEN** Kimi resume is rejected
- **AND** Kimi receives a full prompt built from the old run's Kimi profile and team context
- **AND** the Codex driver is not called.

### Requirement: Kimi local execution uses a bounded ACP client

Source: docs/product/pages/main-conversation.md#Agent-执行与恢复

The Kimi driver MUST obtain a specific session id from ACP session/new or session/resume. Before
prompt it MUST treat that response's configOptions and the subsequent config_option_update/setting
responses as authoritative, set the snapshotted model and thinking effort, and verify that both
effective values exactly match the snapshot. Missing options, rejected settings, silent CLI
fallback, unconfirmed effective values or any mismatch MUST fail the attempt before prompt. Such a
failure MUST NOT modify the snapshot, silently substitute a value or invoke another driver.
After successful verification the driver MUST stream visible Agent Markdown and support cancellation.
Supported images MUST use ACP image blocks. Ordinary files MUST continue through the managed safe
copy and prompt manifest contract rather than being represented as native Kimi file attachments.
Attachment conversion or capability failure MUST fail the Kimi attempt and MUST NOT invoke Codex.
Reverse file requests MUST be restricted to trusted workspace and managed attachment roots.
Unknown/malformed/oversized protocol input and unresolved permission requests MUST fail closed.
The driver MUST NOT identify a session through `--continue`, filesystem time or “most recent”
selection.

#### Scenario: Specific Kimi session resumes

- **GIVEN** a recovery intent names Kimi session S
- **WHEN** the Kimi driver resumes
- **THEN** it sends ACP session/resume for S and applies the saved model/effort before prompt
- **AND** it does not inspect or continue any other recent session.

#### Scenario: Kimi falls back from the saved effort

- **GIVEN** a Kimi snapshot requires model M and effort high
- **AND** session/new configOptions expose the fields but the setting response confirms effort medium
- **WHEN** the driver validates the effective profile
- **THEN** it fails before sending session/prompt
- **AND** it does not call the Codex driver or persist medium as the member profile.

#### Scenario: Kimi receives an image and an ordinary file

- **GIVEN** a Kimi-bound run has one supported image and one ordinary managed attachment
- **WHEN** the driver builds session/prompt
- **THEN** the image is an ACP image block and the ordinary file is described by the safe manifest
- **AND** no Codex invocation is used to handle either attachment.

#### Scenario: Kimi file request escapes workspace

- **GIVEN** an ACP reverse request resolves outside all allowed roots
- **WHEN** the driver validates the request
- **THEN** it rejects the request without reading or writing the target
- **AND** the run settles with a safe diagnostic.
