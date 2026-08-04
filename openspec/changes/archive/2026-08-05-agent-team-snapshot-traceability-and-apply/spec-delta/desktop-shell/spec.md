# desktop-shell delta：agent-team-snapshot-traceability-and-apply

## MODIFIED Requirements

### Requirement: #14 桌面运行名单只来自会话团队

Source: docs/product/pages/main-conversation.md#选择工作空间与团队

The desktop main process MUST inject a resolver that loads one complete valid saved team version for a stable ownership/id binding. The version MUST contain core team identity, stable source disambiguation, ordered member identity and Markdown, and each persisted execution profile. The resolver MUST use recorded user-team locations and built-in locations, MUST reject deleted/needs-repair/invalid teams without falling back to shared agents, and MUST NOT move `teams/` layout or profile-store knowledge into local-console. A legacy session without a team binding MUST continue using the registered shared-agent compatibility resolver and MUST NOT be classified as deleted.

The same resolved version MUST serve new-session capture, explicit team switch and update inspection/application. It MUST exclude renderer drafts and onboarding orchestration.

#### Scenario: One resolver supplies a complete version

- **GIVEN** a usable user team at a relocated recorded path
- **WHEN** local-console requests the saved version for creation or update inspection
- **THEN** the result contains the recorded core, source identity, ordered members, Markdown and persisted profiles from that path
- **AND** it contains no unsaved renderer draft or onboarding relay.

#### Scenario: Broken team is not a candidate

- **GIVEN** the bound team has an unreadable member file
- **WHEN** the resolver is called for update inspection
- **THEN** it returns the existing needs-repair failure
- **AND** no partial roster or candidate version is returned.

#### Scenario: Unbound legacy session keeps the compatibility roster

- **GIVEN** a legacy session has no team ownership/id binding
- **WHEN** desktop resolves its runtime roster
- **THEN** it uses the registered shared-agent compatibility resolver
- **AND** it does not create a team candidate or report team deletion.

## ADDED Requirements

### Requirement: Desktop console forwards team-update and run-audit intents through narrow APIs

Source: docs/product/pages/main-conversation.md#团队按钮展开
Source: docs/product/pages/main-conversation.md#Agent-头像与当时信息

The renderer application layer MUST use the loopback local-console API for update inspection, apply, retry, cancel, run information and historical Markdown. Preload MUST NOT expose filesystem, SQLite or arbitrary team-file reads for these actions. Renderer requests MUST identify only the selected session/run and action; they MUST NOT submit Markdown, profiles, paths or internal snapshot keys.

Late responses MUST be committed only when their session/run request key and revision are current. Parent re-render or callback identity change MUST NOT repeat a mutation, clear a newer result or let an old response replace current state.

#### Scenario: Late inspection belongs to the old session

- **GIVEN** update inspection for session A is slow
- **WHEN** the user switches to session B and B's inspection completes first
- **THEN** A's late result does not appear above B's composer
- **AND** no apply callback for B is replaced by A's callback.

#### Scenario: Markdown read has no path capability

- **GIVEN** the user opens a historical Agent Markdown dialog
- **WHEN** the renderer calls desktop application APIs
- **THEN** the request contains session/run identity only
- **AND** preload receives no arbitrary path or file-read capability.

### Requirement: Team mutation feedback reflects only persisted results

Source: docs/product/pages/agent-teams.md#保存后的生效反馈

The desktop application layer MUST derive save feedback from completed team mutations. It MUST distinguish full success, partial success with per-item failures, and a valid external version loaded without an internal draft. It MUST preserve failed drafts and MUST NOT report success for rejected, conflicted, invalid, unreadable or needs-repair state.

A successful mutation MUST be visible to the complete-version resolver without restarting the application. A save-all-and-leave success MUST commit a feedback payload containing the team and saved-item count before navigation; partial failure MUST keep the detail view active.

#### Scenario: Partial save keeps failed draft out of snapshots

- **GIVEN** two member Markdown drafts and one profile draft are being saved
- **WHEN** one Markdown save fails and the other two mutations persist
- **THEN** feedback marks only the two persisted items as saved
- **AND** the failed draft remains editable
- **AND** a subsequent complete team resolve uses the failed member's previous saved file.

#### Scenario: Save all success survives navigation

- **GIVEN** save-all-and-leave persists three items successfully
- **WHEN** the team detail closes
- **THEN** the list receives the team identity and count-three success payload
- **AND** the payload is not lost during navigation.

#### Scenario: Valid external load is distinct from conflict

- **GIVEN** no internal draft exists for a member
- **WHEN** a valid external change is loaded successfully
- **THEN** an external-loaded success payload is emitted without restart
- **WHEN** the external content is invalid or conflicts with a draft
- **THEN** no success payload is emitted.
