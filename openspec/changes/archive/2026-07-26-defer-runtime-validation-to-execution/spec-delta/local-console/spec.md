# local-console spec delta：defer-runtime-validation-to-execution

## ADDED Requirements

### Requirement: Messages snapshot then directly start the bound engine

Source: docs/product/pages/main-conversation.md#选择工作空间与团队
Source: docs/product/pages/main-conversation.md#Agent-执行与恢复

The first-message transaction MUST persist the session, pending user message, ordered attachments
and the complete selected-team snapshot before the primary Agent run is started. The runtime MUST
invoke the driver selected by the applicable immutable session/run CLI/model/effort snapshot for
the first message, later messages, member handoffs and retries, without a separate version,
authentication, model or effort preflight. Spawn, authentication, configuration-application or
driver failure MUST become an explicit failed attempt and visible “这一步没跑起来” fact. The
system MUST preserve the session, user message and immutable snapshot and MUST NOT invoke another
CLI as fallback.

### Scenario: First-message bound CLI is missing

- GIVEN a valid new-conversation draft snapshots a primary Agent bound to Kimi
- AND Kimi cannot be spawned
- WHEN the first message is submitted
- THEN the session, first user message and Kimi/model/effort snapshot are persisted
- AND the primary run becomes failed with a safe Kimi-specific reason
- AND the Codex driver is never called.

### Scenario: First-message configuration is rejected

- GIVEN a valid new-conversation draft snapshots a non-empty model/effort combination
- AND the bound driver rejects that configuration before prompt
- WHEN the first run starts
- THEN the submitted user message is not returned to draft state or deleted
- AND the run exposes a retryable failed fact using the same immutable snapshot
- AND neither the team binding nor snapshot is silently rewritten.

### Scenario: Later messages do not repeat capability preflight

- GIVEN a session snapshot binds its primary Agent to Kimi/model K/effort high
- AND the first message has already completed
- WHEN the user sends a second and a third message
- THEN each message starts one new Kimi run with K/high
- AND no capability probe or Codex driver is called.

### Scenario: Team-page edits affect only new sessions

- GIVEN session A snapshots its primary Agent with Kimi/model K/effort high
- WHEN the team page changes the same team/member to Codex/model C/effort medium
- AND session A sends a later message or retries an existing run
- THEN those actions still use their immutable Kimi/K/high snapshots
- AND a newly created session B snapshots and uses Codex/C/medium
- AND neither session invokes the other CLI as fallback.
